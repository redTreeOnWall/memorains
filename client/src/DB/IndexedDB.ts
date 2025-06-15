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
    version: 1,
    stores: [
      {
        // the document entity
        storeName: "document",
        keyPath: "id",
        indexes: [],
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
      const request = indexedDB.open(this.dbMeta.dbName);

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => {
        reject();
      };

      request.onupgradeneeded = () => {
        const db = request.result;

        this.dbMeta.stores.forEach((store) => {
          if (!db.objectStoreNames.contains(store.storeName)) {
            // TODO try catch
            const dbStore = db.createObjectStore(store.storeName, {
              keyPath: store.keyPath,
            });
            store.indexes.forEach((index) => {
              try {
                dbStore.createIndex(index, index);
              } catch (e) {
                console.warn(e);
              }
            });
          }
        });

        // TODO create new version index

        // const ps: Promise<void>[] = [];
        // this.structure.stores.forEach((store) => {
        //   const transaction = db.transaction(store.storeName, "readwrite");
        //   const dbStore = transaction.objectStore(store.storeName);

        //   store.indexes.forEach((index) => {
        //     try {
        //       dbStore.createIndex(index, index);
        //     } catch (e) {
        //       console.warn(e);
        //     }
        //   });

        //   transaction.commit();

        //   ps.push(
        //     new Promise<void>((resolve) => {
        //       transaction.oncomplete = () => {
        //         resolve();
        //       };
        //     })
        //   );
        // });
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

  async getDocumentList(includeState = false) {
    const db = this.getDB();
    return new Promise<DocumentEntity[]>((resolve, reject) => {
      const storeName = this.dbMeta.stores[0].storeName;
      const transaction = db.transaction(storeName);
      const store = transaction.objectStore(storeName);

      // TODO order by date
      const request = store.openCursor();
      request.onerror = () => {
        reject();
      };

      // TODO use multiple index
      const dataList: DocumentEntity[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
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
}
