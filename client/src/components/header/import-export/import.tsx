import React, { useState } from "react";
import * as Y from "yjs";
import { ListItem, ListItemButton, Box, Input } from "@mui/material";
import Format from "string-format";
import type { IClient } from "../../../interface/Client";
import { DocumentEntity } from "../../../interface/DataEntity";
import { i18n } from "../../../internationnalization/utils";
import { decryptDocData } from "../../../utils/docData";
import { base64ToBuffer, encryptData } from "../../../utils/utils";
import { GlobalSnackBar } from "../../common/GlobalSnackBar";
import { DocListFilterPanel } from "./DocListFilterPanel";

export interface SavedFile {
  documentList: (Omit<DocumentEntity, "state"> & {
    state: string | null;
  })[];
  version?: string;
  exportDate: string;
}

export const ImportItem: React.FC<{
  client: IClient;
  onFinished: () => void;
}> = ({ client, onFinished }) => {
  const [docList, setDocList] = useState<DocumentEntity[]>([]);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [, setFileData] = useState<SavedFile | null>(null);

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (file) {
      const reader = new FileReader();
      const read = new Promise<string | null>((resolve) => {
        reader.onload = (fe) => {
          const result = fe.target?.result;
          if (typeof result === "string") {
            resolve(result);
          } else {
            resolve(null);
          }
        };

        reader.readAsText(file);
      });

      const content = await read;

      if (content) {
        try {
          const parsedFileData = JSON.parse(content) as SavedFile;
          setFileData(parsedFileData);

          // Convert to binary format for the filter panel
          const binaryDocList: DocumentEntity[] = [];
          for (let i = 0; i < parsedFileData.documentList.length; i++) {
            const d = parsedFileData.documentList[i];
            let state: ArrayBuffer | null = null;
            if (d.state) {
              state = await base64ToBuffer(d.state);
            }

            binaryDocList.push({ ...d, state });
          }

          setDocList(binaryDocList);
          setFilterPanelOpen(true); // Open the filter panel after parsing documents
        } catch (e) {
          GlobalSnackBar.getInstance().pushMessage(
            i18n("failed_to_import_file"),
            "error",
          );
          console.error(e);
        }
      }

      input.value = "";
    }
  };

  const handleConfirmImport = async (selectedDocs: DocumentEntity[]) => {
    try {
      for (let i = 0; i < selectedDocs.length; i++) {
        const doc = selectedDocs[i];

        if (!doc.id) {
          continue;
        }

        let docToSave = doc;

        const existDoc = await client.db.getDocById(doc.id);
        if (existDoc) {
          let outerState = new ArrayBuffer(0);
          let innerState = new ArrayBuffer(0);
          let cryptoKey: CryptoKey | null = null;
          try {
            const outerRes = await decryptDocData(doc);
            const innerRes = await decryptDocData(existDoc, outerRes.cryptoKey);

            if (outerRes.data) {
              outerState = outerRes.data;
            }
            if (innerRes.data) {
              innerState = innerRes.data;
            }
            cryptoKey = outerRes.cryptoKey;
          } catch (e) {
            console.error(e);
            GlobalSnackBar.getInstance().pushMessage(
              `Canceled, "${doc.title} will be skipped!"`,
              "warning",
            );
            continue;
          }
          // Merge data.
          const yDoc = new Y.Doc();
          if (innerState?.byteLength) {
            Y.applyUpdate(yDoc, new Uint8Array(innerState));
          }

          if (outerState.byteLength) {
            Y.applyUpdate(yDoc, new Uint8Array(outerState));
          }

          if (outerState.byteLength || innerState.byteLength) {
            const newState = Y.encodeStateAsUpdate(yDoc);
            if (cryptoKey) {
              existDoc.state = await encryptData(
                newState.buffer as ArrayBuffer,
                cryptoKey,
              );
            } else {
              existDoc.state = newState.buffer as ArrayBuffer;
            }
          }
          docToSave = existDoc;
        }
        await client.db.createOrUpdateDoc(docToSave);
      }

      GlobalSnackBar.getInstance().pushMessage(
        Format(i18n("imported_documents"), {
          size: `${selectedDocs.length}`,
        }),
        "success",
      );
      onFinished();
    } catch (e) {
      GlobalSnackBar.getInstance().pushMessage(
        i18n("failed_to_import_file"),
        "error",
      );
      console.error(e);
    } finally {
      setFilterPanelOpen(false);
    }
  };

  return (
    <>
      <ListItem>
        <ListItemButton>
          <Box>
            <Box>{i18n("import_data")}</Box>
            <Box>
              <Input
                type="file"
                inputProps={{
                  accept: ".fno",
                }}
                onChange={handleFileImport}
              ></Input>
            </Box>
          </Box>
        </ListItemButton>
      </ListItem>
      <DocListFilterPanel
        docList={docList}
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        onConfirm={handleConfirmImport}
      />
    </>
  );
};
