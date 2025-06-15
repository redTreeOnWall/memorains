"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Application = void 0;
const express_1 = __importDefault(require("express"));
const js_base64_1 = require("js-base64");
const moment_1 = __importDefault(require("moment"));
const url_1 = require("url");
const DataBaseManager_1 = require("./DataBaseManager");
const DocumentManager_1 = require("./DocumentManager");
const WebSocketManager_1 = require("./WebSocketManager");
const uuid_1 = require("uuid");
const uuid = () => {
    return (0, uuid_1.v4)();
};
class Application {
    constructor() {
        this.dataBaseManager = new DataBaseManager_1.DataBaseManager();
        this.documentManager = new DocumentManager_1.DocumentManager(this.dataBaseManager);
    }
    initServer() {
        return new Promise((resolve) => {
            const app = (0, express_1.default)();
            const port = 8000;
            // TODO add midway to check token
            app.get("/doc/server/hello", (_, res) => {
                res.send("Hello World!");
            });
            app.get("/doc/server/create-doc/:userId", async (req, res) => {
                const userId = req.params.userId;
                if (!userId) {
                    return;
                }
                const doc = {
                    id: uuid(),
                    title: "new doc",
                    create_date: (0, moment_1.default)(new Date()).format("YYYY-MM-DD HH:mm:ss"),
                    last_modify_date: (0, moment_1.default)(new Date()).format("YYYY-MM-DD HH:mm:ss"),
                    user_id: userId,
                    state: null,
                };
                const suc = await this.dataBaseManager.createDocument(doc);
                res.send("result: " + suc);
            });
            app.get("/doc/server/docList/:userId", async (req, res) => {
                const userId = req.params.userId;
                if (userId) {
                    const data = await this.dataBaseManager.getAllDoc(userId);
                    res.send(JSON.stringify(data));
                }
            });
            const webSocketManager = new WebSocketManager_1.WebSocketManager();
            app.listen(port, () => {
                console.log(`Example app listening on port ${port}`);
                resolve();
            });
            webSocketManager.webSocketServer.addListener("connection", async (ws, request) => {
                console.log("connect");
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
                const split = pathname.split("/ws/");
                if (!(split.length === 2 && split[0] === "")) {
                    ws.close();
                    return;
                }
                // /ws/:id/:user/
                const docId = split[1].split("/")[0];
                const userId = split[1].split("/")[1];
                const doc = await this.dataBaseManager.getDocument(docId);
                // TODO check doc permission
                if (!doc) {
                    ws.close();
                    return;
                }
                const connectCtx = {
                    userId,
                    docId,
                    updateDocumentOfUser: async (update) => {
                        const mes = {
                            messageType: 1,
                            messageBody: js_base64_1.Base64.fromUint8Array(update),
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
                        webSocketManager.connectors.delete(ws);
                        this.documentManager.userLeaveDocment(docId, connectCtx);
                    },
                    closed: false,
                };
                this.documentManager.userOpenDocument(docId, connectCtx);
                webSocketManager.connectors.set(ws, connectCtx);
                ws.on("error", (e) => {
                    connectCtx.close();
                    console.error(e);
                });
                ws.on("close", () => {
                    connectCtx.close();
                });
                ws.addEventListener("message", (e) => {
                    if (typeof e.data !== "string") {
                        return;
                    }
                    const json = JSON.parse(e.data);
                    const msg = (0, WebSocketManager_1.convertToMessage)(json);
                    if (!msg) {
                        return;
                    }
                    // update
                    if (msg.messageType === 1) {
                        this.documentManager.update(msg.messageBody, connectCtx, docId);
                    }
                });
            });
        });
    }
    async initDB() {
        await this.dataBaseManager.init();
    }
    async start() {
        await this.initDB();
        await this.initServer();
    }
}
exports.Application = Application;
new Application().start();
