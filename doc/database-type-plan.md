# Database Document Type — Feature Plan

A new document type that brings Notion-style databases to Memorains: a set of
**properties** (columns), a list of **rows** (each row is a full page with its own
content), and one or more **views** (table / board / list) that project the same
rows through different filters, sorts and groupings.

**Explicitly out of scope for this plan: cross-document relations/rollups.**
See §11 for why, and what a later phase would need.

---

## 1. Goals & Non-Goals

### Goals

Status is marked per item: **done**, *partly*, or **pending**.

- A self-contained, offline-capable database document type that syncs through the
  existing Yjs pipeline with **zero server-side changes**. **Done** — the only
  server change is the synced `DocType` enum value, which has no behaviour.
- Column types: `title`, `text`, `number`, `select`, `multi-select`, `date`,
  `checkbox`, `url`, `email`, `phone`. **Done** — all ten. (`status` was an eleventh
  and was **removed**; see §9, "Why `status` was removed".)
- Views: **table**, **list** and **board**. **Done** — three layouts, switchable per
  view, all rendering the same rows through `getViewRows()`.
- Per-view settings: property visibility, filter, sort, group, layout. **Done** —
  all five, stored on the view and shared with collaborators.
- Every row opens in a record panel where all its properties can be edited, using
  the same components the table uses inline. **Done.**
- Concurrent-safe: two collaborators editing schema, rows or view settings
  simultaneously must converge without data loss. **Done**, both for the model
  (tests against two `Y.Doc`s) and **in two live browser sessions**, which were run
  by hand in Phase 2's follow-up pass (§12).
- Column types hold data safely: `title`/`text` merge character-by-character so no
  edit is lost, while discrete types converge to a single value rather than
  concatenating into nonsense. **Done** — see §4.2.
- **Structure is editable by dragging**: rows and columns reorder in the table, rows
  in the list, and cards move between board columns. **Done** — see §6.5.
- Rows can be **duplicated**, placing the copy under the original. **Done.**
- A column's **options are editable**: rename, recolour, reorder and delete, from the
  column's own menu. **Done** — §4.2.1.

### Non-Goals (this plan)

- Cross-document `relation` / `rollup`.
- `formula` properties (deferred to a later phase; see §9).
- System-generated columns (`created_time`, `created_by`, `last_edited_*`).
  Deferred — CRDTs have no authoritative clock/identity for these; see §8.4.
- Calendar / timeline / gallery / chart views.
- Real-time per-cell presence (cell-level cursors).
- Server-side querying or indexing of database content.

---

## 2. Why This Fits the Current Architecture

Three properties of the existing codebase make this a client-only feature:

| Fact | Where | Consequence |
|---|---|---|
| The server relays Yjs binary updates without interpreting them | `server/src/imp/DocServerImp.ts` | All database semantics live client-side. No new HTTP endpoints, no DB schema change. |
| `doc_type` is stored verbatim and never validated | comment in `client/src/interface/DataEntity.ts` | Adding an enum value needs no server change or migration. |
| Doc types are auto-discovered from one folder | `client/src/doc-types/docTypeRegistry.ts` (`import.meta.glob("./plugins/*/index.ts")`) | Adding the type touches **no** router, menu, or list-view file. |

The closest existing template is `client/src/doc-types/plugins/todo/TodoListEditor.tsx`,
whose `TodoListYjsBinding` is already "a `Y.Array<Y.Map>` of rows". The database
type is a strict superset of that shape, plus a CRDT schema and view layer.

---

## 3. Scope of Change

All paths are under `client/`.

| File | Status | Role |
|---|---|---|
| `src/interface/DataEntity.ts` | changed | `DocType.database = 5` |
| `src/internationnalization/stringMap.ts` | changed | 93 new keys, `en` + `zh` |
| `src/components/CreateDoc.tsx` | changed | calls `resolveInitialState` so a type's initial content is stored at creation |
| `src/doc-types/pluginTypes.ts` | changed | new optional `DocTypePlugin.initialState`, plus `resolveInitialState` |
| `src/doc-types/plugins/database/types.ts` | new | shapes + constants; no Yjs import, so pure modules can use it |
| `src/doc-types/plugins/database/fractionalIndex.ts` | new | fixed-width base-62 order keys, splitting, rebalancing |
| `src/doc-types/plugins/database/textDiff.ts` | new | minimal-splice writes to `Y.Text` cells |
| `src/doc-types/plugins/database/retype.ts` | new | value conversion rules for a type change |
| `src/doc-types/plugins/database/optionColors.ts` | new | option colour palette |
| `src/doc-types/plugins/database/filterSort.ts` | new | pure filter / sort / group evaluation |
| `src/doc-types/plugins/database/reorder.ts` | new | pure drag-and-drop arithmetic (where a dropped item lands) |
| `src/doc-types/plugins/database/exporters.ts` | new | Markdown + CSV projections |
| `src/doc-types/plugins/database/model.ts` | new | `DatabaseBinding` — all CRDT reads/writes |
| `src/doc-types/plugins/database/propertyTypes.ts` | new | property-type registry (labels, icons, capabilities) |
| `src/doc-types/plugins/database/CellEditor.tsx` | new | dispatches to one editor per type |
| `src/doc-types/plugins/database/cells.tsx` | new | the cell editors + read-only rendering |
| `src/doc-types/plugins/database/TableView.tsx` | new | table view, column menus, retype dialog, row/column drag |
| `src/doc-types/plugins/database/ListView.tsx` | new | list view, row drag |
| `src/doc-types/plugins/database/BoardView.tsx` | new | board view, drag between columns |
| `src/doc-types/plugins/database/ViewSettings.tsx` | new | filter / sort / column / group-by UI |
| `src/doc-types/plugins/database/OptionsEditor.tsx` | new | options dialog, opened from a column's menu |
| `src/doc-types/plugins/database/RecordPanel.tsx` | new | record edit panel (shared editing surface) |
| `src/doc-types/plugins/database/DatabaseEditor.tsx` | new | editor shell: binding lifecycle, view tabs, layout switch |
| `src/doc-types/plugins/database/index.ts` | new | plugin descriptor, `initialState`, CSV menu item |
| `src/doc-types/plugins/database/*.test.ts` | new | 8 test files |
| `src/dragDropTargets.test.ts` | new | source guard: drag sources must accept the drop |
| `src/doc-types/pluginTypes.test.ts` | new | 4 tests for `resolveInitialState` |
| `vitest.config.ts` | new | test config (node env, no DOM) |
| `package.json` | changed | `test`/`test:watch` scripts, `vitest` devDependency, version → 0.19.0 |
| `server/**` | changed | **only** the synced `DocType` enum (no behaviour change) |

> `DocType` is shared with the server and `sync_interface.sh` copies **server →
> client**, so edit `server/src/interface/DataEntity.ts` first, then run the script.
> Editing the client copy and syncing silently reverts the change.
>
> `UserServerMessage.ts` is excluded from that script and must be synced by hand.

### Deviations from the original plan

| Planned | Actually built | Why |
|---|---|---|
| `markdown.ts` | built as `exporters.ts` | Holds Markdown **and** CSV |
| `views/*.tsx` folder | `TableView.tsx` / `ListView.tsx` / `BoardView.tsx` at the plugin root | One folder was not worth it for three siblings, and they share the plugin's own modules |
| lazy `body` on each row | **dropped** | A `text` column does the same job while being a real column (sortable, filterable, many per table). A reserved `body` key is one untyped slot that can be none of those |
| variable-length fractional indexing | **rebuilt as fixed-width** | The first implementation failed its own tests and could not be made obviously correct — see §8.2 |
| filters stored as a nested `Y.Map` | plain object on the view | A filter is edited as a unit; merging halves of two different trees would produce something neither person built |
| "rebalance is rare, possibly never" | **required**, ~1 per 2 000–20 000 drags | Measured; see §8.2 |
| 10 000-row ceiling | **not implemented** | See "Known gaps" below |
| `moveRow(id, index)` called by the drag UI | `moveRowBefore(id, anchorId)`, plus a pure `computeMoveAnchor` | A view's drop target is a neighbour, not an index into a list with the dragged item removed; see §8.6 |
| drag-and-drop via a library | native HTML5 drag events | Consistent with the decision not to add `@mui/x-*`; costs the guard in §6.5 and mouse-only support |

### Known gaps

- **No row ceiling.** The plan called for validating against a row limit; only the
  measurement behind it was done. `NoteDocument` re-encodes the whole document every
  5 s and the server every ~30 s, so cost grows with total rows: ~12 ms/save at
  5 000 rows, ~29 ms at 10 000. Every row is also rendered as DOM — there is no
  virtualization, pagination or windowing anywhere, which is the first limit a
  large table will hit. A soft row limit is still worth adding.
- **`formula` and cross-document `relation` / `rollup`** are not implemented (§11).
- **Filter nesting is capped in the UI at one level.** The evaluator handles
  `MAX_FILTER_DEPTH` (3) and a hand-written or remotely-created tree of that depth
  works, but the editor only exposes a flat AND/OR list. A nested filter loaded in
  the UI shows a note rather than an editable tree.
- **No aggregation row.** Sum / average / count per column is not built.
- **`created_time` / `created_by` / `last_edited_*`** are deliberately absent (§8.4).
- **A list can only reorder against the manual order, or a single option sort.** A
  list sorted by two rules, or by a text/number column, hides its drag handle: a drop
  could not control the visible order, and silently doing nothing is worse than not
  offering it. The table has no such limit — its `order` key is always the axis.

---

## 4. Data Model (Yjs)

All state lives under **new top-level keys** in the document's `Y.Doc`, so it
never collides with `quill`, `todolist_items`, `chat_messages`,
`excalidraw_elements`, or `editor_meta`.

```
yDoc
├── db_schema   Y.Map<propId, Y.Map>    property definitions   (shared)
├── db_views    Y.Map<viewId, Y.Map>    view definitions       (shared)
└── db_rows     Y.Array<Y.Map>          rows                   (shared)
```

### 4.1 Property definition (`db_schema`)

```ts
// key = propId, a stable uuid — NEVER the display name
{
  id: string;              // uuid, equals the Y.Map key; used for all references
  name: string;            // display name, freely renameable
  type: PropType;          // "title" | "text" | "number" | "select" | ...
  order: string;           // fractional index, defines column order
  options?: Y.Map<optId, Y.Map>;  // select / multi-select only
}

// option entry (key = optId, a stable uuid)
{
  id: string;
  name: string;
  color: string;           // "gray" | "brown" | ... | "default"
  order: string;           // fractional index — also defines sort order of the option
}
```

**Rule: `propId` (not `name`) is the key and the reference target used everywhere**
— values in rows, view visibility lists, filters, sorts. This is the same choice
Notion makes (a property's ID is stable across renames), and it is the single most
important decision in this schema:

- If a property name were the `Y.Map` key, two collaborators renaming the same
  property concurrently would create **two** keys and silently split the column in
  two.
- With stable IDs, concurrent renames just converge on one of the two names and
  the data stays intact.

There must be **exactly one** property with `type: "title"`. It cannot be deleted
or retyped, and it is created together with the database.

### 4.2 Row (`db_rows`)

`db_rows` is a **`Y.Map<rowId, Y.Map>`**, keyed by row ID.

> **Why not `Y.Array`?** Order comes from the row's own `order` field (§8.2), so
> array position carries no information — but it does carry a hazard: deleting a
> row means `findIndex` + `delete(index, 1)`, and that index is only valid
> *synchronously*. Any `await` in between (a confirm dialog, a decryption prompt)
> lets a remote update land and shift the index, deleting the wrong row. `Y.Map`
> deletes by ID and makes the bug impossible. (`TodoListEditor` is not affected
> only because its `findIndex` and `delete` happen in one synchronous block.)

```ts
// Y.Map value, key = rowId
{
  id: string;              // uuid, equals the key; stable for the row's lifetime
  order: string;           // fractional index — see §8.2
  "p:<propId>": unknown;   // one entry per property; absent = empty
  "p:<propId>:<optId>": true;  // one key per selected option, multi-select only
}
```

There is **no `body` key.** An earlier draft reserved a lazy `Y.Text` per row for
long-form page content, and it was dropped:

- A `text` column does the same job while being a genuine column — sortable,
  filterable, renamable, and many per table. A reserved `body` key is one untyped
  slot that can be none of those.
- It cost storage for a feature most rows never use. An empty `Y.Text` still
  occupies a nested shared-type entry per row: eagerly attaching one to 5 000 rows
  measured ~1.75 MB, against low hundreds of KB without.
- Adding it later is purely additive (it is just another key on the row), so
  deferring costs nothing.

If rows-as-pages is wanted, the cleaner route is to let `text` columns upgrade to
rich text over the same `Y.Text` (§4.2's storage policy), rather than reintroduce a
special case.

Property values by type:

| `PropType` | Stored value |
|---|---|
| `title` | `string` |
| `text` | `string` |
| `number` | `number` |
| `checkbox` | `boolean` |
| `url` / `email` / `phone` | `string` |
| `select` | `optId` (string) or absent |
| `multi-select` | one row key per option: `p:<propId>:<optId> = true` |
| `date` | `{ start: string; end?: string; includeTime?: boolean }` (ISO strings) |

**`multi-select` is one row key per option, not a nested container.** A nested
`Y.Map` of option IDs is the obvious design and it is wrong: when two peers
concurrently *create* a nested shared type at the same key — which is what happens
when both add the first tag to an empty cell while offline — one map wins and the
other's contents are discarded. Measured:

| Representation | Two peers each add a different tag to an empty cell |
|---|---|
| nested `Y.Map` | `["tag-a"]` — **one tag lost** |
| nested `Y.Map`, pre-existing | `["tag-a","tag-b"]` |
| one row key per option | `["tag-a","tag-b"]` |

A nested shared type only merges if both peers already have it. Disjoint keys have
no such precondition, so this is the same fix as row ordering: separate keys
instead of a shared mutable container.

**Absent means empty.** Partially-filled rows are normal — a row with no `score`
and no `note` is not an error state. Every read site must handle `undefined`
rather than assume a value exists, and `is_empty` / `is_not_empty` are first-class
filter operators rather than edge cases.

### 4.2.1 Editing a column's options

Options are the **schema** of a `select` / `multi-select` column: the column's
meaning lives in its option list, not in its name. So they belong in the column's own
menu, beside rename and retype, not only in the cell picker.

`OptionsEditor.tsx` is one dialog for both types, because they store options
identically.

| Control | Effect |
|---|---|
| name (click the chip) | inline rename — a `set("name", …)` on the option's own map |
| colour swatch (click it) | palette picker, one click, written immediately. An icon-triggered menu, **not** a `Select` — see below |
| drag grip | reorders the option, which is the order of the picker, of a board's columns, and of a `select` column's sort |
| delete | confirm first, then clears the option from every row |
| new-option field | creates one, cycling the palette so a fresh list is not one grey block |

Every edit writes straight through the binding rather than accumulating a draft, so
collaborators see each change as it is made and there is no dialog state to lose.
The retype dialog is still the only place with a blocking confirm, and only because
it can destroy data.

One rule the editor enforces, learned the hard way:

- **A renamed option keeps its rows.** Values hold `optId`s, so a rename is a `set` on
  the option's own map — never a delete + re-add under a new key, which would detach
  every row that used it.

#### The colour control is not a `Select`

A `Select` is a *text field*: it always renders a dropdown chevron. In a 26px-wide box
that chevron lands **on top of** the 14px swatch and slices a visible wedge out of the
circle, which is what "the colour button renders strangely" looked like. Nothing here
is text, so nothing needs an arrow: the swatch is the entire control, and the palette
is an icon-triggered `Menu` anchored to it.

The general rule, and the third time this dialog has taught it: pick the component
whose *shape* matches the data. A `Select` for a "one of N" choice is right when the
choice has a text label (the grouping-column picker keeps its `Select`); a swatch with no
text is not that.

#### Options were model-complete but unreachable

Worth recording, because it is the same failure mode as the `visibleProps` bug in
phase 2: **the model was finished and tested while no UI called it.**
`renameOption`, `setOptionColor`, `deleteOption`, `setOptionGroup` and `setGroups`
were all written in phase 1 with unit tests, and the only option interaction a user
could reach was *creating* one from the cell picker. The phase 1 checklist above
claimed "shared option editor: create / rename / recolour inline", which was true of
the code and false of the product.

The generalisation: a green test on a `DatabaseBinding` method only says the CRDT
write is right. It says nothing about whether a user can perform it. When a checklist
item says "editable", check for the call site.

### 4.3 View definition (`db_views`) — as built

```ts
// key = viewId, a stable uuid
{
  id: string;
  name: string;
  nameIsDefault?: boolean;   // see "view naming" below
  layout: "table" | "list" | "board";
  order: string;             // order key over view tabs

  visibleProps: string[];    // propIds; EMPTY MEANS ALL
  filter?: FilterNode;       // plain object, see §4.4
  sorts?: SortRule[];        // [{ propId, direction: "asc" | "desc" }], applied in order
  groupBy?: string;          // propId; a board requires this
  hideEmptyGroups?: boolean; // board only
}
```

These are **shared** settings, synchronized to all collaborators (§4.5).

Two decisions inside this shape are worth stating, because the obvious alternative
is wrong:

**`visibleProps` is a plain array, and empty means "all".** A plain array is
last-write-wins, which is correct here: hiding a column is not a change that two
people can meaningfully make simultaneously in different ways. Reading an empty list
as "all" means a brand-new view needs no initialisation, at the cost that *hiding*
must first materialise the list — done in `toggleViewProperty` and in the settings
panel, so the "hide one, see all the others reappear" bug cannot occur.

**`filter` and `sorts` are whole values, not mergeable structures.** A filter tree
is edited as a unit. If it were a nested `Y.Map`, two people editing different
conditions concurrently would merge into a tree neither of them built — `age > 30`
ANDed with `age < 20` is not a useful resolution. Wholesale replacement means one
edit wins, which is what the user expects.

#### View naming

`nameIsDefault` marks a name the app chose rather than one the user typed. It exists
because the stored name is localised by whichever client created the view — a view
made in Chinese is called 列表, not "List" — so comparing against an English default
to decide "has the user named this yet?" fails. With the flag the intent is
unambiguous, and `setViewLayout` can rename a view (`List` → `Board`) while leaving a
user-chosen name alone. Default names are also made unique, since three tabs all
called "List" cannot be told apart.

### 4.4 Filter shape — as built

Filter groups are recursive with explicit `AND`/`OR`, capped at
**`MAX_FILTER_DEPTH` = 3** to bound both the UI and the recursive evaluation:

```ts
type FilterGroup = {
  kind: "group";
  op: "and" | "or";
  children: FilterNode[];
};

type FilterCondition = {
  kind: "condition";
  propId: string;
  operator: FilterOperator;   // validated against the property type
  value?: unknown;            // unused for is_empty / is_not_empty
};

type FilterNode = FilterGroup | FilterCondition;
```

Operators per type, as declared in `OPERATORS_BY_TYPE`:

| Type | Operators |
|---|---|
| title / text / url / email / phone | `contains`, `does_not_contain`, `is`, `is_not`, `is_empty`, `is_not_empty` |
| number | `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `is_empty`, `is_not_empty` |
| select | `is`, `is_not`, `is_empty`, `is_not_empty` |
| multi-select | `contains`, `does_not_contain`, `is_empty`, `is_not_empty` |
| date | `is`, `is_before`, `is_after`, `is_on_or_before`, `is_on_or_after`, `is_empty`, `is_not_empty` |
| checkbox | `is`, `is_empty`, `is_not_empty` |

`checkbox` gets the emptiness operators because it is **tri-state**: true, false, or
untouched. An unset box is deliberately not the same as false, so "unset" is worth
filtering by.

#### Rules the evaluator guarantees

- **No view may be misled by an incomplete condition.** A `contains` with an empty
  search string matches everything. While the user is typing into the filter's value
  box the view must keep showing rows, not blank out.
- **Emptiness is a first-class concept.** Absent, `null` and `""` are one thing;
  `0` and `false` are values. An empty cell never satisfies a comparison — a blank is
  not "less than 5".
- **A condition referencing a deleted property keeps the row.** Treating a dangling
  reference as "no match" would hide every row after a column was deleted, which
  reads as data loss.
- **Empty values sort last in both directions.** Ascending order putting blanks first
  would bury the rows that have data.
- **Ties break on the row's `order` key**, so rows do not shuffle between renders.

#### The value-shape trap

`DatabaseBinding.getRows()` returns a **`Y.Text` object** in `values[propId]` for
`title` and `text` columns, not a string — the binding hands back the live document
object so the editor can splice into it. Comparing that to a search string never
matches, so `normalizeCell` converts first and every function in `filterSort.ts`
works on plain values. A test covers this explicitly.

`filterSort.ts` is a set of **pure functions** with no React and no `Y.Doc`
dependency, so all 67 of its tests run without a DOM.

### 4.5 Shared vs personal settings — as built

The plan proposed splitting view settings into a shared bucket and a personal one.
**Only the shared bucket was built.** Every view setting — layout, visible columns,
filter, sorts, grouping — lives in the `Y.Doc` and is seen by all collaborators, as
is the currently open view.

| Setting | Storage | Status |
|---|---|---|
| Schema, rows, property values | `Y.Doc` | built |
| View name, layout, filter, sorts, group-by, visible columns | `Y.Doc` (`db_views`) | built |
| **Which view is open** | `Y.Doc` (`db_meta.activeViewId`) | built — **deliberately shared**, see below |
| Personal-only filter/sort, column widths, row height | not implemented | no personal bucket exists |

#### Why the open view is shared rather than personal

The plan originally suggested `localStorage` here, on the grounds that one user's
tabbing should not drag another's. That was reversed deliberately: switching tabs in
a shared document reads as *"let's look at this"* — closer to moving a shared cursor
than to a private scroll position, and it means a collaborator can point at a view.
It also makes the current view consistent with everything else on the screen, which
is all shared.

Two guards make it safe:

- It is stored in **`db_meta`, a separate top-level key**, not inside `db_views`.
  That map is iterated wholesale to build the tab list, so a non-view key in it would
  render as a bogus tab.
- A stored id that no longer names a view (deleted by anyone, including a client that
  had not yet seen the deletion) **falls back to the first view** rather than
  dangling, and `deleteView` repoints the selection in the same transaction so no
  collaborator can observe a broken pointer.

No personal bucket exists, so per-user column widths and per-user filters remain
open (§10).

## 5. Property Type Registry

Each property type's label, icon, colour and hints are declared **once**, so no view
contains a `switch (propType)`:

```ts
// propertyTypes.ts — as built
export interface PropertyTypeMeta {
  type: PropType;
  labelKey: I18nKey;
  Icon: IconComponent;
  color: string;
  hintKey: I18nKey;   // one-line description for the type picker
}

export const PROPERTY_TYPES: readonly PropType[];          // picker order
export const CREATABLE_PROPERTY_TYPES: readonly PropType[]; // excludes `title`
export function getPropertyTypeMeta(type: PropType): PropertyTypeMeta;
export function propertyTypeLabel(type: PropType): string;
export function isOrderedType(type: PropType): boolean;   // number | date
export function isMergeableTextType(type: PropType): boolean; // title | text
export function canGroupByProperty(p: PropertyDef): boolean;
export function operatorNeedsValue(operator: string): boolean;
```

`getPropertyTypeMeta` falls back to `text` for an unknown type, the same defensive
posture as `getDocTypePlugin` returning `undefined` for an unknown document type —
so a document written by a newer client stays editable as plain text instead of
showing a cell the user cannot fix.

### Why the registry is metadata-only

The planned version above also carried `parse`, `format`, `Editor`, `operators` and
`compare`. That would have made this module import React components, which means:

- pure code (filters, exporters) could no longer use the registry without dragging
  in the component tree, and
- it could not be tested in the node environment `vitest` runs in.

So the split is: **metadata here, behaviour elsewhere.**

| Concern | Lives in |
|---|---|
| Labels, icons, colours, capabilities | `propertyTypes.ts` (no React) |
| Value conversion on a type change | `retype.ts` (pure, tested) |
| Read-only rendering, one editor per type | `cells.tsx` + `CellEditor.tsx` |
| Option colours | `optionColors.ts` (pure) |
| Editing a column's options | `OptionsEditor.tsx` |

`CellEditor.tsx` is the single dispatcher, and both the table and the record panel
render it — so there is one implementation per type and no per-view variation.

Filter operators and `compare` are not declared per type yet because filtering is
Phase 2; `isOrderedType` already answers the one question a sort UI will ask.

---

## 6. Views

**Every view renders the same rows from the same two methods**, so table, list and
board cannot disagree about which records a view shows:

```
db_rows ──► binding.getRows()          sorted by each row's `order` key
                     │
                     ▼
            binding.getViewRows(viewId)     filter ──► sort      (per-view settings)
                     │
                     ├──► TableView
                     ├──► ListView
                     └──► binding.getViewGroups(viewId) ──► BoardView
```

A view never filters or sorts for itself. `getViewRows` reads the view's own `filter`
and `sorts`, so a filtered board shows exactly the rows a filtered table would — which
is what a user expects when they add a filter and then switch layout.

Views re-read through the binding on a coalesced animation frame after any document
change, rather than caching rows. That keeps them correct by construction; the cost
is measured and small (2.5 ms to read 5 000 rows), and caching is only worth adding
alongside virtualization.

### 6.1 Table

- Rows = records, columns = the view's **visible** properties, in `order`.
- Header cells: type icon, name, and a menu with **rename**, **change type** (with a
  preview of what the change would clear), and **delete**. A `title` column cannot be
  renamed, retyped or deleted.
- Cells edit **in place** via the shared `CellEditor`. `checkbox`, `select`,
  `multi-select` and `date` commit on direct interaction; `text`, `number`
  and the string types enter edit mode on click and commit on blur.
- Every row's first cell carries the **open record** affordance, so the panel is
  reachable from any row — including an empty one. Double-clicking a cell also opens
  the panel.
- `+` at the right edge adds a column; **New record** adds a row.
- A column's **grip** (left of its icon) drags it to a new position, and each row's
  **grip** (on the handle cell, appearing on hover) drags the row (§6.5). Dropping on
  the trailing "add column" cell moves a column to the end.
- Row actions are **duplicate** and **delete**. Duplicating places the copy directly
  under the source with the same values.

Not built, and why:

| Missing | Note |
|---|---|
| Insert left-right / hide-from-here | Rename, retype, delete, reorder and the settings panel cover the common cases |
| Column widths | Would be **personal** (localStorage); no personal bucket exists (§4.5) |
| Aggregation row | Phase 3 |

Implementation note: MUI's core `Table` primitives. No `@mui/x-*` dependency was
added, as planned.

### 6.2 Board

One column per option of a **`select`** property, in the
**option order the user arranged** — not alphabetical, which would be arbitrary — so
columns stay put as cards move between them.

- `multi-select` is **not groupable**. A board column is "the rows whose value is
  this option", which only holds when a row belongs to exactly one option: a row with
  two tags would appear in two columns at once, and a drop would mean "add" in one
  column and "replace" in another. Enforced in three places — the grouping picker
  offers `select` only (`canGroupByProperty`), the setter refuses anything else
  (`setViewGroupBy`), and the reader returns no groups for a value that cannot group
  (`getViewGroups`, which tolerates a `multi-select` written by an older client).
- A row with no value lands in a trailing **"No value"** bucket instead of vanishing.
- Dropping a card writes **one field on one row** — the same single-field write as any
  cell edit, so a concurrent move needs no special handling: two people moving
  different cards touch disjoint fields, and two moving the same card converge on one
  of the two columns.
- **Hide empty groups** is a per-view setting.
- Card drag now sets a `dataTransfer` payload, without which Firefox and Safari
  refuse to start the drag at all — see §6.5 and the guard in §12.
- The toolbar's add button creates a row **already in that column**, which is what
  clicking "+" in a specific column means.
- The view needs a group-by column and **says so** rather than rendering nothing,
  since a board is meaningless without one.

`groupBy` is filtered to groupable properties in the settings UI
(`canGroupByProperty`), and if the grouping column is deleted the view's `groupBy` is
cleared rather than left dangling.

### 6.3 List

Minimal vertical list: each line shows the title plus up to three secondary
properties. Select-family values render as coloured chips, since colour is the
fastest way to scan a list. Values render through the same `CellDisplay` the table
uses, so a value looks identical in both views. Clicking a line opens the record
panel, and a line's grip drags it (§6.5).

### 6.4 View settings UI

A chip pair plus a columns chip in the view toolbar, next to the tabs:

| Control | Shows |
|---|---|
| Filter chip | A count badge when any condition is active |
| Sort chip | A count badge when any sort is active |
| Columns chip | Column visibility, group-by, and hide-empty-groups |
| **Clear** | Appears only when a filter or sort is active; removes both |

The badges matter: a filtered view with no visible indication is a common source of
*"where did my rows go"*. The Clear button makes the state recoverable in one click.

### 6.5 Dragging: rows, columns and cards

Three drag interactions, all built on the browser's native HTML5 drag events — no
`@dnd-kit` or `react-dnd` was added, matching the decision not to add `@mui/x-*`.

| Where | Drag | Effect |
|---|---|---|
| Table header | a column's grip | reorders the column (`movePropertyBefore`) |
| Table / list row | the row's grip, on hover | reorders the row (`moveRowBefore`) |
| Board card | the card | writes the option onto the row (already existed) |
| List row, with an option sort | the row's grip | writes the sorted property, so a drop changes the value |

#### One anchor rule, not per-edge arithmetic

Every drop resolves to the same shape: **the item to place the dragged one
immediately before, or `null` for the end**. The front is "before the first item", so
one nullable neighbour covers every position and no view does index arithmetic
against a list with the dragged item removed — which is exactly where an off-by-one
would live.

The arithmetic itself is a pure function, `computeMoveAnchor` in `reorder.ts`:

```ts
computeMoveAnchor(items, draggedId, overId, after)
// -> { beforeId, changed }  |  null when an id is gone
```

Two properties make it worth isolating and testing (18 tests, exhaustive over
item pairs and sides):

- **`changed` is exact.** A drag that resolves to where the item already is must not
  write an `order` key, because every write is a CRDT update broadcast to every
  collaborator. The no-op test is "remove and reinsert at the same index", which
  makes all three visually-identical drags — dropping on yourself, on the lower half
  of the item *above* you, on the upper half of the item *below* you — fall out of one
  comparison instead of three special cases.
- **Both ends are one value.** An earlier draft used `afterId: null` for the *front*,
  which collided with the model's `null` meaning the *end*. The failing test was the
  tell; switching to `beforeId` (the `insertBefore` idiom) removed the collision
  rather than documenting around it.

`isAfterMidpoint(rect, point, axis)` is the other half: which side of a box the
pointer is on decides "before" or "after", the rule a text cursor uses for which side
of a character it belongs to.

#### Why the list needs no extra UI

A row's own `order` key only decides the order when the view has **no sort** — a
sorted view re-derives the order on every render, so a drag would appear to do
nothing. Two honest options existed: hide the handle, or treat the sort as the axis.
The second is taken, but only where it can work:

| View's sorts | Drag behaviour | Handle |
|---|---|---|
| none | reorders the `order` key | shown |
| one rule, option list (`select` / `multi-select`) | writes the sorted property — the drop picks a bucket | shown |
| one rule, text / number / date | — | hidden |
| two or more rules | — | hidden |

Writing the sorted property on a drop is the *same single-field write* a board card
drop performs, so a list drag and a board drag cannot mean different things. Where a
drop could not control the visible order at all, the handle is hidden rather than
offering a gesture that silently does nothing.

#### Duplicate

`duplicateRow` copies every value and places the copy immediately after the original.
It reads through `getRows()` (plain values) rather than the source `Y.Map`, so text
cells become **fresh `Y.Text` instances**: two rows sharing one `Y.Text` object would
edit as a single cell, which is not what "duplicate" means. Date objects are
shallow-copied for the same reason. Row ids and `order` keys are freshly generated,
so the copy never collides with the original.

#### The silent failure mode, and its guard

HTML5 drag and drop fails **silently** in four ways, none of which throws, logs, or
fails to compile: a drop target without `preventDefault()` in `dragOver` never
receives `drop`; a `dragStart` that sets no `dataTransfer` payload is refused by
Firefox and Safari; a drag with no `dragEnd` leaves stale "is dragging" state; and a
drop target with no `onDrop` accomplishes nothing.

`src/dragDropTargets.test.ts` asserts these four invariants **on source text**, and a
second test asserts that it actually found drag sources, so a rename cannot make the
guard pass vacuously. Adding it immediately caught a real pre-existing bug:
`BoardView` started a card drag without calling `dataTransfer.setData`, so **the
board's drag-and-drop did not work in Firefox or Safari** while working perfectly in
Chromium.

## 7. Plugin Wiring

### 7.1 `index.ts` — as built

```ts
const databasePlugin: DocTypePlugin = {
  type: DocType.database,
  id: "database",          // URL segment → /database?docId=…
  order: 35,               // after mix(30), before todo(40)
  labelKey: "doc_type_database",
  createLabelKey: "new_database_button",
  color: "#00897b",
  buttonColor: "info",
  Icon: TableChartRoundedIcon,
  Editor: DatabaseEditor,
  creatable: true,
  // Seeded at creation, not when an editor opens: see `initialState` below.
  initialState: buildInitialDatabaseState,
  toMarkdown,
  menuItems: [exportCsvItem],
};
export default databasePlugin;
```

`Editor` must be a real component (not `null`) so `getRoutableDocTypePlugins()`
includes it and `index.tsx` auto-generates the `/database` route.

`order: 35` places the type after `mix` (30) and before `todo` (40) in the creation
menus.

#### `initialState` — the one addition to the plugin contract

This field did not exist in the original plan. It was added to fix a race that
produced **duplicate columns and views** (§9, "Phase 1 bugs"):

> `NoteDocument.init()` calls `editor.onInit()` — when an editor first sees the
> `Y.Doc` — **before** `initOfflineSaver()` loads the stored state. Seeding defaults
> at that moment writes them into an empty document, and the real state is then
> applied on top, so both survive. Deferring to "after load" does not help either: a
> document with no local copy loads empty and gets its content from the first sync.

Content that must exist before the first open therefore belongs at **creation**,
where there is no window for a client to invent it. `resolveInitialState` decides
which state to store, treating an **empty buffer as absent** — every caller passes a
state argument (the create dialog starts with `new ArrayBuffer(0)`), so checking
only for `null` silently skipped the plugin's content and created databases with no
columns at all.

The hook is generic, so any future type needing seeded content can use it.

### 7.2 List-view menu items

`docTypeRegistry.ts` automatically attaches the **"Export as Markdown"** item to any
plugin implementing `toMarkdown`, so the Markdown export needed no menu code.
**"Export as CSV"** is declared explicitly in `menuItems` because the registry only
derives the Markdown item. Both reuse the `DocMenuContext` contract
(`setBusy` / `refresh`) and the download helper in `client/src/doc-types/documentIo.ts`,
and both handle:

- rows contributed by other users that are not in the local IndexedDB copy,
- encrypted documents (`decodeLocalDocument` throws `Error("Canceled")` when the
  password prompt is dismissed — treat as a silent no-op, as `runExportMarkdown` does),
- empty databases (warning snackbar, no file).

### 7.3 i18n keys

**103 `db_*` keys exist**, each with `en` and `zh`. The list this section
originally sketched was indicative only; `stringMap.ts` is authoritative
(`grep -c '^  \["db_'` at the time of writing: 103).

`doc_type_database`, `new_database_button`,
`db_add_property`, `db_add_row`, `db_property_name`, `db_property_type`,
`db_delete_property`, `db_delete_row`, `db_confirm_delete_property`,
`db_confirm_delete_row`, `db_prop_title`, `db_prop_text`, `db_prop_number`,
`db_prop_select`, `db_prop_multi_select`, `db_prop_date`,
`db_prop_checkbox`, `db_prop_url`,
`db_view_table`, `db_view_board`, `db_view_list`, `db_new_view`, `db_rename_view`,
`db_delete_view`, `db_filter`, `db_sort`, `db_group`, `db_filter_and`,
`db_filter_or`, `db_add_filter`, `db_advanced_filter`, `db_visible_properties`,
`db_group_by`, `db_no_rows`, `db_no_results`, `db_select_option_placeholder`,
`db_export_csv`, `db_export_csv_empty`, `db_export_csv_success`, `db_export_csv_failed`.

> The 93 keys cover the per-type labels and hints, the cell editor strings, the
> retype dialog and its loss warning, the view/record-panel labels, and the drag
> tooltips (`db_drag_row`, `db_drag_column`). The list above is one phase behind and
> was never meant to be complete; `stringMap.ts` is the source of truth.

> `DocMenuItem.labelKey` is typed as `I18nKey`, so the export-CSV key must exist in
> `stringMap.ts` before the menu item compiles.

---

## 8. Correctness & Concurrency

This section is the reason the plan is worth reading before coding: four CRDT
pitfalls that are easy to ship broken.

### 8.1 Stable IDs for properties and options

Covered in §4.1. Applies equally to select options: **option values stored on rows
are `optId`s, not option names**, so renaming an option does not detach rows.
Renaming an option must be a `set("name", …)` on the option's `Y.Map`, never a
delete+re-add under a new key.

### 8.2 Row ordering — fixed-width order keys

`Y.Array` supports `insert`/`delete` but **no `move`**. Reordering is therefore
delete + insert, and Yjs merges *operations*, not *intentions* — so two peers
reordering concurrently do not produce one reorder. Verified against the
`yjs@13.6.21` pinned in `client/`, with two docs exchanging state vectors:

| Row representation | Concurrent "move x to end" from both peers | Result |
|---|---|---|
| Plain value (`{ ... }`) | `[x,y,z]` → `[y,z,x,x]` | **Row duplicated** — both inserts survive |
| `Y.Map` | throws `Cannot read properties of null` | **Crash** — a shared type already integrated into a doc cannot be re-integrated |

> An earlier draft of this document said the reorder is silently *dropped*. That is
> wrong. Depending on how a row is represented it is either **duplicated** or it
> **throws**. Since rows must be `Y.Map` (so per-cell edits merge independently),
> the realistic failure is the crash.

The fix is to order by an explicit key and never move a row:

- Each row carries an `order: string`, and all views sort by it. `db_rows` is
  therefore just a set of rows and equality is by row `id`.
- Reordering rewrites **only that row's** own `order` field. This is the key
  insight: it converts a *positional* conflict into two writes to *disjoint fields*,
  which a row-level `Y.Map` merges trivially. Verified: two peers concurrently
  moving different rows both keep their reorder, and no row is lost.
- Concurrently reordering the *same* row degrades to last-write-wins on that one
  field — no duplication, no crash.

#### Representation: fixed-width base-62 integers

```
order = exactly 10 base-62 characters, read as a big-endian integer in [0, 62^10)
```

Because every key has the **same length**, plain string comparison (`<`, `>`) is
exactly numeric comparison, so no parsing is needed on read paths.

**A variable-length scheme (the `fractional-indexing` style) was implemented first
and abandoned.** Its midpoint algorithm carries invariants that are easy to get
wrong — keys must not end in the zero digit, bounds must be normalised — and the
failure mode is silent corruption of ordering. The first implementation failed
several of its own tests and could not be made obviously correct, so it was
replaced with something that has no invariants at all: every fixed-width string is
a valid key, `int`/`key` are inverses by construction, and the whole thing is
exhaustively testable.

The cost is storage: ~10 bytes per row, so about 100 KB on a 10 000-row database.

#### Splitting capacity, and why rebalancing is mandatory

A gap of size N can absorb ~log₂(N) splits. The original plan guessed rebalancing
would be "rare, possibly never". **Measured, that is wrong:**

| Workload | Rebalances needed |
|---|---|
| 1 000 rows, 10 000 random drags | 1 |
| 5 000 rows, 20 000 random drags | 1 |
| One row dragged back to the same slot repeatedly | every ~19 drags |
| Splitting one full-space gap | exhausts after 44 splits |

So rebalancing is a rare **repair**, not part of the normal path — but it must
exist, because "rare" is not "never" and throwing on a user's drag is not
acceptable. Making keys wider does not help: 16- and 20-character keys were
measured and gave identical rebalance counts on realistic workloads, because
exhaustion depends on how many times a *single gap* is split, not on the size of the
space. `WIDTH = 10` is kept deliberately.

#### API

| Export | Purpose |
|---|---|
| `generateKeyBetween(a, b, random?)` | a key strictly between two neighbours; `null` means unbounded. Randomised inside the gap so two peers inserting at the same position do not tie |
| `keyAtEnd` / `keyAtStart` | append / prepend using a fixed `STEP`, so repeated inserts never shrink the available gap exponentially |
| `needsRebalance(before, after)` | whether a gap is too tight to split |
| `insertKey(keys, index, random?)` | **the entry point views use.** Returns the complete new key list, repairing the neighbourhood first if needed, so it never throws for a crowded gap |
| `planRebalance(keys, index, count)` | widens the window outwards until the span can hold the replacements |
| `changedKeys(keys, plan)` | which rows actually need writing |
| `isSortedByOrder` / `hasUniqueKeys` | invariants, used by `repairOrderIfNeeded()` on load |

#### Two rules that the API enforces

1. **`insertKey` returns the whole key list, not just the new key.** A rebalance
   changes the surrounding run as well, so a caller that spliced the new key in
   separately corrupted the array. Returning the full list makes that mistake
   impossible; `changedKeys` then reports only the rows whose key actually changed.

2. **A rebalance rewrites only the local run, never the whole table.** Each rewritten
   key is a CRDT write broadcast to every collaborator, so renumbering an entire
   large table would push a large update for what is usually a single row move.
   Verified by test: the replaced window stays within a few rows of the insertion
   point.

#### Two bugs found while testing this

- **`generateNKeysBetween` could return a key equal to its lower bound.** Integer
  floor division rounded to zero, producing **duplicate `order` keys** — two rows in
  the same position, nondeterministically. The fix is to divide the full span rather
  than a reduced numerator: with `span = hi - lo`, placing key *i* at
  `lo + floor(span * i / (count + 1))` keeps every key strictly inside.
- **Random key generation was capped at `Number.MAX_SAFE_INTEGER`**, so every
  unbounded insertion landed in the low end of the key space and had no room before
  it. Fixed by drawing two 32-bit values to cover the full range.
- **`changedKeys` mis-mapped originals when a rebalance straddled the insertion.**
  A plan's `keys` array holds the replacements *and* the new keys interleaved. The
  loop paired original `i` with `keys[i]`, which is correct only when the insertion
  is last in the window; otherwise an original was handed a different slot's key,
  and the key it should have kept was handed to the inserted item — **two rows at
  one position**. `RebalancePlan` now carries `insertOffset` and `insertCount`, and
  `changedKeys` skips the inserted entries. Found only because `duplicateRow`
  reuses the same rebalance path on a *crowded* gap, and its test asserted unique
  keys instead of merely "no more than `count` changes" — the weaker assertion the
  original `fractionalIndex` test had been making all along.

### 8.3 Deleting a property, view or row

`Y.Map` and `Y.Array` have no foreign keys, so referential hygiene is entirely our
responsibility. Every deletion therefore cleans up in **one transaction**, so no
collaborator can observe a half-deleted state.

- **Delete property**: remove it from `db_schema`, sweep its value from every row,
  and strip it from every view's `visibleProps`, `groupBy`, `sorts` and filter
  conditions. A stale reference left behind would be an inconsistent state that every
  read site would then have to defend against.
- **Delete view**: remove it from `db_views`. The **last view cannot be deleted** —
  there would be nothing to render. If the deleted view was the open one, the shared
  selection is repointed at a survivor in the same transaction.
- **Delete row**: remove it from `db_rows`. The record panel closes itself if its
  record disappears, whether deleted locally or remotely.

A property's *values* are deleted permanently, behind a confirm dialog naming the
column. There is no undo and no grace period: a "hidden for 30 days" scheme would
have to survive the deletion of the schema entry that gives the values meaning, which
is far more machinery than the case warrants.

The read paths do **not** trust this hygiene blindly. A filter or sort referencing a
property that is gone keeps its rows rather than hiding them (§4.4), which turns the
worst case from "looks like data loss" into "one stale condition is ignored".

### 8.4 Timestamps and identity

`created_time` / `created_by` / `last_edited_*` are **deferred** precisely because
in a CRDT there is no authoritative writer:

- Client clocks drift; `last_edited_time` would jump around as collaborators edit.
- `created_by` is derivable from the JWT user ID at insert time, but is then
  unverifiable and spoofable by any client.

If added later, they must be labelled as *advisory client-recorded values*, or be
derived at render time rather than stored. Do not silently present them as
trustworthy metadata.

### 8.5 Transaction discipline

Every mutation goes through `DatabaseBinding`'s single `transact()` helper, which
wraps `yDoc.transact(fn, DB_ORIGIN)` with `DB_ORIGIN = "database"`. Views never
touch the `Y.Doc` directly, so this rule cannot be forgotten at a call site.

Two reasons this matters beyond atomicity:

1. **The origin tag is load-bearing.** `NoteDocument` ignores Yjs updates whose
   origin is not the editor's `getOrigin()`. The plugin therefore sets
   `docInstance.editor.getOrigin = () => DB_ORIGIN` in the editor, exactly as
   `TodoListEditor` (`"todolist"`), `ChatEditor` (`"chateditor"`) and the canvas
   plugin do. **If the two strings disagree, every edit renders locally and is never
   sent to the server** — a failure that looks like flaky sync rather than a bug.

2. **Multi-structure edits stay atomic.** Adding a row sets its id, its order key
   and every initial value; deleting a property sweeps its values from every row
   *and* strips it from every view; a rebalance rewrites a run of keys. A peer must
   never observe half of one of these.

#### Re-render coalescing

`DatabaseBinding` observes `yDoc.on("update")` **without** filtering by origin, and
the editor coalesces the resulting notifications to one per animation frame:

```ts
const scheduleRevision = () => {
  if (pendingFrame.current !== null) return;      // already scheduled
  pendingFrame.current = requestAnimationFrame(() => {
    pendingFrame.current = null;
    setRevision((n) => n + 1);
  });
};
```

The alternative considered in the original plan — skipping self-triggered updates
via an origin check — was rejected because it is not needed and is easier to get
wrong. A single transaction emits *several* `update` events (one per changed key),
so without coalescing a row insert would trigger a full re-read of every row several
times. Re-reading on our own changes is harmless and keeps the invariant simple:
after any change, however it arrived, the views re-read.

A `revision` counter drives the re-reads; views memoise on `(binding, revision)`.

### 8.6 Reordering is addressed by neighbour, not by index

`moveRow` and `moveProperty` take a **target index**, and an index is measured against
the list *without* the item being moved. That is the correct primitive for the model —
it is what `insertKey` wants — but it is the wrong thing to hand a view. A drop target
is a neighbour the user pointed at, and turning "I dropped on row C" into an index in a
list with the dragged row removed is a place for off-by-one bugs to hide.

So the binding also exposes the neighbour form, and **that** is what the views call:

| Index form (what `moveProperty` / `moveRow` take) | Neighbour form (what a view calls) |
|---|---|
| `moveRow(rowId, targetIndex)` | `moveRowBefore(rowId, beforeRowId \| null)` |
| `moveProperty(propId, targetIndex)` | `movePropertyBefore(propId, beforePropId \| null)` |

`null` means the end of the list, and "before the first item" expresses the front, so
one nullable neighbour covers every position. The views never compute an index, and no
view can disagree with another about what a drop meant.

This is not academic: the first cut of the drag helper used `afterId` with `null`
meaning the **front**, while the model's `null` meant the **end**. Two model tests
failed on the disagreement, which is how it was caught — and the fix was to pick the
idiom that cannot collide (`before` / `insertBefore`, where `null` is unambiguously
"append") rather than to document the mismatch.

---

## 9. Phased Delivery

### Phase 1 — Model + table + list — **DONE**

**All basic property types shipped in Phase 1.** A database is only useful if it can
hold real data; deferring `select`/`date` would leave it unable to express an
ordinary table (`name | role | class | score | due`).

- [x] `DocType.database = 5`, interfaces synced (server → client)
- [x] `types.ts` — shapes and constants, importable without Yjs
- [x] `model.ts` — `DatabaseBinding`: property/row/view/option CRUD, ordering, repair
- [x] `fractionalIndex.ts` — fixed-width base-62 keys, split, rebalance
- [x] `propertyTypes.ts` with **all basic types**: `title`, `text`, `number`,
      `checkbox`, `url`, `email`, `phone`, `select`, `multi-select`, `date` (and, at
      the time, `status` — since removed, §9)
- [x] Option **creation** inline from the cell picker, for
      `select` / `multi-select`. *Rename / recolour / reorder / delete had no
      reachable UI until phase 2.5 — the model methods existed and were tested, but
      nothing called them. See "Options were model-complete but unreachable" below.*
- [x] ~~`status` progress groups as per-property data~~ — **removed**; see §9
- [x] Date cell editor reusing `DatePickerDialogService`
- [x] Retype with conversion rules and a "what will be lost" preview
- [x] `textDiff.ts` — minimal-splice `Y.Text` writes
- [x] vitest + **175 tests** across 7 files
- [x] `DatabaseEditor.tsx` — binding lifecycle, `getOrigin`, repair-on-load, view tabs
- [x] `TableView` — add/edit/delete rows, add/rename/delete/retype columns, inline cells
- [x] `ListView`
- [x] `RecordPanel` — the uniform editing surface, sharing the table's cell editors
- [x] `exporters.ts` + `toMarkdown` + CSV menu item
- [x] i18n keys (`en` + `zh`)
- [x] `client` version → 0.15.0
- [x] `lint` + `build` clean
- [x] Verified in the browser: schema creation, inline editing, option creation,
      the record panel, and theme switching
- [x] **Two-tab concurrent verification in the live UI** — deferred at the time and
      performed in the Phase 2.5 pass (§12)

### Phase 1 bugs found and fixed

Worth recording, because each was silent and each produced a regression test.

| Bug | Symptom | Cause | Fix |
|---|---|---|---|
| Duplicate schema | Two "Table" tabs, `Name`/`Notes` twice | The editor seeded defaults in `onInit`, which runs **before** `initOfflineSaver` loads stored state, so both survived | Seed at document creation via `DocTypePlugin.initialState` |
| Initial content skipped | New databases opened with **no columns** | The create dialog always passes a state argument (`new ArrayBuffer(0)`), so checking only for `null` skipped the plugin hook | `resolveInitialState` treats an empty buffer as absent (pure + tested) |
| Nested `Y.Map` lost data | Adding a tag to an empty cell from two peers kept only one | A nested shared type only merges if both peers already have it; concurrent creation discards one | One row key per option |
| Rebalance produced duplicates | Two rows shared an `order` key | `generateNKeysBetween` used integer floor division and could return its own lower bound | Divide the full span, not a reduced numerator |
| Record panel unreachable | No way to open a record | The affordance was gated on `type === "text" && text`, so title and empty cells had none | One cell per row carries it, independent of type or content |

Two further findings that changed the design rather than being bugs:

- **Variable-length fractional indexing was abandoned.** The first implementation
  failed several of its own tests, and the midpoint algorithm has invariants that
  are easy to get wrong and silently corrupt ordering. A fixed-width base-62
  integer is correct by construction and exhaustively testable; it costs ~10 bytes
  per row.
- **Rebalancing is required, not optional.** Gaps were measured to exhaust after
  ~750 random drags (`~1 rebalance per 2 000–20 000 drags`). The original plan
  guessed "rare, possibly never", which would have left a user's drag throwing.

### Phase 2 — Views, view settings and filtering — **DONE**

- [x] `select`, `multi-select` with the shared option editor *(Phase 1)*
- [x] `date` with the existing `DatePickerDialog` service *(Phase 1)*
- [x] `filterSort.ts` — pure filter / sort / group evaluation, 67 tests
- [x] `filter`, `sorts`, `groupBy`, `hideEmptyGroups` stored per view (§4.3)
- [x] Filter / sort / column / group-by settings UI (`ViewSettings.tsx`)
- [x] `BoardView` with drag-between-columns, grouped by option order
- [x] Property visibility per view, consumed by all three views
- [x] View tabs: create / rename / delete, per-view layout switch
- [x] The open view is shared state (`db_meta.activeViewId`)
- [x] `client` version → 0.16.0
- [x] **277 tests** (up from 175); `lint` + `build` clean
- [x] Verified in the browser: filtering (including the incomplete-condition case),
      the board with cards, column visibility, layout switch, name auto-rename and
      uniqueness, and the shared open view persisting across a reload
- [x] **Two-tab concurrent verification** — performed by hand in the Phase 2.5 pass (§12)

Left over from this phase, and since delivered by Phase 2.5: row drag-to-reorder,
column reorder, duplicate record. Still open: duplicate *view*, reorder views, and a
personal settings bucket.

Left over from this phase:

- [ ] Duplicate view; reorder views
- [ ] Personal (per-user) view settings bucket — no `localStorage` usage exists (§4.5)

### Phase 2.5 — Dragging, duplication, and the first guard tests — **DONE**

The two model methods that had no caller (`moveRow`, `moveProperty`) now do, plus row
duplication and two source-text guards for silent runtime failures.

- [x] `reorder.ts` — pure drag arithmetic, 18 tests
- [x] `moveRowBefore` / `movePropertyBefore` — the neighbour form views actually call
- [x] `duplicateRow` — values copied, text cells *not* shared, copy placed below the source
- [x] `getViewRowGroups` — buckets a view's rows by an arbitrary property, so a sorted
      list can be dragged without repointing the view's own grouping
- [x] Column drag in the table (header grip, before/after drop indicator)
- [x] Row drag in the table and the list (grip on the row handle cell)
- [x] List drag against a single option sort writes the sorted value, matching a board drop
- [x] Duplicate-record button in the table's row actions
- [x] `dragDropTargets.test.ts` — the four silent HTML5 drag failures, as source guards
- [x] Fixed **`BoardView` card drag, which never worked in Firefox or Safari**: the
      `dragStart` handler set no `dataTransfer` payload, so those browsers refused to
      start the drag. Found by the new guard, not by a browser — it was fine in Chromium.
- [x] Fixed `Yjs` "Add Yjs type to a document before reading data" warnings in `addRow`
      and `duplicateRow`: a row is now attached to `db_rows` **before** its values are
      written, instead of after
- [x] Fixed **`changedKeys` giving two rows the same `order` key** when a rebalance
      window straddled the insertion point (§8.2). Latent in the original
      `fractionalIndex` implementation; surfaced by `duplicateRow` reusing the same
      path on a deliberately crowded gap
- [x] `client` version → **0.18.0** (0.17.0 at the drag commit, 0.18.0 once the
      options editor landed)
- [x] **361 tests** (up from 303); `lint` + `build` clean
- [x] **328 tests** after `status` was removed (up from 303; a net −33: the 21 group
      tests, plus `status`-parameterised cases in `retype` and `filterSort`)
- [x] Verified in the browser by driving `DragEvent`s: column reorder in the table, row
      reorder in the table and the list, board card move, and duplication — each with
      its drop indicator and each surviving a reload, with no console errors
- [x] **The options dialog, end to end**: add, recolour, rename, drag-reorder,
      delete-with-confirm; stage add, rename and delete; and moving an option between
      stages, checking that the grouped list regroups
- [x] `OptionsEditor.tsx` — the UI that options were missing: rename, recolour,
      reorder, delete, add
- [x] `moveOptionBefore` and `renameGroup` in the model, with tests — the two writes
      the editor needed that had no method at all
- [x] `cells.tsx` shares option-grouping helpers instead of carrying its own copy
      *(moot after phase 2.6, which removed grouping)*
- [x] Fixed the colour control rendering a chevron over the swatch: it is a `Menu`
      anchored to an `IconButton`, not a `Select` (§4.2.1)

Left over from this phase:

- [ ] Row / column drag has no touch support: HTML5 drag events are mouse-only, so a
      touch device cannot drag at all (a pointer-events implementation would be needed)
- [ ] Column widths; the drag grips are fixed-size and the table stays at 220px/column

### Phase 2 bugs found and fixed

Found by using the feature in the browser rather than by the test suite, which is
worth noting: all three were "stored but not consumed" or "state in the wrong place"
mistakes that unit tests on the model could not catch.

| Bug | Symptom | Cause | Fix |
|---|---|---|---|
| `visibleProps` never read | Hiding a column did nothing at all | The setting was written by the panel, but every view read `getProperties()` instead of the view's list | Added `getViewProperties()`, consumed by all three views |
| Fixed, duplicated view names | A view called "Table" showing a board; every new view called "List" | The name was set once at creation and never derived from anything | Layout-derived defaults, made unique, renamed on layout change unless the user named it |
| Active view was local state | Switching tabs was private; a reload always reset to the first view | `useState` in the editor | Moved to `db_meta.activeViewId`, shared and synced |

One more, which was not a design bug but cost real time and is worth recording:

- **A blank screen with no console error.** After a set of rapid edits, the app hung
  on the static "Loading Memorains…" placeholder in `index.html`. The cause was Vite
  serving an **empty cached transform** for `BoardView.tsx`; the source was valid
  (esbuild parsed it, braces balanced, `tsc` clean). Touching the file invalidated the
  transform cache and fixed it. **If the app ever renders nothing with no error, try
  this before debugging the source.**

### Why `status` was removed

`status` shipped in Phase 1 as an eleventh property type: a `select` whose options
additionally carried a per-property list of **progress groups** (`todo` /
`in_progress` / `complete`, user-editable, with the last group meaning "done"). It was
removed in Phase 2.6. The reason is worth recording, because the code was not buggy —
the *idea* was not thought through.

#### What the type was supposed to buy, and what it actually bought

Notion's Status property has exactly three **fixed** groups. Its own guide is explicit
that this is the point:

> *"To add your own custom status tags, select `Add status` underneath To-do, In
> Progress or Completed, and type in your new sub-category. **You can't change the
> three main categories.**"*
> — <https://www.notion.com/help/guides/status-property-gives-clarity-on-tasks>

And the guide gives the reason groups exist at all, in terms of filtering:

> *"filtering the database is trickier, as you need multiple filters to include all the
> definitions. If you miss one, your view of a project's status is compromised."*

So a group is a **filter bucket**: filtering by `In Progress` matches `In Development`,
`In Review` and `Awaiting Feedback` at once, where a `select` would need three
conditions and would silently be wrong if one were missed.

We implemented the storage for that and none of the behaviour:

| What a group is for | Our implementation |
|---|---|
| Filtering by stage | **Not implemented.** The filter UI lists `property.options`, so only individual options can be matched |
| A progress indicator, or "done" | **Not implemented.** `progressForValue` and `isCompleteValue` were written and unit-tested, and **never called** |
| `Show as: Checkbox` | Not implemented |
| Picker/board grouping by stage | Implemented, but this is cosmetic |

So the net effect of the type was: **one extra heading row in the option picker**,
paid for with a whole schema layer (`prop.groups` plus a `group` field on every
option), a Stages editor in the dialog, an i18n key set, and a hint string that
promised a "done" that no code computed. The hint said *"The last one counts as done"*
and nothing counted anything — which is what prompted this review.

#### The deeper problem: the semantics were self-defeating

Notion can define "done" because its groups are **fixed**. We chose editable groups
(D11) *and* kept wording that depends on fixed ones. Once a user can add a fourth
stage, "the last one is done" is a tautology that means nothing — the user can always
append "Postponed" and make the completed items no longer last.

The choice was between:

- **fixed groups** — buys filterable stages and a real notion of "done", at the cost of
  flexibility, or
- **editable groups** — in which case they are just a labelling convenience, which does
  not need a distinct property type.

We took the second half of each option. That is the whole failure: the type survived
for its vestigial UI while its justification was never built.

#### What replaces it

- **Stages** → a plain `select` holding `In Development` / `In Review` / `Approved` as
  options. This is what the guide itself recommends as the workaround.
- **Filtering a range of stages** → the existing AND/OR filter UI, with one condition
  per option. Less convenient than a group filter, but *correct*, and the UI already
  supports it.
- **"Done"** → a separate `checkbox`, which is unambiguous and which we already have.
- **The default new-database schema** now includes a `Status` column that is a real
  `select` pre-seeded with `Not started` / `In progress` / `Done`. The column is a
  convenience, not a type: it exists so a new database is useful before it is
  configured, which is exactly the thing the empty `status` column failed at.

#### No compatibility shim

The removal is unconditional — no migration, and no "read an old `status` as a
`select`" branch. Stated here because the instinct to add one is strong and wrong: a
document written by an older client would render as `text`, but this document type had
no released users, and a compatibility branch is exactly the sort of unexercised code
that caused the problem being fixed (§5, "Options were model-complete but
unreachable"). Dead code that looks deliberate is worse than a clean break.

#### If it comes back

Removing the type is **not** a decision that `status` was a bad idea, and it is worth
being explicit so this section is not read as "never do this". A property type is the
most extensible seam this document type has: `PropType` is a closed union, but adding
a member touches the registry, the cell dispatcher and the type picker and nothing
else — the storage layer, the views and the CRDT rules are all generic over `PropType`.
There is no migration and no schema change to add one later, and rows store values
keyed by `propId`, so a column can even be *retyped* into a new type when one exists.

The type was removed because its **behaviour** was never specified, not because the
column type is a bad place for it. It should come back when the feature it exists for
is decided, and the decision has a shape — a `status` type is only worth having if it
commits to one of these:

| Option | Consequence |
|---|---|
| **Fixed groups** (Notion's choice) | Buys filterable stages and an unambiguous notion of "done", at the cost of flexibility. The three names then become part of the format, so they cannot be renamed without breaking the meaning |
| **Editable groups + a group filter** | The minimum that makes groups more than decoration: the filter UI must be able to target a *group*, not only an option. Without this, groups are cosmetic and belong in the picker's presentation rather than in the schema |
| **Neither** | Then it is a `select`, which is the status quo and needs no new type |

The bar to clear before reintroducing it: **name the observable behaviour first.** "You
can filter by stage" or "the last stage is done, and here is where that is computed" —
not "options have groups". That is the test this type failed (§9, and lesson 15).

#### The lesson

**A feature is not "done" because its storage layer and its unit tests exist.** Five
`status` methods and two progress helpers were fully tested against the CRDT and
called by nothing (see §4.2.1's note on the same failure mode). A green test on a
binding method asserts a write, never a call site. When a plan says a type "buys"
something, the thing it buys has to be listed as an observable behaviour — "it groups
options in a picker" would not have passed for "it lets you filter by progress".

### Phase 2.6 — Remove `status` — **DONE**

A **breaking** change, taken deliberately: `status` was deleted outright rather than
deprecated or shimmed, because nobody had documents depending on it and a compat branch
would be unexercised code of exactly the kind that caused the problem (§9).

- [x] `types.ts` — `PropType` loses `"status"`; `OptionDef.group` and
      `PropertyDef.groups` deleted; `STATUS_GROUPS` / `StatusGroup` deleted
- [x] `statusGroups.ts` + `statusGroups.test.ts` — **deleted** (21 tests)
- [x] `model.ts` — `getGroups`, `setGroups`, `setOptionGroup`, `renameGroup` deleted;
      `moveOptionBefore` kept (it serves option *ordering*, which both remaining option
      types use)
- [x] `OptionsEditor.tsx` — the Stages editor and the per-row stage picker deleted; the
      list is flat and drag-orderable
- [x] `cells.tsx` — the picker is a flat list again
- [x] `propertyTypes.ts`, `filterSort.ts`, `retype.ts`, `exporters.ts`, `CellEditor.tsx`,
      `TableView.tsx`, `BoardView.tsx`, `ListView.tsx`, `ViewSettings.tsx` — all
      `status` branches removed
- [x] `defaultGroupByProperty` no longer has a `status` tier; `select` wins
- [x] **Default new-database schema gains a `Status` column** — an ordinary `select`
      pre-seeded with `Not started` (gray) / `In progress` (blue) / `Done` (green), so
      a new database is useful before it is configured
- [x] i18n: 9 keys deleted (`db_prop_status`, `db_prop_status_hint`, `db_groups`,
      `db_groups_hint`, `db_add_group`, `db_option_group`, `db_group_none`,
      `db_delete_group`, `db_group_last_remaining`)
- [x] Tests updated: the board-grouping tests no longer rely on the seeded schema
      (which now contains a `select`), and the default-schema test asserts the three
      seeded options
- [x] **328 tests**, `lint` 0, `build` 0
- [x] Verified in the browser by creating a real document: it opens as
      `Name | Status | Notes`, the Status cell offers exactly the three seeded options
      plus "New option", the column menu's type list no longer contains Status, and the
      options dialog has no Stages section

Net line count: **−33 tests**, and two source files removed.

**Version:** `0.18.0 → 0.19.0`. Removing a property type is a breaking change to the
document format, and the project's convention is "major = breaking" — but at `0.x` a
`1.0.0` would misrepresent how much here is unreleased, so the breaking change takes a
**minor** bump, which is the conventional signal before 1.0.

### Phase 3 — Later, still in-document

- [ ] `formula` property (arithmetic + `if/and/or/not` + a small function set; no loops, no `random()`)
- [ ] Aggregation row in table / board
- [ ] Calendar, gallery, timeline views
- [ ] Rich text in `text` columns (the Quill binding over the same `Y.Text`, so no migration)
- [ ] Conditional color, freeze-column
- [ ] Virtualization or pagination, then a row limit — see "Known gaps" for why
      virtualization comes first
- [ ] Touch support for drag-and-drop (a pointer-events path, since HTML5 drag is mouse-only)
- [ ] Nested filter groups in the settings UI (the evaluator already supports them)

## 10. Decisions, Risks & Open Questions

### Decisions (resolved)

| # | Decision | Choice |
|---|---|---|
| D1 | Row storage | `Y.Map<rowId, row>`, not `Y.Array` — see §4.2 |
| D2 | Row body | **Dropped.** A `text` column covers it; rich text would be an upgrade of that column, not a reserved key |
| D3 | Table implementation | Hand-rolled MUI `Table` (no `@mui/x-*` dependency) |
| D4 | Tests | `vitest` in `client/` for the pure modules only |
| D5 | Row ceiling | **Not implemented.** 10 000 was chosen, never enforced — see "Known gaps" |
| D6 | Phase 1 scope | Model + Table + List, with **all basic property types** |
| D7 | `select` / `multi-select` / `date` | In Phase 1, not Phase 2 |
| D8 | New-database initial schema | `title` + `text`, one table view |
| D9 | `TodoListEditor` | **Not** refactored — out of scope |
| D10 | Storage policy | `title`/`text` → `Y.Text` (character-merged); every other type → last-write-wins |
| D11 | `status` semantics | **Reversed.** Was: a select whose options carry editable progress groups. Removed in phase 2.6; re-adding it is expected once its behaviour is decided — see §9 |
| D12 | Cell editing | One `CellEditor` per type, shared by the table (inline) and the record panel |
| D13 | Initial content | Seeded at **document creation** via a new `DocTypePlugin.initialState`, never when an editor mounts |
| D14 | Multi-select storage | One row key per option, not a nested `Y.Map` |
| D15 | Filter / sort storage | Whole values on the view, not mergeable structures — see §4.3 |
| D16 | Which view is open | **Shared**, in `db_meta`, not personal — see §4.5 |
| D17 | `visibleProps` semantics | Empty means "all"; the list is materialised on first hide |
| D18 | View naming | Layout-derived defaults, made unique, renamed on layout change only while `nameIsDefault` |
| D19 | Board grouping | **`select` only.** `multi-select` is refused at the picker, the setter and the reader |
| D20 | Drag-and-drop implementation | Native HTML5 drag events; no `@dnd-kit` / `react-dnd` dependency |
| D21 | Drop anchoring | A nullable **`beforeId`** (`null` = the end); a view never computes an index |
| D22 | List drag under a sort | Writes the sorted property (only for a single option sort); the handle is hidden otherwise |
| D23 | Where options are edited | The column's own menu, beside rename/retype — options **are** that column's schema, and the cell picker only ever created them |
| D24 | Options-dialog writes | Immediate, no draft/confirm except option deletion; one dialog for both option types |

### Risks

| Risk | Detail | Mitigation |
|---|---|---|
| **Every row becomes DOM** | `rows.map(...)` in the table and list renders every row and every cell. At 5 000 rows × 4 columns that is ~25 000 MUI subtrees. **This is the first limit a large table hits**, before save cost. | Virtualize or paginate the table *before* adding a row cap: a cap alone turns a slow table into a refusal. |
| **Document size / save cost** | `NoteDocument` saves with a full `Y.encodeStateAsUpdate(yDoc)` every 5 s, and `OnLineDocument.save()` every ~30 s. Measured: ~2.5 ms to read and ~8 ms to encode 5 000 rows; one cell edit is a constant ~41 bytes. | Acceptable at the measured sizes; incremental/tombstone encoding is a separate follow-up. |
| **`getRows()` is O(rows × properties)** | It walks every property for every row on each revision bump. Measured at 2.5 ms for 5 000 rows × 3 columns. | Fine now; memoise on `(binding, revision)` if property counts grow. |
| **No row-level auth** | The whole database syncs as one Yjs doc, so a viewer sees every row, including rows a filter hides. Filters are presentation, **not** access control. | Stated limitation. Rules out "share a filtered view" as a security boundary. |
| **Unbounded option lists** | Every option lives in `db_schema`; a pathological select with 10 000 options bloats every save and every view. | Soft cap + warn, mirroring Notion's 500-property limit. |
| **No personal settings** | Every view setting is shared, so one person's filter changes what another sees. | Deliberate for filters (§4.3), consistent with the shared open view (§4.5). Column widths would want a personal bucket when added. |
| **Nested filters invisible in the UI** | The evaluator supports depth 3; the editor exposes one flat level. A nested tree loaded from elsewhere shows a note. | Acceptable: the flat form covers the common case, and nesting never *hides* rows silently. |
| **`DocType` divergence** | `DataEntity.ts` is duplicated across `client/` and `server/`. | Run `script/sync_interface.sh` (it copies **server → client**) as part of the change. |
| **Drag is mouse-only** | HTML5 drag events do not fire for touch input, so the whole reorder feature is unusable on a tablet or phone. | Stated limitation. A pointer-events implementation would be the fix, and would replace the native path rather than supplement it. |
| **Drag state is per-mount** | `draggingRowId` etc. live in the view's `useState`, so a re-render that unmounts the view mid-drag (a layout switch, a remote deletion) drops the in-progress drag. | Acceptable: the drop simply does not happen, and no partial write exists. The alternative — a drag context above the views — would be worth revisiting if more views gain drag. |

### Open questions — resolved

| # | Question | Answer |
|---|---|---|
| 1 | Row body: plain text or rich text? | **No `body` at all.** A `text` column does the same job while being a real column. Revisit rich text by upgrading `text` columns to Quill over the same `Y.Text` — no migration needed |
| 2 | Hand-rolled table or `@mui/x-data-grid`? | **Hand-rolled** on MUI `Table` |
| 3 | How large must a database be? | **Thousands of rows**, so virtualization is the real constraint, not save cost |
| 4 | Board grouping with `multi-select`? | **No.** A board column means "exactly one option", so grouping is restricted to `select`; tags are sliced with a filter, table or list instead |
| 5 | Property deletion: permanent or recoverable? | **Permanent**, behind a confirm dialog. Values are swept from every row and references stripped from every view |
| 6 | Is the open view shared or personal? | **Shared.** It reads as *"let's look at this"*, and it is stored in `db_meta` so it cannot be mistaken for a view |

### Still open

- **Virtualization or pagination** — the first thing a large table needs (see Risks).
- **A row limit**, once virtualization exists so a cap is a guard rail rather than the
  only defence.
- **A personal settings bucket** for column widths and per-user filters.
- **Nested filter editing** in the UI.
- **Formula properties**, and cross-document `relation`/`rollup` (§11).
- **Touch support for drag-and-drop**, since HTML5 drag events are mouse-only.
- **A `status` property type again** — deliberately not in the way; see below.

## 11. Why Relations Are Out of Scope

`relation` / `rollup` presuppose a workspace-wide, queryable namespace: "the
property `Price` of the pages in that other database". Memorains has no such
namespace. Each document is **independently** persisted as one `Y.Doc`, one
IndexedDB record, and one row in the `document` table. There is no client-side
index of documents, and the server never sees document content, so it cannot
resolve a reference either.

Doing relations properly would require one of:

| Option | Approach | Cost |
|---|---|---|
| A | Same-document self-relation only | Almost free, but rarely the interesting case |
| B | Weak reference `{ docId, rowId }` resolved on demand via `client.db.getDocById` | Needs decryption, permission checks, and graceful handling of deleted targets; breaks for documents the viewer cannot access |
| C | A real workspace index (client-side directory doc, or a server index table) | Contradicts the "documents are self-contained" model; introduces permission, deletion and offline-consistency problems |

The scope decision here is **A only, and only if a concrete use case demands it**;
B and C deserve a separate design document. Phase 1–3 above are deliberately shaped
so that a later relation feature is additive: property IDs are stable, values are
already keyed by ID, and `rollup`/`formula` would be new property types that read
through a resolver interface rather than new storage.

---

## 12. Testing

Test files live beside the module they cover. Run with `npm test` in `client/`.

### Unit — 425 tests across 15 files

| File | Tests | Covers |
|---|---|---|
| `model.test.ts` | 116 | storage policy per type, `multi-select` unions from an empty cell, `p:` namespacing, empty-means-absent, concurrent number/select/date convergence, repair of corrupt order, option rename keeps rows, initial state created once, **view filters/sorts/grouping**, grouping is `select`-only (a `multi-select` group-by is refused at the picker, the setter and the reader), grouping by an arbitrary property (`getViewRowGroups`), **reordering by neighbour** (both ends, no-op anchors, 80 repeated moves with no lost row, two peers dragging concurrently), **duplicating a row** (values, unshared `Y.Text`, unshared date object, unique order keys), **option reordering** (unique order keys across repeats, no-op anchors, rows still attached), **stage rename** (options move with it, blanks/duplicates refused, label-vs-key), view naming (uniqueness, layout rename, user names preserved), the shared open view (sync, dangling id, delete repoints), per-view column visibility |
| `filterSort.test.ts` | 66 | every operator × every type, emptiness vs `0`/`false`, the `Y.Text` cell trap, incomplete conditions, deleted-property references, AND/OR with nesting and the depth cap, sorts (numeric, option order, empty-last in both directions, tie-break, multi-rule), grouping (option order, ungrouped bucket, empty buckets) |
| `retype.test.ts` | 45 | every type pair, empty cells never become values, `12abc` rejected, ambiguous dates refused, option matching by name, round trips, drop preview |
| `journalDays.test.ts` | 40 | day bucketing in local time (instants vs bare calendar dates), malformed/rolled-over day keys, DST-adjacent noon storage, week/month grid arithmetic, weekday and period labels, completion ratio, journal detail ranking |
| `deleteConfirmations.test.ts` | 17 | source guard: every destructive binding call (`deleteRow` / `deleteProperty` / `deleteOption` / `deleteView` / `setPropertyType`) sits inside a modal, so a new call site cannot ship an unconfirmed delete |
| `journalSchemaWrites.test.ts` | 11 | source guard: only the editor writes the journal's schema, never a view during render — the "every viewer adds a date column" failure |
| `fractionalIndex.test.ts` | 39 | encoding round-trips, split bounds, random-gap insertion, repeated append/prepend, same-position ties, rebalance widening and locality, malformed keys, **`changedKeys` skipping the inserted entries** |
| `reorder.test.ts` | 18 | where a drop lands for every pair and side, the three visually-identical no-ops, `changed` agreeing with the resulting order *in both directions*, an exhaustive permutation check, the anchor naming the neighbour whose remaining-list index is the insertion point, midpoint rounding |
| `exporters.test.ts` | 18 | Markdown pipe/newline escaping, CSV quoting, formula neutralisation, options exported by name |
| `textDiff.test.ts` | 17 | minimal diff for append/delete/replace, repeated characters, small update size, **concurrent edits from two `Y.Doc`s merge** |
| `singletonDialogMounts.test.ts` | 9 | singleton-backed dialogs are mounted exactly once **and** in the app shell |
| `muiOverlayAnchors.test.ts` | 6 | anchored overlays carry an anchor |
| `dragDropTargets.test.ts` | 9 | the four silent HTML5 drag failures, as source guards; plus a check that the guard found real drag sources |
| `pluginTypes.test.ts` | 4 | `resolveInitialState` treats an empty buffer as absent |
| `localDate.test.ts` | 10 | the date picker's local read/write round trip, at UTC, Asia/Shanghai and America/New_York |

### Source-text guards

**Five** of the suites above do not exercise behaviour at all — they assert invariants
over the source text, because the bugs they cover are **silent at runtime**:

| Guard | The silent failure it prevents |
|---|---|
| `muiOverlayAnchors` | A `Menu` / `Popover` rendered `open` with no `anchorEl` mounts unpositioned and only logs a prop-type warning |
| `singletonDialogMounts` | A dialog subscribing to a module singleton but mounted in one editor is simply missing on every other route |
| `dragDropTargets` | A missing `preventDefault()` in `dragOver`, or a `dragStart` with no `dataTransfer` payload, makes the drag do nothing without an error |
| `deleteConfirmations` | A destructive call in a live button's `onClick` deletes on one click with no confirmation — the shape three delete buttons shipped with |
| `journalSchemaWrites` | A view that creates the journal's date column while rendering adds one duplicate per viewer, each in that viewer's language, with nothing thrown |

The pattern is worth reusing. `vitest` runs in `node` mode with no DOM on purpose, so
a source-level check is the cheapest way to pin an invariant that only manifests
through a real browser's event handling. Both guards that check *distribution* also
assert they found at least one subject, so a rename cannot make them pass vacuously.

### Unit — still to write

- [ ] Component tests for `cells.tsx` / `TableView.tsx` / `BoardView.tsx`. None exist,
      and no DOM environment is configured — `vitest` runs in `node` mode on purpose,
      so adding these means adding jsdom.
- [ ] A test for `getProperties()` / `getRows()` cost as row and property counts grow,
      to catch a future O(n²) regression.
- [ ] A component test for `OptionsEditor.tsx`. Its **writes** are covered through the
      model, but the dialog's own behaviour — that the stage edit box pre-fills the
      label rather than the key, that a drop regroups the list, that deleting asks
      first — is only covered by the manual browser pass. This is the one place the
      plugin's UI logic is not pinned by a test.
- [ ] Real `DragEvent` integration coverage for the drop indicators. The synthetic
      events used in the manual pass cover the state machine, but the geometry
      (which half of a box the pointer is in) is only asserted through
      `isAfterMidpoint`'s unit tests.

### Integration — verified in the browser

- [x] A new database is created with its default schema, and the state is stored at
      creation (confirmed against the server's stored bytes, not just the DOM)
- [x] Inline cell editing persists
- [x] Creating an option inline, then selecting it
- [x] The record panel opens and renders every field
- [x] **Filtering**, including the incomplete-condition case: typing a
      non-matching value empties the table and clearing it restores every row
- [x] **The board** renders columns and draggable cards once a group-by column exists,
      and says so when it does not
- [x] **Column visibility**: the title toggle is disabled, others toggle
- [x] **Layout switch** renames the view (`List` → `Board`), and a second board becomes
      `Board 2`
- [x] **The open view** survives a reload and is read from the document
- [x] `lint` and `build` exit 0; the app loads with no console errors
- [x] **Column reorder by drag**, with the before/after indicator, persisting through a
      reload and through a layout switch
- [x] **Row reorder by drag** in the table, and again in the list, each with its
      top/bottom indicator
- [x] **Board card drag** between columns, verified after the `dataTransfer` fix
- [x] **Duplicate record**, the copy landing under the original with the same values
      and its own text cell

### Integration — the two-tab concurrency pass

Standing since Phase 1 as "the largest untested claim", and the reason the plan
carried an outstanding checkbox for three phases: **performed by hand in two live
browser sessions on one document.** That closes the gap between "the model is proven
by two `Y.Doc`s in a unit test" and "two people editing together actually converge".

The specific scenarios exercised and their outcomes were not recorded here line by
line; the claim this document makes is the one that was verified — two live sessions
converge — and nothing narrower.

### Integration — **not** verified

- [ ] A drag while a collaborator reorders the same rows. The model is covered (two
      `Y.Doc`s, §12's `model.test.ts`), but the **drop indicator** under a concurrent
      reorder has not been watched: the anchor is captured at `dragOver` time, and a
      remote move between then and `drop` means the anchor names a row that has moved.
      The write is still safe (the id is looked up fresh), but the user may not land
      where the indicator pointed.
- [ ] Offline edits, then reconnect → the `syncVector` diff reconciles (covered by
      unit tests, not watched live)
- [ ] Encrypted database documents: password prompt, export, sync-all
- [ ] Existing types (text / canvas / todo / chat) still open and sync, after the
      `pluginTypes.ts` and `CreateDoc.tsx` changes
- [ ] A document created by an older client, with no `groups`, no `p:` prefix and no
      `nameIsDefault`
- [ ] Drag on a touch device — not merely unverified but unimplemented (§10, risks)

---

## 13. Implementation Log

The order work actually happened in, which is **not** the order originally planned.
Phase 1's pure modules came first once it was clear that was where the real risk lay;
Phase 2 added the UI for features whose model already existed.

### Phase 1 — model, table, list

- [x] 1. `DocType.database` — edit the **server** copy, then `sync_interface.sh`
- [x] 2. vitest set up (`vitest.config.ts`, `npm test`) *before* writing logic
- [x] 3. `fractionalIndex.ts` + tests — the ordering foundation, **rewritten once**
- [x] 4. `types.ts` — shapes, `p:` namespacing, `multiSelectKey`
- [x] 5. `textDiff.ts` + tests — minimal-splice `Y.Text` writes
- [x] 6. `retype.ts` + tests — extracted from the binding so it could be tested at all
- [x] 7. ~~`statusGroups.ts` + tests~~ — written, then **deleted** in step 47 (§9)
- [x] 8. `model.ts` + tests — thin CRDT marshalling over the tested modules
- [x] 9. `optionColors.ts`, `propertyTypes.ts` — registries, no per-view switches
- [x] 10. `cells.tsx`, `CellEditor.tsx` — one editor per type, shared by both hosts
- [x] 11. `RecordPanel.tsx` — the uniform editing surface
- [x] 12. `TableView.tsx`, `ListView.tsx`
- [x] 13. `exporters.ts` + tests — Markdown and CSV
- [x] 14. `DatabaseEditor.tsx`, `index.ts` — shell and plugin descriptor
- [x] 15. i18n keys (`en` + `zh`)
- [x] 16. `pluginTypes.ts` — `initialState` hook, as the duplicate-schema fix
- [x] 17. `CreateDoc.tsx` — `resolveInitialState` wired into creation
- [x] 18. `client` version → 0.15.0
- [x] 19. `lint` 0, `build` 0, 175 tests passing

### Phase 2 — filters, sorts, board, view settings

- [x] 20. `filterSort.ts` + 67 tests — pure, before any UI
- [x] 21. `types.ts` — `filter`, `sorts`, `hideEmptyGroups`, `nameIsDefault` on `ViewDef`
- [x] 22. `model.ts` — `getViewRows`, `getViewGroups`, `getViewProperties`, setters, `db_meta`
- [x] 23. `ViewSettings.tsx` — filter / sort / columns / group-by UI
- [x] 24. `BoardView.tsx` — columns, cards, drag-between-columns
- [x] 25. Made all three views read `getViewProperties` (the `visibleProps` bug)
- [x] 26. View naming: layout-derived, unique, `nameIsDefault`
- [x] 27. The open view moved into `db_meta`
- [x] 28. i18n keys for the new UI
- [x] 29. `client` version → 0.16.0
- [x] 30. `lint` 0, `build` 0, 277 tests passing

### Phase 2.5 — dragging, duplication, source guards

- [x] 31. `client` 0.16.0 → **0.16.1** — a fix release for three silent UI failures
      (an unmounted date-picker dialog, unanchored settings panels, a doubly-mounted
      confirm dialog), plus two board/table rough edges. Added the first two
      source-text guards: `muiOverlayAnchors.test.ts`, `singletonDialogMounts.test.ts`.
      303 tests.
- [x] 32. `reorder.ts` + 18 tests — the pure drop arithmetic, before any drag handler
- [x] 33. `model.ts` — `moveRowBefore` / `movePropertyBefore` (the neighbour form),
      `duplicateRow`, `getViewRowGroups`
- [x] 34. `model.test.ts` — reordering by neighbour, duplicate semantics, concurrent
      drags from two `Y.Doc`s
- [x] 35. `TableView.tsx` — column drag, row drag, duplicate button
- [x] 36. `ListView.tsx` — row drag, conditionally against a single option sort
- [x] 37. `dragDropTargets.test.ts` — the four silent drag failures, which immediately
      found that **`BoardView` card drag never worked outside Chromium**
- [x] 38. Attach rows to `db_rows` before writing their values (the Yjs warning fix)
- [x] 39. `client` version → 0.17.0
- [x] 40. `lint` 0, `build` 0, **351 tests** passing (361 after 42–46)
- [x] 41. **Manual browser pass** driving real `DragEvent`s: column reorder (with its
      indicator and a reload), row reorder in the table and the list, board card move,
      duplication. Re-ran the two-tab concurrency pass at the same time.
- [x] 42. `model.ts` — `moveOptionBefore`, `renameGroup` + tests (the editor's two
      missing writes)
- [x] 43. `OptionsEditor.tsx` — the options/stages dialog, turning a dead "Edit
      options" menu entry into a live one
- [x] 44. `cells.tsx` — share the option-grouping helpers instead of a local copy
- [x] 45. i18n keys for the dialog; wired up the previously unused `db_edit_options`,
      `db_options`, `db_option_name`, `db_groups`, `db_groups_hint`, `db_add_group`
- [x] 46. `client` version → 0.18.0; `lint` 0, `build` 0, **361 tests** passing, and
      the whole dialog exercised in the browser
- [x] 47. Replaced the colour `Select` with a `Menu` + `IconButton` after a report that
      the swatch rendered oddly, and confirmed in the browser that no chevron overlaps
      a swatch and that the palette opens and applies
- [x] 48. **Removed the `status` property type** — researched how Notion's Status
      actually works (three fixed groups, whose purpose is filterable stages, none of
      which we had implemented), then deleted the type, its two schema fields, its four
      model methods, `statusGroups.ts` and 33 tests, and seeded a plain `select`
      `Status` column into the default schema instead (§9)
- [x] 49. `client` version → 0.19.0; `lint` 0, `build` 0, **328 tests**, and a newly
      created document verified in the browser to open as `Name | Status | Notes` with
      three working options

### Lessons worth carrying forward

1. **Write the pure module and its tests before the UI.** The riskiest code —
   ordering, text splicing, type conversion, filter evaluation — is where the bugs
   were, and none of them were visible in the UI.
2. **Disjoint keys, not shared containers.** Two of the concurrency fixes came from
   this. A nested `Y.Map`/`Y.Array` merges only if both peers already have it;
   concurrently creating one discards a peer's whole subtree.
3. **Never seed state when an editor mounts.** `onInit` fires before the stored state
   loads. Content that must exist belongs at creation.
4. **A setting that is stored but never read is worse than a missing one.** Two of
   Phase 2's three bugs were exactly this — the UI wrote `visibleProps`, and no view
   consumed it. Grep for the consumer before trusting the feature.
5. **Put state where it belongs, not where it is easy.** The open view in `useState`
   looked fine and worked alone; it only broke the moment a second client existed.
6. **Verify against the server, not just the DOM.** The duplicate-schema bug was
   invisible in a single render and only appeared after a reload.
7. **A passing test can still be a wrong test.** Several early failures were faulty
   assertions (a birthday-paradox collision, values that did not match their declared
   source type), not bugs. Check which side is wrong before "fixing" code.
8. **A blank screen with no error may be a stale build cache, not your code.** See the
   Phase 2 note in §9.
9. **Silent failures deserve source-text guards, not just tests.** Three of this
   plugin's real bugs did nothing observable except "the feature doesn't work": an
   overlay with no anchor, a dialog mounted once in the wrong place, a drag with no
   `preventDefault()`. None throws, none logs, and a unit test cannot reach them in a
   DOM-less runner — but a regex over the source can. The guard that checks a
   *distribution* must also assert it found at least one subject, or a rename turns it
   into a test that asserts nothing.
10. **Two names for one concept will collide; pick the idiom that cannot.** `afterId`
    used `null` for "the front" while the model used `null` for "the end". Two failing
    model tests surfaced it, and the fix was to switch to `beforeId` — the
    `insertBefore` idiom, where `null` is unambiguously "append" — rather than to
    document the discrepancy and remember it.
11. **A test that fails is a claim about the code, not a fact.** Two of the first
    reorder assertions were wrong about what "before" meant, not the helper. Read the
    diff and decide which side is wrong; "fixing" the code to match a bad assertion
    would have inverted the feature.
12. **Check the browser the user is not using.** The board's drag-and-drop worked
    perfectly in Chromium and was broken in Firefox and Safari, because only Chromium
    starts a drag with an empty `dataTransfer`. Anything relying on a browser
    behaviour should be pinned by a guard, since the dev's own browser will lie.
13. **"The model supports it" is not "the user can do it".** Five option methods were
    written, tested and documented in phase 1, while the only thing a user could
    actually do with an option was create one. A green unit test on a binding method
    asserts the CRDT write, never the call site. When a plan says "editable", grep for
    the caller — and when a user says "this can't be done in the UI", check the menu
    before defending the feature.
14. **Do not hand-roll what the component already manages.** The options dialog's
    colour picker tracked its own `open`/`anchor` state on top of a MUI `Select`, and
    stopped opening. A plain `Select` owns that state; the fix was to delete the
    state, not to debug it.
15. **A "feature" whose justification is never built is just debt with a test.** Five
    `status` methods and two progress helpers (`progressForValue`, `isCompleteValue`)
    had full unit coverage and **no caller**, so the type's only observable effect was a
    heading in a dropdown — while its hint text promised a "done" nothing computed. The
    tell was a user asking "what is this text for?". When a plan claims a type buys
    something, name the **observable behaviour**; "groups options in a picker" should
    not be allowed to stand in for "you can filter by progress". Note this is a
    statement about *specifying* the feature, not about the feature being wrong: a
    column type is cheap to add back (§9, "If it comes back"), which is exactly why it
    is worth specifying first rather than building the storage and hoping.
16. **Fixed semantics and editable data cannot both justify the same feature.**
    Notion's groups can mean "done" precisely because they are the three fixed stages.
    We made them user-editable *and* kept wording that assumes they are fixed, which
    made "the last one is done" a tautology. Pick one: fixed and meaningful, or
    editable and merely cosmetic.
17. **Prefer a clean break over a compatibility branch for unreleased code.** Reading an
    old `status` as a `select` would have been 10 lines and would have become unexercised
    code that looks deliberate — the precise class of thing item 15 is about.
18. **Match the component to the shape of the data.** The colour control first
    hand-rolled `open`/`anchor` state on top of a `Select` (and stopped opening), then
    rendered a chevron on top of the swatch (because a `Select` is a text field and
    draws an arrow whether or not there is text). A `Menu` anchored to an `IconButton`
    is the control for "a small glyph that opens a list". Two bugs in one control, both
    from reaching for the familiar MUI component instead of the one shaped like the
    data.
