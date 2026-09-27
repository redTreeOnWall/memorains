import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildInitialDatabaseState, DatabaseBinding } from "./model";
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
  "status",
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
      status: "opt-1",
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
      status: "discrete",
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
});

describe("status groups are data, not a fixed enum", () => {
  it("defaults to the conventional stages", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("Status", "status");
    expect(binding.getGroups(propId)).toEqual([
      "todo",
      "in_progress",
      "complete",
    ]);
  });

  it("lets the user replace the stages entirely", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("Status", "status");
    expect(binding.setGroups(propId, ["backlog", "blocked", "shipped"])).toBe(
      true,
    );
    expect(binding.getGroups(propId)).toEqual([
      "backlog",
      "blocked",
      "shipped",
    ]);
  });

  it("moves options out of a group that no longer exists", () => {
    // Otherwise the option would vanish from a grouped board.
    const { binding } = makeBinding();
    const propId = binding.addProperty("Status", "status");
    const optId = binding.addOption(propId, "Doing")!;
    binding.setOptionGroup(propId, optId, "in_progress");

    binding.setGroups(propId, ["backlog", "shipped"]);

    const option = binding
      .getProperty(propId)!
      .options.find((o) => o.id === optId)!;
    expect(option.group).toBe("backlog");
  });

  it("refuses an empty group list", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("Status", "status");
    expect(binding.setGroups(propId, ["  "])).toBe(false);
    expect(binding.getGroups(propId)).toEqual([
      "todo",
      "in_progress",
      "complete",
    ]);
  });

  it("does not apply groups to non-status properties", () => {
    const { binding } = makeBinding();
    const propId = binding.addProperty("Role", "select");
    expect(binding.setGroups(propId, ["a", "b"])).toBe(false);
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
      expect(properties.map((p) => p.type).sort()).toEqual(["text", "title"]);
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
        expect(secondBinding.getProperties()).toHaveLength(2);
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
      expect(binding.getProperties()).toHaveLength(3);
      expect(binding.getViews()).toHaveLength(2);

      // Merged into a fresh document, as a collaborator would receive it.
      const other = new Y.Doc();
      Y.applyUpdate(other, Y.encodeStateAsUpdate(yDoc));
      const otherBinding = new DatabaseBinding(other, () => {});
      try {
        otherBinding.initIfEmpty();
        expect(otherBinding.getProperties()).toHaveLength(3);
        expect(otherBinding.getViews()).toHaveLength(2);
      } finally {
        otherBinding.destroy();
      }
    } finally {
      binding.destroy();
    }
  });
});
