import { describe, expect, it } from "vitest";
import {
  clampColumnWidth,
  clampFrozenCount,
  columnWidthOf,
  DEFAULT_COLUMN_WIDTH,
  frozenOffsets,
  isFrozenBoundary,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  resizedWidth,
} from "./columnLayout";

/**
 * These tests pin the arithmetic that a table gets wrong invisibly: a width outside the
 * range a user can drag back, and a frozen column offset that disagrees with the columns
 * in front of it. Neither throws — one renders a column nothing can grab, the other
 * renders a frozen column a few pixels off its neighbours, which reads as a rendering
 * glitch rather than as arithmetic.
 */

const WIDTHS: Record<string, number> = {
  a: 100,
  b: 150,
  c: 200,
};

describe("clampColumnWidth", () => {
  it("leaves a width inside the range alone, rounded to a whole pixel", () => {
    expect(clampColumnWidth(220)).toBe(220);
    expect(clampColumnWidth(180.4)).toBe(180);
  });

  it("clamps at both ends", () => {
    expect(clampColumnWidth(1)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(5000)).toBe(MAX_COLUMN_WIDTH);
  });

  it("falls back to the default for a value that is not a number", () => {
    // Reachable: a hand-edited document, or a field a newer client wrote as null.
    expect(clampColumnWidth(Number.NaN)).toBe(DEFAULT_COLUMN_WIDTH);
    expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_COLUMN_WIDTH,
    );
    expect(clampColumnWidth(Number.NEGATIVE_INFINITY)).toBe(
      DEFAULT_COLUMN_WIDTH,
    );
  });
});

describe("columnWidthOf", () => {
  it("uses the stored width", () => {
    expect(columnWidthOf(WIDTHS, "b")).toBe(150);
  });

  it("falls back to the default for a column with no stored width", () => {
    // The common case: a view that was never resized stores nothing at all.
    expect(columnWidthOf(WIDTHS, "missing")).toBe(DEFAULT_COLUMN_WIDTH);
    expect(columnWidthOf(undefined, "a")).toBe(DEFAULT_COLUMN_WIDTH);
  });

  it("clamps a stored width that is out of range", () => {
    // Clamped on **read** as well as write, so a value written by a newer client cannot
    // render a column the user has no way to grab.
    expect(columnWidthOf({ a: 10 }, "a")).toBe(MIN_COLUMN_WIDTH);
    expect(columnWidthOf({ a: 9000 }, "a")).toBe(MAX_COLUMN_WIDTH);
  });
});

describe("resizedWidth", () => {
  it("moves by the distance dragged, not to the pointer's position", () => {
    // Delta-based on purpose: the pointer goes down *somewhere inside* the handle, and
    // measuring absolutely would jump the column by that offset on the first pixel.
    expect(resizedWidth(220, 40)).toBe(260);
    expect(resizedWidth(220, -40)).toBe(180);
    expect(resizedWidth(220, 0)).toBe(220);
  });

  it("clamps while the drag runs, so the column cannot be dragged out of reach", () => {
    expect(resizedWidth(100, -1000)).toBe(MIN_COLUMN_WIDTH);
    expect(resizedWidth(800, 1000)).toBe(MAX_COLUMN_WIDTH);
  });
});

describe("clampFrozenCount", () => {
  it("refuses to freeze every column", () => {
    // Freezing everything leaves nothing scrolling, so the setting would appear to do
    // nothing at all. The last column always stays scrollable.
    expect(clampFrozenCount(3, 3)).toBe(2);
    expect(clampFrozenCount(10, 4)).toBe(3);
  });

  it("accepts a count below the limit", () => {
    expect(clampFrozenCount(1, 4)).toBe(1);
    expect(clampFrozenCount(2, 4)).toBe(2);
  });

  it("treats zero, negative and unusable values as nothing frozen", () => {
    expect(clampFrozenCount(0, 4)).toBe(0);
    expect(clampFrozenCount(-1, 4)).toBe(0);
    expect(clampFrozenCount(Number.NaN, 4)).toBe(0);
  });

  it("freezes nothing when there is only one column", () => {
    expect(clampFrozenCount(2, 1)).toBe(0);
    expect(clampFrozenCount(2, 0)).toBe(0);
  });
});

describe("frozenOffsets", () => {
  const ids = ["a", "b", "c"];

  it("offsets each frozen column by the widths in front of it", () => {
    // The first sits at 0; the second starts where the first ends. Using a column's *own*
    // width would stack every frozen column at the same place.
    expect(frozenOffsets(ids, 2, WIDTHS)).toEqual([0, 100]);
  });

  it("keeps accumulating through a longer frozen run", () => {
    // Four columns and three frozen, so the clamp is not what decides the length.
    expect(frozenOffsets(["a", "b", "c", "d"], 3, WIDTHS)).toEqual([
      0, 100, 250,
    ]);
  });

  it("returns a prefix, never a middle slice", () => {
    // Freezing is a prefix by construction: a frozen column with a scrolling one before
    // it would scroll away anyway, leaving a gap.
    expect(frozenOffsets(ids, 1, WIDTHS)).toEqual([0]);
  });

  it("uses default widths for columns that were never resized", () => {
    expect(frozenOffsets(["a", "b", "c", "d"], 3, undefined)).toEqual([
      0,
      DEFAULT_COLUMN_WIDTH,
      DEFAULT_COLUMN_WIDTH * 2,
    ]);
  });

  it("is empty when nothing is frozen", () => {
    expect(frozenOffsets(ids, 0, WIDTHS)).toEqual([]);
  });

  it("clamps the count the same way the setter does", () => {
    // The stored count and the drawn offsets must agree, or a frozen run would be drawn
    // wider than the setting says it is.
    expect(frozenOffsets(ids, 99, WIDTHS)).toEqual([0, 100]);
  });
});

describe("isFrozenBoundary", () => {
  it("marks the last frozen column", () => {
    expect(isFrozenBoundary(1, 2, 5)).toBe(true);
    expect(isFrozenBoundary(0, 2, 5)).toBe(false);
    expect(isFrozenBoundary(2, 2, 5)).toBe(false);
  });

  it("marks nothing when nothing is frozen", () => {
    expect(isFrozenBoundary(0, 0, 5)).toBe(false);
  });

  it("marks the right column when the count had to be clamped", () => {
    // A stored count of 99 on a three-column table freezes two, so the seam belongs on
    // column 1 — not on the column a stale count named.
    expect(isFrozenBoundary(1, 99, 3)).toBe(true);
    expect(isFrozenBoundary(2, 99, 3)).toBe(false);
  });
});
