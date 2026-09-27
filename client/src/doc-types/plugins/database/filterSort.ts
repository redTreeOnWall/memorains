import * as Y from "yjs";
import type {
  DateValue,
  OptionDef,
  PropertyDef,
  PropType,
  RowData,
} from "./types";
import { isOptionPropType } from "./types";

/**
 * Filtering, sorting and grouping — pure functions over rows.
 *
 * Kept free of React and of the CRDT binding so the rules can be tested
 * exhaustively: this is where silent wrongness hides (a filter that quietly
 * matches everything, or a sort that loses rows). The views call these and render
 * whatever comes back.
 *
 * ## The value shape trap
 *
 * `DatabaseBinding.getRows()` returns a **`Y.Text` object** in `values[propId]` for
 * `title` and `text` columns, not a string — the binding hands back the live
 * document object so the editor can splice into it. Comparing that to a search
 * string would never match, so `normalizeCell` converts first and everything below
 * works on plain values.
 */

/** Operators a filter condition may use. */
export type FilterOperator =
  | "contains"
  | "does_not_contain"
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "is_before"
  | "is_after"
  | "is_on_or_before"
  | "is_on_or_after";

export interface FilterCondition {
  kind: "condition";
  propId: string;
  operator: FilterOperator;
  /** Unused for `is_empty` / `is_not_empty`. */
  value?: unknown;
}

export interface FilterGroup {
  kind: "group";
  op: "and" | "or";
  children: FilterNode[];
}

export type FilterNode = FilterGroup | FilterCondition;

export interface SortRule {
  propId: string;
  direction: "asc" | "desc";
}

/**
 * Nesting limit for filter groups.
 *
 * Bounded because the UI has to render it and the evaluator recurses: an unbounded
 * tree can be built by a misbehaving client and would be walked on every render.
 */
export const MAX_FILTER_DEPTH = 3;

/** A plain value, after `Y.Text` and option sets have been flattened. */
export type CellValue = string | number | boolean | string[] | DateValue | null;

/** Operators offered for each property type, in the order the UI shows them. */
export const OPERATORS_BY_TYPE: Record<PropType, readonly FilterOperator[]> = {
  title: [
    "contains",
    "does_not_contain",
    "is",
    "is_not",
    "is_empty",
    "is_not_empty",
  ],
  text: [
    "contains",
    "does_not_contain",
    "is",
    "is_not",
    "is_empty",
    "is_not_empty",
  ],
  url: [
    "contains",
    "does_not_contain",
    "is",
    "is_not",
    "is_empty",
    "is_not_empty",
  ],
  email: [
    "contains",
    "does_not_contain",
    "is",
    "is_not",
    "is_empty",
    "is_not_empty",
  ],
  phone: [
    "contains",
    "does_not_contain",
    "is",
    "is_not",
    "is_empty",
    "is_not_empty",
  ],
  number: ["eq", "neq", "gt", "lt", "gte", "lte", "is_empty", "is_not_empty"],
  // A checkbox is tri-state: true, false, or unset. "Unset" is a real state worth
  // filtering by, since an untouched box is deliberately not the same as false.
  checkbox: ["is", "is_empty", "is_not_empty"],
  select: ["is", "is_not", "is_empty", "is_not_empty"],
  "multi-select": ["contains", "does_not_contain", "is_empty", "is_not_empty"],
  date: [
    "is",
    "is_before",
    "is_after",
    "is_on_or_before",
    "is_on_or_after",
    "is_empty",
    "is_not_empty",
  ],
};

/** Default operator when a condition is first added for a type. */
export const defaultOperatorFor = (type: PropType): FilterOperator =>
  OPERATORS_BY_TYPE[type][0];

/** Operators that need no value, so the UI can hide the input. */
export const operatorNeedsValue = (operator: FilterOperator): boolean =>
  operator !== "is_empty" && operator !== "is_not_empty";

// ------------------------------------------------------------------ values

/**
 * Convert a stored cell value into a plain comparable value.
 *
 * Handles the `Y.Text` case described above, and treats an absent key and an empty
 * string alike, so "empty" means the same thing to a filter as it does to a reader.
 */
export function normalizeCell(value: unknown): CellValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Y.Text) {
    const text = value.toString();
    return text === "" ? null : text;
  }
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length ? (value as string[]) : null;
  if (value instanceof Y.Map) {
    // Defensive: multi-select used to be stored as a nested map.
    const keys = Array.from(value.keys());
    return keys.length ? keys : null;
  }
  if (typeof value === "object") {
    const date = value as DateValue;
    return date.start ? date : null;
  }
  return null;
}

/** Is this cell value empty, by the same rules the filters use? */
export function isEmptyCell(value: CellValue): boolean {
  if (value === null) return true;
  if (typeof value === "string") return value === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Read one cell of a row in plain form. */
export function readCell(row: RowData, propId: string): CellValue {
  return normalizeCell(row.values[propId]);
}

/** Text form of a cell, for substring matching and display. */
export function cellToText(value: CellValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.join(", ");
  return value.start ?? "";
}

/** Timestamp of a date cell, or null. */
function cellToTime(value: CellValue): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const parsed = Date.parse(value.start);
  return Number.isNaN(parsed) ? null : parsed;
}

// ----------------------------------------------------------------- filtering

/**
 * Evaluate one condition against a row.
 *
 * A condition referencing a **deleted property** returns `true` (it does not hide
 * the row). The alternative — treating a dangling reference as "no match" — would
 * silently hide every row after a column was deleted, which looks like data loss.
 */
export function matchesCondition(
  row: RowData,
  condition: FilterCondition,
  property: PropertyDef | undefined,
): boolean {
  if (!property || property.id !== condition.propId) return true;

  const value = readCell(row, condition.propId);
  const operator = condition.operator;

  if (operator === "is_empty") return isEmptyCell(value);
  if (operator === "is_not_empty") return !isEmptyCell(value);

  // An *incomplete* condition is ignored rather than applied: while the user is
  // still typing into the filter's value box the view must keep showing rows, not
  // blank out. This is checked before emptiness so `contains ""` is a no-op even
  // for empty cells — otherwise a half-typed filter would hide exactly the rows it
  // is supposed to be searching.
  if (
    (operator === "contains" || operator === "does_not_contain") &&
    !cellToText(normalizeCell(condition.value)).trim()
  ) {
    return true;
  }

  // An empty cell never matches a value comparison, whatever the operator: a blank
  // is not "less than 5", and it is not equal to "".
  if (isEmptyCell(value)) return false;

  const { type } = property;

  if (operator === "contains" || operator === "does_not_contain") {
    const needle = cellToText(normalizeCell(condition.value))
      .trim()
      .toLowerCase();

    if (type === "multi-select") {
      // Option ids are stored; compare against the option *names*, which is what
      // the user picked in the filter UI.
      const names = (Array.isArray(value) ? value : []).map(
        (optId) =>
          property.options
            .find((option) => option.id === optId)
            ?.name.toLowerCase() ?? "",
      );
      const hit = names.some((name) => name.includes(needle));
      return operator === "contains" ? hit : !hit;
    }

    const hit = cellToText(value).toLowerCase().includes(needle);
    return operator === "contains" ? hit : !hit;
  }

  if (operator === "is" || operator === "is_not") {
    const hit = equalsCell(value, condition.value, property);
    return operator === "is" ? hit : !hit;
  }

  if (type === "number") {
    const actual =
      typeof value === "number" ? value : Number(cellToText(value));
    const expected = Number(normalizeCell(condition.value));
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
    switch (operator) {
      case "eq":
        return actual === expected;
      case "neq":
        return actual !== expected;
      case "gt":
        return actual > expected;
      case "lt":
        return actual < expected;
      case "gte":
        return actual >= expected;
      case "lte":
        return actual <= expected;
      default:
        return true;
    }
  }

  if (type === "date") {
    const actual = cellToTime(value);
    const expected = cellToTime(normalizeCell(condition.value));
    if (actual === null || expected === null) return false;
    // `is` is handled by the equality branch above; these are the range operators.
    switch (operator) {
      case "is_before":
        return actual < expected;
      case "is_after":
        return actual > expected;
      case "is_on_or_before":
        return actual <= expected;
      case "is_on_or_after":
        return actual >= expected;
      default:
        return true;
    }
  }

  // An operator the type does not support: keep the row rather than hide it.
  return true;
}

/** Equality for `is` / `is_not`, which differs by type. */
function equalsCell(
  value: CellValue,
  expected: unknown,
  property: PropertyDef,
): boolean {
  const target = normalizeCell(expected);

  if (property.type === "checkbox") {
    const want =
      typeof target === "boolean"
        ? target
        : String(target).toLowerCase() === "true";
    return value === want;
  }

  if (property.type === "date") {
    const a = cellToTime(value);
    const b = cellToTime(target);
    return a !== null && a === b;
  }

  // `select` stores an option id; the UI supplies one. Fall back to a name match so
  // a condition written against a name still works.
  if (property.type === "select") {
    if (value === target) return true;
    const wanted = cellToText(target).toLowerCase();
    const name = property.options
      .find((option) => option.id === value)
      ?.name.toLowerCase();
    return name !== undefined && name === wanted;
  }

  if (property.type === "multi-select") {
    const ids = Array.isArray(value) ? value : [];
    if (ids.includes(cellToText(target))) return true;
    const wanted = cellToText(target).toLowerCase();
    return ids.some(
      (optId) =>
        property.options
          .find((option) => option.id === optId)
          ?.name.toLowerCase() === wanted,
    );
  }

  return cellToText(value).toLowerCase() === cellToText(target).toLowerCase();
}

/**
 * Evaluate a whole filter tree against a row.
 *
 * An empty group is `true`, so a half-built filter does not hide everything while
 * the user is still adding conditions.
 */
export function matchesFilter(
  row: RowData,
  filter: FilterNode | undefined,
  properties: readonly PropertyDef[],
  depth = 0,
): boolean {
  if (!filter) return true;

  // Stop descending rather than recursing without bound.
  if (depth > MAX_FILTER_DEPTH) return true;

  if (filter.kind === "condition") {
    const property = properties.find(
      (candidate) => candidate.id === filter.propId,
    );
    return matchesCondition(row, filter, property);
  }

  if (filter.children.length === 0) return true;

  if (filter.op === "and") {
    return filter.children.every((child) =>
      matchesFilter(row, child, properties, depth + 1),
    );
  }
  return filter.children.some((child) =>
    matchesFilter(row, child, properties, depth + 1),
  );
}

/** Apply a filter to rows. */
export function applyFilter(
  rows: readonly RowData[],
  filter: FilterNode | undefined,
  properties: readonly PropertyDef[],
): RowData[] {
  if (!filter) return [...rows];
  return rows.filter((row) => matchesFilter(row, filter, properties));
}

// ------------------------------------------------------------------- sorting

/**
 * Compare two rows by one rule.
 *
 * **Empty values always sort last**, regardless of direction. Sorting them first in
 * ascending order would bury the rows that have data under the ones that do not,
 * which is the opposite of useful.
 */
export function compareByRule(
  a: RowData,
  b: RowData,
  rule: SortRule,
  property: PropertyDef | undefined,
): number {
  if (!property) return 0;

  const left = readCell(a, rule.propId);
  const right = readCell(b, rule.propId);
  const leftEmpty = isEmptyCell(left);
  const rightEmpty = isEmptyCell(right);

  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  const base = compareValues(left, right, property);
  return rule.direction === "desc" ? -base : base;
}

/** Type-aware comparison of two non-empty values. */
function compareValues(
  left: CellValue,
  right: CellValue,
  property: PropertyDef,
): number {
  switch (property.type) {
    case "number": {
      const a = typeof left === "number" ? left : Number(cellToText(left));
      const b = typeof right === "number" ? right : Number(cellToText(right));
      return a === b ? 0 : a < b ? -1 : 1;
    }
    case "checkbox": {
      const a = left === true ? 1 : 0;
      const b = right === true ? 1 : 0;
      return a - b;
    }
    case "date": {
      const a = cellToTime(left) ?? 0;
      const b = cellToTime(right) ?? 0;
      return a === b ? 0 : a < b ? -1 : 1;
    }
    case "select": {
      // Sort by the option's own order, which is the order the user arranged the
      // options in — not alphabetical, which would be arbitrary here.
      const index = (value: CellValue) =>
        property.options.findIndex((option) => option.id === value);
      const a = index(left);
      const b = index(right);
      if (a === -1 && b === -1) return 0;
      if (a === -1) return 1;
      if (b === -1) return -1;
      return a - b;
    }
    case "multi-select": {
      const a = Array.isArray(left) ? left.length : 0;
      const b = Array.isArray(right) ? right.length : 0;
      return a - b;
    }
    default:
      return cellToText(left).localeCompare(cellToText(right));
  }
}

/**
 * Apply sorts in order.
 *
 * The result is **always** ordered by the row's own `order` key when no sort rule
 * resolves, so the function's contract does not depend on the caller having
 * pre-sorted anything. `getRows()` does return rows in that order already, but a
 * pipeline stage that only works on sorted input is easy to misuse.
 */
export function applySort(
  rows: readonly RowData[],
  sorts: readonly SortRule[],
  properties: readonly PropertyDef[],
): RowData[] {
  const byOrderKey = (a: RowData, b: RowData) =>
    a.order < b.order ? -1 : a.order > b.order ? 1 : 0;

  const result = [...rows];
  if (sorts.length === 0) return result.sort(byOrderKey);

  const resolved = sorts.map((rule) => ({
    rule,
    property: properties.find((candidate) => candidate.id === rule.propId),
  }));

  return result.sort((a, b) => {
    for (const { rule, property } of resolved) {
      const compared = compareByRule(a, b, rule, property);
      if (compared !== 0) return compared;
    }
    return byOrderKey(a, b);
  });
}

// ------------------------------------------------------------------ grouping

export interface RowGroup {
  /** Option id, or `null` for the ungrouped bucket. */
  key: string | null;
  /** Option name, or a placeholder key for the ungrouped bucket. */
  label: string;
  /** Accent colour name, when the key is an option. */
  color?: string;
  rows: RowData[];
}

/**
 * Group rows by a select-family property.
 *
 * Groups follow the option order rather than the order rows happen to be in, so
 * a board's columns stay put as cards move between them. Rows whose value is unset
 * land in a trailing `null` bucket instead of vanishing.
 */
export function applyGroup(
  rows: readonly RowData[],
  groupByPropId: string | undefined,
  properties: readonly PropertyDef[],
  options: { hideEmpty?: boolean; includeUngrouped?: boolean } = {},
): RowGroup[] {
  const property = properties.find(
    (candidate) => candidate.id === groupByPropId,
  );
  const { hideEmpty = false, includeUngrouped = true } = options;

  if (!property || !isOptionPropType(property.type)) return [];

  const buckets: RowGroup[] = property.options.map((option: OptionDef) => ({
    key: option.id,
    label: option.name,
    color: option.color,
    rows: [],
  }));

  const ungrouped: RowGroup = { key: null, label: "", rows: [] };

  for (const row of rows) {
    const value = readCell(row, property.id);

    if (property.type === "multi-select") {
      // A row appears in every option it carries, which mirrors how Notion's board
      // shows a multi-select card in each matching column.
      const ids = Array.isArray(value) ? value : [];
      let placed = false;
      for (const optId of ids) {
        const bucket = buckets.find((candidate) => candidate.key === optId);
        if (bucket) {
          bucket.rows.push(row);
          placed = true;
        }
      }
      if (!placed) ungrouped.rows.push(row);
      continue;
    }

    const bucket = buckets.find((candidate) => candidate.key === value);
    if (bucket) bucket.rows.push(row);
    else ungrouped.rows.push(row);
  }

  const visible = hideEmpty
    ? buckets.filter((bucket) => bucket.rows.length > 0)
    : buckets;
  if (includeUngrouped) return [...visible, ungrouped];
  return visible;
}

/** The whole pipeline: filter, then sort. */
export function selectRows(
  rows: readonly RowData[],
  filter: FilterNode | undefined,
  sorts: readonly SortRule[],
  properties: readonly PropertyDef[],
): RowData[] {
  return applySort(applyFilter(rows, filter, properties), sorts, properties);
}
