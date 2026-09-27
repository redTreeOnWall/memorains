import * as Y from "yjs";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import { DocType } from "../../../interface/DataEntity";
import { deltaToMarkdown } from "../../../utils/deltaToMarkdown";
import { QuillEditor } from "./QuillEditor";
import type { DocTypePlugin } from "../../pluginTypes";

/** Rich-text document (Quill). Also the type unknown `doc_type` values fall back to. */
const textPlugin: DocTypePlugin = {
  type: DocType.text,
  id: "document",
  order: 10,
  labelKey: "doc_type_article",
  createLabelKey: "new_document_button",
  color: "#1976d2",
  buttonColor: "primary",
  Icon: ArticleRoundedIcon,
  Editor: QuillEditor,
  creatable: true,
  toMarkdown: (yDoc: Y.Doc) => deltaToMarkdown(yDoc.getText("quill").toDelta()),
};

export default textPlugin;
