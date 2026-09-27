import { describe, expect, it } from "vitest";
import { computeMoveAnchor, isAfterMidpoint } from "./reorder";

/**
 * Drag-to-reorder arithmetic.
 *
 * These are the tests the UI cannot replace: a drop indicator and the stored order
 * can both look right while the move is off by one, and the failure is only visible
 * as "the item landed next to where I dropped it". The pure helper is where the
 * off-by-one lives, so it is asserted here exhaustively.
 */

const items = (...ids: string[]) => ids.map((id) => ({ id }));

describe("computeMoveAnchor: where a dragged item lands", () => {
  it("moves to the front when dropped before the first item", () => {
    const list = items("a", "b", "c", "d");
    // "c" dropped on the upper half of "a" -> before a.
    expect(computeMoveAnchor(list, "c", "a", false)).toEqual({
      beforeId: "a",
      changed: true,
    });
  });

  it("moves to the end when dropped after the last item", () => {
    const list = items("a", "b", "c", "d");
    expect(computeMoveAnchor(list, "a", "d", true)).toEqual({
      beforeId: null,
      changed: true,
    });
  });

  it("places the item before the target on the leading half", () => {
    const list = items("a", "b", "c");
    // "c" onto the upper half of "b": a, c, b.
    expect(computeMoveAnchor(list, "c", "b", false)).toEqual({
      beforeId: "b",
      changed: true,
    });
  });

  it("places the item after the target on the trailing half", () => {
    const list = items("a", "b", "c");
    // "a" onto the lower half of "b": b, a, c.
    expect(computeMoveAnchor(list, "a", "b", true)).toEqual({
      beforeId: "c",
      changed: true,
    });
  });

  it("is not confused by a target after the dragged item", () => {
    // The classic off-by-one: "a" onto the upper half of "c" is position 1 in
    // b, c, d -> before "c", giving b, a, c, d.
    const list = items("a", "b", "c", "d");
    expect(computeMoveAnchor(list, "a", "c", false)).toEqual({
      beforeId: "c",
      changed: true,
    });
  });

  it("treats a drop on itself as a no-op", () => {
    const list = items("a", "b", "c");
    expect(computeMoveAnchor(list, "b", "b", false)).toEqual({
      beforeId: null,
      changed: false,
    });
    expect(computeMoveAnchor(list, "b", "b", true)).toEqual({
      beforeId: null,
      changed: false,
    });
  });

  it("treats the two visually-identical neighbour drops as no-ops", () => {
    // The item immediately *after* you, upper half: "stay before it" is where you
    // already are.
    const list = items("a", "b", "c");
    expect(computeMoveAnchor(list, "b", "c", false)!.changed).toBe(false);
    // The item immediately *before* you, lower half: "stay after it" is also where
    // you already are. Both must be silent, or a hover writes an `order` key.
    expect(computeMoveAnchor(list, "b", "a", true)!.changed).toBe(false);
  });

  it("is a real move on the far half of a neighbour", () => {
    // Lower half of the next item means "past it", which is a genuine reorder.
    const list = items("a", "b", "c");
    expect(computeMoveAnchor(list, "b", "c", true)).toEqual({
      beforeId: null,
      changed: true,
    });
    // Upper half of the previous item means "in front of it", likewise a move.
    expect(computeMoveAnchor(list, "b", "a", false)).toEqual({
      beforeId: "a",
      changed: true,
    });
  });

  it("is a real move when dropping past the neighbour after", () => {
    // Upper half of the item *two* places down is a genuine reorder.
    const list = items("a", "b", "c", "d");
    expect(computeMoveAnchor(list, "b", "d", false)).toEqual({
      beforeId: "d",
      changed: true,
    });
  });

  it("returns null for an id that is no longer in the list", () => {
    // A collaborator can delete an item while the drag is in flight; that must not
    // throw, it must simply do nothing.
    const list = items("a", "b");
    expect(computeMoveAnchor(list, "gone", "a", false)).toBeNull();
    expect(computeMoveAnchor(list, "a", "gone", false)).toBeNull();
  });

  it("handles a single-item list", () => {
    expect(computeMoveAnchor(items("a"), "a", "a", false)!.changed).toBe(false);
  });
});

/**
 * Apply an anchor the way the model does, so the assertion is about the resulting
 * *order* rather than about a tuple — the tuple can be right while the order is not.
 */
const applyMove = (ids: string[], dragged: string, beforeId: string | null) => {
  const rest = ids.filter((id) => id !== dragged);
  const index =
    beforeId === null ? rest.length : rest.findIndex((id) => id === beforeId);
  return [...rest.slice(0, index), dragged, ...rest.slice(index)];
};

const drag = (
  ids: string[],
  dragged: string,
  over: string,
  after: boolean,
): string[] => {
  const anchor = computeMoveAnchor(items(...ids), dragged, over, after);
  if (!anchor) throw new Error("anchor missing for a valid drag");
  return anchor.changed ? applyMove(ids, dragged, anchor.beforeId) : ids;
};

describe("computeMoveAnchor: exhaustive behaviour", () => {
  const ids = ["a", "b", "c", "d"];

  it("never loses or duplicates an item, for every pair and side", () => {
    for (const dragged of ids) {
      for (const over of ids) {
        for (const after of [false, true]) {
          const result = drag(ids, dragged, over, after);
          expect(new Set(result).size).toBe(ids.length);
          expect(result).toHaveLength(ids.length);
        }
      }
    }
  });

  it("reports exactly the drags that change the order as changed", () => {
    for (const dragged of ids) {
      for (const over of ids) {
        for (const after of [false, true]) {
          const anchor = computeMoveAnchor(
            items(...ids),
            dragged,
            over,
            after,
          )!;
          const result = anchor.changed
            ? applyMove(ids, dragged, anchor.beforeId)
            : ids;
          // `changed` must agree with whether the order actually differs, in both
          // directions: a false negative skips a real move, a false positive
          // broadcasts an update nobody asked for.
          expect(anchor.changed).toBe(result.join() !== ids.join());
        }
      }
    }
  });

  it("lands on the side of the target the pointer indicated", () => {
    expect(drag(["a", "b", "c", "d"], "d", "b", false)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
    expect(drag(["a", "b", "c", "d"], "d", "b", true)).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
  });

  it("agrees with a straight remove-and-reinsert for every non-no-op drag", () => {
    // The property the model relies on: the anchor names a neighbour whose index
    // in the list *without* the dragged item is the insertion point.
    for (const dragged of ids) {
      for (const over of ids) {
        for (const after of [false, true]) {
          const anchor = computeMoveAnchor(
            items(...ids),
            dragged,
            over,
            after,
          )!;
          if (!anchor.changed) continue;
          const rest = ids.filter((id) => id !== dragged);
          const overIndex = rest.indexOf(over);
          const expectedIndex = after ? overIndex + 1 : overIndex;
          const actualIndex =
            anchor.beforeId === null
              ? rest.length
              : rest.indexOf(anchor.beforeId);
          expect(actualIndex).toBe(expectedIndex);
        }
      }
    }
  });
});

describe("isAfterMidpoint", () => {
  const rect = { left: 100, top: 200, width: 80, height: 40 };

  it("splits a box down the middle on the x axis", () => {
    expect(isAfterMidpoint(rect, { x: 110, y: 0 }, "x")).toBe(false);
    expect(isAfterMidpoint(rect, { x: 150, y: 0 }, "x")).toBe(true);
  });

  it("splits a box down the middle on the y axis", () => {
    expect(isAfterMidpoint(rect, { x: 0, y: 205 }, "y")).toBe(false);
    expect(isAfterMidpoint(rect, { x: 0, y: 225 }, "y")).toBe(true);
  });

  it("exactly at the midpoint counts as the leading half", () => {
    // The boundary has to go somewhere; ">" vs ">=" is only observable as a
    // one-pixel flicker, but pinning it makes the behaviour deterministic.
    expect(isAfterMidpoint(rect, { x: 140, y: 0 }, "x")).toBe(false);
    expect(isAfterMidpoint(rect, { x: 0, y: 220 }, "y")).toBe(false);
  });
});
