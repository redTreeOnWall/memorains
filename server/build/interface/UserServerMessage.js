"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerMessageType = exports.ClientMessageType = void 0;
var ClientMessageType;
(function (ClientMessageType) {
    ClientMessageType[ClientMessageType["updateDoc"] = 10001] = "updateDoc";
    ClientMessageType[ClientMessageType["updateCursor"] = 10002] = "updateCursor";
    ClientMessageType[ClientMessageType["syncVector"] = 10003] = "syncVector";
})(ClientMessageType || (exports.ClientMessageType = ClientMessageType = {}));
var ServerMessageType;
(function (ServerMessageType) {
    ServerMessageType[ServerMessageType["updateDoc"] = 20001] = "updateDoc";
    ServerMessageType[ServerMessageType["docInfo"] = 20002] = "docInfo";
    ServerMessageType[ServerMessageType["userList"] = 20003] = "userList";
    ServerMessageType[ServerMessageType["updateCursor"] = 20004] = "updateCursor";
    ServerMessageType[ServerMessageType["syncVector"] = 20005] = "syncVector";
})(ServerMessageType || (exports.ServerMessageType = ServerMessageType = {}));
