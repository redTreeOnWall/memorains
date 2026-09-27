import ChatRoundedIcon from "@mui/icons-material/ChatRounded";
import { DocType } from "../../../interface/DataEntity";
import { ChatEditor } from "./ChatEditor";
import type { DocTypePlugin } from "../../pluginTypes";

/** Chat / messenger document. */
const chatPlugin: DocTypePlugin = {
  type: DocType.chat,
  id: "chat",
  order: 50,
  labelKey: "doc_type_chat",
  createLabelKey: "new_chat_button",
  color: "#e65100",
  buttonColor: "warning",
  Icon: ChatRoundedIcon,
  Editor: ChatEditor,
  creatable: true,
};

export default chatPlugin;
