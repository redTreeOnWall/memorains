"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSecret = void 0;
const utils_1 = require("../utils/utils");
if (process.env.IS_DEV === "true" && !process.env.SECRET) {
    console.warn("[dev] SECRET is not set, a random secret will be generated and all " +
        "existing tokens will become invalid on every restart. Set SECRET in " +
        "your dev environment to keep tokens valid for scripted testing.");
}
const scr = process.env.SECRET || (0, utils_1.genRandomString)();
const getSecret = () => scr;
exports.getSecret = getSecret;
