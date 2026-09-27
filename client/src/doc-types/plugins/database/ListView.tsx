import React, { useMemo, useState } from "react";
import {
  Box,
  Chip,
  Divider,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import { i18n } from "../../../internationnalization/utils";
import { CellDisplay } from "./cells";
import { optionColorHex } from "./optionColors";
import { computeMoveAnchor, isAfterMidpoint } from "./reorder";
import { getPropertyTypeMeta } from "./propertyTypes";
import { isOptionPropType } from "./types";
import type { DatabaseBinding } from "./model";

/**
 * The list view.
 *
 * The minimal layout: one line per record, showing the title plus a few properties,
 * reusing `CellDisplay` so a value renders identically here and in the table. It is
 * also the cheapest view to render, which makes it useful for large databases where
 * a full table is more than the user needs.
 *
 * Rows can be dragged to reorder them, exactly as in the table — the same
 * "move to a neighbour" write, so the two views cannot disagree about what order
 * means.
 */
export const ListView: React.FC<{
  binding: DatabaseBinding;
  /** The view being rendered: supplies the filter and sorts. */
  viewId: string;
  readOnly?: boolean;
  revision: number;
  onOpenRecord: (rowId: string) => void;
}> = ({ binding, viewId, readOnly, revision, onOpenRecord }) => {
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    rowId: string;
    after: boolean;
  } | null>(null);

  const properties = useMemo(
    // Only the columns this view shows.
    () => binding.getViewProperties(viewId),
    [binding, viewId, revision],
  );
  // Filtered and sorted for this view, matching what the table shows.
  const rows = useMemo(
    () => binding.getViewRows(viewId),
    [binding, viewId, revision],
  );

  const titleProperty = properties.find(
    (property) => property.type === "title",
  );
  // At most three secondary properties, so a line stays readable.
  const secondary = properties
    .filter((property) => property.type !== "title")
    .slice(0, 3);

  /**
   * A single sort rule on a select-family property, if that is what the view has.
   *
   * A row's own `order` key only decides the order when the view has **no** sort —
   * a sorted view re-derives the order every render, so dragging to reorder would
   * appear to do nothing. In that case the sort is treated as the axis being
   * dragged and the drop *writes the sorted value*: order by "priority", drop a line
   * into another bucket, and its priority changes. That is why the list needs no
   * extra UI — the rule the user already set is the drop target.
   *
   * Only an option list gives a line something meaningful to land on. A sort on a
   * text or number column has no discrete buckets to drop into, and with several
   * rules a drop cannot control the visible order at all — in both cases dragging
   * is simply not offered, rather than silently doing nothing.
   */
  const sortRule = useMemo(() => {
    const view = binding
      .getViews()
      .find((candidate) => candidate.id === viewId);
    const sorts = view?.sorts ?? [];
    if (sorts.length !== 1) return null;
    const property = properties.find(
      (candidate) => candidate.id === sorts[0].propId,
    );
    return property && isOptionPropType(property.type) ? property : null;
  }, [binding, viewId, properties, revision]);

  /**
   * Whether a drag can do anything at all.
   *
   * True when the visible order is the manual `order` key (no sorts) or when a
   * single option sort gives a drop something to write. False for the ambiguous
   * cases above, which is what hides the drag handle.
   */
  const viewSorts = useMemo(
    () =>
      binding.getViews().find((candidate) => candidate.id === viewId)?.sorts ??
      [],
    [binding, viewId, revision],
  );
  const canDrag = !readOnly && (viewSorts.length === 0 || sortRule !== null);

  const endDrag = () => {
    setDraggingRowId(null);
    setDropTarget(null);
  };

  /** Finish a row drag: reorder within the sort, or rewrite the sorted value. */
  const dropRow = (target: { rowId: string; after: boolean } | null) => {
    const dragged = draggingRowId;
    endDrag();
    if (!dragged || !target || readOnly) return;

    if (sortRule) {
      assignSortedValue(dragged, target.rowId, target.after);
      return;
    }

    // No sort, so the display order *is* the `order` key order: the neighbour the
    // pointer is over can be used as-is.
    const anchor = computeMoveAnchor(rows, dragged, target.rowId, target.after);
    if (!anchor) return;
    if (anchor.changed) binding.moveRowBefore(dragged, anchor.beforeId);
  };

  /**
   * Write the sorted property so `dragged` lands in the bucket it was dropped on.
   *
   * The same single-field write as a board card drop, so a list drag and a board
   * drag cannot mean different things. Dropping inside the bucket a row already
   * belongs to is a no-op rather than a pointless CRDT write.
   */
  const assignSortedValue = (
    draggedId: string,
    overId: string,
    after: boolean,
  ) => {
    if (!sortRule) return;

    const groups = binding
      .getViewRowGroups(viewId, sortRule.id)
      .filter((group) => group.key !== null);

    const overIndex = groups.findIndex((group) =>
      group.rows.some((row) => row.id === overId),
    );
    if (overIndex < 0) return;

    // Passing the midpoint of the last line in a bucket moves on to the next one,
    // which is what makes "drop at the bottom edge" mean "the next bucket".
    const group = groups[overIndex];
    const next = groups[overIndex + 1];
    const lastInGroup = group.rows[group.rows.length - 1];
    const targetGroup =
      after && lastInGroup?.id === overId && next ? next : group;
    const optId = targetGroup.key;
    if (!optId) return;

    const row = rows.find((candidate) => candidate.id === draggedId);
    if (!row) return;

    if (sortRule.type === "multi-select") {
      const selected = Array.isArray(row.values[sortRule.id])
        ? (row.values[sortRule.id] as string[])
        : [];
      if (!selected.includes(optId)) {
        binding.toggleMultiSelect(draggedId, sortRule.id, optId);
      }
      return;
    }
    if (row.values[sortRule.id] === optId) return;
    binding.setValue(draggedId, sortRule.id, optId);
  };

  return (
    <Box>
      {rows.map((row, index) => {
        const titleText = titleProperty
          ? binding.getTextString(row, titleProperty.id)
          : "";
        const titleValue = titleProperty
          ? row.values[titleProperty.id]
          : undefined;
        const displayTitle =
          titleText ||
          (typeof titleValue === "string" ? titleValue : "") ||
          i18n("db_record_untitled");

        return (
          <React.Fragment key={row.id}>
            {index > 0 ? <Divider /> : null}
            <Box
              onClick={() => onOpenRecord(row.id)}
              onDragOver={(event) => {
                if (!draggingRowId || !canDrag) return;
                event.preventDefault();
                setDropTarget({
                  rowId: row.id,
                  after: isAfterMidpoint(
                    event.currentTarget.getBoundingClientRect(),
                    { x: event.clientX, y: event.clientY },
                    "y",
                  ),
                });
              }}
              onDrop={(event) => {
                event.preventDefault();
                dropRow(dropTarget);
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                px: 1,
                py: 1,
                cursor: "pointer",
                borderRadius: 1,
                opacity: draggingRowId === row.id ? 0.5 : 1,
                "&:hover": { backgroundColor: "action.hover" },
                "&:hover .row-drag": { opacity: 1 },
                // The whole line is the drop target, and a line only reads as a
                // line: the indicator therefore has to be a top or bottom border.
                ...(dropTarget?.rowId === row.id && !dropTarget.after
                  ? { borderTop: "2px solid", borderColor: "primary.main" }
                  : {}),
                ...(dropTarget?.rowId === row.id && dropTarget.after
                  ? { borderBottom: "2px solid", borderColor: "primary.main" }
                  : {}),
              }}
            >
              {canDrag ? (
                <Tooltip title={i18n("db_drag_row")}>
                  <Box
                    className="row-drag"
                    component="span"
                    draggable
                    onDragStart={(event) => {
                      // Firefox refuses to start a drag with no data set.
                      event.dataTransfer.setData("text/plain", row.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDraggingRowId(row.id);
                    }}
                    onDragEnd={endDrag}
                    onClick={(event) => event.stopPropagation()}
                    sx={{
                      opacity: 0,
                      display: "flex",
                      alignItems: "center",
                      cursor: "grab",
                      color: "text.disabled",
                      transition: "opacity 0.15s",
                      flexShrink: 0,
                      "&:hover": { color: "text.secondary" },
                    }}
                    aria-label={i18n("db_drag_row")}
                  >
                    <DragIndicatorRoundedIcon sx={{ fontSize: 16 }} />
                  </Box>
                </Tooltip>
              ) : null}

              {!readOnly ? (
                <Tooltip title={i18n("db_delete_row")}>
                  <IconButton
                    size="small"
                    onClick={(event) => {
                      // Deleting must not also open the record.
                      event.stopPropagation();
                      binding.deleteRow(row.id);
                    }}
                    aria-label={i18n("db_delete_row")}
                  >
                    <DeleteOutlineRoundedIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              ) : null}

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                  {displayTitle}
                </Typography>
              </Box>

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  flexShrink: 0,
                  maxWidth: { xs: 160, sm: 420 },
                  overflow: "hidden",
                }}
              >
                {secondary.map((property) => {
                  const meta = getPropertyTypeMeta(property.type);

                  // Select-family values read as chips, since the colour is the
                  // fastest way to scan a list.
                  if (
                    property.type === "select" ||
                    property.type === "multi-select"
                  ) {
                    const ids =
                      property.type === "multi-select"
                        ? Array.isArray(row.values[property.id])
                          ? (row.values[property.id] as string[])
                          : []
                        : typeof row.values[property.id] === "string"
                          ? [row.values[property.id] as string]
                          : [];

                    if (ids.length === 0) return null;
                    return (
                      <Box key={property.id} sx={{ display: "flex", gap: 0.5 }}>
                        {ids.slice(0, 2).map((optId) => {
                          const option = property.options.find(
                            (candidate) => candidate.id === optId,
                          );
                          if (!option) return null;
                          return (
                            <Chip
                              key={optId}
                              size="small"
                              label={option.name}
                              sx={{
                                height: 20,
                                fontSize: "0.7rem",
                                backgroundColor: optionColorHex(option.color),
                                color: "#fff",
                              }}
                            />
                          );
                        })}
                      </Box>
                    );
                  }

                  const value = row.values[property.id];
                  if (value === undefined || value === "") return null;

                  return (
                    <Box
                      key={property.id}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        minWidth: 0,
                      }}
                    >
                      <meta.Icon
                        sx={{ fontSize: 13, color: meta.color, flexShrink: 0 }}
                      />
                      <Box sx={{ minWidth: 0, maxWidth: 160 }}>
                        <CellDisplay property={property} value={value} />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </React.Fragment>
        );
      })}

      {rows.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
          <Typography variant="body2">{i18n("db_no_rows")}</Typography>
          <Typography variant="caption">{i18n("db_no_rows_hint")}</Typography>
        </Box>
      ) : null}

      {!readOnly ? (
        <Box sx={{ mt: 1 }}>
          <IconButton
            size="small"
            onClick={() => binding.addRow()}
            aria-label={i18n("db_add_row")}
          >
            <AddRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      ) : null}
    </Box>
  );
};
