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
exports.asyncVerify = exports.asyncSign = void 0;
const jwt = __importStar(require("jsonwebtoken"));
const secret_1 = require("../security/secret");
const asyncSign = (payload, expiresIn = "7d") => new Promise((resolve, reject) => {
    jwt.sign(payload, (0, secret_1.getSecret)(), { algorithm: "HS256", expiresIn }, (error, encoded) => {
        if (error || encoded === undefined) {
            reject();
        }
        else {
            resolve(encoded);
        }
    });
});
exports.asyncSign = asyncSign;
const asyncVerify = (token) => new Promise((resolve, reject) => {
    jwt.verify(token, (0, secret_1.getSecret)(), (error, decoded) => {
        if (error || typeof decoded !== "object") {
            reject(error ?? new Error("Payload is not a object!"));
        }
        else {
            resolve(decoded);
        }
    });
});
exports.asyncVerify = asyncVerify;
