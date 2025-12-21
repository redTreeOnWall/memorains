import React, { useEffect, useState } from "react";
import * as Y from "yjs";
import moment from "moment";
import "moment/locale/zh-cn";
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
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import DriveFileRenameOutlineRoundedIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import EventIcon from "@mui/icons-material/Event";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import { i18n, currentLan } from "../internationnalization/utils";

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
      multiline: true,
      rows: 3,
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

  const formatDeadline = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMs < 0) {
      // Overdue
      const overdueHours = Math.floor(-diffMs / 3600000);
      if (overdueHours < 24) {
        return i18n("overdue_by_hours").replace("{hours}", overdueHours.toString());
      }
      return i18n("overdue_by_days").replace("{days}", Math.floor(overdueHours / 24).toString());
    } else if (diffHours < 24) {
      return i18n("due_in_hours").replace("{hours}", diffHours.toString());
    } else {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return i18n("due_date").replace("{date}", `${year}-${month}-${day}`);
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

  const formatCreatedDate = (timestamp: number) => {
    // Set moment locale based on current language
    const lang = currentLan.startsWith('zh') ? 'zh-cn' : 'en';
    moment.locale(lang);

    const created = moment(timestamp);
    const diffDays = moment().diff(created, 'days');

    if (diffDays < 7) {
      // Use relative time for recent items
      return created.fromNow();
    } else {
      // Use formatted date for older items
      return created.format('YYYY-MM-DD');
    }
  };

  // Sort todos: incomplete first, completed last; within each group, newer items first
  const sortedTodos = [...todos].sort((a, b) => {
    if (a.completed !== b.completed) {
      // Incomplete items first, completed items last
      return a.completed ? 1 : -1;
    }
    // Within same completion group, newer items first (higher createdAt first)
    return b.createdAt - a.createdAt;
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
        {i18n("doc_type_todo")}
      </Typography>

      <Box sx={{ mb: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            fullWidth
            variant="outlined"
            placeholder={i18n("add_new_task_placeholder")}
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
          >
            {i18n("add_button")}
          </Button>
        </Stack>
      </Box>

      {totalCount > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {i18n("todo_progress").replace("{completed}", completedCount.toString()).replace("{total}", totalCount.toString())}
          </Typography>
          {completedCount > 0 && (
            <Button
              size="small"
              onClick={handleClearCompleted}
              sx={{ mt: 1 }}
            >
              {i18n("clear_completed_button")}
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
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                    {todo.deadline ? (
                      <Button
                        variant="text"
                        size="small"
                        startIcon={<CalendarTodayIcon sx={{ fontSize: 12 }} />}
                        onClick={() => handleSetDeadline(todo.id, todo.deadline)}
                        disabled={todo.completed}
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
                    ) : !todo.completed ? (
                      <Button
                        variant="text"
                        size="small"
                        startIcon={<CalendarTodayIcon sx={{ fontSize: 12 }} />}
                        onClick={() => handleSetDeadline(todo.id, undefined)}
                        sx={{
                          textTransform: 'none',
                          fontSize: '0.75rem',
                          minHeight: 'auto',
                          py: 0.25,
                          px: 1,
                          color: 'text.secondary',
                          '&:hover': {
                            backgroundColor: (t) => t.palette.action.hover,
                          },
                          borderRadius: 1,
                          minWidth: 'fit-content',
                        }}
                      >
                        {i18n("set_deadline")}
                      </Button>
                    ) : null}
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        fontSize: '0.7rem',
                        fontStyle: 'italic'
                      }}
                    >
                      {formatCreatedDate(todo.createdAt)}
                    </Typography>
                  </Box>
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
            {i18n("todo_empty_state")}
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
