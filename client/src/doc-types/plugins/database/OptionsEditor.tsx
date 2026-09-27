import React, { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import { i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import { computeMoveAnchor, isAfterMidpoint } from "./reorder";
import {
  OPTION_COLORS,
  optionColorHex,
  suggestOptionColor,
} from "./optionColors";
import type { DatabaseBinding } from "./model";
import type { OptionDef, PropertyDef } from "./types";

/**
 * The options editor for a `select` / `multi-select` column.
 *
 * Until this existed, the only way to change an option was to create one from the
 * cell picker: `renameOption`, `setOptionColor` and `deleteOption` were reachable only
 * from tests. Options *are* the schema of these types — the column's meaning lives in
 * its option list — so editing them belongs in the column's own menu, next to rename
 * and retype.
 *
 * One editor for both types, because they store options identically.
 *
 * Every edit writes through the binding immediately, so collaborators see each change
 * as it is made and the dialog holds no draft state to lose. That also matches how the
 * rest of the plugin behaves — the retype dialog is the one place with a confirm step,
 * and only because it can destroy data.
 */

/** One row of the editor: swatch, name, and the row's actions. */
const OptionRow: React.FC<{
  binding: DatabaseBinding;
  property: PropertyDef;
  option: OptionDef;
  readOnly: boolean;
  /** This row is the one being dragged. */
  dragging: boolean;
  /** Some row in the list is being dragged, so this row is a drop target. */
  dragActive: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  /** The pointer is over this row; `after` is which half of it. */
  onHover: (after: boolean) => void;
  onDrop: (event: React.DragEvent) => void;
  dropSide: "before" | "after" | null;
  onDelete: () => void;
}> = ({
  binding,
  property,
  option,
  readOnly,
  dragging,
  dragActive,
  onDragStart,
  onDragEnd,
  onHover,
  onDrop,
  dropSide,
  onDelete,
}) => {
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(option.name);

  const commitRename = () => {
    const next = name.trim();
    setRenaming(false);
    // A rename is a `set` on the option's own map, never a delete + re-add: rows
    // hold `optId`s, so re-adding under a new key would detach every row.
    if (next && next !== option.name) {
      binding.renameOption(property.id, option.id, next);
    } else {
      setName(option.name);
    }
  };

  return (
    <Box
      onDragOver={(event) => {
        if (!dragActive || readOnly) return;
        // Without preventDefault the browser refuses the drop entirely, and the
        // before/after indicator below could never appear. The row owns this because
        // it owns its own geometry — the parent only needs to be told which side.
        event.preventDefault();
        onHover(
          isAfterMidpoint(
            event.currentTarget.getBoundingClientRect(),
            { x: event.clientX, y: event.clientY },
            "y",
          ),
        );
      }}
      onDrop={onDrop}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        py: 0.25,
        borderRadius: 1,
        opacity: dragging ? 0.4 : 1,
        "&:hover": { backgroundColor: "action.hover" },
        "&:hover .option-drag": { opacity: 1 },
        // The drop indicator is a top/bottom border: options are a vertical list.
        ...(dropSide === "before" ? { borderTop: "2px solid" } : {}),
        ...(dropSide === "after" ? { borderBottom: "2px solid" } : {}),
        ...(dropSide === "before" ? { borderTopColor: "primary.main" } : {}),
        ...(dropSide === "after" ? { borderBottomColor: "primary.main" } : {}),
      }}
    >
      {!readOnly ? (
        <Box
          className="option-drag"
          component="span"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          sx={{
            opacity: 0,
            display: "flex",
            alignItems: "center",
            cursor: "grab",
            color: "text.disabled",
            transition: "opacity 0.15s",
            "&:hover": { color: "text.secondary" },
          }}
          aria-label={i18n("db_drag_option")}
        >
          <DragIndicatorRoundedIcon sx={{ fontSize: 16 }} />
        </Box>
      ) : null}

      {/* Recolouring is one click on the swatch itself.
          This is an icon-triggered `Menu` rather than a MUI `Select`, because a
          `Select` is a *text field*: it always renders a dropdown arrow, which in a
          26px box lands on top of the swatch and slices a wedge out of the circle.
          Nothing here is text, so nothing needs an arrow — the swatch is the whole
          control. */}
      <Tooltip title={i18n("db_option_color")}>
        <IconButton
          size="small"
          onClick={(event) => setColorAnchor(event.currentTarget)}
          disabled={readOnly}
          aria-label={i18n("db_option_color")}
          sx={{ p: 0.5 }}
        >
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              backgroundColor: optionColorHex(option.color),
              border: "1px solid",
              borderColor: "divider",
            }}
          />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={colorAnchor}
        open={colorAnchor !== null}
        onClose={() => setColorAnchor(null)}
      >
        {OPTION_COLORS.map((color) => (
          <MenuItem
            key={color}
            selected={color === option.color}
            onClick={() => {
              binding.setOptionColor(property.id, option.id, color);
              setColorAnchor(null);
            }}
          >
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                backgroundColor: optionColorHex(color),
                mr: 1,
                border: "1px solid",
                borderColor: "divider",
              }}
            />
            {color}
            {color === option.color ? (
              <CheckRoundedIcon fontSize="small" sx={{ ml: 2 }} />
            ) : null}
          </MenuItem>
        ))}
      </Menu>

      {renaming ? (
        <InputBase
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") {
              setName(option.name);
              setRenaming(false);
            }
          }}
          sx={{ flex: 1, fontSize: "0.875rem" }}
        />
      ) : (
        <Box
          onClick={() => !readOnly && setRenaming(true)}
          sx={{ flex: 1, minWidth: 0, cursor: readOnly ? "default" : "text" }}
        >
          <Chip
            size="small"
            label={option.name}
            sx={{
              backgroundColor: optionColorHex(option.color),
              color: "#fff",
              height: 22,
              fontSize: "0.75rem",
              maxWidth: "100%",
            }}
          />
        </Box>
      )}

      {!readOnly ? (
        <Tooltip title={i18n("db_delete_option")}>
          <IconButton
            size="small"
            onClick={onDelete}
            aria-label={i18n("db_delete_option")}
          >
            <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );
};

/**
 * The options dialog, opened from a column's menu.
 *
 * A flat, drag-orderable list: the order *is* meaningful (it decides the picker's
 * order, a board's column order, and how the column sorts), so the list is shown in
 * the order the options are stored.
 */
export const OptionsEditorDialog: React.FC<{
  binding: DatabaseBinding;
  property: PropertyDef;
  onClose: () => void;
  readOnly?: boolean;
}> = ({ binding, property, onClose, readOnly }) => {
  const [draggingOptId, setDraggingOptId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    optId: string;
    after: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<OptionDef | null>(null);
  const [newName, setNewName] = useState("");

  const options = property.options;

  const addOption = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    binding.addOption(
      property.id,
      name,
      // Cycling the palette stops a fresh list from reading as one grey block.
      suggestOptionColor(options.length),
    );
  };

  const endDrag = () => {
    setDraggingOptId(null);
    setDropTarget(null);
  };

  const dropOption = (event: React.DragEvent) => {
    event.preventDefault();
    const dragged = draggingOptId;
    const target = dropTarget;
    endDrag();
    if (!dragged || !target) return;

    const anchor = computeMoveAnchor(
      options,
      dragged,
      target.optId,
      target.after,
    );
    if (!anchor) return;
    if (anchor.changed) {
      binding.moveOptionBefore(property.id, dragged, anchor.beforeId);
    }
  };

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{i18n("db_edit_options")}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="caption" color="text.secondary">
            {Format(i18n("db_options_for_column"), { name: property.name })}
          </Typography>

          {options.length === 0 ? (
            <Typography
              variant="body2"
              color="text.disabled"
              sx={{ mt: 2, textAlign: "center" }}
            >
              {i18n("db_cell_no_options")}
            </Typography>
          ) : null}

          {/* The drop handler sits on the list, so a drop between rows still lands. */}
          <Box
            sx={{ mt: 1 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={dropOption}
          >
            {options.map((option) => (
              <OptionRow
                key={option.id}
                binding={binding}
                property={property}
                option={option}
                readOnly={!!readOnly}
                dragging={draggingOptId === option.id}
                dragActive={draggingOptId !== null}
                dropSide={
                  dropTarget?.optId === option.id
                    ? dropTarget.after
                      ? "after"
                      : "before"
                    : null
                }
                onDragStart={(event) => {
                  // Firefox refuses to start a drag with no payload set.
                  event.dataTransfer.setData("text/plain", option.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDraggingOptId(option.id);
                }}
                onDragEnd={endDrag}
                onHover={(after) => setDropTarget({ optId: option.id, after })}
                onDrop={dropOption}
                onDelete={() => setDeleting(option)}
              />
            ))}
          </Box>

          {!readOnly ? (
            <Box sx={{ display: "flex", gap: 0.5, mt: 2 }}>
              <InputBase
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addOption();
                }}
                placeholder={i18n("db_option_name")}
                sx={{ flex: 1, fontSize: "0.875rem" }}
              />
              <Button
                size="small"
                startIcon={<AddRoundedIcon />}
                onClick={addOption}
                disabled={!newName.trim()}
              >
                {i18n("db_cell_new_option")}
              </Button>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{i18n("close_button")}</Button>
        </DialogActions>
      </Dialog>

      {/* Deleting an option clears it from every row, so it asks first. */}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{i18n("db_delete_option")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {Format(i18n("db_confirm_delete_option"), {
              name: deleting?.name ?? "",
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>
            {i18n("cancel_button")}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (deleting) {
                binding.deleteOption(property.id, deleting.id);
              }
              setDeleting(null);
            }}
          >
            {i18n("db_delete_option")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
