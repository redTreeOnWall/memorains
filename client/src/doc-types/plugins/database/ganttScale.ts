import {
  dateFromDayKey,
  dayKeyFromDate,
  dayKeyFromParts,
  monthName,
} from "./journalDays";
import type { GanttZoom } from "./types";

/**
 * Day arithmetic and axis geometry for the Gantt view.
 *
 * Pure and free of React, Yjs and app locale state, so the two things that are easy to
 * get silently wrong can be tested exhaustively:
 *
 * - **Day keys are advanced with UTC arithmetic.** A day key is the *local* calendar
 *   day of a record (`dayKeyOf`), but shifting it by `n` days must not go through a
 *   local `Date` plus `n * 86_400_000`: across a daylight-saving boundary that lands an
 *   hour off, and near midnight an entire day off.
 * - **Pixel geometry is derived from one number**, the width of a day, so a bar, the
 *   ruler, the gridlines and a drag cannot disagree about where a day is.
 */

/** Re-exported so the view layer has one import for the zoom vocabulary. */
export type { GanttZoom };

/** Width of one day, per zoom, in CSS pixels. */
const DAY_WIDTH: Record<GanttZoom, number> = {
  week: 28,
  month: 10,
  quarter: 3.2,
};

/** Clamps for the fitted width, so one record cannot make the axis unreadable. */
const MIN_FIT_DAY_WIDTH = 1.5;
const MAX_FIT_DAY_WIDTH = 40;

/** Narrower than this and a ruler stops naming days, only months. */
const WEEK_RULER_MIN_WIDTH = 18;

/** Day key advanced by whole days. */
export function shiftDayKey(key: string, days: number): string {
  if (days === 0) return key;
  const parsed = dateFromDayKey(key);
  if (!parsed) return key;
  const shifted = new Date(
    Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + days),
  );
  return dayKeyFromParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * Whole local calendar days from `from` to `to`, positive when `to` is later.
 *
 * Measured between UTC midnights for the same reason: two local midnights are 23 or
 * 25 hours apart across a DST boundary, and the sign of the rounding then decides
 * whether a one-day bar is drawn as one day or two.
 */
export function daysBetween(from: string, to: string): number {
  const a = dateFromDayKey(from);
  const b = dateFromDayKey(to);
  if (!a || !b) return 0;
  const aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bUtc - aUtc) / 86_400_000);
}

export const todayKey = (now: Date = new Date()): string => dayKeyFromDate(now);

/** Days of empty axis drawn before the first bar and after the last. */
export const LEAD_DAYS = 2;

/** Ceiling on an axis built from data, so one stray date cannot ask for a decade. */
export const MAX_AXIS_DAYS = 2600;

/** The axis a Gantt chart should draw: where it starts, how many days, how wide each is. */
export interface AxisPlan {
  /** First day drawn. */
  anchor: string;
  /** Number of days drawn. */
  dayCount: number;
  /** Pixels per day. */
  dayWidth: number;
}

/**
 * Choose the axis: the day it opens on, how many days it covers, and the width of one.
 *
 * Returning all three together is what keeps them consistent, and it is why a fitted
 * chart has no horizontal scrollbar. In fit mode the day width is derived **from** the
 * day count rather than the day count from the width, so the two cannot disagree by a
 * column — which is what a separate "how many days fit in this width" calculation
 * produced, and it looked like a chart that was one day too wide.
 *
 * Fit is the absence of a zoom rather than a fourth level, so an unzoomed chart keeps
 * fitting as records are added instead of freezing a width chosen when the document was
 * smaller. A manual zoom fixes the width instead and extends the axis as far as it needs
 * to reach the last bar, since a zoomed chart is expected to scroll.
 */
export function planAxis(input: {
  zoom: GanttZoom | undefined;
  /** First day any bar covers, or null when there are none. */
  first: string | null;
  /** Last day any bar covers, or null when there are none. */
  last: string | null;
  /** Width available for the axis itself, the label gutter already removed. */
  usableWidth: number;
  /** Today, for the empty-chart case. Injectable so the plan is testable. */
  today?: string;
}): AxisPlan {
  const { zoom, first, last, usableWidth } = input;
  const today = input.today ?? todayKey();

  const anchor = first
    ? shiftDayKey(first, -LEAD_DAYS)
    : // No dated rows at all: open on the month containing today rather than at the
      // epoch, so an empty chart still shows a usable axis.
      shiftDayKey(today, -(Number(today.slice(8, 10)) - 1));

  if (zoom) {
    const dayWidth = DAY_WIDTH[zoom];
    // Enough to fill the viewport, and enough to reach the last bar — whichever is
    // further, so a zoomed chart never hides a bar whose date the data contains. With
    // nothing scheduled there is no bar to reach, so the viewport decides: an empty
    // chart must still show a usable axis rather than the single day a zero would
    // clamp it to.
    const viewportDays = Math.ceil(usableWidth / dayWidth) + 1;
    const dataDays =
      last === null ? 0 : daysBetween(anchor, last) + 1 + LEAD_DAYS;
    return {
      anchor,
      dayCount: Math.max(
        1,
        Math.min(MAX_AXIS_DAYS, Math.max(viewportDays, dataDays)),
      ),
      dayWidth,
    };
  }

  const dataDays = first && last ? daysBetween(first, last) + 1 : 0;
  const dayCount = Math.max(
    1,
    Math.min(MAX_AXIS_DAYS, dataDays + LEAD_DAYS * 2),
  );
  const fitted = usableWidth > 0 ? usableWidth / dayCount : DAY_WIDTH.month;
  return {
    anchor,
    dayCount,
    dayWidth: Math.min(MAX_FIT_DAY_WIDTH, Math.max(MIN_FIT_DAY_WIDTH, fitted)),
  };
}

/** Whether the ruler can name individual days at this width. */
export const showsDayLabels = (dayWidth: number) =>
  dayWidth >= WEEK_RULER_MIN_WIDTH;

/** Where a bar sits on the axis: its left edge and width, in pixels. */
export function barGeometry(
  start: string,
  end: string,
  anchor: string,
  dayWidth: number,
): { x: number; width: number } {
  // Inclusive of both endpoints: the 3rd to the 5th is three days, which is what a
  // reader counts on the axis. Never negative — an end before the start is a one-day
  // bar rather than a bar drawn backwards.
  const span = Math.max(0, daysBetween(start, end)) + 1;
  return {
    x: daysBetween(anchor, start) * dayWidth,
    width: span * dayWidth,
  };
}

/** One day on the axis, with everything the ruler and the gridlines need. */
export interface AxisDay {
  key: string;
  /** Day of the month, drawn only when the ruler is wide enough for it. */
  label: string;
  monthStart: boolean;
  weekStart: boolean;
  isToday: boolean;
}

/** The days the axis shows, derived in one pass. */
export function axisDays(
  anchor: string,
  count: number,
  weekStartsOn: number,
  now: Date = new Date(),
): AxisDay[] {
  const today = todayKey(now);
  const days: AxisDay[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = shiftDayKey(anchor, index);
    const date = dateFromDayKey(key);
    if (!date) continue;
    days.push({
      key,
      label: String(date.getDate()),
      monthStart: date.getDate() === 1,
      weekStart: date.getDay() === weekStartsOn,
      isToday: key === today,
    });
  }
  return days;
}

/** One label on the ruler's month band. */
export interface AxisLabel {
  /** Left offset of the label's first day, in pixels. */
  x: number;
  /** Width of the days the label covers, in pixels. */
  width: number;
  text: string;
}

/**
 * The ruler's month band: consecutive days of one month folded into one label.
 *
 * A run of a single day at the tail of a span still gets a label — dropping it would
 * leave the axis unnamed at that point, which reads as missing data rather than as a
 * short month.
 */
export function axisLabels(
  days: readonly AxisDay[],
  dayWidth: number,
  language: string,
  monthStyle: "long" | "short" = "short",
): AxisLabel[] {
  const labels: AxisLabel[] = [];

  const flush = (startIndex: number, endIndex: number) => {
    if (endIndex <= startIndex) return;
    const date = dateFromDayKey(days[startIndex].key);
    if (!date) return;
    labels.push({
      x: startIndex * dayWidth,
      width: (endIndex - startIndex) * dayWidth,
      text: `${monthName(date.getMonth(), language, monthStyle)} ${date.getFullYear()}`,
    });
  };

  let runStart = 0;
  for (let index = 1; index <= days.length; index += 1) {
    const isBoundary = index === days.length || days[index].monthStart;
    if (!isBoundary) continue;
    flush(runStart, index);
    runStart = index;
  }
  return labels;
}
