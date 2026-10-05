import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  buildChartData,
  MAX_CHART_CATEGORIES,
  MAX_DAY_CATEGORIES,
  resolveChartConfig,
} from "./chartData";
import type { PropType, PropertyDef, RowData, ViewDef } from "./types";

/**
 * These tests pin the rules that decide **what each bar stands for**, which is where a
 * chart goes quietly wrong: an average divided by every row instead of by the rows that
 * hold a number, a multi-select row counted once instead of once per option, a category
 * that drops the records it cannot place. None of those raise an error or look wrong in
 * a screenshot; they are wrong numbers.
 *
 * The other half is the fallback behaviour, tested through `resolveChartConfig`: a
 * chart has to open on something sensible, and it must not silently pick a column whose
 * values the user never asked to see aggregated.
 */

const property = (
  id: string,
  type: PropType,
  options: { id: string; name: string; color: string }[] = [],
): PropertyDef => ({
  id,
  name: id,
  type,
  order: id,
  options: options.map((option, index) => ({
    ...option,
    order: String(index),
  })),
});

const row = (id: string, values: Record<string, unknown>): RowData => ({
  id,
  order: id,
  values,
});

const STATUS = property("status", "select", [
  { id: "todo", name: "Todo", color: "macaron-gray" },
  { id: "doing", name: "Doing", color: "macaron-blue" },
  { id: "done", name: "Done", color: "macaron-green" },
]);

const LABELS = {
  noValue: "No value",
  other: "Other",
  checked: "Checked",
  unchecked: "Unchecked",
};

const data = (
  rows: RowData[],
  over: Partial<Parameters<typeof buildChartData>[0]> = {},
) =>
  buildChartData({
    rows,
    category: STATUS,
    aggregate: "count",
    language: "en-US",
    labels: LABELS,
    ...over,
  });

describe("buildChartData: counting", () => {
  it("counts records per option in the order the options are arranged in", () => {
    const plan = data([
      row("a", { status: "done" }),
      row("b", { status: "todo" }),
      row("c", { status: "done" }),
    ]);

    // Option order, not value order: "Todo" has one record and is still first.
    expect(plan.points.map((point) => [point.label, point.value])).toEqual([
      ["Todo", 1],
      ["Doing", 0],
      ["Done", 2],
    ]);
    expect(plan.total).toBe(3);
    expect(plan.skipped).toBe(0);
  });

  it("keeps an unused option as a zero bar rather than omitting it", () => {
    // The option exists in the schema, and a chart that hid it would make a configured
    // column look empty.
    const plan = data([row("a", { status: "todo" })]);
    expect(plan.points.find((point) => point.label === "Doing")?.value).toBe(0);
  });

  it("gathers records with no value into a trailing bucket", () => {
    // Not dropped: invisible data is the one outcome a chart must not produce.
    const plan = data([
      row("a", { status: "todo" }),
      row("b", {}),
      row("c", { status: 42 }),
    ]);

    expect(plan.points[plan.points.length - 1]).toMatchObject({
      label: "No value",
      value: 2,
      empty: true,
    });
    expect(plan.total).toBe(3);
  });

  it("counts a multi-select row once per selected option", () => {
    // The row really does belong to both groups; counting it once would make the chart
    // disagree with a board built from the same column.
    const tags = property("tags", "multi-select", [
      { id: "x", name: "X", color: "macaron-blue" },
      { id: "y", name: "Y", color: "macaron-red" },
    ]);
    const plan = data(
      [row("a", { tags: ["x", "y"] }), row("b", { tags: ["x"] })],
      {
        category: tags,
      },
    );

    expect(plan.points.map((point) => point.value)).toEqual([2, 1]);
    // `total` is the sum over groups, so the row counted twice is counted twice here
    // too — it is what the bars add up to, not a record count.
    expect(plan.total).toBe(3);
  });

  it("puts a multi-select row whose options are gone in the no-value bucket", () => {
    const tags = property("tags", "multi-select", [
      { id: "x", name: "X", color: "macaron-blue" },
    ]);
    const plan = data([row("a", { tags: ["deleted"] })], { category: tags });
    expect(plan.points.filter((point) => point.empty)).toHaveLength(1);
    expect(plan.points[plan.points.length - 1].value).toBe(1);
  });

  it("splits a checkbox into checked and unchecked, unset being no value", () => {
    const done = property("done", "checkbox");
    const plan = data(
      [row("a", { done: true }), row("b", { done: false }), row("c", {})],
      { category: done },
    );

    expect(plan.points.map((point) => [point.label, point.value])).toEqual([
      ["Checked", 1],
      ["Unchecked", 1],
      ["No value", 1],
    ]);
  });

  it("reads a text cell held as Y.Text", () => {
    // `getRows()` hands back the live document object for text columns, so comparing it
    // to a string would never match and every text category would be one bucket.
    const text = property("note", "text");
    // A `Y.Text` has to be attached to a document before it can be read.
    const doc = new Y.Doc();
    const map = doc.getMap("row");
    const cell = new Y.Text();
    map.set("note", cell);
    cell.insert(0, "Alpha");
    const plan = data([row("a", { note: cell })], { category: text });
    expect(plan.points.map((point) => point.label)).toEqual(["Alpha"]);
  });
});

describe("buildChartData: measuring", () => {
  const amount = property("amount", "number");

  it("sums the measure per category", () => {
    const plan = data(
      [
        row("a", { status: "todo", amount: 2 }),
        row("b", { status: "todo", amount: 3 }),
        row("c", { status: "done", amount: 10 }),
      ],
      { measure: amount, aggregate: "sum" },
    );

    expect(plan.points.map((point) => [point.label, point.value])).toEqual([
      ["Todo", 5],
      ["Doing", 0],
      ["Done", 10],
    ]);
    expect(plan.skipped).toBe(0);
  });

  it("averages over the records that hold a number, not over every row", () => {
    // The classic silent wrongness: dividing by the rows with no value drags the
    // average towards zero and looks plausible.
    const plan = data(
      [
        row("a", { status: "todo", amount: 10 }),
        row("b", { status: "todo", amount: 20 }),
        row("c", { status: "todo" }),
      ],
      { measure: amount, aggregate: "avg" },
    );

    expect(plan.points[0].value).toBe(15);
    expect(plan.skipped).toBe(1);
  });

  it("takes min and max", () => {
    const rows = [
      row("a", { status: "todo", amount: 4 }),
      row("b", { status: "todo", amount: -1 }),
      row("c", { status: "todo", amount: 9 }),
    ];
    expect(
      data(rows, { measure: amount, aggregate: "min" }).points[0].value,
    ).toBe(-1);
    expect(
      data(rows, { measure: amount, aggregate: "max" }).points[0].value,
    ).toBe(9);
  });

  it("omits a point whose pool has no numbers rather than inventing one", () => {
    // "Average: 0" for records that hold no numbers is a made-up number; the count of
    // what was skipped is the honest report.
    const plan = data(
      [row("a", { status: "todo", amount: 5 }), row("b", { status: "done" })],
      {
        measure: amount,
        aggregate: "avg",
      },
    );

    expect(plan.points.map((point) => point.label)).toEqual(["Todo"]);
    expect(plan.skipped).toBe(1);
  });

  it("skips a measure cell that holds a non-number", () => {
    const plan = data(
      [
        row("a", { status: "todo", amount: "not a number" }),
        row("b", { status: "todo", amount: 3 }),
      ],
      { measure: amount, aggregate: "sum" },
    );
    expect(plan.points[0].value).toBe(3);
    expect(plan.skipped).toBe(1);
  });

  it("ignores the measure column entirely in count mode", () => {
    // The user asked for records, not for the values of a column they did not choose.
    const plan = data(
      [row("a", { status: "todo", amount: 100 }), row("b", { status: "todo" })],
      { measure: amount, aggregate: "count" },
    );
    expect(plan.points[0].value).toBe(2);
    expect(plan.skipped).toBe(0);
  });

  it("carries negative values through, so the caller can decide about them", () => {
    const plan = data(
      [
        row("a", { status: "todo", amount: -7 }),
        row("b", { status: "done", amount: 4 }),
      ],
      { measure: amount, aggregate: "sum" },
    );
    expect(plan.points[0].value).toBe(-7);
  });
});

describe("buildChartData: date categories", () => {
  const due = property("due", "date");
  const date = (day: string) => ({ start: day });

  it("orders days in time order whatever order the rows arrived in", () => {
    const plan = data(
      [
        row("a", { due: date("2026-03-20") }),
        row("b", { due: date("2026-03-02") }),
        row("c", { due: date("2026-03-11") }),
      ],
      { category: due },
    );

    expect(plan.points.map((point) => point.key)).toEqual([
      "day:2026-03-02",
      "day:2026-03-11",
      "day:2026-03-20",
    ]);
    expect(plan.dateGrain).toBe("day");
  });

  it("switches to month buckets when there are more days than an axis can name", () => {
    // One distinct day per entry, so the count is exactly the bucket count.
    const rows = Array.from(
      { length: MAX_DAY_CATEGORIES + 1 },
      (_unused, index) =>
        row(`r${index}`, {
          due: date(
            `2026-${index < 20 ? "01" : "02"}-${String((index % 28) + 1).padStart(2, "0")}`,
          ),
        }),
    );
    const plan = data(rows, { category: due });

    expect(plan.dateGrain).toBe("month");
    expect(plan.points.map((point) => point.key)).toEqual([
      "month:2026-01",
      "month:2026-02",
    ]);
  });

  it("keeps sparse days as days however far apart they are", () => {
    // The threshold is on distinct days, not on the span: a quarterly check-in keeps
    // its daily resolution.
    const plan = data(
      [
        row("a", { due: date("2026-01-05") }),
        row("b", { due: date("2026-09-05") }),
      ],
      { category: due },
    );
    expect(plan.dateGrain).toBe("day");
    expect(plan.points).toHaveLength(2);
  });

  it("counts a date range on its start day", () => {
    const plan = data(
      [row("a", { due: { start: "2026-03-02", end: "2026-03-09" } })],
      { category: due },
    );
    expect(plan.points[0].key).toBe("day:2026-03-02");
  });
});

describe("buildChartData: free-text categories", () => {
  const name = property("name", "title");

  it("ranks text categories by value, descending", () => {
    const plan = data(
      [
        row("a", { name: "Alpha" }),
        row("b", { name: "Alpha" }),
        row("c", { name: "Beta" }),
      ],
      { category: name },
    );
    expect(plan.points.map((point) => [point.label, point.value])).toEqual([
      ["Alpha", 2],
      ["Beta", 1],
    ]);
    expect(plan.folded).toBe(false);
  });

  it("folds a long tail into one Other point", () => {
    const rows = Array.from(
      { length: MAX_CHART_CATEGORIES + 5 },
      (_unused, index) =>
        row(`r${index}`, { name: `Cat ${String(index).padStart(2, "0")}` }),
    );
    const plan = data(rows, { category: name });

    expect(plan.points).toHaveLength(MAX_CHART_CATEGORIES);
    expect(plan.folded).toBe(true);
    const other = plan.points[plan.points.length - 1];
    expect(other.label).toBe("Other");
    expect(other.value).toBe(6);
  });

  it("pools the tail's values so a non-sum aggregate stays correct", () => {
    // Summing two averages is not an average; pooling the numbers still reduces right.
    const rows = [
      row("big-1", { name: "Big One", n: 100 }),
      row("big-2", { name: "Big Two", n: 100 }),
      row("small-1", { name: "Tail A", n: 1 }),
      row("small-2", { name: "Tail B", n: 3 }),
    ];
    const plan = data(rows, {
      category: name,
      measure: property("n", "number"),
      aggregate: "avg",
      maxCategories: 3,
    });

    // Two named categories plus Other; Other averages 1 and 3, i.e. 2 — not the 100
    // a sum of the two named averages would have contributed.
    const other = plan.points.find((point) => point.other);
    expect(other?.value).toBe(2);
  });

  it("puts an all-whitespace text cell in the no-value bucket, not a category named ''", () => {
    const plan = data([row("a", { name: "   " })], { category: name });
    expect(plan.points.map((point) => point.key)).toEqual(["empty"]);
  });

  it("folds options into time order rather than into Other", () => {
    // A finite vocabulary has natural order; folding "Todo" and "Done" together would
    // merge two things the reader asked to keep apart.
    const rows = Array.from(
      { length: MAX_CHART_CATEGORIES + 5 },
      (_unused, index) =>
        row(`r${index}`, { status: index % 2 ? "todo" : "done" }),
    );
    const plan = data(rows);
    expect(plan.folded).toBe(false);
    expect(plan.points).toHaveLength(3);
  });
});

describe("resolveChartConfig", () => {
  const properties = [
    property("name", "title"),
    property("note", "text"),
    property("amount", "number"),
    property("due", "date"),
    STATUS,
  ];

  it("defaults to a bar chart of record counts", () => {
    const config = resolveChartConfig(properties, undefined);
    expect(config.type).toBe("bar");
    expect(config.aggregate).toBe("count");
    expect(config.measure).toBeUndefined();
  });

  it("prefers a select column as the default category", () => {
    // "How many per status" is the archetype, and the select column is the one that
    // already holds a finite vocabulary.
    expect(resolveChartConfig(properties, undefined).category?.id).toBe(
      "status",
    );
  });

  it("falls back through checkbox, then date, then the first eligible column", () => {
    const checkbox = property("flag", "checkbox");
    const date = property("due", "date");
    expect(
      resolveChartConfig([property("name", "title"), date, checkbox], undefined)
        .category?.id,
    ).toBe("flag");
    expect(
      resolveChartConfig([property("name", "title"), date], undefined).category
        ?.id,
    ).toBe("due");
    // Title is text-like, so a title-only database charts its record names rather than
    // refusing to draw.
    expect(
      resolveChartConfig([property("name", "title")], undefined).category?.id,
    ).toBe("name");
  });

  it("never picks a number column as the category", () => {
    // A number is a quantity, and the chart has a dedicated place for quantities.
    expect(
      resolveChartConfig([property("amount", "number")], undefined).category,
    ).toBeUndefined();
  });

  it("drops a stored category whose type no longer fits", () => {
    const view = {
      id: "v",
      name: "Chart",
      layout: "chart",
      order: "a",
      visibleProps: [],
      chartCategoryProp: "amount",
    } as ViewDef;
    expect(resolveChartConfig(properties, view).category?.id).toBe("status");
  });

  it("drops a stored measure that is not a number column", () => {
    // No fallback: summing a column nobody nominated would show numbers the user
    // cannot explain. The chart counts instead.
    const view = {
      id: "v",
      name: "Chart",
      layout: "chart",
      order: "a",
      visibleProps: [],
      chartMeasureProp: "note",
    } as ViewDef;
    const config = resolveChartConfig(properties, view);
    expect(config.measure).toBeUndefined();
    expect(config.aggregate).toBe("count");
  });

  it("defaults the aggregate to sum when a measure is chosen", () => {
    // Picking a column to add up and then not adding it up makes the picker look broken.
    const view = {
      id: "v",
      name: "Chart",
      layout: "chart",
      order: "a",
      visibleProps: [],
      chartMeasureProp: "amount",
    } as ViewDef;
    const config = resolveChartConfig(properties, view);
    expect(config.measure?.id).toBe("amount");
    expect(config.aggregate).toBe("sum");
  });

  it("keeps a stored aggregate and shape when they are known", () => {
    const view = {
      id: "v",
      name: "Chart",
      layout: "chart",
      order: "a",
      visibleProps: [],
      chartType: "pie",
      chartAggregate: "max",
      chartMeasureProp: "amount",
    } as ViewDef;
    const config = resolveChartConfig(properties, view);
    expect(config.type).toBe("pie");
    expect(config.aggregate).toBe("max");
  });

  it("ignores an unknown stored shape", () => {
    const view = {
      id: "v",
      name: "Chart",
      layout: "chart",
      order: "a",
      visibleProps: [],
      chartType: "radar",
    } as unknown as ViewDef;
    expect(resolveChartConfig(properties, view).type).toBe("bar");
  });
});
