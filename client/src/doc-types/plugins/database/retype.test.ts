import { describe, expect, it } from "vitest";
import {
  DROP,
  displayValue,
  isEmptyValue,
  parseDateValue,
  previewRetype,
  retypeValue,
  type PlainValue,
} from "./retype";
import type { OptionDef, PropType } from "./types";

const opt = (id: string, name: string): OptionDef => ({
  id,
  name,
  color: "default",
  order: "V",
});

const OPTIONS = [opt("o1", "Admin"), opt("o2", "Editor"), opt("o3", "Viewer")];

describe("isEmptyValue", () => {
  it("treats null, empty string and empty list as empty", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue([])).toBe(true);
  });

  it("does not treat falsy non-empty values as empty", () => {
    // Critical: 0 and false are real values, not "empty".
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue("0")).toBe(false);
    expect(isEmptyValue(["o1"])).toBe(false);
  });
});

describe("displayValue", () => {
  it("resolves option ids to names", () => {
    expect(displayValue("o2", "select", OPTIONS)).toBe("Editor");
    expect(displayValue(["o1", "o3"], "multi-select", OPTIONS)).toBe(
      "Admin, Viewer",
    );
  });

  it("renders an unknown option id as empty rather than exposing the raw id", () => {
    expect(displayValue("nope", "select", OPTIONS)).toBe("");
  });

  it("formats dates and ranges", () => {
    expect(displayValue({ start: "2026-01-01" }, "date")).toBe("2026-01-01");
    expect(
      displayValue({ start: "2026-01-01", end: "2026-01-05" }, "date"),
    ).toBe("2026-01-01 → 2026-01-05");
  });

  it("formats numbers, checkboxes and text", () => {
    expect(displayValue(42, "number")).toBe("42");
    expect(displayValue(true, "checkbox")).toBe("true");
    expect(displayValue("plain", "text")).toBe("plain");
    expect(displayValue(0, "number")).toBe("0");
  });

  it("returns empty for values of the wrong shape", () => {
    expect(displayValue(42, "date")).toBe("");
    expect(displayValue(null, "number")).toBe("");
    expect(displayValue(Number.NaN, "number")).toBe("");
  });
});

describe("retypeValue: empty cells", () => {
  it("never invents a value from an empty cell", () => {
    // "" -> 0 would be a silent corruption of every empty cell in the column.
    const types: PropType[] = [
      "text",
      "number",
      "checkbox",
      "select",
      "multi-select",
      "status",
      "date",
      "url",
      "email",
      "phone",
      "title",
    ];
    for (const from of types) {
      for (const to of types) {
        const empty: PlainValue = from === "multi-select" ? [] : "";
        const result = retypeValue(empty, from, to, OPTIONS);
        expect(result.value, `${from} -> ${to}`).toBe(DROP);
        expect(
          result.dropped,
          `${from} -> ${to} must not count as data loss`,
        ).toBe(false);
      }
    }
  });
});

describe("retypeValue: to text and string types", () => {
  it("preserves anything readable as text", () => {
    expect(retypeValue(42, "number", "text").value).toBe("42");
    expect(retypeValue(true, "checkbox", "text").value).toBe("true");
    expect(retypeValue("o1", "select", "text", OPTIONS).value).toBe("Admin");
    expect(
      retypeValue(["o1", "o2"], "multi-select", "text", OPTIONS).value,
    ).toBe("Admin, Editor");
    expect(retypeValue({ start: "2026-01-01" }, "date", "text").value).toBe(
      "2026-01-01",
    );
  });

  it("converts to url / email / phone as plain strings", () => {
    for (const type of ["url", "email", "phone"] as PropType[]) {
      expect(retypeValue("value", "text", type).value).toBe("value");
    }
  });
});

describe("retypeValue: to number", () => {
  it("parses numeric strings", () => {
    expect(retypeValue("42", "text", "number").value).toBe(42);
    expect(retypeValue("  7  ", "text", "number").value).toBe(7);
    expect(retypeValue("-3.5", "text", "number").value).toBe(-3.5);
    expect(retypeValue("1e3", "text", "number").value).toBe(1000);
  });

  it("drops non-numeric text instead of coercing it to NaN", () => {
    // Number("12abc") is NaN, and storing NaN would render as an empty cell
    // while still being a value — a hidden inconsistency.
    for (const bad of ["abc", "12abc", "N/A", "-", "1,000"]) {
      const result = retypeValue(bad, "text", "number");
      expect(result.value, bad).toBe(DROP);
      expect(result.dropped, bad).toBe(true);
    }
  });

  it("drops option names and dates rather than guessing", () => {
    expect(retypeValue("o1", "select", "number", OPTIONS).value).toBe(DROP);
    expect(retypeValue({ start: "2026-01-01" }, "date", "number").value).toBe(
      DROP,
    );
  });
});

describe("retypeValue: to checkbox", () => {
  it("understands common truthy and falsy spellings", () => {
    for (const truthy of ["true", "TRUE", "1", "yes", "Y", " ✓ "]) {
      expect(retypeValue(truthy, "text", "checkbox").value, truthy).toBe(true);
    }
    for (const falsy of ["false", "0", "no", "n"]) {
      expect(retypeValue(falsy, "text", "checkbox").value, falsy).toBe(false);
    }
  });

  it("treats unparseable non-empty text as checked", () => {
    // A value existed, so losing that fact would be worse than a coarse reading.
    expect(retypeValue("some note", "text", "checkbox").value).toBe(true);
    expect(retypeValue("some note", "text", "checkbox").dropped).toBe(false);
  });

  it("keeps numbers as booleans", () => {
    expect(retypeValue(1, "number", "checkbox").value).toBe(true);
    expect(retypeValue(0, "number", "checkbox").value).toBe(false);
  });
});

describe("retypeValue: to select family", () => {
  it("matches a free-text value to an option by name", () => {
    expect(retypeValue("Editor", "text", "select", OPTIONS).value).toBe("o2");
    expect(retypeValue("editor", "text", "select", OPTIONS).value).toBe("o2");
    expect(retypeValue("  EDITOR ", "text", "select", OPTIONS).value).toBe(
      "o2",
    );
  });

  it("drops a value matching no option", () => {
    const result = retypeValue("Nobody", "text", "select", OPTIONS);
    expect(result.value).toBe(DROP);
    expect(result.dropped).toBe(true);
  });

  it("carries a single option into a multi-select", () => {
    expect(retypeValue("o2", "select", "multi-select", OPTIONS).value).toEqual([
      "o2",
    ]);
  });

  it("carries a multi-select with exactly one option into a select", () => {
    expect(retypeValue(["o2"], "multi-select", "select", OPTIONS).value).toBe(
      "o2",
    );
  });

  it("keeps only the first of several options when narrowing to a select", () => {
    expect(
      retypeValue(["o1", "o2"], "multi-select", "select", OPTIONS).value,
    ).toBe("o1");
  });

  it("preserves the option id when the target shares the option list", () => {
    // Option IDs are per-property. When converting within the same property the
    // ID is meaningful and must be kept as-is.
    expect(
      retypeValue(["o1", "o2"], "multi-select", "select", OPTIONS).value,
    ).toBe("o1");
    expect(retypeValue("o2", "select", "multi-select", OPTIONS).value).toEqual([
      "o2",
    ]);
    expect(retypeValue("o2", "select", "status", OPTIONS).value).toBe("o2");
  });

  it("drops a foreign option id it cannot map by name", () => {
    // An ID from another property's option list carries no meaning here. Note an
    // ID is not a name, so there is nothing to match against.
    const foreign = [opt("x9", "Editor")];
    expect(retypeValue("o2", "select", "multi-select", foreign).value).toBe(
      DROP,
    );
  });

  it("maps by name when the source value is free text", () => {
    const foreign = [opt("x9", "Editor")];
    expect(retypeValue("Editor", "text", "select", foreign).value).toBe("x9");
  });

  it("is a no-op when the type does not change", () => {
    // select -> select must return the value untouched, including an option id
    // that the (stale) option list passed in does not know about.
    const result = retypeValue("o2", "select", "select", []);
    expect(result.value).toBe("o2");
    expect(result.dropped).toBe(false);
  });

  it("splits a comma-separated text value into a multi-select", () => {
    // `displayValue` renders a multi-select as "A, B", so without splitting a
    // multi-select -> text -> multi-select round trip would lose every value.
    const result = retypeValue(
      "Admin, Viewer",
      "text",
      "multi-select",
      OPTIONS,
    );
    expect(result.value).toEqual(["o1", "o3"]);
  });

  it("tolerates spacing and case in a comma-separated value", () => {
    expect(
      retypeValue("admin,VIEWER", "text", "multi-select", OPTIONS).value,
    ).toEqual(["o1", "o3"]);
  });

  it("ignores empty segments from a trailing comma", () => {
    expect(
      retypeValue("Admin,,Viewer,", "text", "multi-select", OPTIONS).value,
    ).toEqual(["o1", "o3"]);
  });
});

describe("retypeValue: to date", () => {
  it("accepts ISO dates and datetimes", () => {
    expect(retypeValue("2026-01-01", "text", "date").value).toEqual({
      start: "2026-01-01",
      includeTime: false,
    });
    expect(retypeValue("2026-01-01T10:30", "text", "date").value).toEqual({
      start: "2026-01-01T10:30",
      includeTime: true,
    });
  });

  it("refuses ambiguous locale formats", () => {
    // 03/04/2024 is March 4th or April 3rd depending on the reader. Guessing
    // would silently write a date the user did not mean.
    for (const ambiguous of [
      "03/04/2024",
      "4 Mar 2026",
      "next tuesday",
      "2026/01/01",
    ]) {
      expect(retypeValue(ambiguous, "text", "date").value, ambiguous).toBe(
        DROP,
      );
    }
  });

  it("keeps an existing date value unchanged", () => {
    const value = { start: "2026-01-01", end: "2026-01-02" };
    expect(retypeValue(value, "date", "date").value).toBe(value);
  });

  it("drops the value when narrowing a select to a date", () => {
    expect(retypeValue("o1", "select", "date", OPTIONS).value).toBe(DROP);
  });
});

describe("parseDateValue", () => {
  it("returns null for unusable input", () => {
    expect(parseDateValue("")).toBeNull();
    expect(parseDateValue("not a date")).toBeNull();
    expect(parseDateValue(null)).toBeNull();
    expect(parseDateValue(12345, "number")).toBeNull();
    expect(parseDateValue("2026-13-45")).toBeNull();
  });

  it("marks includeTime only when a time is present", () => {
    expect(parseDateValue("2026-01-01")?.includeTime).toBe(false);
    expect(parseDateValue("2026-01-01 08:00")?.includeTime).toBe(true);
  });
});

describe("round trips", () => {
  it("text -> number -> text preserves a numeric value", () => {
    const toNumber = retypeValue("42", "text", "number");
    expect(toNumber.value).toBe(42);
    const back = retypeValue(toNumber.value as PlainValue, "number", "text");
    expect(back.value).toBe("42");
  });

  it("select -> text -> select finds the option again by name", () => {
    const asText = retypeValue("o2", "select", "text", OPTIONS);
    expect(asText.value).toBe("Editor");
    const back = retypeValue(
      asText.value as PlainValue,
      "text",
      "select",
      OPTIONS,
    );
    expect(back.value).toBe("o2");
  });

  it("multi-select -> text -> multi-select preserves every option", () => {
    const asText = retypeValue(["o1", "o3"], "multi-select", "text", OPTIONS);
    expect(asText.value).toBe("Admin, Viewer");
    const back = retypeValue(
      asText.value as PlainValue,
      "text",
      "multi-select",
      OPTIONS,
    );
    expect(back.value).toEqual(["o1", "o3"]);
  });
});

describe("previewRetype", () => {
  it("counts preserved and dropped cells, ignoring empty ones", () => {
    const values: PlainValue[] = ["42", "abc", "", "7", null];
    const preview = previewRetype(values, "text", "number");
    expect(preview.total).toBe(3);
    expect(preview.preserved).toBe(2);
    expect(preview.dropped).toBe(1);
  });

  it("reports no loss for a widening conversion", () => {
    const preview = previewRetype([1, 2, 3], "number", "text");
    expect(preview.dropped).toBe(0);
    expect(preview.preserved).toBe(3);
  });

  it("reports an empty column as nothing to do", () => {
    const preview = previewRetype(["", null], "text", "number");
    expect(preview).toEqual({ total: 0, preserved: 0, dropped: 0 });
  });
});

describe("every type pair is handled", () => {
  it("never throws and always returns a decision", () => {
    const types: PropType[] = [
      "title",
      "text",
      "number",
      "checkbox",
      "url",
      "email",
      "phone",
      "select",
      "multi-select",
      "status",
      "date",
    ];
    const samples: PlainValue[] = [
      "42",
      "abc",
      "",
      "o1",
      ["o1", "o2"],
      7,
      true,
      { start: "2026-01-01" },
    ];

    for (const from of types) {
      for (const to of types) {
        for (const sample of samples) {
          const result = retypeValue(sample, from, to, OPTIONS);
          expect(typeof result.dropped).toBe("boolean");

          // A same-type conversion keeps a non-empty value untouched; an empty
          // cell normalises to the drop sentinel. (The samples below
          // deliberately do not always match their declared source type, which is
          // realistic for a schema written by another client.)
          if (from === to) {
            expect(result.value).toBe(isEmptyValue(sample) ? DROP : sample);
            continue;
          }

          if (result.value !== DROP) {
            if (to === "multi-select")
              expect(Array.isArray(result.value)).toBe(true);
            if (to === "number") expect(typeof result.value).toBe("number");
            if (to === "checkbox") expect(typeof result.value).toBe("boolean");
            if (to === "date") expect(typeof result.value).toBe("object");
            if (to === "select" || to === "status") {
              expect(typeof result.value).toBe("string");
            }
          }
        }
      }
    }
  });
});
