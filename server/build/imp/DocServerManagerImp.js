"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocServerManagerImp = void 0;
const child_process_1 = require("child_process");
const utils_1 = require("../utils/utils");
const ProcessMessage_1 = require("../interface/ProcessMessage");
const messageUtils_1 = require("../utils/messageUtils");
const os = __importStar(require("os"));
const WaitableLock_1 = require("../utils/WaitableLock");
const secret_1 = require("../security/secret");
// TODO Move this to a independence instance
class DocServerManagerImp {
    constructor(app) {
        this.app = app;
        this.docRoomMap = new Map();
        this.serverMap = new Map();
        this.zeroUserRooms = new Set();
        this.clearingRooms = false;
        this.roomsLock = new WaitableLock_1.WaitableLock();
        this.roomTaskQueue = [];
        this.runningRoomTasks = false;
    }
    async init() {
        // TODO
        await this.createDocServerProcesses();
        (0, utils_1.log)("doc server manager initd");
    }
    updateRoomStatus(room) {
        if (room.currentUserCount === 0) {
            this.zeroUserRooms.add(room.docId);
        }
        else {
            this.zeroUserRooms.delete(room.docId);
        }
        this.docRoomMap.set(room.docId, room);
        if (this.zeroUserRooms.size) {
            this.requestClearEmptyRoom();
        }
    }
    async requestClearEmptyRoom() {
        if (this.clearingRooms) {
            return;
        }
        this.clearingRooms = true;
        await (0, utils_1.awaitTime)(10 * 1000);
        this.addRoomTasks({ type: "clearDoc" });
        this.clearingRooms = false;
    }
    async startNewProcess(port) {
        return new Promise((resolve) => {
            const id = (0, utils_1.uuid)();
            const host = "host";
            const childProcess = (0, child_process_1.fork)("build/imp/DocServerImp", [id, host, `${port}`], {
                env: {
                    ...process.env,
                    SECRET: (0, secret_1.getSecret)(),
                },
            });
            childProcess.on("exit", () => {
                this.serverMap.delete(id);
                // TODO restart process
            });
            const messageActor = new messageUtils_1.MessageActor((msg) => {
                childProcess.send(msg);
            });
            messageActor.addMessageListener((msg) => {
                if (msg.messageType === ProcessMessage_1.C2M_MessageType.serverStarted) {
                    const server = this.serverMap.get(id);
                    if (server) {
                        server.status = "started";
                    }
                    resolve(childProcess);
                }
                else if (msg.messageType === ProcessMessage_1.C2M_MessageType.updateRoomStatus) {
                    const status = msg.status;
                    this.updateRoomStatus(status);
                    // TODO close empty rooms
                }
            });
            childProcess.on("message", (message) => {
                const msg = message;
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
    async createDocServerProcesses() {
        const count = process.env.IS_DEV === "true" ? 2 : os.cpus().length * 2;
        (0, utils_1.log)(`Starting ${count} doc server instances...`);
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
        const clearedRooms = [];
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
            const closeMes = {
                messageType: ProcessMessage_1.M2C_MessageType.closeDoc,
                docID: docId,
            };
            const response = await server.messageActor.request(closeMes, 20 * 1000);
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
    async addRoomTasks(task) {
        const last = this.roomTaskQueue[this.roomTaskQueue.length - 1];
        if (last === undefined || last.type !== task.type) {
            this.roomTaskQueue.push(task);
        }
        else {
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
            }
            else {
                await Promise.all(first.tasks);
            }
            first = this.roomTaskQueue.shift();
        }
        this.runningRoomTasks = false;
    }
    async requestOpenDoc(docID) {
        return new Promise((resolveOpen) => {
            const task = new Promise((resolveTask) => {
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
    async requestOpenDocTask(docID) {
        // TODO check docID
        let exitRoom = this.docRoomMap.get(docID) ?? null;
        if (!exitRoom) {
            let server = null;
            // TODO use cache to improve performance
            // TODO CPU and memory usage of server
            const serverUserCount = new Map();
            this.serverMap.forEach((svr) => {
                if (svr.status === "started") {
                    serverUserCount.set(svr.id, 0);
                }
            });
            this.docRoomMap.forEach((room) => {
                const count = serverUserCount.get(room.serverInstanceId);
                if (count !== undefined) {
                    serverUserCount.set(room.serverInstanceId, count + room.currentUserCount);
                }
            });
            let minUserServerID = null;
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
            const openDocMessage = {
                messageType: ProcessMessage_1.M2C_MessageType.M2C_OpenMessageRequest,
                docID: docID,
            };
            const response = await server.messageActor.request(openDocMessage, 10 * 1000);
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
        const res = {
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
exports.DocServerManagerImp = DocServerManagerImp;
