import ColorLensRoundedIcon from "@mui/icons-material/ColorLensRounded";
import { DocType } from "../../interface/DataEntity";
import { ExcalidrawCanvas } from "../../components/canvas/ExcalidrawCanvas";
import type { DocTypePlugin } from "../pluginTypes";

/** Infinite canvas document (Excalidraw). */
const canvasPlugin: DocTypePlugin = {
  type: DocType.canvas,
  id: "canvas",
  order: 20,
  labelKey: "doc_type_canvas",
  createLabelKey: "new_canvas_button",
  color: "#9c27b0",
  buttonColor: "secondary",
  Icon: ColorLensRoundedIcon,
  Editor: ExcalidrawCanvas,
  creatable: true,
};

export default canvasPlugin;
