/**
 * Local-time calendar strings.
 *
 * A stored date value is an **instant** (a UTC ISO string), but a user works in
 * **local** calendar days. Converting between the two is where a whole class of
 * off-by-one-day bugs lives, so the conversion happens in exactly one place and in
 * exactly one direction: from the `Date`'s local components, never by slicing an
 * ISO string.
 *
 * This module is pure and has no imports, so it is testable in the node test
 * environment — the app's `utils.ts` pulls in the router and browser globals and
 * cannot be.
 *
 * ## The bug this exists to prevent
 *
 * `DatePickerDialog` used to read the day with `toISOString().slice(0, 10)`
 * (**UTC**) while reading the time with `toTimeString()` (**local**), then write
 * back with `new Date("YYYY-MM-DDTHH:mm")` (**local**). At UTC+8 a value stored for
 * local `2026-03-15 00:00` reopened as `2026-03-14`, and confirming it unchanged
 * moved the record back a day. Mixing timezone conventions inside one round trip is
 * the failure mode; having one function per direction makes it unrepresentable.
 */

const pad2 = (value: number): string => String(value).padStart(2, "0");

/**
 * `YYYY-MM-DD` for a `Date`, read in **local** time.
 *
 * The inverse of `new Date("YYYY-MM-DDT00:00")` (a local parse), and deliberately
 * **not** the inverse of `toISOString().slice(0, 10)` (a UTC read).
 */
export function localDateString(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad2(
    date.getMonth() + 1,
  )}-${pad2(date.getDate())}`;
}

/** `HH:mm` for a `Date`, read in **local** time. */
export function localTimeString(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * A `Date` from local date and time strings.
 *
 * `new Date("2026-03-15T23:59")` already parses as local time, but it is built by
 * string concatenation and depends on the caller having produced both parts the
 * same way. Constructing from numbers removes the string round trip entirely, so
 * the result cannot depend on how the parts were formatted.
 */
export function localDateTime(date: string, time?: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  let hours = 0;
  let minutes = 0;

  if (time && time.trim()) {
    const timeMatch = /^(\d{1,2}):(\d{2})/.exec(time.trim());
    if (!timeMatch) return null;
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2]);
  }

  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    hours,
    minutes,
  );
  if (Number.isNaN(parsed.getTime())) return null;

  // Reject a day the calendar does not have (`2026-02-31`), which `Date` would
  // silently roll forward into March.
  if (localDateString(parsed) !== date) return null;

  return parsed;
}
