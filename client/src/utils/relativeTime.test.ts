import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

/** A fixed clock, so the assertions do not drift with the real one. */
const NOW = new Date(2026, 2, 15, 12, 0, 0).getTime();
const ago = (milliseconds: number) => NOW - milliseconds;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("translates the unit, not just the suffix", () => {
    // The bug this replaces: `moment.locale("zh-cn")` hit a different moment
    // instance than `fromNow()` formatted with, so Chinese users got
    // "16 hours ago" for as long as the feature existed.
    expect(relativeTime(ago(16 * HOUR), "en-US", NOW)).toBe("16 hours ago");
    expect(relativeTime(ago(16 * HOUR), "zh-CN", NOW)).toBe("16小时前");
  });

  it("picks the coarsest unit the elapsed time reaches", () => {
    // 90 minutes must read as an hour, not as 90 minutes.
    expect(relativeTime(ago(90 * MINUTE), "en-US", NOW)).toBe("1 hour ago");
    expect(relativeTime(ago(26 * HOUR), "en-US", NOW)).toBe("yesterday");
    expect(relativeTime(ago(5 * DAY), "en-US", NOW)).toBe("5 days ago");
    expect(relativeTime(ago(30 * DAY), "en-US", NOW)).toBe("last month");
  });

  it("rounds past time down, so it never overstates the gap", () => {
    // `Math.round` breaks halves toward +Infinity, and a past instant is negative,
    // so -1.5 rounds to -1. Deliberate: the alternative would report "2 hours"
    // for something 90 minutes old.
    expect(relativeTime(ago(89 * MINUTE), "en-US", NOW)).toBe("1 hour ago");
    expect(relativeTime(ago(90 * MINUTE), "en-US", NOW)).toBe("1 hour ago");
    expect(relativeTime(ago(91 * MINUTE), "en-US", NOW)).toBe("2 hours ago");
  });

  it("falls back to seconds under a minute", () => {
    expect(relativeTime(ago(30 * 1000), "en-US", NOW)).toBe("30 seconds ago");
    expect(relativeTime(ago(0), "en-US", NOW)).toBe("now");
  });

  it("uses natural wording rather than a numeric offset", () => {
    // `numeric: "auto"` is what turns "1 day ago" into "yesterday" and
    // "-1 day" into "tomorrow" — worth pinning, since dropping the option
    // would silently produce stiffer text.
    expect(relativeTime(ago(DAY), "en-US", NOW)).toBe("yesterday");
    expect(relativeTime(NOW + DAY, "en-US", NOW)).toBe("tomorrow");
    expect(relativeTime(ago(DAY), "zh-CN", NOW)).toBe("昨天");
  });

  it("accepts the timestamp shapes the app stores", () => {
    // `create_date` arrives as a string, `last_modify_date` as a number, and
    // IndexedDB hands back `Date` objects in places.
    const instant = ago(2 * HOUR);
    expect(relativeTime(instant, "en-US", NOW)).toBe("2 hours ago");
    expect(relativeTime(new Date(instant), "en-US", NOW)).toBe("2 hours ago");
    expect(relativeTime(new Date(instant).toISOString(), "en-US", NOW)).toBe(
      "2 hours ago",
    );
  });
});
