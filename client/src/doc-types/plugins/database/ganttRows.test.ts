import { describe, expect, it } from "vitest";
import { buildGanttPlan, resolveGanttPair } from "./ganttRows";
import type { RowData } from "./types";

/**
 * These tests pin the rules that decide **what a bar means** and **which dependency
 * edges are drawn**, which are the two places a Gantt chart goes quietly wrong.
 *
 * A bar whose end precedes its start is drawn inverted and every hit test on it is
 * wrong; a pair of records that depend on each other is a *legal* state two people can
 * create without ever disagreeing, and drawing it would stack two bars on top of each
 * other. Neither raises an error, and neither is visible in the model, because the model
 * has nothing to say about either.
 */

const row = (id: string, values: Record<string, unknown>): RowData => ({
  id,
  order: id,
  values,
});

/** A row titled `name`, so dependencies written as names can resolve. */
const named = (
  id: string,
  name: string,
  values: Record<string, unknown> = {},
): RowData => row(id, { t: name, ...values });

const input = (
  rows: RowData[],
  over: Partial<Parameters<typeof buildGanttPlan>[0]> = {},
) => ({
  rows,
  startPropId: "start",
  endPropId: "end",
  dependencyPropId: "dep",
  titleOf: (candidate: RowData) => String(candidate.values.t ?? ""),
  dependencyOf: (candidate: RowData) => String(candidate.values.dep ?? ""),
  ...over,
});

describe("resolveGanttPair", () => {
  it("uses the stored pair when both columns are dates", () => {
    expect(resolveGanttPair(["a", "b", "c"], "b", "c")).toEqual({
      start: "b",
      end: "c",
    });
  });

  it("falls back to the first date column and the next when nothing is stored", () => {
    // The common case: a database whose columns are already called Start and End.
    expect(resolveGanttPair(["a", "b", "c"], undefined, undefined)).toEqual({
      start: "a",
      end: "b",
    });
  });

  it("leaves the end unset when there is only one date column", () => {
    // One-day bars, not a bar whose two edges are the same column: the second would
    // make the stored pair meaningless the moment either edge was dragged.
    expect(resolveGanttPair(["only"], undefined, undefined)).toEqual({
      start: "only",
      end: undefined,
    });
  });

  it("drops a dangling stored end rather than pairing the start with itself", () => {
    // A column that has been deleted or retyped is a preference that cannot be
    // honoured, so the fallback decides instead of the chart drawing one-day bars
    // for everyone with no explanation.
    expect(resolveGanttPair(["a", "b"], "a", "gone")).toEqual({
      start: "a",
      end: "b",
    });
  });

  it("refuses a stored pair naming the same column twice", () => {
    expect(resolveGanttPair(["a", "b"], "a", "a")).toEqual({
      start: "a",
      end: "b",
    });
  });

  it("returns nothing when the schema has no date column at all", () => {
    expect(resolveGanttPair([], undefined, undefined)).toEqual({});
  });

  it("keeps the stored start even when it is not the first date column", () => {
    expect(resolveGanttPair(["a", "b", "c"], "c", undefined)).toEqual({
      start: "c",
      end: undefined,
    });
  });
});

describe("buildGanttPlan — bars", () => {
  it("reads a bar from the start and end columns", () => {
    const plan = buildGanttPlan(
      input([named("r1", "A", { start: "2026-03-02", end: "2026-03-05" })]),
    );
    expect(plan.bars).toHaveLength(1);
    expect(plan.bars[0].start).toBe("2026-03-02");
    expect(plan.bars[0].end).toBe("2026-03-05");
    expect(plan.first).toBe("2026-03-02");
    expect(plan.last).toBe("2026-03-05");
  });

  it("treats a start with no end as a one-day bar", () => {
    // "Started, not finished" is the normal state of a task, not an error: the
    // alternative hides work in progress from the chart entirely.
    const plan = buildGanttPlan(
      input([named("r1", "A", { start: "2026-03-02" })]),
    );
    expect(plan.bars[0].end).toBe("2026-03-02");
  });

  it("treats an end before the start as a one-day bar", () => {
    const plan = buildGanttPlan(
      input([named("r1", "A", { start: "2026-03-05", end: "2026-03-01" })]),
    );
    expect(plan.bars[0].start).toBe("2026-03-05");
    expect(plan.bars[0].end).toBe("2026-03-05");
  });

  it("reads both stored date shapes", () => {
    // The picker writes an instant; a retyped text cell writes a bare calendar date.
    const plan = buildGanttPlan(
      input([
        named("r1", "A", {
          start: "2026-03-02T12:00:00.000Z",
          end: "2026-03-05",
        }),
      ]),
    );
    expect(plan.bars[0].start).toBe("2026-03-02");
    expect(plan.bars[0].end).toBe("2026-03-05");
  });

  it("lists an undated record instead of placing it at the anchor", () => {
    const plan = buildGanttPlan(
      input([
        named("r1", "A", { start: "2026-03-02" }),
        named("r2", "B", { end: "2026-03-09" }),
      ]),
    );
    expect(plan.bars.map((bar) => bar.row.id)).toEqual(["r1"]);
    expect(plan.unscheduled.map((row) => row.id)).toEqual(["r2"]);
    // The end-only row must not stretch the axis to its own end either: it has no bar.
    expect(plan.last).toBe("2026-03-02");
  });

  it("reads a milestone from a checkbox column", () => {
    const plan = buildGanttPlan({
      ...input(
        [
          named("r1", "A", { start: "2026-03-02", milestone: true }),
          named("r2", "B", { start: "2026-03-03", milestone: false }),
        ],
        { milestonePropId: "milestone" },
      ),
    });
    expect(plan.bars.map((bar) => bar.milestone)).toEqual([true, false]);
  });

  it("is a bar, not a milestone, when the column is not configured", () => {
    const plan = buildGanttPlan(
      input([named("r1", "A", { start: "2026-03-02", milestone: true })]),
    );
    expect(plan.bars[0].milestone).toBe(false);
  });

  it("keeps the view's own row order rather than sorting lanes by date", () => {
    // The load-bearing rule for dragging. A bar's lane must not depend on its dates, or a
    // drag would move the bar's own row out from under the pointer *while it is being
    // dragged* — the chart rearranging itself in response to the edit, which reads as the
    // drag having failed even though the write succeeded.
    //
    // Arranging records by date is a **sort**, and the view's own sorts already did it
    // before these rows arrived. Applying a second one here would silently override the
    // user's chosen order and disagree with the table beside it.
    const plan = buildGanttPlan(
      input([
        named("late", "A", { start: "2026-03-09" }),
        named("first", "B", { start: "2026-03-02" }),
        named("also", "C", { start: "2026-03-02" }),
      ]),
    );
    expect(plan.bars.map((bar) => bar.row.id)).toEqual([
      "late",
      "first",
      "also",
    ]);
  });

  it("draws the axis from the earliest and latest bar, whatever the lane order", () => {
    // The span is measured by reducing over the days, so finding it cannot rearrange the
    // lanes. Both ends are asserted on rows that are *not* in date order.
    const plan = buildGanttPlan(
      input([
        named("last", "A", { start: "2026-03-20", end: "2026-03-25" }),
        named("first", "B", { start: "2026-03-02" }),
        named("middle", "C", { start: "2026-03-10", end: "2026-03-12" }),
      ]),
    );
    expect(plan.first).toBe("2026-03-02");
    expect(plan.last).toBe("2026-03-25");
    expect(plan.bars.map((bar) => bar.row.id)).toEqual([
      "last",
      "first",
      "middle",
    ]);
  });

  it("keeps the unscheduled list in the view's own row order too", () => {
    const plan = buildGanttPlan(
      input([
        named("b", "B", {}),
        named("a", "A", { start: "2026-03-02" }),
        named("c", "C", {}),
      ]),
    );
    expect(plan.unscheduled.map((row) => row.id)).toEqual(["b", "c"]);
  });

  it("has no span when nothing is scheduled", () => {
    const plan = buildGanttPlan(input([named("r1", "A", {})]));
    expect(plan.first).toBeNull();
    expect(plan.last).toBeNull();
    expect(plan.bars).toEqual([]);
    expect(plan.unscheduled).toHaveLength(1);
  });

  it("places no bars when the view has no start column", () => {
    const plan = buildGanttPlan(
      input([named("r1", "A", { start: "2026-03-02" })], {
        startPropId: undefined,
      }),
    );
    expect(plan.bars).toEqual([]);
    expect(plan.unscheduled).toHaveLength(1);
  });
});

describe("buildGanttPlan — links", () => {
  it("draws an arrow from the predecessor's end to the successor's start", () => {
    const plan = buildGanttPlan(
      input([
        named("a", "A", { start: "2026-03-02", end: "2026-03-05" }),
        named("b", "B", { start: "2026-03-09", dep: "A" }),
      ]),
    );
    expect(plan.links).toEqual([
      {
        rowId: "b",
        fromRowId: "a",
        from: "2026-03-05",
        to: "2026-03-09",
        violated: false,
      },
    ]);
  });

  it("resolves a dependency written as a row id as well as a name", () => {
    // The stable identifier, so an export or a script can address a record without
    // depending on a name its owner may rename.
    const plan = buildGanttPlan(
      input([
        named("a", "Alpha", { start: "2026-03-02", end: "2026-03-05" }),
        named("b", "Beta", { start: "2026-03-09", dep: "a" }),
      ]),
    );
    expect(plan.links[0].fromRowId).toBe("a");
  });

  it("ignores case and surrounding whitespace in a name", () => {
    const plan = buildGanttPlan(
      input([
        named("a", "Alpha", { start: "2026-03-02", end: "2026-03-05" }),
        named("b", "Beta", { start: "2026-03-09", dep: "  alpha  " }),
      ]),
    );
    expect(plan.links).toHaveLength(1);
  });

  it("draws nothing for a half-typed name", () => {
    // The normal state of a text column while it is being filled in. An error marker
    // here would leave a chart permanently decorated with warnings nobody can clear.
    const plan = buildGanttPlan(
      input([
        named("a", "Alpha", { start: "2026-03-02" }),
        named("b", "Beta", { start: "2026-03-09", dep: "Alp" }),
      ]),
    );
    expect(plan.links).toEqual([]);
  });

  it("ignores a record that names itself", () => {
    const plan = buildGanttPlan(
      input([named("a", "Alpha", { start: "2026-03-02", dep: "Alpha" })]),
    );
    expect(plan.links).toEqual([]);
  });

  it("reports a successor that starts before its predecessor ends", () => {
    const plan = buildGanttPlan(
      input([
        named("a", "A", { start: "2026-03-02", end: "2026-03-10" }),
        named("b", "B", { start: "2026-03-05", dep: "A" }),
      ]),
    );
    expect(plan.links[0].violated).toBe(true);
  });

  it("treats a successor starting on the predecessor's last day as a conflict", () => {
    // Both bars count both endpoints, so sharing a day is a day of overlap rather than
    // a handover. The off-by-one matters in both directions: the other reading would
    // flag the *correct* schedule, where the successor starts the day after.
    const overlap = buildGanttPlan(
      input([
        named("a", "A", { start: "2026-03-02", end: "2026-03-05" }),
        named("b", "B", { start: "2026-03-05", dep: "A" }),
      ]),
    );
    expect(overlap.links[0].violated).toBe(true);

    const handedOver = buildGanttPlan(
      input([
        named("a", "A", { start: "2026-03-02", end: "2026-03-05" }),
        named("b", "B", { start: "2026-03-06", dep: "A" }),
      ]),
    );
    expect(handedOver.links[0].violated).toBe(false);
  });

  it("breaks a two-record cycle, keeping the earlier record's edge", () => {
    // A legal state two people create independently: A set to depend on B while B was
    // set to depend on A. Drawing both would put the two arrows on top of each other.
    // The edge kept is the one on the record the chart draws first, so which of the two
    // contradictory statements survives is stable across clients and renders rather
    // than dependent on document insertion order.
    const plan = buildGanttPlan(
      input([
        named("a", "A", { start: "2026-03-02", dep: "B" }),
        named("b", "B", { start: "2026-03-09", dep: "A" }),
      ]),
    );
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0].rowId).toBe("a");
    expect(plan.links[0].fromRowId).toBe("b");
  });

  it("breaks a longer cycle at one edge and keeps the rest", () => {
    // A waits for C, B waits for A, C waits for B. Only the edge that would close the
    // loop is dropped — reporting every edge of a loop as closing it would leave the
    // chart with no links at all, which is the opposite of what breaking a cycle is
    // for.
    const plan = buildGanttPlan(
      input([
        named("a", "A", { start: "2026-03-02", dep: "C" }),
        named("b", "B", { start: "2026-03-05", dep: "A" }),
        named("c", "C", { start: "2026-03-09", dep: "B" }),
      ]),
    );
    expect(plan.links.map((link) => link.rowId).sort()).toEqual(["a", "b"]);
  });

  it("never produces a link whose target record has no bar", () => {
    // Only scheduled records can be depended on: an undated record has no bar to
    // point at, so a link to it would be drawn at the axis origin.
    const plan = buildGanttPlan(
      input([
        named("a", "A", {}),
        named("b", "B", { start: "2026-03-09", dep: "A" }),
      ]),
    );
    expect(plan.links).toEqual([]);
  });

  it("resolves to the first record when two share a name", () => {
    // Nothing enforces unique titles, so this is reachable. Resolving
    // deterministically is better than flickering with document order.
    const plan = buildGanttPlan(
      input([
        named("a1", "Same", { start: "2026-03-02", end: "2026-03-03" }),
        named("a2", "Same", { start: "2026-03-08", end: "2026-03-09" }),
        named("b", "B", { start: "2026-03-12", dep: "Same" }),
      ]),
    );
    expect(plan.links[0].fromRowId).toBe("a1");
  });

  it("resolves an empty dependency column to no links", () => {
    const plan = buildGanttPlan(
      input([
        named("a", "A", { start: "2026-03-02" }),
        named("b", "B", { start: "2026-03-09", dep: "   " }),
      ]),
    );
    expect(plan.links).toEqual([]);
  });
});
