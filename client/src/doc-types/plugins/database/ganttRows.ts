import { dayKeyOf, type DayKey } from "./journalDays";
import type { RowData } from "./types";

/**
 * Bars, dependencies and the unscheduled list for the Gantt view.
 *
 * Pure: no React, no Yjs, no binding. The view supplies plain readers (`titleOf`,
 * `dependencyOf`) so the rules that decide **what a bar means** can be tested without
 * a document — including the two shapes that are easy to get wrong and invisible when
 * they are: an `end` before the `start`, and two records that depend on each other.
 */

/** One scheduled record, as the chart draws it. */
export interface GanttBar {
  row: RowData;
  /** First day the bar covers. */
  start: DayKey;
  /** Last day the bar covers, never before `start`. */
  end: DayKey;
  /** Drawn as a diamond on `start` instead of a bar. */
  milestone: boolean;
}

/** One dependency edge: predecessor's last day to successor's first day. */
export interface GanttLink {
  /** The dependent record's row id. */
  rowId: string;
  /** The record it waits for. */
  fromRowId: string;
  from: DayKey;
  to: DayKey;
  /**
   * The successor starts before the predecessor is over.
   *
   * Reported, never repaired: the only correct fix is one the user has to choose, and
   * a view that moved a record to make its own chart look consistent would be editing
   * the document to hide a conflict.
   */
  violated: boolean;
}

export interface GanttPlan {
  /** Scheduled bars, earliest first, ties keeping the view's own order. */
  bars: GanttBar[];
  /** Records with no usable start date: listed below the chart, never drawn at zero. */
  unscheduled: RowData[];
  /** Dependency edges that resolve, with cycles already broken. */
  links: GanttLink[];
  /** First day any bar covers, or null when there are none. */
  first: DayKey | null;
  /** Last day any bar covers, or null when there are none. */
  last: DayKey | null;
}

/**
 * Which two `date` columns a Gantt view should draw bars from.
 *
 * Prefers the view's stored pair, and falls back to the schema's own date columns in
 * the user's column order: the **first** is the start, the **next** is the end. That
 * rule is what makes the view usable the moment it is opened on a database whose
 * columns are already `Start` and `End` — the common case, and the one where an empty
 * "pick a column" panel would be a mode switch for information the schema already
 * carries.
 *
 * Read-side tolerance, matching `getViewCalendarProperty`: a stored id that is missing,
 * dangling, or names a column that has been retyped away from `date` is a preference
 * that can no longer be honoured, not an error — so it is dropped and the fallback
 * decides instead.
 *
 * The end never equals the start. One date column means one-day bars (no end at all)
 * rather than a bar whose two edges are the same column, which would make the stored
 * pair meaningless as soon as the user resized one.
 */
export function resolveGanttPair(
  datePropertyIds: readonly string[],
  storedStart: string | undefined,
  storedEnd: string | undefined,
): { start?: string; end?: string } {
  const start = datePropertyIds.includes(storedStart ?? "")
    ? storedStart
    : datePropertyIds[0];
  if (!start) return {};

  const startIndex = datePropertyIds.indexOf(start);
  const storedEndIsUsable =
    storedEnd !== undefined &&
    storedEnd !== start &&
    datePropertyIds.includes(storedEnd);
  const end = storedEndIsUsable ? storedEnd : datePropertyIds[startIndex + 1];
  return { start, end: end === start ? undefined : end };
}

export interface GanttInput {
  /** The view's rows, already filtered and in the view's own order. */
  rows: readonly RowData[];
  /** Column holding the bar's left edge. Resolved by the caller. */
  startPropId: string | undefined;
  /** Column holding the bar's right edge, when the view has one. */
  endPropId?: string;
  /** `checkbox` column: a ticked record is a milestone. */
  milestonePropId?: string;
  /** `text` column naming another record this one waits for. */
  dependencyPropId?: string;
  /** Title text of a row, used to resolve a dependency and to label a bar. */
  titleOf: (row: RowData) => string;
  /** Raw dependency text of a row. */
  dependencyOf: (row: RowData) => string;
}

/**
 * The day a bar ends.
 *
 * A missing or unparseable end is a **one-day bar**, not an error: "started, not
 * finished" is the normal state of a task, and the alternative — no bar at all — hides
 * work in progress from the chart. An end before the start is treated the same way rather
 * than drawn as a negative width, which would place the bar's left edge after its right
 * and invert every hit test on it.
 */
function barEnd(barStart: DayKey, rawEnd: unknown): DayKey {
  const end = dayKeyOf(rawEnd);
  if (!end) return barStart;
  return end < barStart ? barStart : end;
}

/** Build bars, the unscheduled list and resolved dependency links. */
export function buildGanttPlan(input: GanttInput): GanttPlan {
  const {
    rows,
    startPropId,
    endPropId,
    milestonePropId,
    dependencyPropId,
    titleOf,
    dependencyOf,
  } = input;

  /**
   * One pass over the view's rows, which arrive in the **view's own order**
   * (`getViewRows`: the rows' `order` keys, with the view's sort rules applied on top).
   *
   * **Lanes follow that order and are never re-sorted by date.** A chart's rows are a
   * vertical list as well as a set of lanes, so sorting them by start day makes a dragged
   * bar change lane *while it is being dragged*: its own row moves out from under the
   * pointer and the chart rearranges itself in response to the edit, which reads as the
   * drag having failed even though the write succeeded.
   *
   * It also keeps the chart and the table telling the same story. "Arrange records by
   * date" is a **sort**, and the table already has the control for it; applying one here
   * as well would mean the chart disagreed with the table whenever both were on screen,
   * and would silently override an order the user had chosen.
   *
   * So the axis span below is found by reducing over the days rather than by sorting the
   * bars — measuring them must not rearrange them.
   */
  const bars: GanttBar[] = [];
  const unscheduled: RowData[] = [];

  for (const row of rows) {
    const start = startPropId ? dayKeyOf(row.values[startPropId]) : null;
    if (!start) {
      // A record with no start day belongs to no column of the axis. It is listed
      // rather than placed at the anchor, which would claim a date it never had.
      unscheduled.push(row);
      continue;
    }
    bars.push({
      row,
      start,
      end: barEnd(start, endPropId ? row.values[endPropId] : undefined),
      milestone: milestonePropId ? row.values[milestonePropId] === true : false,
    });
  }

  const links =
    dependencyPropId && startPropId
      ? buildLinks(bars, { titleOf, dependencyOf })
      : [];

  return {
    bars,
    unscheduled,
    links,
    first: bars.reduce<DayKey | null>(
      (earliest, bar) =>
        earliest === null || bar.start < earliest ? bar.start : earliest,
      null,
    ),
    last: bars.reduce<DayKey | null>(
      (latest, bar) => (latest === null || bar.end > latest ? bar.end : latest),
      null,
    ),
  };
}

/** Row id for a resolved dependency target, indexed two ways. */
function buildDependencyIndex(
  bars: readonly GanttBar[],
  titleOf: (row: RowData) => string,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const bar of bars) {
    // The stable identifier, so an export or a script can address a record without
    // depending on a name that the user may rename.
    index.set(bar.row.id.toLowerCase(), bar.row.id);
    const title = titleOf(bar.row).trim().toLowerCase();
    // First writer wins: two records sharing a name is legal (nothing enforces
    // uniqueness), and resolving to the earlier one at least resolves deterministically
    // instead of flickering with document order.
    if (title && !index.has(title)) index.set(title, bar.row.id);
  }
  return index;
}

/**
 * Resolve the dependency column into edges, dropping any that would close a loop.
 *
 * Each record names at most one predecessor, so the graph is a functional graph and a
 * cycle is a chain that comes back to where it started. Two people can create one
 * without ever disagreeing — A set to depend on B while B was set to depend on A — so
 * it is a real state, not a corrupt one, and it has to be broken at read time: drawing
 * a loop would layer every bar on top of itself, and nothing would be written back
 * because the documents are individually correct.
 *
 * Exactly **one edge per loop** is dropped and the other edges still draw, so a cycle
 * costs one arrow rather than the whole chart. Which edge is dropped follows chart
 * order, which makes it stable across clients and renders instead of depending on
 * document insertion order.
 */
function buildLinks(
  bars: readonly GanttBar[],
  resolve: {
    titleOf: (row: RowData) => string;
    dependencyOf: (row: RowData) => string;
  },
): GanttLink[] {
  const { titleOf, dependencyOf } = resolve;
  const index = buildDependencyIndex(bars, titleOf);
  const byRowId = new Map(bars.map((bar) => [bar.row.id, bar] as const));

  /** Predecessor row id, or null when the text does not resolve. */
  const proposedOf = (bar: GanttBar): string | null => {
    const raw = dependencyOf(bar.row).trim();
    if (!raw) return null;
    const resolved = index.get(raw.toLowerCase());
    if (!resolved || resolved === bar.row.id) return null;
    // Only a scheduled record can be depended on: an undated one has no bar, so a link
    // to it would have to be drawn at the axis origin, pointing at nothing.
    return byRowId.has(resolved) ? resolved : null;
  };

  /**
   * Edges accepted so far, built in **chart order**.
   *
   * Checked against the accepted graph rather than against the proposed one: a cycle
   * is a property of what is actually drawn, and testing the proposals instead would
   * report every edge of a loop as closing it — dropping all of them and leaving the
   * chart with no links at all, which is the opposite of what breaking a cycle is for.
   *
   * Because each record proposes at most one predecessor, an accepted edge can only
   * close a loop that runs through the record being processed. Walking forward from the
   * proposal and looking for that record finds it, and the walk is finite because the
   * accepted edges seen so far are themselves loop-free.
   */
  const accepted = new Map<string, string>();
  const closesLoop = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    let cursor: string | undefined = from;
    while (cursor && !seen.has(cursor)) {
      if (cursor === target) return true;
      seen.add(cursor);
      cursor = accepted.get(cursor);
    }
    return false;
  };

  const links: GanttLink[] = [];
  for (const bar of bars) {
    const predecessorId = proposedOf(bar);
    if (!predecessorId) continue;
    if (closesLoop(predecessorId, bar.row.id)) continue;
    accepted.set(bar.row.id, predecessorId);

    const predecessor = byRowId.get(predecessorId);
    if (!predecessor) continue;
    links.push({
      rowId: bar.row.id,
      fromRowId: predecessorId,
      from: predecessor.end,
      to: bar.start,
      // The successor has to start **after** the predecessor's last day. Bars count
      // both endpoints, so starting on that day is a day of overlap rather than a
      // handover — an off-by-one the other way would flag every correct schedule.
      violated: bar.start <= predecessor.end,
    });
  }
  return links;
}
