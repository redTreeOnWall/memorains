# Chart View — Feature Plan

A new database layout for **seeing what a column adds up to**: one bar, point or slice
per category, with an aggregated value.

A chart is the one view that answers a question the table cannot answer by reading it.
"A table of six orders across eight statuses" is a number nobody can see; the chart is
how it is seen. It is the natural sixth layout after the board (which shows one column
per option) and the journal (which shows one column per day), because it generalises
both: any eligible column can be the categories, and the numbers come from an aggregate
rather than from the row count.

See `database-type-plan.md` for the document type itself. This plan covers only the new
layout.

---

## 1. What it does

- [x] Three shapes: **bar**, **line**, **pie**, switched from the view's own toolbar.
- [x] **Categories** come from any column a record holds one value of: a `select`, a
      `multi-select`, a `checkbox`, a `date`, or text/title. No new property type.
- [x] **Values** are an aggregate over a `number` column: `count` (the default),
      `sum`, `avg`, `min`, `max`.
- [x] With no measure the chart **counts records**, which is the one question every
      database can answer.
- [x] A `date` category buckets by day, switching to months when there are more distinct
      days than an axis can name.
- [x] A text category is ranked by value, with the tail folded into one "Other" bar.
- [x] Records with no category value are a trailing "No value" bucket, not dropped.
- [x] Records the measure cannot use are counted and reported below the chart.
- [x] The shape and the two columns live on the **view**, so two people reading "this
      view" see the same chart.

### Not in this view

- Stacked, grouped or dual-axis charts. A second measure doubles the settings surface
  and the drawing code for a question a filter and a second view already answer.
- A scatter plot. Both axes of a chart here are *categorical* — an x-axis of raw numbers
  is a different layout with a different data model.
- Colours chosen per chart. A category with an option colour keeps it; everything else
  takes the palette. A per-view colour picker is a separate feature.
- Chart export as an image. The SVG is in the DOM, but a file-format pipeline is the
  export module's concern, not the view's.

---

## 2. Data model

New optional fields on `ViewDef`. No property type is added and no row is rewritten.

```ts
// added to ViewDef
chartType?: ChartType;            // "bar" | "line" | "pie" — absent means bar
chartCategoryProp?: string;       // propId — the chart's categories
chartMeasureProp?: string;        // propId of a `number` column; absent means count
chartAggregate?: ChartAggregate;  // "count" | "sum" | "avg" | "min" | "max"
```

Every field is **sparse and tolerant**, matching `startProp` / `calendarProp`:

| Stored state | Read as |
|---|---|
| `chartCategoryProp` absent | pick the first `select`, then `multi-select`, then `checkbox`, then `date`, then the first text-like column |
| `chartCategoryProp` dangling, or retyped to a `number` | same fallback |
| `chartMeasureProp` absent | count records |
| `chartMeasureProp` dangling, or retyped away from `number` | count records |
| `chartAggregate` absent | `sum` when a measure is chosen, else `count` |
| `chartType` absent or unknown | `bar` |

The measure deliberately has **no fallback to "the first number column"**. Silently
summing a column the user never nominated would put numbers on screen that they cannot
explain; "count of records" is a number whose meaning is obvious, and it is the state a
chart opens in.

---

## 3. What a bar means — `chartData.ts`

The pure module owns every rule, so the numbers can be tested without a document.

**Categories.** Option and checkbox buckets are created **up front**, including ones
with no records, so an option that exists in the schema draws a zero bar — a chart that
hid it would make a configured column look empty. A `multi-select` row lands in **every**
option it carries, matching the board; counting it once would make the chart disagree
with a board built from the same column. A row with no value lands in a trailing "No
value" bucket, because invisible data is the one outcome a chart must not produce.

**Date grain.** Days are bucketed by `dayKeyOf`, which already treats a bare `YYYY-MM-DD`
literally. More than 31 **distinct** days switches to months — the threshold is on
distinct days rather than on the span, so a quarterly check-in keeps its daily
resolution. Labels are formatted through `Intl`, which fixes the month/day order per
language.

**Free text.** Options and days have a natural order; text does not, so text categories
are ranked by their aggregated value and the tail is folded into one "Other". Folding
pools the tail's **values** rather than combining its aggregated numbers — summing two
averages is not an average, but the pooled values still reduce correctly whatever the
aggregate is.

**Measuring.** A measure column is only read by the aggregates that need one: in
`count` mode the measure is ignored, because the user asked for records rather than for
the values of a column they did not choose. An empty pool reports **no point** rather
than zero for `avg` / `min` / `max` — "average: 0" for records that hold no numbers is a
made-up number — and the count of what was skipped says so. `sum` of an empty pool is a
genuine zero.

---

## 4. Axis rules — `chartGeometry.ts`

**Zero is always in the domain.** A bar's length is its value, and that is only true when
every bar is measured from the same baseline. Truncating the axis would draw a bar twice
as long for a value twice as large. The same rule applies to a line chart, so the two
shapes tell the same story.

**A full circle is two arcs.** An SVG arc whose endpoints coincide is defined to draw
nothing, so the naive one-arc path renders a blank chart exactly in the case that matters
most: a filter leaving one category, which is a 100% one-slice pie.

**A pie cannot show negatives, and says so.** A slice is a share of a whole, and a
negative share is not something a reader can interpret; a total of zero cannot be divided
proportionally at all. `pieSlices` gives negative and zero values no arc, and the view
prints why rather than drawing an arbitrary picture. The legend's percentage divides by
the **positive** total, matching the slices rather than the signed sum.

---

## 5. The view — `ChartView.tsx`

Hand-drawn SVG, no charting library. The app ships none, and the three shapes are a few
hundred lines of arithmetic that the two pure modules already own and test; a rendering
engine would be a second, larger implementation of the same thing.

- The plot **measures its container** with a `ResizeObserver` (the Gantt's rule), so the
  chart fits the column instead of guessing a width.
- Bars carry a value label when there are at most 14 of them; category labels rotate 35°
  when they would collide.
- Tooltips are SVG `<title>` elements — native hover without a positioning library for
  elements whose text is one line.
- Colours: an option's own palette colour where there is one, otherwise the **vivid**
  tier. A chart's fills are large areas, so the macaron tier is too pale to separate
  neighbouring bars and the deep tier turns ten categories into one dark mass.
- These are the view's states, each with its own message: no eligible category column
  ("pick one"), no values, an all-negative pie, folded "Other", skipped records.

The shape toggle lives in the chart's own toolbar because it is the one setting a user
flips constantly; the two columns and the aggregate live in the columns panel beside
every other view setting, so the toolbar does not become a second settings panel.

---

## 6. Settings

`ViewSettings.tsx` gains a chart section, rendered only for `layout === "chart"`, with
the category picker (eligible types only), the value picker (with an empty "Count of
records" entry) and the aggregate picker (shown only once a measure is chosen, since with
none there is nothing to reduce).

---

## 7. Phases and status

- [x] `types.ts` — `chart` layout, `ChartType`, `ChartAggregate`, eligibility predicates
- [x] `chartData.ts` — buckets, grain, folding, aggregates, `resolveChartConfig` (pure)
- [x] `chartGeometry.ts` — nice scale, band layout, pie slices and arcs (pure)
- [x] `ChartView.tsx` — axis, bars, line, pie, legend, states
- [x] Model — fields, setters with type guards, resolver, sweep on column deletion
- [x] Settings — the chart section of the columns panel
- [x] Wiring — layout union, default name, editor dispatch, i18n
- [x] Tests — 66 new (`chartData` 32, `chartGeometry` 22, `model` 12)
- [x] README, `lint` 0, `build` 0

**Version: `0.29.1 → 0.30.0`** (a minor bump for a new layout; no migration).

### Verified in the browser

Against a real document on the dev server, driving the app's own UI:

- A new chart view opened as a bar chart of record counts over the `Status` select, with
  the three option bars in the option order the schema arranged them in.
- All three shapes rendered: bar and line share the axis, the pie draws slices with a
  legend of `label · value · share`.
- Switching the category to a `Notes` text column re-ranked the bars (two "alpha note",
  two "beta note", one "gamma note") and added a trailing "No value" bucket for the blank
  cell rather than dropping the row.
- Adding a `number` column, choosing it as the value and leaving the aggregate alone
  defaulted to **Sum** — `37 / 26 / 21` for the three statuses, matching the six cells by
  hand. `Average` gave `18.5 / 13 / 10.5`, `Minimum` `3 / 5 / 8`, `Maximum` `34 / 21 / 13`,
  and `Count` fell back to `2 / 2 / 2` with the measure still chosen.
- The shape and both columns **survived a reload**, confirming they are view state rather
  than local state.
- No console errors or React exceptions in any of the above.

### Open risks

- **No axis for a number category.** A `number` column cannot define categories by
  design, so a scatter plot is not expressible; the chart is categorical only.
- **A bar chart of one category per row is a table drawn sideways.** The view does not
  detect that; it is the user's choice of category.
- **The x-axis does not scroll or virtualise.** Twelve categories fit; a text column with
  sixty distinct values is folded to "Other" rather than drawn, which is the intended
  behaviour but means the chart cannot show all sixty.
- **Pie slices below a few percent are unreadable** and are not grouped; the legend names
  them, which is why it is always rendered.
- **A measure column is read per row on every render.** For the row counts this
  application holds that is free; a database in the tens of thousands would want the
  aggregate memoised on a revision.
