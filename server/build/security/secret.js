"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSecret = void 0;
const utils_1 = require("../utils/utils");
const scr = process.env.SECRET || (0, utils_1.genRandomString)();
const getSecret = () => scr;
exports.getSecret = getSecret;
