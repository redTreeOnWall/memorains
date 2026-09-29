import React, { useState } from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputBase,
  Popover,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import { i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog";
import { computeMoveAnchor, isAfterMidpoint } from "./reorder";
import {
  COLOR_COLUMNS,
  COLOR_TIERS,
  TIER_LABEL_KEYS,
  contrastInk,
  isKnownOptionColor,
  optionChipSx,
  optionColorHex,
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

/**
 * The colour picker: the palette as a matrix, plus a custom colour.
 *
 * A hue per row, a lightness tier per column, so reading down a column is one weight and
 * across a row is one hue. No colour names — they are stored identifiers, not something
 * anyone choosing a colour needs.
 */
const OptionColorPicker: React.FC<{
  /** The option's current colour: a palette name, or a hex when custom. */
  value: string | undefined;
  /** The element the swatch button is anchored to. */
  anchorEl: HTMLElement;
  onPick: (color: string) => void;
  onClose: () => void;
}> = ({ value, anchorEl, onPick, onClose }) => {
  const [custom, setCustom] = useState<string>(() => optionColorHex(value));

  /** A user's own colour: neither `undefined` nor one of the palette's names. */
  const customActive = value !== undefined && !isKnownOptionColor(value);

  /** The swatch cell, shared by the palette and the custom well. */
  const cellSx = {
    p: 0,
    width: 24,
    height: 24,
    borderRadius: "6px",
    border: "1px solid",
    borderColor: "rgba(0, 0, 0, 0.15)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "transform 0.1s",
    "&:hover": { transform: "scale(1.12)" },
  } as const;

  /** An inset ring, so neighbouring cells keep their spacing and nothing is clipped. */
  const selectedRing = (hex: string) => ({
    boxShadow: `inset 0 0 0 2px rgba(255, 255, 255, 0.9), inset 0 0 0 3.5px ${hex}`,
  });

  return (
    <Popover
      open
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{ paper: { sx: { p: 1.5 } } }}
    >
      <Box
        sx={{
          display: "grid",
          // Heading text is wider than the 24px column beneath it; the 6px gap absorbs
          // the overhang, and clipping it would be worse.
          gridTemplateColumns: "repeat(3, 24px)",
          columnGap: "6px",
          rowGap: "6px",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {COLOR_TIERS.map((tier) => (
          <Typography
            key={tier}
            variant="caption"
            noWrap
            sx={{
              textAlign: "center",
              color: "text.secondary",
              fontWeight: 600,
              fontSize: 10,
              lineHeight: 1,
              overflow: "visible",
            }}
          >
            {i18n(TIER_LABEL_KEYS[tier])}
          </Typography>
        ))}

        {/* One row per hue: the same hue at each of the three weights. */}
        {COLOR_COLUMNS[0].map((_, row) =>
          COLOR_COLUMNS.map((column) => {
            const swatch = column[row];
            const active = value === swatch.name;
            return (
              <Tooltip
                key={swatch.name}
                title={swatch.hex}
                enterDelay={500}
                disableInteractive
              >
                <Box
                  component="button"
                  type="button"
                  onClick={() => onPick(swatch.name)}
                  aria-label={swatch.hex}
                  aria-pressed={active}
                  sx={{
                    ...cellSx,
                    justifySelf: "center",
                    backgroundColor: swatch.hex,
                    ...(active ? selectedRing(swatch.hex) : {}),
                  }}
                >
                  {active ? (
                    <CheckRoundedIcon
                      sx={{ fontSize: 15, color: contrastInk(swatch.hex) }}
                    />
                  ) : null}
                </Box>
              </Tooltip>
            );
          }),
        )}
      </Box>

      <Divider sx={{ my: 1.5 }} />

      {/*
        An always-visible colour well, storing the raw hex. Only the box is styleable —
        the control itself is an OS widget.
      */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box
          component="input"
          type="color"
          value={custom}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setCustom(event.target.value);
            onPick(event.target.value);
          }}
          aria-label={i18n("db_color_custom")}
          sx={{
            ...cellSx,
            backgroundColor: custom,
            ...(customActive ? selectedRing(custom) : {}),
            "&::-webkit-color-swatch-wrapper": { p: 0 },
            "&::-webkit-color-swatch": { border: "none", borderRadius: 5 },
            "&::-moz-color-swatch": { border: "none", borderRadius: 5 },
          }}
        />
        <PaletteOutlinedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {i18n("db_color_custom")}
        </Typography>
      </Box>
    </Popover>
  );
};

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
        py: 0.5,
        px: 0.5,
        borderRadius: 1,
        opacity: dragging ? 0.4 : 1,
        "&:hover": { backgroundColor: "action.hover" },
        "&:hover .option-drag": { opacity: 1 },
        "&:hover .option-delete": { opacity: 1 },
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
              width: 18,
              height: 18,
              borderRadius: "5px",
              backgroundColor: optionColorHex(option.color),
              border: "1px solid",
              borderColor: "rgba(0, 0, 0, 0.15)",
            }}
          />
        </IconButton>
      </Tooltip>

      {/* The popover anchors to the swatch button, which is a live element. */}
      {colorAnchor ? (
        <OptionColorPicker
          value={option.color}
          anchorEl={colorAnchor}
          onPick={(color) =>
            binding.setOptionColor(property.id, option.id, color)
          }
          onClose={() => setColorAnchor(null)}
        />
      ) : null}
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
            sx={{ ...optionChipSx(option.color), maxWidth: "100%" }}
          />
        </Box>
      )}
      {!readOnly ? (
        <Tooltip title={i18n("db_delete_option")}>
          <IconButton
            className="option-delete"
            size="small"
            onClick={onDelete}
            aria-label={i18n("db_delete_option")}
            sx={{
              transition: "opacity 0.15s",
              color: "text.disabled",
              // Revealed on hover, but only where hovering exists — see `TableView`.
              "@media (hover: hover)": { opacity: 0 },
            }}
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
  const [deletingOptId, setDeletingOptId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const options = property.options;

  /** The option a confirmation is open for, resolved against the live property. */
  const pendingDeleteOption =
    (deletingOptId
      ? options.find((option) => option.id === deletingOptId)
      : undefined) ?? null;

  const addOption = () => {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    // No colour: the binding cycles the palette, which is what stops a fresh list from
    // reading as one grey block.
    binding.addOption(property.id, name);
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
      <Dialog open onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle sx={{ pb: 0.5 }}>{i18n("db_edit_options")}</DialogTitle>
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
            sx={{ mt: 1, ml: -0.5, mr: -0.5 }}
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
                onDelete={() => setDeletingOptId(option.id)}
              />
            ))}
          </Box>

          {!readOnly ? (
            <Box
              sx={{
                display: "flex",
                gap: 1,
                alignItems: "center",
                mt: 2,
                pt: 1.5,
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              <InputBase
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addOption();
                }}
                placeholder={i18n("db_option_name")}
                sx={{
                  flex: 1,
                  fontSize: "0.875rem",
                  px: 1,
                  py: 0.5,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 1,
                  "&.Mui-focused": { borderColor: "primary.main" },
                }}
              />
              <Button
                size="small"
                variant="contained"
                startIcon={<AddRoundedIcon />}
                onClick={addOption}
                disabled={!newName.trim()}
                sx={{ textTransform: "none", flexShrink: 0 }}
              >
                {i18n("db_cell_new_option")}
              </Button>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ textTransform: "none" }}>
            {i18n("close_button")}
          </Button>
        </DialogActions>
      </Dialog>

      {/*
        Deleting an option clears it from every row, so it asks first — with the same
        shared dialog as record, column and view deletion, so the four cannot drift in
        wording, width or focus behaviour.

        The dialog holds the option's **id** and resolves it against the live property,
        rather than a snapshot: a collaborator's rename while the prompt is open shows
        up, and an option deleted remotely closes it instead of deleting nothing.
      */}
      <ConfirmDialog
        open={pendingDeleteOption !== null}
        title={i18n("db_delete_option")}
        content={Format(i18n("db_confirm_delete_option"), {
          name: pendingDeleteOption?.name ?? "",
        })}
        confirmText={i18n("db_delete_option")}
        confirmColor="error"
        onClose={() => setDeletingOptId(null)}
        onConfirm={() => {
          const target = deletingOptId;
          setDeletingOptId(null);
          if (target) binding.deleteOption(property.id, target);
        }}
      />
    </>
  );
};
