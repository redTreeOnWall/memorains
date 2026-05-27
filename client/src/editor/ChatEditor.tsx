import React, { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { CommonEditor, CoreEditorProps } from "./CommonEditor";
import { IClient } from "../interface/Client";
import { getAuthorization } from "../utils/getAuthorization";
import { hashColorWitchCache } from "../utils/utils";
import { i18n } from "../internationnalization/utils";
import {
  Box,
  TextField,
  IconButton,
  Typography,
  Paper,
  Avatar,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";

// ─── Yjs data model ───────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
}

export class ChatYjsBinding {
  private messageArray: Y.Array<Y.Map<unknown>>;

  constructor(
    private yDoc: Y.Doc,
    private onChangeCallback: () => void,
  ) {
    this.messageArray = this.getMessagesArray();

    yDoc.on("update", (_, origin) => {
      if (origin === "chateditor") {
        return;
      }
      this.onChangeCallback();
    });
  }

  private getMessagesArray(): Y.Array<Y.Map<unknown>> {
    return this.yDoc.getArray("chat_messages") as Y.Array<Y.Map<unknown>>;
  }

  getMessages(): ChatMessage[] {
    const items: ChatMessage[] = [];
    this.messageArray.forEach((item) => {
      const id = item.get("id") as string;
      const userId = item.get("userId") as string;
      const userName = item.get("userName") as string;
      const text = item.get("text") as string;
      const timestamp = item.get("timestamp") as number;
      if (id && text !== undefined) {
        items.push({
          id,
          userId,
          userName: userName || userId,
          text,
          timestamp: timestamp || Date.now(),
        });
      }
    });
    return items;
  }

  sendMessage(text: string, userId: string, userName: string) {
    this.yDoc.transact(() => {
      const msg = new Y.Map<unknown>();
      msg.set(
        "id",
        `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      );
      msg.set("userId", userId);
      msg.set("userName", userName);
      msg.set("text", text);
      msg.set("timestamp", Date.now());
      this.messageArray.push([msg]);
    }, "chateditor");
  }
}

// ─── Editor component ──────────────────────────────────────────────────────

const ChatEditorInner: React.FC<CoreEditorProps> = ({
  client,
  docInstance,
  onBind,
}) => {
  const [binding, setBinding] = useState<ChatYjsBinding | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const prevMessageCount = useRef(0);
  const theme = client.setting.colorTheme.resultThemeColor.value;

  const userId = getAuthorization()?.payload.userId ?? "offline";
  const userName = getAuthorization()?.payload.userId ?? "User";

  // Check if user is near the bottom of the chat (within 100px)
  const isNearBottom = (): boolean => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  // Scroll to bottom
  const scrollToBottom = () => {
    const el = messagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  useEffect(() => {
    const count = messages.length;
    if (count === 0) {
      prevMessageCount.current = 0;
      return;
    }

    if (!initialScrollDone.current) {
      // First load: always scroll to bottom
      initialScrollDone.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(scrollToBottom);
      });
    } else if (count > prevMessageCount.current && isNearBottom()) {
      // New message arrived and user is near bottom: scroll down
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    }
    // If user scrolled up reading history, don't interrupt

    prevMessageCount.current = count;
  }, [messages]);

  useEffect(() => {
    if (!docInstance) {
      return;
    }

    const updateMessages = () => {
      if (binding) {
        setMessages(binding.getMessages());
      }
    };

    const newBinding = new ChatYjsBinding(docInstance.yDoc, updateMessages);
    setBinding(newBinding);
    setMessages(newBinding.getMessages());

    docInstance.editor.getOrigin = () => "chateditor";
    onBind();

    const onOfflineData = () => {
      docInstance.editor.setLoading(false);
      updateMessages();
    };

    if (docInstance.offlineDataLoaded.value) {
      onOfflineData();
    } else {
      docInstance.offlineDataLoaded.addValueChangeListener(onOfflineData);
      return () => {
        docInstance.offlineDataLoaded.removeValueChangeListener(onOfflineData);
      };
    }
  }, [docInstance, binding]);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed || !binding) return;
    binding.sendMessage(trimmed, userId, userName);
    setInputText("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const hours = d.getHours().toString().padStart(2, "0");
    const minutes = d.getMinutes().toString().padStart(2, "0");
    if (isToday) {
      return `${hours}:${minutes}`;
    }
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    return `${month}-${day} ${hours}:${minutes}`;
  };

  // Determine if consecutive messages should be grouped
  const shouldShowAvatar = (index: number): boolean => {
    if (index === 0) return true;
    return messages[index].userId !== messages[index - 1].userId;
  };

  const getUserColor = (uid: string) => {
    const { r, g, b } = hashColorWitchCache(uid);
    return `rgb(${r}, ${g}, ${b})`;
  };

  // Insert system date separator when date changes
  const renderMessages = () => {
    const elements: React.ReactNode[] = [];
    let lastDate = "";

    messages.forEach((msg, index) => {
      const msgDate = new Date(msg.timestamp).toDateString();
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        elements.push(
          <Box
            key={`date-${msgDate}`}
            sx={{
              textAlign: "center",
              my: 2,
            }}
          >
            <Typography
              variant="caption"
              sx={{
                backgroundColor: theme === "dark" ? "#333" : "#e0e0e0",
                color: "text.secondary",
                px: 2,
                py: 0.5,
                borderRadius: 4,
                fontSize: "0.75rem",
              }}
            >
              {msgDate === new Date().toDateString()
                ? i18n("chat_today") || "Today"
                : new Date(msg.timestamp).toLocaleDateString()}
            </Typography>
          </Box>,
        );
      }

      const isMe = msg.userId === userId;
      const showAvatar = shouldShowAvatar(index);
      const userColor = getUserColor(msg.userId);

      elements.push(
        <Box
          key={msg.id}
          sx={{
            display: "flex",
            flexDirection: isMe ? "row-reverse" : "row",
            alignItems: "flex-end",
            mb: showAvatar ? 1.5 : 0.25,
            px: 1,
          }}
        >
          {/* Avatar */}
          <Box sx={{ width: 32, flexShrink: 0 }}>
            {showAvatar ? (
              <Avatar
                sx={{
                  width: 28,
                  height: 28,
                  fontSize: "0.8rem",
                  bgcolor: userColor,
                }}
              >
                {msg.userName[0]?.toUpperCase() || "?"}
              </Avatar>
            ) : null}
          </Box>

          {/* Bubble */}
          <Box
            sx={{
              maxWidth: "70%",
              ml: isMe ? 0 : 0.5,
              mr: isMe ? 0.5 : 0,
            }}
          >
            {/* Sender name above first in group */}
            {showAvatar && !isMe && (
              <Typography
                variant="caption"
                sx={{
                  color: userColor,
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  ml: 1,
                  mb: 0.25,
                  display: "block",
                }}
              >
                {msg.userName}
              </Typography>
            )}

            <Paper
              elevation={0}
              sx={{
                px: 1.5,
                py: 0.75,
                borderRadius: 2,
                ...(isMe
                  ? { borderTopRightRadius: 0 }
                  : { borderTopLeftRadius: 0 }),
                backgroundColor: isMe
                  ? "primary.main"
                  : theme === "dark"
                    ? "#2d2d2d"
                    : "#f0f0f0",
                color: isMe ? "primary.contrastText" : "text.primary",
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
              }}
            >
              <Typography variant="body2">{msg.text}</Typography>
            </Paper>

            {/* Timestamp */}
            <Typography
              variant="caption"
              sx={{
                color: "text.disabled",
                fontSize: "0.65rem",
                mt: 0.25,
                display: "block",
                textAlign: isMe ? "right" : "left",
                px: 0.5,
              }}
            >
              {formatTime(msg.timestamp)}
            </Typography>
          </Box>
        </Box>,
      );
    });

    return elements;
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 160px)",
        maxWidth: "800px",
        margin: "0 auto",
        backgroundColor: theme === "dark" ? "#1a1a1a" : "#fafafa",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {/* Messages area */}
      <Box
        ref={messagesContainerRef}
        sx={{
          flex: 1,
          overflowY: "auto",
          py: 1,
          scrollbarWidth: "thin",
          scrollbarColor: "#88888833 #f1f1f100",
        }}
      >
        {messages.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
              color: "text.secondary",
            }}
          >
            <Typography variant="body2">
              {i18n("chat_empty_state") ||
                "No messages yet. Start the conversation!"}
            </Typography>
          </Box>
        ) : (
          renderMessages()
        )}
      </Box>

      {/* Input area */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderTop: `1px solid ${theme === "dark" ? "#333" : "#e0e0e0"}`,
          backgroundColor: theme === "dark" ? "#242424" : "#ffffff",
        }}
      >
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end" }}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            size="small"
            placeholder={i18n("chat_input_placeholder") || "Type a message..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: 3,
                backgroundColor: theme === "dark" ? "#2d2d2d" : "#f5f5f5",
              },
            }}
          />
          <IconButton
            color="primary"
            onClick={handleSend}
            disabled={!inputText.trim()}
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              mb: 0.25,
            }}
          >
            <SendRoundedIcon />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
};

// ─── Public wrapper ─────────────────────────────────────────────────────────

export const ChatEditor: React.FC<{ client: IClient }> = ({ client }) => {
  return <CommonEditor client={client} CoreEditor={ChatEditorInner} />;
};
