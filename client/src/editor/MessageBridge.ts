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

export class MessageBridge implements Bridge {
  async initBridge(doc: NoteDocument) {
    if (doc.client.offlineMode.value) {
      return;
    }

    const docId = doc.docId;
    const docRoomInfo = await doc.editor.getHttpRequest()("docRoomInfo", {
      docID: docId,
    });

    if (!docRoomInfo?.success || !docRoomInfo.data) {
      return;
    }

    // when the doc is an encrypted doc, only docInfo will return
    if (docRoomInfo.data.encrypted) {
      doc.setDocInfo(docRoomInfo.data.docInfo);
      return;
    }

    const password = docRoomInfo.data.roomInfo.password;

    const userId = getAuthorization()?.payload.userId;

    const token = docRoomInfo.data.roomToken;

    const wsURL = `${getWsServerUrl(
      docRoomInfo.data.roomInfo.serverPort,
    )}/${docId}/${userId}/${password}/${token}`;

    const ws = new WebSocket(wsURL);

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
            doc.askSavingLocal();
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
      };
      ws.onclose = () => {
        console.log("closed");
        doc.editor.setLoading(true);
      };
      ws.onerror = (e) => {
        console.error(e);
        doc.editor.setLoading(true);
      };

      this.wsInstance = ws;
    };

    // Websocket End

    ws.onerror = (e) => {
      console.error(e);
    };

    return ws;
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
    this.wsInstance?.close();
    this.wsInstance = null;
  }
}
