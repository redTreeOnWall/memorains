import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DriveFileRenameOutlineRoundedIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import SwapHorizRoundedIcon from "@mui/icons-material/SwapHorizRounded";
import { i18n } from "../../../internationnalization/utils";
import Format from "string-format";
import { GlobalSnackBar } from "../../../components/common/GlobalSnackBar";
import { CellEditor, type CellEditorCallbacks } from "./CellEditor";
import { CellDisplay } from "./cells";
import { CREATABLE_PROPERTY_TYPES, getPropertyTypeMeta } from "./propertyTypes";
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

/** Click-to-edit cell: shows the rendered value until focused, then the editor. */
const EditableCell: React.FC<{
  property: PropertyDef;
  row: RowData;
  binding: DatabaseBinding;
  readOnly: boolean;
  callbacks: CellEditorCallbacks;
  onOpenRecord: () => void;
  /**
   * Whether this cell hosts the "open record" affordance.
   *
   * Exactly one cell per row carries it (the title column) so it reads as a row
   * handle. Gating it on the cell's *type* or on whether it holds text would make
   * the panel unreachable for an empty row — which is precisely when a user most
   * wants to open it and fill the record in.
   */
  isRowHandle?: boolean;
}> = ({
  property,
  row,
  binding,
  readOnly,
  callbacks,
  onOpenRecord,
  isRowHandle,
}) => {
  const [editing, setEditing] = useState(false);
  const value = row.values[property.id];
  const text = binding.getText(row, property.id);

  // Direct-edit types need no separate display state: one click is the edit.
  const isDirectEdit =
    property.type === "checkbox" ||
    property.type === "select" ||
    property.type === "multi-select" ||
    property.type === "status" ||
    property.type === "date";

  const showEditor = editing || isDirectEdit;

  // Close the inline editor when the row changes underneath (e.g. it was deleted).
  useEffect(() => {
    setEditing(false);
  }, [row.id]);

  if (readOnly) {
    return (
      <Box
        sx={{
          px: 1,
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
        "&:hover .cell-expand": { opacity: 1 },
      }}
      onDoubleClick={onOpenRecord}
    >
      {isRowHandle && !readOnly ? (
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
            onDoneEditing={() => setEditing(false)}
          />
        </Box>
      ) : (
        <Box
          onClick={() => setEditing(true)}
          sx={{
            flex: 1,
            minWidth: 0,
            px: 1,
            py: 0.5,
            minHeight: 32,
            display: "flex",
            alignItems: "center",
            cursor: "text",
            borderRadius: 1,
            "&:hover": { backgroundColor: "action.hover" },
          }}
        >
          {value === undefined || value === "" ? (
            <Typography variant="body2" color="text.disabled" />
          ) : (
            <CellDisplay property={property} value={value} />
          )}
        </Box>
      )}
    </Box>
  );
};

export const TableView: React.FC<{
  binding: DatabaseBinding;
  readOnly?: boolean;
  /** Bump to force a re-read after an external change. */
  revision: number;
  onOpenRecord: (rowId: string) => void;
}> = ({ binding, readOnly, revision, onOpenRecord }) => {
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
  const [deleting, setDeleting] = useState<PropertyDef | null>(null);

  const properties = useMemo(
    () => binding.getProperties(),
    // `revision` forces recomputation after a document change.
    [binding, revision],
  );
  const rows = useMemo(() => binding.getRows(), [binding, revision]);
  const callbacksFor = useCallback(
    (property: PropertyDef, row: RowData): CellEditorCallbacks => ({
      onChange: (value) => binding.setValue(row.id, property.id, value),
      onTextChange: (next) => binding.setText(row.id, property.id, next),
      onToggleOption: (optId) =>
        binding.toggleMultiSelect(row.id, property.id, optId),
      onCreateOption:
        property.type === "multi-select" ||
        property.type === "select" ||
        property.type === "status"
          ? (name) => binding.addOption(property.id, name)
          : undefined,
    }),
    [binding],
  );

  // ---- retype preview: only shown when a conversion would lose data ----
  const retypePreview = useMemo(() => {
    if (!retyping) return null;
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

  const commitRename = () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (name && name !== renaming.name)
      binding.renameProperty(renaming.id, name);
    setRenaming(null);
  };

  return (
    <Box>
      <TableContainer sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ tableLayout: "fixed", minWidth: 480 }}>
          <TableHead>
            <TableRow>
              {properties.map((property) => {
                const meta = getPropertyTypeMeta(property.type);
                return (
                  <TableCell
                    key={property.id}
                    sx={{
                      fontWeight: 600,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      py: 0.75,
                      width: 220,
                    }}
                  >
                    <Box
                      sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                    >
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
                        >
                          <MoreVertRoundedIcon fontSize="inherit" />
                        </IconButton>
                      ) : null}
                    </Box>
                  </TableCell>
                );
              })}
              {!readOnly ? (
                <TableCell
                  sx={{
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    width: 160,
                  }}
                >
                  <Button
                    size="small"
                    startIcon={<AddRoundedIcon />}
                    onClick={(event) => setAddMenuAnchor(event.currentTarget)}
                  >
                    {i18n("db_add_property")}
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} hover>
                {properties.map((property, propertyIndex) => (
                  <TableCell
                    key={property.id}
                    sx={{
                      p: 0,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                      verticalAlign: "middle",
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
                    />
                  </TableCell>
                ))}
                {!readOnly ? (
                  <TableCell
                    sx={{ borderBottom: "1px solid", borderColor: "divider" }}
                  >
                    <Tooltip title={i18n("db_delete_row")}>
                      <IconButton
                        size="small"
                        onClick={() => binding.deleteRow(row.id)}
                        aria-label={i18n("db_delete_row")}
                      >
                        <DeleteOutlineRoundedIcon fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {rows.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
          <Typography variant="body2">{i18n("db_no_rows")}</Typography>
          <Typography variant="caption">{i18n("db_no_rows_hint")}</Typography>
        </Box>
      ) : null}

      {!readOnly ? (
        <Box sx={{ mt: 1 }}>
          <Button
            size="small"
            startIcon={<AddRoundedIcon />}
            onClick={() => binding.addRow()}
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
              if (propertyMenu) setDeleting(propertyMenu.property);
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

      {/* ---- delete ---- */}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{i18n("db_delete_property")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {Format(i18n("db_confirm_delete_property"), {
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
              if (deleting) binding.deleteProperty(deleting.id);
              setDeleting(null);
            }}
          >
            {i18n("db_delete_property")}
          </Button>
        </DialogActions>
      </Dialog>

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
