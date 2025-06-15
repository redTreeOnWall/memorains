"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocApplicationImp = void 0;
const utils_1 = require("../utils/utils");
const DocServerManagerImp_1 = require("./DocServerManagerImp");
const UserServerImp_1 = require("./UserServerImp");
class DocApplicationImp {
    constructor() {
        this.docServerManager = new DocServerManagerImp_1.DocServerManagerImp(this);
        this.userServer = new UserServerImp_1.UserServerImp(this);
    }
    async init() {
        // TODO
        (0, utils_1.log)("app start init");
        await this.userServer.init();
        await this.docServerManager.init();
        (0, utils_1.log)("app initd!");
    }
}
exports.DocApplicationImp = DocApplicationImp;
