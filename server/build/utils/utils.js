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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = exports.toMysqlDate = exports.randomInt = exports.isBoolean = exports.isNumber = exports.isString = exports.getSaltedPassword = exports.genRandomString = exports.awaitTime = exports.uuid = void 0;
const uuid_1 = require("uuid");
const crypto = __importStar(require("crypto"));
const moment_1 = __importDefault(require("moment"));
const uuid = () => {
    return (0, uuid_1.v4)();
};
exports.uuid = uuid;
const awaitTime = (millSeconds) => new Promise((resolve) => {
    setTimeout(resolve, millSeconds);
});
exports.awaitTime = awaitTime;
const genRandomString = () => {
    const randomBytes = crypto.getRandomValues(new Uint8Array(100));
    const base64 = Buffer.from(randomBytes).toString("base64").slice(0, 100);
    return `lrl_doc_${base64}`.slice(0, 120);
};
exports.genRandomString = genRandomString;
const getSaltedPassword = (originPassword, salt) => {
    const passHash = crypto
        .createHash("sha256")
        .update(originPassword)
        .update(crypto.createHash("sha256").update(salt, "utf8").digest("hex"))
        .digest("hex");
    return passHash;
};
exports.getSaltedPassword = getSaltedPassword;
const isString = (str) => !!str && typeof str === "string";
exports.isString = isString;
const isNumber = (num) => typeof num === "number" && !isNaN(num);
exports.isNumber = isNumber;
const isBoolean = (bool) => typeof bool === "boolean";
exports.isBoolean = isBoolean;
const randomInt = () => Math.floor(Math.random() * 0x2fffffff);
exports.randomInt = randomInt;
const toMysqlDate = (date) => (0, moment_1.default)(date).format("YYYY-MM-DD HH:mm:ss");
exports.toMysqlDate = toMysqlDate;
const log = (logText) => {
    const date = new Date();
    console.log(`[${date.toLocaleString()}.${date.getMilliseconds()}] ${logText}`);
};
exports.log = log;
