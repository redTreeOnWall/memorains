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

export class IndexedDB {
  db: IDBDatabase | null = null;
  dbMeta = {
    dbName: "document",
    // add indexes for last_modify_date and create_date
    version: 2,
    stores: [
      {
        // the document entity
        storeName: "document",
        keyPath: "id",
        // indexes: [],
        indexes: ["last_modify_date", "create_date"],
      },
      // {
      //   storeName: "folder",
      //   keyPath: "id",
      //   indexes: ["type", "parent_id"],
      // },
    ],
  } as const;

  open() {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbMeta.dbName, this.dbMeta.version);

      request.onsuccess = () => {
        console.log("success");
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        console.log("error");
        reject();
      };

      request.onblocked = () => {
        console.log("onblocked");
      };

      request.onupgradeneeded = () => {
        console.log("upgrade");
        const db = request.result;

        this.dbMeta.stores.forEach((store) => {
          if (!db.objectStoreNames.contains(store.storeName)) {
            db.createObjectStore(store.storeName, {
              keyPath: store.keyPath,
            });
          }

          for (const store of this.dbMeta.stores) {
            console.log("start index creating");
            const dbStore = request.transaction?.objectStore(store.storeName);

            if (!dbStore) {
              continue;
            }

            store.indexes.forEach((index) => {
              try {
                dbStore.createIndex(index, index);
                console.log(`index: ${index} created`);
              } catch (e) {
                console.warn(e);
              }
            });
          }
        });
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

  async getDocumentList(
    includeState = false,
    indexName?: "last_modify_date" | "create_date",
    indexDirection?: IDBCursorDirection,
    limit?: number,
  ) {
    const db = this.getDB();
    return new Promise<DocumentEntity[]>((resolve, reject) => {
      const storeName = this.dbMeta.stores[0].storeName;
      const transaction = db.transaction(storeName);
      const store = transaction.objectStore(storeName);

      let request: IDBRequest<IDBCursorWithValue | null> | null = null;
      if (indexName) {
        const index = store.index(indexName);
        request = index.openCursor(null, indexDirection);
      } else {
        request = store.openCursor();
      }
      // const request = store.openCursor(key, queryDirection);
      request.onerror = () => {
        reject();
      };

      // TODO use multiple index
      const dataList: DocumentEntity[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(dataList);
          return;
        }

        const data = includeState
          ? cursor.value
          : {
              id: cursor.value.id,
              title: cursor.value.title,
              user_id: cursor.value.user_id,
              create_date: cursor.value.create_date,
              last_modify_date: cursor.value.last_modify_date,
              is_public: cursor.value.is_public,
              commit_id: cursor.value.commit_id,
              doc_type: cursor.value.doc_type ?? 0,
              encrypt_salt: cursor.value.encrypt_salt,
            };
        dataList.push(data as DocumentEntity);
        if (limit === undefined || dataList.length < limit) {
          cursor.continue();
        } else {
          resolve(dataList);
        }
      };
    });
  }

  createOrUpdateDoc(newDoc: DocumentEntity) {
    const db = this.getDB();

    return new Promise<void>((resolve, reject) => {
      const store = db
        .transaction(this.dbMeta.stores[0].storeName, "readwrite")
        .objectStore(this.dbMeta.stores[0].storeName);
      const request = store.put(newDoc);

      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject();
      };
    });
  }

  getDocById(id: string) {
    const db = this.getDB();
    return new Promise<DocumentEntity | undefined>((resolve, reject) => {
      const store = db
        .transaction(this.dbMeta.stores[0].storeName)
        .objectStore(this.dbMeta.stores[0].storeName);
      const request = store.get(id);

      request.onerror = () => {
        reject();
      };

      request.onsuccess = () => {
        const res = request.result;
        resolve(res);
      };
    });
  }

  async updateId(oldId: string, newId: string) {
    const db = this.getDB();
    const storeName = this.dbMeta.stores[0].storeName;
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const oldDataRequest = store.get(oldId);
    await sucErrPromise(oldDataRequest);
    const oldData = oldDataRequest.result as DocumentEntity | null;
    if (!oldData) {
      throw new Error("Old data not exit.");
    }

    const newData = { ...oldData, id: newId };
    const addReq = store.put(newData);
    await sucErrPromise(addReq);
    const deleteReq = store.delete(oldId);
    await sucErrPromise(deleteReq);
  }

  async deleteDoc(id: string) {
    const db = this.getDB();
    const storeName = this.dbMeta.stores[0].storeName;
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const deleteReq = store.delete(id);
    await sucErrPromise(deleteReq);
  }

  async getLastOpenedDoc(): Promise<DocumentEntity | undefined> {
    const list = await this.getDocumentList(
      false,
      "last_modify_date",
      "prev",
      1,
    );
    return list[0] ?? undefined;
  }
}
