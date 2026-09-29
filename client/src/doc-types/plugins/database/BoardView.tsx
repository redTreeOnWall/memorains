import React, { useMemo, useState } from "react";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import { i18n } from "../../../internationnalization/utils";
import {
  CardDetailLine,
  cardDetailProperties,
  cardIsUntitled,
  cardTitle,
  cardTitleProperty,
} from "./cards";
import { optionColorHex } from "./optionColors";
import type { DatabaseBinding } from "./model";
import type { PropertyDef, RowData } from "./types";

/**
 * The board view: one column per option of a select-family property.
 *
 * Reuses `CellDisplay` for card values so a value renders identically here and in
 * every other view. Cards are draggable between columns, which writes the option
 * onto the row — the same single-field write as any other cell edit, so a
 * concurrent move needs no special handling. Card contents are rendered by
 * `cards.tsx`, shared with the journal view.
 */

const BoardCard: React.FC<{
  binding: DatabaseBinding;
  row: RowData;
  properties: PropertyDef[];
  readOnly: boolean;
  onOpenRecord: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  dragging: boolean;
}> = ({
  binding,
  row,
  properties,
  readOnly,
  onOpenRecord,
  onDragStart,
  onDragEnd,
  dragging,
}) => {
  const titleProperty = cardTitleProperty(properties);
  const details = cardDetailProperties(binding, row, properties);

  return (
    <Box
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpenRecord}
      sx={{
        p: 1,
        mb: 1,
        borderRadius: 1.5,
        border: "1px solid",
        borderColor: "divider",
        backgroundColor: "background.paper",
        cursor: readOnly ? "pointer" : "grab",
        opacity: dragging ? 0.4 : 1,
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
        transition: "box-shadow 0.15s, transform 0.15s, border-color 0.15s",
        // A card lifts towards the pointer rather than merely darkening: the shadow
        // plus a hairline border is what makes a board's cards read as objects
        // rather than rows in a table.
        "&:hover": {
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
          borderColor: "primary.main",
          transform: "translateY(-1px)",
        },
        "&:hover .card-menu": { opacity: 1 },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            fontWeight: 500,
            wordBreak: "break-word",
            // A half-written record is a real state, and painting the placeholder in
            // the same ink as a name makes an empty card look like an overlong one.
            color: cardIsUntitled(binding, row, titleProperty)
              ? "text.disabled"
              : "text.primary",
          }}
        >
          {cardTitle(binding, row, titleProperty)}
        </Typography>
        {readOnly ? null : (
          <IconButton
            className="card-menu"
            size="small"
            onClick={(event) => {
              // A card click opens the record; the menu must not also do that.
              event.stopPropagation();
              onOpenRecord();
            }}
            aria-label={i18n("db_open_record")}
            sx={{
              mt: -0.5,
              mr: -0.5,
              transition: "opacity 0.15s",
              color: "text.disabled",
              // Revealed on hover, but only where hovering exists — see `TableView`.
              "@media (hover: hover)": { opacity: 0 },
            }}
          >
            <MoreVertRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>

      {details.map((property) => (
        <Box key={property.id} sx={{ mt: 0.5, pl: 0.25 }}>
          <CardDetailLine
            property={property}
            value={row.values[property.id]}
            binding={binding}
            row={row}
          />
        </Box>
      ))}
    </Box>
  );
};

export const BoardView: React.FC<{
  binding: DatabaseBinding;
  /** The view being rendered: supplies grouping, filter and sorts. */
  viewId: string;
  readOnly?: boolean;
  revision: number;
  onOpenRecord: (rowId: string) => void;
}> = ({ binding, viewId, readOnly, revision, onOpenRecord }) => {
  const [draggingRowId, setDraggingRowId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const properties = useMemo(
    // Only the columns this view shows, so hiding one applies on cards too. The
    // grouping property is added back when it is hidden, since a board cannot
    // render its columns without it.
    () => {
      const visible = binding.getViewProperties(viewId);
      const view = binding
        .getViews()
        .find((candidate) => candidate.id === viewId);
      const groupBy = view?.groupBy;
      if (groupBy && !visible.some((property) => property.id === groupBy)) {
        const grouping = binding
          .getProperties()
          .find((property) => property.id === groupBy);
        if (grouping) return [...visible, grouping];
      }
      return visible;
    },
    [binding, viewId, revision],
  );
  const view = useMemo(
    () => binding.getViews().find((candidate) => candidate.id === viewId),
    [binding, viewId, revision],
  );

  // Grouping is a property of the view, so the board needs one selected.
  const groupBy = view?.groupBy;
  const groupProperty = groupBy
    ? properties.find((property) => property.id === groupBy)
    : undefined;

  /**
   * Move a row into a column by writing the option onto it.
   *
   * One option per row is what makes a board a board: the column a card is in *is*
   * its value, so a drop replaces it. There is no multi-select case — grouping is
   * restricted to `select` (see `isGroupablePropType`), which is enforced when the
   * view is configured and re-checked when its groups are read.
   */
  const assignToGroup = (rowId: string, groupKey: string | null) => {
    if (readOnly || !groupProperty) return;
    // An empty column clears the value, which is what dropping into "No value"
    // means; `writeValue` treats "" as absent rather than storing the empty string.
    binding.setValue(rowId, groupProperty.id, groupKey ?? "");
  };

  if (!view) return null;

  if (!groupProperty) {
    return (
      <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
        <Typography variant="body2">{i18n("db_board_needs_group")}</Typography>
        <Typography variant="caption">
          {i18n("db_board_needs_group_hint")}
        </Typography>
      </Box>
    );
  }

  const groups = binding.getViewGroups(view.id);

  return (
    <Box
      sx={{
        display: "flex",
        gap: 1.5,
        alignItems: "flex-start",
        overflowX: "auto",
        pb: 1,
        minHeight: 200,
      }}
    >
      {groups.map((group) => {
        const isUngrouped = group.key === null;
        const columnKey = group.key ?? "__none__";
        const isDropTarget = dropTarget === columnKey;

        return (
          <Box
            key={columnKey}
            onDragOver={(event) => {
              if (!draggingRowId || readOnly) return;
              // Without preventDefault the browser refuses the drop.
              event.preventDefault();
              setDropTarget(columnKey);
            }}
            onDragLeave={() => {
              setDropTarget((current) =>
                current === columnKey ? null : current,
              );
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDropTarget(null);
              if (!draggingRowId) return;
              assignToGroup(draggingRowId, group.key);
              setDraggingRowId(null);
            }}
            sx={{
              width: 280,
              flexShrink: 0,
              borderRadius: 2,
              p: 1,
              pt: 0.75,
              backgroundColor: "action.hover",
              border: "1px solid",
              borderColor: isDropTarget ? "primary.main" : "transparent",
              transition: "background-color 0.15s, border-color 0.15s",
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                mb: 1,
                pb: 0.75,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "3px",
                  backgroundColor: optionColorHex(group.color),
                  flexShrink: 0,
                }}
              />
              <Typography
                variant="body2"
                sx={{ flex: 1, fontWeight: 600 }}
                noWrap
              >
                {isUngrouped ? i18n("db_board_ungrouped") : group.label}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                }}
              >
                {group.rows.length}
              </Typography>
            </Box>

            {group.rows.map((row) => (
              <BoardCard
                key={`${columnKey}-${row.id}`}
                binding={binding}
                row={row}
                properties={properties}
                readOnly={!!readOnly}
                onOpenRecord={() => onOpenRecord(row.id)}
                dragging={draggingRowId === row.id}
                onDragStart={(event) => {
                  event.stopPropagation();
                  // Firefox and Safari refuse to start a drag unless some data is
                  // set on `dataTransfer`, even though the row id is carried in
                  // React state rather than read back at the drop.
                  event.dataTransfer.setData("text/plain", row.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDraggingRowId(row.id);
                }}
                onDragEnd={() => {
                  setDraggingRowId(null);
                  setDropTarget(null);
                }}
              />
            ))}

            {!readOnly ? (
              <Tooltip title={i18n("db_add_row")}>
                <IconButton
                  size="small"
                  onClick={() => {
                    // Create the row already in this column, which is what the user
                    // means by clicking "add" in a specific column.
                    const rowId = binding.addRow(
                      group.key ? { [groupProperty.id]: group.key } : {},
                    );
                    void rowId;
                  }}
                  aria-label={i18n("db_add_row")}
                  sx={{ ml: -0.5, color: "text.secondary" }}
                >
                  <AddRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};
