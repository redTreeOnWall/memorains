/**
 * Column widths and frozen columns for the table view.
 *
 * Pure and free of React and Yjs, so the arithmetic that is easy to get subtly wrong —
 * how wide a column may be, and where a frozen column sits once the ones before it have
 * been measured — can be tested without a DOM.
 *
 * ## Why the offsets are derived rather than stored
 *
 * A frozen cell needs `left: <the total width of the frozen columns before it>`, which is
 * the **sum of the widths in front of it**, not its own. Storing that per column would be a
 * second source of truth for something the widths already determine, and the two would
 * disagree the moment one of them changed — a frozen column would render a few pixels off
 * its neighbour, which reads as a rendering glitch rather than as stale state.
 */

/** Width of a column that has never been resized. */
export const DEFAULT_COLUMN_WIDTH = 220;

/**
 * How narrow and wide a column may be dragged.
 *
 * The minimum is what a value still fits in — a date, a chip, a checkbox — plus the two
 * row affordances the first column carries. The maximum keeps one column from consuming
 * the whole viewport, at which point the table has stopped being a table.
 */
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 900;

/** Clamp a width into the range a user may drag to. */
export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COLUMN_WIDTH;
  return Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, Math.round(width)),
  );
}

/**
 * The width to draw a column at.
 *
 * An absent entry is the default, so a view that has never been resized stores nothing —
 * which is also what lets the default change later without a migration.
 */
export function columnWidthOf(
  widths: Readonly<Record<string, number>> | undefined,
  propId: string,
): number {
  const stored = widths?.[propId];
  if (stored === undefined) return DEFAULT_COLUMN_WIDTH;
  // Clamped on read as well as on write: a value written by a newer client, or one hand
  // edited, must not be able to render a column the user cannot grab.
  return clampColumnWidth(stored);
}

/**
 * A new width from a resize gesture.
 *
 * Takes the width the drag started from and the pixels travelled, rather than the
 * pointer's absolute position: the pointer goes down *somewhere inside* the handle, and
 * measuring against its absolute x would make the column jump by that offset on the first
 * pixel of movement.
 */
export function resizedWidth(startWidth: number, deltaX: number): number {
  return clampColumnWidth(startWidth + deltaX);
}

/**
 * How many leading columns may be frozen.
 *
 * At most all but one: freezing every column leaves nothing that scrolls, so the table
 * would look frozen without behaving any differently — a setting that appears to do
 * nothing. The last column stays scrollable so the feature is always observable.
 */
export function clampFrozenCount(count: number, columnCount: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(count), Math.max(0, columnCount - 1)));
}

/**
 * Left offset for each of the first `frozenCount` columns.
 *
 * Returned as a plain array parallel to the frozen run, so a header cell and its body cells
 * both read the same number for the same column — a body cell that disagreed with its
 * header would misalign every value under a frozen header.
 */
export function frozenOffsets(
  propIds: readonly string[],
  frozenCount: number,
  widths: Readonly<Record<string, number>> | undefined,
): number[] {
  const count = clampFrozenCount(frozenCount, propIds.length);
  const offsets: number[] = [];
  let left = 0;
  for (let index = 0; index < count; index += 1) {
    offsets.push(left);
    left += columnWidthOf(widths, propIds[index]);
  }
  return offsets;
}

/**
 * Whether a column's right edge should read as the boundary of the frozen run.
 *
 * The line is what makes the frozen block legible as a block: without it, a frozen column
 * and the one scrolling under it look like two ordinary neighbours, and the seam is only
 * obvious once something has scrolled.
 */
export function isFrozenBoundary(
  index: number,
  frozenCount: number,
  columnCount: number,
): boolean {
  const frozen = clampFrozenCount(frozenCount, columnCount);
  return frozen > 0 && index === frozen - 1;
}
