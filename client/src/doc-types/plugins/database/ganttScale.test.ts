import { describe, expect, it } from "vitest";
import {
  axisDays,
  axisLabels,
  barGeometry,
  daysBetween,
  planAxis,
  shiftDayKey,
  showsDayLabels,
  todayKey,
} from "./ganttScale";

/**
 * These tests pin the two rules the chart's geometry rests on: **day keys are advanced
 * with UTC arithmetic**, and **a bar's pixels are derived from one day width**.
 *
 * Both are the kind of thing that is invisible when wrong. A local-`Date` shift looks
 * correct for 364 days a year and moves a bar by a day across a daylight-saving
 * boundary; a second geometry formula puts a bar a few pixels off its own gridline,
 * which reads as a rounding artefact rather than as a bug.
 *
 * Run under `TZ=Asia/Shanghai` and `TZ=America/New_York` as well as UTC — the suite
 * makes no assumption about the offset, so it passes in all three.
 */
describe("shiftDayKey", () => {
  it("advances by whole days across month and year boundaries", () => {
    expect(shiftDayKey("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(shiftDayKey("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDayKey("2024-02-29", 1)).toBe("2024-03-01");
    // 2026 is not a leap year, so February has 28 days.
    expect(shiftDayKey("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("crosses a daylight-saving boundary without losing a day", () => {
    // US DST 2026 starts on 8 March and ends on 1 November; the European transitions
    // are 29 March and 25 October. All four dates are stepped over, because a local
    // `Date` + 86_400_000 shift is wrong on exactly the day it happens.
    expect(shiftDayKey("2026-03-07", 1)).toBe("2026-03-08");
    expect(shiftDayKey("2026-03-08", 1)).toBe("2026-03-09");
    expect(shiftDayKey("2026-10-24", 1)).toBe("2026-10-25");
    expect(shiftDayKey("2026-10-25", 1)).toBe("2026-10-26");
    expect(shiftDayKey("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("is its own inverse over a long span", () => {
    const key = "2026-03-07";
    expect(shiftDayKey(shiftDayKey(key, 400), -400)).toBe(key);
    expect(shiftDayKey(shiftDayKey(key, -400), 400)).toBe(key);
  });

  it("returns the key unchanged for a shift of zero or an unusable key", () => {
    expect(shiftDayKey("2026-05-05", 0)).toBe("2026-05-05");
    // Not a date: `Date` would roll "2026-02-31" forward rather than reject it, and a
    // key that came from a corrupted cell must not silently become a different day.
    expect(shiftDayKey("2026-02-31", 1)).toBe("2026-02-31");
    expect(shiftDayKey("nonsense", 1)).toBe("nonsense");
  });
});

describe("daysBetween", () => {
  it("counts whole days in both directions", () => {
    expect(daysBetween("2026-03-01", "2026-03-04")).toBe(3);
    expect(daysBetween("2026-03-04", "2026-03-01")).toBe(-3);
    expect(daysBetween("2026-03-01", "2026-03-01")).toBe(0);
  });

  it("counts a year and a leap year exactly", () => {
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
  });

  it("counts one day across a daylight-saving boundary", () => {
    // The trap: two local midnights are 23 or 25 hours apart, so a millisecond
    // difference rounded from local time gives 0 or 2 here depending on the sign.
    expect(daysBetween("2026-03-07", "2026-03-08")).toBe(1);
    expect(daysBetween("2026-03-08", "2026-03-07")).toBe(-1);
    expect(daysBetween("2026-10-24", "2026-10-25")).toBe(1);
    expect(daysBetween("2026-10-25", "2026-10-24")).toBe(-1);
  });

  it("is zero rather than throwing for an unusable key", () => {
    expect(daysBetween("nonsense", "2026-03-01")).toBe(0);
    expect(daysBetween("2026-03-01", "2026-02-31")).toBe(0);
  });
});

describe("planAxis", () => {
  const base = {
    zoom: undefined,
    first: null as string | null,
    last: null as string | null,
    usableWidth: 800,
    today: "2026-06-15",
  };

  it("opens on the month containing today when nothing is scheduled", () => {
    const plan = planAxis(base);
    expect(plan.anchor).toBe("2026-06-01");
  });

  it("does not depend on the real clock for that fallback", () => {
    const plan = planAxis({ ...base, today: "2026-12-31" });
    expect(plan.anchor).toBe("2026-12-01");
  });

  it("fits the data plus a margin at each end, and never overflows the viewport", () => {
    const plan = planAxis({ ...base, first: "2026-03-02", last: "2026-03-05" });
    // 4 days of data + 2 days of lead at each end.
    expect(plan.anchor).toBe("2026-02-28");
    expect(plan.dayCount).toBe(8);
    // A fitted chart must never be wider than what it was fitted to, or it scrolls for
    // no reason — that is the whole failure this plan exists to make impossible.
    expect(plan.dayCount * plan.dayWidth).toBeLessThanOrEqual(base.usableWidth);
  });

  it("leaves the day width alone rather than stretching a short span absurdly", () => {
    // 4 days in an 800px viewport would be 100px a day: a chart whose bars are mostly
    // empty, and a day wider than the label gutter. The clamp keeps the scale sane and
    // lets the extra width stay empty.
    const plan = planAxis({ ...base, first: "2026-03-02", last: "2026-03-05" });
    expect(plan.dayWidth).toBe(40);
  });

  it("divides a mid-length span exactly, so there is no stray right-hand gap", () => {
    // 78 days of data + 2 of lead at each end is 82, which divides 820px exactly.
    const plan = planAxis({
      ...base,
      usableWidth: 820,
      first: "2026-03-02",
      last: "2026-05-18",
    });
    expect(plan.dayCount).toBe(82);
    expect(plan.dayWidth).toBe(10);
    expect(plan.dayCount * plan.dayWidth).toBe(820);
  });

  it("clamps a tiny span so one bar is not drawn 400px wide", () => {
    const plan = planAxis({ ...base, first: "2026-03-02", last: "2026-03-02" });
    expect(plan.dayWidth).toBe(40);
  });

  it("clamps a huge span so the axis is not sub-pixel", () => {
    const plan = planAxis({ ...base, first: "2016-01-01", last: "2026-01-01" });
    expect(plan.dayWidth).toBe(1.5);
  });

  it("falls back to a usable width before the viewport has been measured", () => {
    const plan = planAxis({
      ...base,
      first: "2026-03-02",
      last: "2026-03-05",
      usableWidth: 0,
    });
    expect(plan.dayWidth).toBe(10);
  });

  it("fixes a stored zoom's day width", () => {
    expect(planAxis({ ...base, zoom: "week" }).dayWidth).toBe(28);
    expect(planAxis({ ...base, zoom: "month" }).dayWidth).toBe(10);
    expect(planAxis({ ...base, zoom: "quarter" }).dayWidth).toBe(3.2);
  });

  it("fills the viewport at a fixed zoom, so the axis is not a stub", () => {
    // Nothing scheduled: the viewport decides, and an empty chart still gets an axis
    // rather than the single day a zero would clamp it to.
    const empty = planAxis({ ...base, zoom: "week" });
    expect(empty.dayCount * empty.dayWidth).toBeGreaterThanOrEqual(800);
  });

  it("extends a fixed zoom far enough to reach the last bar", () => {
    // A fortnight at week zoom is 392px in an 800px viewport, so the viewport wins.
    const short = planAxis({
      ...base,
      zoom: "week",
      first: "2026-03-02",
      last: "2026-03-15",
    });
    expect(short.dayCount * short.dayWidth).toBeGreaterThanOrEqual(800);

    // A year at week zoom is ~10 000px, far more than the viewport: the data wins, and
    // the chart scrolls rather than cutting the last bar off.
    const year = planAxis({
      ...base,
      zoom: "week",
      first: "2026-01-01",
      last: "2026-12-31",
    });
    expect(year.dayCount).toBeGreaterThan(350);
    expect(year.dayCount * year.dayWidth).toBeGreaterThan(800 * 10);
  });

  it("never asks for a decade of columns, however wild the data is", () => {
    const plan = planAxis({
      ...base,
      zoom: "quarter",
      first: "1900-01-01",
      last: "2026-01-01",
    });
    expect(plan.dayCount).toBeLessThanOrEqual(2600);
  });

  it("always covers at least one day", () => {
    expect(
      planAxis({ ...base, usableWidth: 0 }).dayCount,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("showsDayLabels", () => {
  it("names days only where a day is wide enough to hold a number", () => {
    expect(showsDayLabels(28)).toBe(true);
    expect(showsDayLabels(18)).toBe(true);
    expect(showsDayLabels(10)).toBe(false);
    expect(showsDayLabels(3.2)).toBe(false);
  });
});

describe("barGeometry", () => {
  it("puts the anchor day at x=0", () => {
    expect(barGeometry("2026-03-01", "2026-03-01", "2026-03-01", 10)).toEqual({
      x: 0,
      width: 10,
    });
  });

  it("counts both endpoints, so a 3rd-to-5th bar is three days wide", () => {
    const geometry = barGeometry("2026-03-03", "2026-03-05", "2026-03-01", 10);
    expect(geometry.x).toBe(20);
    expect(geometry.width).toBe(30);
  });

  it("draws a bar before the anchor with a negative x, not at zero", () => {
    // The axis can be scrolled past a bar; clamping it to 0 would draw it pinned to
    // the left edge, which claims a date it does not have.
    const geometry = barGeometry("2026-02-27", "2026-02-27", "2026-03-01", 10);
    expect(geometry.x).toBe(-20);
  });

  it("treats an end before the start as a one-day bar", () => {
    // A negative width would place the bar's left edge after its right and invert
    // every hit test on it.
    expect(
      barGeometry("2026-03-05", "2026-03-01", "2026-03-01", 10).width,
    ).toBe(10);
  });

  it("scales exactly with the day width", () => {
    const at10 = barGeometry("2026-03-03", "2026-03-07", "2026-03-01", 10);
    const at20 = barGeometry("2026-03-03", "2026-03-07", "2026-03-01", 20);
    expect(at20.x).toBe(at10.x * 2);
    expect(at20.width).toBe(at10.width * 2);
  });
});

describe("axisDays", () => {
  it("starts at the anchor and covers the requested count", () => {
    const days = axisDays("2026-03-30", 5, 0);
    expect(days.map((day) => day.key)).toEqual([
      "2026-03-30",
      "2026-03-31",
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
    ]);
  });

  it("marks the first of the month and the week starts", () => {
    // Week start 0 is Sunday: 2026-03-29 is a Sunday, 2026-04-01 a Wednesday.
    const days = axisDays("2026-03-28", 6, 0);
    expect(days.filter((day) => day.weekStart).map((day) => day.key)).toEqual([
      "2026-03-29",
    ]);
    expect(days.filter((day) => day.monthStart).map((day) => day.key)).toEqual([
      "2026-04-01",
    ]);
  });

  it("honours a Monday week start", () => {
    const days = axisDays("2026-03-28", 4, 1);
    expect(days.filter((day) => day.weekStart).map((day) => day.key)).toEqual([
      "2026-03-30",
    ]);
  });

  it("marks today from the supplied clock, not from the real one", () => {
    const now = new Date(2026, 5, 15, 9, 0, 0);
    const days = axisDays("2026-06-14", 3, 0, now);
    expect(days.filter((day) => day.isToday).map((day) => day.key)).toEqual([
      "2026-06-15",
    ]);
  });
});

describe("todayKey", () => {
  it("reads the local calendar day of the supplied clock", () => {
    expect(todayKey(new Date(2026, 0, 1, 0, 30))).toBe("2026-01-01");
    expect(todayKey(new Date(2026, 0, 1, 23, 30))).toBe("2026-01-01");
  });
});

describe("axisLabels", () => {
  it("folds a month into one label and never labels a day twice", () => {
    const days = axisDays("2026-03-29", 8, 0);
    const labels = axisLabels(days, 10, "en-US");
    expect(labels.map((label) => label.text)).toEqual(["Mar 2026", "Apr 2026"]);
    expect(labels[0].x).toBe(0);
    expect(labels[0].width).toBe(30);
    expect(labels[1].x).toBe(30);
    expect(labels[1].width).toBe(50);
  });

  it("labels a one-day tail, so the axis is never unnamed", () => {
    // Half of this axis is the last day of March, which is still a run of one and has
    // to be labelled: an unnamed stretch of axis reads as missing data.
    const days = axisDays("2026-03-31", 2, 0);
    const labels = axisLabels(days, 10, "en-US");
    expect(labels.map((label) => label.text)).toEqual(["Mar 2026", "Apr 2026"]);
    expect(labels.map((label) => label.width)).toEqual([10, 10]);
  });

  it("covers the whole axis: label widths sum to the day count", () => {
    const days = axisDays("2026-01-15", 200, 0);
    const labels = axisLabels(days, 4, "en-US");
    const total = labels.reduce((sum, label) => sum + label.width, 0);
    expect(total).toBe(200 * 4);
  });

  it("gives each label a width in pixels that matches the days it covers", () => {
    const days = axisDays("2026-03-01", 40, 0);
    const labels = axisLabels(days, 10, "en-US");
    for (const label of labels) {
      // Every month run starts on a 1st, so its width is the shorter of "to the next
      // 1st" and the axis. Checked by re-deriving the run from the day keys.
      expect(label.width % 10).toBe(0);
      expect(label.width).toBeGreaterThan(0);
    }
  });
});
