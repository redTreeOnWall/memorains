import type { DateValue, PropertyDef, RowData } from "./types";

/**
 * Day arithmetic for the journal view.
 *
 * Pure and free of React, Yjs and the app's locale state, so the rules that decide
 * **which day a record belongs to** can be tested exhaustively — including in a
 * non-UTC timezone, which is the only way the bug this module exists to prevent is
 * visible at all.
 *
 * ## The one rule
 *
 * A record belongs to the day its date value falls on **in the reader's local
 * calendar**. Everything here derives a day key from local calendar components
 * (`getFullYear` / `getMonth` / `getDate`), never by slicing an ISO timestamp: a
 * UTC instant is a different day for most of the world, so slicing would place a
 * record one cell away from the date the same record displays.
 *
 * ## Two stored shapes, one meaning
 *
 * A `date` value's `start` is a string, and both of these are reachable:
 *
 * - an **instant** (`"2026-03-15T15:59:00.000Z"`), which is what the date picker
 *   writes, and
 * - a **calendar date** (`"2026-03-15"`), which is what retyping text into a date
 *   column produces.
 *
 * They must not be read the same way. `new Date("2026-03-15")` is parsed as *UTC*
 * midnight, so converting it to local components gives the previous day west of
 * Greenwich — a date the user typed would land one cell early. A bare `YYYY-MM-DD`
 * is therefore taken literally, with no timezone conversion at all; only a string
 * carrying a time is treated as an instant.
 */

/** `YYYY-MM-DD` key identifying one local calendar day. */
export type DayKey = string;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Day key from explicit local calendar parts. */
export function dayKeyFromParts(
  year: number,
  month: number,
  day: number,
): DayKey {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Day key of a `Date`, read in **local** time. */
export function dayKeyFromDate(date: Date): DayKey {
  return dayKeyFromParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
}

/**
 * The day a stored cell value falls on, or `null` when it holds no usable date.
 *
 * Accepts either a `DateValue` (what rows store) or a bare string, so callers do
 * not have to know which they have. Returns `null` rather than a fallback day for
 * an absent or unparseable value — a record with no date does not belong to today,
 * and inventing one would put it in a cell the user never chose.
 */
export function dayKeyOf(value: unknown): DayKey | null {
  let start: string;
  if (typeof value === "string") {
    start = value;
  } else if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as DateValue).start === "string"
  ) {
    start = (value as DateValue).start;
  } else {
    return null;
  }

  if (!start) return null;

  // A bare calendar date is already a day key. Converting it through `Date` would
  // reinterpret it as UTC midnight and shift it west of Greenwich.
  if (DATE_ONLY.test(start)) return start;

  const parsed = new Date(start);
  if (Number.isNaN(parsed.getTime())) return null;
  return dayKeyFromDate(parsed);
}

/** Local midnight of a day key. Tolerates a malformed key by returning `null`. */
export function dateFromDayKey(key: DayKey): Date | null {
  const match = DATE_ONLY.exec(key);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  // Reject a key like "2026-02-31", which `Date` would silently roll forward.
  return dayKeyFromDate(date) === key ? date : null;
}

/** Local midnight of `date`, as a new `Date`. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `date` shifted by whole days, staying at local midnight. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKeyFromDate(a) === dayKeyFromDate(b);
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Local midnight on the first day of the week containing `date`. */
export function startOfWeek(date: Date, weekStartsOn: number): Date {
  const offset = (date.getDay() - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

/**
 * First day of the week for a locale.
 *
 * Simplified to the two conventions the app ships languages for: Monday for
 * Chinese, Sunday for English. A lookup table of every region's convention would be
 * more correct and is not worth the maintenance for two locales.
 */
export function weekStartsOnFor(language: string): number {
  return language.startsWith("zh") ? 1 : 0;
}

/** The seven days of the week containing `anchor`. */
export function weekDays(anchor: Date, weekStartsOn: number): Date[] {
  const first = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

/**
 * Every day shown by a month grid, including the leading and trailing days that
 * belong to the neighbouring months.
 *
 * Whole weeks only, so the grid is always a rectangle — a fixed 6-row grid would
 * reserve a blank row for most months, and a ragged last row looks broken.
 */
export function monthGridDays(
  year: number,
  month: number,
  weekStartsOn: number,
): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const start = addDays(first, -offset);
  return Array.from({ length: weeks * 7 }, (_, index) => addDays(start, index));
}

/**
 * The stored date value for a calendar day.
 *
 * **Local noon**, not midnight. The stored shape is an instant, so it has to name
 * one, and noon is the hour least likely to be pushed into a neighbouring day:
 * midnight is exactly where a timezone offset or a daylight-saving shift moves the
 * calendar date, while noon has twelve hours of slack in either direction.
 *
 * The time is not meaningful and `includeTime` stays unset, so nothing claims
 * otherwise. A bare `"YYYY-MM-DD"` would also work and is what `dayKeyOf` prefers,
 * but the picker's `initDate` goes through `Date.parse`, which reads a bare date as
 * UTC — so writing an instant keeps every existing date code path consistent.
 */
export function dateValueForDay(day: Date): DateValue {
  const noon = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    12,
    0,
    0,
    0,
  );
  return { start: noon.toISOString() };
}

/**
 * Bucket rows by the day their date column falls on.
 *
 * Built once per render: a lookup per cell is O(1), where filtering inside each cell
 * would be O(days × rows) — survivable for a 42-cell month and not for a 365-cell
 * year.
 *
 * Rows that share a day keep the order they arrived in, which is the view's own
 * order (`getViewRows`), so the record shown in a cell is the one the view's sorts
 * put first rather than whichever happened to be inserted first.
 */
export function buildDayIndex(
  rows: readonly RowData[],
  propId: string,
): Map<DayKey, RowData[]> {
  const index = new Map<DayKey, RowData[]>();
  for (const row of rows) {
    const key = dayKeyOf(row.values[propId]);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(row);
    else index.set(key, [row]);
  }
  return index;
}

/** How many options of a checklist column a row has ticked. */
export function checkedCount(row: RowData, propId: string): number {
  const value = row.values[propId];
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string").length
    : 0;
}

/**
 * Completion colour step for a ring or density square.
 *
 * Returns a ratio rather than a colour so the choice of palette stays in the view
 * layer with the theme. `null` means "nothing to measure" — a checklist with no
 * options, where `0/0` would be a bug rather than "incomplete".
 */
export function completionRatio(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.max(0, Math.min(1, done / total));
}

/** The first `date` property in the user's own column order. */
export function defaultCalendarProperty(
  properties: readonly PropertyDef[],
): string | undefined {
  return properties.find((property) => property.type === "date")?.id;
}

/**
 * Order the properties a journal cell may show, with the calendar column **last**.
 *
 * Not excluded, because `visibleProps` is the only authority on what a view shows —
 * a user who turned the date column on has asked to see it. But a cell has room for
 * only a couple of values and the list is **truncated**, so the calendar column is
 * the one value the cell already states: it is the axis a record was placed on. Left
 * in place it can occupy a slot that a real field (`Status`, `Notes`) would have
 * used, which is a redundant value displacing an informative one.
 *
 * Ranking rather than dropping is what makes it behave sensibly in both cases: a
 * day whose record has nothing else to show still displays its date, and a day with
 * other fields spends its slots on those.
 *
 * The day order is otherwise untouched, so this is a single stable move.
 */
export function rankJournalDetails(
  properties: readonly PropertyDef[],
  calendarPropId: string | undefined,
): PropertyDef[] {
  if (!calendarPropId) return [...properties];
  if (!properties.some((property) => property.id === calendarPropId)) {
    return [...properties];
  }
  return [
    ...properties.filter((property) => property.id !== calendarPropId),
    ...properties.filter((property) => property.id === calendarPropId),
  ];
}

/** Month index (0–11) to a localised name, e.g. "March" / "三月". */
export function monthName(
  month: number,
  language: string,
  style: "long" | "short" = "long",
): string {
  return new Intl.DateTimeFormat(language, { month: style }).format(
    new Date(2024, month, 1),
  );
}

/**
 * Weekday names in display order.
 *
 * Derived from a known week rather than stored, so a new language needs no key set
 * and cannot drift out of sync with the grid's actual column order.
 */
export function weekdayNames(
  weekStartsOn: number,
  language: string,
  style: "long" | "short" | "narrow" = "short",
): string[] {
  const formatter = new Intl.DateTimeFormat(language, { weekday: style });
  // 2024-01-07 is a Sunday; January 7th 2024 is index 0 for the loop below.
  const sunday = new Date(2024, 0, 7);
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(addDays(sunday, (weekStartsOn + index) % 7)),
  );
}

/** A localised "March 2026" / "2026年3月" style label for a period. */
export function periodLabel(
  anchor: Date,
  scale: "week" | "month" | "year",
  language: string,
  weekStartsOn: number,
): string {
  if (scale === "year") {
    return new Intl.DateTimeFormat(language, { year: "numeric" }).format(
      anchor,
    );
  }
  if (scale === "month") {
    return new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "long",
    }).format(anchor);
  }
  const days = weekDays(anchor, weekStartsOn);
  const first = days[0];
  const last = days[6];
  const firstLabel = new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
  }).format(first);
  const lastLabel = new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(last);
  return `${firstLabel} – ${lastLabel}`;
}

/** Step the anchor by one period, in the direction of `delta`. */
export function shiftPeriod(
  anchor: Date,
  scale: "week" | "month" | "year",
  delta: number,
): Date {
  if (scale === "week") return addDays(anchor, delta * 7);
  if (scale === "month") {
    // Anchored on the 1st: stepping from the 31st must not skip a short month.
    return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
  }
  return new Date(anchor.getFullYear() + delta, anchor.getMonth(), 1);
}
