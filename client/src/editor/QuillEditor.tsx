import React from "react";
import * as Y from "yjs";
import { QuillBinding } from "y-quill";
import Quill, { Parchment } from "quill";
import QuillCursors from "quill-cursors";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommonEditor, CoreEditorProps } from "./CommonEditor";
import { IClient } from "../interface/Client";
import { Box, Dialog, Fab, Tooltip } from "@mui/material";
import AccessAlarmsRoundedIcon from "@mui/icons-material/AccessAlarmsRounded";
import TocRoundedIcon from "@mui/icons-material/TocRounded";
import moment from "moment";
import { detectMobile, hashColorWitchCache } from "../utils/utils";
import { i18n } from "../internationnalization/utils";
import throttle from "lodash.throttle";
import { ShortcutManager } from "../utils/ShortcutManager";

// @ts-expect-error No type declaration file
import QuillBetterTable from "quill-better-table";

// Fix: quill-markdown-shortcuts was built for Quill 1.x (blots/block/embed).
// Quill 2.0 removed the hr blot — register a proper one before the plugin loads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BlockBlot: any = Quill.import("blots/block");
class HorizontalRule extends BlockBlot {
  static blotName = "hr";
  static tagName = "hr";
}
Quill.register({ "formats/hr": HorizontalRule }, true);

// @ts-expect-error No type declaration file
import MarkdownShortcuts from "quill-markdown-shortcuts";

// Patch: prevent markdown shortcuts from firing inside code blocks.
// Quill 2 renders code-block lines as <div class="ql-code-block"> inside
// <div class="ql-code-block-container">, not <pre>, so the plugin's
// ignoreTags = ['PRE'] check misses them entirely.
//
// We use a lightweight DOM check (closest()) instead of quill.getFormat()
// to avoid the overhead of format-collection on every space/enter keystroke.
{
  const origIsValid = MarkdownShortcuts.prototype.isValid;
  MarkdownShortcuts.prototype.isValid = function patchedIsValid(
    text: string,
    tagName: string,
  ) {
    if (!origIsValid.call(this, text, tagName)) return false;
    // Check if the cursor is inside a code-block container via the native DOM.
    // This is O(depth) DOM traversal (typically 1-2 levels) and avoids
    // any Quill API overhead (getFormat / getLine tree traversal).
    try {
      const nativeSel = window.getSelection();
      if (nativeSel && nativeSel.rangeCount > 0) {
        const node = nativeSel.getRangeAt(0).startContainer;
        if (node?.parentElement?.closest(".ql-code-block-container")) {
          return false;
        }
      }
    } catch {
      // Ignore errors
    }
    return true;
  };
}

import hljs from "highlight.js";
import ImageCompress from "quill-image-compress";
import {
  C2S_UpdateCursorMessage,
  ClientMessageType,
  ServerMessageType,
} from "../interface/UserServerMessage";
import { MessageListener } from "./NoteDocument";
import { HeadingInfo, OutlinePanel } from "../components/OutlinePanel";
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
Quill.register("modules/imageCompress", ImageCompress);

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
            (
              table as { insertTable: (rows: number, cols: number) => void }
            )?.insertTable(3, 3);
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
      imageCompress: {
        quality: 0.7, // default is 0.7
        maxWidth: 1000,
        maxHeight: 1000,
        imageType: "image/jpeg",
        debug: false,
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

  // Block backspace at offset 0 inside table cells.
  // quill-better-table's built-in keyboard bindings rely on format checks
  // that may not match reliably. We add our own binding that explicitly
  // checks the blot name and runs before all other Backspace handlers.
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyboard = quill.getModule("keyboard") as any;
    keyboard.addBinding(
      { key: "Backspace" },
      { collapsed: true, offset: 0 },
      function (
        this: { quill: Quill },
        range: { index: number; length: number },
      ) {
        const [line] = this.quill.getLine(range.index);
        if (
          line &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (line.constructor as any).blotName === "table-cell-line"
        ) {
          return false; // block backspace — don't delete cells or merge with outside content
        }
        return true; // not in a table cell, let other bindings handle it
      },
    );
    // Move our binding to the front so it's checked first.
    const bindings = keyboard.bindings["Backspace"];
    if (bindings && bindings.length > 0) {
      const ourBinding = bindings.pop();
      bindings.unshift(ourBinding);
    }
  }

  const yText = yDoc.getText("quill");

  const binding = new QuillBinding(yText, quill);

  return {
    quill,
    toolbar,
    binding,
  };
};

/**
 * Extract headings from the Quill editor DOM.
 * Returns an array of HeadingInfo sorted by document position.
 */
const extractHeadings = (quill: Quill): HeadingInfo[] => {
  const headings: HeadingInfo[] = [];
  const editorElement = quill.root;
  const headerElements = editorElement.querySelectorAll(
    "h1, h2, h3, h4, h5, h6",
  );

  headerElements.forEach((el) => {
    const level = parseInt(el.tagName[1]); // 'H1' -> 1
    const text = el.textContent?.trim() || "";
    if (text) {
      const blot = Quill.find(el) as Parchment.Blot | null;
      if (blot) {
        const offset = quill.getIndex(blot);
        headings.push({ text, level, index: offset });
      }
    }
  });

  return headings;
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

  // Outline state — now rendered in a Dialog; state is local, not persisted
  const [showOutline, setShowOutline] = useState(false);
  const [headings, setHeadings] = useState<HeadingInfo[]>([]);
  const [scrollToHeadingIndex, setScrollToHeadingIndex] = useState<
    number | undefined
  >(undefined);
  const [isDark, setIsDark] = useState(
    client.setting.colorTheme.resultThemeColor.value === "dark",
  );

  // Throttled heading extraction (at most once every 5 seconds).
  // Uses a ref so the throttle is properly cancelled when quillCtx changes
  // (e.g., switching documents), preventing stale Quill references from firing.
  const throttledRefreshRef = useRef<ReturnType<typeof throttle> | null>(null);
  const showOutlineRef = useRef(showOutline);
  showOutlineRef.current = showOutline;

  useEffect(() => {
    // Cancel any pending throttle from a previous Quill instance
    throttledRefreshRef.current?.cancel();
    throttledRefreshRef.current = throttle(
      () => {
        setHeadings(extractHeadings(quillCtx!.quill));
      },
      5000,
      { leading: true, trailing: true },
    );
    return () => {
      throttledRefreshRef.current?.cancel();
      throttledRefreshRef.current = null;
    };
  }, [quillCtx]);

  // Clear headings when switching documents (avoid showing old doc's outline)
  useEffect(() => {
    setHeadings([]);
  }, [docInstance]);

  // Refresh outline when showOutline toggles on
  useEffect(() => {
    if (showOutline && quillCtx) {
      setHeadings(extractHeadings(quillCtx.quill));

      // Find the first heading visible in the editor viewport so the
      // outline can scroll to it — works even when editor isn't focused.
      const scrollContainer = document.getElementById("note-editor-right");
      if (scrollContainer) {
        const containerTop = scrollContainer.getBoundingClientRect().top;
        const headerEls = quillCtx.quill.root.querySelectorAll(
          "h1, h2, h3, h4, h5, h6",
        );
        let target: number | undefined;
        for (const el of headerEls) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom > containerTop) {
            const blot = Quill.find(el) as Parchment.Blot | null;
            if (blot) {
              target = quillCtx.quill.getIndex(blot);
            }
            break;
          }
        }
        setScrollToHeadingIndex(target);
      }
    } else if (!showOutline) {
      setScrollToHeadingIndex(undefined);
    }
  }, [showOutline, quillCtx]);

  // Listen for Yjs data changes and refresh outline (throttled)
  useEffect(() => {
    if (!docInstance || !quillCtx) return;

    const handleUpdate = () => {
      if (showOutlineRef.current) {
        throttledRefreshRef.current?.();
      }
    };

    docInstance.yDoc.on("update", handleUpdate);
  }, [docInstance, quillCtx]);

  // Inject the shake keyframes once.
  useEffect(() => {
    const styleId = "outline-shake-style";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes outline-shake {
        0%, 100% { transform: translateX(0); }
        10%      { transform: translateX(-6px); }
        30%      { transform: translateX(6px); }
        50%      { transform: translateX(-4px); }
        70%      { transform: translateX(4px); }
        90%      { transform: translateX(-2px); }
      }
      .outline-shake {
        animation: outline-shake 0.5s ease-in-out;
      }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  const handleHeadingClick = useCallback(
    (index: number) => {
      if (!quillCtx) return;
      quillCtx.quill.setSelection(index, 0);
      quillCtx.quill.focus();

      requestAnimationFrame(() => {
        // Find the heading block blot; its domNode is the <h1>…<h6> element
        const [line] = quillCtx.quill.getLine(index);
        if (line && line.domNode instanceof HTMLElement) {
          line.domNode.scrollIntoView({ behavior: "smooth", block: "center" });
          // Apply horizontal shake after the smooth-scroll settles
          setTimeout(() => {
            const el = line.domNode as HTMLElement;
            el.classList.add("outline-shake");
            const onEnd = () => {
              el.classList.remove("outline-shake");
              el.removeEventListener("animationend", onEnd);
            };
            el.addEventListener("animationend", onEnd);
          }, 400);
        }
      });
    },
    [quillCtx],
  );

  const toggleOutline = useCallback(() => {
    setShowOutline(!showOutline);
  }, [showOutline]);

  // Stable ref for quillCtx so callbacks/handlers can always read the latest instance
  const quillCtxRef = useRef(quillCtx);
  quillCtxRef.current = quillCtx;

  // Shared handler for inserting date/time — used by both the FAB and the keyboard shortcut
  const handleInsertDateTime = useCallback(() => {
    const ctx = quillCtxRef.current;
    if (!ctx) return;

    let index = ctx.quill.getSelection(false)?.index;
    const addTooLast = index === undefined;
    if (index === undefined) {
      index = ctx.quill.getLength() - 1;
    }

    const format = "YYYY-MM-DD HH:mm:ss";
    const dateTime = moment(new Date()).format(format);
    ctx.quill.insertText(index, `\n`);
    ctx.quill.insertText(index + 1, `${dateTime}`);
    ctx.quill.insertText(index + 1 + dateTime.length, `\n`, "header", 3);
    ctx.quill.setSelection(index + 2 + dateTime.length, 0);
    ctx.quill.focus();

    if (!detectMobile() && addTooLast) {
      window.scrollTo({
        left: 0,
        top:
          document.documentElement.scrollHeight -
          document.documentElement.clientHeight -
          bottomHeight,
      });
    }
  }, []);

  useEffect(() => {
    if (!docInstance || !container) {
      return;
    }
    const dispose: (() => void)[] = [];

    const quillCtx = setUpQuill(container, docInstance.yDoc);
    docInstance.editor.getOrigin = () => quillCtx.binding;
    setQuillCtx(quillCtx);
    onBind();

    // editor_meta was previously used to persist showOutline state;
    // showOutline is now local (in a dialog), so editorMeta is no longer needed.

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
      // Refresh outline after data is loaded
      setHeadings(extractHeadings(quillCtx.quill));
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
      setIsDark(v === "dark");
      if (quillCtx) {
        // Toolbar background
        quillCtx.toolbar.style.backgroundColor =
          v === "dark" ? "#1a1a1a" : "#fff";

        const editorElement = quillCtx.quill.root;
        if (editorElement) {
          const isDark = v === "dark";

          // Toggle dark mode class for CSS overrides
          if (isDark) {
            editorElement.classList.add("ql-dark-mode");
          } else {
            editorElement.classList.remove("ql-dark-mode");
          }

          // ── Body ──
          editorElement.style.setProperty(
            "--ql-body-color",
            isDark ? "#d4cfc4" : "#2d2a28",
          );
          editorElement.style.setProperty(
            "--ql-body-bg",
            isDark ? "#1a1a1a" : "#fff",
          );

          // ── Headings ──
          editorElement.style.setProperty(
            "--ql-h1-color",
            isDark ? "#f0f0f0" : "#1a1a1a",
          );
          editorElement.style.setProperty(
            "--ql-h2-color",
            isDark ? "#e0e0e0" : "#2a2a2a",
          );
          editorElement.style.setProperty(
            "--ql-h3-color",
            isDark ? "#d0d0d0" : "#3d3d3d",
          );
          editorElement.style.setProperty(
            "--ql-h4-color",
            isDark ? "#c0c0c0" : "#4f4f4f",
          );
          editorElement.style.setProperty(
            "--ql-h5-color",
            isDark ? "#b0b0b0" : "#616161",
          );
          editorElement.style.setProperty(
            "--ql-h6-color",
            isDark ? "#a0a0a0" : "#737373",
          );

          // ── Blockquote ──
          editorElement.style.setProperty(
            "--ql-blockquote-border",
            isDark ? "#777" : "#999",
          );
          editorElement.style.setProperty(
            "--ql-blockquote-bg",
            isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
          );
          editorElement.style.setProperty(
            "--ql-blockquote-color",
            isDark ? "#aaa" : "#555",
          );

          // ── Links ──
          editorElement.style.setProperty(
            "--ql-link-color",
            isDark ? "#999" : "#555",
          );
          editorElement.style.setProperty(
            "--ql-link-hover-color",
            isDark ? "#ccc" : "#1a1a1a",
          );

          // ── Code ──
          editorElement.style.setProperty(
            "--ql-code-bg",
            isDark ? "#2a2a2a" : "#f0f0f0",
          );
          editorElement.style.setProperty(
            "--ql-code-color",
            isDark ? "#bbb" : "#333",
          );
          editorElement.style.setProperty(
            "--ql-code-block-bg",
            isDark ? "#1e1e1e" : "#f8f6f2",
          );
          editorElement.style.setProperty(
            "--ql-code-block-color",
            isDark ? "#d4cfc4" : "#2d2a28",
          );
          editorElement.style.setProperty(
            "--ql-code-block-border",
            isDark ? "1px solid #33302d" : "1px solid #e8e5df",
          );

          // ── Lists ──
          editorElement.style.setProperty(
            "--ql-list-marker-color",
            isDark ? "#777" : "#888",
          );

          // ── Tables ──
          editorElement.style.setProperty(
            "--ql-table-border",
            isDark ? "#33302d" : "#e0dcd5",
          );
          editorElement.style.setProperty(
            "--ql-table-header-bg",
            isDark ? "#252320" : "#f5f3ef",
          );

          // ── Misc ──
          editorElement.style.setProperty(
            "--ql-hr-color",
            isDark ? "#33302d" : "#e8e5df",
          );
          editorElement.style.setProperty(
            "--ql-toolbar-bg",
            isDark ? "#1a1a1a" : "#fff",
          );
          editorElement.style.setProperty(
            "--ql-toolbar-border",
            isDark ? "#33302d" : "#e8e5df",
          );
          editorElement.style.setProperty(
            "--ql-toolbar-hover",
            isDark ? "#2a2a2a" : "#f5f5f5",
          );
          editorElement.style.setProperty(
            "--ql-toolbar-active",
            isDark ? "#ccc" : "#333",
          );
          editorElement.style.setProperty(
            "--ql-toolbar-icon",
            isDark ? "#999" : "#555",
          );
        }
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

  // -- Vim-style cursor movement (Ctrl+H/J/K/L) --
  // Registered directly on the Quill editor root to bypass the ShortcutManager's
  // Ctrl→Cmd normalization on Mac, which would map Ctrl+H → Cmd+H (system hide-app).
  useEffect(() => {
    if (!quillCtx) return;

    const editorRoot = quillCtx.quill.root;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when Ctrl is pressed (not Cmd), and no Shift/Alt modifiers
      if (!e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

      const { quill } = quillCtxRef.current!;
      const range = quill.getSelection();

      switch (e.key.toLowerCase()) {
        case "h": {
          // Move cursor left
          e.preventDefault();
          if (range && range.index > 0) {
            quill.setSelection(range.index - 1, 0);
          }
          break;
        }
        case "l": {
          // Move cursor right
          e.preventDefault();
          const idx = range ? range.index : 0;
          const maxIdx = quill.getLength() - 1;
          if (idx < maxIdx) {
            quill.setSelection(idx + 1, 0);
          }
          break;
        }
        case "k": {
          // Move cursor up to previous line
          e.preventDefault();
          if (range) {
            const [line, offset] = quill.getLine(range.index);
            if (line && line.prev) {
              const prevIndex = quill.getIndex(line.prev);
              const prevLen = line.prev.length();
              const newOffset = Math.min(offset, Math.max(0, prevLen - 1));
              quill.setSelection(prevIndex + newOffset, 0);
            }
          }
          break;
        }
        case "j": {
          // Move cursor down to next line
          e.preventDefault();
          if (range) {
            const [line, offset] = quill.getLine(range.index);
            if (line && line.next) {
              const nextIndex = quill.getIndex(line.next);
              const nextLen = line.next.length();
              const newOffset = Math.min(offset, Math.max(0, nextLen - 1));
              quill.setSelection(nextIndex + newOffset, 0);
            }
          }
          break;
        }
      }
    };

    editorRoot.addEventListener("keydown", handleKeyDown);
    return () => {
      editorRoot.removeEventListener("keydown", handleKeyDown);
    };
  }, [quillCtx]);

  // -- Outline toggle shortcut (Ctrl+Shift+O / Cmd+Shift+O) --
  useEffect(() => {
    const manager = ShortcutManager.getInstance();
    if (!manager["isInitialized"]) manager.initialize();

    const toggleOutlineHandler = () => {
      setShowOutline((prev) => !prev);
    };

    const idWin = "quill-toggle-outline";
    const idMac = "quill-toggle-outline-mac";

    manager.register({
      id: idWin,
      description: "Toggle outline panel",
      keyCombo: "Ctrl+Shift+O",
      handler: toggleOutlineHandler,
      preventDefault: true,
      onlyInEditor: true,
    });

    manager.register({
      id: idMac,
      description: "Toggle outline panel (Mac)",
      keyCombo: "Cmd+Shift+O",
      handler: toggleOutlineHandler,
      preventDefault: true,
      onlyInEditor: true,
    });

    return () => {
      manager.unregister(idWin);
      manager.unregister(idMac);
    };
  }, []);

  // -- Insert date/time shortcut (Ctrl+Shift+D / Cmd+Shift+D) --
  useEffect(() => {
    const manager = ShortcutManager.getInstance();
    if (!manager["isInitialized"]) manager.initialize();

    const idWin = "quill-insert-datetime";
    const idMac = "quill-insert-datetime-mac";

    manager.register({
      id: idWin,
      description: "Insert current date and time",
      keyCombo: "Ctrl+Shift+D",
      handler: handleInsertDateTime,
      preventDefault: true,
      onlyInEditor: true,
    });

    manager.register({
      id: idMac,
      description: "Insert current date and time (Mac)",
      keyCombo: "Cmd+Shift+D",
      handler: handleInsertDateTime,
      preventDefault: true,
      onlyInEditor: true,
    });

    return () => {
      manager.unregister(idWin);
      manager.unregister(idMac);
    };
  }, [handleInsertDateTime]);

  return (
    <>
      <Dialog
        open={showOutline}
        onClose={toggleOutline}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            maxHeight: "80vh",
          },
        }}
      >
        <OutlinePanel
          headings={headings}
          onHeadingClick={(index) => {
            handleHeadingClick(index);
            toggleOutline();
          }}
          onClose={toggleOutline}
          isDark={isDark}
          scrollToIndex={scrollToHeadingIndex}
        />
      </Dialog>
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
      <Tooltip
        title={showOutline ? i18n("hide_outline") : i18n("show_outline")}
        placement="left"
      >
        <Fab
          style={{
            position: "fixed",
            right: "12px",
            bottom: "184px",
          }}
          size="small"
          variant="circular"
          color={showOutline ? "primary" : "default"}
          onClick={toggleOutline}
        >
          <TocRoundedIcon fontSize="small" />
        </Fab>
      </Tooltip>
      <Fab
        style={{
          position: "fixed",
          right: "12px",
          bottom: "132px",
        }}
        size="small"
        variant="circular"
        color="secondary"
        onClick={handleInsertDateTime}
      >
        <AccessAlarmsRoundedIcon fontSize="small" />
      </Fab>
    </>
  );
};

export const QuillEditor: React.FC<{ client: IClient }> = ({ client }) => {
  return <CommonEditor client={client} CoreEditor={QuillEditorInner} />;
};
