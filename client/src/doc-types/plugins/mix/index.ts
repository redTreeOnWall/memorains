import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import { DocType } from "../../../interface/DataEntity";
import type { DocTypePlugin } from "../../pluginTypes";

/**
 * Mixed-content document.
 *
 * The editor is not implemented yet, so this plugin declares the type as
 * *known* without exposing it: no route, not creatable, never listed. Keeping
 * it registered means a `mix` document is never opened as a different type and
 * silently corrupted.
 *
 * Implement `Editor` here to switch the type on — no other file needs to change.
 */
const mixPlugin: DocTypePlugin = {
  type: DocType.mix,
  id: "mix",
  order: 30,
  labelKey: "doc_type_mixed",
  createLabelKey: "doc_type_mixed",
  color: "#0288d1",
  buttonColor: "info",
  Icon: DashboardRoundedIcon,
  Editor: null,
  creatable: false,
};

export default mixPlugin;
