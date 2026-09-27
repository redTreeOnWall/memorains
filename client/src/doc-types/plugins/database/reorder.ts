/**
 * The arithmetic behind drag-to-reorder, kept pure and testable.
 *
 * Reordering a row or a column is a two-step translation that is easy to get wrong
 * at a call site:
 *
 * 1. a pointer position becomes "before or after *this* item", and
 * 2. that neighbour becomes a new position.
 *
 * The model already exposes the second half in neighbour form
 * (`moveRowBefore` / `movePropertyBefore`), precisely so no view has to do index
 * arithmetic against a list with the dragged item removed. These functions cover
 * the middle: turning the item under the pointer into an anchor.
 *
 * No React and no `Y.Doc`, so the whole thing runs in the node test environment.
 * The alternative — computing it inside the drag handler — cannot be asserted
 * without a DOM, which is exactly where the off-by-one bugs would live.
 */

/** Where the dragged item should land, and whether that is a change at all. */
export interface MoveAnchor {
  /**
   * The item to place the dragged one **immediately before**.
   *
   * This is the neighbour form the binding expects (`moveRowBefore` /
   * `movePropertyBefore`), not an index: an index would have to be interpreted
   * against a list the caller has to remember to strip the dragged item from,
   * which is where off-by-one bugs live. `null` means the end of the list, and
   * "immediately before the first item" is how the front is expressed — so one
   * `beforeId` covers every position, including both ends.
   */
  beforeId: string | null;
  /**
   * Whether this move would change anything.
   *
   * Dropping an item back onto its own position is a normal thing for a user to do
   * — including on the edge of an adjacent row that is visually indistinguishable
   * from "no move" — and writing an `order` key for it would broadcast a pointless
   * CRDT update to every collaborator.
   */
  changed: boolean;
}

/**
 * Work out where a dragged item should land.
 *
 * @param items   The items **in display order**, including the dragged one.
 * @param draggedId The item being dragged.
 * @param overId  The item the pointer is currently over.
 * @param after   Whether the pointer has passed `overId`'s midpoint, so the drop
 *                means "after it" rather than "before it".
 * @returns The anchor, or `null` when either id is not in `items` (an item can be
 *          deleted by a collaborator mid-drag, which must not throw).
 */
export function computeMoveAnchor<T extends { id: string }>(
  items: readonly T[],
  draggedId: string,
  overId: string,
  after: boolean,
): MoveAnchor | null {
  // Dropping an item on itself is the one case the arithmetic below cannot
  // express, because the target is not in the list once the item is removed.
  if (draggedId === overId) return { beforeId: null, changed: false };

  const from = items.findIndex((item) => item.id === draggedId);
  if (from < 0) return null;
  const overIndex = items.findIndex((item) => item.id === overId);
  if (overIndex < 0) return null;

  // The dragged item is removed first, which is the only way the arithmetic is
  // free of off-by-one: in the remaining list the target index *is* the answer.
  const remaining = items.filter((item) => item.id !== draggedId);
  const remainingOver = remaining.findIndex((item) => item.id === overId);

  // Where the item would sit, measured in the remaining list.
  const desired = after ? remainingOver + 1 : remainingOver;

  if (desired === from) {
    // A no-op is exactly "remove and reinsert at the same index", which makes all
    // of the visually-identical drags — dropping on yourself, on the lower half of
    // the item above you, on the upper half of the item below you — fall out of
    // one comparison instead of three special cases.
    return { beforeId: null, changed: false };
  }

  return {
    beforeId: desired >= remaining.length ? null : remaining[desired].id,
    changed: true,
  };
}

/**
 * Whether a pointer has crossed the midpoint of a box, along one axis.
 *
 * Half of the box is "before", half is "after", which is how a drag between two
 * items is expressed with nothing but a position — the same rule a text cursor
 * uses to decide which side of a character it belongs on.
 */
export function isAfterMidpoint(
  rect: { left: number; top: number; width: number; height: number },
  point: { x: number; y: number },
  axis: "x" | "y",
): boolean {
  return axis === "x"
    ? point.x > rect.left + rect.width / 2
    : point.y > rect.top + rect.height / 2;
}
