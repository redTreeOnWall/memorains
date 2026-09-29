# Journal View — Feature Plan

A new database layout for **day-to-day record keeping**: habit tracking, daily
checklists, diary entries. An electronic calendar journal (手帐), not a scheduling
calendar.

Deliberately **not** named "Calendar". A real calendar view — appointments, time
ranges, reminders — is a separate future feature and keeps that name. This view
discretizes time to whole days, which is what makes it cheap: no interval layout, no
pixel-to-time mapping, no drag-to-reschedule.

See `database-type-plan.md` for the document type itself. This plan covers only the
new layout.

---

## 1. What it does

- [ ] **Week / month / year** grids, switchable from the view toolbar.
- [ ] Clicking an empty day creates a record **on that day** and opens the record
      panel — one gesture from "I want to note something" to typing.
- [ ] Clicking a day that already has a record opens that record instead of
      creating a second one.
- [ ] Day cells show a compact summary of the record's fields, honouring the view's
      per-view column visibility.
- [ ] The view has a **calendar property**: a `date` column whose value decides which
      day a record lands on.
- [ ] The view may have a **checklist property**: a `multi-select` column rendered as
      a per-day completion ring.
- [ ] Without a usable date column the view says so rather than rendering an empty
      grid.

### Not in this view

- Time-of-day scheduling, durations, overlapping events.
- Reminders or notifications.
- Dragging a record to another day (v2 — it is a single-field write, same shape as a
  board card drop).
- Multi-day ranges. `end` exists in the stored shape but nothing creates it yet; a
  range is rendered on its start day only.

---

## 2. Data model

Two new optional fields on `ViewDef`. Nothing else changes — the date and
multi-select columns are existing property types, and every record is still an
ordinary row.

```ts
// added to ViewDef
calendarProp?: string;   // propId of a `date` property
checklistProp?: string;  // propId of a `multi-select` property
```

**Missing means "choose automatically", not "broken".** Both fields are optional and
both fall back to the same tiering rule the board uses: pick the first usable
property in the user's own column order. `defaultCalendarProperty` mirrors
`defaultGroupByProperty` (same file, same shape, pure and tested).

The difference from the board matters: a board with no `groupBy` renders an
instruction, because a board is meaningless without columns. A journal without a
calendar property can still choose one, and an auto-created column is what a user
clicking into the view expects. So "missing" is a **fallback**, not an error state —
the instruction is reserved for "no date column exists and none can be made".

---

## 3. Day bucketing — local time, one rule

> **A record belongs to the day its date value falls on in the reader's local
> calendar.**

This is the whole rule. `dayKeyOf(value)` is a pure function returning `YYYY-MM-DD`
from the value's **local** calendar components (`getFullYear` / `getMonth` /
`getDate`), never from string-slicing an ISO timestamp — a UTC instant is a different
day for most of the world, and slicing would put a record one cell off its own
displayed date.

### The picker bug this depends on

`DatePickerDialog` currently mixes three timezone conventions inside itself: it reads
the day with `toISOString().slice(0,10)` (**UTC**) while reading the time with
`toTimeString()` (**local**), and writes back with `new Date("YYYY-MM-DDTHH:mm")`
(**local**). Measured at UTC+8:

| Stored local time | Round-trip through the picker |
|---|---|
| `2026-03-15 23:59` | `2026-03-15 23:59` — fine |
| `2026-03-15 00:00` | shows `2026-03-14`, and **confirming it moves the record back a day** |

So any date value before ~08:00 local drifts backwards on a no-op edit, and an empty
`initDate` defaults to the wrong day before 08:00. Fix the dialog to build its date
string from local components (`getFullYear` / `getMonth` / `getDate`).

**This needs no migration.** `formatSmartDate` already renders in local time, so the
fix aligns the picker with the existing display convention instead of changing it.

**Do not add a date-only storage mode.** The local day is a *derived* value; storing
it would be a second source of truth that can disagree with the date column.

---

## 4. One record per day, and what happens when there are more

The model cannot enforce one record per day — concurrency and remote edits make a
uniqueness constraint unworkable in a CRDT. The **view** therefore picks:

- Show **the first record in the view's own order** (`getViewRows`, so the view's
  sorts decide which one that is, not row insertion order).
- If other records also fall on that day, show a small warning icon with a tooltip
  saying how many are hidden. Report the condition; do not try to resolve it, and do
  not offer navigation.

The completion ring is computed from **the displayed record only**, not from the
union of the day's records. The two must agree: the number on the ring has to be
explainable from what the cell shows. Hidden records are what the warning icon
discloses.

---

## 5. Completion ring

Only when a checklist property is configured.

- **Denominator is the whole option list** of the multi-select column.
- Zero options → render **no ring** (`0/0` is a bug, not "incomplete").
- Ring colour shifts with the ratio; a numeric `done/total` label sits beside or
  inside it so the denominator is never invisible.

**Accepted consequence, stated not hidden:** removing an option retroactively raises
every past day's completion, and adding one lowers it. This is what it means for the
option list to be user-editable data. A user who wants a clean slate starts a new
document. Per-option effective date ranges were considered and rejected as
disproportionate complexity. (Same failure mode the removed `status` type had —
except here the semantics are stated up front rather than assumed.)

---

## 6. Auto-creating a date column

When the user switches a view to journal and no date column exists, one is created
for them. This is the common path: the default schema is `Name | Status | Notes`.

Three rules, all load-bearing:

1. **Only in a user event handler.** Never in a render pass, a memo, or any
   reconciliation/self-check logic. A client that creates a column while merely
   *rendering* the view would add it for every collaborator. If this is violated the
   view is a shared write triggered by reading.
2. **Same transaction, and create the column before changing the layout.** Nested
   `yDoc.transact` calls are safe (the inner one joins the outer; `afterTransaction`
   fires once — measured), so atomicity is free. The ordering is **not** a CRDT
   requirement, it is a UI race: changing the layout first renders one frame in which
   no calendar property exists, and that frame is the "cannot create a record"
   guard.
3. **The side effect is visible to others.** A remote collaborator sees a column
   appear. Use a localised column name and a snackbar. The alternative — an
   instruction panel with a "create column" button — is a mode switch for something
   people do once.

Once `calendarProp` is explicit, a date column being deleted does **not** re-trigger
creation: the stored id is preferred until it resolves to nothing, then the fallback
picks an existing column, and only if no date column remains does creation happen
again.

---

## 7. Things that will bite, in order

**1. `deleteProperty` must sweep the new fields.** It clears `visibleProps` and
`groupBy` today. Without adding `calendarProp` and `checklistProp`, deleting the date
column leaves a dangling id — and unlike a stale filter, this one is load-bearing: a
write target. Sweep both fields in the same transaction, *and* tolerate a dangling id
on read, *and* refuse to create a record when no date property resolves rather than
guessing.

**2. Build the day index once per render.** One `Map<dayKey, RowData[]>` pass over
`getViewRows`, then O(1) lookup per cell. A `filter()` inside each cell is O(days ×
rows) — tolerable at 42 cells, not at 365.

**3. Year view is a density grid.** No field text, no per-cell content: 365 cells of
labels is neither readable nor fast. A dot or a ring colour per day; clicking opens
the record. Field summaries belong to week and month.

**4. Opening a freshly created record needs the id, not a re-read.** `addRow` returns
the new id; pass it straight to the panel. A delayed open loses a race with the
editor's "close the panel if the record disappeared" effect.

**5. Week start is a single constant, Sunday.** `WEEK_STARTS_ON` replaces the former
`weekStartsOnFor(language)`, which returned Monday for Chinese and Sunday otherwise.
The week, month and year grids must agree with each other and with the weekday
headers, and Chinese conventionally starting on Monday is not worth their disagreeing.
Sunday is the one the English UI already used. It is a constant rather than a lookup
because the choice is a decision, not a per-locale rule — and because the year grid
previously hardcoded Monday, which is exactly the drift a single definition prevents.
The primitives (`startOfWeek`, `weekDays`, `monthGridDays`, `weekdayNames`) still take
the value as a parameter, so they remain testable against both conventions.

**6. Editing `calendarProp` is a normal view setting**, and a property list of the
wrong type must not be offered (the same filter `canGroupByProperty` does for boards).

---

## 8. Naming and i18n

`Journal` / 手帐. **Version: `0.19.0 → 0.20.0`** (a minor bump for a new layout;
no document migration is needed). Keys follow the existing `db_*` convention, with an
empty state for the no-date-column case, week/month/year labels, and the checklist
and warning strings. `DEFAULT_VIEW_NAME` gains `journal: "Journal"` — which
automatically participates in the existing "rename only while `nameIsDefault`" rule,
so `Table` becomes `Journal` and a user-chosen name is left alone.

---

## 9. The guard test

`journalSchemaWrites.test.ts` pins §6's rule as a **source-text guard**, following
`dragDropTargets.test.ts` and `muiOverlayAnchors.test.ts`: the failure it covers is
silent at runtime.

| Check | The silent failure it prevents |
|---|---|
| No renderer (`JournalView` / `cards` / `CompletionRing`) calls a schema-writing method | A view that creates the column — for every collaborator, per render |
| The editor calls no schema writer inside `useMemo` / `useEffect` / `useCallback` | A "helpful" memo that adds the column to every client that merely *displays* the view |
| The guard found the creator and the hooks | A rename turning it into a test that asserts nothing |

It deliberately allows row writers (`addRow`) in views — clicking a day creates a
record, which is the feature. The rule is about **columns**, not rows. Verified by
injecting a schema write into a `useMemo`: the guard fails with *"useMemo writes the
schema (addProperty); it would run for every viewer"*.

---

## 10. Phases and status

**All three phases are implemented.**

**Phase 1 — the view.** `dayKeyOf` + `defaultCalendarProperty` (pure, tested, run
under UTC / Asia_Shanghai / America_New_York) · the `DatePickerDialog` local-time fix
with `localDate.ts` · shared card rendering in `cards.tsx` (extracted from
`BoardView`) · `JournalView` with week/month · click-to-create/open · field summaries
· field visibility · empty state · wiring (layout union, default name, dispatch,
i18n) · year density grid (15px cells; 365 visible in 2026).

**Phase 2 — the checklist.** `CompletionRing` with the `done/total` label and a
colour ramp · the `checklistProp` setting · completion colours in the year grid.

**Phase 3 — recovery.** `deleteProperty` sweeps both new fields; the resolver tolerates
a dangling id; a journal with no date column offers to create one from the view (same
single creation site, still a user action). Drag-a-record-to-another-day is **not**
done — it is the one deferred item.

### Verified in the browser

Against a real document on the dev server: switching to Journal created the column
and explained it; clicking day 15 created a record on `2026-09-15` and opened the
panel; clicking it again opened the **same** record (row count stayed 1); clicking an
empty day created exactly one more; week, month and year all render; the checklist
setting offered only multi-select columns; ticking two of three habits showed `0/3`
and `2/3`; state survived a reload; and deleting the column while the journal was open
produced the prompt, whose button re-created it.

Also verified at `390x844` (mobile emulation, `isMobile` + touch), which is where the
first cut was unusable — see below.

---

## 11. Phones

The first cut rendered at desktop proportions and was unusable at 390px: a 7-column
week of **47px columns**, a month whose field text wrapped into vertical slivers, a
period label that wrapped to three lines, and a record panel whose 150px label left
~200px for the editor.

The rule that resolved it: **a view may change shape on a narrow screen, but must not
disagree about its content.** No compact mode filters, sorts or hides records
differently — the same rows, the same day buckets, the same ring values. Only the
arrangement and the amount of text differ.

| Scale | ≥ `sm` | < `sm` |
|---|---|---|
| Month | 7×N cells, day + title + up to 2 fields | Same grid, **day + indicator dot or ring**; no field text |
| Week | 7 columns of record cards | **7 full-width rows** — a vertical list with a date gutter |
| Year | 15px density squares | Unchanged (already fixed-size) |
| Toolbar | One row | Two: controls, then the period label on its own line |

### Why the week rotates instead of scrolling

Seven 47px columns cannot show a record, and a horizontally scrolling week hides five
of seven days behind a gesture. A vertical list shows all seven at once, keeps the
date as a left gutter for scanning, and gives each record the full width — which is
the same information the desktop columns carry, laid along the axis that has room.

### The calendar column is ranked, not excluded

A cell has a truncation limit, so **which property comes last is which one is
dropped**. The journal's calendar column is the one value the cell already states — it
is the axis the record was placed on — so `rankJournalDetails` moves it to the end.

This is deliberately *not* an exclusion. `visibleProps` is the only authority on what
a view shows, so a user who turns the date column on still sees it whenever there is
room; it simply loses to `Status` and `Notes` when there is not. Excluding it
outright would make that impossible, and (measured) a redundant date would otherwise
displace a real field in a two-slot cell. Covered by 7 tests, including both halves:
the date loses when better fields are present, and is still shown when they are not.

The board does not do this: its grouping column *is* shown, because which option put a
card in that column is real information about the record, not a restatement of where
the cell sits.

### Also fixed

The record panel stacks its label above the field below `sm`; the expanded cell
editors no longer render their own `label` (the panel already prints the property name,
and an outlined `TextField` repeated it inside the border); the month uses narrow
weekday initials (`S M T W T F S`) rather than three letters; and the year grid's
week start is now passed in from the parent instead of hardcoded to Monday, which had
put its twelve mini-calendars one column out of step with the month view under the
English (Sunday-first) convention. See §7 item 5 for why the convention itself is now
a single constant.

### Open risks

- **Habit tracking is sparse by nature.** One record per day means a habit column
yields ~12 filled cells a month, which looks empty even when it is being used
correctly. If this becomes the main complaint, the fix is a per-day derived density
display, not a change to the record model.
- **No row ceiling / no virtualization** (inherited from the database type). A
month grid over a very large table is still a full read per revision.
- **A record with no date is invisible here.** It belongs to no cell, so the **New
record** button always adds an undated row for the table to show — which is also the
way to notice one.
