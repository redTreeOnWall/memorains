import * as Y from "yjs";
import { DataBaseManager } from "./DataBaseManager";
import { log } from "./utils/utils";

export interface ConnectContext {
  userId: string;
  docId: string;
  updateDocumentOfUser: (update: Uint8Array) => Promise<boolean>;
  close: () => Promise<void>;
  closed: boolean;
}

export class OnLineDocument {
  doc: Y.Doc | null = null;
  connectors = new Set<ConnectContext>();
  constructor(
    public docId: string,
    public dataBaseManager: DataBaseManager,
    public documentManager: DocumentManager
  ) {}
  async init() {
    this.doc = new Y.Doc();

    this.doc.on("update", (update: Uint8Array, origin: any) => {
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

  update(update: Uint8Array, connectContext: ConnectContext) {
    if (this.doc) {
      Y.applyUpdate(this.doc, update, connectContext);
    }

    this.trySaveState();
  }

  saving = false;
  timeId: NodeJS.Timeout | null = null;
  private trySaveState = async () => {
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

  private async save() {
    if (this.doc) {
      const state = Y.encodeStateAsUpdate(this.doc);
      await this.dataBaseManager.updateStateOfDocument(this.docId, state);
      log(`saved: id: ${this.docId}, size: ${state.length}`);
    }
  }

  closed = false;
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

export class DocumentManager {
  constructor(public dataBaseManager: DataBaseManager) {}
  onLineDocumentMap: Map<string, OnLineDocument> = new Map();

  async userOpenDocument(docId: string, connectContext: ConnectContext) {
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

    log(
      `user in, user count: ${document.connectors.size}   doc count: ${this.onLineDocumentMap.size}`
    );

    // send state to user
  }

  async userLeaveDocument(docId: string, ctx: ConnectContext) {
    const document = this.onLineDocumentMap.get(docId);
    if (document) {
      document.connectors.delete(ctx);
      if (document.connectors.size == 0) {
        await document.close();
      }
      log(
        `user left, user count: ${document.connectors.size}   doc count: ${this.onLineDocumentMap.size}`
      );
    }
  }

  update(update: Uint8Array, connectContext: ConnectContext, docId: string) {
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
