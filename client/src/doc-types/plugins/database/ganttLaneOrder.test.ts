import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A regression guard for the Gantt view's **lane order**.
 *
 * The rule is easy to state and easy to break without noticing: *a bar's lane must not
 * depend on its dates.* The failure it prevents was reported by a user, and it is
 * invisible to a unit test of the model because nothing in the model is wrong:
 *
 * > A chart's rows are a vertical list as well as a set of lanes. Sorting them by start
 * > day makes a dragged bar change lane **while it is being dragged** — its own row moves
 * > out from under the pointer and the chart rearranges itself in response to the edit.
 * > The drag reads as broken even though the write succeeded.
 *
 * Two different parts of the code could break it, and each is checked on source text:
 *
 * 1. **`ganttRows`** could sort the bars by `start`. Asserted functionally below, because
 *    it is pure — no source scan needed where a real assertion will do.
 * 2. **`GanttView`** could sort its `chartRows`, or key a lane's position off a date. That
 *    one is a source scan, because it is a component and this suite has no DOM.
 *
 * Arranging records by date is not forbidden — it is a **sort**, and the table's own sort
 * control is how a user asks for one. The guard is against the view applying one nobody
 * requested.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** A sort call that would order the rows, as a list of the ways it could be written. */
const ROW_SORTS = [/\.sort\s*\(/, /toSorted\s*\(/, /\.reverse\s*\(/];

/**
 * Ordering that is *allowed*, because it is not about a row's position.
 *
 * The ruler, the gridlines and the bars' own paint order are all fine to sort — the
 * prohibition is on reordering **the rows**, and a scan that flagged every `.sort(` in
 * the file would be noise a reader learns to ignore.
 */
function findsRowReorder(source: string): string[] {
  const offenders: string[] = [];
  for (const pattern of ROW_SORTS) {
    if (pattern.test(source)) offenders.push(pattern.source);
  }
  return offenders;
}

describe("the chart's lane order never follows the bars' dates", () => {
  it("keeps the planner's own harness honest", () => {
    // Guards the guard: if `findsRowReorder` could not see a sort at all, every assertion
    // below would pass on a file that sorts.
    expect(
      findsRowReorder("bars.sort((a, b) => a.start.localeCompare(b.start))"),
    ).toEqual(["\\.sort\\s*\\("]);
    expect(findsRowReorder("const x = [...bars].toSorted(cmp)")).toEqual([
      "toSorted\\s*\\(",
    ]);
    expect(findsRowReorder("const x = rows.slice().reverse()")).toEqual([
      "\\.reverse\\s*\\(",
    ]);
    expect(findsRowReorder("const x = [...rows].map(f)")).toEqual([]);
  });

  it("the view does not reorder its rows", () => {
    // `chartRows` is built from the plan's own order (bars, then the undated list), and a
    // `.sort()` anywhere on it would put lanes back in date order — the reported bug.
    const source = readFileSync(join(HERE, "GanttView.tsx"), "utf8");
    expect(findsRowReorder(source)).toEqual([]);
  });

  it("the view still reads its rows through the binding, so an explicit sort is honoured", () => {
    // The other half of the rule: lanes follow the *view's* order, which includes the sort
    // rules a user added. Reading `getRows()` instead of `getViewRows()` would ignore them
    // and make the sort chip do nothing in this layout.
    const source = readFileSync(join(HERE, "GanttView.tsx"), "utf8");
    expect(source).toContain("binding.getViewRows(viewId)");
    expect(source).not.toContain("binding.getRows()");
  });
});
