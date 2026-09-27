import * as Y from "yjs";
import { decryptDocData } from "../utils/docData";
import type { DocumentEntity } from "../interface/DataEntity";

/**
 * Decode a locally stored document into a `Y.Doc`.
 *
 * Returns `null` when there is nothing usable to decode (no local copy, or an
 * empty state). Throws `Error("Canceled")` when the user dismisses the password
 * prompt of an encrypted document, so callers can treat that as a no-op rather
 * than a failure.
 */
export const decodeLocalDocument = async (
  docData: DocumentEntity,
): Promise<Y.Doc | null> => {
  if (!docData.state?.byteLength) {
    return null;
  }

  let stateData: ArrayBuffer | null = docData.state;

  if (docData.encrypt_salt && stateData) {
    const { data } = await decryptDocData(docData);
    stateData = data;
  }

  if (!stateData?.byteLength) {
    return null;
  }

  const yDoc = new Y.Doc();
  Y.applyUpdate(yDoc, new Uint8Array(stateData));
  return yDoc;
};

/** Strip path-hostile characters from a document title. */
export const sanitizeFileName = (name: string) =>
  name.replace(/[^\w\u4e00-\u9fff\- ]/g, "_").trim() || "document";

/** Trigger a browser download of an in-memory text payload. */
export const downloadTextFile = (
  content: string,
  fileName: string,
  mimeType = "text/markdown;charset=utf-8",
) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
