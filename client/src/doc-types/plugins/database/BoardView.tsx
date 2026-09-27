import React, { useMemo, useState } from "react";
import { Box, Chip, IconButton, Tooltip, Typography } from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import { i18n } from "../../../internationnalization/utils";
import { CellDisplay, summarizeValue } from "./cells";
import { optionColorHex } from "./optionColors";
import { getPropertyTypeMeta } from "./propertyTypes";
import type { DatabaseBinding } from "./model";
import type { PropertyDef, RowData } from "./types";

/**
 * The board view: one column per option of a select-family property.
 *
 * Reuses `CellDisplay` for card values so a value renders identically here and in
 * the table. Cards are draggable between columns, which writes the option onto the
 * row — the same single-field write as any other cell edit, so a concurrent move
 * needs no special handling.
 */

/** Which property on a card is the "title" of the card. */
const cardTitleProperty = (properties: PropertyDef[]) =>
  properties.find((property) => property.type === "title");

/** Up to three secondary properties shown on a card, skipping empties. */
const cardDetailProperties = (
  properties: PropertyDef[],
  row: RowData,
  binding: DatabaseBinding,
): PropertyDef[] =>
  properties
    .filter((property) => property.type !== "title")
    .filter((property) => {
      const value = row.values[property.id];
      if (property.type === "text")
        return binding.getTextString(row, property.id) !== "";
      return value !== undefined && value !== null && value !== "";
    })
    .slice(0, 3);

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
  const titleText = titleProperty
    ? binding.getTextString(row, titleProperty.id)
    : "";
  const title =
    titleText ||
    (titleProperty && typeof row.values[titleProperty.id] === "string"
      ? (row.values[titleProperty.id] as string)
      : "") ||
    i18n("db_record_untitled");

  const details = cardDetailProperties(properties, row, binding);

  return (
    <Box
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpenRecord}
      sx={{
        p: 1,
        mb: 1,
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        backgroundColor: "background.paper",
        cursor: readOnly ? "pointer" : "grab",
        opacity: dragging ? 0.4 : 1,
        transition: "box-shadow 0.15s",
        "&:hover": { boxShadow: 1 },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
        <Typography
          variant="body2"
          sx={{ flex: 1, fontWeight: 500, wordBreak: "break-word" }}
        >
          {title}
        </Typography>
        {readOnly ? null : (
          <IconButton
            size="small"
            onClick={(event) => {
              // A card click opens the record; the menu must not also do that.
              event.stopPropagation();
              onOpenRecord();
            }}
            aria-label={i18n("db_open_record")}
            sx={{ mt: -0.5, mr: -0.5 }}
          >
            <MoreVertRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Box>

      {details.map((property) => {
        const meta = getPropertyTypeMeta(property.type);
        const value = row.values[property.id];
        const text =
          property.type === "text"
            ? binding.getTextString(row, property.id)
            : summarizeValue(property, value);

        return (
          <Box
            key={property.id}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              mt: 0.5,
              minWidth: 0,
            }}
          >
            <meta.Icon
              sx={{ fontSize: 12, color: meta.color, flexShrink: 0 }}
            />
            {property.type === "select" ||
            property.type === "status" ||
            property.type === "multi-select" ||
            property.type === "checkbox" ? (
              <CellDisplay property={property} value={value} />
            ) : (
              <Typography
                variant="caption"
                noWrap
                sx={{ color: "text.secondary" }}
              >
                {text}
              </Typography>
            )}
          </Box>
        );
      })}
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

  /** Move a row into a column by writing the option onto it. */
  const assignToGroup = (rowId: string, groupKey: string | null) => {
    if (readOnly || !groupProperty) return;

    if (groupProperty.type === "multi-select") {
      // Multi-select holds a set, so a drop *adds* the option rather than replacing
      // the row's other tags.
      if (groupKey)
        binding.toggleMultiSelect(rowId, groupProperty.id, groupKey);
      return;
    }
    // select / status hold one option; an empty column clears it.
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
              width: 272,
              flexShrink: 0,
              borderRadius: 1,
              p: 1,
              backgroundColor: isDropTarget
                ? "action.selected"
                : "action.hover",
              border: "1px dashed",
              borderColor: isDropTarget ? "primary.main" : "transparent",
              transition: "background-color 0.15s, border-color 0.15s",
            }}
          >
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: groupProperty.type === "status" ? "50%" : "2px",
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
              <Chip
                size="small"
                label={group.rows.length}
                sx={{ height: 18, fontSize: "0.7rem" }}
              />
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
