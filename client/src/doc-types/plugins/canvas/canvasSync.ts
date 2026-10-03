import * as Y from "yjs";

/**
 * Pure logic behind the canvas binding.
 *
 * Kept out of the component so the decisions about *what* gets written to the
 * shared document can be tested without a browser. Those rules are what stop two
 * clients from overwriting each other, and a regression in them is invisible to
 * a single-client test: the losing edit is silently gone with nothing thrown.
 */

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * An element as it is stored: JSON-shaped, and not necessarily complete.
 *
 * Deliberately not `ExcalidrawElement`: a document can hold a value written by a
 * different version, so every field has to be treated as optional until it has
 * been checked. `ExcalidrawElement` is a discriminated union too, which makes
 * `Partial<ExcalidrawElement>` distribute over every variant and become
 * unusable. The single cast back happens where the scene is handed to
 * Excalidraw.
 */
export type ElementData = Record<string, unknown>;

/** An `ElementData` that has the two fields Excalidraw requires to render it. */
export type RenderableElementData = ElementData & { id: string; type: string };

/**
 * Viewport lives in `localStorage`, per user and document, not in the `Y.Doc`.
 *
 * It used to be stored in the shared document, which turned every pan and zoom
 * into a document write. A remote viewport update moves this client's scroll
 * too, so the receiving side wrote *its* viewport back, and the two clients
 * bounced the value for as long as they were open — a self-sustaining write
 * loop (with one log row per bounce) that nobody had to be editing to trigger.
 * A viewport is also genuinely private: it says where *this* user is looking, so
 * sharing it never had a meaning.
 */
export const VIEWPORT_KEY_PREFIX = "memorains_canvas_viewport_";

/** Excalidraw's own limits (`MIN_ZOOM`/`MAX_ZOOM`), duplicated to avoid the import. */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;

export const viewportStorageKey = (docId: string): string =>
  `${VIEWPORT_KEY_PREFIX}${docId}`;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const isValidViewport = (value: unknown): value is Viewport => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { x, y, zoom } = value as Partial<Viewport>;
  return (
    isFiniteNumber(x) &&
    isFiniteNumber(y) &&
    isFiniteNumber(zoom) &&
    zoom >= MIN_ZOOM &&
    zoom <= MAX_ZOOM
  );
};

export const readStoredViewport = (
  storage: Pick<Storage, "getItem">,
  docId: string,
): Viewport | null => {
  try {
    const raw = storage.getItem(viewportStorageKey(docId));
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    // A viewport written by a hand-edited entry must not be able to place the
    // canvas somewhere unrecoverable.
    return isValidViewport(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const storeViewport = (
  storage: Pick<Storage, "setItem">,
  docId: string,
  viewport: Viewport,
): void => {
  if (!isValidViewport(viewport)) {
    return;
  }
  try {
    storage.setItem(viewportStorageKey(docId), JSON.stringify(viewport));
  } catch {
    // A full or disabled storage costs the user their last viewport, nothing more.
  }
};

/**
 * Which viewport a document opens at.
 *
 * The user's own remembered viewport wins. The document's shared one is only a
 * one-time fallback, so upgrading does not move everyone's canvas; nothing is
 * ever written back, which is what keeps it from becoming shared state again.
 */
export const resolveInitialViewport = (
  stored: Viewport | null,
  legacyViewport: unknown,
): Viewport | null => {
  if (stored) {
    return stored;
  }
  return isValidViewport(legacyViewport) ? legacyViewport : null;
};

/**
 * Whether an element can be handed to Excalidraw at all.
 *
 * Excalidraw dispatches on `element.type` in many places and throws on an
 * unknown one, so an element without a type must never reach `updateScene`. A
 * document holding one such entry otherwise fails to sync *in its entirety*:
 * the throw happens while building the scene, so every other element in that
 * update is dropped with it and the client silently stops following the
 * document.
 */
export const isRenderableElement = (
  value: unknown,
): value is RenderableElementData => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const element = value as ElementData;
  return (
    typeof element.id === "string" &&
    element.id.length > 0 &&
    typeof element.type === "string" &&
    element.type.length > 0
  );
};

/**
 * A deletion written by an older client: `{ id, isDeleted, versionNonce }` and
 * nothing else.
 *
 * Excalidraw cannot render that, so it is resolved against the copy already in
 * the scene, which keeps the element's real fields and only flips the flag.
 */
export const isIncompleteTombstone = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const element = value as ElementData;
  return element.isDeleted === true && typeof element.type !== "string";
};

/**
 * Deep equality for the JSON-shaped values an element holds.
 *
 * Identity is not enough: `points` is an array of `[x, y]` tuples, so a shallow
 * compare reports a difference between two equal strokes and the element then
 * looks dirty forever — which, with two clients, is the echo that never settles.
 * Only arrays and plain objects need handling; every other field is a primitive
 * or a null.
 */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => sameValue(value, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => sameValue(a[key], b[key]))
    );
  }
  return false;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * A deep copy of an element.
 *
 * The baseline must never share an object with the scene: Excalidraw mutates
 * elements in place, so a stored reference would keep changing together with the
 * scene and every diff would come back empty — no edit would ever be written.
 */
export const snapshotElement = <T extends ElementData>(element: T): T => {
  const cloneValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(cloneValue);
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        out[key] = cloneValue(value[key]);
      }
      return out;
    }
    return value;
  };

  return cloneValue(element) as T;
};

/**
 * Whether the scene already holds exactly this element.
 *
 * Compared field by field rather than by `version`/`versionNonce`. Those two are
 * copied verbatim by a write, so a document can hold a *different* value under
 * the same revision: a peer whose write merged fields from a newer state keeps
 * its own version pair, and the unchanged comparison would then report "already
 * have it" — leaving this client permanently behind on that element.
 *
 * The comparison is bounded because the incoming value comes from the document
 * and the scene copy came from the same place; a mismatch in any field means a
 * real difference worth adopting.
 */
const isSameElement = (a: ElementData, b: ElementData): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) {
      return false;
    }
  }
  return true;
};

/**
 * Read an element out of the document, whichever format it is stored in.
 *
 * Two formats exist:
 *
 * - a nested `Y.Map`, one key per field — the current format;
 * - a plain object — what every document written before this change holds.
 *
 * Reading both is what lets the format change without a migration step or a
 * version flag: nothing is rewritten on open, and an element is converted the
 * first time it is edited. Old data therefore always opens.
 *
 * **The compatibility is one-directional, and that is deliberate.** A client
 * still running the previous version cannot read the per-field format: its
 * `{...element}` spread over a `Y.Map` yields Yjs internals instead of element
 * fields, so it renders a fieldless element (Excalidraw throws on the unknown
 * type) and that element stops receiving updates there. Nothing is rewritten on
 * open, so an old document keeps working, and an element only changes format
 * once somebody edits it — which keeps the window where the two versions
 * disagree as small as the format change allows. Requiring every client to
 * update before the change reaches a shared document is the trade accepted
 * here; making an *old* client understand the new format would mean not using
 * `Y.Map` nesting at all, and with it the per-field merging that stops
 * collaborators from overwriting each other.
 */
export const readElementData = (value: unknown): ElementData | null => {
  if (value instanceof Y.Map) {
    const element: ElementData = {};
    (value as Y.Map<unknown>).forEach((fieldValue, key) => {
      element[key] = fieldValue;
    });
    return element;
  }
  if (!isRenderableElement(value)) {
    return null;
  }
  return { ...value };
};

/** How an element is stored in the document right now. */
type ElementStorage = "missing" | "legacy" | "fields";

export const storageKindOf = (value: unknown): ElementStorage => {
  if (value instanceof Y.Map) {
    return "fields";
  }
  return value === undefined || value === null ? "missing" : "legacy";
};

/**
 * The fields of `local` that differ from `baseline`.
 *
 * `baseline` is the value last exchanged with the document, so this is exactly
 * what the local user changed since. Fields that are `undefined` are skipped
 * rather than treated as a removal: writing one over the document's value would
 * drop a field somebody else is relying on.
 */
export const changedFields = (
  baseline: ElementData | undefined,
  local: ElementData,
): ElementData => {
  const changed: ElementData = {};

  if (!baseline) {
    for (const key of Object.keys(local)) {
      if (local[key] !== undefined) {
        changed[key] = local[key];
      }
    }
    return changed;
  }

  for (const key of new Set([
    ...Object.keys(baseline),
    ...Object.keys(local),
  ])) {
    const value = local[key];
    if (value === undefined) {
      continue;
    }
    if (!sameValue(baseline[key], value)) {
      changed[key] = value;
    }
  }

  return changed;
};

export const hasLocalChanges = (
  baseline: ElementData | undefined,
  local: ElementData,
): boolean => Object.keys(changedFields(baseline, local)).length > 0;

interface ElementWrite {
  id: string;
  /** Fields to store, already merged with what the document held. */
  fields: ElementData;
  storage: ElementStorage;
}

/**
 * Decide what to write for one element.
 *
 * Only the fields this user changed are written, and they are written
 * individually. That is what makes two people editing *different* properties of
 * one shape both survive: the document merges key by key, so neither write can
 * carry a stale copy of the other's field. Writing the whole element instead —
 * which is what the old code did — meant the losing edit was silently gone,
 * matched by every client and by the server, with nothing to indicate a conflict.
 *
 * `local` is diffed against `baseline`, so a value that already matches the
 * document produces no write at all. Without that, every remote update would be
 * echoed straight back — the ping-pong that, by way of the shared viewport, used
 * to keep two clients writing to each other for as long as they stayed open.
 */
export const planElementWrite = (
  current: ElementData | undefined,
  local: ElementData,
  baseline: ElementData | undefined,
  storage: ElementStorage,
): ElementWrite | null => {
  if (!isRenderableElement(local)) {
    return null;
  }

  const changed = changedFields(baseline, local);

  // Keep only what the document does not already hold. Dropping this check is
  // what makes a client echo every remote value straight back: the value is not
  // locally *changed*, it is locally *unchanged* and merely newer.
  const pending: ElementData = {};
  for (const key of Object.keys(changed)) {
    if (!sameValue(current?.[key], changed[key])) {
      pending[key] = changed[key];
    }
  }

  if (!Object.keys(pending).length) {
    return null;
  }

  if (storage === "legacy") {
    // Converting the stored object to per-field storage in the same write. The
    // whole element is materialised because a nested map starts out empty and
    // the fields this user did not touch have to come across with it. The
    // incoming value is taken from the document at write time, so it carries any
    // remote change made since this client last read it.
    return {
      id: local.id,
      fields: { ...current, ...pending },
      storage: "legacy",
    };
  }

  return { id: local.id, fields: pending, storage };
};

/**
 * Read every renderable element out of the document's element map.
 *
 * This is the entry point for opening a document, and it is format-agnostic on
 * purpose: a document can hold a mix of both storage formats at once, because
 * elements are converted one at a time as they are edited. Everything an older
 * version wrote therefore opens unchanged.
 *
 * Entries that cannot be rendered are dropped rather than passed on; Excalidraw
 * throws on an element whose type it does not know, which would take the whole
 * scene with it.
 */
export const collectElements = (
  document: ReadonlyMap<string, unknown>,
): RenderableElementData[] => {
  const elements: RenderableElementData[] = [];

  for (const value of document.values()) {
    const element = readElementData(value);
    if (element && isRenderableElement(element)) {
      elements.push(element);
    }
  }

  return sortElementsForScene(elements);
};

/**
 * Order elements the way Excalidraw expects, with a total order.
 *
 * Excalidraw's own `orderByFractionalIndex` breaks index ties by id and keeps
 * the array order for elements without an index. Reproduced here so the result
 * cannot depend on the sort implementation, which a comparator that returns `1`
 * for equal keys leaves undefined.
 */
export const sortElementsForScene = <T extends ElementData & { id: string }>(
  elements: T[],
): T[] =>
  [...elements].sort((a, b) => {
    const aIndex = a.index;
    const bIndex = b.index;
    const aHas = typeof aIndex === "string";
    const bHas = typeof bIndex === "string";

    if (aHas && bHas) {
      if (aIndex < bIndex) {
        return -1;
      }
      if (aIndex > bIndex) {
        return 1;
      }
      // Same index (two clients can pick the same key at the same moment):
      // break the tie deterministically so both sides order it identically.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }

    // No index yet — a shape being created. Excalidraw keeps those after the
    // ordered ones.
    return aHas === bHas ? 0 : aHas ? -1 : 1;
  });

export interface DocumentMergeInput {
  /** Scene elements in display order, local edits included. */
  scene: readonly unknown[];
  /** Fresh values from the shared document's element map. */
  document: ReadonlyMap<string, unknown>;
  /** Values last exchanged with the document, by element id. */
  baseline: ReadonlyMap<string, ElementData>;
}

export interface DocumentMergeResult {
  elements: RenderableElementData[];
  /**
   * Values adopted from the document, keyed by id. The caller refreshes the
   * baseline with these: without that, every remote element looks locally
   * modified, and the next sync echoes it straight back.
   */
  adopted: Map<string, RenderableElementData>;
  /** Element ids that are in the document but cannot be rendered, for reporting. */
  skipped: string[];
}

/**
 * Fold the document into the scene.
 *
 * Three rules, in order of what they protect:
 *
 * 1. An element with unsynced local edits is left alone. Replacing it with the
 *    document's value is what made a shape snap back mid-drag when somebody else
 *    touched it; the pending write merges the two later instead.
 * 2. A deletion written by an older client (a fieldless tombstone) is applied to
 *    the scene copy rather than copied in, so losing fields cannot reach
 *    Excalidraw's renderer, which throws on an unknown element type.
 * 3. Anything still unrenderable is dropped rather than passed on, because
 *    Excalidraw throws on it and would drop the rest of the update too.
 */
export const mergeDocumentIntoScene = ({
  scene,
  document,
  baseline,
}: DocumentMergeInput): DocumentMergeResult => {
  // A snapshot of each scene element, not the element itself: the returned
  // elements are handed to `updateScene`, and keeping the caller's live objects
  // would let Excalidraw mutate them under us.
  const byId = new Map<string, RenderableElementData>();
  for (const entry of scene) {
    if (isRenderableElement(entry)) {
      byId.set(entry.id, snapshotElement(entry));
    }
  }

  const adopted = new Map<string, RenderableElementData>();
  const skipped: string[] = [];

  for (const [id, value] of document) {
    if (isIncompleteTombstone(value)) {
      // Only reachable for a plain-object value: a per-field entry cannot be
      // incomplete, because its `type` is one of its own keys.
      const sceneElement = byId.get(id);
      if (!sceneElement) {
        // Never opened here, and it is deleted: nothing to show.
        continue;
      }
      const repaired = snapshotElement({
        ...sceneElement,
        isDeleted: true,
        versionNonce: (value as ElementData).versionNonce,
      });
      byId.set(id, repaired);
      adopted.set(id, repaired);
      continue;
    }

    // Both storage formats read as element data; the difference only matters
    // when writing.
    const remote = readElementData(value);

    if (!remote || !isRenderableElement(remote)) {
      skipped.push(id);
      continue;
    }

    const sceneElement = byId.get(id);

    if (sceneElement && hasLocalChanges(baseline.get(id), sceneElement)) {
      // Keep the local edit; the write path merges the two field by field.
      continue;
    }

    // Already at this revision: re-adopting it would rebuild the element on
    // every remote update and discard the selection state tied to the old object.
    if (sceneElement && isSameElement(sceneElement, remote)) {
      continue;
    }

    const copy = snapshotElement(remote);
    byId.set(id, copy);
    adopted.set(id, copy);
  }

  return {
    elements: sortElementsForScene([...byId.values()]),
    adopted,
    skipped,
  };
};
