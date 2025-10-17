import { ListItem, ListItemButton } from "@mui/material";
import React, { useState } from "react";
import Format from "string-format";
import { IClient } from "../../../interface/Client";
import { i18n } from "../../../internationnalization/utils";
import { arrayBufferToBase64, downloadFile } from "../../../utils/utils";
import { GlobalSnackBar } from "../../common/GlobalSnackBar";
import { SavedFile } from "./import";
import { DocListFilterPanel } from "./DocListFilterPanel";
import { DocumentEntity } from "../../../interface/DataEntity";
import PackageJson from "../../../../package.json";

export const ExportItem: React.FC<{ client: IClient }> = ({ client }) => {
  const [docList, setDocList] = useState<DocumentEntity[]>([]);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const handleExport = async () => {
    console.log("Exporting...");
    const fetchedDocList = await client.db.getDocumentList(true);
    setDocList(fetchedDocList);
    setFilterPanelOpen(true); // Open the filter panel after fetching documents
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

    const sizeString =
      selectedDocs.length > 1024 * 1024
        ? `${dataJson.length / (1024 * 1024)}MB`
        : `${dataJson.length / 1024}KB`;
    console.log("Export size: " + sizeString);

    const fileName = `Memorains_Note_${exportDate.replace(" ", "_").replace(",", "")}.fno`;
    downloadFile(dataJson, fileName);

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
