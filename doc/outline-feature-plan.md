# Outline (Table of Contents) Feature Plan

## Overview

Add a document outline panel to the Quill editor that displays header-level content as a navigable tree structure. The outline can be toggled on/off via a button, and its show/hide state is synchronized across collaborators via Yjs.

---

## 1. Architecture

### 1.1 Components Involved

| Component | File | Changes |
|-----------|------|---------|
| `QuillEditorInner` | `client/src/editor/QuillEditor.tsx` | Add toggle button, integrate outline panel, extract heading data |
| `OutlinePanel` (new) | `client/src/components/OutlinePanel.tsx` | New component — renders the outline tree |
| `NoteDocument` | `client/src/editor/NoteDocument.ts` | No changes needed (outline content is not stored) |

### 1.2 Yjs Data Model

A Y.Map at the top level of the document's Y.Doc stores editor-wide metadata:

```
yDoc.getMap("editor_meta")
  └── showOutline: boolean  (default: false if absent)
```

- The `showOutline` key controls whether the outline panel is visible.
- Old documents without this key default to `false` (hidden).
- Changes to `showOutline` propagate to other collaborators via Yjs.

### 1.3 Data Flow

```
Quill Content (Y.Text "quill")
    │
    ▼  (extract headings on: toggle-on, doc-update [throttled], load)
OutlinePanel (React state: array of heading info)
    │
    ▼  (user clicks heading)
Quill.setSelection(…) + scrollIntoView
```

The outline content is **never persisted** — it is derived each time from the Quill document.

---

## 2. New File: `client/src/components/OutlinePanel.tsx`

### 2.1 Props

```typescript
interface OutlinePanelProps {
  headings: HeadingInfo[];
  onHeadingClick: (index: number) => void;
  isDark: boolean;
}
```

### 2.2 HeadingInfo

```typescript
interface HeadingInfo {
  text: string;       // heading text (plain, stripped of formatting)
  level: number;      // 1–6
  index: number;      // Quill document index (character offset)
}
```

### 2.3 Visual Design

- **Indentation**: Each heading level increases left padding by 8px (level 1 = 0px, level 2 = 8px, level 3 = 16px, etc.).
- **Font sizing**: Uniform across all heading levels (no font-size variation). Use a single fixed font size for all outline items.
- **Divider**: A horizontal separator line (bottom border) separates the outline area from the document body below.
- **Colors (light mode)**:
  - Background: `#f5f5f5` (slightly different from body `#fff`)
  - Text: `#555`
  - Hover: `#e0e0e0`
  - Border (bottom): `#e0e0e0`
- **Colors (dark mode)**:
  - Background: `#222` (slightly different from body `#1a1a1a`)
  - Text: `#bbb`
  - Hover: `#333`
  - Border (bottom): `#333`
- **Typography**: Each heading line has a pointer cursor and uniform font size.
- **Scroll**: The outline area has a max-height (~300px) and scrolls independently if it overflows, so it does not push the editor too far down.

### 2.4 Interaction

- Clicking a heading calls `onHeadingClick(heading.index)`, which in `QuillEditorInner` sets the Quill selection to that index and scrolls it into view.

---

## 3. Changes to `QuillEditorInner` (`client/src/editor/QuillEditor.tsx`)

### 3.1 New State & Refs

- `showOutline: boolean` — controlled by the Yjs `editor_meta.get("showOutline")` value
- `headings: HeadingInfo[]` — derived from Quill content
- `outlineRefreshThrottle` — throttle timer (lodash `throttle` with 5000ms)

### 3.2 Heading Extraction

Implement a function `extractHeadings(quill: Quill): HeadingInfo[]`:

```typescript
function extractHeadings(quill: Quill): HeadingInfo[] {
  const contents = quill.getContents();
  const headings: HeadingInfo[] = [];
  let offset = 0;
  
  for (const op of contents.ops) {
    if (op.insert && typeof op.insert === 'object' && op.insert.header) {
      // This is a header — collect the text
      // Need to find subsequent text ops to build the full heading text
    }
    // accumulate offset
  }
  
  return headings;
}
```

Alternative simpler approach: query the DOM.

```typescript
function extractHeadings(quill: Quill): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const editorElement = quill.root;
  const headerElements = editorElement.querySelectorAll('h1, h2, h3, h4, h5, h6');
  
  headerElements.forEach((el) => {
    const level = parseInt(el.tagName[1]); // 'H1' → 1
    const text = el.textContent?.trim() || '';
    if (text) {
      // Get the Quill index using quill.getIndex() or by traversing the DOM
      const blot = Quill.find(el);
      if (blot) {
        const offset = quill.getIndex(blot);
        headings.push({ text, level, index: offset });
      }
    }
  });
  
  return headings;
}
```

### 3.3 Toggle Button

- Position: At the top of the document area, inside the editor container (above or next to the title area).
- Two possible locations:
  - **Option A**: In the `CommonEditor` title bar area (to the left of the user avatars).
  - **Option B**: Inside `QuillEditorInner`, floated above the Quill editor.
- **Recommendation**: Option A — add it to the title bar in `CommonEditor`, passing the toggle handler via `CoreEditorProps` or a new callback. This keeps the outline button visible even when the editor itself hasn't loaded yet, and keeps it outside the Quill container.

  However, since `CommonEditor` is shared by all editor types (`TodoListEditor`, `ExcalidrawCanvas`), the outline button should only show for the Quill editor. We can add an optional `outlineToggle?: { showOutline: boolean; onToggle: () => void }` prop via `CoreEditorProps`.

  Actually, simpler: put the toggle button directly in `QuillEditorInner`. Place it above the Quill container, so it's always visible.

### 3.4 Outline Refresh Triggers

1. **When [Show Outline] is clicked** (outline toggled ON): refresh immediately.
2. **On Yjs data changes** (when outline is shown): refresh with throttle (5s). Listen via:
   ```typescript
   yDoc.on("update", (update, origin) => {
     if (origin !== "remote" && origin !== binding) return;
     if (showOutline) throttledRefresh();
   });
   ```
   Alternatively, use Quill's `text-change` event.
3. **On load** (when outline is shown and doc data finishes loading): refresh.

### 3.5 Yjs Synchronization for `showOutline`

In `QuillEditorInner`'s `useEffect` (when `docInstance` is available):

```typescript
const editorMeta = docInstance.yDoc.getMap("editor_meta");
// Observe changes
const handleMetaChange = () => {
  setShowOutline(editorMeta.get("showOutline") === true);
};
editorMeta.observe(handleMetaChange);

// Set initial value (default false for old docs)
const initialShow = editorMeta.get("showOutline") ?? false;
setShowOutline(initialShow);

// Toggle handler
const toggleOutline = () => {
  editorMeta.set("showOutline", !showOutline);
};
```

---

## 4. Throttling Strategy

Use `lodash.throttle` (already in `package.json` dependencies):

```typescript
import throttle from "lodash.throttle";

const throttledRefresh = useMemo(
  () => throttle(() => {
    if (quillCtx) {
      setHeadings(extractHeadings(quillCtx.quill));
    }
  }, 5000, { leading: true, trailing: true }),
  [quillCtx]
);
```

- `leading: true` — first call fires immediately.
- `trailing: true` — last queued call fires after the 5s window.
- `useMemo` ensures the throttled function is stable across renders.

---

## 5. Layout Integration

### 5.1 When Outline is Hidden

The editor takes full width as before. Only the toggle button is visible.

### 5.2 When Outline is Shown

Top-panel layout — full width of the editor area, placed above the editor:
```
┌──────────────────────────────────────────────────┐
│  [Toggle Button: Hide Outline]                   │
├──────────────────────────────────────────────────┤
│  Outline Panel (full width, max-height ~300px)   │
│                                                  │
│  H1: Title                                       │
│    H2: Sub                                       │
│    H2: Sub                                       │
│  H1: Title2                                      │
│                                                  │
├──────────────────────────────────────────────────┤
│  Quill Editor                                    │
│                                                  │
└──────────────────────────────────────────────────┘
```

The outline panel sits at the top of the editor area, spans the full width, and has a max-height with its own scrollbar if content overflows. A visual separator (bottom border) separates it from the Quill editor below.

### 5.3 Implementation in `QuillEditorInner`

```tsx
return (
  <>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Button onClick={toggleOutline}>
        {showOutline ? "Hide Outline" : "Show Outline"}
      </Button>
    </Box>
    {showOutline && (
      <OutlinePanel
        headings={headings}
        onHeadingClick={handleHeadingClick}
        isDark={theme === "dark"}
      />
    )}
    <div ref={editorContainerRef} style={{ border: "none", width: "100%" }} />
    {/* ... rest of existing UI (bottom spacer, timestamp FAB) ... */}
  </>
);
```

---

## 6. Click-to-Navigate Implementation

```typescript
const handleHeadingClick = (index: number) => {
  if (!quillCtx) return;
  quillCtx.quill.setSelection(index, 0);
  quillCtx.quill.focus();
  // Optionally scroll the heading into view if needed
};
```

Note: `setSelection(index, 0)` should naturally scroll the heading into view since Quill handles that internally. If not, add `quillCtx.quill.root.querySelector('...')?.scrollIntoView()?`.

---

## 7. Light/Dark Mode

- The `OutlinePanel` receives `isDark: boolean` prop.
- Color values are determined by this prop (see section 2.3).
- The existing `client.setting.colorTheme.resultThemeColor` is already observed in `QuillEditorInner`, so reusing that value.

---

## 8. Edge Cases & Considerations

1. **Empty Document**: If no headings exist, the outline panel shows a "No headings" message (or is empty).
2. **Very Long Headings**: Truncate with ellipsis (`text-overflow: ellipsis`).
3. **Rapid Toggling**: No issues — just show/hide the panel, no data loss.
4. **Collaborative Editing**: Another user toggling the outline will sync via Yjs and show/hide on other clients. The heading content itself may change due to remote edits — the throttled refresh handles this.
5. **Performance**: Throttling at 5s prevents excessive DOM queries on rapid typing. For very large documents, the heading extraction via DOM query is efficient.

---

## 9. Implementation Checklist

- [ ] 1. Create `client/src/components/OutlinePanel.tsx` component
- [ ] 2. Implement `extractHeadings()` function
- [ ] 3. Add `showOutline` Yjs state management in `QuillEditorInner`
- [ ] 4. Add toggle button in `QuillEditorInner` render
- [ ] 5. Wire up outline refresh triggers (toggle-on, data-change throttled, load)
- [ ] 6. Implement click-to-navigate handler
- [ ] 7. Style for light/dark mode
- [ ] 8. Add layout integration (top panel, full width)
- [ ] 9. Test with collaborative editing scenarios
