import React from "react";
import * as Y from "yjs";
import { QuillBinding } from "y-quill";
import Quill from "quill";
import QuillCursors from "quill-cursors";
import { useEffect, useRef, useState } from "react";
import { CommonEditor, CoreEditorProps } from "./CommonEditor";
import { IClient } from "../interface/Client";
import { Box, Fab } from "@mui/material";
import AccessAlarmsRoundedIcon from "@mui/icons-material/AccessAlarmsRounded";
import moment from "moment";
import { detectMobile, hashColorWitchCache } from "../utils/utils";
// @ts-expect-error No type declaration file
import MarkdownShortcuts from "quill-markdown-shortcuts";
import hljs from "highlight.js";
// @ts-expect-error No type declaration file
import QuillBetterTable from "quill-better-table";
import {
  C2S_UpdateCursorMessage,
  ClientMessageType,
  ServerMessageType,
} from "../interface/UserServerMessage";
import { MessageListener } from "./NoteDocument";
import BlotFormatter from "@enzedonline/quill-blot-formatter2";

Quill.register("modules/cursors", QuillCursors);
// Quill.register("modules/imageActions", ImageActions);
// Quill.register("modules/imageFormats", ImageFormats);
Quill.register("modules/markdownShortcuts", MarkdownShortcuts);
Quill.register(
  {
    "modules/better-table": QuillBetterTable,
  },
  true,
);
Quill.register("modules/blotFormatter2", BlotFormatter);

const allFonts = [
  "sans-serif",
  "serif",
  "monospace",
  "excalidraw",
  "lilita",
  "ComicShanns",
  "Nunito",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FontAttributor: any = Quill.import("attributors/class/font");
FontAttributor.whitelist = [...allFonts];
Quill.register(FontAttributor, true);

const bottomHeight = 300;
// Quill
const setUpQuill = (container: HTMLDivElement, yDoc: Y.Doc) => {
  // Remove old toolbar
  const oldToolbar = document.querySelector(".ql-toolbar");
  oldToolbar?.remove();

  const smallSize = screen.width <= 500;
  const icons = Quill.import("ui/icons") as { [key: string]: string };

  icons["undo"] =
    `<svg height="24px" viewBox="0 0 24 24" width="24px" class="ql-fill"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>`;
  icons["redo"] =
    `<svg height="24px" viewBox="0 0 24 24" width="24px" class="ql-fill"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>`;
  icons["tableUI"] =
    ` <svg height="24px" viewBox="0 0 24 24" width="24px" class="ql-fill"><path d="M0 0h24v24H0V0z" fill="none"/><path  d="M3 3v18h18V3H3zm8 16H5v-6h6v6zm0-8H5V5h6v6zm8 8h-6v-6h6v6zm0-8h-6V5h6v6z"/></svg>`;

  const smallToolBar = [
    "bold",
    "strike",
    { color: [] },
    { background: [] },
    // { header: [1, 2, 3, false] },
    // { list: "bullet" },
    "image",
    "clean",
    "undo",
    // "redo",
  ];
  const bigToolBar = [
    "bold",
    "italic",
    "underline",
    "strike", // toggled buttons
    { color: [] },
    { background: [] }, // dropdown with defaults from theme
    { header: [1, 2, 3, 4, 5, 6, false] },
    { list: "ordered" },
    { list: "bullet" },
    { list: "check" },
    { size: ["small", false, "large", "huge"] },
    { font: [...allFonts] },
    // { font: [] },
    { align: [] },
    "blockquote",
    "code-block",
    "link",
    "image",
    "tableUI",
    "clean", // remove formatting button
    "undo",
    "redo",
  ];

  const quill = new Quill(container, {
    modules: {
      cursors: {
        hideDelayMs: 5000,
        hideSpeedMs: 0,
        selectionChangeSource: null,
        transformOnTextChange: true,
      },
      syntax: { hljs },
      toolbar: {
        container: smallSize ? smallToolBar : bigToolBar,
        handlers: {
          undo: () => {
            quill.history.undo();
          },
          redo: () => {
            quill.history.redo();
          },
          tableUI: () => {
            const table = quill.getModule("better-table");
            (table as any)?.insertTable(3, 3);
          },
        },
      },
      history: {
        userOnly: true,
      },
      markdownShortcuts: {},
      table: false,
      "better-table": {
        operationMenu: {
          items: {
            unmergeCells: {
              text: "Another unmerge cells name",
            },
          },
        },
      },
      keyboard: {
        bindings: QuillBetterTable.keyboardBindings,
      },
      blotFormatter2: {},
    },
    placeholder: "Write some thing...",
    theme: "snow", // 'bubble' is also great
  });

  const toolbar = document.querySelector(".ql-toolbar") as HTMLDivElement;

  toolbar?.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  quill.root.spellcheck = false;

  const yText = yDoc.getText("quill");

  const binding = new QuillBinding(yText, quill);

  // Remove the selection when the iframe is blurred
  window.addEventListener("blur", () => {
    quill.blur();
  });
  return {
    quill,
    toolbar,
    binding,
  };
};

export const QuillEditorInner: React.FC<CoreEditorProps> = ({
  client,
  docInstance,
  onBind,
}) => {
  // For quill
  const [quillCtx, setQuillCtx] = useState<ReturnType<
    typeof setUpQuill
  > | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const container = editorContainerRef.current;

  useEffect(() => {
    if (!docInstance || !container) {
      return;
    }
    const dispose: (() => void)[] = [];

    const quillCtx = setUpQuill(container, docInstance.yDoc);
    docInstance.editor.getOrigin = () => quillCtx.binding;
    setQuillCtx(quillCtx);
    onBind();

    // cursor
    const updateCursor = (range: { index: number; length: number }) => {
      const message: C2S_UpdateCursorMessage = {
        messageType: ClientMessageType.updateCursor,
        messageBody: { index: range.index, length: range.length },
      };

      docInstance.bridge.wsInstance?.send(JSON.stringify(message));
      // TODO update local;
    };

    quillCtx.quill.on("selection-change", (range) => {
      if (range) {
        updateCursor?.(range);
      }
    });

    const cursorsModule = quillCtx.quill.getModule("cursors") as QuillCursors;

    const messageListener: MessageListener = (msg) => {
      if (msg.messageType === ServerMessageType.userList) {
        // clear useless cursors
        const userSet = new Set(msg.data.userList.map((u) => u.userSessionId));
        cursorsModule.cursors().forEach((c) => {
          if (!userSet.has(c.id)) {
            cursorsModule.removeCursor(c.id);
          }
        });
      } else if (msg.messageType === ServerMessageType.updateCursor) {
        if (
          !cursorsModule
            .cursors()
            .find((c) => c.id === msg.data.cursor.userSessionId)
        ) {
          const { r, g, b } = hashColorWitchCache(msg.data.cursor.userId);
          cursorsModule.createCursor(
            msg.data.cursor.userSessionId,
            msg.data.cursor.userId,
            `rgb(${r} ${g} ${b})`,
          );
        }
        cursorsModule.moveCursor(
          msg.data.cursor.userSessionId,
          msg.data.cursor.range,
        );
      }
    };

    docInstance.bridge.addMessageListener(messageListener);
    dispose.push(() => {
      docInstance.bridge.removeMessageListener(messageListener);
    });

    const afterOfflineDataLoaded = () => {
      quillCtx.toolbar.style.visibility = "visible";
      requestAnimationFrame(() => {
        quillCtx.quill.focus();
        quillCtx.quill.setSelection(quillCtx.quill.getLength(), 0);
        window.scrollTo({
          left: 0,
          top:
            document.documentElement.scrollHeight -
            document.documentElement.clientHeight -
            bottomHeight,
        });

        if (!detectMobile()) {
          setTimeout(() => {
            quillCtx.quill.focus();
            quillCtx.quill.setSelection(quillCtx.quill.getLength(), 0);
          }, 500);
        }
      });
      docInstance.editor.setLoading(false);
      docInstance.offlineDataLoaded.removeValueChangeListener(
        afterOfflineDataLoaded,
      );
    };

    if (docInstance.offlineDataLoaded.value) {
      afterOfflineDataLoaded();
    } else {
      docInstance.offlineDataLoaded.addValueChangeListener(
        afterOfflineDataLoaded,
      );
      dispose.push(() => {
        docInstance.offlineDataLoaded.removeValueChangeListener(
          afterOfflineDataLoaded,
        );
      });
    }

    return () => {
      dispose.forEach((d) => d());
    };
  }, [docInstance]);

  useEffect(() => {
    const handleColorThemeChanged = (v: "dark" | "light") => {
      if (quillCtx) {
        quillCtx.toolbar.style.backgroundColor =
          v === "dark" ? "#121212" : "#ffffff";
      }
    };

    client.setting.colorTheme.resultThemeColor.addValueChangeListener(
      handleColorThemeChanged,
    );

    handleColorThemeChanged(client.setting.colorTheme.resultThemeColor.value);

    return () => {
      client.setting.colorTheme.resultThemeColor.removeValueChangeListener(
        handleColorThemeChanged,
      );
    };
  }, [client.setting.colorTheme.resultThemeColor, quillCtx]);

  useEffect(() => {
    if (!quillCtx) {
      return;
    }

    const editorTop = document.querySelector("#editor-top") as HTMLDivElement;
    let inTop = true;
    const updateToolbar = () => {
      const editorTopValue = editorTop?.getBoundingClientRect().top;

      if (editorTopValue === undefined) {
        return;
      }

      const currentInTop = editorTopValue >= 50;

      if (currentInTop === inTop) {
        return;
      }

      if (!currentInTop) {
        quillCtx.toolbar.style.position = "fixed";
        quillCtx.toolbar.style.top = "50px";
        quillCtx.toolbar.style.width = `${
          quillCtx.quill.root.clientWidth + 2
        }px`;
        editorTop.style.height = `${quillCtx.toolbar.clientHeight}px`;
      } else {
        quillCtx.toolbar.style.position = "static";
        quillCtx.toolbar.style.width = `100%`;
        editorTop.style.height = "0px";
      }

      inTop = currentInTop;
    };

    updateToolbar();
    // FIXME: use react ref
    const element = document.getElementById("note-editor-right");
    element?.addEventListener("scroll", updateToolbar);

    return () => {
      element?.removeEventListener("scroll", updateToolbar);
    };
  }, [quillCtx]);

  useEffect(() => {
    return () => {
      docInstance?.askAutoSavingLocal();
    };
  }, [docInstance]);

  return (
    <>
      <div
        style={{
          border: "none",
          width: "100%",
        }}
        ref={editorContainerRef}
      />
      <Box
        sx={{
          height: `${bottomHeight}px`,
        }}
      />
      <Fab
        style={{
          position: "fixed",
          right: "16px",
          bottom: "168px",
        }}
        variant="circular"
        color="secondary"
        onClick={() => {
          if (!quillCtx) {
            return;
          }
          const scroll = window.scrollY;
          console.log(scroll);
          let index = quillCtx.quill.getSelection(false)?.index;
          const addTooLast = index === undefined;
          if (index === undefined) {
            index = quillCtx.quill.getLength() - 1;
          }

          const format = "YYYY-MM-DD HH:mm:ss";
          const dateTime = moment(new Date()).format(format);
          quillCtx.quill.insertText(index, `\n`);
          quillCtx.quill.insertText(index + 1, `${dateTime}`);
          quillCtx.quill.insertText(
            index + 1 + dateTime.length,
            `\n`,
            "header",
            3,
          );
          // quillCtx.quill.insertText(index + 2 + dateTime.length, ` `);

          quillCtx.quill.setSelection(index + 2 + dateTime.length, 0);
          quillCtx.quill.focus();

          if (!detectMobile() && addTooLast) {
            window.scrollTo({
              left: 0,
              top:
                document.documentElement.scrollHeight -
                document.documentElement.clientHeight -
                bottomHeight,
            });
          }
        }}
      >
        <AccessAlarmsRoundedIcon />
      </Fab>
    </>
  );
};

export const QuillEditor: React.FC<{ client: IClient }> = ({ client }) => {
  return <CommonEditor client={client} CoreEditor={QuillEditorInner} />;
};
