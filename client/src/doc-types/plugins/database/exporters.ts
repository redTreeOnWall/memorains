import * as Y from "yjs";
import type { DatabaseBinding } from "./model";
import { displayValue } from "./retype";
import type { DateValue, PropertyDef, RowData } from "./types";

/**
 * Projections of a database into text formats.
 *
 * Both are pure functions of a binding, so they are testable and shareable between
 * the Markdown export (driven by the plugin registry, which derives the menu item
 * from `toMarkdown`) and the CSV export.
 */

/** Escape a cell so it cannot break out of a Markdown table row. */
export function escapeMarkdownCell(value: string): string {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      // A literal newline would end the table row; a break tag keeps it inside.
      .replace(/\r?\n/g, "<br>")
      .trim()
  );
}

/**
 * CSV-quote a field.
 *
 * Quotes when the value contains a comma, quote or newline, and doubles embedded
 * quotes, per RFC 4180. A leading `=`, `+`, `-` or `@` is prefixed with a tab so a
 * spreadsheet treats the value as text rather than a formula — values come from
 * other users, and a formula would execute on open.
 */
export function escapeCsvCell(value: string): string {
  let result = value;
  if (/^[=+\-@\t\r]/.test(result)) {
    result = `\t${result}`;
  }
  if (/[",\r\n]/.test(result)) {
    result = `"${result.replace(/"/g, '""')}"`;
  }
  return result;
}

/** Human-readable text for one cell, independent of the storage shape. */
function cellText(
  property: PropertyDef,
  value: unknown,
  text: Y.Text | null,
): string {
  if (property.type === "title" || property.type === "text") {
    return text?.toString() ?? "";
  }
  if (value === undefined || value === null) return "";
  if (property.type === "checkbox") return value === true ? "true" : "false";
  if (property.type === "date") {
    const date = value as DateValue;
    if (!date.start) return "";
    return date.end ? `${date.start} → ${date.end}` : date.start;
  }
  if (
    property.type === "select" ||
    property.type === "status" ||
    property.type === "multi-select"
  ) {
    // Option names, not ids: the ids are meaningless outside the document.
    return displayValue(
      value as string | string[],
      property.type,
      property.options,
    );
  }
  return displayValue(value as string | number | boolean, property.type);
}

/** One row's values in property order. */
function rowCells(
  binding: DatabaseBinding,
  property: PropertyDef,
  row: RowData,
): string {
  return cellText(
    property,
    row.values[property.id],
    binding.getText(row, property.id),
  );
}

/**
 * The database as a Markdown table.
 *
 * This is the `toMarkdown` the doc-type registry turns into an "Export as
 * Markdown" menu item, so no view needs to know about export.
 */
export function databaseToMarkdownFromBinding(
  binding: DatabaseBinding,
): string {
  const properties = binding.getProperties();
  const rows = binding.getRows();

  if (properties.length === 0) return "";

  const header = `| ${properties.map((property) => escapeMarkdownCell(property.name)).join(" | ")} |`;
  const separator = `| ${properties.map(() => "---").join(" | ")} |`;

  const lines = rows.map(
    (row) =>
      `| ${properties
        .map((property) => escapeMarkdownCell(rowCells(binding, property, row)))
        .join(" | ")} |`,
  );

  return [header, separator, ...lines].join("\n");
}

/** The database as CSV, including a header row. */
export function databaseToCsv(binding: DatabaseBinding): string {
  const properties = binding.getProperties();
  const rows = binding.getRows();

  const lines: string[] = [
    properties.map((property) => escapeCsvCell(property.name)).join(","),
  ];

  for (const row of rows) {
    lines.push(
      properties
        .map((property) => escapeCsvCell(rowCells(binding, property, row)))
        .join(","),
    );
  }

  // A trailing newline keeps the last row terminated, which some tools expect.
  return `${lines.join("\n")}\n`;
}

/**
 * Build a `toMarkdown` for a document's `Y.Doc`.
 *
 * The plugin contract hands us a raw `Y.Doc`, not a binding, so this constructs a
 * temporary one. Writing through it is never done, so the temporary binding cannot
 * mutate the document.
 */
export function makeDatabaseToMarkdown(
  DatabaseBindingCtor: new (
    yDoc: Y.Doc,
    onChange: () => void,
  ) => DatabaseBinding,
): (yDoc: Y.Doc) => string {
  return (yDoc: Y.Doc) => {
    const binding = new DatabaseBindingCtor(yDoc, () => {});
    try {
      return databaseToMarkdownFromBinding(binding);
    } finally {
      binding.destroy();
    }
  };
}
