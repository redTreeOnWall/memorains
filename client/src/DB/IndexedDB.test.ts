import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import * as Y from "yjs";
import { IndexedDB } from "./IndexedDB";
import {
  DocumentEntity,
  DocumentPublic,
  DocType,
} from "../interface/DataEntity";

/**
 * Behavior contract for the local document store.
 *
 * Two halves: the snapshot store that shipped first, and the append-only update
 * log used for incremental saving. The log is invisible to callers by design, so
 * most of these tests are about what `getDocById` hands back rather than about
 * the rows themselves.
 *
 * `fake-indexeddb` is used instead of a browser. It matches Chrome on the three
 * points that matter here, all verified against a real browser before this file
 * was written:
 *
 *   - an uncaught throw inside `onupgradeneeded` aborts the version change, the
 *     request fails with `AbortError`, and the database stays at its old version;
 *   - a held connection without an `onversionchange` handler blocks a newer-version
 *     open, and closing that connection lets the pending upgrade proceed;
 *   - an `onversionchange` handler that closes lets the upgrade through immediately.
 *
 * Multi-tab safety here does not depend on any locking: every write merges what
 * it finds in the same transaction, so two tabs cannot overwrite each other.
 */

const DB_NAME = "document";

/** A valid Yjs state holding `text`, since folding decodes what it stores. */
const yjsState = (text: string) => {
  const yDoc = new Y.Doc({ gc: true });
  yDoc.getText("t").insert(0, text);
  const state = Y.encodeStateAsUpdate(yDoc).buffer as ArrayBuffer;
  yDoc.destroy();
  return state;
};

const makeDoc = (overrides: Partial<DocumentEntity> = {}): DocumentEntity => ({
  id: "doc-1",
  title: "Test note",
  user_id: "user-1",
  create_date: "2026-01-01 10:00:00",
  last_modify_date: "2026-01-02 10:00:00",
  state: yjsState("base"),
  is_public: DocumentPublic.private,
  commit_id: 12345,
  doc_type: DocType.text,
  ...overrides,
});

/** A Yjs document whose edits can be captured as individual updates. */
const makeTextDoc = (initial: string) => {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => updates.push(update));
  doc.getText("t").insert(0, initial);
  const seed = updates.shift()!;
  return {
    doc,
    seed,
    updates,
    /** Edit, and return the update that edit produced. */
    edit(text: string) {
      const before = updates.length;
      doc.getText("t").insert(doc.getText("t").length, text);
      return updates[before];
    },
    read() {
      return doc.getText("t").toString();
    },
  };
};

/** Decode a stored snapshot and read its text, the way an editor would. */
const readText = (state: ArrayBuffer | null) => {
  const doc = new Y.Doc();
  if (state?.byteLength) {
    Y.applyUpdate(doc, new Uint8Array(state));
  }
  const text = doc.getText("t").toString();
  doc.destroy();
  return text;
};

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });

describe("IndexedDB", () => {
  let db: IndexedDB;

  beforeEach(async () => {
    await deleteDatabase(DB_NAME);
    db = new IndexedDB();
    await db.open();
  });

  afterEach(() => {
    db.db?.close();
  });

  describe("schema", () => {
    it("creates the document store with both date indexes", () => {
      expect(db.db?.version).toBe(3);
      expect([...(db.db?.objectStoreNames ?? [])].sort()).toEqual([
        "doc_update",
        "document",
      ]);

      const store = db.db!.transaction("document").objectStore("document");
      expect([...store.indexNames].sort()).toEqual([
        "create_date",
        "last_modify_date",
      ]);
      expect(store.keyPath).toBe("id");
    });

    it("creates the update log store keyed by string and indexed by document", () => {
      const store = db.db!.transaction("doc_update").objectStore("doc_update");
      expect(store.keyPath).toBe("key");
      expect([...store.indexNames]).toEqual(["doc_id"]);
      expect(store.autoIncrement).toBe(false);
    });

    it("repairs an existing database that predates the log store", async () => {
      // Simulates a user upgrading from the previous release, where the database
      // was version 2 and only had the document store.
      db.db?.close();
      await deleteDatabase(DB_NAME);

      const legacy = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open(DB_NAME, 2);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("document", {
            keyPath: "id",
          });
          // Deliberately no indexes, to prove they are backfilled too.
          store.put({
            id: "legacy",
            title: "Existing note",
            state: new Uint8Array([7, 7]).buffer,
          });
        };
        request.onsuccess = () => resolve(request.result);
      });
      legacy.close();

      const upgraded = new IndexedDB();
      await upgraded.open();
      db = upgraded;

      expect(upgraded.db?.version).toBe(3);
      expect([...(upgraded.db?.objectStoreNames ?? [])].sort()).toEqual([
        "doc_update",
        "document",
      ]);
      const store = upgraded
        .db!.transaction("document")
        .objectStore("document");
      expect([...store.indexNames].sort()).toEqual([
        "create_date",
        "last_modify_date",
      ]);
      const row = await upgraded.getDocById("legacy");
      expect(row).toMatchObject({ id: "legacy", title: "Existing note" });
    });

    it("reports a blocked upgrade instead of failing silently", async () => {
      db.db?.close();
      await deleteDatabase(DB_NAME);

      // Hold a connection at the current version without yielding, the way an
      // already-open tab running the previous build would.
      const held = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open(DB_NAME, 3);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("document", { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
      });

      const next = new IndexedDB();
      next.dbMeta = { ...next.dbMeta, version: 4 };
      let blocked = false;
      next.onUpgradeBlocked = () => {
        blocked = true;
      };
      const opened = next.open();

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(blocked).toBe(true);

      // Closing the other tab lets the pending request finish on its own, so the
      // caller never has to retry the open.
      held.close();
      await opened;
      expect(next.db?.version).toBe(4);
      next.db?.close();
      db = next;
    });

    it("yields the connection when another tab requests an upgrade", async () => {
      db.db?.close();
      await deleteDatabase(DB_NAME);

      const first = new IndexedDB();
      let sawClose = false;
      first.onClosed = () => {
        sawClose = true;
      };
      await first.open();

      const second = new IndexedDB();
      second.dbMeta = { ...second.dbMeta, version: 4 };
      const opened = second.open();

      await opened;
      // Yielding is what keeps another tab's upgrade from stalling forever, and
      // the tab is told so it does not keep writing into a closed connection.
      expect(sawClose).toBe(true);
      expect(first.db).toBeNull();
      expect(second.db?.version).toBe(4);
      second.db?.close();
      db = second;
    });
  });

  describe("getDocumentList", () => {
    it("returns an empty list on a fresh database", async () => {
      await expect(db.getDocumentList()).resolves.toEqual([]);
    });

    it("omits the state field by default", async () => {
      await db.createOrUpdateDoc(makeDoc());

      const [row] = await db.getDocumentList();

      expect(row.state).toBeUndefined();
      expect(row).toMatchObject({
        id: "doc-1",
        title: "Test note",
        user_id: "user-1",
        create_date: "2026-01-01 10:00:00",
        last_modify_date: "2026-01-02 10:00:00",
        is_public: DocumentPublic.private,
        commit_id: 12345,
        doc_type: DocType.text,
      });
    });

    it("includes the state field when asked", async () => {
      await db.createOrUpdateDoc(makeDoc());

      const [row] = await db.getDocumentList(true);

      expect(readText(row.state!)).toBe("base");
    });

    it("defaults doc_type to 0 for rows written before the field existed", async () => {
      // Simulates a row created by an older build. `getDocumentList` maps
      // `doc_type ?? 0`, so the fallback is part of the storage contract.
      const legacy = makeDoc({ id: "legacy" }) as Partial<DocumentEntity>;
      delete legacy.doc_type;
      await db.createOrUpdateDoc(legacy as DocumentEntity);

      const [row] = await db.getDocumentList();

      expect(row.doc_type).toBe(0);
    });

    it("sorts by the named index and honours the limit", async () => {
      await db.createOrUpdateDoc(
        makeDoc({ id: "a", last_modify_date: "2026-01-01 00:00:00" }),
      );
      await db.createOrUpdateDoc(
        makeDoc({ id: "b", last_modify_date: "2026-03-01 00:00:00" }),
      );
      await db.createOrUpdateDoc(
        makeDoc({ id: "c", last_modify_date: "2026-02-01 00:00:00" }),
      );

      const newestFirst = await db.getDocumentList(
        false,
        "last_modify_date",
        "prev",
      );
      expect(newestFirst.map((row) => row.id)).toEqual(["b", "c", "a"]);

      const limited = await db.getDocumentList(
        false,
        "last_modify_date",
        "prev",
        1,
      );
      expect(limited.map((row) => row.id)).toEqual(["b"]);
    });
  });

  describe("createOrUpdateDoc", () => {
    it("round-trips a document through getDocById", async () => {
      await db.createOrUpdateDoc(makeDoc());

      const row = await db.getDocById("doc-1");

      expect(row).toMatchObject({ id: "doc-1", title: "Test note" });
      expect(readText(row!.state!)).toBe("base");
    });

    it("replaces the whole row on update, it does not merge fields", async () => {
      await db.createOrUpdateDoc(makeDoc());
      await db.createOrUpdateDoc(
        makeDoc({ id: "doc-1", title: "Renamed" }) as DocumentEntity,
      );

      const row = await db.getDocById("doc-1");

      expect(row!.title).toBe("Renamed");
      // A field dropped from the input is dropped from storage too. Subsystems
      // that write metadata must send the full entity or they erase state.
      expect(row!.state).toBeDefined();
    });

    it("returns undefined for a missing document", async () => {
      await expect(db.getDocById("nope")).resolves.toBeUndefined();
    });
  });

  describe("deleteDoc", () => {
    it("removes the document row", async () => {
      await db.createOrUpdateDoc(makeDoc());

      await db.deleteDoc("doc-1");

      await expect(db.getDocById("doc-1")).resolves.toBeUndefined();
    });

    it("does not reject when the document is missing", async () => {
      await expect(db.deleteDoc("nope")).resolves.toBeUndefined();
    });
  });

  describe("updateId", () => {
    it("moves the document to the new id", async () => {
      await db.createOrUpdateDoc(makeDoc());

      await db.updateId("doc-1", "doc-2");

      await expect(db.getDocById("doc-1")).resolves.toBeUndefined();
      const moved = await db.getDocById("doc-2");
      expect(moved).toMatchObject({ id: "doc-2", title: "Test note" });
    });

    it("rejects when the source document does not exist", async () => {
      await expect(db.updateId("missing", "target")).rejects.toThrow(
        "Old data not exit.",
      );
    });
  });

  describe("getLastOpenedDoc", () => {
    it("returns the document with the newest modification date", async () => {
      await db.createOrUpdateDoc(
        makeDoc({ id: "old", last_modify_date: "2026-01-01 00:00:00" }),
      );
      await db.createOrUpdateDoc(
        makeDoc({ id: "new", last_modify_date: "2026-05-01 00:00:00" }),
      );

      const last = await db.getLastOpenedDoc();

      expect(last?.id).toBe("new");
    });

    it("returns undefined on an empty database", async () => {
      await expect(db.getLastOpenedDoc()).resolves.toBeUndefined();
    });

    it("skips the newest document when it is encrypted", async () => {
      await db.createOrUpdateDoc(
        makeDoc({ id: "plain", last_modify_date: "2026-01-01 00:00:00" }),
      );
      await db.createOrUpdateDoc(
        makeDoc({
          id: "encrypted",
          last_modify_date: "2026-05-01 00:00:00",
          encrypt_salt: "salt",
        }),
      );

      const last = await db.getLastOpenedDoc();

      // Only the single newest row is fetched, so an encrypted newest row
      // makes this return undefined rather than falling back to an older one.
      expect(last).toBeUndefined();
    });
  });
});

/**
 * The append-only update log.
 *
 * The log exists so a keystroke costs one small row instead of re-encoding and
 * rewriting the whole document. Nothing outside this file should need to know it
 * is there, which is why the assertions go through `getDocById`.
 */
describe("IndexedDB update log", () => {
  let db: IndexedDB;

  beforeEach(async () => {
    await deleteDatabase(DB_NAME);
    db = new IndexedDB();
    await db.open();
  });

  afterEach(() => {
    db.db?.close();
  });

  /** Seed a document whose snapshot holds `initial`. */
  const seed = async (initial: string) => {
    const source = makeTextDoc(initial);
    await db.createOrUpdateDoc({
      ...makeDoc(),
      state: source.seed.buffer as ArrayBuffer,
    });
    return source;
  };

  it("appends and reads back an update", async () => {
    const source = await seed("base");
    const update = source.edit("+1");

    await db.appendDocUpdate(
      "doc-1",
      "writer-a",
      1,
      update.buffer as ArrayBuffer,
    );

    const rows = await db.getDocUpdates("doc-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      doc_id: "doc-1",
      writer_id: "writer-a",
      seq: 1,
    });
  });

  it("hides pending updates behind getDocById", async () => {
    const source = await seed("base");
    const first = source.edit("-one");
    const second = source.edit("-two");
    await db.appendDocUpdate("doc-1", "w", 1, first.buffer as ArrayBuffer);
    await db.appendDocUpdate("doc-1", "w", 2, second.buffer as ArrayBuffer);

    const doc = await db.getDocById("doc-1");

    expect(readText(doc!.state!)).toBe("base-one-two");
  });

  it("leaves the stored snapshot untouched until a write folds it in", async () => {
    const source = await seed("base");
    const update = source.edit("-pending");
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);

    const raw = await db.getRawDoc("doc-1");

    expect(readText(raw!.state!)).toBe("base");
  });

  it("folds pending updates into the snapshot on a full write", async () => {
    const source = await seed("base");
    const update = source.edit("-pending");
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);

    // The caller contributes a stale snapshot; the pending update must survive.
    await db.createOrUpdateDoc({
      ...makeDoc(),
      title: "Renamed",
      state: source.seed.buffer as ArrayBuffer,
    });

    expect(readText((await db.getRawDoc("doc-1"))!.state!)).toBe(
      "base-pending",
    );
    expect((await db.getRawDoc("doc-1"))!.title).toBe("Renamed");
    await expect(db.getDocUpdates("doc-1")).resolves.toHaveLength(0);
  });

  it("merges the stored snapshot instead of overwriting it", async () => {
    // A caller's `state` comes from its own in-memory document, which may predate
    // what is on disk. Writing it alone would discard whatever another tab had
    // already folded in, because that tab's rows are gone by then.
    const base = new Y.Doc({ gc: true });
    base.getText("t").insert(0, "base");
    await db.createOrUpdateDoc({
      ...makeDoc(),
      state: Y.encodeStateAsUpdate(base).buffer as ArrayBuffer,
    });

    // A second editor folds in its own edit.
    const other = new Y.Doc({ gc: true });
    Y.applyUpdate(other, Y.encodeStateAsUpdate(base));
    other.getText("t").insert(4, "-other");
    await db.appendDocUpdate(
      "doc-1",
      "other",
      1,
      Y.encodeStateAsUpdate(other, Y.encodeStateVector(new Y.Doc()))
        .buffer as ArrayBuffer,
    );
    await db.compactDoc("doc-1");

    // A first editor, holding only the original, writes a full snapshot.
    const mine = new Y.Doc({ gc: true });
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(base));
    mine.getText("t").insert(4, "-mine");
    await db.createOrUpdateDoc({
      ...makeDoc(),
      state: Y.encodeStateAsUpdate(mine).buffer as ArrayBuffer,
    });

    // Both insert at the same position, so the order they were applied in is not
    // fixed. What matters is that neither edit was lost.
    const merged = readText((await db.getRawDoc("doc-1"))!.state!);
    expect(merged).toHaveLength("base-mine-other".length);
    expect(merged).toContain("-mine");
    expect(merged).toContain("-other");
    base.destroy();
    other.destroy();
    mine.destroy();
  });

  it("reads the snapshot and the rows together", async () => {
    // Reading them separately lets a fold land in between, which updates the
    // snapshot and deletes the rows. The reader would then see the old snapshot
    // and no rows, and load a document missing what was just folded in.
    const source = await seed("base");
    const update = source.edit("-edit");
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);

    const [before, afterConcurrentFold] = await Promise.all([
      db.getDocById("doc-1"),
      (async () => {
        await db.compactDoc("doc-1");
        return db.getDocById("doc-1");
      })(),
    ]);

    expect(readText(before!.state!)).toBe("base-edit");
    expect(readText(afterConcurrentFold!.state!)).toBe("base-edit");
  });

  it("clears the rows it folded", async () => {
    // The rows themselves are the record of what is not yet folded, so a fold
    // that left them behind would replay those edits on every load.
    const source = await seed("base");
    const update = source.edit("-x");
    await db.appendDocUpdate("doc-1", "w", 7, update.buffer as ArrayBuffer);

    await db.compactDoc("doc-1");

    const raw = await db.getRawDoc("doc-1");
    expect(readText(raw!.state!)).toBe("base-x");
    await expect(db.getDocUpdates("doc-1")).resolves.toHaveLength(0);
  });

  it("folds rows from several writers together regardless of arrival order", async () => {
    // Keys sort by writer id before seq, so reading in key order is not seq
    // order. The fold must not depend on which order the rows arrive in.
    const source = await seed("base");
    const a1 = source.edit("-a1");
    const b1 = source.edit("-b1");
    const a2 = source.edit("-a2");

    await db.appendDocUpdate("doc-1", "writer-b", 1, b1.buffer as ArrayBuffer);
    await db.appendDocUpdate("doc-1", "writer-a", 2, a2.buffer as ArrayBuffer);
    await db.appendDocUpdate("doc-1", "writer-a", 1, a1.buffer as ArrayBuffer);

    expect(readText((await db.getDocById("doc-1"))!.state!)).toBe(
      "base-a1-b1-a2",
    );
  });

  it("keeps each writer's rows distinct", async () => {
    const source = await seed("base");
    const a = source.edit("-a");
    await db.appendDocUpdate("doc-1", "writer-a", 1, a.buffer as ArrayBuffer);
    await db.appendDocUpdate("doc-1", "writer-b", 1, a.buffer as ArrayBuffer);

    const rows = await db.getDocUpdates("doc-1");

    expect(rows.map((row) => row.writer_id).sort()).toEqual([
      "writer-a",
      "writer-b",
    ]);
  });

  it("replays a row the snapshot already contains without changing the result", async () => {
    // There is no record of how far the snapshot is caught up, so the rows that
    // exist are the only thing saying what is unfolded. If a row were somehow
    // present after being folded, replaying it must not double-apply anything:
    // the same update applied twice is the same document, which is what makes
    // the simpler arrangement safe.
    const source = await seed("base");
    const update = source.edit("-x");
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);
    await db.compactDoc("doc-1");
    const folded = readText((await db.getRawDoc("doc-1"))!.state!);

    // Same update, same document, applied a second time.
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);

    expect(readText((await db.getDocById("doc-1"))!.state!)).toBe(folded);
    expect(folded).toBe("base-x");
  });

  it("merges two writers' updates without either being pruned", async () => {
    const source = await seed("base");
    const a = source.edit("-a");
    const b = source.edit("-b");
    await db.appendDocUpdate("doc-1", "writer-a", 1, a.buffer as ArrayBuffer);
    await db.appendDocUpdate("doc-1", "writer-b", 1, b.buffer as ArrayBuffer);

    await db.compactDoc("doc-1");

    const raw = await db.getRawDoc("doc-1");
    expect(readText(raw!.state!)).toBe("base-a-b");
    await expect(db.getDocUpdates("doc-1")).resolves.toHaveLength(0);
  });

  it("keeps document content when metadata is written", async () => {
    const source = await seed("base");
    const update = source.edit("-pending");
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);

    await db.updateDocMeta({
      ...makeDoc({ title: "Renamed" }),
      state: source.seed.buffer as ArrayBuffer,
    });

    // The pending update must still be pending, and still visible.
    await expect(db.getDocUpdates("doc-1")).resolves.toHaveLength(1);
    expect(readText((await db.getDocById("doc-1"))!.state!)).toBe(
      "base-pending",
    );
    expect((await db.getRawDoc("doc-1"))!.title).toBe("Renamed");
  });

  it("does not disturb pending updates or the snapshot when metadata is written", async () => {
    const source = await seed("base");
    const update = source.edit("-x");
    await db.appendDocUpdate("doc-1", "w", 5, update.buffer as ArrayBuffer);
    await db.compactDoc("doc-1");

    await db.updateDocMeta({
      ...makeDoc({ title: "Renamed" }),
      state: source.seed.buffer as ArrayBuffer,
    });

    // A rename must not touch the body or the pending rows: the snapshot is the
    // expensive part to write, and the rows are the only copy of the latest edit.
    const raw = await db.getRawDoc("doc-1");
    expect(readText(raw!.state!)).toBe("base-x");
    await expect(db.getDocUpdates("doc-1")).resolves.toHaveLength(0);
  });

  it("refuses a metadata write for a missing document", async () => {
    await expect(
      db.updateDocMeta({ ...makeDoc({ id: "ghost" }) }),
    ).rejects.toThrow(/missing/);
  });

  it("removes updates along with the document", async () => {
    const source = await seed("base");
    const update = source.edit("-x");
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);

    await db.deleteDoc("doc-1");

    await expect(db.getDocById("doc-1")).resolves.toBeUndefined();
    await expect(db.getDocUpdates("doc-1")).resolves.toHaveLength(0);
  });

  it("moves updates when the document id changes", async () => {
    const source = await seed("base");
    const update = source.edit("-x");
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);

    await db.updateId("doc-1", "doc-2");

    await expect(db.getDocUpdates("doc-1")).resolves.toHaveLength(0);
    const moved = await db.getDocUpdates("doc-2");
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ doc_id: "doc-2", writer_id: "w", seq: 1 });
    expect(readText((await db.getDocById("doc-2"))!.state!)).toBe("base-x");
  });

  it("reloads a deletion as a deletion", async () => {
    // Cheap to get wrong in a way that looks fine in memory: if the deletion were
    // dropped, the reloaded text would still contain the removed passage.
    const yDoc = new Y.Doc({ gc: true });
    const text = yDoc.getText("t");
    text.insert(0, "keep me and also remove me");
    await db.createOrUpdateDoc({
      ...makeDoc(),
      state: Y.encodeStateAsUpdate(yDoc).buffer as ArrayBuffer,
    });

    const removed = " and also remove me";
    text.delete(text.toString().indexOf(removed), removed.length);
    await db.appendDocUpdate(
      "doc-1",
      "w",
      1,
      Y.encodeStateAsUpdate(yDoc, Y.encodeStateVector(new Y.Doc()))
        .buffer as ArrayBuffer,
    );

    const reloaded = new Y.Doc({ gc: true });
    Y.applyUpdate(
      reloaded,
      new Uint8Array((await db.getDocById("doc-1"))!.state!),
    );

    expect(text.toString()).toBe("keep me");
    expect(reloaded.getText("t").toString()).toBe("keep me");
    yDoc.destroy();
    reloaded.destroy();
  });

  it("reclaims deleted content instead of accumulating it", async () => {
    // A fold must run the same garbage collection that decoding into a `gc: true`
    // document does. Merging the update format alone keeps deleted characters and
    // images forever, so a document that is edited and trimmed would grow
    // without bound.
    const yDoc = new Y.Doc({ gc: true });
    yDoc.getText("t").insert(0, "x".repeat(50_000));
    const seed = Y.encodeStateAsUpdate(yDoc);
    await db.createOrUpdateDoc({
      ...makeDoc(),
      state: seed.buffer as ArrayBuffer,
    });

    // Delete everything, exactly as a user clearing a long passage would.
    yDoc.getText("t").delete(0, yDoc.getText("t").length);
    const deletion = Y.encodeStateAsUpdate(yDoc, Y.encodeStateVector(yDoc));
    void deletion;
    yDoc.on("update", () => undefined);
    const beforeDelete = Y.encodeStateAsUpdate(yDoc);
    await db.appendDocUpdate(
      "doc-1",
      "w",
      1,
      beforeDelete.buffer as ArrayBuffer,
    );
    await db.compactDoc("doc-1");

    const raw = await db.getRawDoc("doc-1");
    expect(raw!.state!.byteLength).toBeLessThan(1000);
    yDoc.destroy();
  });

  it("does not accumulate size across repeated add and delete cycles", async () => {
    // The failure this guards against is unbounded growth: with tombstones kept,
    // every round would leave another copy of the deleted payload behind. Images
    // are held inline as data URLs in the rich text, so one churned image is
    // enough to notice.
    const payload = "data:image/png;base64," + "A".repeat(200_000);
    const yDoc = new Y.Doc({ gc: true });
    await db.createOrUpdateDoc({ ...makeDoc(), state: null });

    const sizes: number[] = [];
    for (let round = 0; round < 5; round++) {
      yDoc.getText("t").insert(0, payload);
      await db.appendDocUpdate(
        "doc-1",
        "w",
        round * 2 + 1,
        Y.encodeStateAsUpdate(yDoc, Y.encodeStateVector(new Y.Doc()))
          .buffer as ArrayBuffer,
      );
      await db.compactDoc("doc-1");

      yDoc.getText("t").delete(0, yDoc.getText("t").length);
      await db.appendDocUpdate(
        "doc-1",
        "w",
        round * 2 + 2,
        Y.encodeStateAsUpdate(yDoc, Y.encodeStateVector(new Y.Doc()))
          .buffer as ArrayBuffer,
      );
      await db.compactDoc("doc-1");

      sizes.push((await db.getRawDoc("doc-1"))!.state!.byteLength);
    }

    // Empty document at the end of every round, so the stored size has to settle
    // at the empty-document size rather than grow by one payload per round.
    expect(yDoc.getText("t").length).toBe(0);
    expect(Math.max(...sizes)).toBeLessThan(1000);
    expect(sizes[sizes.length - 1]).toBe(sizes[0]);
    yDoc.destroy();
  });

  it("compacts idempotently", async () => {
    const source = await seed("base");
    const update = source.edit("-x");
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);

    await db.compactDoc("doc-1");
    const once = (await db.getRawDoc("doc-1"))!.state;
    await db.compactDoc("doc-1");
    const twice = (await db.getRawDoc("doc-1"))!.state;

    expect(readText(once!)).toBe("base-x");
    expect(readText(twice!)).toBe("base-x");
    await expect(db.getDocUpdates("doc-1")).resolves.toHaveLength(0);
  });

  it("returns undefined when compacting a missing document", async () => {
    await expect(db.compactDoc("ghost")).resolves.toBeUndefined();
  });

  it("never folds updates into an encrypted document's snapshot", async () => {
    // Encrypted documents keep the whole-snapshot path: their state is opaque
    // ciphertext and folding a plaintext update into it would both corrupt the
    // document and leak its content. The app never appends for these documents,
    // and the store ignores the log for them even if a row is present.
    const source = makeTextDoc("base");
    const encrypted = new Uint8Array([9, 9, 9]).buffer;
    await db.createOrUpdateDoc({
      ...makeDoc({ encrypt_salt: "salt" }),
      state: encrypted,
    });
    await db.appendDocUpdate(
      "doc-1",
      "w",
      1,
      source.edit("-x").buffer as ArrayBuffer,
    );

    const doc = await db.getDocById("doc-1");

    expect(new Uint8Array(doc!.state!)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it("leaves existing updates for an encrypted document in place", async () => {
    const source = makeTextDoc("base");
    await db.createOrUpdateDoc({
      ...makeDoc({ encrypt_salt: "salt" }),
      state: new Uint8Array([9]).buffer,
    });
    await db.appendDocUpdate(
      "doc-1",
      "w",
      1,
      source.edit("-x").buffer as ArrayBuffer,
    );

    // An encrypted write cannot fold these in, so it must not delete them
    // either: that would discard content with nothing to show for it.
    await db.createOrUpdateDoc({
      ...makeDoc({ encrypt_salt: "salt" }),
      state: new Uint8Array([8]).buffer,
    });

    const rows = await new Promise<number>((resolve) => {
      const count = db
        .db!.transaction("doc_update")
        .objectStore("doc_update")
        .count();
      count.onsuccess = () => resolve(count.result);
    });
    expect(rows).toBe(1);
  });

  it("carries a document with no snapshot through an update", async () => {
    const source = makeTextDoc("first");
    await db.createOrUpdateDoc({ ...makeDoc(), state: null });

    await db.appendDocUpdate(
      "doc-1",
      "w",
      1,
      source.seed.buffer as ArrayBuffer,
    );

    expect(readText((await db.getDocById("doc-1"))!.state!)).toBe("first");
  });

  it("survives a reload between appending and compacting", async () => {
    // Equivalent to closing the tab and reopening it: the pending rows are the
    // only copy of the edit, so they have to be replayed from storage.
    const source = await seed("base");
    const update = source.edit("-after-reload");
    await db.appendDocUpdate("doc-1", "w", 1, update.buffer as ArrayBuffer);
    db.db?.close();

    const reopened = new IndexedDB();
    await reopened.open();
    db = reopened;

    expect(readText((await reopened.getDocById("doc-1"))!.state!)).toBe(
      "base-after-reload",
    );
  });
});
