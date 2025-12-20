import React, { useEffect, useState } from "react";
import * as Y from "yjs";
import { CommonEditor, CoreEditorProps } from "./CommonEditor";
import { IClient } from "../interface/Client";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { AskDialogComponent, askDialog } from "../components/common/AskDialog";
import { DatePickerDialogComponent, datePickerDialog } from "../components/common/DatePickerDialogService";
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
import EventIcon from "@mui/icons-material/Event";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import { i18n } from "../internationnalization/utils";

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number; // Unix timestamp
  deadline?: number; // Unix timestamp (optional)
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
      const createdAt = item.get("createdAt") as number;
      const deadline = item.get("deadline") as number | undefined;
      if (id && text !== undefined) {
        items.push({
          id,
          text,
          completed: !!completed,
          createdAt: createdAt || Date.now(),
          deadline
        });
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
      item.set("createdAt", Date.now());
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
          if ("deadline" in updates) {
            item.set("deadline", updates.deadline);
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

  const handleSetDeadline = async (id: string, currentDeadline?: number) => {
    const result = await datePickerDialog.open({
      title: i18n("deadline_dialog_title"),
      buttonText: i18n("deadline_set_button"),
      initDate: currentDeadline,
    });

    if (result.type === "confirm") {
      binding?.updateTodo(id, { deadline: result.timestamp });
    } else if (result.type === "clear") {
      binding?.updateTodo(id, { deadline: undefined });
    }
  };

  const handleRemoveDeadline = (id: string) => {
    binding?.updateTodo(id, { deadline: undefined });
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

  const formatDateTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return "Just now";
    } else if (diffMins < 60) {
      return `${diffMins} min ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const formatDeadline = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMs < 0) {
      // Overdue
      const overdueHours = Math.floor(-diffMs / 3600000);
      if (overdueHours < 24) {
        return `Overdue by ${overdueHours}h`;
      }
      return `Overdue by ${Math.floor(overdueHours / 24)}d`;
    } else if (diffHours < 24) {
      return `Due in ${diffHours}h`;
    } else {
      return `Due ${date.toLocaleDateString()}`;
    }
  };

  const getDeadlineStatus = (deadline: number) => {
    const now = Date.now();
    const diffMs = deadline - now;

    if (diffMs < 0) {
      return 'overdue';
    } else if (diffMs < 86400000) { // Within 24 hours
      return 'urgent';
    } else if (diffMs < 604800000) { // Within 7 days
      return 'upcoming';
    }
    return 'normal';
  };

  // Sort todos: incomplete first, completed last
  const sortedTodos = [...todos].sort((a, b) => {
    if (a.completed === b.completed) {
      return 0;
    }
    return a.completed ? 1 : -1;
  });

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
        {sortedTodos.map((todo) => {
          const deadlineStatus = todo.deadline ? getDeadlineStatus(todo.deadline) : null;
          const deadlineColor = deadlineStatus === 'overdue' ? 'error' :
                               deadlineStatus === 'urgent' ? 'warning' :
                               deadlineStatus === 'upcoming' ? 'info' : 'success';

          return (
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
                secondary={
                  <>
                    {formatDateTime(todo.createdAt)}
                    {todo.deadline && (
                      <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                        <Button
                          variant="text"
                          size="small"
                          startIcon={<CalendarTodayIcon sx={{ fontSize: 12 }} />}
                          onClick={() => handleSetDeadline(todo.id, todo.deadline)}
                          sx={{
                            textTransform: 'none',
                            fontSize: '0.75rem',
                            fontWeight: 'medium',
                            minHeight: 'auto',
                            py: 0.25,
                            px: 1,
                            backgroundColor: (t) => t.palette[deadlineColor].light + '20',
                            color: (t) => t.palette[deadlineColor].main,
                            '&:hover': {
                              backgroundColor: (t) => t.palette[deadlineColor].light + '40',
                            },
                            borderRadius: 1,
                            minWidth: 'fit-content',
                          }}
                        >
                          {formatDeadline(todo.deadline)}
                        </Button>
                      </Box>
                    )}
                  </>
                }
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
          );
        })}
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
      <DatePickerDialogComponent />

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
              onClick={() => {
                const todo = todos.find(t => t.id === moreMenu.todoId);
                handleSetDeadline(moreMenu.todoId, todo?.deadline);
                setMoreMenu(null);
              }}
            >
              <ListItemIcon>
                <EventIcon />
              </ListItemIcon>
              <ListItemText>{i18n("set_deadline")}</ListItemText>
            </MenuItem>
            {todos.find(t => t.id === moreMenu.todoId)?.deadline && (
              <MenuItem
                sx={{ color: (t) => t.palette.warning.main }}
                onClick={() => {
                  handleRemoveDeadline(moreMenu.todoId);
                  setMoreMenu(null);
                }}
              >
                <ListItemIcon>
                  <EventIcon sx={{ color: (t) => t.palette.warning.main }} />
                </ListItemIcon>
                <ListItemText>{i18n("remove_deadline")}</ListItemText>
              </MenuItem>
            )}
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
