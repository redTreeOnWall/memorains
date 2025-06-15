"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicationImp = void 0;
const DocServerManagerImp_1 = require("./DocServerManagerImp");
const UserServerImp_1 = require("./UserServerImp");
class ApplicationImp {
    constructor() {
        this.docServerManager = new DocServerManagerImp_1.DocServerManagerImp(this);
        this.userServer = new UserServerImp_1.UserServerImp(this);
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO
            yield this.docServerManager.init();
            yield this.userServer.init();
            console.log("app initd!");
        });
    }
}
exports.ApplicationImp = ApplicationImp;
