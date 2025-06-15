"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketManager = exports.convertToMessage = void 0;
const js_base64_1 = require("js-base64");
const ws_1 = require("ws");
const convertToMessage = (message) => {
    if (message.messageType !== undefined && message.messageBody !== undefined) {
        return {
            messageType: message.messageType,
            messageBody: js_base64_1.Base64.toUint8Array(message.messageBody),
        };
    }
    return null;
};
exports.convertToMessage = convertToMessage;
class WebSocketManager {
    constructor() {
        this.webSocketServer = new ws_1.WebSocketServer({ port: 8080 });
        this.connectors = new Map();
    }
    async init() { }
}
exports.WebSocketManager = WebSocketManager;
