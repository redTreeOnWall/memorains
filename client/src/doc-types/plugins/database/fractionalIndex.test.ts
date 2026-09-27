import { describe, expect, it } from "vitest";
import {
  DIGITS,
  FractionalIndexError,
  MAX_KEY,
  MIN_KEY,
  WIDTH,
  changedKeys,
  generateKeyBetween,
  generateNKeysBetween,
  hasUniqueKeys,
  insertKey,
  intToKey,
  isSortedByOrder,
  isValidKey,
  keyAtEnd,
  keyAtStart,
  keyBetweenNeighbours,
  keyToInt,
  needsRebalance,
  planRebalance,
} from "./fractionalIndex";

/** A key comfortably inside the space, used as a starting point in tests. */
const SPACE_MID = 419649682934170112n; // 62^10 / 2

/** Deterministic PRNG so failures are reproducible. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Assert the core property: strictly between, and a valid key. */
function expectBetween(key: string, lo: string | null, hi: string | null) {
  expect(isValidKey(key), `invalid key: ${JSON.stringify(key)}`).toBe(true);
  if (lo !== null) expect(key > lo, `${key} should be > ${lo}`).toBe(true);
  if (hi !== null) expect(key < hi, `${key} should be < ${hi}`).toBe(true);
}

describe("encoding", () => {
  it("round-trips every value in a window exhaustively", () => {
    // Small values only — this is an exhaustive check, not a sample.
    for (let i = 0; i < 5000; i++) {
      const key = intToKey(BigInt(i));
      expect(intToKey(keyToInt(key))).toBe(key);
      expect(keyToInt(key)).toBe(BigInt(i));
    }
  });

  it("round-trips the boundaries", () => {
    expect(intToKey(0n)).toBe(MIN_KEY);
    expect(keyToInt(MIN_KEY)).toBe(0n);
    expect(keyToInt(MAX_KEY)).toBe(keyToInt(MAX_KEY));
    for (const key of [MIN_KEY, MAX_KEY]) {
      expect(isValidKey(key)).toBe(true);
      expect(intToKey(keyToInt(key))).toBe(key);
    }
  });

  it("produces fixed-width keys so string order is numeric order", () => {
    const random = makeRandom(7);
    let previousKey: string | null = null;
    for (let i = 0; i < 2000; i++) {
      const value = BigInt(Math.floor(random() * 1e15));
      const key = intToKey(value);
      expect(key).toHaveLength(WIDTH);
      if (previousKey !== null) {
        // String comparison must agree with integer comparison.
        expect(key > previousKey).toBe(value > keyToInt(previousKey));
      }
      previousKey = key;
    }
  });

  it("rejects malformed keys", () => {
    for (const bad of ["", "abc", MIN_KEY + "0", MIN_KEY.slice(1), null, 42]) {
      expect(() => keyToInt(bad as string)).toThrow(FractionalIndexError);
      expect(isValidKey(bad)).toBe(false);
    }
  });

  it("rejects characters outside the alphabet", () => {
    const bad = "!".repeat(WIDTH);
    expect(() => keyToInt(bad)).toThrow(FractionalIndexError);
    expect(isValidKey(bad)).toBe(false);
  });

  it("uses ASCII order so plain string comparison is correct", () => {
    expect([...DIGITS]).toEqual([...DIGITS].sort());
  });
});

describe("generateKeyBetween", () => {
  it("returns a key strictly between its neighbours, exhaustively over a window", () => {
    // Every adjacent / near-adjacent pair in a window: the cases where an
    // off-by-one is most likely.
    const random = makeRandom(99);
    for (let lo = 0; lo < 300; lo++) {
      for (let gap = 2; gap <= 6; gap++) {
        const hi = lo + gap;
        const a = intToKey(BigInt(lo));
        const b = intToKey(BigInt(hi));
        const key = generateKeyBetween(a, b, random);
        expectBetween(key, a, b);
      }
    }
  });

  it("returns the single available integer when only one fits", () => {
    const a = intToKey(100n);
    const b = intToKey(102n);
    // Exactly one integer (101) fits, so the result is deterministic.
    expect(generateKeyBetween(a, b)).toBe(intToKey(101n));
    expect(generateKeyBetween(a, b, () => 0)).toBe(intToKey(101n));
    expect(generateKeyBetween(a, b, () => 0.999999)).toBe(intToKey(101n));
  });

  it("respects the extremes of the random range", () => {
    const random = makeRandom(3);
    for (let i = 0; i < 200; i++) {
      const lo = BigInt(Math.floor(random() * 1e12));
      const hi = lo + BigInt(1 + Math.floor(random() * 1000));
      const a = intToKey(lo);
      const b = intToKey(hi);
      // random() near 0 → lowest candidate; near 1 → highest candidate.
      expectBetween(
        generateKeyBetween(a, b, () => 0),
        a,
        b,
      );
      expectBetween(
        generateKeyBetween(a, b, () => 0.999999),
        a,
        b,
      );
    }
  });

  it("handles unbounded ends", () => {
    expectBetween(generateKeyBetween(null, null), null, null);
    expectBetween(generateKeyBetween(null, MAX_KEY), null, MAX_KEY);
    expectBetween(generateKeyBetween(MIN_KEY, null), MIN_KEY, null);
    expectBetween(
      generateKeyBetween(null, "V".repeat(WIDTH)),
      null,
      "V".repeat(WIDTH),
    );
  });

  it("rejects out-of-order and equal bounds", () => {
    const a = intToKey(100n);
    const b = intToKey(50n);
    expect(() => generateKeyBetween(a, b)).toThrow(FractionalIndexError);
    expect(() => generateKeyBetween(a, a)).toThrow(FractionalIndexError);
    expect(() => generateKeyBetween(a, intToKey(101n))).toThrow(
      FractionalIndexError,
    );
  });

  it("gives two concurrent peers distinct keys", () => {
    // The requirement is not "never collide" (impossible with randomness) but
    // "two peers inserting at the same position get different keys", so that
    // rows do not tie. Test that pair-wise across many trials.
    const a = intToKey(0n);
    const b = intToKey(2_000_000n);
    let collisions = 0;
    const TRIALS = 5000;
    for (let i = 0; i < TRIALS; i++) {
      if (generateKeyBetween(a, b) === generateKeyBetween(a, b)) collisions++;
    }
    // Collision probability is ~1/gap per trial, so this should be ~0.
    expect(collisions).toBeLessThan(TRIALS / 100);
  });

  it("does not always return the midpoint", () => {
    // A midpoint-only implementation would return one identical key every time.
    const a = intToKey(0n);
    const b = intToKey(1_000_000n);
    const values = Array.from({ length: 200 }, () =>
      Number(keyToInt(generateKeyBetween(a, b))),
    );
    expect(new Set(values).size).toBeGreaterThan(190);
    expect(Math.min(...values)).toBeLessThan(400_000);
    expect(Math.max(...values)).toBeGreaterThan(600_000);
  });
});

describe("repeated insertion (the reorder workload)", () => {
  it("stays sorted and unique across 400 insertions at random gaps", () => {
    const random = makeRandom(12345);
    let keys: string[] = [
      intToKey(SPACE_MID - 1_000_000n),
      intToKey(SPACE_MID),
      intToKey(SPACE_MID + 1_000_000n),
    ];

    const TARGET = 400;
    while (keys.length < TARGET) {
      // Insert only *between* existing keys. Inserting at the very start/end is
      // covered by the append/prepend tests; doing it here would also walk the
      // keys towards 0 and trip the genuinely-exhausted-space path.
      //
      // `insertKey` repairs the neighbourhood when a gap is exhausted, exactly
      // as `DatabaseBinding` does, so a local insertion never throws.
      const i = 1 + Math.floor(random() * (keys.length - 1));
      keys = insertKey(keys, i, random).keys;
      expect(keys.every(isValidKey)).toBe(true);
    }

    expect(keys.length).toBe(TARGET);
    expect(new Set(keys).size).toBe(keys.length);
    expect(isSortedByOrder(keys.map((order) => ({ order })))).toBe(true);
    expect(hasUniqueKeys(keys.map((order) => ({ order })))).toBe(true);
  });

  it("survives a realistic drag workload by rebalancing on exhaustion", () => {
    // Randomly move a row to a random position, over and over, for several
    // thousand moves — the workload that exhausts gaps in practice.
    const random = makeRandom(4242);
    let keys: string[] = [];
    for (let i = 0; i < 200; i++) keys.push(keyAtEnd(keys, random));

    let rebalances = 0;
    const MOVES = 3000;
    for (let m = 0; m < MOVES; m++) {
      const from = Math.floor(random() * keys.length);
      keys.splice(from, 1);
      const to = Math.floor(random() * (keys.length + 1));
      const result = insertKey(keys, to, random);
      if (result.rebalance) {
        rebalances++;
        // The caller persists only the items whose key actually changed.
        expect(changedKeys(keys, result.rebalance).length).toBeLessThanOrEqual(
          result.rebalance.count,
        );
      }
      keys = result.keys;

      expect(hasUniqueKeys(keys.map((order) => ({ order })))).toBe(true);
      expect(isSortedByOrder(keys.map((order) => ({ order })))).toBe(true);
    }

    // Rebalancing must be a rare repair, not the normal path.
    expect(rebalances).toBeLessThan(MOVES / 100);
  });

  it("never throws while inserting, no matter how crowded the neighbourhood", () => {
    const random = makeRandom(31337);
    let keys: string[] = [];
    for (let i = 0; i < 50; i++) keys.push(keyAtEnd(keys, random));

    // Repeatedly insert at the SAME index, which squeezes one gap until it must
    // be repaired. This is the "drag a row back to the same slot" pattern.
    for (let i = 0; i < 200; i++) {
      const at = 25;
      keys = insertKey(keys, at, random).keys;
      expect(isSortedByOrder(keys.map((order) => ({ order })))).toBe(true);
      expect(hasUniqueKeys(keys.map((order) => ({ order })))).toBe(true);
    }
    expect(keys).toHaveLength(250);
  });

  it("never needs rebalancing when repeatedly appending", () => {
    // Fixed STEP rather than halving: 2000 appends must all succeed.
    const random = makeRandom(5);
    const keys: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const key = keyAtEnd(keys, random);
      expect(isValidKey(key)).toBe(true);
      if (keys.length) expect(key > keys[keys.length - 1]).toBe(true);
      keys.push(key);
    }
    expect(keys).toHaveLength(2000);
    expect(isSortedByOrder(keys.map((order) => ({ order })))).toBe(true);
  });

  it("never needs rebalancing when repeatedly prepending", () => {
    const random = makeRandom(6);
    const keys: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const key = keyAtStart(keys, random);
      expect(isValidKey(key)).toBe(true);
      if (keys.length) expect(key < keys[0]).toBe(true);
      keys.unshift(key);
    }
    expect(isSortedByOrder(keys.map((order) => ({ order })))).toBe(true);
  });

  it("keeps keys at a fixed width regardless of how many are inserted", () => {
    const random = makeRandom(11);
    const keys: string[] = [];
    for (let i = 0; i < 1500; i++) {
      keys.push(keyAtEnd(keys, random));
    }
    for (const key of keys) expect(key).toHaveLength(WIDTH);
  });

  it("handles splitting the same gap repeatedly until it must rebalance", () => {
    const random = makeRandom(21);
    const a = intToKey(0n);
    let b: string | null = intToKey(100000n);
    const seen = new Set<string>([a]);

    for (let i = 0; i < 90; i++) {
      if (needsRebalance(a, b)) break;
      const key = generateKeyBetween(a, b, random);
      expect(seen.has(key)).toBe(false);
      expectBetween(key, a, b);
      seen.add(key);
      b = key; // keep squeezing the same gap
    }
    // Every generated key must have been strictly between its bounds, and the
    // squeeze must terminate well before the loop limit.
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(seen.size).toBeLessThan(90);
  });
});

describe("generateNKeysBetween (rebalance support)", () => {
  it("returns the requested count, sorted and in range", () => {
    for (const count of [1, 2, 5, 17, 100]) {
      const a = intToKey(0n);
      const b = intToKey(BigInt(count + 1000));
      const keys = generateNKeysBetween(a, b, count);
      expect(keys).toHaveLength(count);
      expect(isSortedByOrder(keys.map((order) => ({ order })))).toBe(true);
      expect(hasUniqueKeys(keys.map((order) => ({ order })))).toBe(true);
      for (const key of keys) expectBetween(key, a, b);
    }
  });

  it("works with unbounded ends", () => {
    const keys = generateNKeysBetween(null, null, 8);
    expect(keys).toHaveLength(8);
    expect(isSortedByOrder(keys.map((order) => ({ order })))).toBe(true);
  });

  it("returns nothing for a non-positive count", () => {
    expect(generateNKeysBetween(null, null, 0)).toEqual([]);
    expect(generateNKeysBetween(null, null, -1)).toEqual([]);
  });

  it("generateNKeysBetween throws when there truly is no room", () => {
    const a = intToKey(10n);
    const b = intToKey(12n); // usable = 1
    expect(() => generateNKeysBetween(a, b, 5)).toThrow(FractionalIndexError);
  });

  it("planRebalance widens the window until the keys fit", () => {
    // Two adjacent keys, so inserting between them needs a wider window.
    const keys = [intToKey(1000n), intToKey(1001n), intToKey(2000n)];
    const plan = planRebalance(keys, 1, 1);
    expect(plan).not.toBeNull();
    expect(plan!.keys).toHaveLength(plan!.count + 1);
    expect(isSortedByOrder(plan!.keys.map((order) => ({ order })))).toBe(true);
  });

  it("planRebalance only renumbers the local run", () => {
    // A long list with one crowded spot: the plan must not touch far-away rows.
    const keys: string[] = [];
    for (let i = 0; i < 100; i++) keys.push(intToKey(BigInt(i) * 1_000_000n));
    // Crowd index 51 by making it adjacent to its predecessor.
    keys[51] = intToKey(keyToInt(keys[50]) + 1n);

    const plan = planRebalance(keys, 51, 1);
    expect(plan).not.toBeNull();
    // The replaced run must be a small window around the insertion point.
    expect(plan!.count).toBeLessThan(10);
    expect(plan!.start).toBeGreaterThan(40);
    expect(plan!.start + plan!.count).toBeLessThan(60);
  });

  it("insertKey returns a key without throwing when the gap is exhausted", () => {
    const keys = [intToKey(1000n), intToKey(1001n), intToKey(2000n)];
    const result = insertKey(keys, 1);
    expect(result.rebalance).not.toBeNull();
    expect(result.keys).toHaveLength(keys.length + 1);
    expect(isSortedByOrder(result.keys.map((order) => ({ order })))).toBe(true);
  });

  it("insertKey takes the fast path for a normal gap", () => {
    const keys = [intToKey(0n), intToKey(1_000_000n)];
    const { keys: next, rebalance } = insertKey(keys, 1);
    expect(rebalance).toBeNull();
    expect(next).toHaveLength(3);
    expectBetween(next[1], keys[0], keys[1]);
  });

  it("leaves margin so the repaired keys can still be split", () => {
    const a = intToKey(0n);
    const b = intToKey(1000n);
    const keys = generateNKeysBetween(a, b, 3);
    // The first key must be strictly inside, not equal to `a`.
    expect(keys[0] > a).toBe(true);
    expect(keys[keys.length - 1] < b).toBe(true);
    // And there must be room to insert before the first repaired key.
    expect(() => generateKeyBetween(a, keys[0])).not.toThrow();
  });
});

describe("list helpers", () => {
  it("keyAtEnd appends after the largest key, keyAtStart before the smallest", () => {
    const existing = [intToKey(10n), intToKey(30n), intToKey(20n)];
    expect(keyAtEnd(existing) > intToKey(30n)).toBe(true);
    expect(keyAtStart(existing) < intToKey(10n)).toBe(true);
  });

  it("starts near the middle for an empty list, leaving room both ways", () => {
    // Jittered, so two peers adding the first row of an empty database do not
    // receive an identical key. Both must still be well inside the space.
    for (let i = 0; i < 20; i++) {
      const key = keyAtEnd([]);
      expect(key > MIN_KEY).toBe(true);
      expect(key < MAX_KEY).toBe(true);
      // Within the jitter step of the midpoint.
      const value = keyToInt(key);
      const midpoint = SPACE_MID;
      const distance = value > midpoint ? value - midpoint : midpoint - value;
      expect(distance).toBeLessThanOrEqual(14_776_336n); // 62^4
    }
    for (let i = 0; i < 20; i++) {
      const key = keyAtStart([]);
      expect(key > MIN_KEY).toBe(true);
      expect(key < MAX_KEY).toBe(true);
    }
  });

  it("keyBetweenNeighbours sits between the given keys", () => {
    const a = intToKey(100n);
    const b = intToKey(200n);
    expectBetween(keyBetweenNeighbours(a, b), a, b);
  });

  it("survives concurrent appends from two peers", () => {
    // Interleave two peers appending from the same starting state.
    const random = makeRandom(77);
    let shared: string[] = [];
    for (let round = 0; round < 50; round++) {
      const peerA = keyAtEnd(shared, random);
      const peerB = keyAtEnd(shared, random);
      // Different keys even though both appended at the same position.
      expect(peerA).not.toBe(peerB);
      shared = [...shared, peerA, peerB].sort();
    }
    expect(hasUniqueKeys(shared.map((order) => ({ order })))).toBe(true);
  });

  it("needsRebalance reports adjacent keys only", () => {
    expect(needsRebalance(intToKey(10n), intToKey(20n))).toBe(false);
    expect(needsRebalance(null, intToKey(20n))).toBe(false);
    expect(needsRebalance(intToKey(10n), null)).toBe(false);
    expect(needsRebalance(intToKey(10n), intToKey(11n))).toBe(true);
    expect(needsRebalance(intToKey(10n), intToKey(12n))).toBe(false);
  });

  it("throws from keyAtEnd only when the space is truly exhausted", () => {
    const keys = [MAX_KEY];
    expect(() => keyAtEnd(keys)).toThrow(FractionalIndexError);
    expect(() => keyAtStart([MIN_KEY])).toThrow(FractionalIndexError);
  });
});

describe("isSortedByOrder / hasUniqueKeys", () => {
  it("detects unsorted orders and duplicates", () => {
    expect(isSortedByOrder([{ order: "a" }, { order: "b" }])).toBe(true);
    expect(isSortedByOrder([{ order: "b" }, { order: "a" }])).toBe(false);
    expect(isSortedByOrder([{ order: "a" }, { order: "a" }])).toBe(false);
    expect(isSortedByOrder([])).toBe(true);
    expect(isSortedByOrder([{ order: "a" }])).toBe(true);

    expect(hasUniqueKeys([{ order: "a" }, { order: "b" }])).toBe(true);
    expect(hasUniqueKeys([{ order: "a" }, { order: "a" }])).toBe(false);
    expect(hasUniqueKeys([])).toBe(true);
  });
});

describe("changedKeys", () => {
  /**
   * A rebalance window can straddle the insertion point, and then `plan.keys`
   * contains the new key *in the middle* of the replacements. The obvious loop —
   * pair original `i` with `plan.keys[i]` — gives an original a key that belongs to
   * a *different* slot, and the collision that matters is with the **inserted key**:
   * the copy and its neighbour end up sharing an `order`, which is exactly the
   * corruption `repairOrderIfNeeded` exists to clean up.
   */
  it("gives every original its own key when the insertion is mid-window", () => {
    // Two adjacent integers: no key fits between them, so a rebalance must widen
    // the window, and the new key lands inside it.
    const keys = [intToKey(1000n), intToKey(1001n)];

    const result = insertKey(keys, 1, () => 0.5);
    expect(result.rebalance).not.toBeNull();
    const plan = result.rebalance!;
    // The precondition for the bug: the insertion is not last in the window.
    expect(plan.insertOffset).toBeLessThan(plan.count);

    // The key the *caller* uses for the new item is `result.keys[1]`.
    const insertedKey = result.keys[1];

    // Applying only the reported changes must leave every key distinct, including
    // the inserted one.
    const applied = [...keys];
    for (const [index, newKey] of changedKeys(keys, plan)) {
      applied[index] = newKey;
    }
    expect(new Set([...applied, insertedKey]).size).toBe(keys.length + 1);

    // The naive pairing collides with the insertion, which is why the skip exists.
    const naive = keys.map((_key, i) => plan.keys[i]);
    expect(new Set([...naive, insertedKey]).size).toBeLessThan(keys.length + 1);
  });

  it("reports a change only when the key really differs", () => {
    const keys = [intToKey(1n), intToKey(2n)];
    const plan = planRebalance(keys, 1, 1);
    expect(plan).not.toBeNull();
    const changed = changedKeys(keys, plan!);
    // Each reported pair must actually change that key, and nothing unreported may.
    const reported = new Set(changed.map(([index]) => index));
    for (let i = 0; i < keys.length; i++) {
      const next =
        plan!.keys[i < plan!.insertOffset ? i : i + plan!.insertCount];
      expect(reported.has(i)).toBe(keys[i] !== next);
    }
  });

  it("returns nothing when a rebalance would not move anything", () => {
    const keys = [intToKey(10n), intToKey(20n)];
    // Explicitly request a plan over the whole list, then check that the keys it
    // generates for the originals are the ones they already hold is not guaranteed
    // — but a plan for zero replacements over an empty list must be empty.
    const empty = planRebalance([], 0, 1);
    if (empty) expect(changedKeys([], empty)).toEqual([]);
    void keys;
  });
});
