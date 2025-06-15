"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const DocApplicationImp_1 = require("./imp/DocApplicationImp");
const DocServerManagerImp_1 = require("./imp/DocServerManagerImp");
const docServerManager = new DocServerManagerImp_1.DocServerManagerImp(new DocApplicationImp_1.DocApplicationImp());
docServerManager.init();
