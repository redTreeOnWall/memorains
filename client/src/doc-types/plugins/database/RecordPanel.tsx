import React, { useCallback, useMemo, useState } from "react";
import {
  Box,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog";
import { getPropertyTypeMeta } from "./propertyTypes";
import { CellEditor, type CellEditorCallbacks } from "./CellEditor";
import type { DatabaseBinding } from "./model";
import type { RowData } from "./types";

/**
 * The record edit panel.
 *
 * This is the **uniform editing surface for every view**: the table, a future
 * board and a future list all open records here, so there is one place where a
 * record can be edited in full rather than a per-view reimplementation.
 *
 * The fields are the very same `CellEditor` components the table uses inline — the
 * panel only gives them more room. That is the point: a text cell behaves
 * identically whether edited in a table cell or here, so the two cannot drift.
 *
 * It renders as a side drawer matching Notion's "side peek": the database stays
 * visible and interactive behind it, which matters because editing a record often
 * means comparing it with its neighbours.
 *
 * Deleting asks first. The button sits in the panel's header next to Close, and the
 * panel is the one place a record is edited in full — so its delete is the most
 * reachable destructive action in the plugin and the easiest to hit by accident
 * while reaching for Close.
 */
export const RecordPanel: React.FC<{
  binding: DatabaseBinding;
  row: RowData | null;
  onClose: () => void;
  readOnly?: boolean;
  /** Called after a mutating action so the host can refresh derived state. */
  onChanged?: () => void;
}> = ({ binding, row, onClose, readOnly, onChanged }) => {
  /**
   * Which record the confirmation is for, rather than a plain boolean.
   *
   * The panel stays mounted across records, so a boolean would outlive its subject:
   * if the row was deleted by a collaborator while the dialog was open, the flag
   * would still be set and the dialog would reappear for whichever record the user
   * opened next. Tying it to the id makes that unrepresentable — a confirmation for
   * a record that is no longer the open one simply is not open.
   */
  const [confirmingRowId, setConfirmingRowId] = useState<string | null>(null);
  const properties = useMemo(() => binding.getProperties(), [binding, row]);

  const callbacks = useCallback(
    (propId: string): CellEditorCallbacks => ({
      onChange: (value) => {
        if (readOnly || !row) return;
        binding.setValue(row.id, propId, value);
        onChanged?.();
      },
      onTextChange: (next) => {
        if (readOnly || !row) return;
        // Goes through the binding's diffing writer, so this is one minimal
        // splice and concurrent edits elsewhere in the cell still merge.
        binding.setText(row.id, propId, next);
        onChanged?.();
      },
      onToggleOption: (optId) => {
        if (readOnly || !row) return;
        binding.toggleMultiSelect(row.id, propId, optId);
        onChanged?.();
      },
      onCreateOption: (name) => {
        if (readOnly || !row) return null;
        const created = binding.addOption(propId, name);
        onChanged?.();
        return created;
      },
    }),
    [binding, onChanged, readOnly, row],
  );

  const titleProperty = properties.find(
    (property) => property.type === "title",
  );
  const otherProperties = properties.filter(
    (property) => property.type !== "title",
  );

  const titleText =
    row && titleProperty ? binding.getText(row, titleProperty.id) : null;
  const titleString = titleText?.toString() ?? "";

  /** The record's name, for the delete confirmation. Empty when untitled. */
  const rowTitle = titleString.trim();

  return (
    <Drawer
      anchor="right"
      open={row !== null}
      onClose={onClose}
      // The database must stay usable behind the panel.
      ModalProps={{ keepMounted: false, disableEnforceFocus: true }}
      PaperProps={{
        sx: { width: { xs: "100%", sm: 480 }, maxWidth: "100%" },
      }}
    >
      {row ? (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 2,
              py: 1,
              borderBottom: "1px solid",
              borderColor: "divider",
              flexShrink: 0,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ flex: 1, fontWeight: 600, letterSpacing: "0.08em" }}
            >
              {i18n("db_record_panel_title")}
            </Typography>
            {!readOnly ? (
              <Tooltip title={i18n("db_delete_row")}>
                <IconButton
                  size="small"
                  onClick={() => setConfirmingRowId(row.id)}
                  aria-label={i18n("db_delete_row")}
                  sx={{ color: "text.secondary" }}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <IconButton
              size="small"
              onClick={onClose}
              aria-label="close"
              sx={{ color: "text.secondary" }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box sx={{ flex: 1, overflowY: "auto", px: 2.5, py: 2 }}>
            {titleProperty ? (
              <Box sx={{ mb: 2.5 }}>
                <Box
                  sx={{
                    // The title sits inside the same tinted field the other values
                    // use, so the first screen of the panel reads as one form
                    // instead of a bare heading floating above a set of boxes.
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
                    "& textarea, & input": {
                      fontSize: "1.125rem",
                      fontWeight: 600,
                    },
                  }}
                >
                  <CellEditor
                    property={titleProperty}
                    value={titleString}
                    text={titleText}
                    row={row}
                    callbacks={callbacks(titleProperty.id)}
                    disabled={readOnly}
                    expanded
                  />
                </Box>
              </Box>
            ) : null}

            <Divider sx={{ mb: 2.5 }} />

            <Stack spacing={2.5}>
              {otherProperties.map((property) => {
                const meta = getPropertyTypeMeta(property.type);
                const text =
                  property.type === "title" || property.type === "text"
                    ? binding.getText(row, property.id)
                    : null;
                return (
                  <Box
                    key={property.id}
                    sx={{
                      display: "flex",
                      // Label above value, at every width.
                      //
                      // This used to be a 150px label beside the value on `sm` and up.
                      // Two reasons it is stacked everywhere now: the panel is 480px
                      // wide, so a label column ate a third of it and left the editors
                      // cramped while the label itself sat mostly empty; and a value
                      // column that begins at a different x for every row makes the
                      // records harder to scan vertically. Stacked, each field reads as
                      // a heading over its own full-width editor, which is also exactly
                      // what the narrow layout already did — so there is now one panel
                      // shape instead of two that had to be kept in step.
                      flexDirection: "column",
                      gap: 0.75,
                      alignItems: "stretch",
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.75,
                      }}
                    >
                      <meta.Icon sx={{ fontSize: 15, color: meta.color }} />
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{ fontWeight: 500 }}
                      >
                        {property.name}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <CellEditor
                        property={property}
                        value={row.values[property.id]}
                        text={text}
                        row={row}
                        callbacks={callbacks(property.id)}
                        disabled={readOnly}
                        expanded
                      />
                    </Box>
                  </Box>
                );
              })}
            </Stack>

            {otherProperties.length === 0 ? (
              <Typography variant="body2" color="text.disabled" sx={{ mt: 2 }}>
                {i18n("db_add_property")}
              </Typography>
            ) : null}
          </Box>
        </Box>
      ) : null}

      {/*
        The confirmation is owned by the panel rather than raised through a service,
        so it cannot outlive the record it is about. A singleton `ConfirmDialog` would
        keep asking about a row a collaborator deleted, or one this panel has already
        moved on from.
      */}
      <ConfirmDialog
        open={confirmingRowId !== null && confirmingRowId === row?.id}
        title={i18n("db_delete_row")}
        // Names the record: the panel behind the dialog is the only thing saying
        // which one is about to go, and at phone width it is fully covered. An
        // untitled record falls back to the placeholder the views use, so the
        // wording never reads as an empty quote.
        content={Format(i18n("db_confirm_delete_row"), {
          name: rowTitle || i18n("db_record_untitled"),
        })}
        confirmText={i18n("db_delete_row")}
        confirmColor="error"
        onClose={() => setConfirmingRowId(null)}
        onConfirm={() => {
          setConfirmingRowId(null);
          // Re-read rather than closing over the row: a remote deletion between
          // opening the dialog and confirming must be a no-op, not a crash.
          if (!row) return;
          binding.deleteRow(row.id);
          onChanged?.();
          onClose();
        }}
      />
    </Drawer>
  );
};
