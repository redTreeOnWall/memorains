import React, { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import {
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  InputBase,
  Link,
  ListItemText,
  Menu,
  MenuItem,
  MenuList,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { datePickerDialog } from "../../../components/common/DatePickerDialogService";
import { i18n } from "../../../internationnalization/utils";
import { formatSmartDate } from "../../../utils/utils";
import { dateCellText, displayValue } from "./retype";
import { optionColorHex, type PropertyDef } from "./optionColors";
import type { DateValue, RowData } from "./types";

/**
 * The shared cell-editing components.
 *
 * One component per property type, used by **both** the table (inline) and the
 * record edit panel. There is no separate "panel version": the panel simply gives
 * the same component more room, which is what makes editing uniform across every
 * view and keeps the two from drifting apart.
 *
 * Every editor is controlled and commits through a callback, so the owner decides
 * whether to write to the document immediately (table) or on close (panel).
 */

export interface CellEditorProps {
  property: PropertyDef;
  /** Current value in plain form: string for text, number, option id, etc. */
  value: unknown;
  /** Live `Y.Text` for text-typed cells, so keystrokes can be spliced. */
  text: Y.Text | null;
  row: RowData;
  onChange: (value: unknown) => void;
  /** Commit a `Y.Text` change from a full string, as one minimal splice. */
  onTextChange: (next: string) => void;
  /** Toggle one option of a multi-select cell. */
  onToggleOption: (optId: string) => void;
  /** Create a new option inline and return its id, if the type supports options. */
  onCreateOption?: (name: string) => string | null;
  /** Read-only (view mode or a viewer without edit rights). */
  disabled?: boolean;
  /** Grow to fill the panel rather than sitting inline in a table cell. */
  expanded?: boolean;
  autoFocus?: boolean;
  /** Called when the user leaves the field, so the table can exit edit mode. */
  onDoneEditing?: () => void;
}

// ---------------------------------------------------------------- text cells

/**
 * A text cell.
 *
 * Reads its value straight from the `Y.Text` and writes back a whole string; the
 * binding turns that into one minimal splice, so two peers editing different parts
 * of the same cell merge instead of overwriting each other. This is why the
 * component is *not* given a local copy of the value to hold in React state.
 */
export const TextCellEditor: React.FC<CellEditorProps> = ({
  text,
  onTextChange,
  disabled,
  expanded,
  autoFocus,
  onDoneEditing,
  property,
}) => {
  const [local, setLocal] = useState(() => text?.toString() ?? "");
  const isFocused = useRef(false);

  // Adopt remote changes, but never while the user is typing here — that would
  // move their caret.
  useEffect(() => {
    if (isFocused.current) return;
    const next = text?.toString() ?? "";
    setLocal((current) => (current === next ? current : next));
  }, [text, text?.length]);

  // Which characters moved during the last recompute, so a remote insertion can
  // be shown as a hint rather than silently appearing inside the caret's path.
  const handleChange = (next: string) => {
    setLocal(next);
    onTextChange(next);
  };

  return (
    <TextField
      value={local}
      onChange={(event) => handleChange(event.target.value)}
      onFocus={() => {
        isFocused.current = true;
      }}
      onBlur={() => {
        isFocused.current = false;
        onDoneEditing?.();
      }}
      disabled={disabled}
      autoFocus={autoFocus}
      multiline={expanded}
      minRows={expanded ? 8 : undefined}
      maxRows={expanded ? undefined : 1}
      fullWidth
      size="small"
      variant={expanded ? "outlined" : "standard"}
      placeholder={expanded ? i18n("db_cell_text_placeholder") : undefined}
      sx={
        expanded
          ? undefined
          : {
              "& .MuiInputBase-root": { fontSize: "0.875rem" },
              "& .MuiInput-underline:before": { borderBottom: "none" },
              "& .MuiInput-underline:hover:before": { borderBottom: "none" },
              "& .MuiInput-underline:after": { borderBottom: "none" },
            }
      }
      inputProps={{
        "aria-label": property.name,
      }}
    />
  );
};

// ------------------------------------------------------------ plain strings

/**
 * A single-line string cell for `url` / `email` / `phone`.
 *
 * These are stored as plain strings rather than `Y.Text`: they are short, always
 * replaced wholesale, and there is no useful way to merge two different addresses.
 */
export const PlainStringCellEditor: React.FC<CellEditorProps> = ({
  value,
  onChange,
  disabled,
  expanded,
  autoFocus,
  onDoneEditing,
  property,
}) => {
  const stringValue = typeof value === "string" ? value : "";
  const [local, setLocal] = useState(stringValue);

  useEffect(() => {
    setLocal(stringValue);
  }, [stringValue]);

  return (
    <TextField
      value={local}
      type={
        property.type === "email"
          ? "email"
          : property.type === "phone"
            ? "tel"
            : "url"
      }
      onChange={(event) => {
        setLocal(event.target.value);
        onChange(event.target.value);
      }}
      onBlur={onDoneEditing}
      disabled={disabled}
      autoFocus={autoFocus}
      fullWidth
      size="small"
      variant={expanded ? "outlined" : "standard"}
      // No `label` when expanded: the record panel renders the property name above
      // the field already, and an outlined `TextField` with a label repeats it inside
      // the border — on a phone that costs a whole line and reads as two names.
      sx={
        expanded
          ? undefined
          : {
              "& .MuiInputBase-root": { fontSize: "0.875rem" },
              "& .MuiInput-underline:before": { borderBottom: "none" },
              "& .MuiInput-underline:hover:before": { borderBottom: "none" },
              "& .MuiInput-underline:after": { borderBottom: "none" },
            }
      }
    />
  );
};

// ------------------------------------------------------------------- number

export const NumberCellEditor: React.FC<CellEditorProps> = ({
  value,
  onChange,
  disabled,
  expanded,
  autoFocus,
  onDoneEditing,
}) => {
  const numeric = typeof value === "number" ? String(value) : "";
  const [local, setLocal] = useState(numeric);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setLocal(typeof value === "number" ? String(value) : "");
    setInvalid(false);
  }, [value]);

  return (
    <TextField
      value={local}
      onChange={(event) => {
        const raw = event.target.value;
        setLocal(raw);
        if (raw.trim() === "") {
          setInvalid(false);
          // Empty means "absent", not zero.
          onChange("");
          return;
        }
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          setInvalid(false);
          onChange(parsed);
        } else {
          // Refuse to store NaN: it would render as an empty cell while still
          // being a value, so `is_empty` would be wrong.
          setInvalid(true);
        }
      }}
      onBlur={onDoneEditing}
      disabled={disabled}
      autoFocus={autoFocus}
      fullWidth
      size="small"
      type="text"
      inputMode="decimal"
      error={invalid}
      helperText={invalid ? i18n("db_cell_number_invalid") : undefined}
      variant={expanded ? "outlined" : "standard"}
      // The panel supplies the name; see `PlainStringCellEditor`.
      sx={
        expanded
          ? undefined
          : {
              "& .MuiInputBase-root": { fontSize: "0.875rem" },
              "& .MuiInput-underline:before": { borderBottom: "none" },
              "& .MuiInput-underline:hover:before": { borderBottom: "none" },
              "& .MuiInput-underline:after": { borderBottom: "none" },
            }
      }
    />
  );
};

// ----------------------------------------------------------------- checkbox

export const CheckboxCellEditor: React.FC<CellEditorProps> = ({
  value,
  onChange,
  disabled,
  expanded,
}) => (
  <FormControlLabel
    control={
      <Checkbox
        size="small"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
    }
    // The panel supplies the name; a checkbox has no room for one anyway.
    label=""
    sx={expanded ? { mt: 0.5 } : { m: 0 }}
  />
);

// --------------------------------------------------------------------- date

export const DateCellEditor: React.FC<CellEditorProps> = ({
  value,
  onChange,
  disabled,
  expanded,
}) => {
  const dateValue = isDateValue(value) ? value : null;
  const hasValue = dateValue !== null;

  const openPicker = async () => {
    if (disabled) return;
    const result = await datePickerDialog.open({
      title: i18n("db_cell_pick_date"),
      initDate: hasValue ? Date.parse(dateValue.start) : undefined,
      buttonText: i18n("confirm_button"),
    });
    if (result.type === "confirm") {
      onChange({
        start: new Date(result.timestamp).toISOString(),
      } satisfies DateValue);
    } else if (result.type === "clear") {
      onChange("");
    }
  };

  return (
    <Box
      sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%" }}
    >
      <Box
        onClick={openPicker}
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          cursor: disabled ? "default" : "pointer",
          borderRadius: 1,
          px: expanded ? 1.5 : 0.5,
          py: expanded ? 1.25 : 0.25,
          border: expanded ? "1px solid" : "none",
          borderColor: "divider",
          minHeight: expanded ? 40 : 28,
          "&:hover": disabled ? undefined : { backgroundColor: "action.hover" },
        }}
      >
        <EventRoundedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
        {hasValue ? (
          <Typography variant="body2">
            {dateCellText(dateValue, formatSmartDate)}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.disabled">
            {expanded ? i18n("db_cell_pick_date") : ""}
          </Typography>
        )}
      </Box>
      {hasValue && !disabled ? (
        <IconButton
          size="small"
          onClick={() => onChange("")}
          aria-label="clear date"
        >
          <CloseRoundedIcon fontSize="inherit" />
        </IconButton>
      ) : null}
    </Box>
  );
};

const isDateValue = (value: unknown): value is DateValue =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as DateValue).start === "string" &&
  (value as DateValue).start !== "";

// ------------------------------------------------------------- select family

/**
 * The option picker shared by `select` and `multi-select`.
 *
 * One implementation for both, because the only difference is whether more than one
 * choice is allowed.
 */
export const OptionCellEditor: React.FC<CellEditorProps> = ({
  property,
  value,
  onChange,
  onToggleOption,
  onCreateOption,
  disabled,
  expanded,
  autoFocus,
}) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const isMulti = property.type === "multi-select";
  const selectedIds = isMulti
    ? Array.isArray(value)
      ? (value as string[])
      : []
    : typeof value === "string" && value
      ? [value]
      : [];

  const commitCreate = () => {
    const name = newName.trim();
    setNewName("");
    setCreating(false);
    if (!name || !onCreateOption) return;
    const optId = onCreateOption(name);
    if (!optId) return;
    if (isMulti) onToggleOption(optId);
    else onChange(optId);
  };

  return (
    <>
      <Box
        onClick={(event) => {
          if (disabled) return;
          setAnchor(event.currentTarget);
        }}
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 0.5,
          cursor: disabled ? "default" : "pointer",
          borderRadius: 1,
          px: expanded ? 1 : 0.25,
          py: expanded ? 1 : 0.25,
          border: expanded ? "1px solid" : "none",
          borderColor: "divider",
          minHeight: expanded ? 40 : 28,
          width: "100%",
          "&:hover": disabled ? undefined : { backgroundColor: "action.hover" },
        }}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-label={property.name}
      >
        {selectedIds.length === 0 ? (
          <Typography variant="body2" color="text.disabled">
            {expanded ? i18n("db_cell_select_option") : ""}
          </Typography>
        ) : (
          selectedIds.map((optId) => {
            const option = property.options.find(
              (candidate) => candidate.id === optId,
            );
            return (
              <Chip
                key={optId}
                size="small"
                label={option?.name ?? optId}
                sx={{
                  backgroundColor: optionColorHex(option?.color),
                  color: "#fff",
                  height: 22,
                  fontSize: "0.75rem",
                }}
              />
            );
          })
        )}
      </Box>

      <Menu
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(null);
          setCreating(false);
          setNewName("");
        }}
        autoFocus={autoFocus}
      >
        <MenuList
          dense
          sx={{ minWidth: 220, maxHeight: 380, overflowY: "auto" }}
        >
          {property.options.map((option) => {
            const isSelected = selectedIds.includes(option.id);
            return (
              <MenuItem
                key={option.id}
                selected={isSelected}
                onClick={() => {
                  if (isMulti) onToggleOption(option.id);
                  else {
                    onChange(isSelected ? "" : option.id);
                    setAnchor(null);
                  }
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: optionColorHex(option.color),
                    mr: 1,
                    flexShrink: 0,
                  }}
                />
                <ListItemText>{option.name}</ListItemText>
                {isSelected ? <CheckRoundedIcon fontSize="small" /> : null}
              </MenuItem>
            );
          })}

          {property.options.length === 0 && !creating ? (
            <MenuItem disabled>
              <ListItemText>{i18n("db_cell_no_options")}</ListItemText>
            </MenuItem>
          ) : null}

          {onCreateOption ? (
            creating ? (
              <Box sx={{ px: 2, py: 1, display: "flex", gap: 0.5 }}>
                <InputBase
                  autoFocus
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitCreate();
                    if (event.key === "Escape") {
                      setCreating(false);
                      setNewName("");
                    }
                  }}
                  placeholder={i18n("db_cell_new_option")}
                  sx={{ flex: 1, fontSize: "0.875rem" }}
                />
                <IconButton
                  size="small"
                  onClick={commitCreate}
                  aria-label="create option"
                >
                  <CheckRoundedIcon fontSize="small" />
                </IconButton>
              </Box>
            ) : (
              <MenuItem
                onClick={() => {
                  setCreating(true);
                  setNewName("");
                }}
              >
                <AddRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                <ListItemText>{i18n("db_cell_new_option")}</ListItemText>
              </MenuItem>
            )
          ) : null}
        </MenuList>
      </Menu>
    </>
  );
};

// -------------------------------------------------------------- read display

/**
 * Read-only rendering of any value, used by list and board views and by the table
 * when a cell is not being edited.
 */
export const CellDisplay: React.FC<{
  property: PropertyDef;
  value: unknown;
  /** Override for the link target, so urls render as links. */
  onOpenUrl?: (url: string) => void;
}> = ({ property, value, onOpenUrl }) => {
  if (value === undefined || value === null || value === "") {
    return <Typography variant="body2" color="text.disabled" />;
  }

  if (property.type === "checkbox") {
    return (
      <Checkbox size="small" checked={value === true} disabled disableRipple />
    );
  }

  if (property.type === "select") {
    const option = property.options.find((candidate) => candidate.id === value);
    if (!option) return <Typography variant="body2" color="text.disabled" />;
    return (
      <Chip
        size="small"
        label={option.name}
        sx={{
          backgroundColor: optionColorHex(option.color),
          color: "#fff",
          height: 22,
          fontSize: "0.75rem",
        }}
      />
    );
  }

  if (property.type === "multi-select") {
    const ids = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {ids.map((optId) => {
          const option = property.options.find(
            (candidate) => candidate.id === optId,
          );
          return (
            <Chip
              key={optId}
              size="small"
              label={option?.name ?? optId}
              sx={{
                backgroundColor: optionColorHex(option?.color),
                color: "#fff",
                height: 22,
                fontSize: "0.75rem",
              }}
            />
          );
        })}
      </Box>
    );
  }

  if (property.type === "date") {
    // `dateCellText`, not `displayValue`: the latter returns the raw stored value for
    // export, which reads as an ISO timestamp in a cell.
    return (
      <Typography variant="body2">
        {dateCellText(isDateValue(value) ? value : null, formatSmartDate)}
      </Typography>
    );
  }

  if (property.type === "url" && typeof value === "string") {
    return (
      <Link
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          if (onOpenUrl) {
            event.preventDefault();
            onOpenUrl(value);
          }
        }}
        sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}
      >
        <Typography variant="body2" noWrap sx={{ maxWidth: 240 }}>
          {value}
        </Typography>
        <OpenInNewRoundedIcon sx={{ fontSize: 12 }} />
      </Link>
    );
  }

  const text = displayValue(
    typeof value === "object" && value !== null && "start" in value
      ? (value as DateValue)
      : (value as string | number | boolean | string[]),
    property.type,
    property.options,
  );

  return (
    <Tooltip title={text} disableHoverListener={text.length < 40}>
      <Typography variant="body2" noWrap>
        {text}
      </Typography>
    </Tooltip>
  );
};

/** Compact one-line value summary, for board cards and list rows. */
export function summarizeValue(property: PropertyDef, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (property.type === "date")
    return dateCellText(isDateValue(value) ? value : null, formatSmartDate);
  if (property.type === "checkbox") return value === true ? "✓" : "";
  return displayValue(
    value as string | number | boolean | string[],
    property.type,
    property.options,
  );
}
