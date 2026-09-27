import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MAX_FILTER_DEPTH,
  OPERATORS_BY_TYPE,
  applyFilter,
  applyGroup,
  applySort,
  cellToText,
  isEmptyCell,
  matchesFilter,
  normalizeCell,
  operatorNeedsValue,
  readCell,
  selectRows,
  type FilterCondition,
  type FilterGroup,
  type SortRule,
} from "./filterSort";
import type { OptionDef, PropertyDef, PropType, RowData } from "./types";

// ------------------------------------------------------------------ helpers

const opt = (
  id: string,
  name: string,
  order: string,
  color = "default",
): OptionDef => ({
  id,
  name,
  color,
  order,
});

const prop = (
  id: string,
  type: PropType,
  options: OptionDef[] = [],
): PropertyDef => ({ id, name: id, type, order: "V", options });

/** A row whose values are already plain. */
const row = (
  id: string,
  order: string,
  values: Record<string, unknown>,
): RowData => ({
  id,
  order,
  values,
});

const cond = (
  propId: string,
  operator: FilterCondition["operator"],
  value?: unknown,
): FilterCondition => ({ kind: "condition", propId, operator, value });

const group = (
  op: "and" | "or",
  children: (FilterCondition | FilterGroup)[],
): FilterGroup => ({ kind: "group", op, children });

// ------------------------------------------------------------------- values

describe("normalizeCell", () => {
  it("converts a Y.Text cell to a string", () => {
    // The trap this exists for: getRows() hands back the live Y.Text object, so a
    // filter comparing it to a string would never match.
    const doc = new Y.Doc();
    const text = doc.getText("cell");
    text.insert(0, "hello");
    expect(normalizeCell(text)).toBe("hello");
  });

  it("treats an absent key, null and empty string alike", () => {
    expect(normalizeCell(undefined)).toBeNull();
    expect(normalizeCell(null)).toBeNull();
    expect(normalizeCell("")).toBeNull();
    const doc = new Y.Doc();
    expect(normalizeCell(doc.getText("empty"))).toBeNull();
  });

  it("keeps falsy-but-real values", () => {
    // 0 and false are values, not emptiness.
    expect(normalizeCell(0)).toBe(0);
    expect(normalizeCell(false)).toBe(false);
    expect(normalizeCell("0")).toBe("0");
  });

  it("treats an empty option list as empty, and a non-empty one as a value", () => {
    expect(normalizeCell([])).toBeNull();
    expect(normalizeCell(["a"])).toEqual(["a"]);
  });

  it("treats a date object with no start as empty", () => {
    expect(normalizeCell({ start: "" })).toBeNull();
    expect(normalizeCell({ start: "2026-01-01" })).toEqual({
      start: "2026-01-01",
    });
  });
});

describe("isEmptyCell / cellToText", () => {
  it("agrees with normalizeCell", () => {
    expect(isEmptyCell(null)).toBe(true);
    expect(isEmptyCell("")).toBe(true);
    expect(isEmptyCell([])).toBe(true);
    expect(isEmptyCell(0)).toBe(false);
    expect(isEmptyCell(false)).toBe(false);
  });

  it("renders values as text for matching", () => {
    expect(cellToText(null)).toBe("");
    expect(cellToText(42)).toBe("42");
    expect(cellToText(true)).toBe("true");
    expect(cellToText(["a", "b"])).toBe("a, b");
    expect(cellToText({ start: "2026-01-01" })).toBe("2026-01-01");
  });

  it("reads a cell through a row", () => {
    const r = row("r1", "V", { p1: "x" });
    expect(readCell(r, "p1")).toBe("x");
    expect(readCell(r, "missing")).toBeNull();
  });
});

// ---------------------------------------------------------------- operators

describe("OPERATORS_BY_TYPE", () => {
  it("offers text operators for text-like types", () => {
    for (const type of [
      "title",
      "text",
      "url",
      "email",
      "phone",
    ] as PropType[]) {
      expect(OPERATORS_BY_TYPE[type]).toContain("contains");
      expect(OPERATORS_BY_TYPE[type]).toContain("is_empty");
    }
  });

  it("offers numeric comparison only for numbers", () => {
    expect(OPERATORS_BY_TYPE.number).toContain("gt");
    expect(OPERATORS_BY_TYPE.number).not.toContain("contains");
    expect(OPERATORS_BY_TYPE.text).not.toContain("gt");
  });

  it("gives every type at least the emptiness operators", () => {
    for (const type of Object.keys(OPERATORS_BY_TYPE) as PropType[]) {
      expect(OPERATORS_BY_TYPE[type]).toContain("is_empty");
      expect(OPERATORS_BY_TYPE[type]).toContain("is_not_empty");
    }
  });

  it("knows which operators need no value", () => {
    expect(operatorNeedsValue("is_empty")).toBe(false);
    expect(operatorNeedsValue("is_not_empty")).toBe(false);
    expect(operatorNeedsValue("contains")).toBe(true);
    expect(operatorNeedsValue("gt")).toBe(true);
  });
});

// ---------------------------------------------------------------- filtering

describe("filtering: emptiness", () => {
  const p = prop("t", "text");
  const rows = [
    row("a", "V1", { t: "value" }),
    row("b", "V2", {}),
    row("c", "V3", { t: "" }),
  ];

  it("is_empty matches only the rows with nothing", () => {
    const result = applyFilter(rows, cond("t", "is_empty"), [p]);
    expect(result.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("is_not_empty matches only the rows with a value", () => {
    const result = applyFilter(rows, cond("t", "is_not_empty"), [p]);
    expect(result.map((r) => r.id)).toEqual(["a"]);
  });

  it("does not treat 0 or false as empty", () => {
    const n = prop("n", "number");
    const c = prop("c", "checkbox");
    const data = [row("a", "V1", { n: 0 }), row("b", "V2", { c: false })];
    expect(
      applyFilter(data, cond("n", "is_not_empty"), [n]).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      applyFilter(data, cond("c", "is_not_empty"), [c]).map((r) => r.id),
    ).toEqual(["b"]);
  });
});

describe("filtering: text", () => {
  const p = prop("t", "text");
  const rows = [
    row("a", "V1", { t: "Hello World" }),
    row("b", "V2", { t: "goodbye" }),
    row("c", "V3", {}),
  ];

  it("contains is case-insensitive", () => {
    expect(
      applyFilter(rows, cond("t", "contains", "hello"), [p]).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      applyFilter(rows, cond("t", "contains", "HELLO"), [p]).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("does_not_contain excludes matches and empties", () => {
    // An empty cell is not "not containing" — it has nothing to compare.
    expect(
      applyFilter(rows, cond("t", "does_not_contain", "hello"), [p]).map(
        (r) => r.id,
      ),
    ).toEqual(["b"]);
  });

  it("matches a Y.Text cell", () => {
    // Would fail if the condition compared against the Y.Text object directly.
    const doc = new Y.Doc();
    const text = doc.getText("c");
    text.insert(0, "from ydoc");
    const withText = [row("a", "V1", { t: text })];
    expect(
      applyFilter(withText, cond("t", "contains", "ydoc"), [p]).map(
        (r) => r.id,
      ),
    ).toEqual(["a"]);
  });

  it("an empty search string matches everything", () => {
    // A half-typed filter should not blank the view.
    expect(applyFilter(rows, cond("t", "contains", ""), [p])).toHaveLength(3);
  });

  it("is matches exactly, case-insensitively", () => {
    expect(
      applyFilter(rows, cond("t", "is", "hello world"), [p]).map((r) => r.id),
    ).toEqual(["a"]);
    expect(applyFilter(rows, cond("t", "is", "hello"), [p])).toHaveLength(0);
  });

  it("is_not excludes matches and empties", () => {
    expect(
      applyFilter(rows, cond("t", "is_not", "hello world"), [p]).map(
        (r) => r.id,
      ),
    ).toEqual(["b"]);
  });
});

describe("filtering: number", () => {
  const p = prop("n", "number");
  const rows = [
    row("a", "V1", { n: 1 }),
    row("b", "V2", { n: 5 }),
    row("c", "V3", { n: 10 }),
    row("d", "V4", {}),
  ];

  it("compares numerically, not as text", () => {
    // "10" < "5" as text, so this would be wrong with a string comparison.
    const result = applyFilter(rows, cond("n", "gt", 5), [p]);
    expect(result.map((r) => r.id)).toEqual(["c"]);
  });

  it("supports each comparison", () => {
    expect(applyFilter(rows, cond("n", "lt", 5), [p]).map((r) => r.id)).toEqual(
      ["a"],
    );
    expect(
      applyFilter(rows, cond("n", "gte", 5), [p]).map((r) => r.id),
    ).toEqual(["b", "c"]);
    expect(
      applyFilter(rows, cond("n", "lte", 5), [p]).map((r) => r.id),
    ).toEqual(["a", "b"]);
    expect(applyFilter(rows, cond("n", "eq", 5), [p]).map((r) => r.id)).toEqual(
      ["b"],
    );
    expect(
      applyFilter(rows, cond("n", "neq", 5), [p]).map((r) => r.id),
    ).toEqual(["a", "c"]);
  });

  it("never matches an empty cell, whatever the operator", () => {
    // A blank is not "less than 5".
    for (const op of ["gt", "lt", "gte", "lte", "eq", "neq"] as const) {
      const ids = applyFilter(rows, cond("n", op, 5), [p]).map((r) => r.id);
      expect(ids, op).not.toContain("d");
    }
  });

  it("ignores a non-numeric condition value rather than matching everything", () => {
    expect(applyFilter(rows, cond("n", "gt", "abc"), [p])).toHaveLength(0);
  });
});

describe("filtering: checkbox", () => {
  const p = prop("c", "checkbox");
  const rows = [
    row("a", "V1", { c: true }),
    row("b", "V2", { c: false }),
    row("c", "V3", {}),
  ];

  it("is true selects only checked rows", () => {
    expect(
      applyFilter(rows, cond("c", "is", true), [p]).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("is false selects only explicitly unchecked rows", () => {
    // An unset checkbox is empty, not false.
    expect(
      applyFilter(rows, cond("c", "is", false), [p]).map((r) => r.id),
    ).toEqual(["b"]);
  });

  it("accepts a stringified boolean", () => {
    expect(
      applyFilter(rows, cond("c", "is", "true"), [p]).map((r) => r.id),
    ).toEqual(["a"]);
  });
});

describe("filtering: select and status", () => {
  const options = [opt("o1", "Admin", "V1"), opt("o2", "Editor", "V2")];
  const p = prop("s", "select", options);
  const rows = [
    row("a", "V1", { s: "o1" }),
    row("b", "V2", { s: "o2" }),
    row("c", "V3", {}),
  ];

  it("matches by option id", () => {
    expect(
      applyFilter(rows, cond("s", "is", "o1"), [p]).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("matches by option name, so a filter written against a name works", () => {
    expect(
      applyFilter(rows, cond("s", "is", "Admin"), [p]).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      applyFilter(rows, cond("s", "is", "admin"), [p]).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("is_not excludes empties", () => {
    expect(
      applyFilter(rows, cond("s", "is_not", "o1"), [p]).map((r) => r.id),
    ).toEqual(["b"]);
  });

  it("works the same for status, which is just a grouped select", () => {
    const status = prop("st", "status", options);
    const statusRows = [row("a", "V1", { st: "o1" })];
    expect(
      applyFilter(statusRows, cond("st", "is", "Admin"), [status]),
    ).toHaveLength(1);
  });
});

describe("filtering: multi-select", () => {
  const options = [opt("o1", "Red", "V1"), opt("o2", "Blue", "V2")];
  const p = prop("m", "multi-select", options);
  const rows = [
    row("a", "V1", { m: ["o1"] }),
    row("b", "V2", { m: ["o1", "o2"] }),
    row("c", "V3", { m: [] }),
  ];

  it("contains matches by option name", () => {
    expect(
      applyFilter(rows, cond("m", "contains", "blue"), [p]).map((r) => r.id),
    ).toEqual(["b"]);
  });

  it("contains matches a row holding several tags", () => {
    expect(
      applyFilter(rows, cond("m", "contains", "red"), [p]).map((r) => r.id),
    ).toEqual(["a", "b"]);
  });

  it("does_not_contain excludes rows holding the tag and empties", () => {
    expect(
      applyFilter(rows, cond("m", "does_not_contain", "red"), [p]).map(
        (r) => r.id,
      ),
    ).toEqual([]);
  });
});

describe("filtering: date", () => {
  const p = prop("d", "date");
  const rows = [
    row("a", "V1", { d: { start: "2026-01-01" } }),
    row("b", "V2", { d: { start: "2026-06-01" } }),
    row("c", "V3", {}),
  ];

  it("compares by time", () => {
    expect(
      applyFilter(rows, cond("d", "is_after", { start: "2026-03-01" }), [
        p,
      ]).map((r) => r.id),
    ).toEqual(["b"]);
    expect(
      applyFilter(rows, cond("d", "is_before", { start: "2026-03-01" }), [
        p,
      ]).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("is matches the same instant", () => {
    expect(
      applyFilter(rows, cond("d", "is", { start: "2026-01-01" }), [p]).map(
        (r) => r.id,
      ),
    ).toEqual(["a"]);
  });

  it("never matches an empty cell", () => {
    for (const op of [
      "is",
      "is_before",
      "is_after",
      "is_on_or_before",
      "is_on_or_after",
    ] as const) {
      expect(
        applyFilter(rows, cond("d", op, { start: "2026-01-01" }), [p]).map(
          (r) => r.id,
        ),
        op,
      ).not.toContain("c");
    }
  });

  it("includes the boundary for on_or_ operators", () => {
    expect(
      applyFilter(rows, cond("d", "is_on_or_after", { start: "2026-01-01" }), [
        p,
      ]).map((r) => r.id),
    ).toEqual(["a", "b"]);
  });
});

describe("filtering: a deleted property does not hide rows", () => {
  it("keeps every row when the condition references an unknown property", () => {
    // Treating a dangling reference as "no match" would look like data loss.
    const rows = [row("a", "V1", { t: "x" }), row("b", "V2", {})];
    expect(applyFilter(rows, cond("gone", "is_empty"), [])).toHaveLength(2);
    expect(applyFilter(rows, cond("gone", "contains", "x"), [])).toHaveLength(
      2,
    );
  });
});

describe("filtering: groups", () => {
  const t = prop("t", "text");
  const n = prop("n", "number");
  const rows = [
    row("a", "V1", { t: "apple", n: 1 }),
    row("b", "V2", { t: "banana", n: 5 }),
    row("c", "V3", { t: "apple", n: 9 }),
  ];

  it("and requires every condition", () => {
    const filter = group("and", [cond("t", "is", "apple"), cond("n", "gt", 5)]);
    expect(applyFilter(rows, filter, [t, n]).map((r) => r.id)).toEqual(["c"]);
  });

  it("or requires any condition", () => {
    const filter = group("or", [cond("t", "is", "banana"), cond("n", "gt", 5)]);
    expect(applyFilter(rows, filter, [t, n]).map((r) => r.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("an empty group matches everything, so a half-built filter is harmless", () => {
    expect(applyFilter(rows, group("and", []), [t])).toHaveLength(3);
    expect(applyFilter(rows, group("or", []), [t])).toHaveLength(3);
  });

  it("nests", () => {
    const filter = group("and", [
      cond("t", "is", "apple"),
      group("or", [cond("n", "lt", 5), cond("n", "gt", 8)]),
    ]);
    expect(applyFilter(rows, filter, [t, n]).map((r) => r.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("stops descending past the depth limit and keeps the row", () => {
    // A deeper tree can be built by a misbehaving client; it must not be walked
    // without bound, and must not hide rows either.
    let filter: FilterGroup = group("and", [cond("t", "is", "nothing")]);
    for (let i = 0; i < MAX_FILTER_DEPTH + 3; i++) {
      filter = group("and", [filter]);
    }
    expect(applyFilter(rows, filter, [t])).toHaveLength(3);
  });

  it("matchesFilter agrees with applyFilter", () => {
    const filter = cond("t", "is", "apple");
    for (const r of rows) {
      expect(matchesFilter(r, filter, [t])).toBe(
        applyFilter([r], filter, [t]).length === 1,
      );
    }
  });

  it("returns a copy, leaving the input untouched", () => {
    const input = [...rows];
    applyFilter(input, cond("t", "is", "apple"), [t]);
    expect(input).toHaveLength(3);
  });
});

// ------------------------------------------------------------------ sorting

describe("sorting", () => {
  const t = prop("t", "text");
  const n = prop("n", "number");
  const options = [
    opt("o1", "Low", "V1"),
    opt("o2", "Mid", "V2"),
    opt("o3", "High", "V3"),
  ];
  const s = prop("s", "select", options);

  it("sorts numbers numerically", () => {
    const rows = [
      row("a", "V1", { n: 10 }),
      row("b", "V2", { n: 2 }),
      row("c", "V3", { n: 33 }),
    ];
    expect(
      applySort(rows, [{ propId: "n", direction: "asc" }], [n]).map(
        (r) => r.id,
      ),
    ).toEqual(["b", "a", "c"]);
  });

  it("sorts descending", () => {
    const rows = [row("a", "V1", { n: 1 }), row("b", "V2", { n: 9 })];
    expect(
      applySort(rows, [{ propId: "n", direction: "desc" }], [n]).map(
        (r) => r.id,
      ),
    ).toEqual(["b", "a"]);
  });

  it("sorts text case-insensitively and predictably", () => {
    const rows = [
      row("a", "V1", { t: "banana" }),
      row("b", "V2", { t: "Apple" }),
      row("c", "V3", { t: "cherry" }),
    ];
    expect(
      applySort(rows, [{ propId: "t", direction: "asc" }], [t]).map(
        (r) => r.id,
      ),
    ).toEqual(["b", "a", "c"]);
  });

  it("sorts select by the option order, not alphabetically", () => {
    // The user arranged the options; that order is the meaningful one.
    const rows = [
      row("a", "V1", { s: "o3" }),
      row("b", "V2", { s: "o1" }),
      row("c", "V3", { s: "o2" }),
    ];
    expect(
      applySort(rows, [{ propId: "s", direction: "asc" }], [s]).map(
        (r) => r.id,
      ),
    ).toEqual(["b", "c", "a"]);
  });

  it("puts empty values last in BOTH directions", () => {
    // Sorting blanks first when ascending would bury the rows that have data.
    const rows = [
      row("a", "V1", { n: 5 }),
      row("b", "V2", {}),
      row("c", "V3", { n: 1 }),
    ];
    expect(
      applySort(rows, [{ propId: "n", direction: "asc" }], [n]).map(
        (r) => r.id,
      ),
    ).toEqual(["c", "a", "b"]);
    expect(
      applySort(rows, [{ propId: "n", direction: "desc" }], [n]).map(
        (r) => r.id,
      ),
    ).toEqual(["a", "c", "b"]);
  });

  it("falls back to the row order key when values tie", () => {
    // Deterministic, so rows do not shuffle between renders.
    const rows = [
      row("a", "V2", { n: 1 }),
      row("b", "V1", { n: 1 }),
      row("c", "V3", { n: 1 }),
    ];
    const first = applySort(rows, [{ propId: "n", direction: "asc" }], [n]).map(
      (r) => r.id,
    );
    expect(first).toEqual(["b", "a", "c"]);
    // Sorting the result again must not change it.
    expect(
      applySort(
        first.map((id) => rows.find((r) => r.id === id)!),
        [{ propId: "n", direction: "asc" }],
        [n],
      ).map((r) => r.id),
    ).toEqual(first);
  });

  it("applies multiple sorts in order", () => {
    const rows = [
      row("a", "V1", { t: "same", n: 2 }),
      row("b", "V2", { t: "same", n: 1 }),
      row("c", "V3", { t: "other", n: 9 }),
    ];
    const sorts: SortRule[] = [
      { propId: "t", direction: "asc" },
      { propId: "n", direction: "asc" },
    ];
    expect(applySort(rows, sorts, [t, n]).map((r) => r.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("no sorts returns the rows unchanged", () => {
    const rows = [row("a", "V1", { n: 2 }), row("b", "V2", { n: 1 })];
    expect(applySort(rows, [], [n]).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("ignores a sort on a deleted property", () => {
    const rows = [row("a", "V2", { n: 1 }), row("b", "V1", { n: 9 })];
    // With no resolvable property the comparison is 0, so the order key decides.
    expect(
      applySort(rows, [{ propId: "gone", direction: "asc" }], [n]).map(
        (r) => r.id,
      ),
    ).toEqual(["b", "a"]);
  });

  it("leaves the input array untouched", () => {
    const rows = [row("a", "V1", { n: 2 }), row("b", "V2", { n: 1 })];
    const before = rows.map((r) => r.id);
    applySort(rows, [{ propId: "n", direction: "asc" }], [n]);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

// ----------------------------------------------------------------- grouping

describe("grouping", () => {
  const options = [
    opt("o1", "Todo", "V1", "blue"),
    opt("o2", "Done", "V2", "green"),
  ];
  const s = prop("s", "select", options);

  it("creates one bucket per option, in option order", () => {
    const rows = [row("a", "V1", { s: "o2" }), row("b", "V2", { s: "o1" })];
    const groups = applyGroup(rows, "s", [s]);
    expect(groups.map((g) => g.key)).toEqual(["o1", "o2", null]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["b"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("puts rows with no value in a trailing bucket instead of dropping them", () => {
    // A card must not vanish from a board because its status is unset.
    const rows = [row("a", "V1", {}), row("b", "V2", { s: "o1" })];
    const groups = applyGroup(rows, "s", [s]);
    expect(groups[groups.length - 1].key).toBeNull();
    expect(groups[groups.length - 1].rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("can hide empty buckets", () => {
    const rows = [row("a", "V1", { s: "o2" })];
    const groups = applyGroup(rows, "s", [s], { hideEmpty: true });
    expect(groups.filter((g) => g.key !== null).map((g) => g.key)).toEqual([
      "o2",
    ]);
  });

  it("places a multi-select row in every matching bucket", () => {
    const m = prop("m", "multi-select", options);
    const rows = [row("a", "V1", { m: ["o1", "o2"] })];
    const groups = applyGroup(rows, "m", [m]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["a"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["a"]);
    expect(groups[2].rows).toHaveLength(0);
  });

  it("falls back to the ungrouped bucket for an unknown option id", () => {
    const rows = [row("a", "V1", { s: "deleted-option" })];
    const groups = applyGroup(rows, "s", [s]);
    expect(groups[groups.length - 1].rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns nothing when the property cannot be grouped by", () => {
    const t = prop("t", "text");
    expect(applyGroup([row("a", "V1", { t: "x" })], "t", [t])).toEqual([]);
    expect(applyGroup([], undefined, [s])).toEqual([]);
  });

  it("carries option colours through, for the board's column headers", () => {
    const groups = applyGroup([], "s", [s]);
    expect(groups[0].color).toBe("blue");
  });

  it("can omit the ungrouped bucket", () => {
    const groups = applyGroup([row("a", "V1", {})], "s", [s], {
      includeUngrouped: false,
    });
    expect(groups.some((g) => g.key === null)).toBe(false);
    // The row is then simply absent, which is why the default includes it.
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(0);
  });
});

// ----------------------------------------------------------------- pipeline

describe("selectRows", () => {
  const t = prop("t", "text");
  const n = prop("n", "number");

  it("filters then sorts", () => {
    const rows = [
      row("a", "V1", { t: "keep", n: 3 }),
      row("b", "V2", { t: "drop", n: 1 }),
      row("c", "V3", { t: "keep", n: 2 }),
    ];
    const result = selectRows(
      rows,
      cond("t", "is", "keep"),
      [{ propId: "n", direction: "asc" }],
      [t, n],
    );
    expect(result.map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("with no filter and no sorts returns every row in order-key order", () => {
    const rows = [row("a", "V2", {}), row("b", "V1", {})];
    expect(selectRows(rows, undefined, [], [t]).map((r) => r.id)).toEqual([
      "b",
      "a",
    ]);
  });
});
