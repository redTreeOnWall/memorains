import { ListItem, ListItemButton } from "@mui/material";
import React from "react";
import Format from "string-format";
import { IClient } from "../../../interface/Client";
import { i18n } from "../../../internationnalization/utils";
import { arrayBufferToBase64, downloadFile } from "../../../utils/utils";
import { GlobalSnackBar } from "../../common/GlobalSnackBar";
import { SavedFile } from "./import";
import PackageJson from "../../../../package.json";

export const ExportItem: React.FC<{ client: IClient }> = ({ client }) => (
  <ListItem>
    <ListItemButton
      onClick={async () => {
        console.log("Exporting...");
        const docList = await client.db.getDocumentList(true);
        const dataListWithBase64: SavedFile["documentList"] = [];

        for (let i = 0; i < docList.length; i++) {
          const doc = docList[i];
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
          docList.length > 1024 * 1024
            ? `${dataJson.length / (1024 * 1024)}MB`
            : `${dataJson.length / 1024}KB`;
        console.log("Export size: " + sizeString);

        const fileName = `Memorains_Note_${exportDate.replace(" ", "_")}.fno`;
        downloadFile(dataJson, fileName);

        GlobalSnackBar.getInstance().pushMessage(
          Format(i18n("success_exported_fileName"), { fileName }),
        );
      }}
    >
      {i18n("export_data")}
    </ListItemButton>
  </ListItem>
);
