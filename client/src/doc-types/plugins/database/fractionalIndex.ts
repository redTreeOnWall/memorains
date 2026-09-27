/**
 * Fractional position keys — fixed-width, base-62, sortable strings.
 *
 * ## Why this exists (see `doc/database-type-plan.md` §8.2)
 *
 * `Y.Array` has no `move` operation, so "reorder a row" is delete + insert.
 * Yjs merges *operations*, not *intentions*, so two peers reordering at the
 * same time produce a duplicated row (plain values) or a thrown error
 * (`Y.Map` — an already-integrated shared type cannot be re-integrated).
 * Both were reproduced against `yjs@13.6.21`.
 *
 * Instead each row carries an `order` string and rows are **never moved**.
 * Reordering rewrites only that row's own `order` field, turning a positional
 * conflict into two writes to disjoint fields — which a row-level `Y.Map`
 * merges trivially.
 *
 * ## Representation
 *
 * A key is exactly `WIDTH` characters of base-62 digits, interpreted as a
 * big-endian integer in `[0, SPACE)`. Because every key has the **same length**,
 * plain string comparison (`<`, `>`) is exactly numeric comparison, so no
 * padding or parsing is needed on read paths.
 *
 * ## Why fixed width instead of variable-length fractional indexing
 *
 * Variable-length keys (the `fractional-indexing` package style) are more
 * compact, but the midpoint algorithm has subtle invariants (keys may not end in
 * the zero digit, bounds must be normalised) and an implementation mistake
 * corrupts ordering silently. A fixed-width integer has no such invariants:
 * every key is a valid key, `int`/`key` are inverses by construction, and the
 * whole thing is testable exhaustively.
 *
 * The cost is storage: every key is `WIDTH` bytes rather than the ~3 a
 * variable-length key would use. At `WIDTH = 10` that is ~10 bytes per row —
 * about 100 KB on a 10 000-row database.
 *
 * ## Splitting capacity (measured, not assumed)
 *
 * A gap of size N can be split ~log2(N) times. With `WIDTH = 10` the whole space
 * is 62^10 ≈ 8.4e17, and splitting a full-space gap 44 times exhausts it. In
 * practice the interesting number is how often *real* usage exhausts a gap:
 *
 * | Workload | Rebalances needed |
 * |---|---|
 * | 1 000 rows, 10 000 random drags | 1 |
 * | 5 000 rows, 20 000 random drags | 1 |
 * | One row dragged back to the same slot repeatedly | every ~19 drags |
 *
 * So rebalancing is a rare repair, not part of the normal path — but it must
 * exist, because "rare" is not "never", and throwing on a user's drag would be
 * unacceptable. `needsRebalance` tells the caller when to renumber a run, and
 * `generateNKeysBetween` produces the replacement keys. Rebalancing should only
 * rewrite the affected **local run**, never the whole table: renumbering N rows
 * emits N writes into the document, so a whole-table rebalance on a large
 * database would push a large update for no reason.
 *
 * `WIDTH = 10` is kept deliberately. Wider keys (16, 20) were measured and gave
 * identical rebalance counts on realistic workloads while costing proportionally
 * more storage — the exhaustion is driven by how many times a *single* gap is
 * split, not by the size of the space.
 */

/** Base-62 alphabet in ASCII order, so string comparison is numeric order. */
export const DIGITS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const BASE = BigInt(DIGITS.length);

/**
 * Fixed key width.
 *
 * 62^10 ≈ 8.4e17 (about 2^59), so there is room for ~59 consecutive splits of
 * the same gap — and, because append/prepend use a fixed step rather than
 * halving, billions of rows can be appended without ever needing a rebalance.
 */
export const WIDTH = 10;

const SPACE = BASE ** BigInt(WIDTH);

/** Step used for append/prepend, so repeated inserts do not halve the gap. */
const STEP = BASE ** BigInt(4); // 62^4 = 14_776_336

export const MIN_KEY = DIGITS[0].repeat(WIDTH);
export const MAX_KEY = DIGITS[DIGITS.length - 1].repeat(WIDTH);

export class FractionalIndexError extends Error {}

const DIGIT_INDEX: Record<string, number> = {};
for (let i = 0; i < DIGITS.length; i++) {
  DIGIT_INDEX[DIGITS[i]] = i;
}

/** Random function returning a float in `[0, 1)`. Injectable for tests. */
export type RandomFn = () => number;

/**
 * Validate a key and return it as an integer.
 *
 * Throws `FractionalIndexError` for anything that is not a fixed-width base-62
 * string — including keys written by a different (future) version, so a
 * mismatched format fails loudly instead of sorting arbitrarily.
 */
export function keyToInt(key: string, label = "key"): bigint {
  if (typeof key !== "string" || key.length !== WIDTH) {
    throw new FractionalIndexError(
      `${label} must be exactly ${WIDTH} characters, got ${JSON.stringify(key)}`,
    );
  }
  let value = 0n;
  for (const ch of key) {
    const digit = DIGIT_INDEX[ch];
    if (digit === undefined) {
      throw new FractionalIndexError(
        `${label} contains a character outside the base-62 alphabet: ${JSON.stringify(ch)}`,
      );
    }
    value = value * BASE + BigInt(digit);
  }
  return value;
}

/** Render an integer in `[0, SPACE)` as a fixed-width base-62 key. */
export function intToKey(value: bigint): string {
  if (value < 0n || value >= SPACE) {
    throw new FractionalIndexError(
      `value out of range: ${value.toString()} (must be within [0, ${SPACE.toString()}))`,
    );
  }
  let remaining = value;
  const chars = new Array<string>(WIDTH);
  for (let i = WIDTH - 1; i >= 0; i--) {
    chars[i] = DIGITS[Number(remaining % BASE)];
    remaining /= BASE;
  }
  return chars.join("");
}

/** Is this a syntactically valid key? */
export function isValidKey(key: unknown): key is string {
  if (typeof key !== "string" || key.length !== WIDTH) return false;
  for (const ch of key) {
    if (!(ch in DIGIT_INDEX)) return false;
  }
  return true;
}

/**
 * A random integer in `[0, max)`.
 *
 * Built from two 32-bit draws to cover a full 64-bit range, which is wider than
 * the key space — capping at `Number.MAX_SAFE_INTEGER` instead would bias every
 * unbounded insertion towards the low end of the space and leave no room before
 * it. The modulo introduces a slight bias, which is harmless here: these values
 * only need to be in range and mutually distinct, not uniformly distributed.
 */
function randomBigInt(max: bigint, random: RandomFn): bigint {
  if (max <= 1n) return 0n;
  const high = BigInt(Math.floor(random() * 0x100000000));
  const low = BigInt(Math.floor(random() * 0x100000000));
  const value = (high << 32n) | low;
  return value % max;
}

/**
 * A key strictly between `a` and `b`.
 *
 * `null` means "unbounded on that side". The returned key is chosen *randomly*
 * inside the gap rather than at its exact midpoint: two peers inserting at the
 * same position would otherwise compute the identical key and tie. The order
 * between tied rows is then decided by Yjs internals — stable, but arbitrary and
 * unrelated to intent.
 */
export function generateKeyBetween(
  a: string | null,
  b: string | null,
  random: RandomFn = Math.random,
): string {
  const lo = a === null ? 0n : keyToInt(a, "a");
  const hi = b === null ? SPACE : keyToInt(b, "b");

  if (a !== null && b !== null && lo >= hi) {
    throw new FractionalIndexError(
      `keys out of order: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`,
    );
  }

  const gap = hi - lo;
  if (gap < 2n) {
    // No integer strictly between: the caller must rebalance this run.
    throw new FractionalIndexError(
      `no room between ${JSON.stringify(a)} and ${JSON.stringify(b)}; rebalance required`,
    );
  }

  const loOpen = lo + 1n;
  const hiOpen = hi - 1n;
  if (loOpen === hiOpen) return intToKey(loOpen);
  return intToKey(loOpen + randomBigInt(hiOpen - loOpen + 1n, random));
}

/**
 * Append after the largest existing key.
 *
 * Uses a fixed `STEP` rather than halving, so appending N rows in sequence does
 * not shrink the available gap exponentially: ~2.8e10 rows can be appended from
 * the centre before a rebalance is needed.
 */
export function keyAtEnd(
  existing: readonly string[],
  random: RandomFn = Math.random,
): string {
  if (existing.length === 0) {
    // Start near the middle, leaving room in both directions. Jittered because
    // two peers adding the *first* row of an empty database concurrently would
    // otherwise both receive this exact key.
    return jitterAround(SPACE / 2n, random);
  }
  let max = 0n;
  for (const key of existing) {
    const value = keyToInt(key);
    if (value > max) max = value;
  }
  // Place after max by up to one step, staying inside the space.
  const room = SPACE - 1n - max;
  if (room < 1n) {
    throw new FractionalIndexError(
      "key space exhausted at the end; rebalance required",
    );
  }
  const offset = randomBigInt(STEP < room ? STEP : room, random) + 1n;
  return intToKey(max + offset);
}

/** Prepend before the smallest existing key. */
export function keyAtStart(
  existing: readonly string[],
  random: RandomFn = Math.random,
): string {
  if (existing.length === 0) {
    return jitterAround(SPACE / 2n, random);
  }
  let min = SPACE;
  for (const key of existing) {
    const value = keyToInt(key);
    if (value < min) min = value;
  }
  if (min < 1n) {
    throw new FractionalIndexError(
      "key space exhausted at the start; rebalance required",
    );
  }
  const room = min;
  const offset = randomBigInt(STEP < room ? STEP : room, random) + 1n;
  return intToKey(min - offset);
}

/**
 * A key near `centre`, within `STEP` on either side and clamped to the space.
 *
 * Keeps the "first key in an empty list" case from being a constant, so two
 * peers creating a row at the same time cannot receive an identical key.
 */
function jitterAround(centre: bigint, random: RandomFn): string {
  const offset = randomBigInt(STEP, random);
  const direction = randomBigInt(2n, random);
  let value = direction === 0n ? centre - offset : centre + offset;
  if (value < 0n) value = centre + offset;
  if (value >= SPACE) value = centre - offset;
  if (value < 0n) value = 0n;
  if (value >= SPACE) value = SPACE - 1n;
  return intToKey(value);
}

/** Insert between two neighbours; `null` means "no neighbour on that side". */
export function keyBetweenNeighbours(
  before: string | null,
  after: string | null,
  random: RandomFn = Math.random,
): string {
  return generateKeyBetween(before, after, random);
}

/**
 * Are `before` and `after` too close to insert between?
 *
 * Callers use this to decide whether to rebalance a run before inserting,
 * instead of catching the exception from `generateKeyBetween`. Note that the
 * unbounded ends are *not* automatically spacious: a key sitting on `MIN_KEY`
 * or `MAX_KEY` has no room before/after it, which is reachable if an older or
 * hand-edited document contains such a key.
 */
export function needsRebalance(
  before: string | null,
  after: string | null,
): boolean {
  if (before === null && after === null) return false;
  const lo = before === null ? 0n : keyToInt(before, "before");
  const hi = after === null ? SPACE : keyToInt(after, "after");
  if (lo >= hi) return true;
  return hi - lo < 2n;
}

/**
 * `count` evenly spaced keys strictly between `a` and `b`.
 *
 * Used to repair a run of rows whose keys have been squeezed together. Spreads
 * the run across the available gap rather than placing keys at its edge, so the
 * repaired region has room for further insertions.
 */
export function generateNKeysBetween(
  a: string | null,
  b: string | null,
  count: number,
): string[] {
  if (count <= 0) return [];

  const lo = a === null ? 0n : keyToInt(a, "a");
  const hi = b === null ? SPACE : keyToInt(b, "b");
  if (lo >= hi) {
    throw new FractionalIndexError(
      `keys out of order: ${JSON.stringify(a)} >= ${JSON.stringify(b)}`,
    );
  }

  // `count` keys must fit strictly between `lo` and `hi`, so the span must be
  // wide enough to hold them plus the two bounds.
  const span = hi - lo;
  if (span < BigInt(count) + 1n) {
    throw new FractionalIndexError(
      `not enough room for ${count} keys between ${JSON.stringify(a)} and ${JSON.stringify(b)}`,
    );
  }

  // Place key `i` at `lo + floor(span * i / (count + 1))`.
  //
  // Dividing the *span* (not the span minus margins) is what keeps every key
  // strictly inside: the multiplier is at least 1 and at most `count`, so the
  // quotient is in `[floor(span/(count+1)), span - 1]`, i.e. never `lo` and
  // never `hi`. Doing this with a reduced numerator instead rounds down to 0 for
  // small spans and yields a key equal to `lo` — a silent duplicate.
  const keys: string[] = [];
  for (let i = 1; i <= count; i++) {
    keys.push(intToKey(lo + (span * BigInt(i)) / BigInt(count + 1)));
  }
  return keys;
}

/**
 * Is this list sorted by `order`, with no duplicates?
 *
 * `DatabaseBinding` runs this after loading, so a document whose order was
 * written by an older or broken client is repaired rather than rendered in an
 * arbitrary sequence.
 */
export function isSortedByOrder(items: readonly { order: string }[]): boolean {
  for (let i = 1; i < items.length; i++) {
    if (!(items[i - 1].order < items[i].order)) return false;
  }
  return true;
}

/** Are all keys distinct? Used together with `isSortedByOrder` when repairing. */
export function hasUniqueKeys(items: readonly { order: string }[]): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.order)) return false;
    seen.add(item.order);
  }
  return true;
}

/** The result of planning a rebalance. */
export interface RebalancePlan {
  /** Index in the original list of the first key being replaced. */
  start: number;
  /** How many original keys are being replaced (`end - start`). */
  count: number;
  /**
   * Replacement keys, in ascending order, covering the replaced keys **and**
   * the new insertions. Length is `count + insertCount`.
   */
  keys: string[];
  /**
   * How many new keys the plan was made for.
   *
   * Stored because `changedKeys` has to know which entries of `keys` are the
   * insertions: an original key maps to a different entry depending on how many
   * insertions came before it. Mapping the first `count` entries to the originals
   * — the obvious loop — is right only when the insertion sits at the *end* of the
   * window, and silently hands two rows the same key otherwise.
   */
  insertCount: number;
  /**
   * Where the inserted keys begin inside `keys`.
   *
   * `keys[insertOffset .. insertOffset + insertCount)` are the new keys; every
   * other entry maps, in order, to the originals being replaced.
   */
  insertOffset: number;
}

/**
 * Plan a local rebalance so `insertCount` keys can be inserted at `insertIndex`.
 *
 * Needed because splitting a gap is not always possible: two adjacent integers
 * have nothing between them, and widening by one neighbour may still not help if
 * that neighbour is also adjacent. So the window grows outwards until the
 * available span can hold the replaced keys plus the insertions.
 *
 * Only the **local run** is ever renumbered. Renumbering the whole table would
 * emit one write per row into the CRDT — on a large database that is a large
 * update pushed to every collaborator for what is usually a single row move.
 *
 * Returns `null` only if the entire key space is genuinely too small, which for
 * `WIDTH = 10` means a database with more rows than 62^10 could hold.
 *
 * `keys` must be sorted ascending and contain no duplicates.
 */
export function planRebalance(
  keys: readonly string[],
  insertIndex: number,
  insertCount: number,
): RebalancePlan | null {
  if (insertCount < 0)
    throw new FractionalIndexError("insertCount must be >= 0");
  if (insertIndex < 0 || insertIndex > keys.length) {
    throw new FractionalIndexError(
      `insertIndex ${insertIndex} out of range for ${keys.length} keys`,
    );
  }

  // Grow the window outwards until the surrounding span can hold everything.
  for (let radius = 1; radius <= keys.length + 1; radius++) {
    const start = Math.max(0, insertIndex - radius);
    const end = Math.min(keys.length, insertIndex + radius);

    const lo = start === 0 ? null : keys[start - 1];
    const hi = end === keys.length ? null : keys[end];

    const loValue = lo === null ? 0n : keyToInt(lo);
    const hiValue = hi === null ? SPACE : keyToInt(hi);

    const replaced = end - start;
    const needed = BigInt(replaced + insertCount);
    // Leave a margin of one at each bounded end so every new key can still be
    // split later; an unbounded end is already the edge of the space.
    const usable = hiValue - loValue - 1n;

    if (usable >= needed) {
      return {
        start,
        count: replaced,
        keys: generateNKeysBetween(lo, hi, replaced + insertCount),
        insertCount,
        // The insertions sit where the caller asked to insert, measured from the
        // start of the replaced run.
        insertOffset: insertIndex - start,
      };
    }

    // Window already spans the whole list and still does not fit.
    if (start === 0 && end === keys.length) break;
  }

  return null;
}

/**
 * Compute the key for a row being inserted, planning a rebalance if the
 * neighbourhood is exhausted.
 *
 * This is the entry point view code should use for "place this row between
 * these two neighbours": it never throws for a crowded neighbourhood.
 *
 * Returns the full replacement key list, because a rebalance changes the
 * surrounding run as well as producing the new key. Callers must **replace the
 * whole list** with `keys` rather than splicing the new key in separately:
 * `plan.keys` already contains it, at index `insertIndex`. Getting this wrong is
 * easy (the run's length changes), which is why the insert is done here.
 *
 * ```ts
 * const { keys: nextKeys, rebalance } = insertKey(currentKeys, index);
 * if (rebalance) {
 *   // Persist every changed key in one transaction.
 *   for (const [runIndex, newKey] of changedKeys(currentKeys, rebalance)) …
 * }
 * ```
 */
export function insertKey(
  keys: readonly string[],
  insertIndex: number,
  random: RandomFn = Math.random,
): { keys: string[]; rebalance: RebalancePlan | null } {
  const before = insertIndex === 0 ? null : keys[insertIndex - 1];
  const after = insertIndex === keys.length ? null : keys[insertIndex];

  if (!needsRebalance(before, after)) {
    const key = generateKeyBetween(before, after, random);
    const next = [...keys];
    next.splice(insertIndex, 0, key);
    return { keys: next, rebalance: null };
  }

  const rebalance = planRebalance(keys, insertIndex, 1);
  if (!rebalance) {
    throw new FractionalIndexError(
      "key space exhausted across the entire list; cannot place a new row",
    );
  }

  return {
    keys: [
      ...keys.slice(0, rebalance.start),
      ...rebalance.keys,
      ...keys.slice(rebalance.start + rebalance.count),
    ],
    rebalance,
  };
}

/**
 * Which existing keys need a new `order`, given a rebalance plan.
 *
 * Returns `[originalIndex, newKey]` pairs. A rebalance only ever rewrites the
 * keys inside `plan`'s window — never the whole list, because each rewritten
 * key is a CRDT write broadcast to every collaborator.
 *
 * The originals are matched to `plan.keys` **skipping the inserted entries**, so a
 * plan whose window straddles the insertion point still gives every original a
 * distinct key. Taking the first `count` entries instead would be correct only when
 * the insertion is last in the window, and would otherwise assign a new key and an
 * existing key to the same value — two items at one position.
 */
export function changedKeys(
  keys: readonly string[],
  plan: RebalancePlan,
): [number, string][] {
  const changed: [number, string][] = [];
  for (let i = 0; i < plan.count; i++) {
    const originalIndex = plan.start + i;
    const keyIndex = i < plan.insertOffset ? i : i + plan.insertCount;
    const newKey = plan.keys[keyIndex];
    if (keys[originalIndex] !== newKey) {
      changed.push([originalIndex, newKey]);
    }
  }
  return changed;
}
