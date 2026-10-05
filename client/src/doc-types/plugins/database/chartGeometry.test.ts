import { describe, expect, it } from "vitest";
import {
  bands,
  niceScale,
  pieArcPath,
  pieSlices,
  scaleY,
} from "./chartGeometry";

/**
 * These tests pin the axis `chartData` values are drawn against, and the two pie cases
 * that render nothing when handled naively: a slice covering the whole circle (two SVG
 * arc endpoints that coincide) and a set of values that cannot be shares of a whole.
 *
 * The axis rule that matters most is **zero is always in the domain**: a bar's length is
 * its value, and that is only true if every bar is measured from the same baseline.
 */

describe("niceScale", () => {
  it("covers the data with round ticks including zero", () => {
    const scale = niceScale([0, 3, 7]);
    expect(scale.min).toBe(0);
    expect(scale.max).toBeGreaterThanOrEqual(7);
    expect(scale.ticks).toEqual([0, 2, 4, 6, 8]);
  });

  it("keeps zero in the domain even when every value is above it", () => {
    // Truncating the axis would draw a bar twice as long for a value twice as large.
    const scale = niceScale([90, 95, 100]);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(100);
  });

  it("reaches below zero for negative values", () => {
    const scale = niceScale([-8, 4]);
    expect(scale.min).toBeLessThanOrEqual(-8);
    expect(scale.max).toBeGreaterThanOrEqual(4);
    expect(scale.ticks).toContain(0);
  });

  it("gives an all-zero dataset a usable axis", () => {
    // The ticks must not collapse into a single repeated label.
    const scale = niceScale([0, 0, 0]);
    expect(scale.max).toBeGreaterThan(0);
    expect(scale.ticks.length).toBeGreaterThan(1);
  });

  it("gives an all-equal dataset a non-degenerate axis", () => {
    const scale = niceScale([5, 5, 5]);
    expect(scale.min).toBe(0);
    expect(scale.ticks.length).toBeGreaterThan(1);
    expect(scale.ticks[scale.ticks.length - 1]).toBeGreaterThanOrEqual(5);
  });

  it("produces increasing ticks with no floating-point noise", () => {
    // 0.1 + 0.2 style drift is what makes an axis read "0.30000000000000004".
    const scale = niceScale([0, 0.5, 1]);
    for (let index = 1; index < scale.ticks.length; index++) {
      expect(scale.ticks[index]).toBeGreaterThan(scale.ticks[index - 1]);
    }
    expect(scale.ticks.every((tick) => Number.isFinite(tick))).toBe(true);
  });

  it("ignores non-finite values", () => {
    const scale = niceScale([Number.NaN, 4, Number.POSITIVE_INFINITY]);
    expect(scale.max).toBeGreaterThanOrEqual(4);
    expect(scale.ticks.every((tick) => Number.isFinite(tick))).toBe(true);
  });
});

describe("scaleY", () => {
  it("maps the maximum to the top and the minimum to the bottom", () => {
    expect(scaleY(10, 0, 10, 100)).toBe(0);
    expect(scaleY(0, 0, 10, 100)).toBe(100);
    expect(scaleY(5, 0, 10, 100)).toBe(50);
  });

  it("places a negative value below the zero line", () => {
    const zero = scaleY(0, -10, 10, 100);
    expect(scaleY(-10, -10, 10, 100)).toBe(100);
    expect(zero).toBe(50);
  });

  it("does not divide by a degenerate domain", () => {
    expect(Number.isFinite(scaleY(3, 3, 3, 100))).toBe(true);
  });
});

describe("bands", () => {
  it("divides the width into equal slots", () => {
    const result = bands(4, 400);
    expect(result).toHaveLength(4);
    expect(result[0].x).toBeGreaterThan(0);
    expect(result[3].x).toBeGreaterThan(result[2].x);
  });

  it("centres each band in its slot", () => {
    const result = bands(4, 400);
    for (let index = 0; index < 4; index++) {
      const slotCentre = index * 100 + 50;
      expect(result[index].center).toBe(slotCentre);
      // The bar's own centre lines up with the slot's, which is what puts a bar over
      // its tick rather than starting on it.
      expect(result[index].x + result[index].width / 2).toBeCloseTo(
        slotCentre,
        6,
      );
    }
  });

  it("leaves a gap between neighbours and never returns a zero width", () => {
    const result = bands(3, 90);
    expect(result[1].x).toBeGreaterThan(result[0].x + result[0].width);
    expect(bands(200, 100).every((band) => band.width >= 1)).toBe(true);
  });

  it("returns nothing for an empty or zero-width chart", () => {
    expect(bands(0, 100)).toEqual([]);
    expect(bands(3, 0)).toEqual([]);
  });
});

describe("pieSlices", () => {
  it("gives each value its share of the whole", () => {
    const slices = pieSlices([1, 3]);
    expect(slices[0].fraction).toBeCloseTo(0.25, 6);
    expect(slices[1].fraction).toBeCloseTo(0.75, 6);
    expect(slices[1].endAngle).toBeCloseTo(Math.PI * 2, 6);
  });

  it("gives a single value the whole circle", () => {
    const slices = pieSlices([7]);
    expect(slices[0].fraction).toBe(1);
    expect(slices[0].endAngle - slices[0].startAngle).toBeCloseTo(
      Math.PI * 2,
      6,
    );
  });

  it("gives a zero value no arc", () => {
    const slices = pieSlices([0, 5]);
    expect(slices[0].fraction).toBe(0);
    expect(slices[0].startAngle).toBe(slices[0].endAngle);
  });

  it("cannot represent negative values, so it reports none rather than drawing one", () => {
    // A slice is a share of a whole; a negative share is not something a reader can
    // interpret, and a total of zero cannot be divided proportionally at all.
    expect(pieSlices([-1, 2, 3])[0].fraction).toBe(0);
    expect(pieSlices([0, 0])).toEqual([]);
    expect(pieSlices([-1, -2])).toEqual([]);
  });
});

describe("pieArcPath", () => {
  it("draws a two-arc path for a full circle", () => {
    // One SVG arc whose endpoints coincide is defined to draw nothing, so a one-slice
    // 100% pie — the state a filter most easily produces — would be a blank chart.
    const path = pieArcPath(100, 100, 50, 0, Math.PI * 2);
    expect(path.match(/A /g)).toHaveLength(2);
    expect(path).toContain("M 100 50");
  });

  it("draws a wedge from the centre for a partial slice", () => {
    const path = pieArcPath(100, 100, 50, 0, Math.PI / 2);
    expect(path.startsWith("M 100 100 L 100 50")).toBe(true);
    expect(path.match(/A /g)).toHaveLength(1);
    expect(path.endsWith("Z")).toBe(true);
  });

  it("uses the large-arc flag past a half turn", () => {
    // 225° is past the half-way point, so the sweep has to go the long way round.
    expect(pieArcPath(0, 0, 10, 0, Math.PI * 1.25)).toContain(" 1 1 ");
    expect(pieArcPath(0, 0, 10, 0, Math.PI * 0.25)).toContain(" 0 1 ");
  });

  it("starts at twelve o'clock and sweeps clockwise", () => {
    const quarter = pieArcPath(0, 0, 10, 0, Math.PI / 2);
    // 90° clockwise from the top is the +x side.
    expect(quarter).toContain("A 10 10 0 0 1 10 0");
  });
});
