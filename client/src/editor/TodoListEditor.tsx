import React, { useEffect, useState } from "react";
import * as Y from "yjs";
import { CommonEditor, CoreEditorProps } from "./CommonEditor";
import { IClient } from "../interface/Client";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { AskDialogComponent, askDialog } from "../components/common/AskDialog";
import {
  Box,
  Checkbox,
  TextField,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  Button,
  Typography,
  Divider,
  Stack,
  Menu,
  MenuItem,
  MenuList,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import DriveFileRenameOutlineRoundedIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import { i18n } from "../internationnalization/utils";

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

export class TodoListYjsBinding {
  private todoArray: Y.Array<Y.Map<unknown>>;

  constructor(
    private yDoc: Y.Doc,
    private onChangeCallback: () => void,
  ) {
    this.todoArray = this.getTodoArray() as Y.Array<Y.Map<unknown>>;

    yDoc.on("update", (_, origin) => {
      if (origin === "todolist") {
        return;
      }
      this.onChangeCallback();
    });
  }

  private getTodoArray() {
    return this.yDoc.getArray("todolist_items");
  }

  getTodos(): TodoItem[] {
    const items: TodoItem[] = [];
    this.todoArray.forEach((item) => {
      const id = item.get("id") as string;
      const text = item.get("text") as string;
      const completed = item.get("completed") as boolean;
      if (id && text !== undefined) {
        items.push({ id, text, completed: !!completed });
      }
    });
    return items;
  }

  addTodo(text: string) {
    this.yDoc.transact(() => {
      const item = new Y.Map<unknown>();
      item.set("id", `todo_${Date.now()}_${Math.random()}`);
      item.set("text", text);
      item.set("completed", false);
      this.todoArray.push([item]);
    }, "todolist");
  }

  updateTodo(id: string, updates: Partial<TodoItem>) {
    this.yDoc.transact(() => {
      this.todoArray.forEach((item) => {
        if (item.get("id") === id) {
          if (updates.text !== undefined) {
            item.set("text", updates.text);
          }
          if (updates.completed !== undefined) {
            item.set("completed", updates.completed);
          }
        }
      });
    }, "todolist");
  }

  deleteTodo(id: string) {
    this.yDoc.transact(() => {
      const index = this.todoArray.toArray().findIndex((item) => {
        return item.get("id") === id;
      });
      if (index !== -1) {
        this.todoArray.delete(index, 1);
      }
    }, "todolist");
  }

  clearCompleted() {
    this.yDoc.transact(() => {
      const items = this.todoArray.toArray();
      const indicesToRemove: number[] = [];
      items.forEach((item, index) => {
        if (item.get("completed") === true) {
          indicesToRemove.push(index);
        }
      });
      // Remove in reverse order to maintain correct indices
      for (let i = indicesToRemove.length - 1; i >= 0; i--) {
        this.todoArray.delete(indicesToRemove[i], 1);
      }
    }, "todolist");
  }
}

const TodoListEditorInner: React.FC<CoreEditorProps> = ({
  client,
  docInstance,
  onBind,
}) => {
  const [binding, setBinding] = useState<TodoListYjsBinding | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [newTodoText, setNewTodoText] = useState("");
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [moreMenu, setMoreMenu] = React.useState<null | {
    anchorEl?: HTMLElement;
    todoId: string;
    todoText: string;
  }>(null);
  const theme = client.setting.colorTheme.resultThemeColor.value;

  useEffect(() => {
    if (!docInstance) {
      return;
    }

    const updateTodos = () => {
      if (binding) {
        setTodos(binding.getTodos());
      }
    };

    const newBinding = new TodoListYjsBinding(docInstance.yDoc, updateTodos);
    setBinding(newBinding);
    setTodos(newBinding.getTodos());
    
    docInstance.editor.getOrigin = () => "todolist";
    onBind();

    const onOfflineData = () => {
      docInstance.editor.setLoading(false);
      updateTodos();
    };

    if (docInstance.offlineDataLoaded.value) {
      onOfflineData();
    } else {
      docInstance.offlineDataLoaded.addValueChangeListener(onOfflineData);
      return () => {
        docInstance.offlineDataLoaded.removeValueChangeListener(
          onOfflineData,
        );
      };
    }
  }, [docInstance, binding]);

  const handleAddTodo = () => {
    if (newTodoText.trim()) {
      binding?.addTodo(newTodoText.trim());
      setNewTodoText("");
    }
  };

  const handleToggle = (id: string, completed: boolean) => {
    binding?.updateTodo(id, { completed });
  };

  const handleDelete = (id: string) => {
    binding?.deleteTodo(id);
  };

  const handleEdit = async (id: string, currentText: string) => {
    const result = await askDialog.openTextInput({
      title: i18n("edit_todo_title"),
      label: i18n("edit_todo_label"),
      buttonText: i18n("update_button"),
      initText: currentText,
    });

    if (result.type === "confirm" && result.text.trim()) {
      binding?.updateTodo(id, { text: result.text.trim() });
    }
  };

  const handleClearCompleted = () => {
    setShowClearDialog(true);
  };

  const handleConfirmClear = () => {
    binding?.clearCompleted();
    setShowClearDialog(false);
  };

  const handleCancelClear = () => {
    setShowClearDialog(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddTodo();
    }
  };

  const completedCount = todos.filter((t) => t.completed).length;
  const totalCount = todos.length;

  return (
    <Box
      sx={{
        padding: 2,
        maxWidth: "800px",
        margin: "0 auto",
        backgroundColor: theme === "dark" ? "#1a1a1a" : "#ffffff",
        minHeight: "calc(100vh - 100px)",
        borderRadius: 2,
      }}
    >
      <Typography variant="h4" gutterBottom sx={{ fontWeight: "bold", color: "primary.main" }}>
        TODO List
      </Typography>
      
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            fullWidth
            variant="outlined"
            placeholder="Add a new task..."
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            onKeyPress={handleKeyPress}
            size="small"
            sx={{
              backgroundColor: theme === "dark" ? "#2d2d2d" : "#f5f5f5",
            }}
          />
          <Button
            variant="contained"
            onClick={handleAddTodo}
            disabled={!newTodoText.trim()}
            startIcon={<AddIcon />}
          >
            Add
          </Button>
        </Stack>
      </Box>

      {totalCount > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {completedCount} of {totalCount} completed
          </Typography>
          {completedCount > 0 && (
            <Button
              size="small"
              onClick={handleClearCompleted}
              sx={{ mt: 1 }}
            >
              Clear Completed
            </Button>
          )}
        </Box>
      )}

      <Divider sx={{ mb: 2 }} />

      <List>
        {todos.map((todo) => (
          <ListItem
            key={todo.id}
            sx={{
              backgroundColor: todo.completed 
                ? (theme === "dark" ? "#1e3a1e" : "#e8f5e9") 
                : "transparent",
              borderRadius: 1,
              mb: 0.5,
              border: `1px solid ${theme === "dark" ? "#333" : "#e0e0e0"}`,
            }}
          >
            <ListItemIcon>
              <Checkbox
                edge="start"
                checked={todo.completed}
                onChange={() => handleToggle(todo.id, !todo.completed)}
                icon={<RadioButtonUncheckedIcon />}
                checkedIcon={<CheckCircleIcon color="success" />}
              />
            </ListItemIcon>
            <ListItemText
              primary={todo.text}
              sx={{
                textDecoration: todo.completed ? "line-through" : "none",
                opacity: todo.completed ? 0.6 : 1,
              }}
            />
            <ListItemSecondaryAction>
              <IconButton
                edge="end"
                onClick={(e) => {
                  setMoreMenu({
                    anchorEl: e.currentTarget,
                    todoId: todo.id,
                    todoText: todo.text,
                  });
                }}
                size="small"
              >
                <MoreHorizRoundedIcon />
              </IconButton>
            </ListItemSecondaryAction>
          </ListItem>
        ))}
      </List>

      {todos.length === 0 && (
        <Box
          sx={{
            textAlign: "center",
            mt: 4,
            color: "text.secondary",
          }}
        >
          <Typography variant="body1">
            No tasks yet. Add one above to get started!
          </Typography>
        </Box>
      )}

      <ConfirmDialog
        open={showClearDialog}
        title={i18n("clear_completed_title")}
        content={i18n("clear_completed_content")}
        confirmText={i18n("clear_completed_button")}
        onConfirm={handleConfirmClear}
        onClose={handleCancelClear}
        confirmColor="error"
      />
      <AskDialogComponent />

      <Menu
        open={moreMenu !== null}
        anchorEl={moreMenu?.anchorEl}
        onClose={() => {
          setMoreMenu(null);
        }}
      >
        {moreMenu ? (
          <MenuList sx={{ width: 280, maxWidth: "100%" }}>
            <MenuItem
              onClick={() => {
                handleEdit(moreMenu.todoId, moreMenu.todoText);
                setMoreMenu(null);
              }}
            >
              <ListItemIcon>
                <DriveFileRenameOutlineRoundedIcon />
              </ListItemIcon>
              <ListItemText>{i18n("edit_todo_title")}</ListItemText>
            </MenuItem>
            <MenuItem
              sx={{ color: (t) => t.palette.error.main }}
              onClick={() => {
                handleDelete(moreMenu.todoId);
                setMoreMenu(null);
              }}
            >
              <ListItemIcon>
                <DeleteIcon sx={{ color: (t) => t.palette.error.main }} />
              </ListItemIcon>
              <ListItemText>{i18n("delete_doc")}</ListItemText>
            </MenuItem>
          </MenuList>
        ) : (
          <MenuList sx={{ width: 280, maxWidth: "100%", height: 80 }} />
        )}
      </Menu>
    </Box>
  );
};

export const TodoListEditor: React.FC<{ client: IClient }> = ({ client }) => {
  return <CommonEditor client={client} CoreEditor={TodoListEditorInner} />;
};
