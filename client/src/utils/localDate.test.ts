import { describe, expect, it } from "vitest";
import { localDateString, localDateTime, localTimeString } from "./localDate";

/**
 * Every assertion here is written so that a UTC-slicing implementation fails it.
 * The suite is run under several `TZ` values (see the plan); the values below are
 * chosen to be wrong in a specific direction when read as UTC.
 */
describe("localDateString", () => {
  it("reads local components, not UTC", () => {
    // 2026-03-15 23:59 local is 2026-03-15T15:59Z at UTC+8 — same day either way.
    // The interesting case is a local midnight, which is the *previous* day in UTC
    // for every positive offset.
    const localMidnight = new Date(2026, 2, 15, 0, 0);
    expect(localDateString(localMidnight)).toBe("2026-03-15");

    // A UTC read would give 2026-03-14 for the same instant when TZ is east of UTC.
    const offsetMinutes = localMidnight.getTimezoneOffset();
    if (offsetMinutes < 0) {
      expect(localMidnight.toISOString().slice(0, 10)).not.toBe("2026-03-15");
    }
  });

  it("pads month and day", () => {
    expect(localDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDateString(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("is stable across every hour of a local day", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(localDateString(new Date(2026, 5, 10, hour, 30))).toBe(
        "2026-06-10",
      );
    }
  });
});

describe("localTimeString", () => {
  it("pads to HH:mm", () => {
    expect(localTimeString(new Date(2026, 0, 1, 9, 5))).toBe("09:05");
    expect(localTimeString(new Date(2026, 0, 1, 23, 59))).toBe("23:59");
    expect(localTimeString(new Date(2026, 0, 1, 0, 0))).toBe("00:00");
  });
});

describe("localDateTime", () => {
  it("parses as local time", () => {
    const date = localDateTime("2026-03-15", "23:59");
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(2);
    expect(date!.getDate()).toBe(15);
    expect(date!.getHours()).toBe(23);
    expect(date!.getMinutes()).toBe(59);
  });

  it("defaults to local midnight with no time", () => {
    const date = localDateTime("2026-03-15");
    expect(date!.getHours()).toBe(0);
    expect(date!.getMinutes()).toBe(0);
    expect(localDateString(date!)).toBe("2026-03-15");
  });

  it("refuses impossible and malformed input", () => {
    expect(localDateTime("2026-02-31")).toBeNull();
    expect(localDateTime("2026-13-01")).toBeNull();
    expect(localDateTime("2026-3-15")).toBeNull();
    expect(localDateTime("")).toBeNull();
    expect(localDateTime("15/03/2026")).toBeNull();
    expect(localDateTime("2026-03-15", "25:00")).toBeNull();
  });
});

/**
 * The round trip is what `DatePickerDialog` now does: read a stored instant into
 * the two fields, then write the fields back to an instant.
 */
describe("picker round trip", () => {
  const roundTrip = (stored: Date) => {
    const date = localDateString(stored);
    const time = localTimeString(stored);
    return localDateTime(date, time);
  };

  it("is exact for every value the picker can produce", () => {
    for (const hour of [0, 1, 8, 12, 23]) {
      for (const minute of [0, 30, 59]) {
        const stored = new Date(2026, 2, 15, hour, minute);
        const back = roundTrip(stored);
        expect(back).not.toBeNull();
        // Minutes are the picker's resolution, so the instant is preserved exactly.
        expect(back!.getTime()).toBe(stored.getTime());
      }
    }
  });

  it("keeps an early-morning value on its own day", () => {
    // The regression: 00:00 local used to reopen as the previous day at any
    // positive UTC offset, and confirming it moved the record.
    const stored = new Date(2026, 2, 15, 0, 0);
    expect(localDateString(roundTrip(stored)!)).toBe("2026-03-15");
  });

  it("does not drift when a value has seconds or milliseconds", () => {
    // The picker has minute resolution, so sub-minute parts are dropped — but the
    // calendar day must not change.
    const stored = new Date(2026, 2, 15, 23, 59, 45, 500);
    expect(localDateString(roundTrip(stored)!)).toBe("2026-03-15");
  });
});
