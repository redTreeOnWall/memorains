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
exports.DocServerImp = exports.OnLineDocument = void 0;
const Y = __importStar(require("yjs"));
const js_base64_1 = require("js-base64");
const url_1 = require("url");
const ws_1 = require("ws");
const ProcessMessage_1 = require("../interface/ProcessMessage");
const DataBaseManagerImp_1 = require("./DataBaseManagerImp");
const UserServerMessage_1 = require("../interface/UserServerMessage");
const messageUtils_1 = require("../utils/messageUtils");
const utils_1 = require("../utils/utils");
const jwtUtils_1 = require("../utils/jwtUtils");
class OnLineDocument {
    constructor(docId, documentServer) {
        this.docId = docId;
        this.documentServer = documentServer;
        this.doc = null;
        this.lastCommitId = (0, utils_1.randomInt)();
        this.connectors = new Set();
        this.documentEntity = null;
        this.saving = false;
        this.goingToSaveData = false;
        this.trySaveState = async () => {
            if (this.goingToSaveData) {
                return;
            }
            this.goingToSaveData = true;
            // TODO dynamic
            await (0, utils_1.awaitTime)(30 * 1000);
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
        this.closed = false;
        this.password = (0, utils_1.uuid)();
    }
    async init() {
        const docData = await this.documentServer.database.getDocument(this.docId, true);
        if (!docData) {
            return false;
        }
        this.doc = new Y.Doc();
        const data = docData?.state;
        if (data) {
            Y.applyUpdate(this.doc, new Uint8Array(data));
            this.lastCommitId = docData.commit_id;
        }
        this.doc.on("update", (update, origin) => {
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
    update(update, commitId, connectContext) {
        if (this.doc) {
            Y.applyUpdate(this.doc, update, connectContext);
            this.lastCommitId = commitId;
        }
        this.trySaveState();
    }
    async save() {
        if (this.doc) {
            const state = Y.encodeStateAsUpdate(this.doc);
            const success = await this.documentServer.database.updateStateOfDocument(this.docId, state, this.lastCommitId);
            if (success) {
                (0, utils_1.log)(`saved, commitId: ${this.lastCommitId}, size:${state.length}`);
            }
            else {
                this.close();
            }
        }
    }
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
exports.OnLineDocument = OnLineDocument;
class DocServerImp {
    constructor(id, host, port) {
        this.id = id;
        this.host = host;
        this.port = port;
        this.connectors = new Set();
        this.database = new DataBaseManagerImp_1.DataBaseManagerImp();
        this.rooms = new Map();
        this.closed = false;
        this.ws = new ws_1.WebSocketServer({ port });
        this.processMessageActor = new messageUtils_1.MessageActor((msg) => {
            process.send?.(msg);
        });
    }
    async init() {
        // TODO
        this.database.init();
        await this.listenWs();
        await this.listenProcess();
        process.on("message", (message) => {
            const msg = message;
            this.processMessageActor.receiveMessage(msg);
        });
        const startedMes = {
            messageType: ProcessMessage_1.C2M_MessageType.serverStarted,
        };
        this.processMessageActor.request(startedMes, 0);
        // this.startTick();
        (0, utils_1.log)(`server instance ${this.port} started`);
    }
    async openDoc(docId) {
        let document = this.rooms.get(docId);
        if (!document) {
            document = new OnLineDocument(docId, this);
            const success = await document.init();
            if (success) {
                this.rooms.set(docId, document);
            }
            else {
                return null;
            }
        }
        return document;
    }
    async closeDoc(docId) {
        const document = this.rooms.get(docId);
        if (document) {
            this.rooms.set(docId, document);
            await document.close();
        }
    }
    async listenProcess() {
        this.processMessageActor.addMessageListener(async (msg) => {
            if (msg.messageType === ProcessMessage_1.M2C_MessageType.M2C_OpenMessageRequest) {
                const doc = await this.openDoc(msg.docID);
                const responseMessage = {
                    messageType: ProcessMessage_1.C2M_MessageType.C2M_OpenMessageResponse,
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
            }
            else if (msg.messageType === ProcessMessage_1.M2C_MessageType.closeDoc) {
                await this.closeDoc(msg.docID);
                if (msg.messageID) {
                    const closeRes = {
                        messageType: ProcessMessage_1.C2M_MessageType.C2M_CloseMessageResponse,
                        success: true,
                    };
                    this.processMessageActor.response(closeRes, msg.messageID);
                }
            }
        });
    }
    async listenWs() {
        this.ws.addListener("connection", async (ws, request) => {
            const url = request.url;
            if (!url) {
                ws.close();
                return;
            }
            const { pathname } = (0, url_1.parse)(url);
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
            let userId = null;
            let docId = null;
            try {
                const token = (await (0, jwtUtils_1.asyncVerify)(tokenString));
                // TODO public documents;
                // const room = docId ? this.rooms.get(docId) : null;
                // room?.documentEntity?.is_public // if true, no need user name
                if (token.userId && token.docId) {
                    docId = token.docId;
                    userId = token.userId;
                    tokenVerified = true;
                }
            }
            catch (e) {
                tokenVerified = false;
            }
            const room = docId ? this.rooms.get(docId) : null;
            if (!tokenVerified ||
                !docId ||
                !userId ||
                !room ||
                room.password !== password) {
                ws.close();
                return;
            }
            const documentId = docId;
            const connectCtx = {
                userId,
                docId,
                userSessionId: (0, utils_1.uuid)(),
                sendMessage: async (message) => {
                    ws.send(JSON.stringify(message));
                    return true;
                },
                sendDocInfoToClient: async (docInfo) => {
                    ws.send(JSON.stringify(docInfo));
                    return true;
                },
                updateUserList: async () => {
                    const userListMes = {
                        messageType: UserServerMessage_1.ServerMessageType.userList,
                        data: {
                            userList: Array.from(this.rooms.get(documentId)?.connectors.values() ?? []).map((u) => ({
                                userId: u.userId,
                                userSessionId: u.userSessionId,
                            })),
                        },
                    };
                    ws.send(JSON.stringify(userListMes));
                    return true;
                },
                updateDocumentOfUser: async (update, commitId, origin) => {
                    const mes = {
                        messageType: UserServerMessage_1.ServerMessageType.updateDoc,
                        data: js_base64_1.Base64.fromUint8Array(update),
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
                    }
                    catch (e) {
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
                messageType: UserServerMessage_1.ServerMessageType.docInfo,
                data: {
                    docInfo: documentEntity,
                },
            });
            ws.addEventListener("message", (e) => {
                try {
                    if (typeof e.data !== "string") {
                        return;
                    }
                    const msg = JSON.parse(e.data);
                    if (!msg?.messageType) {
                        return;
                    }
                    // update
                    if (msg.messageType === UserServerMessage_1.ClientMessageType.updateDoc) {
                        const state = js_base64_1.Base64.toUint8Array(msg.messageBody);
                        this.update(state, msg.commitId, connectCtx, documentId);
                    }
                    else if (msg.messageType === UserServerMessage_1.ClientMessageType.syncVector) {
                        const doc = this.rooms.get(connectCtx.docId);
                        if (doc?.doc) {
                            const serverVector = Y.encodeStateVector(doc.doc);
                            const syncMes = {
                                messageType: UserServerMessage_1.ServerMessageType.syncVector,
                                data: js_base64_1.Base64.fromUint8Array(serverVector),
                            };
                            connectCtx.sendMessage(syncMes);
                            const clientVector = js_base64_1.Base64.toUint8Array(msg.messageBody);
                            const diff = Y.encodeStateAsUpdate(doc.doc, clientVector);
                            connectCtx.updateDocumentOfUser(diff, doc.lastCommitId, "sync");
                        }
                    }
                    else if (msg.messageType === UserServerMessage_1.ClientMessageType.updateCursor) {
                        this.rooms.get(documentId)?.connectors.forEach((u) => {
                            if (u.userSessionId === connectCtx.userSessionId) {
                                return;
                            }
                            const cursorMes = {
                                messageType: UserServerMessage_1.ServerMessageType.updateCursor,
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
                }
                catch (e) {
                    console.error(e);
                }
            });
        });
    }
    async userJoinDocumentRoom(docId, connectContext) {
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
        (0, utils_1.log)(`user ${connectContext.userId} join in doc ${docId}, user count: ${document.connectors.size}   doc count: ${this.rooms.size}`);
        document.connectors.forEach((c) => {
            c.updateUserList();
        });
        return true;
        // send state to user
    }
    async userLeaveDocument(docId, ctx) {
        const document = this.rooms.get(docId);
        if (document) {
            document.connectors.delete(ctx);
            this.syncRoomInfo(document);
            (0, utils_1.log)(`user ${ctx.userId} left doc ${docId}, user count: ${document.connectors.size}   doc count: ${this.rooms.size}`);
            document.connectors.forEach((c) => {
                c.updateUserList();
            });
        }
    }
    update(update, commitId, connectContext, docId) {
        const document = this.rooms.get(docId);
        if (!document) {
            return;
        }
        if (!document.connectors.has(connectContext)) {
            return;
        }
        document.update(update, commitId, connectContext);
    }
    async syncRoomInfo(room) {
        const mes = {
            messageType: ProcessMessage_1.C2M_MessageType.updateRoomStatus,
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
    async startTick() {
        await (0, utils_1.awaitTime)((this.port % 100) * 5 * 1000);
        while (!this.closed) {
            await (0, utils_1.awaitTime)(10 * 60 * 1000);
            await this.tickUpdate();
        }
    }
    async tickUpdate() {
        for (const [_, room] of this.rooms) {
            if (room.connectors.size == 0) {
                await this.syncRoomInfo(room);
            }
        }
    }
}
exports.DocServerImp = DocServerImp;
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
