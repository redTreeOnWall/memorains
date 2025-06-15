import { DocApplication, DocRoomInfo } from "../interface/Interface";
import { DocServerManager, DocServerStatus } from "../interface/Interface";
import { fork, ChildProcess } from "child_process";
import { awaitTime, log, uuid } from "../utils/utils";
import {
  C2M_ProcessMessage,
  C2M_MessageType,
  M2C_ProcessMessage,
  M2C_OpenMessageRequest,
  M2C_MessageType,
  C2M_OpenMessageResponse,
  M2C_CloseMessageRequest,
  C2M_CloseMessageResponse,
} from "../interface/ProcessMessage";
import { MessageActor } from "../utils/messageUtils";
import * as os from "os";
import { DocRoomInfoData } from "../interface/HttpMessage";
import { WaitableLock } from "../utils/WaitableLock";
import { getSecret } from "../security/secret";

type DocServerContext = {
  childProcess: ChildProcess;
  messageActor: MessageActor<M2C_ProcessMessage, C2M_ProcessMessage>;
  pendingUsers: number;
} & DocServerStatus;

type RoomTask =
  | { type: "clearDoc" }
  | { type: "openDoc"; tasks: Promise<void>[] };

// TODO Move this to a independence instance
export class DocServerManagerImp implements DocServerManager {
  constructor(public app: DocApplication) {}
  docRoomMap: Map<string, DocRoomInfo> = new Map();
  serverMap: Map<string, DocServerContext> = new Map();
  private zeroUserRooms = new Set<string>();

  async init() {
    // TODO
    await this.createDocServerProcesses();
    log("doc server manager initd");
  }

  private updateRoomStatus(room: DocRoomInfo) {
    if (room.currentUserCount === 0) {
      this.zeroUserRooms.add(room.docId);
    } else {
      this.zeroUserRooms.delete(room.docId);
    }

    this.docRoomMap.set(room.docId, room);

    if (this.zeroUserRooms.size) {
      this.requestClearEmptyRoom();
    }
  }

  private clearingRooms = false;
  private async requestClearEmptyRoom() {
    if (this.clearingRooms) {
      return;
    }
    this.clearingRooms = true;
    await awaitTime(10 * 1000);
    this.addRoomTasks({ type: "clearDoc" });
    this.clearingRooms = false;
  }

  private async startNewProcess(port: number) {
    return new Promise<ChildProcess>((resolve) => {
      const id = uuid();
      const host = "host";
      const childProcess = fork(
        "build/imp/DocServerImp",
        [id, host, `${port}`],
        {
          env: {
            ...process.env,
            SECRET: getSecret(),
          },
        }
      );

      childProcess.on("exit", () => {
        this.serverMap.delete(id);
        // TODO restart process
      });

      const messageActor = new MessageActor<
        M2C_ProcessMessage,
        C2M_ProcessMessage
      >((msg) => {
        childProcess.send(msg);
      });

      messageActor.addMessageListener((msg) => {
        if (msg.messageType === C2M_MessageType.serverStarted) {
          const server = this.serverMap.get(id);
          if (server) {
            server.status = "started";
          }

          resolve(childProcess);
        } else if (msg.messageType === C2M_MessageType.updateRoomStatus) {
          const status = msg.status;
          this.updateRoomStatus(status);
          // TODO close empty rooms
        }
      });

      childProcess.on("message", (message) => {
        const msg = message as C2M_ProcessMessage;
        messageActor.receiveMessage(msg);
      });

      this.serverMap.set(id, {
        id,
        host,
        port,
        status: "created",
        childProcess,
        messageActor,
        pendingUsers: 0,
      });
    });
  }

  private async createDocServerProcesses() {
    const count = process.env.IS_DEV === "true" ? 2 : os.cpus().length * 2;
    log(`Starting ${count} doc server instances...`);
    // TODO port list
    let startPort = 8081;
    for (let i = 0; i < count; i += 1) {
      startPort += 1;
      await this.startNewProcess(startPort);
    }

    process.on("uncaughtException", (e) => {
      console.error(e);
      this.serverMap.forEach((s) => {
        s.childProcess.kill(-1);
      });
    });
  }

  async clearZeroUserRooms() {
    this.roomsLock.locked = true;

    const clearedRooms: string[] = [];

    for (const docId of this.zeroUserRooms) {
      const room = this.docRoomMap.get(docId);

      if (!room) {
        console.error("Trying to delete a room did not existed!");
        continue;
      }

      const server = this.serverMap.get(room.serverInstanceId);

      if (!server) {
        clearedRooms.push(docId);
        continue;
      }

      const closeMes: M2C_CloseMessageRequest = {
        messageType: M2C_MessageType.closeDoc,
        docID: docId,
      };

      const response =
        await server.messageActor.request<C2M_CloseMessageResponse>(
          closeMes,
          20 * 1000
        );

      if (response.success) {
        clearedRooms.push(docId);
      }
    }

    clearedRooms.forEach((roomId) => {
      this.docRoomMap.delete(roomId);
      this.zeroUserRooms.delete(roomId);
    });

    this.roomsLock.locked = false;
  }

  roomsLock = new WaitableLock();

  private roomTaskQueue: RoomTask[] = [];

  private runningRoomTasks = false;
  private async addRoomTasks(task: RoomTask) {
    const last = this.roomTaskQueue[this.roomTaskQueue.length - 1];

    if (last === undefined || last.type !== task.type) {
      this.roomTaskQueue.push(task);
    } else {
      if (last.type === "openDoc" && task.type === "openDoc") {
        last.tasks.push(...task.tasks);
      }
    }

    if (this.runningRoomTasks) {
      return;
    }
    this.runningRoomTasks = true;

    let first = this.roomTaskQueue.shift();
    while (first) {
      if (first.type === "clearDoc") {
        await this.clearZeroUserRooms();
      } else {
        await Promise.all(first.tasks);
      }

      first = this.roomTaskQueue.shift();
    }

    this.runningRoomTasks = false;
  }

  async requestOpenDoc(docID: string) {
    return new Promise<DocRoomInfoData | null>((resolveOpen) => {
      const task = new Promise<void>((resolveTask) => {
        const runOpen = async () => {
          const res = await this.requestOpenDocTask(docID);
          resolveTask();
          resolveOpen(res);
        };
        runOpen();
      });

      // TODO open doc waiting user count should be limited;
      this.addRoomTasks({
        type: "openDoc",
        tasks: [task],
      });
    });
  }

  private async requestOpenDocTask(docID: string) {
    // TODO check docID
    let exitRoom = this.docRoomMap.get(docID) ?? null;

    if (!exitRoom) {
      let server: DocServerContext | null = null;
      // TODO use cache to improve performance
      // TODO CPU and memory usage of server
      const serverUserCount = new Map<string, number>();
      this.serverMap.forEach((svr) => {
        if (svr.status === "started") {
          serverUserCount.set(svr.id, 0);
        }
      });

      this.docRoomMap.forEach((room) => {
        const count = serverUserCount.get(room.serverInstanceId);
        if (count !== undefined) {
          serverUserCount.set(
            room.serverInstanceId,
            count + room.currentUserCount
          );
        }
      });

      let minUserServerID: string | null = null;
      let minUserCount = Number.MAX_VALUE;
      serverUserCount.forEach((value, key) => {
        if (minUserServerID === null || value < minUserCount) {
          minUserServerID = key;
          minUserCount = value;
        }
      });

      if (minUserServerID && this.serverMap.has(minUserServerID)) {
        server = this.serverMap.get(minUserServerID) ?? null;
      }

      if (!server) {
        return null;
      }

      const openDocMessage: M2C_OpenMessageRequest = {
        messageType: M2C_MessageType.M2C_OpenMessageRequest,
        docID: docID,
      };

      const response =
        await server.messageActor.request<C2M_OpenMessageResponse>(
          openDocMessage,
          10 * 1000
        );

      if (!response.success) {
        return null;
      }

      const newRoomInfo = response.status ?? null;

      if (newRoomInfo) {
        this.updateRoomStatus(newRoomInfo);
      }

      exitRoom = newRoomInfo;
    }

    if (!exitRoom) {
      return null;
    }

    const server = this.serverMap.get(exitRoom.serverInstanceId);

    if (!server) {
      return null;
    }

    const res: DocRoomInfoData = {
      serverHost: server.host,
      serverPort: server.port,
      docID: exitRoom.docId,
      password: exitRoom.password,
    };

    return res;
  }

  async requestCloseDoc() {
    // TODO
    return false;
  }
}
