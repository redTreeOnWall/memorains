import type * as Y from "yjs";

/**
 * Minimal-splice text updates for `Y.Text` cells.
 *
 * ## Why not just assign the new string
 *
 * A controlled textarea hands us the whole new value on every keystroke. Writing
 * it by replacing the entire `Y.Text` content would:
 *
 * 1. emit the full value on every keystroke instead of one character, and
 * 2. destroy the merge property that is the entire reason for storing a cell as
 *    `Y.Text` — two peers editing different parts of the same cell would
 *    overwrite each other instead of merging.
 *
 * Trimming the common prefix and suffix reduces an edit to the smallest single
 * splice, which fixes both. This is why the diff is computed here rather than at
 * the call site.
 */

export interface TextDiff {
  /** Index in the current string where the splice starts. */
  start: number;
  /** How many characters to delete. */
  deleteCount: number;
  /** Text to insert at `start`. */
  insertText: string;
}

/**
 * The minimal splice turning `current` into `next`, or `null` if they are equal.
 *
 * Pure: this is the part worth testing, and `applyTextDiff` is a thin wrapper.
 */
export function computeTextDiff(
  current: string,
  next: string,
): TextDiff | null {
  if (current === next) return null;

  let start = 0;
  const maxStart = Math.min(current.length, next.length);
  while (start < maxStart && current[start] === next[start]) start++;

  let suffix = 0;
  const maxSuffix = Math.min(current.length, next.length) - start;
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    start,
    deleteCount: current.length - start - suffix,
    insertText: next.slice(start, next.length - suffix),
  };
}

/**
 * Apply `next` to `text` as one minimal splice.
 *
 * Returns the diff that was applied, or `null` when nothing changed, so callers
 * can skip opening a transaction for a no-op edit (which a controlled input does
 * fire, e.g. on blur).
 */
export function applyTextDiff(text: Y.Text, next: string): TextDiff | null {
  const diff = computeTextDiff(text.toString(), next);
  if (!diff) return null;

  if (diff.deleteCount > 0) text.delete(diff.start, diff.deleteCount);
  if (diff.insertText) text.insert(diff.start, diff.insertText);
  return diff;
}
