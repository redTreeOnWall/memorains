import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import * as Y from "yjs";

// The import chain below reaches the doc type registry, which pulls in
// Excalidraw and MUI. None of that is involved in persistence, and loading it
// in node fails on a JSON import inside Excalidraw's dependencies.
vi.mock("../doc-types/docTypeRegistry", () => ({
  docTypeRoute: () => "document",
  getDocTypePlugin: () => undefined,
}));

import { IndexedDB } from "../DB/IndexedDB";
import { NoteDocument } from "./NoteDocument";
import type { Editor, Bridge } from "./NoteDocument";
import { DocumentPublic, DocType } from "../interface/DataEntity";
import type { DocumentEntity } from "../interface/DataEntity";
import { BindableProperty } from "../utils/BindableProperty";
import {
  deriveAESKey,
  encryptData,
  decryptData,
  exportKeyToBase64,
  setCryptoKeyToLocal,
} from "../utils/utils";

/**
 * The incremental save path in `NoteDocument`.
 *
 * These cover the decisions the store cannot: when an edit is written down, when
 * it is folded into the snapshot, and what is replayed on load. The interesting
 * failures here are silent, so most assertions are about what survives rather
 * than about return values.
 */

const DB_NAME = "document";
const DOC_ID = "doc-1";

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });

const doc = (overrides: Partial<DocumentEntity> = {}): DocumentEntity => ({
  id: DOC_ID,
  title: "Test note",
  user_id: "user-1",
  create_date: "2026-01-01 10:00:00",
  last_modify_date: "2026-01-02 10:00:00",
  state: null,
  is_public: DocumentPublic.private,
  commit_id: 1,
  doc_type: DocType.text,
  ...overrides,
});

/** Minimal stand-ins for the editor and socket layers. */
const makeEditor = () => {
  const origins = { current: "test-editor" as unknown };
  const editor: Editor & {
    docInfo: Omit<DocumentEntity, "state"> | null;
    needSave: boolean;
    saving: boolean;
  } = {
    docInfo: null,
    needSave: false,
    saving: false,
    onInit: () => undefined,
    onOfflineLoaded: () => undefined,
    onConnected: () => undefined,
    onDisconnected: () => undefined,
    onReconnecting: () => undefined,
    onReconnectFailed: () => undefined,
    getOrigin: () => origins.current,
    getHttpRequest: () => (() => Promise.resolve(null)) as never,
    setLoading: () => undefined,
    setDocInfo: () => undefined,
    setUserListMessage: () => undefined,
    setSynchronized: () => undefined,
    setSaving: (value: boolean) => {
      editor.saving = value;
    },
    setNeedSave: (value: boolean) => {
      editor.needSave = value;
    },
  };
  return { editor, origins };
};

const makeBridge = (): Bridge => ({
  initBridge: () => undefined,
  ensureConnected: () => Promise.resolve(false),
  wsInstance: null,
  addMessageListener: () => undefined,
  removeMessageListener: () => undefined,
  close: () => undefined,
});

const readText = (state: ArrayBuffer | null | undefined) => {
  const yDoc = new Y.Doc();
  if (state?.byteLength) {
    Y.applyUpdate(yDoc, new Uint8Array(state));
  }
  const text = yDoc.getText("t").toString();
  yDoc.destroy();
  return text;
};

/** Build a document whose snapshot holds `initial`, as a seed update. */
const seedState = (initial: string) => {
  const yDoc = new Y.Doc();
  yDoc.getText("t").insert(0, initial);
  const state = Y.encodeStateAsUpdate(yDoc).buffer as ArrayBuffer;
  yDoc.destroy();
  return state;
};

const makeClient = (db: IndexedDB) =>
  ({
    db,
    offlineMode: new BindableProperty(false),
    setting: { properties: { autoSaveToLocal: new BindableProperty(true) } },
  }) as never;

/** Construct a loaded NoteDocument without going through the network paths. */
const loadDocument = async (db: IndexedDB, seed: string) => {
  await db.createOrUpdateDoc(doc({ state: seedState(seed) }));
  const { editor, origins } = makeEditor();
  const instance = new NoteDocument(
    editor,
    makeBridge(),
    DOC_ID,
    makeClient(db),
  );
  await instance.init();
  return { instance, editor, origins };
};

describe("NoteDocument incremental save", () => {
  let db: IndexedDB;

  beforeEach(async () => {
    await deleteDatabase(DB_NAME);
    db = new IndexedDB();
    await db.open();
  });

  afterEach(() => {
    db.db?.close();
  });

  describe("appending edits", () => {
    it("writes an edit to the log without touching the snapshot", async () => {
      const { instance } = await loadDocument(db, "base");
      const before = await db.getRawDoc(DOC_ID);

      instance.yDoc.getText("t").insert(4, "-edit");
      await instance.flushLog();

      const after = await db.getRawDoc(DOC_ID);
      expect(after!.state!.byteLength).toBe(before!.state!.byteLength);
      await expect(db.getDocUpdates(DOC_ID)).resolves.toHaveLength(1);
      // The edit is already readable through the normal accessor.
      expect(readText((await db.getDocById(DOC_ID))!.state!)).toBe("base-edit");
    });

    it("collapses a burst of edits into one row", async () => {
      const { instance } = await loadDocument(db, "base");

      for (const chunk of ["-a", "-b", "-c"]) {
        instance.yDoc
          .getText("t")
          .insert(instance.yDoc.getText("t").length, chunk);
      }
      await instance.flushLog();

      // Row count is what replay cost scales with, so a burst must not cost a
      // row per keystroke.
      const rows = await db.getDocUpdates(DOC_ID);
      expect(rows).toHaveLength(1);
      expect(readText((await db.getDocById(DOC_ID))!.state!)).toBe(
        "base-a-b-c",
      );
    });

    it("assigns increasing seqs to successive flushes", async () => {
      const { instance } = await loadDocument(db, "base");

      instance.yDoc.getText("t").insert(4, "-1");
      await instance.flushLog();
      instance.yDoc.getText("t").insert(6, "-2");
      await instance.flushLog();

      const rows = await db.getDocUpdates(DOC_ID);
      expect(rows.map((row) => row.seq)).toEqual([1, 2]);
    });

    it("keeps remote edits in the log", async () => {
      const { instance } = await loadDocument(db, "base");

      // A collaborator received the same seed and typed after it. Their update
      // carries its own history, so it applies cleanly on this side.
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(instance.yDoc));
      remote.getText("t").insert(4, "-remote");
      const fromRemote = Y.encodeStateAsUpdate(
        remote,
        Y.encodeStateVector(instance.yDoc),
      );
      Y.applyUpdate(instance.yDoc, fromRemote, "remote");
      await instance.flushLog();

      // Offline reopen has to show a collaborator's work, so it is persisted
      // like any other change rather than being dropped as a non-local edit.
      await expect(db.getDocUpdates(DOC_ID)).resolves.toHaveLength(1);
      expect(readText((await db.getDocById(DOC_ID))!.state!)).toBe(
        "base-remote",
      );
      remote.destroy();
    });
  });

  describe("rebuilding on load", () => {
    it("replays pending rows on top of the snapshot", async () => {
      const first = await loadDocument(db, "base");
      first.instance.yDoc.getText("t").insert(4, "-pending");
      await first.instance.flushLog();

      // A fresh instance is the same thing a page reload produces.
      const { editor } = makeEditor();
      const reloaded = new NoteDocument(
        editor,
        makeBridge(),
        DOC_ID,
        makeClient(db),
      );
      await reloaded.init();

      expect(readText(Y.encodeStateAsUpdate(reloaded.yDoc).buffer)).toBe(
        "base-pending",
      );
    });

    it("replays rows from every writer, not only its own", async () => {
      // Another tab's rows are the only copy of its unsaved edits, so a load
      // that skipped them would silently drop that work.
      const first = await loadDocument(db, "base");
      first.instance.yDoc.getText("t").insert(4, "-from-other-tab");
      await first.instance.flushLog();

      const { editor } = makeEditor();
      const reloaded = new NoteDocument(
        editor,
        makeBridge(),
        DOC_ID,
        makeClient(db),
      );
      await reloaded.init();

      expect(readText(Y.encodeStateAsUpdate(reloaded.yDoc).buffer)).toBe(
        "base-from-other-tab",
      );
    });

    it("does not re-append replayed rows", async () => {
      const first = await loadDocument(db, "base");
      first.instance.yDoc.getText("t").insert(4, "-x");
      await first.instance.flushLog();

      // Replaying must not look like a new edit, or every open would double the
      // log until the document became slow to open.
      const { editor } = makeEditor();
      const reloaded = new NoteDocument(
        editor,
        makeBridge(),
        DOC_ID,
        makeClient(db),
      );
      await reloaded.init();

      // The load fold started by `init` is what removes the replayed rows, so it
      // has to settle before the log can be counted.
      await reloaded.loadFold;
      const before = (await db.getDocUpdates(DOC_ID)).length;
      await reloaded.flushLog();
      await expect(db.getDocUpdates(DOC_ID)).resolves.toHaveLength(before);
    });

    it("captures an update that arrives while the document is loading", async () => {
      // `initBridge` is not awaited, so a socket message can land before the
      // snapshot has been read. Registering the listener late would drop it, and
      // the edit would be applied to memory but never written down.
      await db.createOrUpdateDoc(doc({ state: seedState("base") }));

      const { editor } = makeEditor();
      const instance = new NoteDocument(
        editor,
        makeBridge(),
        DOC_ID,
        makeClient(db),
      );

      // Emit during the load, after the listener is attached but before the
      // document is marked ready.
      const initPromise = instance.init();
      const remote = new Y.Doc();
      remote.getText("t").insert(0, "from-collaborator");
      Y.applyUpdate(instance.yDoc, Y.encodeStateAsUpdate(remote), "remote");
      await initPromise;

      await expect(db.getDocUpdates(DOC_ID)).resolves.toHaveLength(1);
      const rows = await db.getDocUpdates(DOC_ID);
      expect(readText(rows[0].update)).toBe("from-collaborator");
      remote.destroy();
    });

    it("opens an empty document that has no local row yet", async () => {
      const { editor } = makeEditor();
      const instance = new NoteDocument(
        editor,
        makeBridge(),
        DOC_ID,
        makeClient(db),
      );

      await instance.init();

      expect(instance.offlineDataLoaded.value).toBe(true);
      await expect(db.getRawDoc(DOC_ID)).resolves.toBeUndefined();
    });
  });

  describe("folding into the snapshot", () => {
    it("folds on an explicit save and clears the log", async () => {
      const { instance } = await loadDocument(db, "base");
      instance.yDoc.getText("t").insert(4, "-saved");
      await instance.flushLog();
      await expect(db.getDocUpdates(DOC_ID)).resolves.toHaveLength(1);

      instance.trySaveLocal();
      await vi.waitFor(async () => {
        expect(await db.getDocUpdates(DOC_ID)).toHaveLength(0);
      });

      const raw = await db.getRawDoc(DOC_ID);
      expect(readText(raw!.state!)).toBe("base-saved");
      // No rows left, so the snapshot alone is the whole document now.
      await expect(db.getDocUpdates(DOC_ID)).resolves.toHaveLength(0);
    });

    it("refreshes last_modify_date when it folds", async () => {
      const { instance } = await loadDocument(db, "base");
      const before = (await db.getRawDoc(DOC_ID))!.last_modify_date;

      instance.yDoc.getText("t").insert(4, "-x");
      await instance.flushLog();
      instance.trySaveLocal();
      await vi.waitFor(async () => {
        expect(await db.getDocUpdates(DOC_ID)).toHaveLength(0);
      });

      // Document lists sort on this field, so a fold that left it stale would
      // make an edited note look untouched.
      const after = (await db.getRawDoc(DOC_ID))!.last_modify_date;
      expect(after).not.toBe(before);
    });

    it("does not fold on an automatic save", async () => {
      const { instance } = await loadDocument(db, "base");
      instance.yDoc.getText("t").insert(4, "-auto");
      await instance.flushLog();

      // Automatic saves run every few seconds; folding there costs time
      // proportional to the document and would stall the editor.
      instance.askAutoSavingLocal();
      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(db.getDocUpdates(DOC_ID)).resolves.toHaveLength(1);
    });

    it("keeps the content readable after folding", async () => {
      const { instance } = await loadDocument(db, "base");
      instance.yDoc.getText("t").insert(4, "-folded");
      await instance.flushLog();
      instance.trySaveLocal();
      await vi.waitFor(async () => {
        expect(await db.getDocUpdates(DOC_ID)).toHaveLength(0);
      });

      const { editor } = makeEditor();
      const reloaded = new NoteDocument(
        editor,
        makeBridge(),
        DOC_ID,
        makeClient(db),
      );
      await reloaded.init();

      expect(readText(Y.encodeStateAsUpdate(reloaded.yDoc).buffer)).toBe(
        "base-folded",
      );
    });
  });

  describe("encrypted documents", () => {
    /**
     * An encrypted document with a stored key, the way the real "remember the
     * password" path leaves things. Without the stored key, decryption opens a
     * password dialog, which cannot be answered in this environment.
     */
    const openEncrypted = async (instance: NoteDocument) => {
      const cryptoKey = await deriveAESKey("pw", "salt");
      await setCryptoKeyToLocal(DOC_ID, await exportKeyToBase64(cryptoKey));
      await instance.init();
    };

    it("never writes to the log", async () => {
      const yDoc = new Y.Doc();
      yDoc.getText("t").insert(0, "secret");
      const plain = Y.encodeStateAsUpdate(yDoc);
      const cipher = await encryptData(
        plain.buffer as ArrayBuffer,
        await deriveAESKey("pw", "salt"),
      );
      yDoc.destroy();

      await db.createOrUpdateDoc({
        ...doc({ encrypt_salt: "salt" }),
        state: cipher,
      });

      const { editor } = makeEditor();
      const instance = new NoteDocument(
        editor,
        makeBridge(),
        DOC_ID,
        makeClient(db),
      );
      await openEncrypted(instance);

      instance.yDoc.getText("t").insert(6, "-more");
      await instance.flushLog();

      // An appended update would be plaintext sitting next to ciphertext, so
      // this path is deliberately unavailable.
      await expect(db.getDocUpdates(DOC_ID)).resolves.toHaveLength(0);
    });

    it("writes the whole snapshot instead", async () => {
      const cryptoKey = await deriveAESKey("pw", "salt");
      const yDoc = new Y.Doc();
      yDoc.getText("t").insert(0, "secret");
      const cipher = await encryptData(
        Y.encodeStateAsUpdate(yDoc).buffer as ArrayBuffer,
        cryptoKey,
      );
      yDoc.destroy();

      await db.createOrUpdateDoc({
        ...doc({ encrypt_salt: "salt" }),
        state: cipher,
      });

      const { editor } = makeEditor();
      const instance = new NoteDocument(
        editor,
        makeBridge(),
        DOC_ID,
        makeClient(db),
      );
      await openEncrypted(instance);
      const before = (await db.getRawDoc(DOC_ID))!.state!.byteLength;

      instance.yDoc.getText("t").insert(6, "-more");
      instance.trySaveLocal();
      await vi.waitFor(async () => {
        expect((await db.getRawDoc(DOC_ID))!.state!.byteLength).not.toBe(
          before,
        );
      });

      // The stored bytes must still be ciphertext that decrypts to the edit.
      const raw = await db.getRawDoc(DOC_ID);
      const decrypted = await decryptData(raw!.state!, cryptoKey);
      expect(readText(decrypted)).toBe("secret-more");
    });
  });
});
