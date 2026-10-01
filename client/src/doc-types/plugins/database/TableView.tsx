import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Button,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MenuList,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import DriveFileRenameOutlineRoundedIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import FormatListBulletedRoundedIcon from "@mui/icons-material/FormatListBulletedRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import SwapHorizRoundedIcon from "@mui/icons-material/SwapHorizRounded";
import { i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import { GlobalSnackBar } from "../../../components/common/GlobalSnackBar";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog";
import { cardTitle, cardTitleProperty } from "./cards";
import { CellEditor, type CellEditorCallbacks } from "./CellEditor";
import { CellDisplay } from "./cells";
import {
  CREATABLE_PROPERTY_TYPES,
  getPropertyTypeMeta,
  isOptionPropType,
} from "./propertyTypes";
import { OptionsEditorDialog } from "./OptionsEditor";
import { computeMoveAnchor, isAfterMidpoint } from "./reorder";
import {
  columnWidthOf,
  DEFAULT_COLUMN_WIDTH,
  frozenOffsets,
  isFrozenBoundary,
  MIN_COLUMN_WIDTH,
  resizedWidth,
} from "./columnLayout";
import { previewRetype, type PlainValue } from "./retype";
import type { DatabaseBinding } from "./model";
import type { PropType, PropertyDef, RowData } from "./types";

/**
 * The table view.
 *
 * Cells render the shared `CellEditor` components, so editing here and in the
 * record panel are literally the same component. Editing is done **in place**:
 * opening a panel for a ten-character note would be three clicks where one will do,
 * and the panel remains available for full-record editing via the row handle.
 *
 * The table is hand-rolled on MUI's primitives rather than using `@mui/x-data-grid`,
 * which is not a dependency and brings its own theming that fights the app's.
 */

/**
 * The table's per-row actions (duplicate, delete).
 *
 * Hidden until the row is hovered: two identical icon buttons on every row turn a
 * short table into a stripe of buttons, and neither action is something the eye
 * needs to find repeatedly.
 */
const rowActionSx = {
  transition: "opacity 0.15s",
  color: "text.disabled",
  // Hidden only where there is a pointer that can hover to reveal them. On a touch
  // screen `:hover` never fires, so an always-transparent button would be
  // unreachable rather than merely quiet.
  "@media (hover: hover)": { opacity: 0 },
} as const;

/**
 * The style that makes a cell part of the frozen run.
 *
 * `position: sticky` inside the table's scroll container, offset by the total width of the
 * frozen columns **in front of** it — their widths, not this one's, or every frozen column
 * would sit where the first one does.
 *
 * The background must be **opaque**. A sticky cell otherwise lets the columns scrolling
 * underneath show through it, which reads as the text overlapping rather than as two
 * layers. The theme's own tints are translucent, so the body uses the paper colour and the
 * header composites its tint over it.
 *
 * `zIndex: 2` on both the header and the body: they never overlap each other, so one value
 * is enough, and it puts the frozen run above the columns scrolling under it.
 *
 * A cell that is **not** frozen is `position: relative` — and that is load-bearing rather
 * than cosmetic. It is the containing block for the resize handle, which is absolutely
 * positioned; against a `static` cell the handle's `right` resolves against some ancestor
 * far up the tree and it renders hundreds of pixels from the column it belongs to, leaving
 * the column resizable only by the frozen ones.
 */
const frozenCellSx = (isFrozen: boolean, left: number | undefined) =>
  isFrozen
    ? ({
        position: "sticky",
        left: left ?? 0,
        zIndex: 2,
        backgroundColor: "background.paper",
      } as const)
    : ({ position: "relative" } as const);

/**
 * The header cell's background, opaque when the cell is frozen.
 *
 * The two are written together because the default is a pair — a translucent tint with no
 * image — and setting only one of them is how a frozen header ends up see-through: the
 * tint alone does not hide the columns scrolling beneath it.
 */
const headerCellBackgroundSx = (isFrozen: boolean) =>
  isFrozen
    ? ({
        backgroundColor: "background.paper",
        backgroundImage: (theme: Theme) =>
          `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})`,
      } as const)
    : ({ backgroundColor: "action.hover", backgroundImage: "none" } as const);

/**
 * A column's own vertical edges, resolved in one place for the header and the body.
 *
 * The two must agree: the seam that marks a frozen run is one continuous line down the
 * whole table, and a header drawing it 2px where the body draws it 1px leaves the edges
 * visibly out of step.
 *
 * Three things want a cell's right edge, and their precedence is the point of resolving
 * them together: the column-drag drop indicator (a response to what the user is doing
 * **now**), the frozen seam (fixture), and the default (nothing). The drag indicator wins,
 * because it vanishes the moment the drag ends, and a drop target the user cannot see is
 * one they cannot aim at.
 */
const columnEdgeSx = (options: {
  isFrozenSeam: boolean;
  showDropBefore: boolean;
  showDropAfter: boolean;
}): Record<string, unknown> => ({
  ...(options.showDropBefore
    ? { borderLeft: "2px solid", borderLeftColor: "primary.main" }
    : {}),
  ...(options.showDropAfter
    ? { borderRight: "2px solid", borderRightColor: "primary.main" }
    : options.isFrozenSeam
      ? { borderRight: "2px solid", borderRightColor: "divider" }
      : {}),
});

/** Click-to-edit cell: shows the rendered value until focused, then the editor. */
const EditableCell: React.FC<{
  property: PropertyDef;
  row: RowData;
  binding: DatabaseBinding;
  readOnly: boolean;
  callbacks: CellEditorCallbacks;
  onOpenRecord: () => void;
  /**
   * Whether this cell hosts the row's affordances: the drag handle and the "open
   * record" button.
   *
   * Exactly one cell per row carries them (the first visible column) so the row
   * reads as a unit. Gating them on the cell's *type* or on whether it holds text
   * would make the record panel unreachable for an empty row — which is precisely
   * when a user most wants to open it and fill the record in.
   */
  isRowHandle?: boolean;
  /** Starts a row drag; only meaningful on the handle cell. */
  onDragStart?: (event: React.DragEvent) => void;
  onDragEnd?: () => void;
}> = ({
  property,
  row,
  binding,
  readOnly,
  callbacks,
  onOpenRecord,
  isRowHandle,
  onDragStart,
  onDragEnd,
}) => {
  const [editing, setEditing] = useState(false);
  const value = row.values[property.id];
  const text = binding.getText(row, property.id);

  // Direct-edit types need no separate display state: one click is the edit.
  const isDirectEdit =
    property.type === "checkbox" ||
    property.type === "select" ||
    property.type === "multi-select" ||
    property.type === "date";

  const showEditor = editing || isDirectEdit;

  /**
   * Whether the editor being rendered was opened by a click on the display value.
   *
   * Used to focus the field on mount, so that one click both reveals the editor and
   * puts the caret in it. Without it a text cell took two clicks — the first mounted
   * the field, and only the second landed in it — while a select or date cell took
   * one, because those open their own picker on the click itself.
   *
   * Only the click-opened case: a cell that starts out in edit mode (the direct-edit
   * types, whose editor is always mounted) must not steal focus on every render.
   */
  const focusOnMount = editing && !isDirectEdit;

  // Close the inline editor when the row changes underneath (e.g. it was deleted).
  useEffect(() => {
    setEditing(false);
  }, [row.id]);

  if (readOnly) {
    return (
      <Box
        sx={{
          px: 2,
          py: 0.5,
          minHeight: 32,
          display: "flex",
          alignItems: "center",
        }}
      >
        <CellDisplay property={property} value={value} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: 32,
        display: "flex",
        alignItems: "center",
        position: "relative",
        // The cell's horizontal inset lives here and nowhere else.
        //
        // The body cells carry no padding of their own (`p: 0` on the `TableCell`, so
        // the drag handle can sit against the edge), which meant every editor was left
        // to supply its own: text and the date/select pickers used 8px, chips 2px, and
        // the header — which does take MUI's 16px — lined up with none of them. One
        // inset on the row makes a column's values agree with its header's drag handle
        // at 16px, and makes the
        // different types agree with each other.
        px: 2,
        "&:hover .cell-expand": { opacity: 1 },
        "&:hover .cell-drag": { opacity: 1 },
      }}
      // Double-click opens the record — but not from inside an editor. Now that a
      // single click starts editing, double-clicking to select a word in a text cell
      // would otherwise open the side panel on top of the edit.
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("input, textarea")) return;
        onOpenRecord();
      }}
    >
      {isRowHandle ? (
        <Tooltip title={i18n("db_drag_row")}>
          <Box
            className="cell-drag"
            component="span"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={(event) => event.stopPropagation()}
            sx={{
              opacity: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "grab",
              color: "text.disabled",
              transition: "opacity 0.15s",
              "&:hover": { color: "text.secondary" },
              // Floated rather than laid out in flow, so it does not indent this
              // column's values relative to every other column's. It sits inside the
              // row's own 16px inset and so never overlaps the content either — the
              // same trick the "open record" button uses on the right.
              position: "absolute",
              left: 0,
              top: "50%",
              transform: "translateY(-50%)",
              width: 16,
            }}
            aria-label={i18n("db_drag_row")}
          >
            <DragIndicatorRoundedIcon sx={{ fontSize: 16 }} />
          </Box>
        </Tooltip>
      ) : null}

      {isRowHandle ? (
        <Tooltip title={i18n("db_open_record")}>
          <IconButton
            className="cell-expand"
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              onOpenRecord();
            }}
            sx={{
              opacity: 0,
              position: "absolute",
              right: 2,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 2,
              transition: "opacity 0.15s",
            }}
            aria-label={i18n("db_open_record")}
          >
            <MoreVertRoundedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      ) : null}

      {showEditor ? (
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <CellEditor
            property={property}
            value={value}
            text={text}
            row={row}
            callbacks={callbacks}
            disabled={readOnly}
            autoFocus={focusOnMount}
            onDoneEditing={() => setEditing(false)}
          />
        </Box>
      ) : (
        <Box
          // A `mousedown` rather than a `click`, so the field can be mounted, focused
          // and typed into as part of one press.
          //
          // `preventDefault` is load-bearing, not cosmetic. Without it the browser's
          // default action for mousedown — move focus to the element under the pointer
          // (or its nearest focusable ancestor) — runs *after* React has committed the
          // new field and focused it, so the field is blurred the instant it appears.
          // `onBlur` then closes the editor again, which is what made a text cell need
          // two clicks: the first mounted and immediately dismissed the field, and only
          // the second, now with the field already mounted, landed in it.
          onMouseDown={(event) => {
            event.preventDefault();
            setEditing(true);
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            px: 0,
            py: 0.5,
            minHeight: 32,
            display: "flex",
            alignItems: "center",
            cursor: "text",
            borderRadius: 1,
            transition: "background-color 0.12s",
            "&:hover": { backgroundColor: "action.hover" },
          }}
        >
          <CellDisplay property={property} value={value} />
        </Box>
      )}
    </Box>
  );
};
export const TableView: React.FC<{
  binding: DatabaseBinding;
  /** The view being rendered: supplies the filter and sorts. */
  viewId: string;
  readOnly?: boolean;
  /** Bump to force a re-read after an external change. */
  revision: number;
  onOpenRecord: (rowId: string) => void;
}> = ({ binding, viewId, readOnly, revision, onOpenRecord }) => {
  const [propertyMenu, setPropertyMenu] = useState<{
    anchor: HTMLElement;
    property: PropertyDef;
  } | null>(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState<PropertyDef | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [retyping, setRetyping] = useState<{
    property: PropertyDef;
    nextType: PropType;
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  /**
   * The record whose deletion is being confirmed, by id.
   *
   * An id rather than the row object or a boolean, so the dialog tracks the live
   * document: a collaborator's rename shows up in the prompt, and a row deleted
   * remotely closes the confirmation instead of deleting something else. The table
   * re-renders on `revision`, so resolving the row on each render is enough.
   */
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null);
  /** The column whose options are being edited, if the dialog is open. */
  const [editingOptionsId, setEditingOptionsId] = useState<string | null>(null);
  /**
   * Which column's drag handle is being dragged, and which column the pointer is
   * over. Kept in state only to render the drop indicator; the actual move happens
   * on drop.
   */
  const [draggingPropId, setDraggingPropId] = useState<string | null>(null);
  const [propDropTarget, setPropDropTarget] = useState<{
    propId: string;
    after: boolean;
  } | null>(null);
  /**
   * The property currently under a column drag, read from `dataTransfer`.
   *
   * `dragenter` / `dragover` cannot read `dataTransfer.getData` (the browser
   * withholds it until drop for privacy), so the dragged id is carried in state as
   * well. `dataTransfer` is still set on `dragstart`, so the browser lets the drop
   * happen at all.
   */
  const [rowDragId, setRowDragId] = useState<string | null>(null);
  const [rowDropTarget, setRowDropTarget] = useState<{
    rowId: string;
    after: boolean;
  } | null>(null);

  /**
   * The column being resized and where the gesture started.
   *
   * Held in a ref rather than state: a resize fires a pointer move per frame, and putting
   * the gesture in state would re-render the whole table on each one. Only the *width* is
   * state, and only because it has to be — it is what the cells are drawn with.
   *
   * `startWidth` is the column's width when the pointer went down, so the new width is
   * computed from the distance travelled rather than from the pointer's absolute position.
   * A handle sits a few pixels wide, and measuring absolutely would make the column jump by
   * however far into the handle the press landed.
   */
  const resizeRef = useRef<{
    propId: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  /**
   * The live width while a resize runs, so the column follows the pointer.
   *
   * Committed to the document once, on release: a width is a CRDT write, and a thirty-frame
   * resize would otherwise be thirty updates broadcast to every collaborator.
   */
  const [previewWidth, setPreviewWidth] = useState<{
    propId: string;
    width: number;
  } | null>(null);
  /**
   * The live width, mirrored for the window listeners to read.
   *
   * The listeners are installed once per gesture, so they cannot close over render state —
   * a handler reading `previewWidth` would write the width from the frame before the last
   * pointer move, which is one move behind where the user released.
   */
  const previewRef = useRef<{ propId: string; width: number } | null>(null);
  previewRef.current = previewWidth;

  const widths = useMemo(
    () => binding.getViews().find((v) => v.id === viewId)?.columnWidths,
    [binding, viewId, revision],
  );
  const frozenCount = useMemo(
    () =>
      binding.getViewFrozenColumns(
        viewId,
        binding.getViewProperties(viewId).length,
      ),
    [binding, viewId, revision],
  );

  const properties = useMemo(
    // The view's *visible* columns, not every column: hiding one is a per-view
    // setting, and reading `getProperties()` here would ignore it.
    () => binding.getViewProperties(viewId),
    // `revision` forces recomputation after a document change.
    [binding, viewId, revision],
  );

  /**
   * Width to draw one column at, including a resize in progress.
   *
   * The preview wins over the stored value for the column being dragged, so the column
   * follows the pointer while the document still holds the old width — nothing is written
   * until the gesture ends.
   */
  const widthOf = useCallback(
    (propId: string): number => {
      if (previewWidth?.propId === propId) return previewWidth.width;
      return columnWidthOf(widths, propId);
    },
    [previewWidth, widths],
  );

  /** Left offsets of the frozen run, one entry per frozen column. */
  const frozenLeft = useMemo(
    () =>
      frozenOffsets(
        properties.map((property) => property.id),
        frozenCount,
        widths,
      ),
    [properties, frozenCount, widths],
  );
  // Filtered and sorted for this view — not the raw rows, or a view's filter
  // would have no effect on what is displayed.
  const rows = useMemo(
    () => binding.getViewRows(viewId),
    [binding, viewId, revision],
  );
  const callbacksFor = useCallback(
    (property: PropertyDef, row: RowData): CellEditorCallbacks => ({
      onChange: (value) => binding.setValue(row.id, property.id, value),
      onTextChange: (next) => binding.setText(row.id, property.id, next),
      onToggleOption: (optId) =>
        binding.toggleMultiSelect(row.id, property.id, optId),
      onCreateOption:
        property.type === "multi-select" || property.type === "select"
          ? (name) => binding.addOption(property.id, name)
          : undefined,
    }),
    [binding],
  );

  /**
   * The column whose options dialog is open, resolved against the **live** schema.
   *
   * Held as an id rather than a snapshot so the dialog follows the document: a
   * collaborator renaming an option must be visible here immediately, and a column
   * deleted by someone else closes the dialog rather than editing a detached copy.
   */
  const optionsProperty = useMemo(
    () =>
      editingOptionsId ? (binding.getProperty(editingOptionsId) ?? null) : null,
    [binding, editingOptionsId, revision],
  );

  // ---- retype preview: only shown when a conversion would lose data ----
  const retypePreview = useMemo(() => {
    if (!retyping) return null;
    // Deliberately every row, not the filtered subset: retyping a column affects
    // values in rows the view is currently hiding too.
    const values = binding
      .getRows()
      .map((row) => row.values[retyping.property.id] as PlainValue | undefined)
      .filter((value): value is PlainValue => value !== undefined);
    return previewRetype(
      values,
      retyping.property.type,
      retyping.nextType,
      retyping.property.options,
    );
  }, [binding, retyping, revision]);

  const startRename = (property: PropertyDef) => {
    setRenaming(property);
    setRenameValue(property.name);
    setPropertyMenu(null);
  };

  /**
   * The record a confirmation is open for, resolved against the live rows.
   *
   * `null` when the id no longer names a row, which is what makes a remote deletion
   * close the dialog: `open` is derived from this, never from the raw id.
   */
  const pendingDeleteRow = useMemo(
    () =>
      deletingRowId
        ? (rows.find((row) => row.id === deletingRowId) ?? null)
        : null,
    [deletingRowId, rows],
  );
  const titlePropertyForDelete = useMemo(
    () => cardTitleProperty(properties),
    [properties],
  );
  /** The column a confirmation is open for, resolved against the live schema. */
  const pendingDeleteProperty =
    (deletingId ? (binding.getProperty(deletingId) ?? null) : null) ?? null;

  const commitRename = () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (name && name !== renaming.name)
      binding.renameProperty(renaming.id, name);
    setRenaming(null);
  };

  /**
   * Finish a column drag.
   *
   * The anchor comes from the same pure helper the rows use, computed against the
   * full property list so "before the first column" and "after the last" both
   * fall out of one rule.
   */
  const dropProperty = (event: React.DragEvent) => {
    event.preventDefault();
    const dragged = draggingPropId;
    const target = propDropTarget;
    setDraggingPropId(null);
    setPropDropTarget(null);
    if (!dragged || !target) return;

    const anchor = computeMoveAnchor(
      binding.getProperties(),
      dragged,
      target.propId,
      target.after,
    );
    if (!anchor) return;
    if (anchor.changed) binding.movePropertyBefore(dragged, anchor.beforeId);
  };

  /** Finish a row drag, using the row under the pointer as the anchor. */
  const dropRow = (event: React.DragEvent) => {
    event.preventDefault();
    const dragged = rowDragId;
    const target = rowDropTarget;
    setRowDragId(null);
    setRowDropTarget(null);
    if (!dragged || !target) return;

    const anchor = computeMoveAnchor(
      binding.getRows(),
      dragged,
      target.rowId,
      target.after,
    );
    if (!anchor) return;
    if (anchor.changed) binding.moveRowBefore(dragged, anchor.beforeId);
  };

  /** Clear both drag indicators when a drag ends anywhere, including outside. */
  const endDrag = () => {
    setDraggingPropId(null);
    setPropDropTarget(null);
    setRowDragId(null);
    setRowDropTarget(null);
  };

  /**
   * Begin a column resize.
   *
   * Pointer events rather than a mouse listener, and the move/release listeners go on the
   * **window**: a resize is a sideways gesture and the pointer leaves the 5px handle
   * immediately. Handlers bound to the handle would stop firing at the first pixel of
   * movement, and `setPointerCapture` throws for a pointer id the browser does not know —
   * which aborts the handler that called it.
   */
  const beginResize = (event: React.PointerEvent, propId: string) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      propId,
      startX: event.clientX,
      startWidth: columnWidthOf(widths, propId),
    };
    setPreviewWidth({ propId, width: columnWidthOf(widths, propId) });
  };

  const moveResize = useCallback((event: PointerEvent) => {
    const gesture = resizeRef.current;
    if (!gesture) return;
    const width = resizedWidth(
      gesture.startWidth,
      event.clientX - gesture.startX,
    );
    setPreviewWidth((current) =>
      current?.propId === gesture.propId && current.width === width
        ? current
        : { propId: gesture.propId, width },
    );
  }, []);

  /**
   * Commit a resize, once.
   *
   * A width equal to the default is cleared rather than written, so a column dragged back
   * to its starting size stores nothing — matching how the model treats the default, and
   * keeping a resize that changed nothing out of the document entirely.
   *
   * The width is read from a ref rather than from `previewWidth`: this runs from a window
   * listener, and a handler closed over render state would write the width from the frame
   * before the last pointer move.
   */
  const endResize = useCallback(() => {
    const gesture = resizeRef.current;
    const finalWidth = previewRef.current;
    resizeRef.current = null;
    setPreviewWidth(null);
    if (!gesture) return;

    const next =
      finalWidth?.propId === gesture.propId
        ? finalWidth.width
        : gesture.startWidth;
    if (next === gesture.startWidth) return;
    binding.setViewColumnWidth(
      viewId,
      gesture.propId,
      next === DEFAULT_COLUMN_WIDTH ? undefined : next,
    );
  }, [binding, viewId]);

  /**
   * Watch the resize gesture while it runs.
   *
   * The dependency is on *whether* a gesture is active, not on the gesture: the listeners
   * are installed once per resize, so re-attaching them on every pointer move would be work
   * for nothing. The handlers read the gesture through a ref for the same reason.
   */
  const resizing = previewWidth !== null;
  useEffect(() => {
    if (!resizing) return;
    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", endResize);
    window.addEventListener("pointercancel", endResize);
    return () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", endResize);
      window.removeEventListener("pointercancel", endResize);
    };
  }, [resizing, moveResize, endResize]);

  return (
    <Box>
      {/*
        `borderCollapse: separate` is load-bearing for frozen columns, not styling: with
        the default `collapse`, a sticky `<td>` is not honoured by every engine — the cell
        scrolls with its column and the freezing silently does nothing. `borderSpacing: 0`
        keeps the spacing identical to a collapsed table. Every rule here is on one edge of
        a cell, so nothing doubles up either way.
      */}
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table
          size="small"
          sx={{
            tableLayout: "fixed",
            minWidth: 480,
            borderCollapse: "separate",
            borderSpacing: 0,
          }}
        >
          <TableHead>
            <TableRow>
              {properties.map((property, propertyIndex) => {
                const meta = getPropertyTypeMeta(property.type);
                const isDragging = draggingPropId === property.id;
                const drop = propDropTarget;
                const showDropBefore =
                  drop?.propId === property.id && !drop.after;
                const showDropAfter =
                  drop?.propId === property.id && drop.after;
                const isFrozen = propertyIndex < frozenCount;
                const boundary = isFrozenBoundary(
                  propertyIndex,
                  frozenCount,
                  properties.length,
                );
                return (
                  <TableCell
                    key={property.id}
                    onDragOver={(event) => {
                      if (!draggingPropId || readOnly) return;
                      // Without preventDefault the browser refuses the drop, and
                      // `dragover` is the only event that can accept it.
                      event.preventDefault();
                      setPropDropTarget({
                        propId: property.id,
                        after: isAfterMidpoint(
                          event.currentTarget.getBoundingClientRect(),
                          { x: event.clientX, y: event.clientY },
                          "x",
                        ),
                      });
                    }}
                    onDrop={dropProperty}
                    sx={{
                      fontWeight: 600,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      py: 0.75,
                      // The width lives on the cell, not in a `<col>`: with
                      // `table-layout: fixed` the first row's cells decide the column
                      // widths, and a resize has to take effect as the pointer moves.
                      width: widthOf(property.id),
                      minWidth: MIN_COLUMN_WIDTH,
                      maxWidth: widthOf(property.id),
                      ...headerCellBackgroundSx(isFrozen),
                      // The drop indicator and the frozen seam, resolved together so the
                      // indicator wins — see `columnEdgeSx`.
                      ...columnEdgeSx({
                        isFrozenSeam: boundary,
                        showDropBefore,
                        showDropAfter,
                      }),
                      opacity: isDragging ? 0.5 : 1,
                      "&:hover .column-menu": { opacity: 1 },
                      "&:hover .column-resize": { opacity: 1 },
                      ...frozenCellSx(isFrozen, frozenLeft[propertyIndex]),
                    }}
                  >
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                    >
                      {!readOnly ? (
                        <Tooltip title={i18n("db_drag_column")}>
                          <Box
                            component="span"
                            draggable
                            onDragStart={(event) => {
                              // Firefox refuses to start a drag without some data
                              // set, even when the payload is only in state.
                              event.dataTransfer.setData(
                                "text/plain",
                                property.id,
                              );
                              event.dataTransfer.effectAllowed = "move";
                              setDraggingPropId(property.id);
                            }}
                            onDragEnd={endDrag}
                            sx={{
                              display: "flex",
                              cursor: "grab",
                              color: "text.disabled",
                              "&:hover": { color: "text.secondary" },
                            }}
                            aria-label={i18n("db_drag_column")}
                          >
                            <DragIndicatorRoundedIcon sx={{ fontSize: 16 }} />
                          </Box>
                        </Tooltip>
                      ) : null}
                      <meta.Icon sx={{ fontSize: 16, color: meta.color }} />
                      <Typography
                        variant="body2"
                        sx={{ flex: 1, fontWeight: 600 }}
                        noWrap
                      >
                        {property.name}
                      </Typography>
                      {!readOnly ? (
                        <IconButton
                          size="small"
                          onClick={(event) =>
                            setPropertyMenu({
                              anchor: event.currentTarget,
                              property,
                            })
                          }
                          aria-label={`${property.name} menu`}
                          sx={{
                            transition: "opacity 0.15s",
                            color: "text.secondary",
                            "@media (hover: hover)": { opacity: 0 },
                          }}
                          className="column-menu"
                        >
                          <MoreVertRoundedIcon fontSize="inherit" />
                        </IconButton>
                      ) : null}
                    </Box>

                    {/*
                      The resize handle sits on the cell's right edge, so the column
                      boundary and the grab area are the same place — which is where a
                      user reaches for it. It is a pointer gesture rather than a drag:
                      a resize has to follow the pointer pixel by pixel and be clamped as
                      it goes, and `dragstart` cannot do either.

                      Hidden while a resize runs, so it never catches the pointer that is
                      already dragging it.
                    */}
                    {!readOnly && !previewWidth ? (
                      <Box
                        className="column-resize"
                        onPointerDown={(event) =>
                          beginResize(event, property.id)
                        }
                        onDoubleClick={() => {
                          // Back to the default, which is how a mis-dragged width is
                          // undone without hunting for the original size.
                          binding.setViewColumnWidth(
                            viewId,
                            property.id,
                            undefined,
                          );
                        }}
                        aria-label={i18n("db_resize_column_hint")}
                        role="separator"
                        sx={{
                          position: "absolute",
                          right: -3,
                          top: 0,
                          bottom: 0,
                          width: 7,
                          cursor: "col-resize",
                          zIndex: 3,
                          opacity: 0,
                          transition: "opacity 0.15s",
                          // The visible line is drawn only on hover, so a resting header
                          // is not a row of vertical rules between every column.
                          "&::after": {
                            content: '""',
                            position: "absolute",
                            left: 3,
                            top: 4,
                            bottom: 4,
                            width: 2,
                            borderRadius: 1,
                            backgroundColor: "primary.main",
                            opacity: previewWidth ? 1 : 0.5,
                          },
                          "&:hover::after": { opacity: 1 },
                          touchAction: "none",
                        }}
                      />
                    ) : null}
                  </TableCell>
                );
              })}
              {!readOnly ? (
                <TableCell
                  onDragOver={(event) => {
                    // Dropping on the trailing cell means "move to the end".
                    if (!draggingPropId) return;
                    event.preventDefault();
                    const last = properties[properties.length - 1];
                    if (last)
                      setPropDropTarget({ propId: last.id, after: true });
                  }}
                  onDrop={dropProperty}
                  sx={{
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    width: 160,
                  }}
                >
                  <Tooltip title={i18n("db_add_property")}>
                    <IconButton
                      size="small"
                      onClick={(event) => setAddMenuAnchor(event.currentTarget)}
                      aria-label={i18n("db_add_property")}
                    >
                      <AddRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              ) : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const isDragging = rowDragId === row.id;
              const drop = rowDropTarget;
              const showDropBefore = drop?.rowId === row.id && !drop.after;
              const showDropAfter = drop?.rowId === row.id && drop.after;
              return (
                <TableRow
                  key={row.id}
                  hover
                  onDragOver={(event) => {
                    if (!rowDragId || readOnly) return;
                    event.preventDefault();
                    setRowDropTarget({
                      rowId: row.id,
                      after: isAfterMidpoint(
                        event.currentTarget.getBoundingClientRect(),
                        { x: event.clientX, y: event.clientY },
                        "y",
                      ),
                    });
                  }}
                  onDrop={dropRow}
                  sx={{ opacity: isDragging ? 0.5 : 1 }}
                >
                  {properties.map((property, propertyIndex) => (
                    <TableCell
                      key={property.id}
                      sx={{
                        p: 0,
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        verticalAlign: "middle",
                        width: widthOf(property.id),
                        minWidth: MIN_COLUMN_WIDTH,
                        maxWidth: widthOf(property.id),
                        ...frozenCellSx(
                          propertyIndex < frozenCount,
                          frozenLeft[propertyIndex],
                        ),
                        ...columnEdgeSx({
                          // Drawn on the frozen run's **last** column rather than on the
                          // next one's left edge: the next column scrolls, and a border
                          // travelling with it would read as a moving divider.
                          isFrozenSeam: isFrozenBoundary(
                            propertyIndex,
                            frozenCount,
                            properties.length,
                          ),
                          showDropBefore,
                          showDropAfter,
                        }),
                        // The row-drop indicator is drawn on the cells, not the `<tr>`: a
                        // border on a table row is unreliable to render, while a border on
                        // every cell is a full-width line by construction.
                        ...(showDropBefore ? { borderTop: "2px solid" } : {}),
                        ...(showDropBefore
                          ? { borderTopColor: "primary.main" }
                          : {}),
                        ...(showDropAfter ? { borderBottom: "2px solid" } : {}),
                        ...(showDropAfter
                          ? { borderBottomColor: "primary.main" }
                          : {}),
                      }}
                    >
                      <EditableCell
                        property={property}
                        row={row}
                        binding={binding}
                        readOnly={!!readOnly}
                        callbacks={callbacksFor(property, row)}
                        onOpenRecord={() => onOpenRecord(row.id)}
                        isRowHandle={propertyIndex === 0}
                        onDragStart={(event) => {
                          // Firefox refuses to start a drag with no data set.
                          event.dataTransfer.setData("text/plain", row.id);
                          event.dataTransfer.effectAllowed = "move";
                          setRowDragId(row.id);
                        }}
                        onDragEnd={endDrag}
                      />
                    </TableCell>
                  ))}
                  {!readOnly ? (
                    <TableCell
                      sx={{
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        whiteSpace: "nowrap",
                        "&:hover .row-action": { opacity: 1 },
                      }}
                    >
                      <Tooltip title={i18n("db_duplicate_row")}>
                        <IconButton
                          className="row-action"
                          size="small"
                          onClick={() => {
                            const copyId = binding.duplicateRow(row.id);
                            // Opening the copy would be a surprise; leaving the
                            // selection alone keeps the user where they were.
                            void copyId;
                          }}
                          aria-label={i18n("db_duplicate_row")}
                          sx={rowActionSx}
                        >
                          <ContentCopyRoundedIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={i18n("db_delete_row")}>
                        <IconButton
                          className="row-action"
                          size="small"
                          onClick={() => setDeletingRowId(row.id)}
                          aria-label={i18n("db_delete_row")}
                          sx={rowActionSx}
                        >
                          <DeleteOutlineRoundedIcon fontSize="inherit" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {rows.length === 0 ? (
        <Box
          sx={{
            textAlign: "center",
            py: 5,
            px: 2,
            mt: 0.5,
            borderRadius: 2,
            backgroundColor: "action.hover",
            color: "text.secondary",
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {i18n("db_no_rows")}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.disabled" }}>
            {i18n("db_no_rows_hint")}
          </Typography>
        </Box>
      ) : null}

      {!readOnly ? (
        <Box sx={{ mt: 1 }}>
          <Button
            size="small"
            startIcon={<AddRoundedIcon />}
            onClick={() => binding.addRow()}
            sx={{
              textTransform: "none",
              color: "text.secondary",
              borderRadius: 1.5,
              "&:hover": { color: "primary.main" },
            }}
          >
            {i18n("db_add_row")}
          </Button>
        </Box>
      ) : null}

      {/* ---- property actions ---- */}
      <Menu
        open={propertyMenu !== null}
        anchorEl={propertyMenu?.anchor}
        onClose={() => setPropertyMenu(null)}
      >
        <MenuList dense sx={{ minWidth: 220 }}>
          <MenuItem
            disabled={propertyMenu?.property.type === "title"}
            onClick={() => propertyMenu && startRename(propertyMenu.property)}
          >
            <ListItemIcon>
              <DriveFileRenameOutlineRoundedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{i18n("db_rename_property")}</ListItemText>
          </MenuItem>

          {/*
            Options are the schema of a select-family column, so editing them belongs
            beside rename: without this, the only way to change an option was to create
            one from the cell picker, and `renameOption` / `setOptionColor` /
            `deleteOption` / the status groups had no reachable UI at all.
          */}
          {propertyMenu && isOptionPropType(propertyMenu.property.type) ? (
            <MenuItem
              onClick={() => {
                setEditingOptionsId(propertyMenu.property.id);
                setPropertyMenu(null);
              }}
            >
              <ListItemIcon>
                <FormatListBulletedRoundedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{i18n("db_edit_options")}</ListItemText>
            </MenuItem>
          ) : null}

          <Divider />

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ px: 2, py: 0.5 }}
          >
            {i18n("db_change_property_type")}
          </Typography>
          {CREATABLE_PROPERTY_TYPES.map((type) => {
            const meta = getPropertyTypeMeta(type);
            const current = propertyMenu?.property.type === type;
            return (
              <MenuItem
                key={type}
                disabled={current || propertyMenu?.property.type === "title"}
                onClick={() => {
                  if (!propertyMenu) return;
                  setRetyping({
                    property: propertyMenu.property,
                    nextType: type,
                  });
                  setPropertyMenu(null);
                }}
              >
                <ListItemIcon>
                  <meta.Icon fontSize="small" sx={{ color: meta.color }} />
                </ListItemIcon>
                <ListItemText>{i18n(meta.labelKey)}</ListItemText>
              </MenuItem>
            );
          })}

          <Divider />

          <MenuItem
            disabled={propertyMenu?.property.type === "title"}
            onClick={() => {
              if (propertyMenu) setDeletingId(propertyMenu.property.id);
              setPropertyMenu(null);
            }}
          >
            <ListItemIcon>
              <DeleteOutlineRoundedIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText sx={{ color: "error.main" }}>
              {i18n("db_delete_property")}
            </ListItemText>
          </MenuItem>
        </MenuList>
      </Menu>

      {/* ---- add property ---- */}
      <Menu
        open={addMenuAnchor !== null}
        anchorEl={addMenuAnchor}
        onClose={() => setAddMenuAnchor(null)}
      >
        <MenuList dense sx={{ minWidth: 280 }}>
          {CREATABLE_PROPERTY_TYPES.map((type) => {
            const meta = getPropertyTypeMeta(type);
            return (
              <MenuItem
                key={type}
                onClick={() => {
                  binding.addProperty(i18n(meta.labelKey), type);
                  setAddMenuAnchor(null);
                }}
              >
                <ListItemIcon>
                  <meta.Icon fontSize="small" sx={{ color: meta.color }} />
                </ListItemIcon>
                <ListItemText
                  primary={i18n(meta.labelKey)}
                  secondary={i18n(meta.hintKey)}
                />
              </MenuItem>
            );
          })}
        </MenuList>
      </Menu>

      {/* ---- edit options (select / multi-select / status) ---- */}
      {optionsProperty ? (
        <OptionsEditorDialog
          binding={binding}
          property={optionsProperty}
          readOnly={readOnly}
          onClose={() => setEditingOptionsId(null)}
        />
      ) : null}

      {/* ---- rename ---- */}
      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{i18n("db_rename_property")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            value={renameValue}
            label={i18n("db_property_name")}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>
            {i18n("cancel_button")}
          </Button>
          <Button variant="contained" onClick={commitRename}>
            {i18n("confirm_button")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- delete column ---- */}
      {/*
        The same shared confirmation the record, option and view deletions use. Held
        as an id and resolved live, so a collaborator renaming the column is reflected
        in the prompt and a column deleted remotely closes it.
      */}
      <ConfirmDialog
        open={pendingDeleteProperty !== null}
        title={i18n("db_delete_property")}
        content={Format(i18n("db_confirm_delete_property"), {
          name: pendingDeleteProperty?.name ?? "",
        })}
        confirmText={i18n("db_delete_property")}
        confirmColor="error"
        onClose={() => setDeletingId(null)}
        onConfirm={() => {
          const target = deletingId;
          setDeletingId(null);
          if (target) binding.deleteProperty(target);
        }}
      />

      {/* ---- retype, with a preview of what will be lost ---- */}
      <Dialog
        open={retyping !== null}
        onClose={() => setRetyping(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {Format(i18n("db_retype_title"), {
            name: retyping?.property.name ?? "",
            type: retyping
              ? i18n(getPropertyTypeMeta(retyping.nextType).labelKey)
              : "",
          })}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            {retyping ? <TypeIcon type={retyping.property.type} /> : null}
            <SwapHorizRoundedIcon fontSize="small" color="action" />
            {retyping ? <TypeIcon type={retyping.nextType} /> : null}
          </Box>

          {retypePreview ? (
            retypePreview.total === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {i18n("db_retype_no_values")}
              </Typography>
            ) : retypePreview.dropped === 0 ? (
              <Typography variant="body2" color="success.main">
                {Format(i18n("db_retype_all_kept"), {
                  total: retypePreview.total,
                })}
              </Typography>
            ) : (
              <Typography variant="body2" color="warning.main">
                {Format(i18n("db_retype_warning"), {
                  dropped: retypePreview.dropped,
                  total: retypePreview.total,
                })}
              </Typography>
            )
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRetyping(null)}>
            {i18n("cancel_button")}
          </Button>
          <Button
            variant="contained"
            color={
              retypePreview && retypePreview.dropped > 0 ? "warning" : "primary"
            }
            onClick={() => {
              if (!retyping) return;
              binding.setPropertyType(retyping.property.id, retyping.nextType);
              GlobalSnackBar.getInstance().pushMessage(
                i18n("rename_success"),
                "success",
              );
              setRetyping(null);
            }}
          >
            {i18n("confirm_button")}
          </Button>
        </DialogActions>
      </Dialog>

      {/*
        Record deletion, confirmed with the same shared dialog the property, option
        and view deletions use. The row action sits in the trailing cell next to
        "Duplicate record" and needs no undo of its own — deleting a record is
        permanent, so the confirmation is the only guard.

        `open` is derived from the resolved row, so a remote deletion closes this
        rather than leaving the prompt pointing at a row that is already gone.
      */}
      <ConfirmDialog
        open={pendingDeleteRow !== null}
        title={i18n("db_delete_row")}
        content={Format(i18n("db_confirm_delete_row"), {
          name:
            pendingDeleteRow && titlePropertyForDelete
              ? cardTitle(binding, pendingDeleteRow, titlePropertyForDelete)
              : i18n("db_record_untitled"),
        })}
        confirmText={i18n("db_delete_row")}
        confirmColor="error"
        onClose={() => setDeletingRowId(null)}
        onConfirm={() => {
          const target = deletingRowId;
          setDeletingRowId(null);
          if (target) binding.deleteRow(target);
        }}
      />
    </Box>
  );
};

/**
 * Type icon, for the retype dialog's before/after preview.
 *
 * Declared as a component rather than a function returning JSX so it can be used
 * as `<TypeIcon />`; a lower-case name would be treated as a DOM element.
 */
const TypeIcon: React.FC<{ type: PropType }> = ({ type }) => {
  const meta = getPropertyTypeMeta(type);
  return <meta.Icon sx={{ color: meta.color }} />;
};

export type { RowData };
