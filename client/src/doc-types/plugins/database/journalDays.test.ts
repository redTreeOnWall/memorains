import { describe, expect, it } from "vitest";
import {
  addDays,
  buildDayIndex,
  checkedCount,
  completionRatio,
  computeOptionStreaks,
  computeOptionYear,
  dateFromDayKey,
  dateValueForDay,
  dayKeyFromDate,
  dayKeyOf,
  defaultCalendarProperty,
  rankJournalDetails,
  isSameDay,
  monthGridDays,
  shiftPeriod,
  startOfWeek,
  weekDays,
  yearWeeks,
  WEEK_STARTS_ON,
  weekdayNames,
} from "./journalDays";
import type { DateValue, PropertyDef, RowData } from "./types";

const property = (over: Partial<PropertyDef>): PropertyDef => ({
  id: "p",
  name: "P",
  type: "date",
  order: "0000000001",
  options: [],
  ...over,
});

const row = (id: string, values: Record<string, unknown>): RowData => ({
  id,
  order: id,
  values,
});

/**
 * These tests assert the rule the module exists for: a record belongs to the day
 * its value falls on **in local time**. `dayKeyOf` is pure and timezone-independent
 * only in the sense that it always reads local components — the values below are
 * chosen so that a UTC-slicing implementation produces a different answer, and the
 * suite is additionally run under `TZ=Asia/Shanghai` and `TZ=America/New_York` by
 * `journalDays.timezone.test.ts`-style explicit runs recorded in the plan.
 */
describe("dayKeyOf", () => {
  it("reads an instant in local time, not UTC", () => {
    // Midday UTC is the same calendar day everywhere from UTC-11 to UTC+11.
    expect(dayKeyOf({ start: "2026-03-15T12:00:00.000Z" })).toBe("2026-03-15");
  });

  it("takes a bare calendar date literally", () => {
    // `new Date("2026-03-15")` is UTC midnight, which is 2026-03-14 in New York.
    // Slicing an ISO string would therefore move a typed date one cell earlier.
    expect(dayKeyOf("2026-03-15")).toBe("2026-03-15");
    expect(dayKeyOf({ start: "2026-03-15" })).toBe("2026-03-15");
  });

  it("agrees with local calendar components for an instant", () => {
    const iso = "2026-07-04T09:30:00.000Z";
    const local = new Date(iso);
    expect(dayKeyOf({ start: iso })).toBe(
      `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`,
    );
  });

  it("returns null rather than a fallback day for anything unusable", () => {
    expect(dayKeyOf(undefined)).toBeNull();
    expect(dayKeyOf(null)).toBeNull();
    expect(dayKeyOf("")).toBeNull();
    expect(dayKeyOf("not a date")).toBeNull();
    expect(dayKeyOf({})).toBeNull();
    expect(dayKeyOf({ start: "" })).toBeNull();
    expect(dayKeyOf({ start: "nonsense" })).toBeNull();
    expect(dayKeyOf(42)).toBeNull();
    expect(dayKeyOf([])).toBeNull();
  });

  it("round-trips through dateValueForDay at every hour of the day", () => {
    const day = new Date(2026, 2, 15);
    expect(dayKeyOf(dateValueForDay(day))).toBe(dayKeyFromDate(day));
    // Noon storage means no hour of the local day can drift into a neighbour.
    for (let hour = 0; hour < 24; hour++) {
      const local = new Date(2026, 2, 15, hour, 30);
      expect(dayKeyFromDate(local)).toBe("2026-03-15");
    }
  });

  it("keeps midday local even across a daylight-saving boundary", () => {
    // US DST starts 2026-03-08; the local day must not move either side of it.
    for (const iso of ["2026-03-08T12:00:00", "2026-11-01T12:00:00"]) {
      const local = new Date(iso);
      expect(dayKeyOf(dateValueForDay(local))).toBe(dayKeyFromDate(local));
    }
  });
});

describe("dateFromDayKey", () => {
  it("builds local midnight", () => {
    const date = dateFromDayKey("2026-03-15");
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(2);
    expect(date!.getDate()).toBe(15);
    expect(date!.getHours()).toBe(0);
  });

  it("rejects malformed and impossible keys", () => {
    expect(dateFromDayKey("2026-3-15")).toBeNull();
    expect(dateFromDayKey("")).toBeNull();
    expect(dateFromDayKey("today")).toBeNull();
    // `new Date(2026, 1, 31)` silently rolls forward into March; a key must not.
    expect(dateFromDayKey("2026-02-31")).toBeNull();
    expect(dateFromDayKey("2026-13-01")).toBeNull();
  });

  it("round-trips with dayKeyFromDate", () => {
    for (const key of [
      "2026-01-01",
      "2026-02-28",
      "2024-02-29",
      "2026-12-31",
    ]) {
      expect(dayKeyFromDate(dateFromDayKey(key)!)).toBe(key);
    }
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(dayKeyFromDate(addDays(new Date(2026, 0, 31), 1))).toBe(
      "2026-02-01",
    );
    expect(dayKeyFromDate(addDays(new Date(2026, 11, 31), 1))).toBe(
      "2027-01-01",
    );
    expect(dayKeyFromDate(addDays(new Date(2026, 0, 1), -1))).toBe(
      "2025-12-31",
    );
  });

  it("starts a week on the given first day", () => {
    // 2026-03-15 is a Sunday.
    const sunday = new Date(2026, 2, 15);
    expect(dayKeyFromDate(startOfWeek(sunday, 0))).toBe("2026-03-15");
    expect(dayKeyFromDate(startOfWeek(sunday, 1))).toBe("2026-03-09");

    const wednesday = new Date(2026, 2, 18);
    expect(dayKeyFromDate(startOfWeek(wednesday, 0))).toBe("2026-03-15");
    expect(dayKeyFromDate(startOfWeek(wednesday, 1))).toBe("2026-03-16");
  });

  it("returns seven days starting from the given first day", () => {
    const days = weekDays(new Date(2026, 2, 18), 0);
    expect(days).toHaveLength(7);
    expect(dayKeyFromDate(days[0])).toBe("2026-03-15");
    expect(dayKeyFromDate(days[6])).toBe("2026-03-21");
  });

  it("starts every grid on Sunday", () => {
    // One constant rather than per-locale rules. The week/month/year grids and the
    // weekday headers all read this, so they cannot disagree about column order —
    // the year grid previously hardcoded Monday and was the only one out of step.
    // Chinese conventionally starts on Monday; unifying on Sunday is a deliberate
    // exception, and this test is what makes reintroducing per-locale grids a
    // conscious change rather than a drift.
    expect(WEEK_STARTS_ON).toBe(0);
    // And the primitives still honour whichever value they are given.
    const sunday = new Date(2026, 2, 15);
    expect(dayKeyFromDate(startOfWeek(sunday, WEEK_STARTS_ON))).toBe(
      "2026-03-15",
    );
    expect(dayKeyFromDate(startOfWeek(sunday, 1))).toBe("2026-03-09");
  });
});

describe("monthGridDays", () => {
  it("returns whole weeks covering the month", () => {
    // March 2026 starts on a Sunday and has 31 days. With Monday as the week
    // start that needs a 6-row grid: 6 days of February lead in, and the 31st
    // falls on a Tuesday of the sixth week, so the grid runs to 2026-04-05.
    const days = monthGridDays(2026, 2, 1);
    expect(days.length).toBe(42);
    expect(dayKeyFromDate(days[0])).toBe("2026-02-23");
    expect(dayKeyFromDate(days[days.length - 1])).toBe("2026-04-05");
  });

  it("covers a February that starts exactly on the week start", () => {
    const days = monthGridDays(2026, 1, 0);
    expect(days.length % 7).toBe(0);
    // 2026-02-01 is a Sunday, so the grid starts on the 1st.
    expect(dayKeyFromDate(days[0])).toBe("2026-02-01");
    expect(dayKeyFromDate(days[days.length - 1])).toBe("2026-02-28");
  });

  it("includes every day of the month for every month of a leap year", () => {
    for (let month = 0; month < 12; month++) {
      const days = monthGridDays(2024, month, 1);
      const keys = new Set(days.map(dayKeyFromDate));
      const daysInMonth = new Date(2024, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const key = `${2024}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        expect(keys.has(key)).toBe(true);
      }
    }
  });

  it("starts on the week start for every month of a year", () => {
    for (let month = 0; month < 12; month++) {
      for (const first of [0, 1]) {
        const days = monthGridDays(2026, month, first);
        expect(days[0].getDay()).toBe(first);
      }
    }
  });
});

describe("shiftPeriod", () => {
  it("steps a month without skipping short ones", () => {
    // Stepping from the 31st with a naive `getMonth()+1` lands in the wrong month.
    const jan31 = new Date(2026, 0, 31);
    expect(dayKeyFromDate(shiftPeriod(jan31, "month", 1))).toBe("2026-02-01");
    const mar31 = new Date(2026, 2, 31);
    expect(dayKeyFromDate(shiftPeriod(mar31, "month", -1))).toBe("2026-02-01");
  });

  it("steps weeks and years", () => {
    expect(dayKeyFromDate(shiftPeriod(new Date(2026, 2, 15), "week", 1))).toBe(
      "2026-03-22",
    );
    expect(dayKeyFromDate(shiftPeriod(new Date(2026, 2, 15), "week", -1))).toBe(
      "2026-03-08",
    );
    expect(dayKeyFromDate(shiftPeriod(new Date(2026, 2, 15), "year", 1))).toBe(
      "2027-03-01",
    );
    expect(dayKeyFromDate(shiftPeriod(new Date(2026, 2, 15), "year", -1))).toBe(
      "2025-03-01",
    );
  });

  it("round-trips on the period, normalising to the first of the month", () => {
    // Weeks round-trip exactly; month and year deliberately normalise to the 1st
    // (see the test above), so the round trip preserves the period, not the day.
    const anchor = new Date(2026, 5, 15);
    expect(
      dayKeyFromDate(shiftPeriod(shiftPeriod(anchor, "week", 1), "week", -1)),
    ).toBe(dayKeyFromDate(anchor));
    expect(
      dayKeyFromDate(shiftPeriod(shiftPeriod(anchor, "month", 1), "month", -1)),
    ).toBe("2026-06-01");
    expect(
      dayKeyFromDate(shiftPeriod(shiftPeriod(anchor, "year", 1), "year", -1)),
    ).toBe("2026-06-01");
  });
});

describe("isSameDay", () => {
  it("compares local calendar days, not instants", () => {
    expect(
      isSameDay(new Date(2026, 2, 15, 0, 1), new Date(2026, 2, 15, 23, 59)),
    ).toBe(true);
    expect(
      isSameDay(new Date(2026, 2, 15, 23, 59), new Date(2026, 2, 16, 0, 1)),
    ).toBe(false);
  });
});

describe("defaultCalendarProperty", () => {
  it("picks the first date property in the user's column order", () => {
    const properties = [
      property({ id: "a", type: "title" }),
      property({ id: "b", type: "date" }),
      property({ id: "c", type: "date" }),
    ];
    expect(defaultCalendarProperty(properties)).toBe("b");
  });

  it("returns undefined when there is no date column", () => {
    expect(
      defaultCalendarProperty([
        property({ id: "a", type: "title" }),
        property({ id: "b", type: "text" }),
      ]),
    ).toBeUndefined();
    expect(defaultCalendarProperty([])).toBeUndefined();
  });
});

describe("buildDayIndex", () => {
  it("buckets rows by local day, keeping the view's order", () => {
    const rows = [
      row("r1", { d: { start: "2026-03-15T12:00:00.000Z" } }),
      row("r2", { d: "2026-03-15" }),
      row("r3", { d: { start: "2026-03-16T12:00:00.000Z" } }),
    ];
    const index = buildDayIndex(rows, "d");
    expect(index.size).toBe(2);
    expect(index.get("2026-03-15")!.map((entry) => entry.id)).toEqual([
      "r1",
      "r2",
    ]);
    expect(index.get("2026-03-16")!.map((entry) => entry.id)).toEqual(["r3"]);
  });

  it("drops rows with no usable date instead of guessing a day", () => {
    const rows = [
      row("r1", {}),
      row("r2", { d: "" }),
      row("r3", { d: null }),
      row("r4", { d: { start: "2026-03-15" } }),
    ];
    const index = buildDayIndex(rows, "d");
    expect(index.size).toBe(1);
    expect(index.get("2026-03-15")!.map((entry) => entry.id)).toEqual(["r4"]);
  });

  it("puts several rows on one day into one bucket", () => {
    const rows = Array.from({ length: 5 }, (_, index) =>
      row(`r${index}`, { d: "2026-03-15" }),
    );
    expect(buildDayIndex(rows, "d").get("2026-03-15")).toHaveLength(5);
  });

  it("handles many days in one pass", () => {
    const rows = Array.from({ length: 365 }, (_, index) =>
      row(`r${index}`, {
        d: dayKeyFromDate(addDays(new Date(2026, 0, 1), index)),
      }),
    );
    const index = buildDayIndex(rows, "d");
    expect(index.size).toBe(365);
  });
});

describe("checkedCount", () => {
  it("counts selected options", () => {
    expect(checkedCount(row("r", { c: ["a", "b"] }), "c")).toBe(2);
    expect(checkedCount(row("r", { c: [] }), "c")).toBe(0);
    expect(checkedCount(row("r", {}), "c")).toBe(0);
    expect(checkedCount(row("r", { c: "a" }), "c")).toBe(0);
    expect(checkedCount(row("r", { c: null }), "c")).toBe(0);
  });
});

describe("completionRatio", () => {
  it("is null when there is nothing to measure", () => {
    expect(completionRatio(0, 0)).toBeNull();
    expect(completionRatio(3, 0)).toBeNull();
    expect(completionRatio(0, -1)).toBeNull();
  });

  it("is a fraction clamped to [0, 1]", () => {
    expect(completionRatio(0, 4)).toBe(0);
    expect(completionRatio(2, 4)).toBe(0.5);
    expect(completionRatio(4, 4)).toBe(1);
    expect(completionRatio(9, 4)).toBe(1);
  });
});

describe("localised labels", () => {
  it("names weekdays in the grid's own column order", () => {
    const sundayFirst = weekdayNames(0, "en-US", "narrow");
    const mondayFirst = weekdayNames(1, "en-US", "narrow");
    expect(sundayFirst).toHaveLength(7);
    // The Monday-first list is the Sunday-first list rotated by one.
    expect(mondayFirst[0]).toBe(sundayFirst[1]);
    expect(mondayFirst[6]).toBe(sundayFirst[0]);
  });

  it("produces a non-empty weekday name in both languages", () => {
    for (const language of ["en-US", "zh-CN"]) {
      for (const name of weekdayNames(0, language, "short")) {
        expect(name.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("type sanity", () => {
  it("keeps dateValueForDay free of a time-of-day claim", () => {
    const value: DateValue = dateValueForDay(new Date(2026, 2, 15));
    expect(value.end).toBeUndefined();
    expect(value.includeTime).toBeUndefined();
  });
});

describe("rankJournalDetails", () => {
  const p = (id: string, type: PropertyDef["type"]): PropertyDef =>
    property({ id, type, name: id });

  it("moves the calendar column to the end without changing anything else", () => {
    const properties = [
      p("title", "title"),
      p("date", "date"),
      p("status", "select"),
      p("notes", "text"),
    ];
    expect(rankJournalDetails(properties, "date").map((x) => x.id)).toEqual([
      "title",
      "status",
      "notes",
      "date",
    ]);
  });

  it("keeps the calendar column rather than excluding it", () => {
    // The distinction that matters: `visibleProps` is the only authority on what a
    // view shows, so a user who turned the date column on still sees it when there
    // is room. Dropping it here would make that impossible.
    const properties = [p("title", "title"), p("date", "date")];
    const ranked = rankJournalDetails(properties, "date");
    expect(ranked).toHaveLength(properties.length);
    expect(ranked.map((x) => x.id)).toContain("date");
  });

  it("is a no-op without a calendar property, or with a dangling id", () => {
    const properties = [p("title", "title"), p("a", "select"), p("b", "text")];
    const order = properties.map((x) => x.id);

    expect(rankJournalDetails(properties, undefined).map((x) => x.id)).toEqual(
      order,
    );
    // The referenced column was deleted: nothing to rank, and no crash.
    expect(rankJournalDetails(properties, "gone").map((x) => x.id)).toEqual(
      order,
    );
  });

  it("does not mutate or alias the input array", () => {
    const properties = [p("date", "date"), p("a", "select")];
    const before = properties.map((x) => x.id);
    const ranked = rankJournalDetails(properties, "date");

    expect(properties.map((x) => x.id)).toEqual(before);
    expect(ranked).not.toBe(properties);
  });

  it("keeps the order of the remaining properties stable", () => {
    // A single move, not a re-sort: the user's own column order still decides
    // everything except where the axis lands.
    const properties = [
      p("a", "select"),
      p("b", "text"),
      p("date", "date"),
      p("c", "number"),
      p("d", "checkbox"),
    ];
    expect(rankJournalDetails(properties, "date").map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "date",
    ]);
  });

  it("drops the date before a real field when a cell truncates", () => {
    // The behavior the ranking exists for, exercised through the same truncation the
    // views perform: with two slots, the date must lose to Status and Notes.
    const properties = [
      p("title", "title"),
      p("date", "date"),
      p("status", "select"),
      p("notes", "text"),
    ];
    const slots = 2;
    const shown = rankJournalDetails(properties, "date")
      .filter((x) => x.type !== "title")
      .slice(0, slots)
      .map((x) => x.id);

    expect(shown).toEqual(["status", "notes"]);
    expect(shown).not.toContain("date");
  });

  it("still shows the date when the record has nothing else", () => {
    // The other half: ranking, not exclusion. An otherwise-empty day keeps its date.
    const properties = [p("title", "title"), p("date", "date")];
    expect(
      rankJournalDetails(properties, "date")
        .filter((x) => x.type !== "title")
        .slice(0, 2)
        .map((x) => x.id),
    ).toEqual(["date"]);
  });
});

describe("computeOptionStreaks", () => {
  // A bare calendar date is the simplest deterministic way to name a day here; the
  // timezone rules themselves are covered by the `dayKeyOf` suite above.
  const day = (key: string): RowData => ({ id: key, order: key, values: {} });
  const on = (key: string, ...options: string[]): RowData => ({
    id: key,
    order: key,
    values: { d: key, c: options },
  });
  const today = new Date(2026, 8, 30);
  const streaks = (rows: RowData[], optionIds = ["alpha", "beta"]) =>
    computeOptionStreaks(rows, "d", "c", optionIds, today);

  it("counts consecutive days ending today", () => {
    const result = streaks([
      on("2026-09-30", "alpha"),
      on("2026-09-29", "alpha"),
      on("2026-09-28", "alpha"),
    ]);
    expect(result.get("alpha")).toBe(3);
  });

  it("does not break a streak while today is still unticked", () => {
    // The rule the feature exists for: opening the journal before ticking anything
    // must not reset a run that is only paused for the current day.
    const result = streaks([
      on("2026-09-29", "alpha"),
      on("2026-09-28", "alpha"),
    ]);
    expect(result.get("alpha")).toBe(2);
  });

  it("breaks the streak when both today and yesterday are unticked", () => {
    const result = streaks([on("2026-09-28", "alpha")]);
    expect(result.get("alpha")).toBe(0);
  });

  it("stops at the first missed day rather than resuming past it", () => {
    const result = streaks([
      on("2026-09-30", "alpha"),
      // 09-29 missing.
      on("2026-09-28", "alpha"),
      on("2026-09-27", "alpha"),
    ]);
    expect(result.get("alpha")).toBe(1);
  });

  it("tracks each option independently", () => {
    const result = streaks([
      on("2026-09-30", "alpha", "beta"),
      on("2026-09-29", "alpha"),
      on("2026-09-28", "alpha"),
      on("2026-09-27", "beta"),
    ]);
    expect(result.get("alpha")).toBe(3);
    expect(result.get("beta")).toBe(1);
  });

  it("counts a day once however many records fall on it", () => {
    // Two records on one day are one day of the habit, and only one of them need have
    // ticked it — the same "any record" reading `buildDayIndex` cells use.
    const result = streaks([
      on("2026-09-30", "alpha"),
      day("2026-09-30"),
      on("2026-09-29", "alpha"),
    ]);
    expect(result.get("alpha")).toBe(2);
  });

  it("reports zero for every option that has no streak", () => {
    const result = streaks([on("2026-09-30", "alpha")]);
    expect(result.get("alpha")).toBe(1);
    expect(result.get("beta")).toBe(0);
  });

  it("is zero for an option that appears nowhere", () => {
    const result = streaks([], ["alpha"]);
    expect(result.get("alpha")).toBe(0);
  });

  it("ignores rows with no usable date and non-string ticks", () => {
    const result = streaks([
      on("2026-09-30", "alpha"),
      { id: "x", order: "x", values: { c: ["alpha"] } },
      { id: "y", order: "y", values: { d: "2026-09-29", c: [7, "alpha"] } },
    ]);
    expect(result.get("alpha")).toBe(2);
  });

  it("treats a bare calendar date and an instant as the same day", () => {
    // Both stored shapes reach a date column; the streak must not lose a day to the
    // difference between them.
    const result = streaks([
      {
        id: "a",
        order: "a",
        values: { d: dateValueForDay(today), c: ["alpha"] },
      },
      on("2026-09-29", "alpha"),
    ]);
    expect(result.get("alpha")).toBe(2);
  });

  it("walks a long run without being bounded by a fixed window", () => {
    // A year-long streak must not stop at a calendar boundary in the implementation.
    const rows = Array.from({ length: 400 }, (_, index) => {
      const date = addDays(today, -index);
      return on(
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
        "alpha",
      );
    });
    expect(streaks(rows).get("alpha")).toBe(400);
  });
});

describe("computeOptionYear", () => {
  const on = (key: string, ...options: string[]): RowData => ({
    id: key,
    order: key,
    values: { d: key, c: options },
  });
  const today = new Date(2026, 8, 30);
  const year = (rows: RowData[], optionId = "alpha", y = 2026) =>
    computeOptionYear(rows, "d", "c", optionId, y, today);

  it("collects only the requested year's ticks", () => {
    const result = year([
      on("2026-01-01", "alpha"),
      on("2026-12-31", "alpha"),
      on("2025-12-31", "alpha"),
      on("2027-01-01", "alpha"),
    ]);
    expect(result.total).toBe(2);
    expect(result.days.has("2026-01-01")).toBe(true);
    expect(result.days.has("2026-12-31")).toBe(true);
    expect(result.days.has("2025-12-31")).toBe(false);
  });

  it("counts a run that spans a month boundary", () => {
    // Consecutive keys differ by one day, so the walk must not treat a month change as
    // a break — the bug a naive `key + 1` comparison would produce.
    const result = year([
      on("2026-01-30", "alpha"),
      on("2026-01-31", "alpha"),
      on("2026-02-01", "alpha"),
    ]);
    expect(result.best).toBe(3);
  });

  it("finds the best run across the whole history, not just the year", () => {
    // "Best ever" is a property of the habit; resetting it each January would make it a
    // different, less interesting number.
    const result = year(
      [
        on("2025-03-01", "alpha"),
        on("2025-03-02", "alpha"),
        on("2025-03-03", "alpha"),
        on("2025-03-04", "alpha"),
        on("2026-09-29", "alpha"),
        on("2026-09-30", "alpha"),
      ],
      "alpha",
      2026,
    );
    expect(result.best).toBe(4);
    expect(result.total).toBe(2);
  });

  it("reports the current run by the same not-over-yet rule", () => {
    // Today unticked: the run continues from yesterday rather than reading as zero.
    const result = year([on("2026-09-28", "alpha"), on("2026-09-29", "alpha")]);
    expect(result.current).toBe(2);
  });

  it("is empty and zeroed for an option that appears nowhere", () => {
    const result = year([], "alpha");
    expect(result.total).toBe(0);
    expect(result.current).toBe(0);
    expect(result.best).toBe(0);
  });

  it("keeps each option separate", () => {
    const rows = [
      on("2026-09-30", "alpha"),
      on("2026-09-29", "beta"),
      on("2026-09-28", "beta"),
    ];
    expect(year(rows, "alpha").total).toBe(1);
    expect(year(rows, "beta").total).toBe(2);
    expect(year(rows, "alpha").best).toBe(1);
  });

  it("counts a day once however many records fall on it", () => {
    const result = year([
      on("2026-09-30", "alpha"),
      { id: "x", order: "x", values: { d: "2026-09-30", c: [] } },
    ]);
    expect(result.total).toBe(1);
  });
});

describe("yearWeeks", () => {
  it("covers the whole year in full weeks", () => {
    const weeks = yearWeeks(2026, WEEK_STARTS_ON);
    const flat = weeks.flat();
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // Starts on the week start on or before Jan 1: 2026-01-01 is a Thursday, so the first
    // week opens on Sunday 2025-12-28 and the grid legitimately begins in December.
    expect(flat[0]).toEqual(startOfWeek(new Date(2026, 0, 1), WEEK_STARTS_ON));
    expect(flat[flat.length - 1].getTime()).toBeGreaterThanOrEqual(
      new Date(2026, 11, 31).getTime(),
    );
  });

  it("includes every day of the year exactly once", () => {
    const keys = new Set(
      yearWeeks(2026, WEEK_STARTS_ON)
        .flat()
        .map((day) => dayKeyFromDate(day)),
    );
    for (let month = 0; month < 12; month += 1) {
      const days = new Date(2026, month + 1, 0).getDate();
      for (let date = 1; date <= days; date += 1) {
        expect(keys.has(dayKeyFromDate(new Date(2026, month, date)))).toBe(
          true,
        );
      }
    }
  });

  it("honours the given week start", () => {
    const monday = yearWeeks(2026, 1)[0][0];
    const sunday = yearWeeks(2026, 0)[0][0];
    expect(monday.getDay()).toBe(1);
    expect(sunday.getDay()).toBe(0);
  });
});
