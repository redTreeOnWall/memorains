import { Base64 } from "js-base64";
import { getWsServerUrl } from "../const/host";
import * as Y from "yjs";
import {
  ServerMessage,
  ServerMessageType,
  C2S_SyncVectorMessage,
  ClientMessageType,
  C2S_UpdateDocMessage,
} from "../interface/UserServerMessage";
import { getAuthorization } from "../utils/getAuthorization";
import { Bridge, MessageListener, NoteDocument } from "./NoteDocument";

const MAX_RECONNECT_RETRIES = 5;
const BASE_RECONNECT_DELAY_MS = 1000;

export class MessageBridge implements Bridge {
  private doc: NoteDocument | null = null;
  private reconnectAttempt = 0;
  private isReconnecting = false;
  private destroyed = false;

  async initBridge(doc: NoteDocument) {
    this.doc = doc;
    if (doc.client.offlineMode.value) {
      return;
    }
    await this.openConnection(doc);
  }

  private async openConnection(doc: NoteDocument): Promise<boolean> {
    if (this.destroyed) {
      return false;
    }

    const docId = doc.docId;
    // TODO Handle Error (show error tips)
    const docRoomInfo = await doc.editor.getHttpRequest()("docRoomInfo", {
      docID: docId,
    });

    if (!docRoomInfo?.success || !docRoomInfo.data) {
      return false;
    }

    // when the doc is an encrypted doc, only docInfo will return
    if (docRoomInfo.data.encrypted) {
      doc.setDocInfo(docRoomInfo.data.docInfo);
      return true;
    }

    const password = docRoomInfo.data.roomInfo.password;

    const userId = getAuthorization()?.payload.userId;

    const token = docRoomInfo.data.roomToken;

    const wsURL = `${getWsServerUrl(
      docRoomInfo.data.roomInfo.serverPort,
    )}/${docId}/${userId}/${password}/${token}`;

    const ws = new WebSocket(wsURL);

    return new Promise((resolve) => {
      ws.onopen = () => {
        let waitForFirstDocInfoMessage = true;
        ws.onmessage = async (e) => {
          const data = e.data;

          if (typeof data === "string") {
            const msg = JSON.parse(data) as ServerMessage;
            // TODO
            if (msg.messageType === ServerMessageType.updateDoc) {
              const update = Base64.toUint8Array(msg.data);
              Y.applyUpdate(doc.yDoc, update, "remote");
              doc.commitId = msg.commitId;
              doc.askAutoSavingLocal();
              if (msg.origin === "sync") {
                console.log("Receive diff:", update.byteLength);
                doc.editor.setSynchronized(true);
              }
            } else if (msg.messageType === ServerMessageType.docInfo) {
              doc.setDocInfo(msg.data.docInfo);

              if (waitForFirstDocInfoMessage) {
                waitForFirstDocInfoMessage = false;
                const clientVector = Y.encodeStateVector(doc.yDoc);
                const syncMes: C2S_SyncVectorMessage = {
                  messageType: ClientMessageType.syncVector,
                  messageBody: Base64.fromUint8Array(clientVector),
                };
                ws.send(JSON.stringify(syncMes));
              }
            } else if (msg.messageType === ServerMessageType.syncVector) {
              const serverVector = Base64.toUint8Array(msg.data);

              const diff = Y.encodeStateAsUpdate(doc.yDoc, serverVector);

              const message: C2S_UpdateDocMessage = {
                messageType: ClientMessageType.updateDoc,
                messageBody: Base64.fromUint8Array(diff),
                commitId: doc.commitId,
              };

              console.log("Sending diff:", diff.byteLength);
              ws?.send(JSON.stringify(message));
            } else if (msg.messageType === ServerMessageType.userList) {
              doc.editor.setUserListMessage(msg);
            }

            this.messageListeners.forEach((listener) => listener(msg));
          }
          doc.editor.onConnected();
        };
        ws.onclose = () => {
          console.log("WS closed");
          // Clean up old ws reference (will be replaced on reconnect)
          if (this.wsInstance === ws) {
            this.wsInstance = null;
          }
          doc.editor.onDisconnected();
        };
        ws.onerror = (e) => {
          console.error("WS error", e);
        };

        this.wsInstance = ws;
        resolve(true);
      };

      ws.onerror = (e) => {
        console.error("WS connection error", e);
        resolve(false);
      };
    });
  }

  async ensureConnected(): Promise<boolean> {
    if (this.destroyed) {
      return false;
    }

    const doc = this.doc;
    if (!doc) {
      return false;
    }

    // Never auto-reconnect in offline mode or view-only mode
    if (doc.client.offlineMode.value || doc.viewMode) {
      return false;
    }

    // Already connected or connecting
    if (
      this.wsInstance &&
      (this.wsInstance.readyState === WebSocket.OPEN ||
        this.wsInstance.readyState === WebSocket.CONNECTING)
    ) {
      return true;
    }

    // Already in a reconnect cycle — wait for it to finish
    if (this.isReconnecting) {
      return false;
    }

    // Permanently failed after max retries
    if (this.reconnectAttempt >= MAX_RECONNECT_RETRIES) {
      return false;
    }

    // Start reconnection loop
    this.isReconnecting = true;
    doc.editor.onReconnecting();

    while (this.reconnectAttempt < MAX_RECONNECT_RETRIES && !this.destroyed) {
      this.reconnectAttempt++;

      // Exponential backoff with jitter
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt - 1),
        30000,
      );
      const jitter = Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));

      if (this.destroyed) {
        this.isReconnecting = false;
        return false;
      }

      const connected = await this.openConnection(doc);
      if (connected) {
        // onConnected already called by ws.onopen → ws.onmessage flow
        this.reconnectAttempt = 0;
        this.isReconnecting = false;
        return true;
      }
    }

    // All retries exhausted
    this.isReconnecting = false;
    doc.editor.onReconnectFailed();
    return false;
  }

  wsInstance: WebSocket | null = null;

  private messageListeners: Set<MessageListener> = new Set();

  addMessageListener(listener: MessageListener) {
    this.messageListeners.add(listener);
  }

  removeMessageListener(listener: MessageListener) {
    this.messageListeners.delete(listener);
  }

  close() {
    this.destroyed = true;
    this.wsInstance?.close();
    this.wsInstance = null;
    this.doc = null;
  }
}
