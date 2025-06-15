"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.M2C_MessageType = exports.C2M_MessageType = void 0;
var C2M_MessageType;
(function (C2M_MessageType) {
    C2M_MessageType[C2M_MessageType["serverStarted"] = 1] = "serverStarted";
    C2M_MessageType[C2M_MessageType["updateRoomStatus"] = 2] = "updateRoomStatus";
    C2M_MessageType[C2M_MessageType["C2M_OpenMessageResponse"] = 3] = "C2M_OpenMessageResponse";
    C2M_MessageType[C2M_MessageType["C2M_CloseMessageResponse"] = 4] = "C2M_CloseMessageResponse";
})(C2M_MessageType || (exports.C2M_MessageType = C2M_MessageType = {}));
var M2C_MessageType;
(function (M2C_MessageType) {
    M2C_MessageType[M2C_MessageType["M2C_OpenMessageRequest"] = 1] = "M2C_OpenMessageRequest";
    M2C_MessageType[M2C_MessageType["closeDoc"] = 2] = "closeDoc";
})(M2C_MessageType || (exports.M2C_MessageType = M2C_MessageType = {}));
