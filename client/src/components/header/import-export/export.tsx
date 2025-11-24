import { ListItem, ListItemButton } from "@mui/material";
import React, { useState } from "react";
import Format from "string-format";
import { IClient } from "../../../interface/Client";
import { i18n } from "../../../internationnalization/utils";
import { arrayBufferToBase64 } from "../../../utils/utils";
import { GlobalSnackBar } from "../../common/GlobalSnackBar";
import { SavedFile } from "./import";
import { DocListFilterPanel } from "./DocListFilterPanel";
import { DocumentEntity } from "../../../interface/DataEntity";
import PackageJson from "../../../../package.json";
import pako from "pako";

export const ExportItem: React.FC<{ client: IClient }> = ({ client }) => {
  const [docList, setDocList] = useState<DocumentEntity[]>([]);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const handleExport = async () => {
    console.log("Exporting...");
    const fetchedDocList = await client.db.getDocumentList(true);
    setDocList(fetchedDocList);
    setFilterPanelOpen(true); // Open the filter panel after fetching documents
  };

  const compressData = async (data: string): Promise<Uint8Array> => {
    // Check if CompressionStream API is available (modern browsers)
    if ("CompressionStream" in window) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(data));
          controller.close();
        },
      });

      const compressedStream = stream.pipeThrough(
        new CompressionStream("gzip"),
      );

      const reader = compressedStream.getReader();
      const chunks = [];
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (value) {
          chunks.push(value);
        }
        done = readerDone;
      }

      // Combine all chunks into one Uint8Array
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      return combined;
    } else {
      // Fallback: use pako for compression
      return pako.gzip(data);
    }
  };

  const handleConfirmExport = async (selectedDocs: DocumentEntity[]) => {
    const dataListWithBase64: SavedFile["documentList"] = [];

    for (let i = 0; i < selectedDocs.length; i++) {
      const doc = selectedDocs[i];
      const stateBase64 = doc.state
        ? await arrayBufferToBase64(doc.state)
        : null;
      dataListWithBase64.push({ ...doc, state: stateBase64 });
    }

    const exportDate = new Date().toLocaleString();

    const content: SavedFile = {
      version: PackageJson.version,
      exportDate,
      documentList: dataListWithBase64,
    };
    const dataJson = JSON.stringify(content);

    // Compress the data
    const compressedData = (await compressData(dataJson)) as Uint8Array;
    const sizeString =
      compressedData.length > 1024 * 1024
        ? `${compressedData.length / (1024 * 1024)}MB`
        : `${compressedData.length / 1024}KB`;
    console.log("Export size: " + sizeString);

    const fileName = `Memorains_Note_${exportDate.replace(" ", "_").replace(",", "")}.gfn`;
    // Use downloadFile with the compressed data as a Blob
    const blob = new Blob([compressedData], {
      type: "application/gzip",
    });
    const fileUrl = URL.createObjectURL(blob);

    // Create a temporary link and trigger download
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(fileUrl);

    GlobalSnackBar.getInstance().pushMessage(
      Format(i18n("success_exported_fileName"), { fileName }),
    );

    setFilterPanelOpen(false);
  };

  return (
    <>
      <ListItem>
        <ListItemButton onClick={handleExport}>
          {i18n("export_data")}
        </ListItemButton>
      </ListItem>
      <DocListFilterPanel
        docList={docList}
        open={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        onConfirm={handleConfirmExport}
      />
    </>
  );
};
