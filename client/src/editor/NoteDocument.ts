import * as Y from "yjs";
import type { useHttpRequest } from "../hooks/hooks";
import { AwaitableThrottle, encryptData, randomInt } from "../utils/utils";
import { DocumentEntity } from "../interface/DataEntity";
import {
  C2S_UpdateDocMessage,
  ClientMessageType,
  S2C_UserListMessage,
  ServerMessage,
} from "../interface/UserServerMessage";
import { Base64 } from "js-base64";
import type { Client } from "..";
import { BindableProperty } from "../utils/BindableProperty";
import { decryptDocData } from "../utils/docData";
import moment from "moment";
import { GlobalSnackBar } from "../components/common/GlobalSnackBar";

const LOAD_ORIGIN = "load-offline";

/** Crash-loss window, and what collapses a burst of keystrokes into one row. */
export const HOT_WINDOW_MS = 250;

/** Editing must pause this long before folding, which is O(document size). */
export const FOLD_AFTER_QUIET_MS = 30_000;

export interface Editor {
  onInit: (doc: NoteDocument) => void;
  onOfflineLoaded: () => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onReconnecting: () => void;
  onReconnectFailed: () => void;
  getOrigin: () => unknown;
  getHttpRequest: () => ReturnType<typeof useHttpRequest>;
  setLoading: (loading: boolean) => void;
  setDocInfo: (docInfo: Omit<DocumentEntity, "state">) => void;
  setUserListMessage: (useList: S2C_UserListMessage) => void;
  setSynchronized: (synchronized: boolean) => void;
  setSaving: (saving: boolean) => void;
  setNeedSave: (canSave: boolean) => void;
}

export type MessageListener = (msg: ServerMessage) => void;

export interface Bridge {
  initBridge: (doc: NoteDocument) => void;
  ensureConnected: () => Promise<boolean>;
  wsInstance: WebSocket | null;

  addMessageListener: (listener: MessageListener) => void;

  removeMessageListener: (listener: MessageListener) => void;

  close: () => void;
}

export class NoteDocument {
  yDoc: Y.Doc;
  commitId = randomInt();
  saveLocal: AwaitableThrottle | null = null;

  cryptoKey: CryptoKey | null = null;

  /**
   * Identifies this editor instance among every tab that may write this
   * document. Update keys embed it so two tabs can never collide, and each tab
   * folds only its own rows into a snapshot.
   */
  readonly writerId =
    randomInt().toString(36) + Math.random().toString(36).slice(2, 8);

  /**
   * Counter for this writer's update keys. Only needs to be unique within this
   * editor instance, because the writer id is minted per instance and is part of
   * the key.
   */
  private localSeq = 0;

  /** Batched so a burst of keystrokes costs one transaction, not one each. */
  private pendingUpdates: Uint8Array[] = [];
  private appendChain: Promise<void> = Promise.resolve();
  private hotTimer: number | null = null;

  /** Set by an explicit save, so that save folds rather than only appending. */
  private foldOnNextSave = false;

  /** Armed by each flush; fires once editing has paused. */
  private foldTimer: number | null = null;
  private compacting = false;

  /**
   * The fold started on load, if it has not finished. Kept because a caller may
   * need it settled: `destroy` cannot write while it is in flight without
   * racing it, and tests reading the log need a definite answer.
   */
  loadFold: Promise<void> = Promise.resolve();

  /**
   * Encrypted documents have no log: their snapshot is ciphertext, so a
   * plaintext row next to it would both corrupt it and leak content. Off until
   * the first snapshot write also establishes that this document has a row.
   */
  private logEnabled = false;

  constructor(
    public editor: Editor,
    public bridge: Bridge,
    public docId: string,
    public client: Client,
    public viewMode = false,
  ) {
    // this.yDoc = new Y.Doc(gc: true);
    this.yDoc = new Y.Doc({ gc: true });
  }

  initd = false;

  async init() {
    this.editor.onInit(this);

    this.editor.setLoading(true);

    // Registered before anything can produce an update, because the socket is
    // opened without being awaited: a message can otherwise arrive and be
    // applied to the document before there is anything listening for it, and
    // that edit would then never reach the log.
    this.yDoc.on("update", this.handleUpdate);

    if (this.viewMode) {
      // TODO if is_public void mode
      const res = await this.editor.getHttpRequest()("getPublicDoc", {
        docID: this.docId,
        needState: true,
      });
      const data = res?.data;
      if (res?.success && data) {
        const base64State = data.doc.state;
        const doc: DocumentEntity = {
          ...data.doc,
          state: base64State
            ? (Base64.toUint8Array(base64State).buffer as ArrayBuffer)
            : null,
        };

        this.applyDocDataToYDoc(doc, "remote");
      } else {
        GlobalSnackBar.getInstance().pushMessage(
          "Can not open this note!",
          "error",
        );
        return;
      }
    } else {
      this.bridge.initBridge(this);
    }

    await this.initOfflineSaver();

    if (!this.viewMode) {
      /**
       * Flush buffered edits to the log.
       *
       * This deliberately does not fold them into the snapshot. Folding costs
       * time proportional to the size of the document, so on a large one it
       * would stall the editor every few seconds. An appended update is already
       * durable, so folding is a storage measure and can wait for an idle
       * window; see `scheduleFold`.
       *
       * Encrypted documents keep the old whole-snapshot write, since their
       * state is ciphertext and cannot take a plaintext update.
       */
      this.saveLocal = new AwaitableThrottle(async () => {
        await this.flushLog();

        if (!this.logEnabled || this.snapshotStale) {
          // A full write is required when the snapshot is behind: either the
          // document is encrypted, or edits were made while automatic saving was
          // off. Both mean the log cannot be used to carry them.
          await this.writeFullSnapshot();
        } else if (this.foldOnNextSave) {
          // Fold only when asked. An automatic save runs every few seconds, and
          // folding costs time proportional to the document, so doing it there
          // would stall the editor on a large document.
          await this.compactNow();
        }
        this.foldOnNextSave = false;

        this.editor.setNeedSave(false);
        this.editor.setSaving(false);
      }, 5000);
    }

    // Anything buffered while loading is written now that the log's usability is
    // known, which covers a collaborator's edit arriving before the snapshot had
    // finished loading. When the log is unusable those edits are not lost: the
    // full snapshot write re-encodes the document, so they are captured there.
    await this.flushLog();

    this.initd = true;
  }

  /**
   * Route an update to the log, and to the socket when it came from the local
   * editor.
   *
   * Bound rather than inline so it can be registered before the load finishes;
   * see where `init` attaches it.
   */
  private handleUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.viewMode) {
      return;
    }

    // Everything except a replay of rows already in storage belongs in the log,
    // including remote edits: otherwise reopening offline would lose whatever
    // collaborators had changed, and this app supports offline use.
    if (origin !== LOAD_ORIGIN) {
      this.appendUpdate(update);
    }

    if (origin === "remote") {
      return;
    }

    if (origin && origin === this.editor.getOrigin()) {
      this.onUpdateFromEditor(update);
    }
  };

  /**
   * Set when an edit was made with automatic saving off, so that edit is in no
   * log row. Logging cannot resume until a full snapshot write clears this: a
   * later row would sit next to a snapshot lacking the edit before it.
   */
  private snapshotStale = false;

  /**
   * Whether edits are written out as they happen, or only when asked.
   *
   * Read through a getter rather than captured, so toggling the setting takes
   * effect without reopening the document.
   */
  private get autoSaveEnabled(): boolean {
    return this.client.setting.properties.autoSaveToLocal.value;
  }

  /**
   * Note an edit, and arrange for it to be written when that is wanted.
   *
   * Nothing is buffered with automatic saving off: the edit lives in the
   * document, and holding a copy as well would keep a pasted image or a long
   * passage in memory for as long as the user leaves it unsaved.
   */
  private appendUpdate(update: Uint8Array): void {
    if (!update.byteLength) {
      return;
    }

    // Nothing is held while automatic saving is off. The edit is in the document
    // already, and an explicit save writes the whole thing, so copying it here
    // would only keep a pasted image in memory until the user gets round to it.
    if (!this.autoSaveEnabled) {
      this.snapshotStale = true;
      return;
    }

    // A copy, because the buffer Yjs hands over is not ours to keep.
    this.pendingUpdates.push(update.slice());

    if (this.hotTimer !== null) {
      return;
    }
    this.hotTimer = window.setTimeout(() => {
      this.hotTimer = null;
      void this.flushLog();
    }, HOT_WINDOW_MS);
  }

  /**
   * Append every buffered update as one row.
   *
   * Merging the buffer first is what keeps the row count proportional to time
   * rather than to keystrokes, and it costs the size of the buffer rather than
   * the size of the document.
   */
  async flushLog(): Promise<void> {
    if (this.hotTimer !== null) {
      window.clearTimeout(this.hotTimer);
      this.hotTimer = null;
    }

    if (!this.pendingUpdates.length) {
      return;
    }
    if (!this.logEnabled || this.snapshotStale) {
      // Nothing may be appended right now: the document is encrypted, or its
      // snapshot is behind, or it has no stored row yet. The buffer is kept
      // rather than taken and dropped, because a full write re-encodes the
      // document and clearing here would lose whatever arrived while that write
      // was in flight. `writeFullSnapshot` is what empties it.
      return;
    }

    const buffered = this.pendingUpdates;
    this.pendingUpdates = [];

    const merged = Y.mergeUpdates(buffered);
    const seq = ++this.localSeq;

    this.appendChain = this.appendChain
      .then(() =>
        this.client.db.appendDocUpdate(
          this.docId,
          this.writerId,
          seq,
          merged.buffer as ArrayBuffer,
        ),
      )
      .catch((error) => {
        // The edit is still in memory, so a failed append is not lost content:
        // the next successful append or a snapshot write still captures it.
        console.error("Failed to append a local update.", error);
      });

    await this.appendChain;
    console.log(`merged and appended log: ${merged.byteLength}`);

    // Scheduled here rather than by the caller, because `flushLog` is reached
    // from several places and one of them used to clear the hot-window timer
    // before it fired, leaving the fold that depends on it never scheduled.
    this.scheduleFold();
  }

  /**
   * Fold pending updates into the snapshot once editing pauses.
   *
   * Folding costs time proportional to the size of the document, so it must not
   * land in the middle of typing. One debounced timer does that: each flush
   * pushes it back, so it only fires after a quiet spell.
   */
  private scheduleFold(): void {
    if (!this.logEnabled || this.snapshotStale) {
      return;
    }
    if (this.foldTimer !== null) {
      window.clearTimeout(this.foldTimer);
    }
    this.foldTimer = window.setTimeout(() => {
      this.foldTimer = null;
      void this.compactNow();
    }, FOLD_AFTER_QUIET_MS);
  }

  /**
   * Fold pending updates into the snapshot and clear them.
   *
   * Also the point where `last_modify_date` is refreshed, because it is the only
   * write that touches the document row. Until this runs, a freshly edited note
   * can look up to one quiet spell older than it is in lists sorted by that
   * field. Keeping it current would mean rewriting the whole row per save, which
   * is exactly the cost this design removes.
   */
  private async compactNow(): Promise<void> {
    if (this.compacting || !this.logEnabled || this.snapshotStale) {
      return;
    }
    this.compacting = true;
    try {
      await this.flushLog();
      const doc = await this.client.db.compactDoc(this.docId, {
        last_modify_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        commit_id: this.commitId,
      });
      console.log(`compacted :  ${doc?.state?.byteLength}`);
    } catch (error) {
      console.error("Failed to fold local updates into the snapshot.", error);
    } finally {
      this.compacting = false;
    }
  }

  /**
   * Write the whole document body.
   *
   * Used for encrypted documents, and for a document with no local row yet —
   * such as one that only exists on the server, where this is what creates the
   * row the update log hangs off.
   */
  private async writeFullSnapshot(): Promise<void> {
    const currentDoc = this.docInfo;
    if (!currentDoc) {
      return;
    }

    // Encoded before the await, so `state` is a snapshot of this moment.
    const state = Y.encodeStateAsUpdate(this.yDoc).buffer as ArrayBuffer;

    // Both cleared synchronously, immediately after the encode, so anything
    // arriving during the write below is recorded as not captured. The buffer
    // emptied here is exactly what the encode above contains. Doing this after
    // the await would let such an edit pass for captured, and the snapshot plus
    // the rows would then no longer rebuild the document.
    this.snapshotStale = false;
    this.pendingUpdates = [];

    const doc: DocumentEntity = {
      ...currentDoc,
      commit_id: this.commitId,
      state,
      last_modify_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
    };

    try {
      if (currentDoc.encrypt_salt) {
        const key = this.cryptoKey;
        if (!key) {
          throw new Error("No cryptoKey!");
        }
        doc.state = await encryptData(state, key);
      }

      await this.client.db.createOrUpdateDoc(doc);
    } catch (error) {
      // Nothing was stored, so whatever was behind still is. Saying so keeps the
      // log unusable until a write actually succeeds.
      this.snapshotStale = true;
      throw error;
    }
    // The row now exists, so later edits can go to the log instead of rewriting
    // the body.
    if (!currentDoc.encrypt_salt) {
      this.logEnabled = true;
    }
  }

  offlineDataLoaded = new BindableProperty(false);

  // TODO remoteDataLoaded = new BindableProperty(boolean);

  async initOfflineSaver() {
    if (!this.viewMode) {
      // Snapshot and rows together, so a fold running concurrently cannot leave
      // this reading an old snapshot with the rows already gone.
      const { doc: docData, rows } = await this.client.db.readDocAndUpdates(
        this.docId,
      );
      if (docData) {
        this.logEnabled = !docData.encrypt_salt;
        await this.applyDocDataToYDoc(docData, LOAD_ORIGIN);

        // Pending updates hold every edit made since the snapshot was last
        // folded, so they have to be replayed on top of it. Rows from every
        // writer are replayed, not just this tab's: another tab's unsaved
        // edits live here too, and this is the only copy of them.
        if (this.logEnabled && rows.length) {
          // One transaction, because applying row by row would emit an update
          // event per row and the handler would try to log each one again.
          Y.transact(
            this.yDoc,
            () => {
              for (const row of rows) {
                Y.applyUpdate(this.yDoc, new Uint8Array(row.update));
              }
            },
            LOAD_ORIGIN,
          );
          // Rows left by a tab that is gone will never be folded by that tab,
          // so this tab takes responsibility for them while it is open. Not
          // awaited: folding is O(document size) and it would hold up the
          // editor becoming usable. `commitState` reads, folds and deletes in
          // one transaction, so an edit arriving meanwhile cannot be lost.
          this.loadFold = this.compactNow();
        }
      }
    }
    this.editor.onOfflineLoaded();
    this.offlineDataLoaded.value = true;
    // this.onLocalDataLoaded?.();
  }

  private async applyDocDataToYDoc(doc: DocumentEntity, origin: string) {
    this.setDocInfo(doc);

    const { data, cryptoKey } = await decryptDocData(doc);

    this.cryptoKey = cryptoKey;

    if (data?.byteLength) {
      Y.applyUpdate(this.yDoc, new Uint8Array(data), origin);
      this.commitId = doc.commit_id;
    }
  }

  onUpdateFromEditor(update: Uint8Array) {
    if (this.viewMode) {
      return;
    }
    this.askAutoSavingLocal();

    const offlineMode = this.client.offlineMode.value;

    if (offlineMode) {
      return;
    }

    if (this.bridge.wsInstance) {
      // WS is alive — send update immediately
      const message: C2S_UpdateDocMessage = {
        messageType: ClientMessageType.updateDoc,
        messageBody: Base64.fromUint8Array(update),
        commitId: this.commitId,
      };
      this.bridge.wsInstance.send(JSON.stringify(message));
    } else {
      // WS is dead — trigger lazy reconnect. All local edits will be synced
      // via the Yjs state vector diff when the connection comes back.
      this.bridge.ensureConnected();
    }
  }

  public docInfo: Omit<DocumentEntity, "state"> | null = null;
  async setDocInfo(docInfo: Omit<DocumentEntity, "state">) {
    this.docInfo = docInfo;
    this.editor.setDocInfo(docInfo);
  }

  trySaveLocal() {
    this.editor.setSaving(true);
    // An explicit save (Ctrl+S, the save button, or the tab being hidden) is the
    // user asking for the document to be checkpointed, so it folds as well as
    // appending. If the fold cannot run now, the idle path still covers it.
    this.foldOnNextSave = true;
    this.saveLocal?.askInvoke();
  }

  askAutoSavingLocal() {
    this.editor.setNeedSave(true);
    if (!this.client.setting.properties.autoSaveToLocal.value) {
      return;
    }
    this.editor.setSaving(true);
    this.saveLocal?.askInvoke();
  }

  destroy() {
    this.bridge.close();
    if (this.hotTimer !== null) {
      window.clearTimeout(this.hotTimer);
      this.hotTimer = null;
    }
    if (this.foldTimer !== null) {
      window.clearTimeout(this.foldTimer);
      this.foldTimer = null;
    }
    // Best effort: the updates are already durable once flushed, so a failure
    // here costs nothing that is not still in memory or in a later snapshot.
    void this.flushLog().catch(() => undefined);
  }
}
