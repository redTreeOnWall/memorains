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
exports.DocumentManager = exports.OnLineDocument = void 0;
const Y = __importStar(require("yjs"));
const utils_1 = require("./utils/utils");
class OnLineDocument {
    constructor(docId, dataBaseManager, documentManager) {
        this.docId = docId;
        this.dataBaseManager = dataBaseManager;
        this.documentManager = documentManager;
        this.doc = null;
        this.connectors = new Set();
        this.saving = false;
        this.timeId = null;
        this.trySaveState = async () => {
            if (this.saving) {
                return;
            }
            if (this.timeId) {
                return;
            }
            this.timeId = setTimeout(async () => {
                this.timeId = null;
                this.saving = true;
                this.save();
                this.saving = false;
            }, 30 * 1000);
        };
        this.closed = false;
    }
    async init() {
        this.doc = new Y.Doc();
        this.doc.on("update", (update, origin) => {
            for (const ctx of this.connectors) {
                if (origin !== ctx) {
                    ctx.updateDocumentOfUser(update);
                }
            }
        });
        const docData = await this.dataBaseManager.getDocument(this.docId, true);
        const data = docData?.state;
        if (data) {
            Y.applyUpdate(this.doc, new Uint8Array(data));
        }
    }
    update(update, connectContext) {
        if (this.doc) {
            Y.applyUpdate(this.doc, update, connectContext);
        }
        this.trySaveState();
    }
    async save() {
        if (this.doc) {
            const state = Y.encodeStateAsUpdate(this.doc);
            await this.dataBaseManager.updateStateOfDocument(this.docId, state);
            (0, utils_1.log)(`saved: id: ${this.docId}, size: ${state.length}`);
        }
    }
    async close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.documentManager.onLineDocumentMap.delete(this.docId);
        await this.save();
        for (const ctx of this.connectors) {
            await ctx.close();
        }
    }
}
exports.OnLineDocument = OnLineDocument;
class DocumentManager {
    constructor(dataBaseManager) {
        this.dataBaseManager = dataBaseManager;
        this.onLineDocumentMap = new Map();
    }
    async userOpenDocument(docId, connectContext) {
        let document = this.onLineDocumentMap.get(docId);
        if (!document) {
            // FIXME
            document = new OnLineDocument(docId, this.dataBaseManager, this);
            await document.init();
            this.onLineDocumentMap.set(docId, document);
        }
        document.connectors.add(connectContext);
        const doc = document.doc;
        if (doc) {
            const initUpdate = Y.encodeStateAsUpdate(doc);
            connectContext.updateDocumentOfUser(initUpdate);
        }
        (0, utils_1.log)(`user in, user count: ${document.connectors.size}   doc count: ${this.onLineDocumentMap.size}`);
        // send state to user
    }
    async userLeaveDocument(docId, ctx) {
        const document = this.onLineDocumentMap.get(docId);
        if (document) {
            document.connectors.delete(ctx);
            if (document.connectors.size == 0) {
                await document.close();
            }
            (0, utils_1.log)(`user left, user count: ${document.connectors.size}   doc count: ${this.onLineDocumentMap.size}`);
        }
    }
    update(update, connectContext, docId) {
        const document = this.onLineDocumentMap.get(docId);
        if (!document) {
            return;
        }
        if (!document.connectors.has(connectContext)) {
            return;
        }
        document.update(update, connectContext);
    }
}
exports.DocumentManager = DocumentManager;
