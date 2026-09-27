import type { DateValue, OptionDef, PropType } from "./types";
import {
  isOptionPropType,
  isPlainStringPropType,
  isTextPropType,
} from "./types";

/**
 * Value conversion when a property's type changes.
 *
 * Changing a column from `text` to `number` has to reinterpret existing values,
 * and because the schema is shared CRDT state this happens on every client.
 * Keeping the rules here — pure, with no Yjs or React dependency — means they can
 * be tested exhaustively, which matters because the alternative (a `switch`
 * embedded in the binding) is where silent data loss hides.
 *
 * The rules are deliberately conservative: a value that cannot be *sensibly*
 * converted is dropped rather than mangled into something the user did not type.
 */

/**
 * A property value in plain-JS form, independent of how it is stored.
 *
 * `model.ts` converts to and from the Yjs representation; everything below works
 * on these shapes only.
 */
export type PlainValue =
  | string
  | string[] // multi-select: option IDs
  | number
  | boolean
  | DateValue
  | null;

/** Sentinel meaning "this value cannot survive the retype; clear the cell". */
export const DROP = Symbol("drop");

export interface RetypeResult {
  value: PlainValue | typeof DROP;
  /** True when the original value could not be preserved. */
  dropped: boolean;
}

/** What a value looks like with no cell content at all. */
export const isEmptyValue = (value: PlainValue): boolean => {
  if (value === null) return true;
  if (typeof value === "string") return value === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

/**
 * Text for a `date` cell, from its stored value.
 *
 * Separate from `displayValue` because the two want different things: that function
 * returns the **raw** stored value, since CSV and Markdown export need a
 * machine-comparable form. Rendering it in the UI showed a user
 * `2026-12-25T15:59:00.000Z`, which is not a date as far as a reader is concerned.
 *
 * The formatter is injected rather than imported so this stays testable: the app's
 * date formatting lives in `utils.ts`, which pulls in the router and browser globals
 * and so cannot be loaded by a test that has no DOM.
 *
 * A range renders both ends. No UI creates one yet, but the stored shape allows it,
 * so a range written by another client still shows something sensible.
 */
export function dateCellText(
  value: DateValue | null | undefined,
  format: (iso: string) => string,
): string {
  if (!value || typeof value.start !== "string" || value.start === "")
    return "";
  const from = format(value.start);
  return value.end ? `${from} → ${format(value.end)}` : from;
}

/**
 * Human-readable form of a value, used by retype coercion and by read-only
 * rendering (list previews, exported Markdown).
 */
export function displayValue(
  value: PlainValue,
  type: PropType,
  options: readonly OptionDef[] = [],
): string {
  if (value === null) return "";

  if (isOptionPropType(type)) {
    if (Array.isArray(value)) {
      return value
        .map((id) => options.find((opt) => opt.id === id)?.name ?? "")
        .filter(Boolean)
        .join(", ");
    }
    if (typeof value === "string") {
      return options.find((opt) => opt.id === value)?.name ?? "";
    }
    return "";
  }

  if (type === "date") {
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      "start" in value
    ) {
      const date = value as DateValue;
      const start = date.start ?? "";
      if (date.end) return `${start} → ${date.end}`;
      return start;
    }
    return "";
  }

  if (type === "checkbox") {
    return typeof value === "boolean" ? String(value) : "";
  }

  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";
  }

  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/**
 * Convert a value to a different property type.
 *
 * `options` is the *target* property's option list, used when converting into a
 * select-family type: a free-text value is matched against option names, which is
 * the only interpretation that preserves intent. A value matching no option is
 * dropped, because silently keeping an option ID that does not exist would render
 * as an empty cell with a hidden dangling reference.
 */
export function retypeValue(
  value: PlainValue,
  fromType: PropType,
  toType: PropType,
  options: readonly OptionDef[] = [],
): RetypeResult {
  // An empty cell stays empty, whatever the type — no coercion should ever turn
  // "nothing" into something (e.g. "" into the number 0).
  if (isEmptyValue(value)) return { value: DROP, dropped: false };

  if (toType === fromType) return { value, dropped: false };

  const asText = displayValue(value, fromType, options);

  // --- to a text cell (title / text) -------------------------------------
  // Always possible: anything has a readable form.
  if (isTextPropType(toType)) {
    return { value: asText, dropped: false };
  }

  // --- to a plain string cell (url / email / phone) ----------------------
  if (isPlainStringPropType(toType)) {
    return { value: asText, dropped: false };
  }

  // --- to number ---------------------------------------------------------
  if (toType === "number") {
    // Accept a numeric prefix-free string only; "12abc" is not a number the user
    // meant. Whitespace is tolerated because it is invisible in a cell.
    const trimmed = asText.trim();
    if (trimmed === "") return { value: DROP, dropped: true };
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return { value: DROP, dropped: true };
    return { value: parsed, dropped: false };
  }

  // --- to checkbox -------------------------------------------------------
  if (toType === "checkbox") {
    const lowered = asText.trim().toLowerCase();
    if (["true", "1", "yes", "y", "✓"].includes(lowered)) {
      return { value: true, dropped: false };
    }
    if (["false", "0", "no", "n", ""].includes(lowered)) {
      return { value: false, dropped: false };
    }
    // A non-boolean string becomes "checked", since a value existed. Losing that
    // fact would be worse than a coarse interpretation.
    return { value: true, dropped: false };
  }

  // --- to a select-family type ------------------------------------------
  if (isOptionPropType(toType)) {
    // Match by name: option IDs are per-property, so a value coming from text is
    // a name, and a value coming from another select-family type on the same
    // property matches by ID first (which also yields its name).
    //
    // Split comma-separated text when the target holds several options, because
    // that is how `displayValue` renders a multi-select — without splitting, a
    // multi-select -> text -> multi-select round trip would lose everything.
    const rawCandidates: PlainValue[] = Array.isArray(value)
      ? value
      : toType === "multi-select" && typeof value === "string"
        ? value.split(",")
        : [value];

    const matched: string[] = [];
    for (const candidate of rawCandidates) {
      let name: string;
      if (typeof candidate === "string") {
        const byId = options.find((option) => option.id === candidate);
        name = byId ? byId.name : candidate;
      } else {
        name = displayValue(candidate, fromType, options);
      }
      const needle = name.trim().toLowerCase();
      if (!needle) continue;
      const option = options.find(
        (candidate) => candidate.name.trim().toLowerCase() === needle,
      );
      if (option && !matched.includes(option.id)) matched.push(option.id);
    }

    if (matched.length === 0) return { value: DROP, dropped: true };
    if (toType === "multi-select") return { value: matched, dropped: false };
    // select / status hold one option.
    return { value: matched[0], dropped: false };
  }

  // --- to date -----------------------------------------------------------
  if (toType === "date") {
    const parsed = parseDateValue(value, fromType);
    if (!parsed) return { value: DROP, dropped: true };
    return { value: parsed, dropped: false };
  }

  return { value: DROP, dropped: true };
}

/**
 * Interpret a value as a date.
 *
 * Only accepts shapes that are unambiguously a date: an existing date value, or
 * an ISO-8601 string. Deliberately does *not* guess from locale formats like
 * `03/04/2024`, where day and month are indistinguishable.
 */
export function parseDateValue(
  value: PlainValue,
  fromType?: PropType,
): DateValue | null {
  if (value === null) return null;

  if (typeof value === "object" && !Array.isArray(value) && "start" in value) {
    const date = value as DateValue;
    return date.start ? date : null;
  }

  if (typeof value === "number" && fromType === "number") return null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/.test(trimmed)) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;

  return {
    start: trimmed,
    includeTime: trimmed.includes("T") || trimmed.includes(" "),
  };
}

/** Summary of what a retype would do, for the confirmation dialog. */
export interface RetypePreview {
  /** Cells holding a value. */
  total: number;
  /** Cells that will keep a value, possibly converted. */
  preserved: number;
  /** Cells that will be cleared. */
  dropped: number;
}

export function previewRetype(
  values: readonly PlainValue[],
  fromType: PropType,
  toType: PropType,
  options: readonly OptionDef[] = [],
): RetypePreview {
  let total = 0;
  let preserved = 0;
  let dropped = 0;

  for (const value of values) {
    if (isEmptyValue(value)) continue;
    total++;
    const result = retypeValue(value, fromType, toType, options);
    if (result.value === DROP) dropped++;
    else preserved++;
  }

  return { total, preserved, dropped };
}
