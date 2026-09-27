import TaskRoundedIcon from "@mui/icons-material/TaskRounded";
import { DocType } from "../../../interface/DataEntity";
import { TodoListEditor } from "./TodoListEditor";
import type { DocTypePlugin } from "../../pluginTypes";

/** Todo-list document. */
const todoPlugin: DocTypePlugin = {
  type: DocType.todo,
  id: "todo",
  order: 40,
  labelKey: "doc_type_todo",
  createLabelKey: "new_todo_button",
  color: "#2e7d32",
  buttonColor: "success",
  Icon: TaskRoundedIcon,
  Editor: TodoListEditor,
  creatable: true,
};

export default todoPlugin;
