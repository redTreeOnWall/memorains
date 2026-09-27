import * as Y from "yjs";
import Format from "string-format";
import { GlobalSnackBar } from "../components/common/GlobalSnackBar";
import { i18n } from "../internationnalization/utils";
import {
  decodeLocalDocument,
  downloadTextFile,
  sanitizeFileName,
} from "./documentIo";
import type { DocMenuContext } from "./pluginTypes";

/**
 * Run the standard "export as Markdown" action for a document.
 *
 * Shared by the plugin-contributed export menu item so every document type
 * exports through one code path. Encryption prompts, empty documents and
 * cancelled password dialogs are all handled identically.
 */
export const runExportMarkdown = async (
  toMarkdown: (yDoc: Y.Doc) => string,
  { docId, title, client, setBusy, refresh }: DocMenuContext,
): Promise<void> => {
  setBusy(true);
  try {
    const localDoc = await client.db.getDocById(docId);
    const yDoc = localDoc ? await decodeLocalDocument(localDoc) : null;

    if (!yDoc) {
      // No local copy (never synced / not cached) or empty content.
      GlobalSnackBar.getInstance().pushMessage(
        i18n("export_markdown_empty"),
        "warning",
      );
      return;
    }

    downloadTextFile(toMarkdown(yDoc), sanitizeFileName(title) + ".md");

    GlobalSnackBar.getInstance().pushMessage(
      Format(i18n("export_markdown_success"), { docName: title }),
      "success",
    );
  } catch (e) {
    if (e instanceof Error && e.message === "Canceled") {
      // User dismissed the password prompt for an encrypted document.
      return;
    }
    console.error(e);
    GlobalSnackBar.getInstance().pushMessage(
      i18n("export_markdown_failed"),
      "error",
    );
  } finally {
    setBusy(false);
    await refresh();
  }
};
