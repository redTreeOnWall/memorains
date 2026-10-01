import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("../doc-types/docTypeRegistry", () => ({
  docTypeRoute: () => "document",
  getDocTypePlugin: () => undefined,
}));

import {
  FOLD_AFTER_QUIET_MS,
  HOT_WINDOW_MS,
  NoteDocument,
} from "./NoteDocument";
import type { Bridge, Editor } from "./NoteDocument";
import { BindableProperty } from "../utils/BindableProperty";
import { DocType, DocumentPublic } from "../interface/DataEntity";
import type { DocumentEntity } from "../interface/DataEntity";

/**
 * When the fold is scheduled.
 *
 * Driven through a stubbed store and fake timers, so the only thing under test is
 * the scheduling decision. The real store plus fake timers is a bad pairing:
 * fake-indexeddb schedules its callbacks with the same timer primitives the test
 * fakes, so the two deadlock instead of testing anything.
 *
 * The fold is what keeps a snapshot from going stale, and a document that never
 * folds keeps every deleted byte, so "it eventually runs" is worth asserting.
 */

const DOC_ID = "doc-1";

const makeState = (text: string) => {
  const yDoc = new Y.Doc();
  yDoc.getText("t").insert(0, text);
  const state = Y.encodeStateAsUpdate(yDoc).buffer as ArrayBuffer;
  yDoc.destroy();
  return state;
};

const editor = {
  onInit: () => undefined,
  onOfflineLoaded: () => undefined,
  onConnected: () => undefined,
  onDisconnected: () => undefined,
  onReconnecting: () => undefined,
  onReconnectFailed: () => undefined,
  getOrigin: () => "test-editor",
  getHttpRequest: () => (() => Promise.resolve(null)) as never,
  setLoading: () => undefined,
  setDocInfo: () => undefined,
  setUserListMessage: () => undefined,
  setSynchronized: () => undefined,
  setSaving: () => undefined,
  setNeedSave: () => undefined,
} as unknown as Editor;

const bridge: Bridge = {
  initBridge: () => undefined,
  ensureConnected: () => Promise.resolve(false),
  wsInstance: null,
  addMessageListener: () => undefined,
  removeMessageListener: () => undefined,
  close: () => undefined,
};

type StubStore = {
  appendedRows: number;
  compactions: number;
  fullWrites: number;
  createOrUpdateDoc: () => Promise<void>;
  getRawDoc: () => Promise<DocumentEntity | undefined>;
  readDocAndUpdates: () => Promise<{
    doc: DocumentEntity | undefined;
    rows: never[];
  }>;
  getDocUpdates: () => Promise<never[]>;
  appendDocUpdate: () => Promise<void>;
  compactDoc: () => Promise<DocumentEntity | undefined>;
};

const makeStore = (): StubStore => {
  const row: DocumentEntity = {
    id: DOC_ID,
    title: "Test note",
    user_id: "user-1",
    create_date: "2026-01-01 10:00:00",
    last_modify_date: "2026-01-02 10:00:00",
    state: makeState("base"),
    is_public: DocumentPublic.private,
    commit_id: 1,
    doc_type: DocType.text,
  } as DocumentEntity & DocumentEntity;

  const store: StubStore = {
    appendedRows: 0,
    compactions: 0,
    fullWrites: 0,
    createOrUpdateDoc: () => {
      store.fullWrites += 1;
      return Promise.resolve();
    },
    getRawDoc: () => Promise.resolve(row),
    readDocAndUpdates: () => Promise.resolve({ doc: row, rows: [] as never[] }),
    getDocUpdates: () => Promise.resolve([]),
    appendDocUpdate: () => {
      store.appendedRows += 1;
      return Promise.resolve();
    },
    compactDoc: () => {
      store.compactions += 1;
      return Promise.resolve(row);
    },
  };
  return store;
};

const makeInstance = (store: StubStore, autoSave = true) => {
  const client = {
    db: store,
    offlineMode: new BindableProperty(false),
    setting: {
      properties: { autoSaveToLocal: new BindableProperty(autoSave) },
    },
  } as never;
  return new NoteDocument(editor, bridge, DOC_ID, client);
};

describe("fold scheduling", () => {
  let store: StubStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = makeStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("appends within the hot window", async () => {
    const instance = makeInstance(store);
    await instance.init();

    instance.yDoc.getText("t").insert(4, "-edit");
    await vi.advanceTimersByTimeAsync(300);

    expect(store.appendedRows).toBe(1);
  });

  it("folds once editing has paused", async () => {
    const instance = makeInstance(store);
    await instance.init();

    instance.yDoc.getText("t").insert(4, "-edit");
    await vi.advanceTimersByTimeAsync(300);
    expect(store.compactions).toBe(0);

    // Nothing else happens here: only the timer can cause the fold, so a
    // snapshot that is never folded is a document that keeps every deleted byte.
    await vi.advanceTimersByTimeAsync(
      HOT_WINDOW_MS + FOLD_AFTER_QUIET_MS + 100,
    );
    expect(store.compactions).toBe(1);
  });

  it("folds a deletion the same way", async () => {
    const instance = makeInstance(store);
    await instance.init();

    instance.yDoc.getText("t").delete(0, 4);
    await vi.advanceTimersByTimeAsync(300);
    expect(store.appendedRows).toBe(1);

    await vi.advanceTimersByTimeAsync(
      HOT_WINDOW_MS + FOLD_AFTER_QUIET_MS + 100,
    );
    expect(store.compactions).toBe(1);
  });

  it("keeps folding after the first fold", async () => {
    const instance = makeInstance(store);
    await instance.init();

    instance.yDoc.getText("t").insert(4, "-one");
    await vi.advanceTimersByTimeAsync(
      HOT_WINDOW_MS + FOLD_AFTER_QUIET_MS + 100,
    );
    expect(store.compactions).toBe(1);

    instance.yDoc.getText("t").insert(8, "-two");
    await vi.advanceTimersByTimeAsync(
      HOT_WINDOW_MS + FOLD_AFTER_QUIET_MS + 100,
    );
    // A scheduler that only ever folded once would leave later edits unfolded.
    expect(store.compactions).toBe(2);
  });

  it("pushes the fold back while editing continues", async () => {
    // The point of the debounce: folding is O(document size), so it must not run
    // between keystrokes. Typing every 3s with a 5s quiet period means no fold.
    const instance = makeInstance(store);
    await instance.init();

    for (let i = 0; i < 4; i++) {
      instance.yDoc.getText("t").insert(0, "x");
      await vi.advanceTimersByTimeAsync(3_000);
    }

    expect(store.appendedRows).toBe(4);
    expect(store.compactions).toBe(0);

    // Once the typing stops, it folds.
    await vi.advanceTimersByTimeAsync(
      HOT_WINDOW_MS + FOLD_AFTER_QUIET_MS + 100,
    );
    expect(store.compactions).toBe(1);
  });

  it("still folds when an automatic save flushed first", async () => {
    // The auto-save throttle runs its function immediately, so it flushes the
    // buffer before the hot-window timer can. That path must still leave a fold
    // scheduled: losing it left the snapshot permanently unfolded, so a deleted
    // passage was never reclaimed.
    const instance = makeInstance(store);
    await instance.init();

    instance.yDoc.getText("t").delete(0, 4);
    instance.askAutoSavingLocal();
    await vi.advanceTimersByTimeAsync(300);

    expect(store.appendedRows).toBe(1);
    expect(store.compactions).toBe(0);

    await vi.advanceTimersByTimeAsync(
      HOT_WINDOW_MS + FOLD_AFTER_QUIET_MS + 100,
    );
    expect(store.compactions).toBe(1);
  });

  it("keeps nothing in memory while automatic saving is off", async () => {
    const instance = makeInstance(store, false);
    await instance.init();

    // A pasted image can be megabytes, and it is already held by the document,
    // so holding a second copy until the user saves would be wasted memory.
    instance.yDoc.getText("t").insert(0, "x".repeat(4 * 1024 * 1024));
    await vi.advanceTimersByTimeAsync(1_000);

    const buffered = (instance as unknown as { pendingUpdates: Uint8Array[] })
      .pendingUpdates.length;
    expect(buffered).toBe(0);
    expect(store.appendedRows).toBe(0);
  });

  it("writes a full snapshot when the user saves", async () => {
    const instance = makeInstance(store, false);
    await instance.init();

    instance.yDoc.getText("t").insert(4, "-edit");
    await vi.advanceTimersByTimeAsync(1_000);

    instance.trySaveLocal();
    await vi.advanceTimersByTimeAsync(6_000);

    // A full write, not an appended row: the snapshot has to catch up before the
    // log can carry later edits again.
    expect(store.fullWrites).toBe(1);
    expect(store.appendedRows).toBe(0);
  });

  it("resumes logging only after that full write", async () => {
    // The log's rows are replayed on top of the snapshot. A row that skipped the
    // edits made while automatic saving was off would leave a hole, so replaying
    // the snapshot plus the rows would not reconstruct the document.
    const instance = makeInstance(store, false);
    await instance.init();

    instance.yDoc.getText("t").insert(4, "-unsaved");
    await vi.advanceTimersByTimeAsync(1_000);

    (
      instance as unknown as {
        client: {
          setting: { properties: { autoSaveToLocal: { value: boolean } } };
        };
      }
    ).client.setting.properties.autoSaveToLocal.value = true;

    // Still nothing appended, because the snapshot is behind.
    instance.yDoc.getText("t").insert(12, "-after");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.appendedRows).toBe(0);

    instance.trySaveLocal();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(store.fullWrites).toBe(1);

    // Once the snapshot holds everything, appending is safe again.
    instance.yDoc.getText("t").insert(0, "-later");
    await vi.advanceTimersByTimeAsync(300);
    expect(store.appendedRows).toBe(1);
  });
});
