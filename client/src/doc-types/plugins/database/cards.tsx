import React from "react";
import { Box, Typography } from "@mui/material";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import { i18n } from "../../../internationnalization/utils";
import { CellDisplay, summarizeValue } from "./cells";
import { getPropertyTypeMeta } from "./propertyTypes";
import type { DatabaseBinding } from "./model";
import type { PropertyDef, RowData } from "./types";

/**
 * Shared card rendering for the board and journal views.
 *
 * Both views show a record as a small card, and they must agree about what a card
 * looks like: the title property, which secondary properties are worth showing, and
 * how each value renders. Keeping the rules here means a value added to one view's
 * cards cannot be missing from the other's, and a fix lands in both.
 */

/** The property a card is titled by. */
export function cardTitleProperty(
  properties: readonly PropertyDef[],
): PropertyDef | undefined {
  return properties.find((property) => property.type === "title");
}

/** Whether a record has no title yet. */
export function cardIsUntitled(
  binding: DatabaseBinding,
  row: RowData,
  titleProperty: PropertyDef | undefined,
): boolean {
  if (!titleProperty) return true;
  const text = binding.getTextString(row, titleProperty.id);
  const raw = row.values[titleProperty.id];
  return !(text || (typeof raw === "string" ? raw : ""));
}

/** A card's title text, or a placeholder for an untitled record. */
export function cardTitle(
  binding: DatabaseBinding,
  row: RowData,
  titleProperty: PropertyDef | undefined,
): string {
  if (!titleProperty) return i18n("db_record_untitled");
  const text = binding.getTextString(row, titleProperty.id);
  const raw = row.values[titleProperty.id];
  return (
    text || (typeof raw === "string" ? raw : "") || i18n("db_record_untitled")
  );
}

/**
 * Up to `limit` secondary properties that actually hold something.
 *
 * Empty values are filtered out rather than rendered blank: a card has room for a
 * handful of lines, and spending one on an empty field pushes out a populated one.
 * Text cells are read through the binding because their value lives in a `Y.Text`
 * the row's plain value does not expose.
 *
 * **Order is the caller's**, and it is load-bearing: the list is truncated, so which
 * property comes last is which one gets dropped. Callers that show a value the cell
 * already implies put it last rather than excluding it — see the journal's calendar
 * property in `JournalView`.
 */
export function cardDetailProperties(
  binding: DatabaseBinding,
  row: RowData,
  properties: readonly PropertyDef[],
  limit = 3,
): PropertyDef[] {
  return properties
    .filter((property) => property.type !== "title")
    .filter((property) => {
      const value = row.values[property.id];
      if (property.type === "text")
        return binding.getTextString(row, property.id) !== "";
      return value !== undefined && value !== null && value !== "";
    })
    .slice(0, limit);
}

/** One icon + value line, as shown on a card. */
export const CardDetailLine: React.FC<{
  property: PropertyDef;
  value: unknown;
  binding: DatabaseBinding;
  row: RowData;
}> = ({ property, value, binding, row }) => {
  const meta = getPropertyTypeMeta(property.type);

  if (property.type === "checkbox") {
    // A 12px glyph rather than the 42px `Checkbox` control: on a card a boolean is a
    // detail line, and a form control's hit box would set the line's height and make
    // every card taller than its contents.
    return (
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}
      >
        <meta.Icon sx={{ fontSize: 12, color: meta.color, flexShrink: 0 }} />
        {value === true ? (
          <CheckRoundedIcon sx={{ fontSize: 14, color: "success.main" }} />
        ) : (
          <Typography
            variant="caption"
            sx={{ color: "text.disabled", lineHeight: 1.3 }}
          >
            —
          </Typography>
        )}
      </Box>
    );
  }

  if (property.type === "select" || property.type === "multi-select") {
    return (
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}
      >
        <meta.Icon sx={{ fontSize: 12, color: meta.color, flexShrink: 0 }} />
        <CellDisplay property={property} value={value} />
      </Box>
    );
  }

  const text =
    property.type === "text"
      ? binding.getTextString(row, property.id)
      : summarizeValue(property, value);

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        minWidth: 0,
      }}
    >
      <meta.Icon sx={{ fontSize: 12, color: meta.color, flexShrink: 0 }} />
      <Typography variant="caption" noWrap sx={{ color: "text.secondary" }}>
        {text}
      </Typography>
    </Box>
  );
};
