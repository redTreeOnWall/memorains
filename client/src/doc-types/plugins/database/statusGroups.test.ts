import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_LABELS,
  DEFAULT_STATUS_GROUPS,
  canGroupBy,
  groupLabel,
  groupOfOption,
  isCompleteValue,
  normalizeGroups,
  optionsInGroup,
  progressForValue,
  resolveGroups,
  ungroupedOptions,
} from "./statusGroups";
import type { OptionDef, PropType } from "./types";

const option = (id: string, name: string, group?: string): OptionDef => ({
  id,
  name,
  color: "default",
  order: "V",
  group,
});

const OPTIONS: OptionDef[] = [
  option("o1", "Not started", "todo"),
  option("o2", "Doing", "in_progress"),
  option("o3", "Done", "complete"),
];

describe("status is a select with groups, not a separate value type", () => {
  it("can be grouped by exactly like select and multi-select", () => {
    // The point of the design: no special-casing status anywhere.
    for (const type of ["select", "multi-select", "status"] as PropType[]) {
      expect(canGroupBy(type), type).toBe(true);
    }
    for (const type of ["text", "number", "date", "checkbox"] as PropType[]) {
      expect(canGroupBy(type), type).toBe(false);
    }
  });

  it("stores an option id, just like select", () => {
    // A status cell value is one option id; nothing status-specific is stored.
    expect(groupOfOption(OPTIONS, "o2")).toBe("in_progress");
    expect(groupOfOption(OPTIONS, undefined)).toBeUndefined();
  });
});

describe("resolveGroups", () => {
  it("falls back to the defaults when a property has none stored", () => {
    expect(resolveGroups(undefined)).toEqual([...DEFAULT_STATUS_GROUPS]);
    expect(resolveGroups([])).toEqual([...DEFAULT_STATUS_GROUPS]);
  });

  it("uses the user's groups when present", () => {
    const custom = ["backlog", "blocked", "review", "shipped"];
    expect(resolveGroups(custom)).toEqual(custom);
  });

  it("preserves user order, which defines progress", () => {
    // Order is meaningful: the last group is "done".
    expect(resolveGroups(["shipped", "backlog"])).toEqual([
      "shipped",
      "backlog",
    ]);
  });

  it("includes a group referenced by an option but missing from the list", () => {
    // Reachable when two clients edit concurrently: one adds an option in a new
    // group while the other rewrites the group list. Dropping the group would
    // silently hide the option from the board.
    const groups = resolveGroups(
      ["todo", "complete"],
      [option("x", "Blocked", "blocked")],
    );
    expect(groups).toContain("blocked");
  });

  it("does not duplicate a group referenced by many options", () => {
    const groups = resolveGroups(
      ["todo"],
      [option("a", "A", "todo"), option("b", "B", "todo")],
    );
    expect(groups.filter((group) => group === "todo")).toHaveLength(1);
  });
});

describe("groupLabel", () => {
  it("prettifies the built-in groups", () => {
    expect(groupLabel("todo")).toBe(DEFAULT_GROUP_LABELS.todo);
    expect(groupLabel("in_progress")).toBe("In progress");
  });

  it("passes through a user-defined group name", () => {
    // A custom group must render as the user typed it, not be dropped.
    expect(groupLabel("Blocked")).toBe("Blocked");
    expect(groupLabel("in review")).toBe("in review");
  });
});

describe("optionsInGroup / ungroupedOptions", () => {
  it("selects options by group", () => {
    expect(optionsInGroup(OPTIONS, "todo").map((o) => o.id)).toEqual(["o1"]);
    expect(optionsInGroup(OPTIONS, "nonexistent")).toEqual([]);
  });

  it("collects options with no group", () => {
    const withUngrouped = [...OPTIONS, option("o4", "Maybe")];
    expect(ungroupedOptions(withUngrouped).map((o) => o.id)).toEqual(["o4"]);
  });
});

describe("progressForValue", () => {
  const groups = ["todo", "in_progress", "complete"];

  it("maps groups across the range", () => {
    expect(progressForValue(OPTIONS, groups, "o1")).toBe(0);
    expect(progressForValue(OPTIONS, groups, "o2")).toBe(0.5);
    expect(progressForValue(OPTIONS, groups, "o3")).toBe(1);
  });

  it("returns null for unset or unknown values rather than zero", () => {
    // Zero means "not started"; null means "no information". Conflating them
    // would show every empty cell as 0% complete.
    expect(progressForValue(OPTIONS, groups, undefined)).toBeNull();
    expect(progressForValue(OPTIONS, groups, "missing")).toBeNull();
  });

  it("handles a single-group configuration", () => {
    expect(progressForValue([option("a", "Only", "solo")], ["solo"], "a")).toBe(
      1,
    );
  });

  it("adapts to a user-defined group list", () => {
    const custom = ["backlog", "blocked", "review", "shipped"];
    const options = [option("a", "A", "blocked"), option("b", "B", "shipped")];
    expect(progressForValue(options, custom, "a")).toBeCloseTo(1 / 3);
    expect(progressForValue(options, custom, "b")).toBe(1);
  });
});

describe("isCompleteValue", () => {
  const groups = ["todo", "in_progress", "complete"];

  it("treats the last group as complete", () => {
    expect(isCompleteValue(OPTIONS, groups, "o3")).toBe(true);
    expect(isCompleteValue(OPTIONS, groups, "o2")).toBe(false);
    expect(isCompleteValue(OPTIONS, groups, "o1")).toBe(false);
  });

  it("follows a user-defined last group instead of hardcoding 'complete'", () => {
    // If a user's stages end in "shipped", that is what done means.
    const custom = ["backlog", "shipped"];
    const options = [option("a", "A", "backlog"), option("b", "B", "shipped")];
    expect(isCompleteValue(options, custom, "b")).toBe(true);
    expect(isCompleteValue(options, custom, "a")).toBe(false);
  });

  it("is false for unset or unknown values", () => {
    expect(isCompleteValue(OPTIONS, groups, undefined)).toBe(false);
    expect(isCompleteValue(OPTIONS, groups, "missing")).toBe(false);
  });
});

describe("normalizeGroups", () => {
  it("trims, drops blanks, and removes case-insensitive duplicates", () => {
    expect(normalizeGroups([" todo ", "", "Todo", "complete"])).toEqual([
      "todo",
      "complete",
    ]);
  });

  it("preserves order", () => {
    expect(normalizeGroups(["b", "a"])).toEqual(["b", "a"]);
  });

  it("returns null when nothing usable remains", () => {
    expect(normalizeGroups([])).toBeNull();
    expect(normalizeGroups(["", "   "])).toBeNull();
  });
});
