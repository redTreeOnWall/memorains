import { cellToText, readCell } from "./filterSort";
import { dateFromDayKey, dayKeyOf } from "./journalDays";
import {
  CHART_AGGREGATES,
  CHART_TYPES,
  isChartCategoryPropType,
  isChartMeasurePropType,
  type ChartAggregate,
  type ChartType,
  type PropertyDef,
  type RowData,
  type ViewDef,
} from "./types";

/**
 * Chart data: what each bar, point and slice of a chart view stands for.
 *
 * Pure — no React, no Yjs, no binding — so the rules that decide a chart's numbers can
 * be tested without a document. Those rules are where silent wrongness lives: an
 * average that divides by every row instead of by the rows that have a value, a
 * multi-select row counted once instead of once per option, or a category that
 * quietly drops the records which have no value.
 *
 * The two halves of a chart are its **category** (what records are grouped by) and its
 * **measure** (what is aggregated per group). With no measure the chart counts
 * records, which is the one question every database can answer.
 */

/**
 * Categories a chart draws before a free-text dimension is folded into "Other".
 *
 * Only free-text dimensions are folded. Options, days and booleans have a natural,
 * finite vocabulary — folding "In progress" and "Done" into "Other" would merge two
 * things a reader asked to keep apart. Text values have no such vocabulary, so an
 * unbounded tail is instead summarised by the categories that matter most.
 */
export const MAX_CHART_CATEGORIES = 12;

/**
 * Distinct days a date dimension is allowed before it switches to months.
 *
 * A day axis is the right reading of a sprint or a month; across a year it is hundreds
 * of hairlines with unreadable labels, and the question the chart is answering is a
 * monthly one by then. The threshold is on *distinct* days, not on the span, so sparse
 * data keeps its daily resolution however far apart its days are.
 */
export const MAX_DAY_CATEGORIES = 31;

/** Bucket keys for the two rows that are not a value of the category column. */
const NO_VALUE_KEY = "empty";
const OTHER_KEY = "other";
const CHECKED_KEY = "checked";
const UNCHECKED_KEY = "unchecked";

/** One aggregated value the chart draws. */
export interface ChartPoint {
  /** Stable identity: an option id, a day, a boolean, a text value or a bucket key. */
  key: string;
  /** Display label for the axis, the legend and the tooltip. */
  label: string;
  /**
   * The aggregated number.
   *
   * May be negative (a `min` or a negative `sum`), which the view has to decide about:
   * a bar chart can draw it below zero, a pie chart cannot and says so.
   */
  value: number;
  /** Option palette name, when the bucket is a select option. Others take a series colour. */
  color?: string;
  /** Records with no value in the category column, gathered into one bucket. */
  empty?: boolean;
  /** The folded tail of a free-text dimension. */
  other?: boolean;
}

/** Everything the chart view needs to draw. */
export interface ChartPlan {
  /** Points in axis order: option order, day order, or value ranking. */
  points: ChartPoint[];
  /**
   * Records that contributed to nothing.
   *
   * Empty in count mode — there is always a category bucket to count a record in,
   * including the "No value" one. In measure mode it is the records whose measure cell
   * is empty or not a number, which is the number worth telling the reader about: it
   * says how much of the data the chart does not show.
   */
  skipped: number;
  /** Sum of the point values; negative values included. Zero when nothing is drawn. */
  total: number;
  /** Whether a free-text tail was folded into an "Other" point. */
  folded: boolean;
  /** The grain date categories ended up at, for wording the axis. */
  dateGrain?: "day" | "month";
}

/** Strings the caller supplies, so this module needs no locale state. */
export interface ChartLabels {
  /** Rows with no value in the category column. */
  noValue: string;
  /** The folded tail of a free-text dimension. */
  other: string;
  /** Checkbox category labels. */
  checked: string;
  unchecked: string;
}

export interface ChartDataInput {
  /** The view's rows, already filtered and in the view's own order. */
  rows: readonly RowData[];
  /** Column that records are grouped by. */
  category?: PropertyDef;
  /** `number` column that is aggregated. Absent means "count records". */
  measure?: PropertyDef;
  aggregate: ChartAggregate;
  /** BCP-47 tag for date labels, like `monthName` takes. */
  language: string;
  labels: ChartLabels;
  /** Override for `MAX_CHART_CATEGORIES`, so tests can pin the fold boundary. */
  maxCategories?: number;
}

/** The chart a view is configured to draw, resolved against the live schema. */
export interface ChartConfig {
  type: ChartType;
  category?: PropertyDef;
  measure?: PropertyDef;
  aggregate: ChartAggregate;
}

/**
 * The chart a view should draw, resolved against the live schema.
 *
 * Read-side tolerance, matching `getViewCalendarProperty` and `getViewGanttColumns`: a
 * stored id that is missing, dangling, or names a column whose type no longer fits is a
 * preference that can no longer be honoured — not an error — so it is dropped and the
 * best available column decides instead.
 *
 * The category fallback prefers the dimensions a chart is usually asked about, in this
 * order: an option, then a checkbox, then a day. Only after those does it take the first
 * remaining eligible column in the user's own column order, which is what makes a
 * title-only database chart its record names rather than refusing to draw.
 *
 * The measure has **no fallback**. Silently summing the first number column would put
 * numbers on screen the user never nominated and cannot explain, so "no measure" stays
 * "count the records" — a number whose meaning is obvious.
 */
export function resolveChartConfig(
  properties: readonly PropertyDef[],
  view: ViewDef | undefined,
): ChartConfig {
  const storedType = view?.chartType;
  const type =
    storedType && CHART_TYPES.includes(storedType) ? storedType : "bar";

  const storedCategory = view?.chartCategoryProp
    ? properties.find((property) => property.id === view.chartCategoryProp)
    : undefined;
  const category =
    storedCategory && isChartCategoryPropType(storedCategory.type)
      ? storedCategory
      : defaultCategory(properties);

  const storedMeasure = view?.chartMeasureProp
    ? properties.find((property) => property.id === view.chartMeasureProp)
    : undefined;
  const measure =
    storedMeasure && isChartMeasurePropType(storedMeasure.type)
      ? storedMeasure
      : undefined;

  const storedAggregate = view?.chartAggregate;
  const validAggregate =
    storedAggregate && CHART_AGGREGATES.includes(storedAggregate)
      ? storedAggregate
      : undefined;
  // `sum` is the default only because a measure was chosen: picking a column to add up
  // and then not adding it up would make the picker look broken. Without one there is
  // nothing to reduce, so the chart counts.
  const aggregate: ChartAggregate = measure
    ? (validAggregate ?? "sum")
    : "count";

  return { type, category, measure, aggregate };
}

/**
 * The best category column a chart can find.
 *
 * Option columns first (a chart of "how many per status" is the archetype), then a
 * checkbox, then a day; everything else keeps the user's column order, so the first
 * text-like column the user arranged is the one that shows.
 */
function defaultCategory(
  properties: readonly PropertyDef[],
): PropertyDef | undefined {
  for (const type of ["select", "multi-select", "checkbox", "date"] as const) {
    const found = properties.find((property) => property.type === type);
    if (found) return found;
  }
  return properties.find((property) => isChartCategoryPropType(property.type));
}

/** One category under construction, before its value is aggregated. */
interface Bucket {
  key: string;
  label: string;
  color?: string;
  /** Position in a natural order (option order, booleans); unused where values rank. */
  order: number;
  /** Rows that landed in this bucket. */
  count: number;
  /** Usable numbers the rows held, pooled so every aggregate can be recomputed. */
  values: number[];
  empty?: boolean;
  other?: boolean;
}

/**
 * Aggregate the view's rows into the points a chart draws.
 *
 * Rows are grouped by the category, then each group's measure values are reduced by the
 * aggregate. A row with no category value lands in a trailing "No value" bucket rather
 * than vanishing — invisible data is the one outcome a chart must not produce, and the
 * bucket is the chart's counterpart of the board's ungrouped column.
 *
 * A `multi-select` category puts one row in **every** option it carries, matching the
 * board's behaviour: the row really does belong to both groups, and counting it once
 * would make the chart disagree with the board built from the same column.
 */
export function buildChartData(input: ChartDataInput): ChartPlan {
  const { rows, category, measure, language, labels } = input;
  if (!category) {
    return { points: [], skipped: 0, total: 0, folded: false };
  }

  // A measure without a column cannot be reduced, so the chart counts. This is the
  // degenerate case of a caller passing an inconsistent pair; `resolveChartConfig`
  // never does.
  const aggregate: ChartAggregate = measure ? input.aggregate : "count";
  // A measure is only read by the aggregates that need one. With `count` selected the
  // measure column is deliberately ignored — the user asked for records, not values.
  const needsMeasure = measure !== undefined && aggregate !== "count";
  const maxCategories = Math.max(
    2,
    input.maxCategories ?? MAX_CHART_CATEGORIES,
  );

  const buckets = new Map<string, Bucket>();

  const ensure = (
    key: string,
    label: string,
    order: number,
    color?: string,
  ): Bucket => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const bucket: Bucket = { key, label, order, color, count: 0, values: [] };
    buckets.set(key, bucket);
    return bucket;
  };

  // Option and boolean buckets are created up front, in their own order, so an option
  // with no records still draws a zero bar. That an option exists is schema, and a
  // chart that hid it would make a configured column look empty.
  if (category.type === "select" || category.type === "multi-select") {
    category.options.forEach((option, index) =>
      ensure(optionKey(option.id), option.name, index, option.color),
    );
  } else if (category.type === "checkbox") {
    ensure(CHECKED_KEY, labels.checked, 0);
    ensure(UNCHECKED_KEY, labels.unchecked, 1);
  }

  let noValue: Bucket | null = null;
  const noValueBucket = (): Bucket => {
    noValue ??= {
      key: NO_VALUE_KEY,
      label: labels.noValue,
      order: Number.MAX_SAFE_INTEGER,
      count: 0,
      values: [],
      empty: true,
    };
    return noValue;
  };

  let skipped = 0;
  const add = (bucket: Bucket, measured: number | null) => {
    bucket.count++;
    if (measured !== null) bucket.values.push(measured);
  };

  for (const row of rows) {
    const measured = needsMeasure
      ? numericValue(readCell(row, measure.id))
      : null;
    if (needsMeasure && measured === null) skipped++;

    if (category.type === "select") {
      const value = readCell(row, category.id);
      const option = category.options.find(
        (candidate) => candidate.id === value,
      );
      add(
        option ? ensure(optionKey(option.id), option.name, 0) : noValueBucket(),
        measured,
      );
      continue;
    }

    if (category.type === "multi-select") {
      const value = readCell(row, category.id);
      let placed = false;
      for (const optId of Array.isArray(value) ? value : []) {
        const option = category.options.find(
          (candidate) => candidate.id === optId,
        );
        if (!option) continue;
        add(ensure(optionKey(option.id), option.name, 0), measured);
        placed = true;
      }
      if (!placed) add(noValueBucket(), measured);
      continue;
    }

    if (category.type === "checkbox") {
      const value = readCell(row, category.id);
      if (value === true) add(ensure(CHECKED_KEY, labels.checked, 0), measured);
      else if (value === false)
        add(ensure(UNCHECKED_KEY, labels.unchecked, 1), measured);
      else add(noValueBucket(), measured);
      continue;
    }

    if (category.type === "date") {
      const day = dayKeyOf(row.values[category.id]);
      if (!day) add(noValueBucket(), measured);
      else add(ensure(dayKey(day), day, 0), measured);
      continue;
    }

    // Everything else is free text: title, text, url, email, phone. An all-blank value
    // is "no value" rather than a category named "".
    const text = cellToText(readCell(row, category.id)).trim();
    if (!text) add(noValueBucket(), measured);
    else add(ensure(valueKey(text), text, 0), measured);
  }

  let dateGrain: "day" | "month" | undefined;
  if (category.type === "date" && buckets.size > MAX_DAY_CATEGORIES) {
    dateGrain = "month";
    const days = [...buckets.values()];
    buckets.clear();
    for (const bucket of days) {
      const month = dayOf(bucket.key).slice(0, 7);
      const target = ensure(`month:${month}`, monthLabel(month, language), 0);
      target.count += bucket.count;
      target.values.push(...bucket.values);
    }
  } else if (category.type === "date") {
    dateGrain = "day";
    // Include the year only when the days are not all in one year, so a month of data
    // is labelled "Mar 5" rather than the noisier "Mar 5, 2026".
    const keys = [...buckets.keys()]
      .map(dayOf)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const withYear =
      keys.length > 1 &&
      keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4);
    for (const bucket of buckets.values()) {
      bucket.label = dayLabel(dayOf(bucket.key), language, withYear);
    }
  }

  const valueOf = (bucket: Bucket) => aggregateValue(bucket, aggregate);
  const ordered = orderBuckets(
    [...buckets.values()].filter((bucket) => valueOf(bucket) !== null),
    category.type,
    maxCategories,
    valueOf,
    labels,
  );

  const folded = ordered.some((bucket) => bucket.other);
  if (noValue) ordered.push(noValue);

  const points: ChartPoint[] = [];
  for (const bucket of ordered) {
    const value = valueOf(bucket);
    if (value === null) continue;
    points.push({
      key: bucket.key,
      label: bucket.label,
      value,
      color: bucket.color,
      empty: bucket.empty,
      other: bucket.other,
    });
  }

  return {
    points,
    skipped,
    total: points.reduce((sum, point) => sum + point.value, 0),
    folded,
    dateGrain,
  };
}

/**
 * Put the buckets in the order the axis reads them.
 *
 * Options keep the order the user arranged them in — the same order the board's columns
 * and the option picker use. Checkboxes are "checked, then unchecked". Days go in time
 * order whatever order the rows arrived in. Free text has no inherent order, so it is
 * ranked by its aggregated value, and a long tail is folded into one "Other" point.
 *
 * Folding pools the tail's **values** rather than combining its aggregated numbers:
 * summing two averages is not an average, but the pooled values still reduce correctly
 * whatever the aggregate is.
 */
function orderBuckets(
  buckets: Bucket[],
  categoryType: PropertyDef["type"],
  maxCategories: number,
  valueOf: (bucket: Bucket) => number | null,
  labels: ChartLabels,
): Bucket[] {
  if (categoryType === "date") {
    return buckets.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
  if (categoryType === "select" || categoryType === "multi-select") {
    return buckets.sort((a, b) => a.order - b.order);
  }
  if (categoryType === "checkbox") {
    return buckets.sort((a, b) => a.order - b.order);
  }

  const ranked = buckets.sort((a, b) => {
    const byValue = (valueOf(b) ?? 0) - (valueOf(a) ?? 0);
    return byValue !== 0
      ? byValue
      : a.label < b.label
        ? -1
        : a.label > b.label
          ? 1
          : 0;
  });
  if (ranked.length <= maxCategories) return ranked;

  const kept = ranked.slice(0, maxCategories - 1);
  const other: Bucket = {
    key: OTHER_KEY,
    label: labels.other,
    order: 0,
    count: 0,
    values: [],
    other: true,
  };
  for (const bucket of ranked.slice(maxCategories - 1)) {
    other.count += bucket.count;
    other.values.push(...bucket.values);
  }
  return [...kept, other];
}

/** Reduce one bucket's pooled values to the number the chart draws. */
function aggregateValue(
  bucket: Bucket,
  aggregate: ChartAggregate,
): number | null {
  const values = bucket.values;
  const sum = () => values.reduce((total, value) => total + value, 0);

  switch (aggregate) {
    case "count":
      return bucket.count;
    case "sum":
      // The empty sum is 0, so an option nobody used is a zero bar rather than a gap.
      return values.length ? sum() : 0;
    // The other three have no value to report for an empty pool. A point that says
    // "average: 0" for records that hold no numbers is a made-up number; leaving the
    // point out is the only honest option, and `skipped` says why.
    case "avg":
      return values.length ? sum() / values.length : null;
    case "min":
      return values.length
        ? values.reduce((low, value) => Math.min(low, value))
        : null;
    case "max":
      return values.length
        ? values.reduce((high, value) => Math.max(high, value))
        : null;
  }
}

/** A finite number stored in a cell, or null. Numbers elsewhere are already validated. */
function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const optionKey = (optId: string) => `option:${optId}`;
const valueKey = (text: string) => `value:${text}`;
const dayKey = (day: string) => `day:${day}`;

/** The day stored in a `day:` bucket key. */
const dayOf = (key: string) => key.slice("day:".length);

/**
 * A day's axis label: "Mar 5" inside one year, "Mar 5, 2026" across years.
 *
 * Derived through `Intl` rather than assembled from parts, so the order of month and
 * day follows the language instead of the code.
 */
function dayLabel(day: string, language: string, withYear: boolean): string {
  const parsed = dateFromDayKey(day);
  if (!parsed) return day;
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(parsed);
}

/** A month bucket's axis label, e.g. "Mar 2026". */
function monthLabel(month: string, language: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
  }).format(new Date(year, index - 1, 1));
}
