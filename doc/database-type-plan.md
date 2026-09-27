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
- Column types: `title`, `text`, `number`, `select`, `multi-select`, `status`,
  `date`, `checkbox`, `url`, `email`, `phone`. **Done** — all eleven.
- Views: **table** **done**, **list** **done**, **board** *pending* (Phase 2).
- Per-view settings: property visibility, filter, sort, group, layout.
  *Partly* — layout per view is done and the rest is designed for but not built.
- Every row opens in a record panel where all its properties can be edited, using
  the same components the table uses inline. **Done.**
- Concurrent-safe: two collaborators editing schema, rows or view settings
  simultaneously must converge without data loss. **Done for the model**, proven by
  tests against two `Y.Doc`s; a manual two-browser pass is still outstanding.
- Column types hold data safely: `title`/`text` merge character-by-character so no
  edit is lost, while discrete types converge to a single value rather than
  concatenating into nonsense. **Done** — see §4.2.

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
| `src/internationnalization/stringMap.ts` | changed | ~60 new keys, `en` + `zh` |
| `src/components/CreateDoc.tsx` | changed | calls `resolveInitialState` so a type's initial content is stored at creation |
| `src/doc-types/pluginTypes.ts` | changed | new optional `DocTypePlugin.initialState`, plus `resolveInitialState` |
| `src/doc-types/plugins/database/types.ts` | new | shapes + constants; no Yjs import, so pure modules can use it |
| `src/doc-types/plugins/database/fractionalIndex.ts` | new | fixed-width base-62 order keys, splitting, rebalancing |
| `src/doc-types/plugins/database/textDiff.ts` | new | minimal-splice writes to `Y.Text` cells |
| `src/doc-types/plugins/database/retype.ts` | new | value conversion rules for a type change |
| `src/doc-types/plugins/database/statusGroups.ts` | new | progress groups as data, not an enum |
| `src/doc-types/plugins/database/optionColors.ts` | new | option colour palette |
| `src/doc-types/plugins/database/exporters.ts` | new | Markdown + CSV projections |
| `src/doc-types/plugins/database/model.ts` | new | `DatabaseBinding` — all CRDT reads/writes |
| `src/doc-types/plugins/database/propertyTypes.ts` | new | property-type registry (labels, icons, capabilities) |
| `src/doc-types/plugins/database/CellEditor.tsx` | new | dispatches to one editor per type |
| `src/doc-types/plugins/database/cells.tsx` | new | the cell editors + read-only rendering |
| `src/doc-types/plugins/database/TableView.tsx` | new | table view, column menus, retype dialog |
| `src/doc-types/plugins/database/ListView.tsx` | new | list view |
| `src/doc-types/plugins/database/RecordPanel.tsx` | new | record edit panel (shared editing surface) |
| `src/doc-types/plugins/database/DatabaseEditor.tsx` | new | editor shell: binding lifecycle, view tabs |
| `src/doc-types/plugins/database/index.ts` | new | plugin descriptor, `initialState`, CSV menu item |
| `src/doc-types/plugins/database/*.test.ts` | new | 6 test files |
| `vitest.config.ts` | new | test config (node env, no DOM) |
| `package.json` | changed | `test`/`test:watch` scripts, `vitest` devDependency, version → 0.15.0 |
| `server/**` | changed | **only** the synced `DocType` enum (no behaviour change) |

> `DocType` is shared with the server and `sync_interface.sh` copies **server →
> client**, so edit `server/src/interface/DataEntity.ts` first, then run the script.
> Editing the client copy and syncing silently reverts the change.
>
> `UserServerMessage.ts` is excluded from that script and must be synced by hand.

### Deviations from the original plan

| Planned | Actually built | Why |
|---|---|---|
| `views/BoardView.tsx` | not built | Deferred with filters/sorts to Phase 2 |
| `viewSettings.ts` | not built | Only needed once per-view filters/sorts exist |
| `filterSort.ts` | not built | Same |
| `markdown.ts` | built as `exporters.ts` | Holds Markdown **and** CSV |
| lazy `body` on each row | **dropped** | A `text` column does the same job while being a real column (sortable, filterable, many per table). A reserved `body` key is one untyped slot that can be none of those |
| 10 000-row ceiling | **not implemented** | See "Known gaps" below |

### Known gaps

- **No row ceiling.** The plan called for validating against a row limit; only the
  measurement behind it was done. `NoteDocument` re-encodes the whole document every
  5 s and the server every ~30 s, so cost grows with total rows: ~12 ms/save at
  5 000 rows, ~29 ms at 10 000. A soft limit is still worth adding before this is
  used for very large tables.
- **No filters, sorts or per-view settings.** Every view shows all rows in `order`.
- **No `board` view.** The layout field, `groupBy` and the status groups exist in
  the model, and `status`/`select` are groupable, but no board renderer consumes
  them yet.
- **View `visibleProps` is stored but nothing toggles it.** The model and
  `toggleViewProperty` exist; no UI yet, so all columns always show.
- **Row order is not drag-editable.** `moveRow` and the rebalancing logic are
  implemented and tested, but no UI calls them yet.

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
  options?: Y.Map<optId, Y.Map>;  // select / multi-select / status only
  groups?: string[];              // status only: the user's stages, in order
}

// option entry (key = optId, a stable uuid)
{
  id: string;
  name: string;
  color: string;           // "gray" | "brown" | ... | "default"
  order: string;           // fractional index — also defines sort order of the option
  group?: string;          // status only; group names are user data, not an enum
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
| `status` | `optId` (string) or absent |
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

### 4.3 View definition (`db_views`)

```ts
// key = viewId, a stable uuid
{
  id: string;
  name: string;
  layout: "table" | "board" | "list";
  order: string;                       // fractional index over view tabs

  // table / list
  visibleProps?: Y.Array<string>;      // propIds, in display order; absent = all

  filter?: Y.Map;                      // see §4.4
  sorts?: Y.Array<Y.Map>;              // [{ propId, direction: "asc"|"desc" }]
  groupBy?: string;                    // propId; board view requires this
}
```

These are **shared** view settings, synchronized to all collaborators — matching
Notion's "Save for everyone" filters/sorts. Personal-only settings (things that
should not sync) are handled separately, see §4.5.

### 4.4 Filter shape

Filter groups are recursive with explicit `AND`/`OR`, capped at **3 nesting levels**
(matching Notion's limit) to bound UI and evaluation complexity:

```ts
type FilterGroup = {
  kind: "group";
  op: "and" | "or";
  children: (FilterGroup | FilterCondition)[];
};

type FilterCondition = {
  kind: "condition";
  propId: string;
  operator: string;   // operator set is validated against the property type
  value?: unknown;
};
```

Operator sets per type (v1, deliberately small):

| Type | Operators |
|---|---|
| text / title / url | `contains`, `does_not_contain`, `is`, `is_not`, `is_empty`, `is_not_empty` |
| number | `=`, `≠`, `>`, `<`, `≥`, `≤`, `is_empty`, `is_not_empty` |
| select / status | `is`, `is_not`, `is_empty`, `is_not_empty` |
| multi-select | `contains`, `does_not_contain`, `is_empty`, `is_not_empty` |
| date | `is`, `is_before`, `is_after`, `is_on_or_before`, `is_on_or_after`, `is_empty`, `is_not_empty` |
| checkbox | `is` (`true`/`false`) |

`filterSort.ts` must be a set of **pure functions** (`(rows, schema, view) => Row[]`)
that are unit-testable without React or Yjs. Invalid conditions (e.g. a filter
referencing a deleted property) are dropped at evaluation time rather than
crashing the view.

### 4.5 Shared vs personal settings

Notion distinguishes filters/sorts that apply "for everyone" from ones that apply
only to you. That distinction maps cleanly here:

| Setting | Storage | Reason |
|---|---|---|
| Schema, rows, property values | `Y.Doc` | Must converge for all collaborators |
| View name, layout, shared filter/sort/group, visible props | `Y.Doc` (`db_views`) | Shared presentation of shared data |
| Active view selection, personal filter/sort, column widths, row height, collapsed groups | `localStorage`, keyed by `docId + viewId` | Must **not** sync — otherwise one user's tabbing around yanks the other's view |

Note that the existing `LocalStorageProperty<T extends string>` helper
(`client/src/utils/LocalStorageProperty.ts`) is **string-only** and therefore
cannot hold an object directly. Two workable options: store a per-view JSON string
under one key (`memorains_db_personal_<docId>`), wrapping it in a tiny typed
accessor so call sites stay object-shaped; or keep the personal bucket in the
`Setting`-style pattern (`client/src/Setting.ts`) if it should be app-wide rather
than per-document. Either way the personal bucket must never be written into the
`Y.Doc`.

---

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
| Status progress groups | `statusGroups.ts` (pure, tested) |

`CellEditor.tsx` is the single dispatcher, and both the table and the record panel
render it — so there is one implementation per type and no per-view variation.

Filter operators and `compare` are not declared per type yet because filtering is
Phase 2; `isOrderedType` already answers the one question a sort UI will ask.

---

## 6. Views

All views read the same rows and differ only in how they lay them out.

**As built** — each view is a pure renderer over `binding.getRows()`, with no
filtering or sorting stage yet:

```
db_rows ──► binding.getRows()   (sorted by each row's `order` key)
                     │
                     ├──► TableView
                     └──► ListView
```

**Planned** — once Phase 2 adds filtering and sorting, a shared stage sits between
the rows and the renderers, so every view honours the same view settings:

```
binding.getRows() ──► filter ──► sort ──► group ──► layout renderer
                         ▲         ▲        ▲
                         └─────────┴────────┴── view settings (db_views)
```

Views currently re-read through the binding on a coalesced animation frame after any
document change, rather than caching rows, which keeps them correct by construction
while the row counts are modest.

### 6.1 Table — built

- Rows = records, columns = properties, in `order`.
- Header cells: type icon, name, and a menu with **rename**, **change type**
  (with a preview of what the change would clear), and **delete**. A `title`
  column cannot be renamed, retyped or deleted.
- `+` at the right edge adds a property; **New record** adds a row.
- Cells edit **in place** via the shared `CellEditor`. `checkbox`, `select`,
  `multi-select`, `status` and `date` commit on direct interaction; `text`,
  `number` and the string types enter edit mode on click and commit on blur.
- Every row's first cell carries the **open record** affordance, so the panel is
  reachable from any row — including an empty one.
- Double-clicking a cell also opens the record panel.

Not built yet, and why:

| Missing | Note |
|---|---|
| Duplicate / insert left-right / hide column | Rename, retype and delete cover the common cases; the rest is Phase 2 |
| Column reorder | `moveProperty` is implemented and tested; the drag UI is not |
| Row drag-to-reorder | `moveRow` and the rebalancing are implemented and tested; the drag UI is not |
| Column widths | Would be **personal** (localStorage), not shared — §4.5 |
| Aggregation row | Phase 3 |

Implementation note: MUI's core `Table` primitives, as planned. No `@mui/x-*`
dependency was added.

### 6.2 Board — not built (Phase 2)

The model side is already in place: `ViewDef.layout` accepts `"board"`,
`ViewDef.groupBy` holds the property, `setViewGroupBy` writes it, status groups are
per-property data, and `canGroupByProperty` reports which columns qualify. Only the
renderer is missing, and `DatabaseEditor` currently falls back to the table for any
layout it does not implement — so an unknown layout renders data rather than a blank
panel.

- Requires `groupBy` pointing at a `select` / `multi-select` / `status` property.
- One column per option, in the option's own `order` (so the option drag order is
  also the board order, as in Notion). A trailing "No status"-style column holds
  rows with no value.
- Drag a card between columns → write the option ID onto the row (`Y.Map.set` /
  nested list add-remove inside a `yDoc.transact`).
- Multi-select grouping places a row in every matching column (read-only
  duplication; dragging out of one column only removes that one tag).
- Board ignores `sorts` for within-column order unless set; default is the row's
  fractional `order`.

### 6.3 List — built

Minimal vertical list: each line shows the title plus up to three secondary
properties. Select-family values render as coloured chips, since colour is the
fastest way to scan a list. Values render through the same `CellDisplay` the table
uses, so a value looks identical in both views. Clicking a line opens the record
panel.

---

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

**71 keys were added**, each with `en` and `zh`. The list this section originally
sketched was indicative only; `stringMap.ts` is authoritative (`grep '^  \["db_'`).

`doc_type_database`, `new_database_button`,
`db_add_property`, `db_add_row`, `db_property_name`, `db_property_type`,
`db_delete_property`, `db_delete_row`, `db_confirm_delete_property`,
`db_confirm_delete_row`, `db_prop_title`, `db_prop_text`, `db_prop_number`,
`db_prop_select`, `db_prop_multi_select`, `db_prop_status`, `db_prop_date`,
`db_prop_checkbox`, `db_prop_url`,
`db_view_table`, `db_view_board`, `db_view_list`, `db_new_view`, `db_rename_view`,
`db_delete_view`, `db_filter`, `db_sort`, `db_group`, `db_filter_and`,
`db_filter_or`, `db_add_filter`, `db_advanced_filter`, `db_visible_properties`,
`db_group_by`, `db_no_rows`, `db_no_results`, `db_select_option_placeholder`,
`db_export_csv`, `db_export_csv_empty`, `db_export_csv_success`, `db_export_csv_failed`.

> **71 keys were added in total**, including the per-type labels and hints, the cell
> editor strings, the retype dialog and its loss warning, and the view/record-panel
> labels. Several keys listed in this section were only sketched during planning;
> the authoritative list is `stringMap.ts` (`grep '^  \["db_'`).

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

### 8.3 Deleting a property or a view

- **Delete property**: delete the key from `db_schema`, then sweep every row in one
  `yDoc.transact` removing the value entry. Also strip the property from every
  view's `visibleProps`, `sorts`, `groupBy` and filter conditions in the same
  transaction. A stale reference left behind would be an inconsistent state that
  every read site then has to defend against.
- **Delete view**: delete from `db_views` and drop its personal settings. Always
  keep at least one view — deleting the last one is disallowed in the UI.
- **Delete row**: delete from `db_rows` and drop any personal state keyed by that
  row ID.

Note `Y.Map` and `Y.Array` have no foreign keys; referential hygiene is entirely
our responsibility.

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
      `checkbox`, `url`, `email`, `phone`, `select`, `multi-select`, `status`, `date`
- [x] Shared option editor: create / rename / recolour inline, for
      `select` / `multi-select` / `status`
- [x] `status` progress groups as editable per-property data (not an enum)
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
- [ ] **Not done:** two-tab concurrent verification in the live UI (the concurrency
      guarantees are covered by unit tests using two `Y.Doc`s, but no manual
      two-browser pass was performed)

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

### Phase 2 — Views, view settings and filtering

- [x] `select`, `multi-select`, `status` with the shared option editor *(done in Phase 1)*
- [x] `date` with the existing `DatePickerDialog` service *(done in Phase 1)*
- [x] View tabs: create / rename / delete, and a per-view layout switch
      *(done; **duplicate** and **reorder** are not)*
- [x] CSV export menu item *(done in Phase 1)*
- [x] Unit tests for the fractional index *(done in Phase 1)*
- [ ] `BoardView` with drag-between-columns — consumes the existing `groupBy` and
      status groups; `canGroupBy` already reports which properties qualify
- [ ] `filterSort.ts` (pure) + filter/sort/group settings UI
- [ ] Personal settings bucket (localStorage, per doc+view)
- [ ] Property visibility per view — `visibleProps` and `toggleViewProperty` exist,
      only the UI is missing
- [ ] Row drag-to-reorder — `moveRow` and the rebalancing are implemented and
      tested, only the UI is missing
- [ ] Duplicate view; reorder views

### Phase 3 — Later, still in-document

- [ ] `formula` property (arithmetic + `if/and/or/not` + a small function set; no loops, no `random()`)
- [ ] Aggregation row in table / board
- [ ] Calendar, gallery, timeline views
- [ ] Rich text in `text` columns (the Quill binding over the same `Y.Text`, so no migration)
- [ ] Conditional color, freeze-column
- [ ] Row limit, or an incremental save path, for very large tables (see Known gaps)

---

## 10. Risks & Open Questions

### Decisions (resolved)

| # | Decision | Choice |
|---|---|---|
| D1 | Row storage | `Y.Map<rowId, row>`, not `Y.Array` — see §4.2 |
| D2 | Row body | **Dropped.** A `text` column covers it; rich text would be an upgrade of that column, not a reserved key |
| D3 | Table implementation | Hand-rolled MUI `Table` (no `@mui/x-*` dependency) |
| D4 | Tests | Add `vitest` to `client/` for the pure modules only |
| D5 | Row ceiling | Validate against a constant of **10 000** rows per database |
| D6 | Phase 1 scope | Model + Table + List, with **all basic property types** |
| D7 | `select` / `multi-select` / `status` / `date` | In Phase 1, not Phase 2 |
| D8 | New-database initial schema | `title` + `text`, one table view |
| D9 | `TodoListEditor` | **Not** refactored — it is out of scope for this change |
| D10 | Storage policy | `title`/`text` → `Y.Text` (character-merged); every other type → last-write-wins |
| D11 | `status` semantics | A select whose options carry per-property progress **groups**; groups are editable data, not a fixed enum |
| D12 | Cell editing | One `CellEditor` per type, shared by the table (inline) and the record panel |
| D13 | Initial content | Seeded at **document creation** via a new `DocTypePlugin.initialState`, never when an editor mounts |
| D14 | Multi-select storage | One row key per option, not a nested `Y.Map` |

### Risks

| Risk | Detail | Mitigation |
|---|---|---|
| **Document size / save cost** | `NoteDocument` saves with a **full** `Y.encodeStateAsUpdate(yDoc)` (5 s throttle, `NoteDocument.ts`), and `OnLineDocument.save()` does the same every ~30 s server-side. A 5 000-row database makes both O(document) on every save. | Cap rows per database (v1 limit, e.g. 1 000) with a UI warning; measure before lifting the cap; treat incremental/tombstone encoding as a separate follow-up. |
| **No row-level auth** | The whole database doc syncs as one Yjs doc, so a viewer sees every row. Fine now (permissions are per-document), but it forecloses "share a filtered view". | Document the limitation. Not a Phase 1–3 goal. |
| **Unbounded option lists** | Every option must live in `db_schema`; a pathological select with 10 000 options bloats every save. | Soft cap + warn, mirroring Notion's 500-property limit. |
| **Filter/sort CPU** | Filtering is client-side over all rows on every render. | Memoize on `(rows, schema, view)`; keep `filterSort.ts` pure so it can be cached cheaply; virtualize the table if row counts justify it. |
| **New MUI dependency** | A polished grid/calendar likely wants `@mui/x-data-grid`. | Default to core MUI `Table`; decide explicitly (Open Question 2). |
| **`DocType` divergence** | `DataEntity.ts` is duplicated across `client/` and `server/`. | Run `script/sync_interface.sh` as part of the change; it is the documented procedure. |

### Open questions — resolved

| # | Question | Answer | Where it landed |
|---|---|---|---|
| 1 | Row body: plain text or rich text? | **No `body` at all.** A `text` column does the same job while being a real column: sortable, filterable, renamable, many per table. Revisit rich text by upgrading `text` columns to Quill over the same `Y.Text` — no migration needed | §4.2, Phase 3 |
| 2 | Hand-rolled table or `@mui/x-data-grid`? | **Hand-rolled** on MUI `Table`. No new dependency, and no theme conflict | `TableView.tsx` |
| 3 | How large must a database be? | **Thousands of rows.** Measured: ~12 ms per save at 5 000 rows, ~29 ms at 10 000; one cell edit costs a constant ~41 bytes. A soft limit is still unimplemented | Known gaps |
| 4 | Board grouping with multi-select? | **Not yet answered** — the board is Phase 2. The model supports both | Phase 2 |
| 5 | Property deletion: permanent or recoverable? | **Permanent**, behind a confirm dialog naming the column. Deleting also sweeps the values from every row and strips references from every view | §8.3 |

### Still open for Phase 2

- **Row limit** — pick a number and enforce it, or replace the full-state save path.
- **Board grouping with multi-select** — one column per matching option (splitting a
  row across columns) or a single column.
- **`filterSort.ts` and personal view settings** — the shared/personal split is
  designed (§4.5) but no UI exists, so nothing yet writes to `localStorage`.

---

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

## 12. Testing Checklist

Test files live beside the module they cover
(`plugins/database/<module>.test.ts`). Run with `npm test` in `client/`.

### Unit — done (175 tests, 7 files)

| File | Tests | Covers |
|---|---|---|
| `fractionalIndex.test.ts` | 36 | encoding round-trips (exhaustive over a window), split bounds, random-gap insertion, repeated append/prepend, same-position ties, rebalance widening, rebalance stays local, malformed keys |
| `textDiff.test.ts` | 17 | minimal diff for append/delete/replace, repeated characters, start/end edits, small update size, **concurrent edits from two `Y.Doc`s merge** |
| `retype.test.ts` | 41 | every type pair, empty cells never become values, `0`/`false` preserved, numeric parsing rejects `12abc`, ambiguous dates refused, option matching by name, round trips, drop preview |
| `statusGroups.test.ts` | 21 | groups as data, user-defined stages, the last group means done, unknown groups preserved, option re-homing |
| `model.test.ts` | 38 | storage policy per type, `multi-select` unions concurrent tags from an empty cell, `p:` namespacing, empty-means-absent, concurrent number/select/date converge, repair of corrupt order, option rename keeps rows, initial state is created once |
| `exporters.test.ts` | 18 | Markdown pipe/newline escaping, CSV quoting, formula neutralisation, options exported by name |
| `pluginTypes.test.ts` | 4 | `resolveInitialState` treats an empty buffer as absent |

### Unit — still to write

- [ ] `filterSort.ts`: each operator × each property type, including empty values
- [ ] Nested AND/OR groups, 3-level cap, malformed or dangling conditions
- [ ] Sort stability, `null`-last ordering, select sorts by option order
- [ ] `cells.tsx` / `TableView.tsx`: no component tests yet, and no DOM test
      environment is configured (`vitest` runs in `node` mode by design)

### Integration — verified in the browser

- [x] A new database is created with its default schema (column + view)
- [x] Inline cell editing persists (confirmed against the server's stored state)
- [x] Creating an option inline, then selecting it
- [x] The record panel opens and renders every field
- [x] `lint` and `build` exit 0; the app loads with no console errors

### Integration — **not** yet verified

- [ ] Two-browser-tab concurrency: the guarantees are unit-tested against two
      `Y.Doc`s, but no manual two-tab pass has been done
- [ ] Offline edits, then reconnect → `syncVector` diff reconciles
- [ ] Delete a column while another client edits a value in it
- [ ] Encrypted database documents: password prompt, export, sync-all
- [ ] Existing types (text / canvas / todo / chat) still open and sync after the
      `pluginTypes.ts` and `CreateDoc.tsx` changes
- [ ] Load a document created by an older client (no `groups`, no `p:` prefix)

---

## 13. Implementation Log (Phase 1)

Kept as a record rather than a plan, since Phase 1 is complete. The order below is
the order the work actually happened in, which is **not** the order originally
planned — the pure modules came first once it was clear they were where the real
risk lived.

- [x] 1. `DocType.database` — edit the **server** copy, then `sync_interface.sh`
- [x] 2. vitest set up (`vitest.config.ts`, `npm test`) before writing logic
- [x] 3. `fractionalIndex.ts` + tests — the ordering foundation, rewritten once
- [x] 4. `types.ts` — shapes, `p:` namespacing, `multiSelectKey`
- [x] 5. `textDiff.ts` + tests — minimal-splice `Y.Text` writes
- [x] 6. `retype.ts` + tests — conversion rules, extracted from the binding so they
      could be tested at all
- [x] 7. `statusGroups.ts` + tests — after the groups-as-data correction
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
- [ ] 20. **Manual two-tab concurrency pass** — carried into Phase 2

### Lessons worth carrying forward

1. **Write the pure module and its tests before the UI.** The riskiest code —
   ordering, text splicing, type conversion — was where the bugs were, and none of
   them were visible in the UI.
2. **Disjoint keys, not shared containers.** Two of the three concurrency fixes came
   from this. A nested `Y.Map`/`Y.Array` merges only if both peers already have it.
3. **Never seed state when an editor mounts.** `onInit` fires before the stored state
   loads. Content that must exist belongs at creation.
4. **Verify against the server, not just the DOM.** The duplicate-schema bug was
   invisible in a single render and only appeared after a reload.
5. **A passing test can still be a wrong test.** Several early failures were faulty
   assertions (a birthday-paradox collision, values that did not match their declared
   source type), not bugs. Check which side is wrong before "fixing" code.
