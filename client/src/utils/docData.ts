import { Base64 } from "js-base64";
import * as Y from "yjs";
import { askDialog } from "../components/common/AskDialog";
import { GlobalSnackBar } from "../components/common/GlobalSnackBar";
import { useHttpRequest } from "../hooks/hooks";
import { IClient } from "../interface/Client";
import { DocumentEntity } from "../interface/DataEntity";
import {
  getCryptoKeyFromLocal,
  importAES128KeyFromBase64,
  deriveAESKey,
  decryptData,
  deleteCryptoKeyFromLocal,
  encryptData,
  awaitTime,
} from "./utils";
import { i18n } from "../internationnalization/utils";
import Format from "string-format";

export const decryptDocData = async (
  docData: DocumentEntity,
  cryptoKey: CryptoKey | null = null,
) => {
  // If the doc is encrypted, docData will be ready because data merged
  let tryEncryptData = true;
  let data = docData.state;
  // let cryptoKey: CryptoKey | null = null;
  while (tryEncryptData) {
    const docInfo = docData;
    const salt = docInfo.encrypt_salt;
    if (!salt) {
      // this doc is not encrypted
      return {
        data: docData.state,
        cryptoKey: null,
      };
    }

    if (salt && cryptoKey === null) {
      const cryptoKeyData = await getCryptoKeyFromLocal(docInfo.id);
      if (cryptoKeyData) {
        cryptoKey = await importAES128KeyFromBase64(cryptoKeyData.cryptoKey);
      } else {
        const res = await askDialog.openTextInput({
          title: Format(i18n("ask_input_doc_password"), {
            docTitle: docData.title,
          }),
          label: i18n("password"),
          type: "password",
          buttonText: i18n("confirm_button"),
        });

        if (res.type === "confirm") {
          cryptoKey = await deriveAESKey(res.text, salt);
        }

        if (res.type === "cancel") {
          throw new Error("Canceled");
        }
      }
    }

    if (data && salt) {
      if (!cryptoKey) {
        throw new Error("cryptoKey is not ready for the data.");
      } else {
        try {
          data = await decryptData(data, cryptoKey);
          tryEncryptData = false;
        } catch (e) {
          GlobalSnackBar.getInstance().pushMessage(
            i18n("password_not_correct"),
            "error",
          );
          cryptoKey = null;
          deleteCryptoKeyFromLocal(docData.id);
          console.error(e);
        }
      }
    }

    if (!data) {
      tryEncryptData = false;
    }
    await awaitTime(100);
  }

  return { data, cryptoKey };
};

export const syncEncryptedData = async (
  id: string,
  client: IClient,
  httpRequest: ReturnType<typeof useHttpRequest>,
) => {
  const docLocal = await client.db.getDocById(id);

  const response = await httpRequest("docInfo", {
    docID: id,
    needState: true,
  });

  if (response?.success) {
    const remoteDoc = response?.data?.doc;

    const state = remoteDoc?.state
      ? (Base64.toUint8Array(remoteDoc.state) as Uint8Array<ArrayBuffer>).buffer
      : null;

    if (!docLocal && remoteDoc) {
      // update to local.
      remoteDoc.state = null;

      const newLocalDoc: DocumentEntity = {
        ...remoteDoc,
        state,
      };

      await client.db.createOrUpdateDoc(newLocalDoc);
    }

    let correctCryptoKey: CryptoKey | null = null;

    if (docLocal && remoteDoc) {
      const localState = docLocal.state ? new Uint8Array(docLocal.state) : null;
      const remoteState = state;

      // merge local and remote
      const yDoc = new Y.Doc();

      if (localState) {
        const { data, cryptoKey } = await decryptDocData(docLocal);
        correctCryptoKey = cryptoKey;

        if (data?.byteLength) {
          Y.applyUpdate(yDoc, new Uint8Array(data));
        }
      }

      if (remoteState) {
        if (!correctCryptoKey) {
          const remoteData: DocumentEntity = {
            ...remoteDoc,
            state: remoteState,
          };

          const { data } = await decryptDocData(remoteData);
          if (data?.byteLength) {
            Y.applyUpdate(yDoc, new Uint8Array(data));
          }
        } else {
          const remoteSecondState = await decryptData(
            remoteState,
            correctCryptoKey,
          );

          if (remoteSecondState?.byteLength) {
            Y.applyUpdate(yDoc, new Uint8Array(remoteSecondState));
          }
        }
      }

      const mergedState = Y.encodeStateAsUpdate(yDoc);

      if (correctCryptoKey) {
        const reEncryptedState = await encryptData(
          mergedState.buffer as ArrayBuffer,
          correctCryptoKey,
        );
        remoteDoc.state = null;
        await client.db.createOrUpdateDoc({
          ...docLocal,
          ...remoteDoc,
          state: reEncryptedState,
        });

        const res = await httpRequest("updateDocState", {
          docId: id,
          stateBase64: Base64.fromUint8Array(new Uint8Array(reEncryptedState)),
        });

        if (res?.success) {
          GlobalSnackBar.getInstance().pushMessage(
            i18n("sync_success"),
            "success",
          );
        } else {
          GlobalSnackBar.getInstance().pushMessage(
            i18n("sync_failed"),
            "error",
          );
        }
      }
    }
  } else {
    GlobalSnackBar.getInstance().pushMessage(i18n("sync_doc_not_exist"));
  }
};
