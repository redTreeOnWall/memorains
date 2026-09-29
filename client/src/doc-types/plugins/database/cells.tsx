import React, { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type { Theme } from "@mui/material/styles";
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
import { optionChipSx, optionColorHex, type PropertyDef } from "./optionColors";
import type { DateValue, RowData } from "./types";
/**
 * Inline (table) editors.
 *
 * An editing cell should look like the cell it replaced, tinted to signal "this one is
 * live" — not like a form field dropped into a table. MUI's `standard` variant draws
 * a 2px underline in a pseudo-element, which reads as a form row rather than a cell,
 * so the variant is made invisible and the cell itself becomes the surface: a soft
 * fill with a hairline ring.
 *
 * The underline pseudo-elements are neutralised on three selectors, not one. MUI
 * colours `::before` from `.MuiInput-underline:before` (0,2,0), `.MuiInput-underline:hover:not(.Mui-disabled):before`
 * (0,3,0) and `.MuiInput-underline.Mui-focused:after` (0,3,0) — a single rule of the
 * same shape loses the two more specific ones, which is why the underline used to
 * survive on hover and focus in a slightly different shade.
 */
const inlineInputSx = {
  "& .MuiInputBase-root": {
    fontSize: "0.875rem",
    borderRadius: 1,
    backgroundColor: "action.hover",
    // No horizontal padding of its own: the cell row supplies the inset, so switching a
    // cell into edit mode does not shift its text sideways. A `box-shadow` ring rather
    // than a border, because a border would add to the box and move the row.
    px: 0,
    boxShadow: (theme: Theme) => `inset 0 0 0 1px ${theme.palette.divider}`,
    "&.Mui-focused": {
      boxShadow: (theme: Theme) =>
        `inset 0 0 0 1.5px ${theme.palette.primary.main}`,
    },
    // MUI's `small` standard input carries `padding: 1px 0 5px`, which pushes the text
    // 2px above the middle of the box it sits in. Symmetric padding re-centres it, and
    // the totals are unchanged (3 + 3 against 1 + 5), so the box keeps its height and
    // the row does not move. Horizontal padding stays 0: the inset is the root's `px`.
    "& .MuiInputBase-input": { paddingTop: "3px", paddingBottom: "3px" },
  },
  // The three selectors MUI colours the underline from, stated separately rather than
  // as one comma-joined key: emotion emits the object keys verbatim, so a multi-line
  // key would be an unterminated string literal.
  "& .MuiInput-underline:before": { borderBottom: "none" },
  "& .MuiInput-underline:hover:not(.Mui-disabled):before": {
    borderBottom: "none",
  },
  "& .MuiInput-underline.Mui-focused:after": { borderBottom: "none" },
} as const;

/**
 * The panel's editors are real outlined fields, so they get a softly rounded corner
 * and a visible focus ring instead of the browser default.
 */
const expandedInputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 1.5,
    backgroundColor: "action.hover",
    "& fieldset": { borderColor: "transparent" },
    "&:hover fieldset": { borderColor: "divider" },
    "&.Mui-focused fieldset": {
      borderColor: "primary.main",
      borderWidth: "1px",
    },
  },
} as const;

/** Vertical padding of an expanded custom field, matching the outlined inputs. */
const expandedFieldPy = 1.25;

/**
 * The same soft field the text and number editors get, for the read-only types.
 *
 * `date` and `select` render their own clickable box rather than a `TextField`, so
 * without this they would sit as bare outlines beside a column of tinted fields — the
 * panel looking like two different forms stacked on top of each other. Declared as
 * longhands because a `border` shorthand resets `borderColor` when both are set from
 * one style object.
 */
const expandedFieldSx = {
  borderRadius: 1.5,
  backgroundColor: "action.hover",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "transparent",
  py: expandedFieldPy,
} as const;

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
  /**
   * The title is a heading, not a body of text.
   *
   * In the record panel an `expanded` text cell is a tall textarea, which is right for
   * `Notes` and wrong for `Name`: it turned the record's name into an eight-line box
   * with a paragraph of empty space under it. The title stays a single, large line.
   */
  const isTitle = property.type === "title";

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
      multiline={expanded && !isTitle}
      minRows={expanded && !isTitle ? 8 : undefined}
      maxRows={expanded && !isTitle ? undefined : 1}
      fullWidth
      size="small"
      variant={expanded ? "outlined" : "standard"}
      placeholder={
        // The panel's own hint for an untitled record lives *in* the field rather than
        // under it: a caption below an empty box said the same thing twice.
        expanded
          ? isTitle
            ? i18n("db_record_untitled")
            : i18n("db_cell_text_placeholder")
          : undefined
      }
      sx={expanded ? expandedInputSx : inlineInputSx}
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
      sx={expanded ? expandedInputSx : inlineInputSx}
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
      sx={expanded ? expandedInputSx : inlineInputSx}
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
          ...(expanded
            ? expandedFieldSx
            : { borderRadius: 1, px: 0, py: 0.25 }),
          minHeight: expanded ? 40 : 28,
          "&:hover": disabled
            ? undefined
            : {
                backgroundColor: "action.hover",
                borderColor: expanded ? "divider" : "transparent",
              },
        }}
      >
        <EventRoundedIcon
          sx={{
            fontSize: 16,
            color: hasValue ? "text.secondary" : "text.disabled",
          }}
        />
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
          ...(expanded
            ? { ...expandedFieldSx, px: 1 }
            : { borderRadius: 1, px: 0, py: 0 }),
          minHeight: expanded ? 40 : 28,
          width: "100%",
          "&:hover": disabled
            ? undefined
            : {
                backgroundColor: "action.hover",
                borderColor: expanded ? "divider" : "transparent",
              },
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
                sx={optionChipSx(option?.color)}
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
                    width: 14,
                    height: 14,
                    borderRadius: "4px",
                    backgroundColor: optionColorHex(option.color),
                    border: "1px solid",
                    borderColor: "divider",
                    mr: 1,
                    flexShrink: 0,
                  }}
                />
                <ListItemText>{option.name}</ListItemText>
                {isSelected ? (
                  <CheckRoundedIcon fontSize="small" color="primary" />
                ) : null}
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
 *
 * An **empty** value paints nothing at all. It used to render a body-text node with
 * the cell's own line height, which is what made empty rows read taller and heavier
 * than the rows beside them, purely because nothing was in them.
 */
export const CellDisplay: React.FC<{
  property: PropertyDef;
  value: unknown;
  /** Override for the link target, so urls render as links. */
  onOpenUrl?: (url: string) => void;
}> = ({ property, value, onOpenUrl }) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (property.type === "checkbox") {
    return (
      <Checkbox size="small" checked={value === true} disabled disableRipple />
    );
  }

  if (property.type === "select") {
    const option = property.options.find((candidate) => candidate.id === value);
    if (!option) return null;
    return (
      <Chip size="small" label={option.name} sx={optionChipSx(option.color)} />
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
              sx={optionChipSx(option?.color)}
            />
          );
        })}
      </Box>
    );
  }

  if (property.type === "date") {
    // `dateCellText`, not `displayValue`: the latter returns the raw stored value for
    // export, which reads as an ISO timestamp in a cell. `noWrap` keeps a narrow
    // column from breaking the date across two lines.
    const label = dateCellText(
      isDateValue(value) ? value : null,
      formatSmartDate,
    );
    return (
      <Typography variant="body2" noWrap>
        {label}
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
