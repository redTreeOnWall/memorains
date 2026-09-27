import { isOptionPropType, type OptionDef, type PropType } from "./types";

/**
 * Status is a select with progress groups.
 *
 * There is no `status` value type of its own: a status cell holds one option ID,
 * exactly like a select. The only difference is that its options are bucketed into
 * ordered progress groups, which is what lets a board column, a progress bar or a
 * "done" rollup mean anything.
 *
 * The groups are **data**, not an enum. A user can rename them, add their own
 * (e.g. "Blocked", "In review"), or move an option between them. `DEFAULT_STATUS_
 * GROUPS` is only what a freshly created status property starts with, matching the
 * stages users expect from other tools.
 *
 * Keeping these rules here — pure, no Yjs or React — means the board and status
 * rendering can be tested without a document.
 */

/** Stages a new `status` property starts with. Not an exhaustive set. */
export const DEFAULT_STATUS_GROUPS: readonly string[] = [
  "todo",
  "in_progress",
  "complete",
];

/** Human-facing names for the default groups, keyed by their stored value. */
export const DEFAULT_GROUP_LABELS: Record<string, string> = {
  todo: "To-do",
  in_progress: "In progress",
  complete: "Complete",
};

/**
 * The groups in effect for a property.
 *
 * Falls back to the defaults when the property has none stored, so a document
 * written before per-property groups existed still renders. Any group referenced
 * by an option is included even when it is missing from the stored list, so a
 * concurrently-edited option is never silently dropped from the board.
 */
export function resolveGroups(
  storedGroups: readonly string[] | undefined,
  options: readonly OptionDef[] = [],
): string[] {
  const groups = [
    ...(storedGroups?.length ? storedGroups : DEFAULT_STATUS_GROUPS),
  ];

  for (const option of options) {
    if (option.group && !groups.includes(option.group)) {
      groups.push(option.group);
    }
  }

  return groups;
}

/** A display label for a group, preferring the built-in names when they apply. */
export function groupLabel(group: string): string {
  return DEFAULT_GROUP_LABELS[group] ?? group;
}

/** Options belonging to one group, in their own sort order. */
export function optionsInGroup(
  options: readonly OptionDef[],
  group: string,
): OptionDef[] {
  return options.filter((option) => option.group === group);
}

/** Options with no group, which are shown in an "ungrouped" bucket. */
export function ungroupedOptions(options: readonly OptionDef[]): OptionDef[] {
  return options.filter((option) => !option.group);
}

/**
 * Which progress group an option belongs to, or `undefined` when unassigned.
 */
export function groupOfOption(
  options: readonly OptionDef[],
  optionId: string | undefined,
): string | undefined {
  if (!optionId) return undefined;
  return options.find((option) => option.id === optionId)?.group;
}

/**
 * Fraction of the groups considered "complete" for a single value.
 *
 * Used by the progress indicator. Returns `null` when the value is unset or its
 * group is unknown, so the caller renders "no progress" rather than zero — the two
 * mean different things to a user.
 */
export function progressForValue(
  options: readonly OptionDef[],
  groups: readonly string[],
  optionId: string | undefined,
): number | null {
  const group = groupOfOption(options, optionId);
  if (group === undefined) return null;
  const index = groups.indexOf(group);
  if (index < 0) return null;
  if (groups.length <= 1) return 1;
  return index / (groups.length - 1);
}

/**
 * Whether a value should count as finished.
 *
 * "Finished" is the last group, not a hardcoded `complete`, so a user who renames
 * or reorders their stages still gets sensible behaviour.
 */
export function isCompleteValue(
  options: readonly OptionDef[],
  groups: readonly string[],
  optionId: string | undefined,
): boolean {
  const group = groupOfOption(options, optionId);
  if (group === undefined) return false;
  return group === groups[groups.length - 1];
}

/**
 * Whether a property can supply board columns.
 *
 * `select`, `multi-select` and `status` can, because each has an option list to
 * group by. `status` is included via the same check as the others — it is not a
 * special case.
 */
export function canGroupBy(propType: PropType): boolean {
  return isOptionPropType(propType);
}

/**
 * Assert the stored groups form a valid list: unique, non-empty, no blanks.
 *
 * Used when a user edits the group list, so an invalid list never reaches the
 * document. Returns the cleaned list, or `null` when the input is unusable.
 */
export function normalizeGroups(input: readonly string[]): string[] | null {
  const cleaned: string[] = [];
  for (const raw of input) {
    const value = raw.trim();
    if (!value) continue;
    if (
      cleaned.some((existing) => existing.toLowerCase() === value.toLowerCase())
    ) {
      continue;
    }
    cleaned.push(value);
  }
  return cleaned.length > 0 ? cleaned : null;
}
