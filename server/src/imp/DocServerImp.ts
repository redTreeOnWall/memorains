import * as Y from "yjs";
import { Base64 } from "js-base64";
import { parse } from "url";
import { WebSocketServer } from "ws";
import { DataBaseManager, DocServer } from "../interface/Interface";
import {
  C2M_ProcessMessage,
  C2M_MessageType,
  C2M_UpdateRoomStatusMessage,
  M2C_ProcessMessage,
  M2C_MessageType,
  C2M_OpenMessageResponse,
  C2M_CloseMessageResponse,
} from "../interface/ProcessMessage";
import { DataBaseManagerImp } from "./DataBaseManagerImp";
import {
  ClientMessageType,
  ServerMessageType,
  S2C_DocInfoMessage,
  S2C_UpdateDocMessage,
  S2C_UserListMessage,
  ClientMessage,
  ServerMessage,
  S2C_UpdateCursorMessage,
  S2C_SyncVectorMessage,
} from "../interface/UserServerMessage";
import { MessageActor } from "../utils/messageUtils";
import { awaitTime, log, randomInt, uuid } from "../utils/utils";
import { DocumentEntity } from "../interface/DataEntity";
import { asyncVerify } from "../utils/jwtUtils";

export interface ConnectContext {
  userId: string;
  docId: string;
  userSessionId: string;
  sendDocInfoToClient: (docInfo: S2C_DocInfoMessage) => Promise<boolean>;
  updateDocumentOfUser: (
    update: Uint8Array,
    commitId: number,
    origin?: string
  ) => Promise<boolean>;
  updateUserList: () => Promise<boolean>;
  sendMessage: (message: ServerMessage) => Promise<boolean>;
  close: () => Promise<void>;
  closed: boolean;
}

export class OnLineDocument {
  doc: Y.Doc | null = null;
  lastCommitId: number = randomInt();
  connectors = new Set<ConnectContext>();
  // FIXME use token, and token should be updated when the private of the doc changed
  password: string;
  documentEntity: null | DocumentEntity = null;
  constructor(public docId: string, public documentServer: DocServerImp) {
    this.password = uuid();
  }
  async init() {
    const docData = await this.documentServer.database.getDocument(
      this.docId,
      true
    );

    if (!docData) {
      return false;
    }

    this.doc = new Y.Doc();

    const data = docData?.state;

    if (data) {
      Y.applyUpdate(this.doc, new Uint8Array(data));
      this.lastCommitId = docData.commit_id;
    }

    this.doc.on("update", (update: Uint8Array, origin: any) => {
      for (const ctx of this.connectors) {
        if (origin !== ctx) {
          ctx.updateDocumentOfUser(update, this.lastCommitId);
        }
      }
    });

    this.documentEntity = docData;
    this.documentEntity.state = null;

    return true;
  }

  update(update: Uint8Array, commitId: number, connectContext: ConnectContext) {
    if (this.doc) {
      Y.applyUpdate(this.doc, update, connectContext);
      this.lastCommitId = commitId;
    }

    this.trySaveState();
  }

  private saving = false;
  private goingToSaveData = false;
  private trySaveState = async () => {
    if (this.goingToSaveData) {
      return;
    }

    this.goingToSaveData = true;

    // TODO dynamic
    await awaitTime(30 * 1000);
    this.goingToSaveData = false;

    if (this.closed) {
      return;
    }

    if (this.saving) {
      return;
    }

    this.saving = true;
    await this.save();
    this.saving = false;
  };

  private async save() {
    if (this.doc) {
      const state = Y.encodeStateAsUpdate(this.doc);
      const success = await this.documentServer.database.updateStateOfDocument(
        this.docId,
        state,
        this.lastCommitId
      );
      if (success) {
        log(`saved, commitId: ${this.lastCommitId}, size:${state.length}`);
      } else {
        this.close();
      }
    }
  }

  closed = false;
  async close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.documentServer.rooms.delete(this.docId);
    await this.save();
    for (const ctx of this.connectors) {
      await ctx.close();
    }
  }
}

export class DocServerImp implements DocServer {
  constructor(public id: string, public host: string, public port: number) {
    this.ws = new WebSocketServer({ port });
    this.processMessageActor = new MessageActor((msg) => {
      process.send?.(msg);
    });
  }

  processMessageActor: MessageActor<C2M_ProcessMessage, M2C_ProcessMessage>;

  connectors = new Set<ConnectContext>();

  database: DataBaseManager = new DataBaseManagerImp();
  ws: WebSocketServer;
  rooms: Map<string, OnLineDocument> = new Map();

  async init() {
    // TODO

    this.database.init();

    await this.listenWs();

    await this.listenProcess();

    process.on("message", (message) => {
      const msg = message as M2C_ProcessMessage;
      this.processMessageActor.receiveMessage(msg);
    });

    const startedMes: C2M_ProcessMessage = {
      messageType: C2M_MessageType.serverStarted,
    };

    this.processMessageActor.request(startedMes, 0);
    // this.startTick();
    log(`server instance ${this.port} started`);
  }

  private async openDoc(docId: string) {
    let document = this.rooms.get(docId);
    if (!document) {
      document = new OnLineDocument(docId, this);
      const success = await document.init();
      if (success) {
        this.rooms.set(docId, document);
      } else {
        return null;
      }
    }

    return document;
  }

  private async closeDoc(docId: string) {
    const document = this.rooms.get(docId);
    if (document) {
      this.rooms.set(docId, document);
      await document.close();
    }
  }

  private async listenProcess() {
    this.processMessageActor.addMessageListener(async (msg) => {
      if (msg.messageType === M2C_MessageType.M2C_OpenMessageRequest) {
        const doc = await this.openDoc(msg.docID);

        const responseMessage: C2M_OpenMessageResponse = {
          messageType: C2M_MessageType.C2M_OpenMessageResponse,
          success: false,
        };

        if (doc) {
          responseMessage.success = true;
          responseMessage.status = {
            docId: doc.docId,
            // when open a doc , there may be a new user
            currentUserCount: doc.connectors.size + 1,
            updateBytePerSecond: 0,
            serverInstanceId: this.id,
            password: doc.password,
          };
          // the room will be closed after 5 min if no user join
          // FIXME add the waiting for first user state;
          setTimeout(() => {
            const currentRoom = this.rooms.get(msg.docID);
            if (currentRoom?.connectors.size === 0) {
              this.syncRoomInfo(currentRoom);
            }
          }, 5 * 60 * 1000);
        }

        if (msg.messageID) {
          this.processMessageActor.response(responseMessage, msg.messageID);
        }
      } else if (msg.messageType === M2C_MessageType.closeDoc) {
        await this.closeDoc(msg.docID);
        if (msg.messageID) {
          const closeRes: C2M_CloseMessageResponse = {
            messageType: C2M_MessageType.C2M_CloseMessageResponse,
            success: true,
          };
          this.processMessageActor.response(closeRes, msg.messageID);
        }
      }
    });
  }

  private async listenWs() {
    this.ws.addListener("connection", async (ws, request) => {
      const url = request.url;
      if (!url) {
        ws.close();
        return;
      }
      const { pathname } = parse(url);

      if (!pathname) {
        ws.close();
        return;
      }

      const split = pathname.split("/doc/websocket/");
      if (!(split.length === 2 && split[0] === "")) {
        ws.close();
        return;
      }

      // /ws/:id/:user/:password

      // const port = split[1].split("/")[0];
      // const docId = split[1].split("/")[1];
      // const userId = split[1].split("/")[2];
      const password = split[1].split("/")[3];
      const tokenString = split[1].split("/")[4];

      let tokenVerified = false;
      let userId: string | null = null;
      let docId: string | null = null;

      try {
        const token = (await asyncVerify(tokenString)) as {
          userId?: string;
          docId?: string;
        };
        // TODO public documents;
        // const room = docId ? this.rooms.get(docId) : null;
        // room?.documentEntity?.is_public // if true, no need user name
        if (token.userId && token.docId) {
          docId = token.docId;
          userId = token.userId;
          tokenVerified = true;
        }
      } catch (e) {
        tokenVerified = false;
      }

      const room = docId ? this.rooms.get(docId) : null;

      if (
        !tokenVerified ||
        !docId ||
        !userId ||
        !room ||
        room.password !== password
      ) {
        ws.close();
        return;
      }

      const documentId = docId;

      const connectCtx: ConnectContext = {
        userId,
        docId,
        userSessionId: uuid(),
        sendMessage: async (message) => {
          ws.send(JSON.stringify(message));
          return true;
        },
        sendDocInfoToClient: async (docInfo) => {
          ws.send(JSON.stringify(docInfo));
          return true;
        },
        updateUserList: async () => {
          const userListMes: S2C_UserListMessage = {
            messageType: ServerMessageType.userList,
            data: {
              userList: Array.from(
                this.rooms.get(documentId)?.connectors.values() ?? []
              ).map((u) => ({
                userId: u.userId,
                userSessionId: u.userSessionId,
              })),
            },
          };

          ws.send(JSON.stringify(userListMes));
          return true;
        },
        updateDocumentOfUser: async (update, commitId, origin) => {
          const mes: S2C_UpdateDocMessage = {
            messageType: ServerMessageType.updateDoc,
            data: Base64.fromUint8Array(update),
            commitId,
            origin,
          };
          ws.send(JSON.stringify(mes));
          return true;
        },
        close: async () => {
          if (connectCtx.closed) {
            return;
          }
          connectCtx.closed = true;
          try {
            ws.close();
          } catch (e) {
            console.error("closed");
          }

          this.userLeaveDocument(documentId, connectCtx);
        },
        closed: false,
      };

      ws.on("error", (e) => {
        // TODO error code
        connectCtx.close();
        console.error(e);
      });

      ws.on("close", () => {
        connectCtx.close();
      });

      const success = await this.userJoinDocumentRoom(docId, connectCtx);

      const documentEntity = room.documentEntity;

      if (!success || !documentEntity) {
        ws.close();
        return;
      }

      // This is a first message sent to client
      connectCtx.sendDocInfoToClient({
        messageType: ServerMessageType.docInfo,
        data: {
          docInfo: documentEntity,
        },
      });

      ws.addEventListener("message", (e) => {
        try {
          if (typeof e.data !== "string") {
            return;
          }

          const msg = JSON.parse(e.data as string) as ClientMessage;

          if (!msg?.messageType) {
            return;
          }

          // update
          if (msg.messageType === ClientMessageType.updateDoc) {
            const state = Base64.toUint8Array(msg.messageBody);
            this.update(state, msg.commitId, connectCtx, documentId);
          } else if (msg.messageType === ClientMessageType.syncVector) {
            const doc = this.rooms.get(connectCtx.docId);
            if (doc?.doc) {
              const serverVector = Y.encodeStateVector(doc.doc);
              const syncMes: S2C_SyncVectorMessage = {
                messageType: ServerMessageType.syncVector,
                data: Base64.fromUint8Array(serverVector),
              };
              connectCtx.sendMessage(syncMes);

              const clientVector = Base64.toUint8Array(msg.messageBody);
              const diff = Y.encodeStateAsUpdate(doc.doc, clientVector);
              connectCtx.updateDocumentOfUser(diff, doc.lastCommitId, "sync");
            }
          } else if (msg.messageType === ClientMessageType.updateCursor) {
            this.rooms.get(documentId)?.connectors.forEach((u) => {
              if (u.userSessionId === connectCtx.userSessionId) {
                return;
              }
              const cursorMes: S2C_UpdateCursorMessage = {
                messageType: ServerMessageType.updateCursor,
                data: {
                  cursor: {
                    userSessionId: connectCtx.userSessionId,
                    userId: connectCtx.userId,
                    range: {
                      index: msg.messageBody.index,
                      length: msg.messageBody.length,
                    },
                  },
                },
              };
              u.sendMessage(cursorMes);
            });
          }
        } catch (e) {
          console.error(e);
        }
      });
    });
  }

  async userJoinDocumentRoom(docId: string, connectContext: ConnectContext) {
    const document = this.rooms.get(docId);
    if (!document) {
      return false;
    }

    document.connectors.add(connectContext);

    this.syncRoomInfo(document);

    const doc = document.doc;

    if (doc) {
      // const initUpdate = Y.encodeStateAsUpdate(doc);
      // connectContext.updateDocumentOfUser(initUpdate, document.lastCommitId);
    }

    log(
      `user ${connectContext.userId} join in doc ${docId}, user count: ${document.connectors.size}   doc count: ${this.rooms.size}`
    );
    document.connectors.forEach((c) => {
      c.updateUserList();
    });
    return true;
    // send state to user
  }

  async userLeaveDocument(docId: string, ctx: ConnectContext) {
    const document = this.rooms.get(docId);
    if (document) {
      document.connectors.delete(ctx);
      this.syncRoomInfo(document);
      log(
        `user ${ctx.userId} left doc ${docId}, user count: ${document.connectors.size}   doc count: ${this.rooms.size}`
      );
      document.connectors.forEach((c) => {
        c.updateUserList();
      });
    }
  }

  update(
    update: Uint8Array,
    commitId: number,
    connectContext: ConnectContext,
    docId: string
  ) {
    const document = this.rooms.get(docId);
    if (!document) {
      return;
    }

    if (!document.connectors.has(connectContext)) {
      return;
    }

    document.update(update, commitId, connectContext);
  }

  async syncRoomInfo(room: OnLineDocument) {
    const mes: C2M_UpdateRoomStatusMessage = {
      messageType: C2M_MessageType.updateRoomStatus,
      status: {
        docId: room.docId,
        currentUserCount: room.connectors.size,
        updateBytePerSecond: 0,
        serverInstanceId: this.id,
        password: room.password,
      },
    };

    // FIXME Issues happened here. Need some time to send message from child process to main process, and sending a empty room to main process (main did not receive this message yet, A user join a room, ),
    process.send?.(mes);
  }

  private closed = false;
  async startTick() {
    await awaitTime((this.port % 100) * 5 * 1000);

    while (!this.closed) {
      await awaitTime(10 * 60 * 1000);
      await this.tickUpdate();
    }
  }

  private async tickUpdate() {
    for (const [_, room] of this.rooms) {
      if (room.connectors.size == 0) {
        await this.syncRoomInfo(room);
      }
    }
  }
}

const onStart = async () => {
  const args = process.argv;
  const serverId = args[2];
  // TODO read host from nginx config list
  const host = args[3];
  const port = args[4];

  const server = new DocServerImp(serverId, host, Number.parseInt(port));
  await server.init();
};

onStart();
