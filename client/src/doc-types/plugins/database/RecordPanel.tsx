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
              py: 1.5,
              borderBottom: "1px solid",
              borderColor: "divider",
              flexShrink: 0,
            }}
          >
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ flex: 1 }}
            >
              {i18n("db_record_panel_title")}
            </Typography>
            {!readOnly ? (
              <Tooltip title={i18n("db_delete_row")}>
                <IconButton
                  size="small"
                  onClick={() => setConfirmingRowId(row.id)}
                  aria-label={i18n("db_delete_row")}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            <IconButton size="small" onClick={onClose} aria-label="close">
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 2 }}>
            {titleProperty ? (
              <Box sx={{ mb: 2 }}>
                <CellEditor
                  property={titleProperty}
                  value={titleString}
                  text={titleText}
                  row={row}
                  callbacks={callbacks(titleProperty.id)}
                  disabled={readOnly}
                  expanded
                />
                {!titleString.trim() ? (
                  <Typography variant="caption" color="text.disabled">
                    {i18n("db_record_untitled")}
                  </Typography>
                ) : null}
              </Box>
            ) : null}

            <Divider sx={{ mb: 2 }} />

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
                      // A 150px label beside the value does not fit a phone: at 390px
                      // it leaves ~200px for an editor, which wraps placeholders and
                      // truncates dates. Stacked, the label reads as a heading and the
                      // editor gets the full width.
                      flexDirection: { xs: "column", sm: "row" },
                      gap: { xs: 0.5, sm: 1.5 },
                      alignItems: { xs: "stretch", sm: "flex-start" },
                    }}
                  >
                    <Box
                      sx={{
                        width: { xs: "auto", sm: 150 },
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 0.75,
                        pt: { xs: 0, sm: 1.25 },
                      }}
                    >
                      <meta.Icon sx={{ fontSize: 16, color: meta.color }} />
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {property.name}
                      </Typography>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
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
