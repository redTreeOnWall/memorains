import * as Y from "yjs";
import { DocumentEntity } from "../interface/DataEntity";

const sucErrPromise = <SUC, ERR>(request: {
  onsuccess: ((params: SUC) => void) | null;
  onerror: ((params: ERR) => void) | null;
}) =>
  new Promise<SUC>((resolve, reject) => {
    request.onsuccess = (params) => {
      resolve(params);
    };
    request.onerror = (params) => {
      reject(params);
    };
  });

export interface DocumentFolder {
  id: string;
  parent_id: string | null;
  type: "document" | "folder";
}

interface StoreMeta {
  storeName: string;
  keyPath: string;
  /** Index name, which is also the indexed property. */
  indexes: string[];
}

/** One appended Yjs update that is not part of a snapshot yet. */
export interface DocUpdateRow {
  /** `${docId}:${writerId}:${seq}`, so writers never collide on a key. */
  key: string;
  doc_id: string;
  writer_id: string;
  seq: number;
  update: ArrayBuffer;
}

export class IndexedDB {
  db: IDBDatabase | null = null;
  dbMeta: { dbName: string; version: number; stores: StoreMeta[] } = {
    dbName: "document",
    version: 3,
    stores: [
      {
        // the document entity
        storeName: "document",
        keyPath: "id",
        indexes: ["last_modify_date", "create_date"],
      },
      {
        // append-only updates that have not been folded into a snapshot yet
        storeName: "doc_update",
        keyPath: "key",
        indexes: ["doc_id"],
      },
    ],
  };

  /**
   * Called when another tab holds a connection at the current version, so the
   * upgrade is waiting for it to close. The pending `open()` request stays alive
   * and completes on its own once every other tab is gone, so the caller only
   * needs to tell the user what is happening.
   */
  onUpgradeBlocked: (() => void) | null = null;

  /**
   * Called after this connection yields to another tab's upgrade.
   *
   * The connection is gone at that point and every later operation throws, which
   * callers swallow as a failed save. Leaving the tab running would mean writing
   * into the void while the user keeps typing, so this is reported for the same
   * reason a blocked upgrade is.
   */
  onClosed: (() => void) | null = null;

  open() {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbMeta.dbName, this.dbMeta.version);

      request.onsuccess = () => {
        const db = request.result;
        this.db = db;
        // Yielding is required: without it every other tab blocks the next schema
        // upgrade until it is closed by hand, which shows up as an app stuck on
        // the loading screen.
        db.onversionchange = () => {
          db.close();
          this.db = null;
          this.onClosed?.();
        };
        db.onclose = () => {
          this.db = null;
          this.onClosed?.();
        };
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };

      request.onblocked = () => {
        this.onUpgradeBlocked?.();
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        const transaction = request.transaction;

        if (!transaction) {
          throw new Error("Upgrade transaction is missing.");
        }

        for (const store of this.dbMeta.stores) {
          // An existing store must be opened through the upgrade transaction;
          // looking it up on the database throws during onupgradeneeded.
          const dbStore = db.objectStoreNames.contains(store.storeName)
            ? transaction.objectStore(store.storeName)
            : db.createObjectStore(store.storeName, { keyPath: store.keyPath });

          for (const index of store.indexes) {
            // Indexes are backfilled on existing stores so a database left in an
            // older shape is repaired on open rather than failing later when a
            // query uses the missing index.
            if (!dbStore.indexNames.contains(index)) {
              dbStore.createIndex(index, index);
            }
          }
        }
      };
    });
  }

  private getDB() {
    const db = this.db;
    if (!db) {
      throw new Error("DB not ready!");
    }
    return db;
  }

  /** Looked up by name rather than by position, so reordering `dbMeta.stores` is safe. */
  private get documentStoreName() {
    const store = this.dbMeta.stores.find((s) => s.storeName === "document");
    if (!store) {
      throw new Error("The document store is missing from dbMeta.");
    }
    return store.storeName;
  }

  private get updateStoreName() {
    const store = this.dbMeta.stores.find((s) => s.storeName === "doc_update");
    if (!store) {
      throw new Error("The doc_update store is missing from dbMeta.");
    }
    return store.storeName;
  }

  /** Read the pending updates of one document, oldest first. */
  private readUpdates(
    transaction: IDBTransaction,
    docId: string,
  ): Promise<DocUpdateRow[]> {
    const index = transaction.objectStore(this.updateStoreName).index("doc_id");
    return new Promise((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.only(docId));
      const rows: DocUpdateRow[] = [];
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          // Keys sort by writer id before seq, so a key-ordered read is not in
          // seq order. Yjs merges are order independent, so this is only for
          // readability of the returned array.
          rows.sort((a, b) => a.seq - b.seq);
          resolve(rows);
          return;
        }
        rows.push(cursor.value as DocUpdateRow);
        cursor.continue();
      };
    });
  }

  /**
   * Fold pending updates into `state`, store the result, and drop the rows that
   * were folded in.
   *
   * All of it in one transaction, and the stored snapshot is re-read here rather
   * than trusted from the caller. Each point is load-bearing:
   *
   * - Same transaction, so a crash cannot leave the snapshot updated with the
   *   rows still present (they would be applied twice) or gone (they would be
   *   lost). It is also what lets the rows themselves record what is unfolded.
   * - Rows re-read, so updates appended after the caller last looked are folded
   *   in rather than dropped.
   * - Snapshot re-read, because a caller's `newState` comes from its own memory
   *   and may predate what is on disk; writing it alone would discard another
   *   tab's already-folded edits.
   *
   * Encrypted documents cannot be merged without a key, so they are written as
   * given and keep no rows.
   */
  private async commitState(
    doc: DocumentEntity,
    newState: ArrayBuffer | null,
  ): Promise<void> {
    const db = this.getDB();
    const transaction = db.transaction(
      [this.documentStoreName, this.updateStoreName],
      "readwrite",
    );

    try {
      const stored = await new Promise<DocumentEntity | undefined>(
        (resolve, reject) => {
          const request = transaction
            .objectStore(this.documentStoreName)
            .get(doc.id);
          request.onerror = () => reject(request.error);
          request.onsuccess = () =>
            resolve(request.result as DocumentEntity | undefined);
        },
      );

      const rows = await this.readUpdates(transaction, doc.id);
      const foldable = doc.encrypt_salt ? [] : rows;

      const state = doc.encrypt_salt
        ? newState
        : this.foldStates([
            stored?.state,
            ...foldable.map((row) => row.update),
            newState,
          ]);

      await new Promise<void>((resolve, reject) => {
        const request = transaction
          .objectStore(this.documentStoreName)
          .put({ ...doc, state });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });

      for (const row of foldable) {
        await new Promise<void>((resolve, reject) => {
          const request = transaction
            .objectStore(this.updateStoreName)
            .delete(row.key);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve();
        });
      }

      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } catch (error) {
      transaction.abort();
      throw error;
    }
  }

  /**
   * Merge Yjs states into one.
   *
   * Decoding and re-encoding, not `Y.mergeUpdates`, because only applying to a
   * `gc: true` document reclaims deleted content. Merging the update format keeps
   * every tombstone, so a note that had an image or a long passage removed would
   * carry those bytes forever. It is not even faster.
   */
  /**
   * Merge Yjs states into one, decoding and re-encoding so that deleted content
   * is reclaimed rather than retained. See `commitState` for why that matters.
   */
  private foldStates(
    parts: (ArrayBuffer | null | undefined)[],
  ): ArrayBuffer | null {
    const usable = parts.filter(
      (part): part is ArrayBuffer => (part?.byteLength ?? 0) > 0,
    );
    if (!usable.length) {
      return null;
    }
    if (usable.length === 1) {
      return usable[0];
    }

    const yDoc = new Y.Doc({ gc: true });
    try {
      for (const part of usable) {
        Y.applyUpdate(yDoc, new Uint8Array(part));
      }
      return Y.encodeStateAsUpdate(yDoc).buffer as ArrayBuffer;
    } finally {
      yDoc.destroy();
    }
  }

  /**
   * Append one update. Cheap on purpose: this is the per-keystroke write path.
   */
  async appendDocUpdate(
    docId: string,
    writerId: string,
    seq: number,
    update: ArrayBuffer,
  ): Promise<void> {
    const db = this.getDB();
    const row: DocUpdateRow = {
      key: `${docId}:${writerId}:${seq}`,
      doc_id: docId,
      writer_id: writerId,
      seq,
      update,
    };
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.updateStoreName, "readwrite");
      const request = transaction.objectStore(this.updateStoreName).put(row);
      request.onerror = () => reject(request.error);
      // Resolved on commit, not on the request: a transaction can still abort
      // after the request succeeds, and a caller told the write landed would then
      // drop its own copy of an edit that was never stored.
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  /**
   * The updates not yet folded into the snapshot, oldest first. Folding deletes
   * the rows it folds, so the rows that exist are exactly the ones still pending.
   */
  async getDocUpdates(docId: string): Promise<DocUpdateRow[]> {
    const db = this.getDB();
    return this.readUpdates(db.transaction(this.updateStoreName), docId);
  }

  /**
   * Fold pending updates into the snapshot and drop them.
   *
   * `meta` rides along because folding rewrites the whole row anyway, so the
   * caller can refresh its timestamps at no extra cost. Doing that separately
   * would mean a second full write of the document body.
   *
   * `commitState` reads, folds and deletes in one transaction, so there is
   * nothing here that another tab could interleave with.
   */
  async compactDoc(
    docId: string,
    meta?: { last_modify_date?: string; commit_id?: number },
  ): Promise<DocumentEntity | undefined> {
    const doc = await this.getRawDoc(docId);
    if (!doc) {
      return undefined;
    }
    await this.commitState({ ...doc, ...meta }, doc.state);
    return this.getRawDoc(docId);
  }

  /** Read a document exactly as stored, with `state` untouched by any updates. */
  async getRawDoc(id: string): Promise<DocumentEntity | undefined> {
    const db = this.getDB();
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(this.documentStoreName)
        .objectStore(this.documentStoreName)
        .get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () =>
        resolve(request.result as DocumentEntity | undefined);
    });
  }

  /**
   * List documents, optionally with their content.
   *
   * With `includeState`, pending updates are folded in. Without it, a caller
   * reading `state` would get a snapshot that lags behind the log by up to one
   * fold interval, which is how an export ends up missing recent edits.
   */
  async getDocumentList(
    includeState = false,
    indexName?: "last_modify_date" | "create_date",
    indexDirection?: IDBCursorDirection,
    limit?: number,
  ) {
    const db = this.getDB();
    const rows = await new Promise<DocumentEntity[]>((resolve, reject) => {
      const storeName = this.documentStoreName;
      const transaction = db.transaction(storeName);
      const store = transaction.objectStore(storeName);

      let request: IDBRequest<IDBCursorWithValue | null> | null = null;
      if (indexName) {
        const index = store.index(indexName);
        request = index.openCursor(null, indexDirection);
      } else {
        request = store.openCursor();
      }
      request.onerror = () => {
        reject(request.error);
      };

      // TODO use multiple index
      const dataList: DocumentEntity[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(dataList);
          return;
        }

        const value = cursor.value as DocumentEntity;
        if (includeState) {
          dataList.push(value);
        } else {
          dataList.push({
            id: value.id,
            title: value.title,
            user_id: value.user_id,
            create_date: value.create_date,
            last_modify_date: value.last_modify_date,
            is_public: value.is_public,
            commit_id: value.commit_id,
            doc_type: value.doc_type ?? 0,
            encrypt_salt: value.encrypt_salt,
          } as DocumentEntity);
        }
        if (limit === undefined || dataList.length < limit) {
          cursor.continue();
        } else {
          resolve(dataList);
        }
      };
    });

    if (!includeState) {
      return rows;
    }
    // Each one read through the folding accessor, so the caller sees content
    // rather than a snapshot that the log has already moved past.
    const folded = await Promise.all(
      rows.map((row) => this.getDocById(row.id)),
    );
    return folded.filter((row): row is DocumentEntity => row !== undefined);
  }

  /**
   * Write a document's content, merging in whatever is pending or already stored.
   * That merge is why a stale `state` from `getDocById` is safe to pass.
   */
  async createOrUpdateDoc(newDoc: DocumentEntity): Promise<void> {
    await this.commitState(newDoc, newDoc.state);
  }

  /**
   * Change a document's fields without touching its content, for a rename and
   * the like. Read and write in one transaction, so a concurrent fold cannot be
   * overwritten by the snapshot this caller read.
   */
  async updateDocMeta(newDoc: DocumentEntity): Promise<void> {
    const db = this.getDB();
    const transaction = db.transaction(this.documentStoreName, "readwrite");
    const store = transaction.objectStore(this.documentStoreName);

    const existing = await new Promise<DocumentEntity | undefined>(
      (resolve, reject) => {
        const request = store.get(newDoc.id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () =>
          resolve(request.result as DocumentEntity | undefined);
      },
    );
    if (!existing) {
      throw new Error(
        `Document ${newDoc.id} is missing; a metadata write requires it to exist.`,
      );
    }

    store.put({ ...newDoc, state: existing.state });

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  /**
   * Read a document and its pending updates in one transaction. Separately, a
   * fold landing in between would give the old snapshot and no rows, silently
   * losing whatever it had just folded in.
   */
  async readDocAndUpdates(
    id: string,
  ): Promise<{ doc: DocumentEntity | undefined; rows: DocUpdateRow[] }> {
    const db = this.getDB();
    const transaction = db.transaction(
      [this.documentStoreName, this.updateStoreName],
      "readonly",
    );

    const doc = await new Promise<DocumentEntity | undefined>(
      (resolve, reject) => {
        const request = transaction.objectStore(this.documentStoreName).get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () =>
          resolve(request.result as DocumentEntity | undefined);
      },
    );

    const rows = await this.readUpdates(transaction, id);
    return { doc, rows };
  }

  /**
   * Read a document with pending updates already folded into `state`, so callers
   * see the newest content without knowing the updates exist.
   */
  async getDocById(id: string): Promise<DocumentEntity | undefined> {
    const { doc, rows } = await this.readDocAndUpdates(id);
    if (!doc || doc.encrypt_salt || !rows.length) {
      return doc;
    }
    return {
      ...doc,
      state: this.foldStates([doc.state, ...rows.map((row) => row.update)]),
    };
  }

  async updateId(oldId: string, newId: string) {
    const db = this.getDB();
    // Both stores, so the updates move with the document. Leaving them behind
    // would strand them under a document id that no longer exists.
    const transaction = db.transaction(
      [this.documentStoreName, this.updateStoreName],
      "readwrite",
    );
    const store = transaction.objectStore(this.documentStoreName);
    const oldDataRequest = store.get(oldId);
    await sucErrPromise(oldDataRequest);
    const oldData = oldDataRequest.result as DocumentEntity | null;
    if (!oldData) {
      throw new Error("Old data not exit.");
    }

    const rows = await this.readUpdates(transaction, oldId);

    const newData = { ...oldData, id: newId };
    const addReq = store.put(newData);
    await sucErrPromise(addReq);
    const deleteReq = store.delete(oldId);
    await sucErrPromise(deleteReq);

    const updateStore = transaction.objectStore(this.updateStoreName);
    for (const row of rows) {
      const moved: DocUpdateRow = {
        ...row,
        key: `${newId}:${row.writer_id}:${row.seq}`,
        doc_id: newId,
      };
      await sucErrPromise(updateStore.put(moved));
      await sucErrPromise(updateStore.delete(row.key));
    }

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async deleteDoc(id: string) {
    const db = this.getDB();
    const transaction = db.transaction(
      [this.documentStoreName, this.updateStoreName],
      "readwrite",
    );

    // Keys are collected before deleting rather than deleting while iterating:
    // mutating a store mid-cursor is subtle, and this list is tiny either way.
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = transaction
        .objectStore(this.updateStoreName)
        .index("doc_id")
        .getAllKeys(IDBKeyRange.only(id));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const updateStore = transaction.objectStore(this.updateStoreName);
    for (const key of keys) {
      await sucErrPromise(updateStore.delete(key));
    }

    const deleteReq = transaction
      .objectStore(this.documentStoreName)
      .delete(id);
    await sucErrPromise(deleteReq);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async getLastOpenedDoc(): Promise<DocumentEntity | undefined> {
    const allDocs = await this.getDocumentList(
      false,
      "last_modify_date",
      "prev",
      1,
    );

    for (const doc of allDocs) {
      if (!doc.encrypt_salt) {
        return doc;
      }
    }

    return undefined;
  }
}
