import type { FilterNode, SortRule } from "./filterSort";

/**
 * Types and constants shared by the database document type.
 *
 * Kept separate from `model.ts` so pure modules (retype, reorder, filters) can
 * depend on the shapes without importing the CRDT binding, which would create a
 * cycle and drag Yjs into code that does not need it.
 */

/** Top-level keys owned by this document type. */
export const SCHEMA_KEY = "db_schema";
export const VIEWS_KEY = "db_views";
export const ROWS_KEY = "db_rows";

/**
 * Document-level metadata (currently what to show at the top level of the editor).
 *
 * Deliberately a **separate top-level key** rather than a field inside `db_views`:
 * that map is iterated wholesale to build the view list, so a non-view key inside
 * it would be treated as a view and rendered as a tab.
 */
export const META_KEY = "db_meta";

/** Framework keys on a row. Property values are prefixed, so these cannot clash. */
export const ROW_ID_KEY = "id";
export const ROW_ORDER_KEY = "order";

/**
 * Prefix for property values on a row.
 *
 * Row keys therefore fall into two disjoint namespaces: the framework's
 * (`id`, `order`) and the user's schema (`p:<propId>`). Without a prefix, a
 * property whose ID happened to be `order` would silently overwrite the row's
 * sort key. Property IDs are generated UUIDs so this could not happen in
 * practice, but "practically impossible" is not "impossible", and the prefix
 * costs nothing because the schema — not the row's key set — is the source of
 * truth for which columns exist.
 */
export const PROP_PREFIX = "p:";

export const propKey = (propId: string) => `${PROP_PREFIX}${propId}`;

/**
 * Storage key for one option of a multi-select cell.
 *
 * A multi-select cell is stored as **one row key per selected option** rather
 * than as a nested `Y.Map` of option IDs. This is not a style choice: when two
 * peers concurrently *create* a nested shared type at the same key — which is what
 * happens when both add the first tag to an empty cell while offline — one of the
 * two maps is discarded along with everything inside it. Measured, that lost a tag
 * outright:
 *
 * ```
 * two peers each create a fresh Y.Map at the same key -> ["tag-a"]      tag-b lost
 * one row key per option                             -> ["tag-a","tag-b"]
 * ```
 *
 * Writing a distinct key per option means concurrent additions of *different*
 * options touch disjoint keys, which Yjs merges exactly. Removing an option is a
 * single `delete`, and that also merges correctly.
 */
export const multiSelectKey = (propId: string, optId: string) =>
  `${PROP_PREFIX}${propId}:${optId}`;

/** Prefix matching every option key of one multi-select property. */
export const multiSelectPrefix = (propId: string) => `${PROP_PREFIX}${propId}:`;

/** Extract the option ID from a multi-select row key, or null if not one. */
export function optionIdFromKey(propId: string, key: string): string | null {
  const prefix = multiSelectPrefix(propId);
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

export type PropType =
  | "title"
  | "text"
  | "number"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "select"
  | "multi-select"
  | "date";

/**
 * Property types whose value is a `Y.Text` rather than a primitive.
 *
 * Text is character-mergeable, which is what makes two people editing the same
 * cell offline keep both edits. Discrete types (`number`, `select`, dates) are
 * deliberately *not* mergeable: merging "Bob" and "Carol" into "BobCarol" is not
 * a value either user wanted, so last-write-wins is the correct behaviour there.
 */
export const TEXT_PROP_TYPES: readonly PropType[] = ["title", "text"];

export const isTextPropType = (type: PropType) =>
  TEXT_PROP_TYPES.includes(type);

/** Types whose value is a plain string, not a `Y.Text`. */
export const PLAIN_STRING_PROP_TYPES: readonly PropType[] = [
  "url",
  "email",
  "phone",
];

export const isPlainStringPropType = (type: PropType) =>
  PLAIN_STRING_PROP_TYPES.includes(type);

/** Select-family types keep a list of options. */
export const OPTION_PROP_TYPES: readonly PropType[] = [
  "select",
  "multi-select",
];

export const isOptionPropType = (type: PropType) =>
  OPTION_PROP_TYPES.includes(type);

/**
 * The property holding the completion checklist in a journal view.
 *
 * Only `multi-select` qualifies: a per-day checklist is a set of ticks, and a
 * single `select` value cannot express "three of five done".
 */
export const CHECKLIST_PROP_TYPES: readonly PropType[] = ["multi-select"];

export const isChecklistPropType = (type: PropType) =>
  CHECKLIST_PROP_TYPES.includes(type);

/**
 * Whether a `date` property can supply a view's time axis.
 *
 * One predicate for both views that need one, because they need the same thing: a
 * calendar day is read out of the cell. The journal places a record on one day, the
 * Gantt draws a bar between two — but a `text` or `number` column has no day in it for
 * either, so the check is the same and two spellings of it would be one too many.
 */
export const isCalendarPropType = (type: PropType) => type === "date";

/**
 * Property types that can mark a record as a milestone.
 *
 * A checkbox, because a milestone is a boolean fact about the record ("this is the
 * handover") rather than a second schedule. The option's own vocabulary — a `select`
 * with one option named "Milestone" — would put the same information in a column whose
 * value the view would then have to interpret.
 */
export const isMilestonePropType = (type: PropType) => type === "checkbox";

/**
 * Property types a dependency can be written in.
 *
 * `text` only. The predecessor is stored as the other record's **name**, because a
 * cross-record identifier is not a mergeable cell value and because a name is what the
 * user can actually type. Resolving a name is forgiving by design (see `ganttRows.ts`),
 * so a half-typed one costs a missing arrow rather than an error.
 */
export const isDependencyPropType = (type: PropType) => type === "text";

/**
 * Property types a board may group columns by.
 *
 * **`select` only.** A board column is "the rows whose value is this option", and
 * that only holds when a row belongs to exactly one option. With `multi-select` a
 * row carrying two tags would have to appear in two columns at once — the same row
 * shown twice, a drop meaning "add" for one column and "replace" for another, and a
 * column membership that cannot be read back from the value. Rather than offer a
 * grouping whose semantics differ from every other board, `multi-select` is not
 * groupable; a table, list or filter remains the way to slice by tags.
 */
export const GROUPABLE_PROP_TYPES: readonly PropType[] = ["select"];

export const isGroupablePropType = (type: PropType) =>
  GROUPABLE_PROP_TYPES.includes(type);

/**
 * Pick the property a board should group by when the user has not chosen one.
 *
 * A board is meaningless without a grouping column, so rather than opening on an
 * empty board that demands configuration before it shows anything, the best
 * available property is chosen.
 *
 * The **first** groupable property wins, and properties arrive in the user's own
 * column order — so a table the user has arranged keeps dictating the grouping.
 *
 * Lives here rather than in `propertyTypes.ts` so the model can use it: that module
 * imports MUI icons, which would drag React into the pure data layer.
 *
 * @returns the property id to group by, or undefined when nothing can group.
 */
export function defaultGroupByProperty(
  properties: readonly PropertyDef[],
): string | undefined {
  return properties.find((property) => isGroupablePropType(property.type))?.id;
}

export interface OptionDef {
  id: string;
  name: string;
  color: string;
  order: string;
}

export interface PropertyDef {
  id: string;
  name: string;
  type: PropType;
  order: string;
  options: OptionDef[];
  /** Number display format; only meaningful for `number`. */
  format?: string;
}

export interface DateValue {
  /** ISO date or datetime string. */
  start: string;
  end?: string;
  includeTime?: boolean;
}

export type ViewLayout =
  | "table"
  | "list"
  | "board"
  | "journal"
  | "gantt"
  | "chart";

/** Shapes a chart view can draw. */
export type ChartType = "bar" | "line" | "pie";

export const CHART_TYPES: readonly ChartType[] = ["bar", "line", "pie"];

/** How a chart reduces each category's measure into one number. */
export type ChartAggregate = "count" | "sum" | "avg" | "min" | "max";

export const CHART_AGGREGATES: readonly ChartAggregate[] = [
  "count",
  "sum",
  "avg",
  "min",
  "max",
];

/**
 * Property types a chart may split records by.
 *
 * A chart's categories are "the values of this column", so any column whose value a
 * record holds **one of** qualifies: an option, a day, a checkbox, a piece of text.
 * A `number` column does not, because a number is a quantity and the chart already has
 * a dedicated place for quantities (its measure); splitting by it would produce one
 * bar per distinct amount, which is a scatter plot stretched sideways.
 */
export const CHART_CATEGORY_PROP_TYPES: readonly PropType[] = [
  "select",
  "multi-select",
  "checkbox",
  "date",
  "title",
  "text",
  "url",
  "email",
  "phone",
];

export const isChartCategoryPropType = (type: PropType) =>
  CHART_CATEGORY_PROP_TYPES.includes(type);

/** Property types a chart may measure. Numbers only. */
export const isChartMeasurePropType = (type: PropType) => type === "number";

export interface ViewDef {
  id: string;
  name: string;
  /**
   * Whether `name` is still the auto-generated default for this view's layout.
   *
   * Tracked explicitly rather than inferred by comparing strings, because the name
   * is localised by the creating client: a view created in Chinese would not match
   * an English default, and the layout rename below would then fail to fire. With
   * the flag the intent is unambiguous — "the user has not named this yet".
   */
  nameIsDefault?: boolean;
  layout: ViewLayout;
  order: string;
  /** Property IDs to show, in display order. Empty = show all. */
  visibleProps: string[];
  /** `board` only: the `select` property whose options become the columns. */
  groupBy?: string;
  /**
   * Filter tree, or undefined for "show everything".
   *
   * Stored as a plain object rather than a nested `Y.Map`: a filter is a small,
   * wholly-replaced structure, and last-write-wins is the correct resolution when
   * two people edit one concurrently — merging halves of two different filter trees
   * would produce something neither of them built.
   */
  filter?: FilterNode;
  /** Sort rules, applied in order; the first is the primary sort. */
  sorts?: SortRule[];
  /** `hideEmptyGroups`: whether a board omits columns with no rows. */
  hideEmptyGroups?: boolean;
  /**
   * `journal` only: the `date` property whose value decides which day a record
   * lands on.
   *
   * **Missing means "choose automatically", not "broken"** — unlike a board's
   * `groupBy`, which renders an instruction when absent. A journal can always fall
   * back to the first date column, so an absent value is a request to pick one
   * rather than an error state.
   */
  calendarProp?: string;
  /**
   * `journal` only: the `multi-select` property rendered as a per-day completion
   * ring. Optional — a journal is useful without a checklist.
   */
  checklistProp?: string;
  /**
   * `journal` only: hide the streak bar above the grid.
   *
   * Stored the way `hideEmptyGroups` is — the non-default value only — so a journal
   * that was never asked to hide its streaks keeps no key for it, and the feature is
   * on for documents written before it existed.
   */
  hideStreaks?: boolean;
  /**
   * `gantt` only: the `date` property a bar's **left edge** comes from.
   *
   * Absent means "choose the best available", not "broken": the resolver takes the first
   * date column in the user's own column order, so a database whose columns are already
   * `Start`/`Due` draws bars with no configuration. See `resolveGanttPair`.
   */
  startProp?: string;
  /**
   * `gantt` only: the `date` property a bar's **right edge** comes from.
   *
   * Optional, and that is meaningful: without it every record is a one-day bar on its
   * start date, which is what a list of dated records means before anyone has scoped
   * the work.
   */
  endProp?: string;
  /**
   * `gantt` only: the `text` property naming each record's predecessor.
   *
   * A name, not an id reference — a cross-record identifier is not a mergeable cell
   * value, and a name is the part a user can type. See `ganttRows.ts` for how a name is
   * resolved and what happens when it does not resolve.
   */
  dependencyProp?: string;
  /**
   * `gantt` only: the `checkbox` property that marks a record as a milestone.
   */
  milestoneProp?: string;
  /**
   * Per-column widths, keyed by property id, for the **table** view.
   *
   * A view setting, like a filter or a sort, rather than a personal one: there is no
   * personal bucket in this codebase, and a column width is part of how a view was
   * arranged — the same class of decision as its column order and visibility, which are
   * already shared. One person widening a column so a long value fits is a fix everybody
   * benefits from.
   *
   * Sparse on purpose: an absent entry is the default width, so a view that was never
   * resized stores nothing, and the default can change later without a migration.
   */
  columnWidths?: Record<string, number>;
  /**
   * `table` only: how many leading columns stay put when the table scrolls sideways.
   *
   * A **count**, not a set of ids, because freezing is inherently a prefix: "keep this
   * much of the record's identity on screen". Storing ids would allow a frozen column in
   * the middle of the table, which has no meaning — the columns after it would scroll
   * under a gap. The count names every column up to that point, and stays correct when a
   * column is reordered or inserted before it.
   *
   * Absent or 0 means nothing is frozen.
   */
  frozenColumns?: number;
  /**
   * `chart` only: the shape drawn — a bar chart, a line chart or a pie chart.
   *
   * A **view setting**, not local state like the Gantt's zoom. Which chart a view is
   * is the view: two people looking at "Revenue by month" have to see the same chart,
   * and a shape is not a viewport fact the way a scroll position is. Absent means
   * `bar`, which is also what a chart written before this field renders as.
   */
  chartType?: ChartType;
  /**
   * `chart` only: the column records are grouped by — the chart's categories.
   *
   * Absent means "choose automatically", matching the journal's and the Gantt's copy of
   * this rule: an option column first, then a checkbox, then a date, then any other
   * eligible column in the user's own order. Read-side tolerance is deliberate — a
   * preference that cannot be honoured is a request to pick the best available column,
   * not an error state.
   */
  chartCategoryProp?: string;
  /**
   * `chart` only: the `number` column whose values are aggregated per category.
   *
   * Absent means **count the records** rather than measure nothing — a chart of "how many"
   * is the one question every database can answer, and it is the state a chart opens in
   * before anyone has picked a column. There is deliberately no fallback to "the first
   * number column": silently summing a column the user never nominated would put numbers
   * on screen that they did not ask for and cannot explain.
   */
  chartMeasureProp?: string;
  /**
   * `chart` only: how the measure is reduced per category.
   *
   * Absent means `sum` when a measure column is chosen and `count` when none is, which is
   * what each of those states shows without being told anything further.
   */
  chartAggregate?: ChartAggregate;
}

/**
 * Zoom levels a Gantt view can be shown at.
 *
 * **Not stored on the view.** Which zoom is open is a *viewport* fact, the same class as
 * scrolling — and like a scroll position it is re-derived rather than shared, because the
 * fit zoom is computed from the window width and every collaborator's window is a
 * different size. The journal's week/month/year scale is local state for the same reason,
 * and this is its sibling control.
 *
 * Declared here, beside the other property-type vocabularies, so the view and the pure
 * geometry module agree on the set without `ganttScale.ts` reaching into the model.
 */
export type GanttZoom = "week" | "month" | "quarter";

export const GANTT_ZOOMS: readonly GanttZoom[] = ["week", "month", "quarter"];

/** A row as the UI consumes it: property values keyed by `propId`. */
export interface RowData {
  id: string;
  order: string;
  values: Record<string, unknown>;
}

/** Generate an opaque, stable identifier for a property, option, row or view. */
export function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
