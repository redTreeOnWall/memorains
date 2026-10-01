# Gantt View — Feature Plan

A new database layout for **scheduling work over time**: a horizontal timeline with
one bar per record, draggable to reschedule.

Named "Gantt", not "Timeline", because that is the word that describes the two-date
bar model this view is built on: the record is the work item, its date columns are
the schedule, and its dependency column is the order of operations. A timeline is
what the axis is.

See `database-type-plan.md` for the document type itself. This plan covers only the
new layout.

---

## 1. What it does

- [x] A horizontal time axis with **week / month / quarter** zoom and a fit-to-data
      zoom that is the default.
- [x] Bars come from **two `date` columns**: a start and an end. No new property type.
- [x] Dragging a bar moves both dates; dragging either edge resizes. **One field per
      row per gesture**, so a concurrent drag of another row merges exactly.
- [x] **A bar's lane never depends on its dates.** Rows stay in the view's own order, so a
      drag does not rearrange the chart under the pointer. Arranging by date is a `sort`,
      and the sort panel is where a user asks for one.
- [x] Bars take the colour of the view's `groupBy` option — the existing setting, the
      same palette the board uses.
- [x] An optional **dependency column** (a `text` column holding another record's
      name) draws a link from the predecessor's end to this bar's start, and flags a
      dependency that is violated.
- [x] An optional **milestone column** (a `checkbox`) renders a ticked row as a
      diamond on its start day rather than a bar.
- [x] Records with no start date are **listed below the chart**, not dropped, and clicking
      a day in one's lane schedules it there.
- [x] Without a date column the view says so — and switching the layout **creates**
      one, by the journal's rule, through the journal's single creation site: see §2.

### Not in this view

- Month/quarter grids of records (that is the journal).
- Baselines, critical path, resource levelling, working calendars.
- Sub-tasks, percent-complete on the bar, non-date durations.
- Dragging a bar off a schedule (clearing both dates).
- Editing a bar's dates in place — the record panel is one click away, and a date field on
  a 22px bar would be a control too small to use.

---

## 2. Data model

New optional fields on `ViewDef`. No property type is added and no row is rewritten:
the schedule is already expressible in the existing schema, which is the whole point.

```ts
// added to ViewDef
startProp?: string;       // propId of a `date` property — the bar's left edge
endProp?: string;         // propId of a `date` property — the bar's right edge
dependencyProp?: string;  // propId of a `text` property — the predecessor's name
milestoneProp?: string;   // propId of a `checkbox` property
```

**No `zoom` field.** Which zoom is open is a viewport fact, the same class as scrolling,
and the codebase has no personal-settings bucket (see the database plan's "No personal
settings" risk) — so a shared zoom would make one person's zoom-out change everybody's
view, and would fight the fit mode, since every collaborator's window is a different
width. The journal's week/month/year control is local state for the same reason, and
this is its sibling.

`groupBy` is **reused** from the board rather than duplicated. Both views want the
same thing — one `select` property whose options carry colours and an order — and
sharing the field means switching a view between board and Gantt keeps the grouping.
It also inherits the board's constraint for free: `multi-select` is refused at the
picker, the setter and the reader, because a record in two groups at once would be
drawn twice with two drop targets.

Version-stable: every field is optional and every reader tolerates an absent, dangling
or wrong-typed id, so a document written before this layout existed opens as a table
and switching it to Gantt resolves the columns it needs.

Switching to the layout **creates a `start` column when the schema has no date column at
all**, through the journal's single creation site in `DatabaseEditor.switchLayout` — a
user event, never a render. It creates one column and not two: an end is optional, and
one-day bars are a sensible opening state, whereas two columns is more schema change than
one click on a layout menu should cause. The alert that explains the change is shared with
the journal, so its wording states what happened rather than what the column is for.

---

## 3. What a bar means

```
start column ─┐
              ├─► startKey .. endKey   (inclusive, local calendar days)
end column ───┘
```

| Stored value | Bar |
|---|---|
| `start` only | a one-day bar |
| `end` present | a bar spanning both days, inclusive |
| `end` before `start` | a one-day bar on `start` (never a negative width) |
| unparseable `end` | a one-day bar on `start` |
| no usable `start` | **unscheduled** — listed below the chart, never drawn at 0 |
| milestone column ticked | a diamond on `start`, dragged as a whole |

### Lane order — the rows are a list, not a sort

**A bar's lane never depends on its dates.** The chart's rows are a vertical list as well
as a set of lanes, and sorting them by start day means a dragged bar changes lane *while
it is being dragged*: its own row moves out from under the pointer and the chart
rearranges itself in response to the edit. That reads as the drag having failed even
though the write succeeded.

So `buildGanttPlan` walks the view's rows and keeps their order, and the axis span is
found by **reducing over the days rather than by sorting the bars** — measuring them must
not rearrange them. Lanes therefore follow whatever `getViewRows` produced: the rows'
`order` keys when the view has no sorts, plus the view's own sort rules when it does.

That is how "arrange records by date" is asked for: **a sort on the date column**, through
the same sort panel the table uses. A chart applying one of its own would disagree with
the table whenever both were on screen, and would silently override an order the user had
chosen. `ganttLaneOrder.test.ts` pins both halves — the view never sorts its rows, and it
reads them through `getViewRows` so an explicit sort still counts.

Day resolution is `dayKeyOf` from `journalDays.ts`, so a bar lands on the same day a
journal cell would show and a `2026-03-15` typed date is not shifted west of
Greenwich. Duration is **inclusive of both endpoints**: the 3rd to the 5th is three
days wide, which is what a reader counts on the axis.

---

## 4. Dependencies

The predecessor is written as **text** — the other record's name — because a
cross-record id reference inside one `Y.Map` is not a mergeable value, and because a
name is what a user can actually type. Resolution is deliberately forgiving:

- exact match on the title text, case-insensitive and trimmed;
- a row id also matches, so a script or an export can use the stable identifier;
- anything that does not resolve draws **no link** — a half-typed name is the normal
  state of this column, not an error.

Two records pointing at each other is a real possibility in shared state, so cycles are
broken at read time: exactly **one edge per loop** is dropped and the rest of the schedule
still draws, so a cycle costs one arrow rather than the whole chart. Nothing is written
back. Rejecting *every* edge that participates in a loop is the trap here — it is the
obvious implementation and it removes every arrow in the document.

Which edge is dropped follows chart order (the bars' own date order), which makes it
stable across clients and renders rather than dependent on document insertion order.

A link whose target starts before its predecessor ends is drawn in the warning colour.
It is a **statement, not a correction**: the view does not move a record, because the
only correct repair is one the user has to choose.

---

## 5. Zoom, anchor and fit

The axis is a set of local calendar days with a pixel width per day; everything else
is derived from those two numbers.

| Setting | px/day | Ruler |
|---|---|---|
| Week | 28 | month labels, week gridlines |
| Month | 10 | month labels, week gridlines |
| Quarter | 3.2 | month labels, month gridlines |
| Fit (default) | computed | clamps into `[1, 40]`, picks the ruler by the resulting density |

The anchor (the first day shown) is local UI state, like the journal's month: scrolling
a shared document must not move a collaborator's viewport. The zoom **is** stored on
the view, because it changes what the view is for, exactly like a filter.

Fit is the absence of a stored zoom, so it stays correct as rows are added — a manual
zoom is a deliberate override, and the toolbar's fit button returns to automatic.

---

## 6. Dragging

Pointer events, not HTML5 drag-and-drop, because a bar is positioned in pixels and
needs sub-pixel movement, a live preview and edge hit zones — and because a plain
`dragstart` cannot resize. It is also the one interaction that works on touch once
`touch-action: none` is set, which HTML5 drag never did.

```
pointerdown on a bar body       -> move both dates
pointerdown on the left edge    -> move `start`
pointerdown on the right edge   -> move `end`
```

- The gesture is committed **once, on pointerup**, so a 30-frame drag is one CRDT
  update rather than thirty.
- A drag that lands on the same day writes nothing, and a field whose day did not change
  is not rewritten either — every write is a broadcast.
- All three modes are **delta-based**: the day under the pointer is compared with the day
  it was pressed on, and that whole-day offset is applied to the bar's original bounds.
  Measuring the target day absolutely instead inherits the press position's rounding, and
  the end edge — whose pixel position is a day's right boundary — then rounds *forward*
  and costs a day on every resize.
- A resize clamps against the other end, so a bar can never be dragged inside out.
- `dateValueForDay` writes **local noon**, the existing rule, so the day a bar was
  dropped on is the day it comes back as in every timezone.
- Only the dragged row's two date fields are written. Two people dragging different
  bars touch disjoint keys and both survive.

### Why the pointer, and where the listeners live

Pointer events rather than HTML5 drag-and-drop: a bar has to be resized from an edge, its
preview snapped to whole days, and dragged with a finger — and `dragstart` can do none of
those, since it never fires for touch at all.

The move and release listeners are attached to the **window** for the duration of a
gesture, not to the bar. The pointer routinely leaves the bar it grabbed (a left-edge
resize does so immediately) and can be released anywhere on the page. `setPointerCapture`
does not cover that reliably — it demands a live pointer id and **throws** for one the
browser does not recognise, which aborts the very handler that called it.

The live gesture is mirrored into refs as well as React state, because the window
listeners are installed once per gesture: a handler recreated on every render would need
re-attaching per pointer move, and one closed over the state would read a stale bar on the
next frame.

---

## 7. Rows, grouping and the label gutter

The label gutter is `position: sticky; left: 0` inside the chart's own scroll
container, so a bar can be read against its record while scrolled into the middle of a
year. Row height is fixed, which is what makes the dependency overlay a coordinate
calculation rather than a measurement.

Colour comes from the view's `groupBy` via `getViewRowGroups` — the same reader the list
view's option-sort drag uses. Records are **not** split into group sections: a timeline's
rows are ordered by date, and re-sorting them into buckets would break the one thing the
chart is for. An ungrouped record keeps the fallback colour.

---

## 8. The guard test

`ganttScale` and `ganttRows` are pure and tested directly, including the arithmetic
that a timezone-naive implementation gets wrong (day keys are advanced in UTC and
formatted in local time — a DST boundary must not move a bar).

The view's invariants that no unit test can see are source-level, matching
`journalSchemaWrites.test.ts`:

| Check | The silent failure it prevents |
|---|---|
| No renderer calls a schema writer, including the *view settings* writers | A view that creates a date column for every collaborator, or that "snaps" its own zoom or filter on somebody else's behalf |
| A pointer drag has a release path, a move path, and a captured pointer or window listener | A drag that looks perfect and commits nothing, or that dies the moment it leaves the element it grabbed |
| No HTML5 drag set without all four of its handlers | Mixing the two drag systems and getting neither |

`dragDropTargets.test.ts` learned a second kind of drag surface for this: a
`setPointerCapture`-or-window-listener gesture is measured against its own invariants
instead of the HTML5 four. The alternative was to silence it from the view, which is the
same as deleting the check.

`ganttLaneOrder.test.ts` is a third guard, and it exists because the bug it prevents was
**reported by a user** rather than found by a test: a drag that re-sorted the chart. It
asserts the view contains no row-reordering call (`.sort` / `.toSorted` / `.reverse`) and
that it reads rows through `getViewRows`, and it checks its own detector can see a sort so
it cannot pass vacuously.

A real bug this found during review: the dependency column is `text`, whose row value is
a live `Y.Text` object — reading `row.values[id]` and testing `typeof === "string"` made
every dependency resolve to nothing. Text reads go through `binding.getTextString`.

---

## 9. Phases and status

- [x] `ganttRows.ts` — bars, groups, dependency resolution, cycle breaking (pure)
- [x] `ganttScale.ts` — day-key arithmetic, `planAxis` (anchor + count + width together), ruler (pure)
- [x] `GanttView.tsx` — axis, rows, bars, pointer drag, dependency overlay, unscheduled list
- [x] Model — `startProp` / `endProp` / `dependencyProp` / `milestoneProp`, resolvers, sweep on column deletion
- [x] Auto-create a `start` column on switching the layout, matching the journal
- [x] Settings — the Gantt section of the columns panel
- [x] Wiring — layout union, default name, editor dispatch, i18n
- [x] `dragDropTargets.test.ts` — a second drag kind, with its own invariants
- [x] 533 tests, `lint` 0, `build` 0

**Version: `0.24.0 → 0.25.0`** (a minor bump for a new layout; no migration).

### Verified in the browser

Against a real document on the dev server, driving the app's own UI:

- **Lane order.** Three bars with dates in the order `10-24, 10-22, 10-19` kept that row
  order, and dragging the first one from `10-20` to `10-24` left it in lane 1 while a date
  sort would have sent it to the end. Adding a sort on the `Start` column re-ordered the
  lanes to `10-19, 10-22, 10-24`; clearing it restored the view's own order.
- **Click to schedule.** An undated row's lane showed a `copy` cursor and the dated lanes
  did not; clicking the column labelled `21` wrote `2026-10-21` and the "without a date"
  count dropped by one. Clicking the *middle* of a column lands on that column — the first
  cut rounded and scheduled the 22nd.

- Switching a view to Gantt on a database whose columns were already `Start` and `End`
  (plus a `Notes` text column and a `Is Milestone` checkbox) drew bars, arrows and
  diamonds with no configuration.
- A fresh database showed the "no start column" state; adding one `date` column made the
  view draw a one-day bar for a record, with no column chosen by hand.
- Dragging a bar moved it by exactly the pixels dragged: at the week zoom, +84px and
  −56px moved the dates by exactly +3 and −2 days, and a press-and-release with no
  movement wrote nothing.
- Dragging the right edge lengthened the bar by exactly the days dragged, and dragging
  the left edge shortened it by exactly the days dragged — the off-by-one that measuring
  the pointer's *absolute* day produced (a press inside a day rounds forward, and the end
  edge sits at a day's right boundary) is gone.
- A move preserved the duration: `10-10 → 10-20` became `10-14 → 10-24` after +4 days.
- The dependency arrow drew from the predecessor's last day to the successor's first, and
  the milestone rendered as a rotated diamond centred **exactly** on its day (measured
  against the axis: delta 0px).
- Four undated records were listed under the chart with "No date" badges rather than
  being dropped or placed at the origin.
- The zoom control reset to Fit on reload, confirming it is local state.
- Fitting produced a chart with `scrollWidth === clientWidth` — no stray scrollbar.

### Open risks

- **A wide span is a lot of DOM**: one node per bar plus the ruler, with no
  virtualization (inherited from the database type).
- **Dependencies are name-based**, so renaming a record silently drops its links. The
  honest fix is a `relation` property, which is out of scope by plan (§11 of the
  database plan) — a name is the part that can be typed today.
- **No working calendar**: a bar spanning a weekend looks like four working days.
- **Two columns with the same name are indistinguishable in the settings picker.** A
  dependency in the second `Notes` column needs the second `Notes` chosen, and the option
  list does not say which is which. The honest fix is to show each option's type icon in
  the picker, or to disambiguate duplicates by column order.
- **A milestone is an ordinary record with a checkbox**, so nothing stops a milestone from
  also carrying an end date. The end is simply not drawn.
- **Drag is deltas of a whole day at the current zoom.** At the quarter zoom a day is
  3.2px, so a drag needs a deliberate 3px of travel per day to be precise; the zoom is a
  viewport setting, and a drag at a wide zoom is coarse by nature.
- **Fit cannot zoom in past 40px a day**, so a database with two records shows a chart
  200px wide beside a mostly empty row. Defensible — a day wider than that is a scale no
  reader expects — but it does read as empty on a short schedule.
