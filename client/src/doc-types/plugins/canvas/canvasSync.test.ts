import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  changedFields,
  collectElements,
  hasLocalChanges,
  isIncompleteTombstone,
  isRenderableElement,
  isValidViewport,
  mergeDocumentIntoScene,
  planElementWrite,
  readElementData,
  storageKindOf,
  readStoredViewport,
  resolveInitialViewport,
  snapshotElement,
  sortElementsForScene,
  storeViewport,
  viewportStorageKey,
  type Viewport,
} from "./canvasSync";

/**
 * These tests cover the two ways two people editing one canvas destroyed each
 * other's work, plus the recovery path for documents the old code already wrote.
 *
 * Both failures were silent: the losing edit simply vanished, matched by every
 * client and by the server, so only a test that models *two* writers can catch a
 * regression. A single-client test passes either way.
 */

import type { ElementData } from "./canvasSync";

const element = (
  overrides: ElementData = {},
): ElementData & {
  id: string;
  type: string;
} => ({
  id: "el-1",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version: 1,
  versionNonce: 100,
  index: "a0",
  isDeleted: false,
  updated: 1000,
  ...overrides,
});

describe("changedFields", () => {
  it("reports only the fields that differ from the baseline", () => {
    const baseline = element();
    const local = element({ x: 50, version: 2, versionNonce: 200 });

    expect(changedFields(baseline, local)).toEqual({
      x: 50,
      version: 2,
      versionNonce: 200,
    });
  });

  it("treats a missing baseline as everything changed", () => {
    const local = element({ x: 7 });

    expect(changedFields(undefined, local)).toEqual(local);
  });

  it("ignores undefined values instead of spreading them over the document", () => {
    // A field Excalidraw left undefined must not erase the value in the
    // document, which is what dropping `type` used to do to a live element.
    const baseline = element();
    const local = { ...element(), link: undefined };

    expect(changedFields(baseline, local)).toEqual({});
  });

  it("compares arrays by contents", () => {
    const baseline = element({ points: [[0, 0]] });
    const grown = element({
      points: [
        [0, 0],
        [5, 5],
      ],
    });
    const same = element({ points: [[0, 0]] });

    expect(changedFields(baseline, grown)).toEqual({
      points: [
        [0, 0],
        [5, 5],
      ],
    });
    expect(changedFields(baseline, same)).toEqual({});
  });
});

describe("hasLocalChanges", () => {
  it("is false for an element that only came from the document", () => {
    const shared = element();

    expect(hasLocalChanges(shared, shared)).toBe(false);
  });

  it("is true once a field was changed locally", () => {
    expect(hasLocalChanges(element(), element({ x: 1 }))).toBe(true);
  });
});

describe("planElementWrite", () => {
  const fields = (id: string, overrides: ElementData = {}) => ({
    id,
    type: "rectangle",
    x: 0,
    strokeColor: "#000000",
    ...overrides,
  });

  it("writes only the fields the local user changed", () => {
    // The point of the whole design: with per-field writes, two people editing
    // different properties of one shape both survive. Replacing the element
    // instead is what silently discarded one of the two edits.
    const baseline = fields("e", { x: 0, strokeColor: "#000000" });
    const local = fields("e", { x: 500, strokeColor: "#000000" });

    const write = planElementWrite(fields("e"), local, baseline, "fields");

    expect(write).not.toBeNull();
    expect(write?.fields).toMatchObject({ x: 500 });
    expect(write?.fields).not.toHaveProperty("strokeColor");
  });

  it("writes nothing when the document already has every local change", () => {
    // This is what stops a remote update from producing a local echo: with the
    // viewport in the document, the echo ran forever.
    const value = fields("e", { x: 42 });

    expect(
      planElementWrite(value, value, fields("e", { x: 0 }), "fields"),
    ).toBeNull();
  });

  it("writes nothing for an element with no local changes", () => {
    const value = fields("e");

    expect(planElementWrite(value, value, value, "fields")).toBeNull();
  });

  it("materialises the whole element when converting from the old format", () => {
    // A nested map starts empty, so the fields this user did not touch have to
    // come across in the same write or the element would lose them.
    const stored = fields("e", { y: 77, strokeColor: "#123456" });
    const local = fields("e", { y: 77, strokeColor: "#123456", x: 9 });

    const write = planElementWrite(stored, local, stored, "legacy");

    expect(write?.storage).toBe("legacy");
    expect(write?.fields).toMatchObject({
      x: 9,
      y: 77,
      strokeColor: "#123456",
    });
  });

  it("writes a whole new element the document has never seen", () => {
    const local = fields("fresh", { x: 9 });

    const write = planElementWrite(undefined, local, undefined, "missing");

    expect(write?.fields).toMatchObject({
      id: "fresh",
      x: 9,
      type: "rectangle",
    });
  });

  it("refuses to write an element Excalidraw could not render", () => {
    expect(
      planElementWrite(
        undefined,
        { id: "no-type", x: 1 },
        undefined,
        "missing",
      ),
    ).toBeNull();
  });
});

describe("per-field storage", () => {
  /** Two clients sharing one element, the way the binding writes it. */
  const twoClients = () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getMap("excalidraw_elements");
    b.getMap("excalidraw_elements");

    const writeFields = (doc: Y.Doc, fields: ElementData) => {
      doc.transact(() => {
        const elements = doc.getMap<Y.Map<unknown>>("excalidraw_elements");
        let map = elements.get("e");
        if (!map || !(map instanceof Y.Map)) {
          map = new Y.Map<unknown>();
          elements.set("e", map);
        }
        for (const [key, value] of Object.entries(fields)) {
          map.set(key, value);
        }
      });
    };

    const sync = () => {
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    };

    const read = (doc: Y.Doc) =>
      readElementData(doc.getMap("excalidraw_elements").get("e"));

    return { a, b, writeFields, sync, read };
  };

  it("keeps both edits when two clients change different fields at once", () => {
    // The bug this whole change is for: A moves the shape while B recolours it.
    // The old whole-element write let one of the two overwrite the other, and the
    // loss was silent — every client and the server agreed on the wrong value.
    const { a, b, writeFields, sync, read } = twoClients();
    writeFields(a, {
      id: "e",
      type: "rectangle",
      x: 0,
      strokeColor: "#000000",
    });
    sync();

    // Both edit before seeing each other.
    writeFields(a, { x: 777 });
    writeFields(b, { strokeColor: "#00ff00" });
    sync();

    expect(read(a)).toMatchObject({ x: 777, strokeColor: "#00ff00" });
    expect(read(b)).toMatchObject({ x: 777, strokeColor: "#00ff00" });
    expect(read(a)).toEqual(read(b));
  });

  it("resolves a write to the same field deterministically on both sides", () => {
    const { a, b, writeFields, sync, read } = twoClients();
    writeFields(a, { id: "e", type: "rectangle", x: 0 });
    sync();

    writeFields(a, { x: 10 });
    writeFields(b, { x: 20 });
    sync();

    expect(read(a)).toEqual(read(b));
  });
});

describe("readElementData / storageKindOf", () => {
  it("reads a per-field element as element data", () => {
    // A Y.Map only holds data once it belongs to a document, so the fixture is
    // built the way the app builds one.
    const doc = new Y.Doc();
    const elements = doc.getMap<unknown>("excalidraw_elements");
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      map.set("id", "e");
      map.set("type", "rectangle");
      map.set("x", 5);
      elements.set("e", map);
    });
    const map = elements.get("e");

    expect(readElementData(map)).toEqual({ id: "e", type: "rectangle", x: 5 });
    expect(storageKindOf(map)).toBe("fields");
  });

  it("reads a plain object written by an older client", () => {
    const legacy = { id: "e", type: "rectangle", x: 5 };

    expect(readElementData(legacy)).toEqual(legacy);
    expect(storageKindOf(legacy)).toBe("legacy");
  });

  it("reports an absent element as missing", () => {
    expect(storageKindOf(undefined)).toBe("missing");
    expect(readElementData(undefined)).toBeNull();
  });
});

describe("snapshotElement", () => {
  it("copies nested values so a later mutation cannot reach the snapshot", () => {
    // The baseline is stored as a snapshot. Excalidraw mutates elements in place,
    // so a stored reference would keep changing with the scene and every diff
    // would come back empty — the edit would silently never be written.
    const live = element({ points: [[0, 0]], roundness: { type: 2 } });
    const snapshot = snapshotElement(live);

    (live.points as number[][]).push([5, 5]);
    (live.roundness as { type: number }).type = 99;
    live.x = 42;

    expect(snapshot).toMatchObject({
      x: 0,
      points: [[0, 0]],
      roundness: { type: 2 },
    });
  });

  it("returns a value equal to the original", () => {
    const live = element();

    expect(snapshotElement(live)).toEqual(live);
  });
});

describe("the baseline must not alias the scene", () => {
  it("still reports the change after Excalidraw mutates the element in place", () => {
    // Reproduces the aliasing bug end to end: the scene element is snapshotted
    // into the baseline, then mutated the way Excalidraw mutates it.
    const live = element({ x: 0 });
    const baseline = new Map<string, ElementData>([
      [live.id as string, snapshotElement(live)],
    ]);

    live.x = 500;

    expect(hasLocalChanges(baseline.get(live.id as string), live)).toBe(true);
    expect(
      planElementWrite(
        element({ x: 0 }),
        live,
        baseline.get(live.id as string),
        "fields",
      ),
    ).toMatchObject({ fields: expect.objectContaining({ x: 500 }) });
  });
});

describe("sortElementsForScene", () => {
  it("orders by fractional index", () => {
    const sorted = sortElementsForScene([
      element({ id: "c", index: "a2" }),
      element({ id: "a", index: "a0" }),
      element({ id: "b", index: "a1" }),
    ]);

    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("is a total order when two clients pick the same index", () => {
    // Both clients can generate the same key at the same moment. The old
    // comparator returned 1 for equal keys, which is not a valid ordering and
    // left the result up to the sort implementation — so the two clients could
    // disagree about which shape is on top.
    const a = element({ id: "aaa", index: "a1" });
    const b = element({ id: "bbb", index: "a1" });

    expect(sortElementsForScene([a, b]).map((e) => e.id)).toEqual([
      "aaa",
      "bbb",
    ]);
    expect(sortElementsForScene([b, a]).map((e) => e.id)).toEqual([
      "aaa",
      "bbb",
    ]);
  });

  it("keeps elements without an index after the ordered ones", () => {
    const sorted = sortElementsForScene([
      element({ id: "new", index: null }),
      element({ id: "old", index: "a0" }),
    ]);

    expect(sorted.map((e) => e.id)).toEqual(["old", "new"]);
  });

  it("does not mutate the input", () => {
    const input = [
      element({ id: "b", index: "a1" }),
      element({ id: "a", index: "a0" }),
    ];

    sortElementsForScene(input);

    expect(input.map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("mergeDocumentIntoScene", () => {
  it("adopts a value from the document and reports it for the baseline", () => {
    const remote = element({ id: "r", x: 5 });

    const { elements, adopted } = mergeDocumentIntoScene({
      scene: [],
      document: new Map([["r", remote]]),
      baseline: new Map(),
    });

    expect(elements).toHaveLength(1);
    // Without this the element looks locally modified forever and every sync
    // echoes it back.
    expect(adopted.get("r")).toMatchObject({ id: "r", x: 5 });
  });

  it("leaves an element with unsynced local edits alone", () => {
    // Somebody else touching a shape must not yank it out of a local drag.
    const shared = element({ id: "e", x: 0 });
    const localScene = element({ id: "e", x: 900 });
    const remote = element({ id: "e", x: 50 });

    const { elements, adopted } = mergeDocumentIntoScene({
      scene: [localScene],
      document: new Map([["e", remote]]),
      baseline: new Map([["e", shared]]),
    });

    expect(elements[0]).toMatchObject({ x: 900 });
    expect(adopted.has("e")).toBe(false);
  });

  it("adopts a change that reused the same version pair", () => {
    // A per-field write copies `version`/`versionNonce` from the value it merged
    // into, so a document can hold a different value under the same revision.
    // Comparing those two alone would report "already have it" and leave this
    // client stuck on the old value forever.
    const sceneElement = element({
      id: "e",
      strokeColor: "#ff0000",
      version: 5,
      versionNonce: 538141954,
    });
    const remote = element({
      id: "e",
      strokeColor: "#0000ff",
      version: 5,
      versionNonce: 538141954,
    });

    const { elements, adopted } = mergeDocumentIntoScene({
      scene: [sceneElement],
      document: new Map([["e", remote]]),
      baseline: new Map([["e", snapshotElement(sceneElement)]]),
    });

    expect(adopted.has("e")).toBe(true);
    expect(elements[0]).toMatchObject({ strokeColor: "#0000ff" });
  });

  it("does not re-adopt an element it already holds", () => {
    // The other half: re-cloning on every remote update would throw away the
    // selection state tied to the old object.
    const shared = element({ id: "e", x: 5 });

    const { adopted } = mergeDocumentIntoScene({
      scene: [shared],
      document: new Map([["e", snapshotElement(shared)]]),
      baseline: new Map([["e", snapshotElement(shared)]]),
    });

    expect(adopted.size).toBe(0);
  });

  it("applies a fieldless tombstone to the scene copy, keeping its fields", () => {
    // The old delete path wrote `{id, isDeleted, versionNonce}`. Passing that to
    // Excalidraw makes it throw on an unknown element type, which aborted the
    // whole scene update.
    const sceneElement = element({ id: "e", type: "rectangle", x: 12 });

    const { elements } = mergeDocumentIntoScene({
      scene: [sceneElement],
      document: new Map([
        ["e", { id: "e", isDeleted: true, versionNonce: 999 }],
      ]),
      baseline: new Map(),
    });

    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      type: "rectangle",
      x: 12,
      isDeleted: true,
      versionNonce: 999,
    });
  });

  it("ignores a tombstone for an element this client never opened", () => {
    const { elements } = mergeDocumentIntoScene({
      scene: [],
      document: new Map([
        ["gone", { id: "gone", isDeleted: true, versionNonce: 1 }],
      ]),
      baseline: new Map(),
    });

    expect(elements).toEqual([]);
  });

  it("skips an unrenderable element rather than letting it abort the update", () => {
    const good = element({ id: "good" });

    const { elements, skipped } = mergeDocumentIntoScene({
      scene: [],
      document: new Map<string, unknown>([
        ["good", good],
        ["bad", { id: "bad", x: 1 }],
      ]),
      baseline: new Map(),
    });

    expect(elements.map((e) => e.id)).toEqual(["good"]);
    expect(skipped).toEqual(["bad"]);
  });
});

describe("opening a document written by an older version", () => {
  /**
   * A document as the previous version wrote it: every element a plain object in
   * the shared map. This is the compatibility guarantee — such a document must
   * open with its content intact and need no migration step.
   */
  const legacyDocument = () => {
    const doc = new Y.Doc();
    const elements = doc.getMap<unknown>("excalidraw_elements");
    doc.transact(() => {
      elements.set(
        "legacy-1",
        element({ id: "legacy-1", index: "a0", x: 10, strokeColor: "#ff0000" }),
      );
      elements.set(
        "legacy-2",
        element({ id: "legacy-2", index: "a1", x: 20, strokeColor: "#00ff00" }),
      );
    });
    return elements;
  };

  it("opens every element of a document written before per-field storage", () => {
    const loaded = collectElements(legacyDocument());

    expect(loaded.map((e) => e.id)).toEqual(["legacy-1", "legacy-2"]);
    expect(loaded[0]).toMatchObject({
      type: "rectangle",
      x: 10,
      strokeColor: "#ff0000",
    });
  });

  it("opens a document whose elements are already per-field", () => {
    const doc = new Y.Doc();
    const elements = doc.getMap<unknown>("excalidraw_elements");
    doc.transact(() => {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(
        element({ id: "modern-1", index: "a0", x: 30 }),
      )) {
        map.set(key, value);
      }
      elements.set("modern-1", map);
    });

    const loaded = collectElements(elements);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      id: "modern-1",
      type: "rectangle",
      x: 30,
    });
  });

  it("opens a document that holds both formats at once", () => {
    // The realistic state during the changeover: an element is converted the
    // first time it is edited, so untouched ones stay in the old format and a
    // document holds a mix for as long as that takes.
    const elements = legacyDocument();
    elements.doc!.transact(() => {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(
        element({ id: "modern-1", index: "a2", x: 30 }),
      )) {
        map.set(key, value);
      }
      elements.set("modern-1", map);
    });

    const loaded = collectElements(elements);

    expect(loaded.map((e) => e.id)).toEqual([
      "legacy-1",
      "legacy-2",
      "modern-1",
    ]);
  });

  it("opens a document holding a deletion written by the old delete path", () => {
    // The old code stored a fieldless tombstone. It must not stop the document
    // from opening, and must not surface as an element Excalidraw chokes on.
    const elements = legacyDocument();
    elements.doc!.transact(() => {
      elements.set("gone", { id: "gone", isDeleted: true, versionNonce: 1 });
    });

    const loaded = collectElements(elements);

    expect(loaded.map((e) => e.id)).toEqual(["legacy-1", "legacy-2"]);
  });

  it("survives a round trip through encode/apply, as a reload does", () => {
    const source = legacyDocument();
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(source.doc!));

    const loaded = collectElements(
      restored.getMap("excalidraw_elements") as Y.Map<unknown>,
    );

    expect(loaded.map((e) => e.id)).toEqual(["legacy-1", "legacy-2"]);
  });

  it("converts an element on its first edit, keeping every field", () => {
    // The lazy migration: nothing is rewritten on open, and the first edit
    // carries the whole element into the new format so no field is lost.
    const elements = legacyDocument();
    const stored = elements.get("legacy-1") as ElementData;
    const local = element({ id: "legacy-1", index: "a0", x: 99 });

    const write = planElementWrite(
      stored,
      local,
      stored,
      storageKindOf(stored),
    );
    expect(write?.storage).toBe("legacy");

    elements.doc!.transact(() => {
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(write?.fields ?? {})) {
        map.set(key, value);
      }
      elements.set("legacy-1", map);
    });

    const reopened = collectElements(elements)[0];
    expect(reopened).toMatchObject({
      id: "legacy-1",
      type: "rectangle",
      x: 99,
      strokeColor: "#ff0000",
      isDeleted: false,
    });
    // Every field the document held survives the conversion, plus the one the
    // edit changed.
    expect(Object.keys(reopened).sort()).toEqual(
      [...new Set([...Object.keys(stored), ...Object.keys(local)])].sort(),
    );
  });
});

describe("isRenderableElement", () => {
  it("accepts a real element", () => {
    expect(isRenderableElement(element())).toBe(true);
  });

  it("rejects anything Excalidraw would throw on", () => {
    expect(isRenderableElement(null)).toBe(false);
    expect(isRenderableElement(undefined)).toBe(false);
    expect(isRenderableElement("rectangle")).toBe(false);
    expect(isRenderableElement({ id: "x" })).toBe(false);
    expect(isRenderableElement({ type: "rectangle" })).toBe(false);
    expect(isRenderableElement({ id: "", type: "rectangle" })).toBe(false);
  });
});

describe("isIncompleteTombstone", () => {
  it("recognises the old delete format", () => {
    expect(
      isIncompleteTombstone({ id: "e", isDeleted: true, versionNonce: 1 }),
    ).toBe(true);
  });

  it("does not mistake a deleted element with its fields for one", () => {
    expect(isIncompleteTombstone(element({ isDeleted: true }))).toBe(false);
  });
});

describe("viewport storage", () => {
  const storageWith = (value?: string) => {
    const store = new Map<string, string>();
    if (value !== undefined) {
      store.set(viewportStorageKey("doc-1"), value);
    }
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
  };

  const viewport: Viewport = { x: -100, y: 20, zoom: 1.5 };

  it("round-trips a viewport", () => {
    const storage = storageWith();
    storeViewport(storage, "doc-1", viewport);

    expect(readStoredViewport(storage, "doc-1")).toEqual(viewport);
  });

  it("is scoped per document", () => {
    const storage = storageWith();
    storeViewport(storage, "doc-1", viewport);

    expect(readStoredViewport(storage, "doc-2")).toBeNull();
  });

  it("ignores a corrupt entry instead of failing to open the document", () => {
    expect(readStoredViewport(storageWith("{not json"), "doc-1")).toBeNull();
  });

  it("ignores a viewport outside the zoom range", () => {
    expect(
      readStoredViewport(
        storageWith(JSON.stringify({ x: 0, y: 0, zoom: 999 })),
        "doc-1",
      ),
    ).toBeNull();
  });

  it("rejects a non-finite coordinate", () => {
    expect(isValidViewport({ x: null, y: 0, zoom: 1 })).toBe(false);
    expect(isValidViewport({ x: 0, y: 0, zoom: Number.NaN })).toBe(false);
  });

  it("does not throw when storage refuses the write", () => {
    const storage = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };

    expect(() => storeViewport(storage, "doc-1", viewport)).not.toThrow();
  });
});

describe("resolveInitialViewport", () => {
  const stored: Viewport = { x: 1, y: 2, zoom: 1 };

  it("prefers this user's own viewport", () => {
    expect(resolveInitialViewport(stored, { x: 9, y: 9, zoom: 4 })).toEqual(
      stored,
    );
  });

  it("falls back to the document's legacy shared viewport once", () => {
    // Documents written before the split hold a viewport in the shared config.
    // Reading it (and never writing it) means an upgrade does not move the
    // canvas out from under everybody at once.
    const legacy = { x: 50, y: 60, zoom: 2 };

    expect(resolveInitialViewport(null, legacy)).toEqual(legacy);
  });

  it("ignores a legacy viewport that is not usable", () => {
    expect(resolveInitialViewport(null, undefined)).toBeNull();
    expect(resolveInitialViewport(null, { x: 0, y: 0 })).toBeNull();
    expect(resolveInitialViewport(null, "nonsense")).toBeNull();
  });
});
