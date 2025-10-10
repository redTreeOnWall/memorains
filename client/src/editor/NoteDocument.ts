import * as Y from "yjs";
import { useHttpRequest } from "../hooks/hooks";
import {
  AwaitableThrottle,
  awaitTime,
  encryptData,
  randomInt,
} from "../utils/utils";
import { DocumentEntity } from "../interface/DataEntity";
import {
  C2S_UpdateDocMessage,
  ClientMessageType,
  S2C_UserListMessage,
  ServerMessage,
} from "../interface/UserServerMessage";
import { Base64 } from "js-base64";
import { Client } from "..";
import { BindableProperty } from "../utils/BindableProperty";
import { decryptDocData } from "../utils/docData";
import moment from "moment";
import { GlobalSnackBar } from "../components/common/GlobalSnackBar";

export interface Editor {
  onInit: (doc: NoteDocument) => void;
  onOfflineLoaded: () => void;
  onConnected: () => void;
  onDisconnected: () => void;
  getOrigin: () => unknown;
  getHttpRequest: () => ReturnType<typeof useHttpRequest>;
  setLoading: (loading: boolean) => void;
  setDocInfo: (docInfo: Omit<DocumentEntity, "state">) => void;
  setUserListMessage: (useList: S2C_UserListMessage) => void;
  setSynchronized: (synchronized: boolean) => void;
  setSaving: (saving: boolean) => void;
  setNeedSave: (canSave: boolean) => void;
}

export type MessageListener = (msg: ServerMessage) => void;

export interface Bridge {
  initBridge: (doc: NoteDocument) => void;
  wsInstance: WebSocket | null;

  addMessageListener: (listener: MessageListener) => void;

  removeMessageListener: (listener: MessageListener) => void;

  close: () => void;
}

export class NoteDocument {
  yDoc: Y.Doc;
  commitId = randomInt();
  saveLocal: AwaitableThrottle | null = null;

  cryptoKey: CryptoKey | null = null;

  constructor(
    public editor: Editor,
    public bridge: Bridge,
    public docId: string,
    public client: Client,
    public viewMode = false,
  ) {
    // this.yDoc = new Y.Doc(gc: true);
    this.yDoc = new Y.Doc({ gc: true });
  }

  initd = false;

  async init() {
    this.editor.onInit(this);

    this.editor.setLoading(true);

    if (this.viewMode) {
      // TODO if is_public void mode
      const res = await this.editor.getHttpRequest()("getPublicDoc", {
        docID: this.docId,
        needState: true,
      });
      const data = res?.data;
      if (res?.success && data) {
        const base64State = data.doc.state;
        const doc: DocumentEntity = {
          ...data.doc,
          state: base64State
            ? (Base64.toUint8Array(base64State).buffer as ArrayBuffer)
            : null,
        };

        this.applyDocDataToYDoc(doc, "remote");
      } else {
        GlobalSnackBar.getInstance().pushMessage(
          "Can not open this note!",
          "error",
        );
        return;
      }
    } else {
      this.bridge.initBridge(this);
    }

    await this.initOfflineSaver();

    if (!this.viewMode) {
      this.saveLocal = new AwaitableThrottle(async () => {
        await awaitTime(1000);
        const currentDoc = this.docInfo;
        // TODO add currentDoc into ctx;
        if (currentDoc) {
          currentDoc.commit_id = this.commitId;
          const modifyTime = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");
          const state = Y.encodeStateAsUpdate(this.yDoc).buffer as ArrayBuffer;
          let newUpdateDoc = {
            ...currentDoc,
            state,
            last_modify_date: modifyTime,
          };
          // TODO crypt
          if (currentDoc.encrypt_salt) {
            const key = this.cryptoKey;
            if (!key) {
              throw new Error("No cryptoKey!");
            }
            const res = await encryptData(state, key);
            newUpdateDoc = { ...newUpdateDoc, state: res };
          }

          // FIXME
          await this.client.db.createOrUpdateDoc(newUpdateDoc);
          console.log(
            `Saved doc to local.${currentDoc.encrypt_salt ? "(encrypted)" : ""}`,
            state.byteLength / 1000,
          );
        }
        this.editor.setNeedSave(false);
        this.editor.setSaving(false);
      }, 5000);
    }

    // update from remote
    this.yDoc.on("update", (update: Uint8Array, origin) => {
      if (origin === "remote" || this.viewMode) {
        return;
      }

      if (origin && origin === this.editor.getOrigin()) {
        this.onUpdateFromEditor(update);
      }
    });

    this.initd = true;
  }

  offlineDataLoaded = new BindableProperty(false);

  // TODO remoteDataLoaded = new BindableProperty(boolean);

  async initOfflineSaver() {
    if (!this.viewMode) {
      const docData = await this.client.db.getDocById(this.docId);
      if (docData) {
        await this.applyDocDataToYDoc(docData, "load-offline");
      }
    }
    this.editor.onOfflineLoaded();
    this.offlineDataLoaded.value = true;
    // this.onLocalDataLoaded?.();
  }

  private async applyDocDataToYDoc(doc: DocumentEntity, origin: string) {
    this.setDocInfo(doc);

    const { data, cryptoKey } = await decryptDocData(doc);

    this.cryptoKey = cryptoKey;

    if (data?.byteLength) {
      Y.applyUpdate(this.yDoc, new Uint8Array(data), origin);
      this.commitId = doc.commit_id;
    }
  }

  onUpdateFromEditor(update: Uint8Array) {
    if (this.viewMode) {
      return;
    }
    this.askAutoSavingLocal();

    const offlineMode = this.client.offlineMode.value;

    if (!offlineMode && this.bridge.wsInstance) {
      const message: C2S_UpdateDocMessage = {
        messageType: ClientMessageType.updateDoc,
        messageBody: Base64.fromUint8Array(update),
        commitId: this.commitId,
      };

      this.bridge.wsInstance?.send(JSON.stringify(message));
    }
  }

  public docInfo: Omit<DocumentEntity, "state"> | null = null;
  async setDocInfo(docInfo: Omit<DocumentEntity, "state">) {
    this.docInfo = docInfo;
    this.editor.setDocInfo(docInfo);
  }

  trySaveLocal() {
    this.editor.setSaving(true);
    this.saveLocal?.askInvoke();
  }

  askAutoSavingLocal() {
    this.editor.setNeedSave(true);
    if (!this.client.setting.properties.autoSaveToLocal.value) {
      return;
    }
    this.editor.setSaving(true);
    this.saveLocal?.askInvoke();
  }

  destroy() {
    this.bridge.close();
  }
}
