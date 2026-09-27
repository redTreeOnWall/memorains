import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildInitialDatabaseState, DatabaseBinding } from "./model";
import { intToKey } from "./fractionalIndex";
import {
  PROP_PREFIX,
  ROW_ORDER_KEY,
  isTextPropType,
  type PropType,
} from "./types";

/**
 * The storage policy this document type is built on:
 *
 * - `title` / `text`  -> `Y.Text`, character-merged so concurrent edits all survive
 * - everything else   -> a discrete value (`number`, `boolean`, option id,
 *                        date object, or a `Y.Map` set of option ids), which is
 *                        last-write-wins between concurrent editors
 *
 * These tests exist to make that policy explicit and to fail loudly if it is ever
 * changed by accident, because the consequences are silent: storing a `number` in
 * a `Y.Text` merges `43` and `50` into `"4350"`, which still parses as a number
 * while being a value neither user typed.
 */

const makeBinding = () => {
  const yDoc = new Y.Doc();
  const binding = new DatabaseBinding(yDoc, () => {});
  return { yDoc, binding };
};

/** All property types, so the policy can be asserted across every one. */
const ALL_TYPES: PropType[] = [
  "title",
  "text",
  "number",
  "checkbox",
  "url",
  "email",
  "phone",
  "select",
  "multi-select",
  "date",
];

describe("storage policy: text types are Y.Text, everything else is discrete", () => {
  it("stores title and text as Y.Text", () => {
    const { binding } = makeBinding();
    for (const type of ["title", "text"] as PropType[]) {
      const propId = binding.addProperty(`p-${type}`, type);
      const rowId = binding.addRow();
      binding.setValue(rowId, propId, "hello");

      const row = binding
        .getRows()
        .find((candidate) => candidate.id === rowId)!;
      expect(
        row.values[propId],
        `${type} must be stored as Y.Text`,
      ).toBeInstanceOf(Y.Text);
      expect(binding.getTextString(row, propId)).toBe("hello");
    }
  });

  it("never stores a discrete type as Y.Text", () => {
    const { binding } = makeBinding();
    const samples: Partial<Record<PropType, unknown>> = {
      number: 42,
      checkbox: true,
      url: "https://example.com",
      email: "a@b.c",
      phone: "123",
      select: "opt-1",
      date: { start: "2026-01-01" },
    };

    for (const [type, sample] of Object.entries(samples) as [
      PropType,
      unknown,
    ][]) {
      const propId = binding.addProperty(`p-${type}`, type);
      const rowId = binding.addRow();
      binding.setValue(rowId, propId, sample);

      const row = binding
        .getRows()
        .find((candidate) => candidate.id === rowId)!;
      expect(isTextPropType(type)).toBe(false);
      expect(
        row.values[propId],
        `${type} must not be stored as Y.Text`,
      ).not.toBeInstanceOf(Y.Text);
    }
  });

  it("stores multi-select as one row key per option", () => {
    // A `Y.Map` would be the obvious choice, but two peers concurrently creating
    // a nested map at the same key loses one of them along with its contents.
    // Separate keys per option merge correctly instead.
    const { binding } = makeBinding();
    const propId = binding.addProperty("tags", "multi-select");
    const rowId = binding.addRow();
    binding.toggleMultiSelect(rowId, propId, "a");
    binding.toggleMultiSelect(rowId, propId, "b");

    const row = binding.getRows().find((candidate) => candidate.id === rowId)!;
    expect(row.values[propId]).toEqual(["a", "b"]);

    // And the raw storage really is one key per option.
    const raw = binding.yDoc.getMap("db_rows").get(rowId) as Y.Map<unknown>;
    expect(raw.get(`p:${propId}:a`)).toBe(true);
    expect(raw.get(`p:${propId}:b`)).toBe(true);
  });

  it("covers every property type with an explicit expectation", () => {
    const expected: Record<PropType, "text" | "discrete"> = {
      title: "text",
      text: "text",
      number: "discrete",
      checkbox: "discrete",
      url: "discrete",
      email: "discrete",
      phone: "discrete",
      select: "discrete",
      "multi-select": "discrete",
      date: "discrete",
    };
    for (const type of ALL_TYPES) {
      expect(isTextPropType(type) ? "text" : "discrete", type).toBe(
        expected[type],
      );
    }
  });
});

describe("namespace separation on a row", () => {
  it("prefixes property values so they cannot collide with framework keys", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("Notes", "text");
    const rowId = binding.addRow();
    binding.setValue(rowId, propId, "written");

    // Read the raw row structure, bypassing the mapping.
    const raw = binding.yDoc.getMap("db_rows").get(rowId) as Y.Map<unknown>;
    expect(raw.get(ROW_ORDER_KEY)).toBeTypeOf("string");
    expect(raw.get(`${PROP_PREFIX}${propId}`)).toBeInstanceOf(Y.Text);
    // The row's own sort key must never be shadowed by a property value.
    expect(raw.get("order")).toBe(raw.get(ROW_ORDER_KEY));
  });

  it("exposes values keyed by propId, not by the prefixed storage key", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("Notes", "text");
    const rowId = binding.addRow();
    binding.setValue(rowId, propId, "content");

    const row = binding.getRows().find((candidate) => candidate.id === rowId)!;
    expect(Object.keys(row.values)).toContain(propId);
    expect(
      Object.keys(row.values).some((key) => key.startsWith(PROP_PREFIX)),
    ).toBe(false);
  });
});

describe("empty means absent", () => {
  it("does not store empty values, so is_empty filtering is correct", () => {
    const { binding } = makeBinding();
    const numberId = binding.addProperty("n", "number");
    const textId = binding.addProperty("t", "text");
    const rowId = binding.addRow();

    binding.setValue(rowId, numberId, "");
    binding.setValue(rowId, numberId, null);
    binding.setValue(rowId, textId, "");

    const row = binding.getRows().find((candidate) => candidate.id === rowId)!;
    expect(row.values[numberId]).toBeUndefined();
    // A text cell that was set then cleared keeps its Y.Text but is empty.
    expect(binding.getTextString(row, textId)).toBe("");
  });

  it("keeps falsy-but-real values", () => {
    // 0 and false are values, not emptiness; dropping them would be data loss.
    const { binding } = makeBinding();
    const numberId = binding.addProperty("n", "number");
    const checkboxId = binding.addProperty("c", "checkbox");
    const rowId = binding.addRow();

    binding.setValue(rowId, numberId, 0);
    binding.setValue(rowId, checkboxId, false);

    const row = binding.getRows().find((candidate) => candidate.id === rowId)!;
    expect(row.values[numberId]).toBe(0);
    expect(row.values[checkboxId]).toBe(false);
  });
});

describe("concurrent edits", () => {
  const sync = (from: Y.Doc, to: Y.Doc) =>
    Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));

  /** Two bindings over copies of the same document. */
  const fork = (seed: DatabaseBinding) => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const update = Y.encodeStateAsUpdate(seed.yDoc);
    Y.applyUpdate(docA, update);
    Y.applyUpdate(docB, update);
    return {
      a: new DatabaseBinding(docA, () => {}),
      b: new DatabaseBinding(docB, () => {}),
      docA,
      docB,
    };
  };

  it("keeps both edits when two editors change the same text cell", () => {
    // The headline reason text cells are Y.Text.
    const seed = makeBinding();
    seed.binding.initIfEmpty();
    const textProp = seed.binding
      .getProperties()
      .find((p) => p.type === "text")!;
    const rowId = seed.binding.addRow();
    seed.binding.setValue(rowId, textProp.id, "Room 204");

    const { a, b, docA, docB } = fork(seed.binding);
    a.setText(rowId, textProp.id, "Room 204 - projector broken");
    b.setText(rowId, textProp.id, "Room 204 - needs 2 chairs");

    sync(docA, docB);
    sync(docB, docA);

    const textA = a.getTextString(
      a.getRows().find((r) => r.id === rowId)!,
      textProp.id,
    );
    const textB = b.getTextString(
      b.getRows().find((r) => r.id === rowId)!,
      textProp.id,
    );
    expect(textA).toBe(textB);
    expect(textA).toContain("projector broken");
    expect(textA).toContain("needs 2 chairs");
  });

  it("converges a concurrently edited number to a single value", () => {
    // Last-write-wins: both peers agree, and the result is one of the two inputs
    // rather than a concatenation.
    const seed = makeBinding();
    const numberProp = seed.binding.addProperty("age", "number");
    const rowId = seed.binding.addRow();
    seed.binding.setValue(rowId, numberProp, 1);

    const { a, b, docA, docB } = fork(seed.binding);
    a.setValue(rowId, numberProp, 43);
    b.setValue(rowId, numberProp, 50);
    sync(docA, docB);
    sync(docB, docA);

    const valueA = a.getRows().find((r) => r.id === rowId)!.values[numberProp];
    const valueB = b.getRows().find((r) => r.id === rowId)!.values[numberProp];
    expect(valueA).toBe(valueB);
    expect([43, 50]).toContain(valueA);
    expect(valueA).not.toBe("4350");
  });

  it("converges a concurrently edited select to one valid option", () => {
    const seed = makeBinding();
    const optionProp = seed.binding.addProperty("role", "select");
    const optA = seed.binding.addOption(optionProp, "Admin");
    const optB = seed.binding.addOption(optionProp, "Editor");
    const rowId = seed.binding.addRow();

    const { a, b, docA, docB } = fork(seed.binding);
    a.setValue(rowId, optionProp, optA);
    b.setValue(rowId, optionProp, optB);
    sync(docA, docB);
    sync(docB, docA);

    const value = a.getRows().find((r) => r.id === rowId)!.values[optionProp];
    expect([optA, optB]).toContain(value);
  });

  it("unions multi-select tags added concurrently", () => {
    // The reason multi-select uses one key per option rather than a nested map.
    const seed = makeBinding();
    const tagProp = seed.binding.addProperty("tags", "multi-select");
    const rowId = seed.binding.addRow();

    const { a, b, docA, docB } = fork(seed.binding);
    a.toggleMultiSelect(rowId, tagProp, "tag-a");
    b.toggleMultiSelect(rowId, tagProp, "tag-b");
    sync(docA, docB);
    sync(docB, docA);

    const fromA = a.getRows().find((r) => r.id === rowId)!.values[
      tagProp
    ] as string[];
    const fromB = b.getRows().find((r) => r.id === rowId)!.values[
      tagProp
    ] as string[];
    expect([...fromA].sort()).toEqual(["tag-a", "tag-b"]);
    expect([...fromB].sort()).toEqual(["tag-a", "tag-b"]);
  });

  it("unions multi-select tags added to an empty cell concurrently", () => {
    // The dangerous case: both peers create the value from nothing. A nested
    // `Y.Map` lost one tag here; disjoint keys keep both.
    const seed = makeBinding();
    const tagProp = seed.binding.addProperty("tags", "multi-select");
    const rowId = seed.binding.addRow();
    // Deliberately never touch the cell before forking.

    const { a, b, docA, docB } = fork(seed.binding);
    a.toggleMultiSelect(rowId, tagProp, "first");
    b.toggleMultiSelect(rowId, tagProp, "second");
    sync(docA, docB);
    sync(docB, docA);

    const values = a.getRows().find((r) => r.id === rowId)!.values[
      tagProp
    ] as string[];
    expect([...values].sort()).toEqual(["first", "second"]);
  });

  it("converges a concurrently edited date to one valid date", () => {
    const seed = makeBinding();
    const dateProp = seed.binding.addProperty("due", "date");
    const rowId = seed.binding.addRow();

    const { a, b, docA, docB } = fork(seed.binding);
    a.setValue(rowId, dateProp, { start: "2026-02-02" });
    b.setValue(rowId, dateProp, { start: "2026-03-03" });
    sync(docA, docB);
    sync(docB, docA);

    const value = a.getRows().find((r) => r.id === rowId)!.values[dateProp] as {
      start: string;
    };
    expect(["2026-02-02", "2026-03-03"]).toContain(value.start);
  });
});

describe("schema", () => {
  it("creates a title and a text property for a new document", () => {
    const { binding } = makeBinding();
    // The two framework keys on a row must be distinguishable from properties.
    const frameworkKeys = [ROW_ORDER_KEY];
    for (const key of frameworkKeys) {
      expect(key.startsWith(PROP_PREFIX)).toBe(false);
    }

    binding.initIfEmpty();
    const props = binding.getProperties();
    expect(props.filter((p) => p.type === "title")).toHaveLength(1);
    expect(props.some((p) => p.type === "text")).toBe(true);
    expect(binding.getViews()).toHaveLength(1);
  });

  it("does not touch an existing database", () => {
    const { binding } = makeBinding();
    const custom = binding.addProperty("Mine", "number");
    binding.initIfEmpty();
    expect(binding.getProperties().map((p) => p.id)).toContain(custom);
    expect(binding.getProperties()).toHaveLength(1);
  });

  it("renaming a property preserves its values (ids, not names, are keys)", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("Name", "text");
    const rowId = binding.addRow();
    binding.setValue(rowId, propId, "Alice");

    binding.renameProperty(propId, "Full name");

    const row = binding.getRows().find((r) => r.id === rowId)!;
    expect(row.values[propId]).toBeDefined();
    expect(binding.getTextString(row, propId)).toBe("Alice");
  });

  it("deleting a property removes its values and view references", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("Temp", "text");
    const rowId = binding.addRow();
    binding.setValue(rowId, propId, "value");
    const viewId = binding.getViews()[0]?.id ?? binding.addView("V", "table");
    binding.toggleViewProperty(viewId, propId);

    binding.deleteProperty(propId);

    expect(binding.getProperty(propId)).toBeUndefined();
    const row = binding.getRows().find((r) => r.id === rowId)!;
    expect(row.values[propId]).toBeUndefined();
    expect(
      binding.getViews().every((view) => !view.visibleProps.includes(propId)),
    ).toBe(true);
  });

  it("a property with no visible list means every property is shown", () => {
    const { binding } = makeBinding();
    binding.addProperty("A", "text");
    binding.addProperty("B", "text");
    expect(binding.getViews()[0]?.visibleProps ?? []).toEqual([]);
  });
});

describe("rows", () => {
  it("orders rows by their own key, not by container position", () => {
    const { binding } = makeBinding();
    const first = binding.addRow();
    const second = binding.addRow();
    const third = binding.addRow();
    expect(binding.getRows().map((r) => r.id)).toEqual([first, second, third]);

    // Move the last row to the front and re-read.
    binding.moveRow(third, 0);
    expect(binding.getRows().map((r) => r.id)).toEqual([third, first, second]);
  });

  it("never duplicates a row across repeated moves", () => {
    const { binding } = makeBinding();
    const ids = Array.from({ length: 12 }, () => binding.addRow());
    for (let i = 0; i < 60; i++) {
      const target = i % ids.length;
      binding.moveRow(ids[i % ids.length], target);
      const rows = binding.getRows();
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
      expect(rows).toHaveLength(ids.length);
    }
  });

  it("deletes by id", () => {
    const { binding } = makeBinding();
    const keep = binding.addRow();
    const remove = binding.addRow();
    binding.deleteRow(remove);
    expect(binding.getRows().map((r) => r.id)).toEqual([keep]);
  });

  it("repairs unsorted or duplicate order keys", () => {
    const { binding } = makeBinding();
    const a = binding.addRow();
    const b = binding.addRow();
    const c = binding.addRow();

    // Simulate a document written by a broken client.
    binding.yDoc.transact(() => {
      const rows = binding.yDoc.getMap("db_rows") as Y.Map<Y.Map<unknown>>;
      rows.get(a)!.set(ROW_ORDER_KEY, "same");
      rows.get(b)!.set(ROW_ORDER_KEY, "same");
      rows.get(c)!.set(ROW_ORDER_KEY, "same");
    });

    expect(binding.repairOrderIfNeeded()).toBe(true);
    const rows = binding.getRows();
    expect(new Set(rows.map((r) => r.order)).size).toBe(3);
    expect(binding.repairOrderIfNeeded()).toBe(false);
  });
});

describe("reordering by neighbour (what the drag UI calls)", () => {
  it("moves a column to the end when the anchor is null", () => {
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "text");
    const c = binding.addProperty("C", "text");
    binding.movePropertyBefore(a, null);
    expect(binding.getProperties().map((p) => p.id)).toEqual([b, c, a]);
  });

  it("places a column immediately before the target column", () => {
    // The off-by-one the neighbour form exists to prevent: `moveProperty` counts
    // in the list *without* the moved column.
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "text");
    const c = binding.addProperty("C", "text");
    const d = binding.addProperty("D", "text");

    // Removing "a" leaves b, c, d; "before c" is index 1.
    binding.movePropertyBefore(a, c);
    expect(binding.getProperties().map((p) => p.id)).toEqual([b, a, c, d]);
  });

  it("moves a column to the front", () => {
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "text");
    const c = binding.addProperty("C", "text");
    binding.movePropertyBefore(c, a);
    expect(binding.getProperties().map((p) => p.id)).toEqual([c, a, b]);
  });

  it("is a no-op when the anchor is the column itself", () => {
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "text");
    let writes = 0;
    binding.yDoc.on("update", () => writes++);
    binding.movePropertyBefore(a, a);
    expect(binding.getProperties().map((p) => p.id)).toEqual([a, b]);
    expect(writes).toBe(0);
  });

  it("ignores an anchor that no longer exists", () => {
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "text");
    binding.movePropertyBefore(a, "gone");
    expect(binding.getProperties().map((p) => p.id)).toEqual([a, b]);
  });

  it("moves a row immediately before another row", () => {
    const { binding } = makeBinding();
    const a = binding.addRow();
    const b = binding.addRow();
    const c = binding.addRow();
    binding.moveRowBefore(a, c);
    expect(binding.getRows().map((r) => r.id)).toEqual([b, a, c]);
  });

  it("moves a row to the front and to the end with null", () => {
    const { binding } = makeBinding();
    const a = binding.addRow();
    const b = binding.addRow();
    const c = binding.addRow();

    // "Before the first row" is how the front is expressed.
    binding.moveRowBefore(c, a);
    expect(binding.getRows().map((r) => r.id)).toEqual([c, a, b]);

    binding.moveRowBefore(c, null);
    expect(binding.getRows().map((r) => r.id)).toEqual([a, b, c]);
  });

  it("keeps every row when a move is repeated across the same slots", () => {
    // The drag UI can call this many times per second; a lost row would be data
    // loss, not a cosmetic glitch.
    const { binding } = makeBinding();
    const ids = Array.from({ length: 8 }, () => binding.addRow());
    for (let i = 0; i < 80; i++) {
      const dragged = ids[i % ids.length];
      const anchor = ids[(i * 3 + 1) % ids.length];
      binding.moveRowBefore(dragged, anchor);
      const rows = binding.getRows();
      expect(rows).toHaveLength(ids.length);
      expect(new Set(rows.map((r) => r.id)).size).toBe(ids.length);
      expect(new Set(rows.map((r) => r.order)).size).toBe(ids.length);
    }
  });

  it("converges when two peers drag different rows at once", () => {
    // The whole point of reordering by key: two moves touch disjoint fields, so
    // both survive. `Y.Array` move semantics cannot promise this.
    const sync = (from: Y.Doc, to: Y.Doc) =>
      Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));

    const seed = makeBinding();
    const a = seed.binding.addRow();
    seed.binding.addRow();
    const c = seed.binding.addRow();

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const update = Y.encodeStateAsUpdate(seed.yDoc);
    Y.applyUpdate(docA, update);
    Y.applyUpdate(docB, update);
    const bindingA = new DatabaseBinding(docA, () => {});
    const bindingB = new DatabaseBinding(docB, () => {});
    try {
      bindingA.moveRowBefore(c, null); // A sends c to the end
      bindingB.moveRowBefore(a, c); // B sends a just before c's old position

      sync(docA, docB);
      sync(docB, docA);

      const orderA = bindingA.getRows().map((r) => r.id);
      const orderB = bindingB.getRows().map((r) => r.id);
      expect(orderA).toEqual(orderB);
      expect(new Set(orderA).size).toBe(3);
    } finally {
      bindingA.destroy();
      bindingB.destroy();
    }
  });
});

describe("duplicating a row", () => {
  it("copies every value and places the copy after the original", () => {
    const { binding } = makeBinding();
    const title = binding.addProperty("Name", "title");
    const score = binding.addProperty("Score", "number");
    const tags = binding.addProperty("Tags", "multi-select");
    const tag = binding.addOption(tags, "hot")!;

    const first = binding.addRow();
    const source = binding.addRow();
    const last = binding.addRow();
    binding.setValue(source, title, "Widget");
    binding.setValue(source, score, 42);
    binding.toggleMultiSelect(source, tags, tag);

    const copy = binding.duplicateRow(source)!;

    expect(binding.getRows().map((r) => r.id)).toEqual([
      first,
      source,
      copy,
      last,
    ]);
    const copied = binding.getRows().find((r) => r.id === copy)!;
    expect(binding.getTextString(copied, title)).toBe("Widget");
    expect(copied.values[score]).toBe(42);
    expect(copied.values[tags]).toEqual([tag]);
    expect(copied.order).not.toBe(
      binding.getRows().find((r) => r.id === source)!.order,
    );
  });

  it("gives the copy its own text cell, not the original's", () => {
    // Sharing one `Y.Text` between two rows would make editing one edit the other.
    const { binding } = makeBinding();
    const title = binding.addProperty("Name", "title");
    const source = binding.addRow();
    binding.setValue(source, title, "original");

    const copy = binding.duplicateRow(source)!;
    binding.setText(copy, title, "changed");

    const sourceRow = binding.getRows().find((r) => r.id === source)!;
    const copyRow = binding.getRows().find((r) => r.id === copy)!;
    expect(binding.getTextString(sourceRow, title)).toBe("original");
    expect(binding.getTextString(copyRow, title)).toBe("changed");
  });

  it("does not share a date object between the two rows", () => {
    const { binding } = makeBinding();
    const due = binding.addProperty("Due", "date");
    const source = binding.addRow();
    binding.setValue(source, due, { start: "2026-01-01", includeTime: false });

    const copy = binding.duplicateRow(source)!;
    binding.setValue(copy, due, { start: "2027-02-02", includeTime: false });

    const sourceRow = binding.getRows().find((r) => r.id === source)!;
    expect((sourceRow.values[due] as { start: string }).start).toBe(
      "2026-01-01",
    );
  });

  it("returns null for a row that no longer exists", () => {
    const { binding } = makeBinding();
    binding.addRow();
    expect(binding.duplicateRow("gone")).toBeNull();
  });

  it("keeps every row order key unique after many copies", () => {
    const { binding } = makeBinding();
    const title = binding.addProperty("Name", "title");
    let id = binding.addRow();
    binding.setValue(id, title, "x");
    for (let i = 0; i < 40; i++) id = binding.duplicateRow(id)!;
    const rows = binding.getRows();
    expect(rows).toHaveLength(41);
    expect(new Set(rows.map((r) => r.order)).size).toBe(41);
  });

  it("renumbers the neighbourhood when the gap is exhausted", () => {
    // Duplicating into a gap that cannot be split must repair the surrounding run
    // rather than handing the copy a `order` key its neighbour already holds.
    const { binding } = makeBinding();
    const a = binding.addRow();
    const b = binding.addRow();

    // Force `b` immediately after `a` in key space, leaving no integer between.
    binding.yDoc.transact(() => {
      const rows = binding.yDoc.getMap("db_rows") as Y.Map<Y.Map<unknown>>;
      rows.get(a)!.set(ROW_ORDER_KEY, intToKey(1000n));
      rows.get(b)!.set(ROW_ORDER_KEY, intToKey(1001n));
    });
    expect(binding.getRows().map((r) => r.id)).toEqual([a, b]);

    const copy = binding.duplicateRow(a)!;

    const rows = binding.getRows();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.order)).size).toBe(3);
    // Order is still meaningful: the copy sits directly under its source.
    expect(rows.map((r) => r.id)).toEqual([a, copy, b]);
    // And no duplicate keys were left for the repair pass to find.
    expect(binding.repairOrderIfNeeded()).toBe(false);
  });
});

describe("options", () => {
  it("renaming an option keeps the rows that use it (values hold the id)", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("role", "select");
    const optId = binding.addOption(propId, "Admin")!;
    const rowId = binding.addRow();
    binding.setValue(rowId, propId, optId);

    binding.renameOption(propId, optId, "Administrator");

    const value = binding.getRows().find((r) => r.id === rowId)!.values[propId];
    expect(value).toBe(optId);
    expect(binding.getProperty(propId)!.options[0].name).toBe("Administrator");
  });

  it("deleting an option clears it from rows", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("role", "select");
    const optId = binding.addOption(propId, "Admin")!;
    const rowId = binding.addRow();
    binding.setValue(rowId, propId, optId);

    binding.deleteOption(propId, optId);

    expect(
      binding.getRows().find((r) => r.id === rowId)!.values[propId],
    ).toBeUndefined();
  });

  it("deleting an option removes it from a multi-select cell", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("tags", "multi-select");
    const keep = binding.addOption(propId, "Keep")!;
    const remove = binding.addOption(propId, "Remove")!;
    const rowId = binding.addRow();
    binding.toggleMultiSelect(rowId, propId, keep);
    binding.toggleMultiSelect(rowId, propId, remove);

    binding.deleteOption(propId, remove);

    const stored = binding.getRows().find((r) => r.id === rowId)!.values[
      propId
    ] as string[];
    expect(stored).toEqual([keep]);
  });

  it("toggling a multi-select option twice removes it", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("tags", "multi-select");
    const rowId = binding.addRow();
    binding.toggleMultiSelect(rowId, propId, "a");
    binding.toggleMultiSelect(rowId, propId, "a");

    expect(
      binding.getRows().find((r) => r.id === rowId)!.values[propId],
    ).toBeUndefined();
  });

  it("reorders options, which decides picker and board column order", () => {
    // What the options editor's drag calls. Option order is user data: it is the
    // order of a board's columns and how a select column sorts.
    const { binding } = makeBinding();
    const propId = binding.addProperty("role", "select");
    const a = binding.addOption(propId, "A")!;
    const b = binding.addOption(propId, "B")!;
    const c = binding.addOption(propId, "C")!;
    expect(binding.getProperty(propId)!.options.map((o) => o.id)).toEqual([
      a,
      b,
      c,
    ]);

    // "before the first option" is how the front is expressed; `null` means the end.
    binding.moveOptionBefore(propId, c, a);
    expect(binding.getProperty(propId)!.options.map((o) => o.id)).toEqual([
      c,
      a,
      b,
    ]);

    binding.moveOptionBefore(propId, c, null);
    expect(binding.getProperty(propId)!.options.map((o) => o.id)).toEqual([
      a,
      b,
      c,
    ]);
  });

  it("keeps option order keys unique across repeated moves", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("role", "select");
    const ids = Array.from(
      { length: 6 },
      (_, i) => binding.addOption(propId, `O${i}`)!,
    );
    for (let i = 0; i < 60; i++) {
      binding.moveOptionBefore(
        propId,
        ids[i % ids.length],
        ids[(i * 3 + 1) % ids.length],
      );
      const options = binding.getProperty(propId)!.options;
      expect(options).toHaveLength(ids.length);
      expect(new Set(options.map((o) => o.order)).size).toBe(ids.length);
    }
  });

  it("ignores a move whose anchor is gone or is the option itself", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("role", "select");
    const a = binding.addOption(propId, "A")!;
    const b = binding.addOption(propId, "B")!;

    binding.moveOptionBefore(propId, a, a);
    binding.moveOptionBefore(propId, a, "gone");

    expect(binding.getProperty(propId)!.options.map((o) => o.id)).toEqual([
      a,
      b,
    ]);
  });

  it("reordering options does not detach the rows that use them", () => {
    // Values hold `optId`s, so order is presentation only.
    const { binding } = makeBinding();
    const propId = binding.addProperty("role", "select");
    const a = binding.addOption(propId, "A")!;
    const b = binding.addOption(propId, "B")!;
    const rowId = binding.addRow();
    binding.setValue(rowId, propId, a);

    binding.moveOptionBefore(propId, a, null);

    expect(binding.getRows().find((r) => r.id === rowId)!.values[propId]).toBe(
      a,
    );
    expect(binding.getProperty(propId)!.options.map((o) => o.id)).toEqual([
      b,
      a,
    ]);
  });
});

describe("views", () => {
  it("always keeps at least one view", () => {
    const { binding } = makeBinding();
    binding.initIfEmpty();
    const only = binding.getViews()[0];
    binding.deleteView(only.id);
    expect(binding.getViews()).toHaveLength(1);
  });

  it("hiding a property materialises the visible list first", () => {
    // Without this, hiding one column would make every other column reappear,
    // because an empty list means "show all".
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "text");
    const viewId = binding.getViews()[0]?.id ?? binding.addView("V", "table");

    binding.toggleViewProperty(viewId, a);
    const view = binding.getViews().find((v) => v.id === viewId)!;
    expect(view.visibleProps).toEqual([b]);
  });
});

describe("initial state is created once, at document creation", () => {
  it("buildInitialDatabaseState produces the default schema and one view", () => {
    const state = buildInitialDatabaseState();
    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, new Uint8Array(state));
    const binding = new DatabaseBinding(yDoc, () => {});

    try {
      const properties = binding.getProperties();
      // Title + Status + Notes. The Status column is a plain `select` seeded with
      // three options, so a new database is usable without configuring anything.
      expect(properties.map((p) => p.type).sort()).toEqual([
        "select",
        "text",
        "title",
      ]);
      const status = properties.find((p) => p.type === "select")!;
      expect(status.options.map((option) => option.name)).toEqual([
        "Not started",
        "In progress",
        "Done",
      ]);
      expect(binding.getViews()).toHaveLength(1);
      expect(binding.getRows()).toHaveLength(0);
    } finally {
      binding.destroy();
    }
  });

  it("is idempotent, so opening the created document adds nothing", () => {
    // The regression: seeding when an editor mounts, rather than at creation,
    // produced two of every column and two views, because the editor sees the
    // Y.Doc before the stored state is loaded.
    const state = buildInitialDatabaseState();
    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, new Uint8Array(state));
    const binding = new DatabaseBinding(yDoc, () => {});

    try {
      const before = {
        properties: binding.getProperties().length,
        views: binding.getViews().length,
      };

      // What an editor would do on open — must be a no-op now.
      binding.initIfEmpty();

      expect(binding.getProperties()).toHaveLength(before.properties);
      expect(binding.getViews()).toHaveLength(before.views);
    } finally {
      binding.destroy();
    }
  });

  it("does not duplicate the schema when applied over an existing document", () => {
    // Simulates the race precisely: the stored state is applied *after* something
    // already wrote defaults, and `initIfEmpty` must not add a second set.
    const yDoc = new Y.Doc();
    const binding = new DatabaseBinding(yDoc, () => {});

    try {
      binding.initIfEmpty();
      const seeded = Y.encodeStateAsUpdate(yDoc);

      // A second client opening the same document runs the same path.
      const second = new Y.Doc();
      Y.applyUpdate(second, seeded);
      const secondBinding = new DatabaseBinding(second, () => {});
      try {
        secondBinding.initIfEmpty();
        expect(secondBinding.getProperties()).toHaveLength(3);
        expect(secondBinding.getViews()).toHaveLength(1);
      } finally {
        secondBinding.destroy();
      }
    } finally {
      binding.destroy();
    }
  });

  it("keeps a user's own columns when a second client opens the document", () => {
    const state = buildInitialDatabaseState();
    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, new Uint8Array(state));
    const binding = new DatabaseBinding(yDoc, () => {});

    try {
      binding.addProperty("Role", "select");
      binding.addView("List", "list");
      expect(binding.getProperties()).toHaveLength(4);
      expect(binding.getViews()).toHaveLength(2);

      // Merged into a fresh document, as a collaborator would receive it.
      const other = new Y.Doc();
      Y.applyUpdate(other, Y.encodeStateAsUpdate(yDoc));
      const otherBinding = new DatabaseBinding(other, () => {});
      try {
        otherBinding.initIfEmpty();
        expect(otherBinding.getProperties()).toHaveLength(4);
        expect(otherBinding.getViews()).toHaveLength(2);
      } finally {
        otherBinding.destroy();
      }
    } finally {
      binding.destroy();
    }
  });
});

describe("view filters, sorts and grouping", () => {
  /** A binding with a title, a number and a select, plus three rows. */
  const makeData = () => {
    const { binding } = makeBinding();
    const title = binding.addProperty("Name", "title");
    const score = binding.addProperty("Score", "number");
    const role = binding.addProperty("Role", "select");
    const admin = binding.addOption(role, "Admin")!;
    const editor = binding.addOption(role, "Editor")!;

    const a = binding.addRow();
    binding.setValue(a, title, "Alice");
    binding.setValue(a, score, 10);
    binding.setValue(a, role, admin);

    const b = binding.addRow();
    binding.setValue(b, title, "Bob");
    binding.setValue(b, score, 5);
    binding.setValue(b, role, editor);

    const c = binding.addRow();
    binding.setValue(c, title, "Carol");

    // `addProperty` alone does not create a view; make one so the tests operate on
    // a real view rather than an empty list.
    binding.addView("Table", "table");
    return { binding, title, score, role, admin, editor, a, b, c };
  };

  const viewIdOf = (binding: DatabaseBinding) => binding.getViews()[0].id;

  it("a new view has no filter and no sorts", () => {
    const { binding } = makeData();
    const view = binding.getViews()[0];
    expect(view.filter).toBeUndefined();
    expect(view.sorts).toEqual([]);
    expect(view.hideEmptyGroups).toBe(false);
    expect(binding.getViewRows(view.id)).toHaveLength(3);
  });

  it("filters rows for a view", () => {
    const { binding, score } = makeData();
    const viewId = viewIdOf(binding);

    binding.setViewFilter(viewId, {
      kind: "condition",
      propId: score,
      operator: "gt",
      value: 5,
    });

    const rows = binding.getViewRows(viewId);
    expect(rows).toHaveLength(1);
    expect(binding.getTextString(rows[0], binding.getTitleProperty()!.id)).toBe(
      "Alice",
    );
  });

  it("round-trips a filter through the document, as a collaborator would see it", () => {
    const { binding, score } = makeData();
    const viewId = viewIdOf(binding);
    binding.setViewFilter(viewId, {
      kind: "group",
      op: "and",
      children: [
        { kind: "condition", propId: score, operator: "gte", value: 5 },
      ],
    });

    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(binding.yDoc));
    const otherBinding = new DatabaseBinding(other, () => {});
    try {
      const filter = otherBinding
        .getViews()
        .find((v) => v.id === viewId)!.filter;
      expect(filter).toEqual({
        kind: "group",
        op: "and",
        children: [
          { kind: "condition", propId: score, operator: "gte", value: 5 },
        ],
      });
      expect(otherBinding.getViewRows(viewId).length).toBeGreaterThan(0);
    } finally {
      otherBinding.destroy();
    }
  });

  it("clearing a filter removes the key entirely", () => {
    const { binding, score } = makeData();
    const viewId = viewIdOf(binding);
    binding.setViewFilter(viewId, {
      kind: "condition",
      propId: score,
      operator: "gt",
      value: 5,
    });
    binding.setViewFilter(viewId, undefined);

    const raw = binding.yDoc.getMap("db_views").get(viewId) as Y.Map<unknown>;
    expect(raw.get("filter")).toBeUndefined();
    expect(binding.getViewRows(viewId)).toHaveLength(3);
  });

  it("sorts rows for a view", () => {
    const { binding, score } = makeData();
    const viewId = viewIdOf(binding);
    binding.setViewSorts(viewId, [{ propId: score, direction: "asc" }]);

    const rows = binding.getViewRows(viewId);
    // The two rows with a score come first, ascending; the unscored one is last.
    expect(rows.map((r) => r.values[score])).toEqual([5, 10, undefined]);
  });

  it("clearing sorts removes the key", () => {
    const { binding, score } = makeData();
    const viewId = viewIdOf(binding);
    binding.setViewSorts(viewId, [{ propId: score, direction: "asc" }]);
    binding.setViewSorts(viewId, []);

    const raw = binding.yDoc.getMap("db_views").get(viewId) as Y.Map<unknown>;
    expect(raw.get("sorts")).toBeUndefined();
    // Back to the row-order key, which is insertion order here.
    expect(binding.getViewRows(viewId).map((r) => r.id)).toEqual(
      binding.getRows().map((r) => r.id),
    );
  });

  it("groups rows by a select column", () => {
    const { binding, role, admin, editor, a, b, c } = makeData();
    const viewId = viewIdOf(binding);
    binding.setViewGroupBy(viewId, role);

    const groups = binding.getViewGroups(viewId);
    expect(groups.map((g) => g.key)).toEqual([admin, editor, null]);
    expect(groups[0].rows.map((r) => r.id)).toEqual([a]);
    expect(groups[1].rows.map((r) => r.id)).toEqual([b]);
    // The row with no role is in the trailing bucket, not dropped.
    expect(groups[2].rows.map((r) => r.id)).toEqual([c]);
  });

  it("a group filter also applies to the groups, so a board honours its filter", () => {
    const { binding, role, score, admin, a } = makeData();
    const viewId = viewIdOf(binding);
    binding.setViewGroupBy(viewId, role);
    binding.setViewFilter(viewId, {
      kind: "condition",
      propId: score,
      operator: "gt",
      value: 5,
    });

    const groups = binding.getViewGroups(viewId);
    const grouped = groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(grouped).toEqual([a]);
    expect(groups.find((g) => g.key === admin)!.rows.map((r) => r.id)).toEqual([
      a,
    ]);
  });

  it("can hide empty groups for a board", () => {
    const { binding, role } = makeData();
    const viewId = viewIdOf(binding);
    binding.setViewGroupBy(viewId, role);
    // Delete every row so all groups are empty.
    for (const row of binding.getRows()) binding.deleteRow(row.id);

    binding.setViewHideEmptyGroups(viewId, true);
    expect(
      binding.getViewGroups(viewId).filter((g) => g.key !== null),
    ).toHaveLength(0);

    binding.setViewHideEmptyGroups(viewId, false);
    expect(
      binding.getViewGroups(viewId).filter((g) => g.key !== null),
    ).toHaveLength(2);
  });

  it("groups come back empty when the view has no group-by", () => {
    const { binding } = makeData();
    expect(binding.getViewGroups(viewIdOf(binding))).toEqual([]);
  });

  it("deleting the grouped property clears the group-by", () => {
    const { binding, role } = makeData();
    const viewId = viewIdOf(binding);
    binding.setViewGroupBy(viewId, role);
    binding.deleteProperty(role);

    const view = binding.getViews().find((v) => v.id === viewId)!;
    expect(view.groupBy).toBeUndefined();
    // And a filter referencing it no longer hides rows, rather than hiding all.
    binding.setViewFilter(viewId, {
      kind: "condition",
      propId: role,
      operator: "is_empty",
    });
    expect(binding.getViewRows(viewId)).toHaveLength(3);
  });

  it("groups by an arbitrary property without changing the view's group-by", () => {
    // What the list view's drag uses: it needs rows bucketed by the property the
    // list is sorted on, and must not repoint the view's own grouping to do it.
    const { binding, role, admin, editor } = makeData();
    const viewId = viewIdOf(binding);
    expect(
      binding.getViews().find((v) => v.id === viewId)!.groupBy,
    ).toBeUndefined();

    const groups = binding.getViewRowGroups(viewId, role);
    expect(groups.map((g) => g.key)).toEqual([admin, editor, null]);

    // Reading groups this way is a pure read: the stored grouping is untouched.
    expect(
      binding.getViews().find((v) => v.id === viewId)!.groupBy,
    ).toBeUndefined();
  });

  it("buckets arbitrary groups through the view's filter, like the board does", () => {
    const { binding, role, score, admin, a } = makeData();
    const viewId = viewIdOf(binding);
    binding.setViewFilter(viewId, {
      kind: "condition",
      propId: score,
      operator: "gt",
      value: 5,
    });

    const groups = binding.getViewRowGroups(viewId, role);
    expect(groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual([a]);
    expect(groups.find((g) => g.key === admin)!.rows.map((r) => r.id)).toEqual([
      a,
    ]);
  });

  it("returns nothing for an unknown view", () => {
    const { binding, role } = makeData();
    expect(binding.getViewRowGroups("gone", role)).toEqual([]);
  });
});

describe("view naming is meaningful and unique", () => {
  it("derives the default name from the layout, not from a fixed string", () => {
    // The bug this fixes: a view called "Table" that shows a board.
    const { binding } = makeBinding();
    const tableId = binding.addView(undefined, "table");
    const listId = binding.addView(undefined, "list");
    const boardId = binding.addView(undefined, "board");

    const byId = (id: string) => binding.getViews().find((v) => v.id === id)!;
    expect(byId(tableId).name).toBe("Table");
    expect(byId(listId).name).toBe("List");
    expect(byId(boardId).name).toBe("Board");
  });

  it("makes repeated default names unique", () => {
    // Three views all called "List" are indistinguishable as tabs.
    const { binding } = makeBinding();
    binding.addView(undefined, "list");
    binding.addView(undefined, "list");
    binding.addView(undefined, "list");

    const names = binding.getViews().map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["List", "List 2", "List 3"]);
  });

  it("treats names differing only in case as duplicates", () => {
    const { binding } = makeBinding();
    binding.addView("Data", "table");
    binding.addView("data", "table");
    expect(binding.getViews().map((v) => v.name)).toEqual(["Data", "data 2"]);
  });

  it("renames an auto-named view when its layout changes", () => {
    const { binding } = makeBinding();
    const id = binding.addView(undefined, "table");
    binding.setViewLayout(id, "board");

    const view = binding.getViews().find((v) => v.id === id)!;
    expect(view.layout).toBe("board");
    expect(view.name).toBe("Board");
  });

  it("never overwrites a name the user chose", () => {
    // Only the user knows what their name means.
    const { binding } = makeBinding();
    const id = binding.addView("Q3 planning", "table");
    binding.setViewLayout(id, "board");

    const view = binding.getViews().find((v) => v.id === id)!;
    expect(view.name).toBe("Q3 planning");
    expect(view.layout).toBe("board");
  });

  it("stops auto-renaming once the user renames a view", () => {
    const { binding } = makeBinding();
    const id = binding.addView(undefined, "table");
    binding.renameView(id, "My view");
    binding.setViewLayout(id, "list");

    expect(binding.getViews().find((v) => v.id === id)!.name).toBe("My view");
  });

  it("keeps the renamed view's new name unique on a layout change", () => {
    const { binding } = makeBinding();
    binding.addView(undefined, "board"); // occupies "Board"
    const id = binding.addView(undefined, "table");
    binding.setViewLayout(id, "board");

    const names = binding.getViews().map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Board 2");
  });

  it("honours a localised default name while still tracking that it is automatic", () => {
    // The name is stored as whatever language created the view, so the
    // auto-rename must not depend on matching an English string.
    const { binding } = makeBinding();
    const id = binding.addView("列表", "list", { isDefaultName: true });
    expect(binding.getViews().find((v) => v.id === id)!.nameIsDefault).toBe(
      true,
    );

    binding.setViewLayout(id, "board");
    const view = binding.getViews().find((v) => v.id === id)!;
    expect(view.name).toBe("Board");
  });

  it("a user-supplied name is not flagged as a default", () => {
    const { binding } = makeBinding();
    const id = binding.addView("Q3 planning", "table");
    expect(binding.getViews().find((v) => v.id === id)!.nameIsDefault).toBe(
      false,
    );
  });

  it("an explicitly created default-named view is renamed on layout change", () => {
    const { binding } = makeBinding();
    const id = binding.addView("Table", "table", { isDefaultName: true });
    binding.setViewLayout(id, "list");
    expect(binding.getViews().find((v) => v.id === id)!.name).toBe("List");
  });
});

describe("the open view is shared state", () => {
  it("defaults to the first view when nothing is stored", () => {
    const { binding } = makeBinding();
    binding.initIfEmpty();
    expect(binding.getActiveViewId()).toBeNull();
    expect(binding.getActiveView()!.id).toBe(binding.getViews()[0].id);
  });

  it("round-trips through the document, so collaborators see the same view", () => {
    const { binding } = makeBinding();
    binding.initIfEmpty();
    const second = binding.addView(undefined, "list");

    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(binding.yDoc));
    const otherBinding = new DatabaseBinding(other, () => {});
    try {
      // Switching tabs is shared, not a private scroll position.
      expect(otherBinding.getActiveViewId()).toBe(second);
      expect(otherBinding.getActiveView()!.id).toBe(second);
    } finally {
      otherBinding.destroy();
    }
  });

  it("selects a newly created view", () => {
    // Creating a view means wanting to look at it.
    const { binding } = makeBinding();
    binding.initIfEmpty();
    const id = binding.addView(undefined, "board");
    expect(binding.getActiveViewId()).toBe(id);
  });

  it("ignores an id that is not a real view", () => {
    const { binding } = makeBinding();
    binding.initIfEmpty();
    const before = binding.getActiveViewId();
    binding.setActiveViewId("not-a-view");
    expect(binding.getActiveViewId()).toBe(before);
  });

  it("falls back rather than dangling when the stored view is gone", () => {
    // A client that had not yet seen a deletion must not render nothing.
    const { binding } = makeBinding();
    binding.initIfEmpty();
    const second = binding.addView(undefined, "list");

    // Simulate a remote deletion of the active view, leaving the pointer behind.
    binding.yDoc.transact(() => {
      (binding.yDoc.getMap("db_views") as Y.Map<unknown>).delete(second);
    });

    expect(binding.getActiveViewId()).toBeNull();
    expect(binding.getActiveView()).toBeDefined();
    expect(binding.getActiveView()!.id).toBe(binding.getViews()[0].id);
  });

  it("repoints the selection when the active view is deleted", () => {
    const { binding } = makeBinding();
    binding.initIfEmpty();
    const keep = binding.getViews()[0].id;
    const remove = binding.addView(undefined, "list");
    expect(binding.getActiveViewId()).toBe(remove);

    binding.deleteView(remove);

    expect(binding.getViews().map((v) => v.id)).toEqual([keep]);
    expect(binding.getActiveViewId()).toBe(keep);
  });

  it("deleting an inactive view leaves the selection alone", () => {
    const { binding } = makeBinding();
    binding.initIfEmpty();
    const first = binding.getViews()[0].id;
    const other = binding.addView(undefined, "list");
    binding.setActiveViewId(first);

    binding.deleteView(other);

    expect(binding.getActiveViewId()).toBe(first);
  });

  it("does not write when the selection is already correct", () => {
    // Otherwise every render would push an update to collaborators.
    const { binding } = makeBinding();
    binding.initIfEmpty();
    const first = binding.getViews()[0].id;

    // The first call is a genuine write: nothing was stored yet.
    binding.setActiveViewId(first);

    let writes = 0;
    binding.yDoc.on("update", () => writes++);
    binding.setActiveViewId(first);
    binding.setActiveViewId(first);
    expect(writes).toBe(0);
  });
});

describe("a view renders only its visible columns", () => {
  it("shows every column when nothing is hidden", () => {
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "number");
    const viewId = binding.addView(undefined, "table");

    expect(binding.getViewProperties(viewId).map((p) => p.id)).toEqual([a, b]);
  });

  it("drops a hidden column", () => {
    // The bug this fixes: the setting was stored but no view read it, so hiding a
    // column had no effect at all.
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "number");
    const viewId = binding.addView(undefined, "table");

    binding.toggleViewProperty(viewId, b);

    expect(binding.getViewProperties(viewId).map((p) => p.id)).toEqual([a]);
  });

  it("always includes the title column, even if it was hidden", () => {
    // A record with no visible name is unusable, and the panel keys off it.
    const { binding } = makeBinding();
    binding.initIfEmpty();
    const title = binding.getTitleProperty()!;
    const viewId = binding.addView(undefined, "table");

    binding.toggleViewProperty(viewId, title.id);

    const ids = binding.getViewProperties(viewId).map((p) => p.id);
    expect(ids).toContain(title.id);
  });

  it("is per view: hiding in one does not affect another", () => {
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "number");
    const one = binding.addView(undefined, "table");
    const two = binding.addView(undefined, "list");

    binding.toggleViewProperty(one, b);

    expect(binding.getViewProperties(one).map((p) => p.id)).toEqual([a]);
    expect(binding.getViewProperties(two).map((p) => p.id)).toEqual([a, b]);
  });

  it("ignores an id for a deleted property", () => {
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "number");
    const viewId = binding.addView(undefined, "table");

    binding.toggleViewProperty(viewId, b); // materialises the visible list
    binding.deleteProperty(b); // which also strips it from the view

    expect(binding.getViewProperties(viewId).map((p) => p.id)).toEqual([a]);
  });

  it("preserves the declared column order", () => {
    const { binding } = makeBinding();
    const a = binding.addProperty("A", "text");
    const b = binding.addProperty("B", "number");
    const c = binding.addProperty("C", "text");
    const viewId = binding.addView(undefined, "table");

    binding.toggleViewProperty(viewId, b); // hide the middle one
    binding.toggleViewProperty(viewId, b); // show it again

    expect(binding.getViewProperties(viewId).map((p) => p.id)).toEqual([
      a,
      b,
      c,
    ]);
  });
});

describe("board views choose a grouping column", () => {
  /**
   * These tests must not depend on the seeded schema, which now contains a `select`
   * (the default `Status` column). They build the columns they need on an empty
   * document so a change to the defaults cannot make them pass or fail by accident.
   */
  const bare = () => {
    const { binding } = makeBinding();
    return binding;
  };

  it("groups a new board view by the available option column", () => {
    // A board with no grouping column renders nothing but a prompt, so the user's
    // first look at the feature was an empty box demanding configuration.
    const binding = bare();
    const select = binding.addProperty("Role", "select");

    const boardId = binding.addView(undefined, "board");

    expect(
      binding.getViews().find((view) => view.id === boardId)?.groupBy,
    ).toBe(select);
  });

  it("groups by the available column when an existing view switches to board", () => {
    const binding = bare();
    const select = binding.addProperty("Role", "select");
    const viewId = binding.addView(undefined, "table");

    binding.setViewLayout(viewId, "board");

    expect(binding.getViews().find((view) => view.id === viewId)?.groupBy).toBe(
      select,
    );
  });

  it("prefers select over multi-select", () => {
    const binding = bare();
    const tags = binding.addProperty("Tags", "multi-select");
    const role = binding.addProperty("Role", "select");

    const viewId = binding.addView(undefined, "table");
    binding.setViewLayout(viewId, "board");

    // A `select` groups most usefully; multi-select would split a row across columns.
    expect(binding.getViews().find((v) => v.id === viewId)?.groupBy).toBe(role);
    expect(tags).not.toBe(
      binding.getViews().find((v) => v.id === viewId)?.groupBy,
    );
  });

  it("falls back to multi-select when it is the only option column", () => {
    const binding = bare();
    const tags = binding.addProperty("Tags", "multi-select");
    const viewId = binding.addView(undefined, "table");

    binding.setViewLayout(viewId, "board");

    expect(binding.getViews().find((v) => v.id === viewId)?.groupBy).toBe(tags);
  });

  it("never overrides a grouping column the user chose", () => {
    // Only a gap is filled: re-pointing an existing choice on a layout switch
    // would silently rearrange the board the user had already set up.
    const binding = bare();
    binding.addProperty("Role", "select");
    const tags = binding.addProperty("Tags", "multi-select");
    const viewId = binding.addView(undefined, "board");
    binding.setViewGroupBy(viewId, tags);

    binding.setViewLayout(viewId, "table");
    binding.setViewLayout(viewId, "board");

    expect(binding.getViews().find((v) => v.id === viewId)?.groupBy).toBe(tags);
  });

  it("leaves a board ungrouped when nothing can group, keeping the hint", () => {
    const binding = bare(); // no option column exists at all

    const viewId = binding.addView(undefined, "board");

    expect(
      binding.getViews().find((view) => view.id === viewId)?.groupBy,
    ).toBeUndefined();
  });

  it("leaves a non-board view ungrouped", () => {
    const binding = bare();
    binding.addProperty("Role", "select");

    const viewId = binding.addView(undefined, "list");

    expect(
      binding.getViews().find((view) => view.id === viewId)?.groupBy,
    ).toBeUndefined();
  });
});

describe("journal views", () => {
  /**
   * The journal's two view fields are treated differently on purpose, and the
   * asymmetry is what most of these tests pin down:
   *
   * - `calendarProp` missing means "choose one" — a fallback, because a journal can
   *   always pick a date column.
   * - `checklistProp` missing means "no ring" — there is no sensible default, since
   *   picking an arbitrary multi-select column would show progress for something the
   *   user never nominated.
   */
  const bare = () => makeBinding().binding;

  it("falls back to the first date column when nothing is stored", () => {
    const binding = bare();
    binding.addProperty("Name", "title");
    const due = binding.addProperty("Due", "date");
    const viewId = binding.addView(undefined, "journal");

    expect(binding.getViewCalendarProperty(viewId)?.id).toBe(due);
  });

  it("prefers the stored column over the first one", () => {
    const binding = bare();
    const first = binding.addProperty("First", "date");
    const second = binding.addProperty("Second", "date");
    const viewId = binding.addView(undefined, "journal");

    binding.setViewCalendarProp(viewId, second);

    expect(binding.getViewCalendarProperty(viewId)?.id).toBe(second);
    expect(binding.getViewCalendarProperty(viewId)?.id).not.toBe(first);
  });

  it("ignores a stored column that is not a date", () => {
    // The value is a write target for day keys, so a non-date column must never be
    // accepted — neither by the setter nor by the resolver.
    const binding = bare();
    const note = binding.addProperty("Note", "text");
    const due = binding.addProperty("Due", "date");
    const viewId = binding.addView(undefined, "journal");
    binding.setViewCalendarProp(viewId, due);

    binding.setViewCalendarProp(viewId, note);

    expect(binding.getViewCalendarProperty(viewId)?.id).toBe(due);
  });

  it("returns undefined when the database has no date column", () => {
    const binding = bare();
    binding.addProperty("Name", "title");
    const viewId = binding.addView(undefined, "journal");

    expect(binding.getViewCalendarProperty(viewId)).toBeUndefined();
  });

  it("clears the stored choice, falling back again", () => {
    const binding = bare();
    const first = binding.addProperty("First", "date");
    const second = binding.addProperty("Second", "date");
    const viewId = binding.addView(undefined, "journal");
    binding.setViewCalendarProp(viewId, second);

    binding.setViewCalendarProp(viewId, undefined);

    expect(binding.getViewCalendarProperty(viewId)?.id).toBe(first);
  });

  it("tolerates a dangling calendar column instead of failing", () => {
    // A collaborator can delete the column. Writes must not be sent to a column
    // that no longer exists, so the resolver falls back rather than trusting the id.
    const binding = bare();
    const due = binding.addProperty("Due", "date");
    const viewId = binding.addView(undefined, "journal");
    binding.setViewCalendarProp(viewId, due);

    binding.deleteProperty(due);

    expect(binding.getViewCalendarProperty(viewId)).toBeUndefined();
    expect(
      binding.getViews().find((view) => view.id === viewId)?.calendarProp,
    ).toBeUndefined();
  });

  it("re-points to a surviving date column when the stored one is deleted", () => {
    const binding = bare();
    const first = binding.addProperty("First", "date");
    const second = binding.addProperty("Second", "date");
    const viewId = binding.addView(undefined, "journal");
    binding.setViewCalendarProp(viewId, second);

    binding.deleteProperty(second);

    expect(binding.getViewCalendarProperty(viewId)?.id).toBe(first);
  });

  it("deleting a property clears the journal references", () => {
    // `deleteProperty` sweeps `visibleProps` and `groupBy` already; the journal
    // fields are load-bearing and must be swept too.
    const binding = bare();
    const due = binding.addProperty("Due", "date");
    const tags = binding.addProperty("Tags", "multi-select");
    const viewId = binding.addView(undefined, "journal");
    binding.setViewCalendarProp(viewId, due);
    binding.setViewChecklistProp(viewId, tags);

    binding.deleteProperty(due);
    binding.deleteProperty(tags);

    const view = binding
      .getViews()
      .find((candidate) => candidate.id === viewId);
    expect(view?.calendarProp).toBeUndefined();
    expect(view?.checklistProp).toBeUndefined();
  });

  it("has no checklist by default and does not invent one", () => {
    const binding = bare();
    binding.addProperty("Tags", "multi-select");
    const viewId = binding.addView(undefined, "journal");

    expect(binding.getViewChecklistProperty(viewId)).toBeUndefined();
  });

  it("refuses a checklist column that is not a multi-select", () => {
    const binding = bare();
    const status = binding.addProperty("Status", "select");
    const tags = binding.addProperty("Tags", "multi-select");
    const viewId = binding.addView(undefined, "journal");

    binding.setViewChecklistProp(viewId, status);
    expect(binding.getViewChecklistProperty(viewId)).toBeUndefined();

    binding.setViewChecklistProp(viewId, tags);
    expect(binding.getViewChecklistProperty(viewId)?.id).toBe(tags);
  });

  it("ignores a dangling checklist column rather than showing a ring for it", () => {
    const binding = bare();
    const tags = binding.addProperty("Tags", "multi-select");
    const viewId = binding.addView(undefined, "journal");
    binding.setViewChecklistProp(viewId, tags);

    binding.deleteProperty(tags);

    expect(binding.getViewChecklistProperty(viewId)).toBeUndefined();
  });

  it("survives a remote view with an unknown layout", () => {
    // A document written by a newer client: the stored layout is not one of ours.
    const { yDoc, binding } = makeBinding();
    yDoc.getMap("db_views").set(
      "v",
      new Y.Map<unknown>(
        Object.entries({
          id: "v",
          name: "X",
          layout: "kanban-3000",
          order: "0000000001",
          visibleProps: [],
        }),
      ),
    );

    // Reading must not throw, and the calendar resolver still works.
    expect(binding.getViews()[0].layout).toBe("kanban-3000");
    expect(() => binding.getViewCalendarProperty("v")).not.toThrow();
  });

  it("syncs the journal fields to a collaborator", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const bindingA = new DatabaseBinding(a, () => {});
    const bindingB = new DatabaseBinding(b, () => {});
    a.on("update", (update) => Y.applyUpdate(b, update));
    b.on("update", (update) => Y.applyUpdate(a, update));

    const due = bindingA.addProperty("Due", "date");
    const tags = bindingA.addProperty("Tags", "multi-select");
    const viewId = bindingA.addView(undefined, "journal");
    bindingA.setViewCalendarProp(viewId, due);
    bindingA.setViewChecklistProp(viewId, tags);

    expect(bindingB.getViewCalendarProperty(viewId)?.id).toBe(due);
    expect(bindingB.getViewChecklistProperty(viewId)?.id).toBe(tags);
  });

  it("keeps journal fields independent between views", () => {
    const binding = bare();
    const first = binding.addProperty("First", "date");
    const second = binding.addProperty("Second", "date");
    const tags = binding.addProperty("Tags", "multi-select");

    const viewA = binding.addView(undefined, "journal");
    const viewB = binding.addView(undefined, "journal");
    binding.setViewCalendarProp(viewA, first);
    binding.setViewCalendarProp(viewB, second);
    binding.setViewChecklistProp(viewA, tags);

    expect(binding.getViewCalendarProperty(viewA)?.id).toBe(first);
    expect(binding.getViewCalendarProperty(viewB)?.id).toBe(second);
    expect(binding.getViewChecklistProperty(viewB)).toBeUndefined();
  });
});

describe("journal records are ordinary rows", () => {
  const bare = () => makeBinding().binding;

  it("creates a record already on the requested day", () => {
    // What clicking an empty day cell does: one write, and the row is attached
    // before its values are written.
    const binding = bare();
    const due = binding.addProperty("Due", "date");
    const value = { start: new Date(2026, 2, 15, 12).toISOString() };

    const rowId = binding.addRow({ [due]: value });

    const row = binding.getRows().find((candidate) => candidate.id === rowId);
    expect(row?.values[due]).toEqual(value);
  });

  it("finds the record already on a day so the UI can open it instead", () => {
    const binding = bare();
    const due = binding.addProperty("Due", "date");
    const monday = { start: new Date(2026, 2, 15, 12).toISOString() };
    const tuesday = { start: new Date(2026, 2, 16, 12).toISOString() };
    const first = binding.addRow({ [due]: monday });
    binding.addRow({ [due]: tuesday });

    const onMonday = binding
      .getRows()
      .filter(
        (row) => row.values[due] !== undefined && row.values[due] === monday,
      );
    expect(onMonday.map((row) => row.id)).toEqual([first]);
  });

  it("writes a tick on one row without touching its neighbours", () => {
    const binding = bare();
    const tags = binding.addProperty("Habits", "multi-select");
    const viewId = binding.addView(undefined, "journal");
    binding.setViewChecklistProp(viewId, tags);
    const optA = binding.addOption(tags, "Read")!;
    const optB = binding.addOption(tags, "Run")!;
    const rowId = binding.addRow({});

    binding.toggleMultiSelect(rowId, tags, optA);
    binding.toggleMultiSelect(rowId, tags, optB);
    binding.toggleMultiSelect(rowId, tags, optA);

    const row = binding.getRows().find((candidate) => candidate.id === rowId);
    expect(row?.values[tags]).toEqual([optB]);
  });

  it("keeps the day key stable when the record is retyped", () => {
    // The date column must not be collapsible into something the journal cannot
    // read; retyping it away is the user's call, and the resolver then falls back.
    const binding = bare();
    const due = binding.addProperty("Due", "date");
    const viewId = binding.addView(undefined, "journal");
    const rowId = binding.addRow({
      [due]: { start: new Date(2026, 2, 15, 12).toISOString() },
    });

    binding.setPropertyType(due, "text");

    expect(binding.getViewCalendarProperty(viewId)).toBeUndefined();
    const row = binding.getRows().find((candidate) => candidate.id === rowId);
    expect(row).toBeDefined();
  });
});
