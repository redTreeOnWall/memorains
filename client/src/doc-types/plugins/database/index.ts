import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import { DocType } from "../../../interface/DataEntity";
import { i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import { GlobalSnackBar } from "../../../components/common/GlobalSnackBar";
import {
  decodeLocalDocument,
  downloadTextFile,
  sanitizeFileName,
} from "../../documentIo";
import type { DocMenuItem, DocTypePlugin } from "../../pluginTypes";
import { DatabaseEditor } from "./DatabaseEditor";
import { buildInitialDatabaseState, DatabaseBinding } from "./model";
import { databaseToCsv, databaseToMarkdownFromBinding } from "./exporters";

/**
 * The database document type.
 *
 * One plugin object plus its editor, per the registry contract — no router, menu or
 * list-view file is touched, because `docTypeRegistry` discovers this folder.
 */

/**
 * Markdown projection of a database document.
 *
 * The registry derives the "Export as Markdown" menu item from the presence of
 * `toMarkdown`, so implementing it here is all that is needed for that feature.
 *
 * A temporary binding is constructed to read the document, and only ever read from
 * — nothing is written back.
 */
const toMarkdown = (yDoc: import("yjs").Doc): string => {
  const binding = new DatabaseBinding(yDoc, () => undefined);
  try {
    return databaseToMarkdownFromBinding(binding);
  } finally {
    binding.destroy();
  }
};

/**
 * CSV export.
 *
 * Declared explicitly rather than derived, because the registry only knows how to
 * derive the Markdown item. Reuses the shared encryption/password handling in
 * `documentIo`, so an encrypted database prompts exactly like any other document.
 */
const exportCsvItem: DocMenuItem = {
  id: "export-csv",
  labelKey: "db_export_csv",
  Icon: FileDownloadRoundedIcon,
  onClick: async ({ client, docId, title, setBusy, refresh }) => {
    setBusy(true);
    try {
      const localDoc = await client.db.getDocById(docId);
      const yDoc = localDoc ? await decodeLocalDocument(localDoc) : null;

      if (!yDoc) {
        // No local copy, or an empty document: nothing to export.
        GlobalSnackBar.getInstance().pushMessage(
          i18n("db_export_csv_empty"),
          "warning",
        );
        return;
      }

      const binding = new DatabaseBinding(yDoc, () => undefined);
      let csv = "";
      try {
        csv = databaseToCsv(binding);
      } finally {
        binding.destroy();
      }

      downloadTextFile(
        csv,
        `${sanitizeFileName(title)}.csv`,
        "text/csv;charset=utf-8",
      );

      GlobalSnackBar.getInstance().pushMessage(
        Format(i18n("db_export_csv_success"), { docName: title }),
        "success",
      );
    } catch (error) {
      // Dismissing the password prompt of an encrypted document is a silent
      // no-op, matching the behaviour of the shared Markdown export.
      if (error instanceof Error && error.message === "Canceled") return;
      console.error(error);
      GlobalSnackBar.getInstance().pushMessage(
        i18n("db_export_csv_failed"),
        "error",
      );
    } finally {
      setBusy(false);
      await refresh();
    }
  },
};

const databasePlugin: DocTypePlugin = {
  type: DocType.database,
  id: "database",
  order: 35,
  labelKey: "doc_type_database",
  createLabelKey: "new_database_button",
  color: "#00897b",
  buttonColor: "info",
  Icon: TableChartRoundedIcon,
  Editor: DatabaseEditor,
  creatable: true,
  // Seeded at creation, not on open: see `initialState` in pluginTypes.ts.
  initialState: buildInitialDatabaseState,
  toMarkdown,
  menuItems: [exportCsvItem],
};

export default databasePlugin;
