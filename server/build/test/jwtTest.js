"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testJwt = void 0;
const jwtUtils_1 = require("../utils/jwtUtils");
const utils_1 = require("../utils/utils");
const testJwt = async () => {
    const token = await (0, jwtUtils_1.asyncSign)({ name: "test", role: "admin", index: 29 }, 5);
    console.log(`token: ${token}`);
    await (0, utils_1.awaitTime)(4 * 1000);
    const payload = await (0, jwtUtils_1.asyncVerify)(token);
    console.log("payload:", payload);
};
exports.testJwt = testJwt;
