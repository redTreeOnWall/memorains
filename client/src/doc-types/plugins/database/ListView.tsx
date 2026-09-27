import React, { useMemo } from "react";
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
import { i18n } from "../../../internationnalization/utils";
import { CellDisplay } from "./cells";
import { optionColorHex } from "./optionColors";
import { getPropertyTypeMeta } from "./propertyTypes";
import type { DatabaseBinding } from "./model";

/**
 * The list view.
 *
 * The minimal layout: one line per record, showing the title plus a few properties,
 * reusing `CellDisplay` so a value renders identically here and in the table. It is
 * also the cheapest view to render, which makes it useful for large databases where
 * a full table is more than the user needs.
 */
export const ListView: React.FC<{
  binding: DatabaseBinding;
  /** The view being rendered: supplies the filter and sorts. */
  viewId: string;
  readOnly?: boolean;
  revision: number;
  onOpenRecord: (rowId: string) => void;
}> = ({ binding, viewId, readOnly, revision, onOpenRecord }) => {
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
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                px: 1,
                py: 1,
                cursor: "pointer",
                borderRadius: 1,
                "&:hover": { backgroundColor: "action.hover" },
              }}
            >
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
                    property.type === "status" ||
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
