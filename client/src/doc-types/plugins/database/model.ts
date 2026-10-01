import * as Y from "yjs";
import {
  changedKeys,
  generateNKeysBetween,
  hasUniqueKeys,
  insertKey,
  isSortedByOrder,
  keyAtEnd,
  type RebalancePlan,
} from "./fractionalIndex";
import { DROP, retypeValue, type PlainValue } from "./retype";
import {
  applyGroup,
  selectRows,
  type FilterNode,
  type RowGroup,
  type SortRule,
} from "./filterSort";
import { resolveGanttPair } from "./ganttRows";
import { clampFrozenCount } from "./columnLayout";
import { applyTextDiff } from "./textDiff";
import { suggestOptionColor } from "./optionColors";
import {
  defaultGroupByProperty,
  isChecklistPropType,
  isCalendarPropType,
  isDependencyPropType,
  isGroupablePropType,
  isMilestonePropType,
  isOptionPropType,
  isTextPropType,
  multiSelectKey,
  multiSelectPrefix,
  optionIdFromKey,
  propKey,
  randomId,
  ROW_ID_KEY,
  ROW_ORDER_KEY,
  META_KEY,
  ROWS_KEY,
  SCHEMA_KEY,
  VIEWS_KEY,
  type DateValue,
  type OptionDef,
  type PropType,
  type PropertyDef,
  type RowData,
  type ViewDef,
  type ViewLayout,
} from "./types";

export * from "./types";

/**
 * Origin tag for every transaction this plugin performs.
 *
 * `NoteDocument` ignores Yjs updates whose origin is not the editor's
 * `getOrigin()`, so the editor must return exactly this value or **edits are
 * never sent to the server**. It is also how the plugin recognises its own
 * changes when observing the document.
 */
export const DB_ORIGIN = "database";

/** Key inside `db_meta` holding the shared active-view id. */
const ACTIVE_VIEW_KEY = "activeViewId";

/**
 * Default name for a view of a given layout.
 *
 * A view's name is free-form — the user can rename it to anything — but the
 * default should describe what the view *is*. Deriving it from the layout means a
 * new view is not called "List" while showing a board.
 */
const DEFAULT_VIEW_NAME: Record<ViewLayout, string> = {
  table: "Table",
  list: "List",
  board: "Board",
  // "Journal" rather than "Calendar": this layout is a day-to-day record book
  // (habits, checklists, diary), and the name "Calendar" is kept for a future view
  // that schedules by time of day.
  journal: "Journal",
  // "Timeline" is what the axis is; "Gantt" is the model — two dates per record and a
  // bar between them. The name follows the model, because that is what a user is
  // choosing when they pick it.
  gantt: "Gantt",
};

/** The fallback name for a layout, without localisation (stored in the document). */
export const defaultViewName = (layout: ViewLayout): string =>
  DEFAULT_VIEW_NAME[layout] ?? "View";

/**
 * Default schema for a brand-new database.
 *
 * Names are stored in the document, not localised, like every other user-facing
 * string in the schema — a rename is the user's, and a collaboration cannot have two
 * people disagreeing about a column's name.
 *
 * The `Status` column is an ordinary `select`. It used to be a distinct type with
 * progress groups; that was removed (§9, "Why `status` was removed") because the only
 * behaviour groups bought — filtering by stage — was never implemented, so the type
 * cost a whole schema layer and a dialog section for nothing a `select` cannot do. The
 * column survives as a *convenience*: three options that are useful as soon as the
 * document opens, not a special type.
 */
const DEFAULT_PROPERTIES: {
  name: string;
  type: PropType;
  options?: { name: string; color: string }[];
}[] = [
  { name: "Name", type: "title" },
  {
    name: "Status",
    type: "select",
    // Deliberately the three stages people most often want, with progress-ish
    // colours: an empty select is a column the user has to configure before it is
    // any use, which is exactly what we removed `status` to avoid.
    options: [
      { name: "Not started", color: "macaron-gray" },
      { name: "In progress", color: "macaron-blue" },
      { name: "Done", color: "macaron-green" },
    ],
  },
  { name: "Notes", type: "text" },
];

/**
 * The database document model.
 *
 * Owns every read and write of `db_schema` / `db_views` / `db_rows`. Views are
 * pure renderers over `getProperties()` / `getRows()` and never touch the
 * `Y.Doc`, so the CRDT rules — transactions, origins, ordering, rebalancing —
 * live in exactly one place.
 *
 * The value-conversion rules themselves live in `retype.ts`, and text splicing
 * in `textDiff.ts`, so both are unit-testable without a `Y.Doc`.
 */
export class DatabaseBinding {
  private schema: Y.Map<Y.Map<unknown>>;
  private views: Y.Map<Y.Map<unknown>>;
  private rows: Y.Map<Y.Map<unknown>>;
  private meta: Y.Map<unknown>;

  private updateHandler: (update: Uint8Array, origin: unknown) => void;

  constructor(
    public readonly yDoc: Y.Doc,
    private onChange: () => void,
  ) {
    this.schema = yDoc.getMap(SCHEMA_KEY) as Y.Map<Y.Map<unknown>>;
    this.views = yDoc.getMap(VIEWS_KEY) as Y.Map<Y.Map<unknown>>;
    this.rows = yDoc.getMap(ROWS_KEY) as Y.Map<Y.Map<unknown>>;
    this.meta = yDoc.getMap(META_KEY);

    this.updateHandler = () => this.onChange();
    yDoc.on("update", this.updateHandler);
  }

  destroy(): void {
    this.yDoc.off("update", this.updateHandler);
  }

  private transact(fn: () => void): void {
    this.yDoc.transact(fn, DB_ORIGIN);
  }

  // --------------------------------------------------------------- lifecycle

  /**
   * Create the initial schema and view if this document is brand new.
   *
   * Safe on an existing database: content already present is left untouched.
   * One transaction, so a peer never observes a schema with no view.
   */
  initIfEmpty(): void {
    if (this.schema.size > 0) return;

    this.transact(() => {
      const orders: string[] = [];
      for (const { name, type, options } of DEFAULT_PROPERTIES) {
        const order = keyAtEnd(orders);
        orders.push(order);
        this.createProperty(name, type, order, options ?? []);
      }

      const viewId = randomId();
      const view = new Y.Map<unknown>();
      view.set("id", viewId);
      view.set("name", defaultViewName("table"));
      view.set("nameIsDefault", true);
      view.set("layout", "table");
      view.set("order", keyAtEnd([]));
      view.set("visibleProps", [] as string[]);
      this.views.set(viewId, view);
    });
  }

  /**
   * Verify the invariants the ordering scheme relies on, repairing if needed.
   *
   * A document written by a broken or older client could contain duplicate or
   * unsorted keys, which would make row order non-deterministic. Run once after
   * load, before the first render.
   *
   * @returns true if a repair was performed.
   */
  repairOrderIfNeeded(): boolean {
    const rows = this.getRows();
    if (isSortedByOrder(rows) && hasUniqueKeys(rows)) return false;
    if (rows.length === 0) return false;

    this.transact(() => {
      // Spread evenly across the whole key space. `generateNKeysBetween` leaves a
      // margin at each end so the repaired keys can still be split later.
      const keys = generateNKeysBetween(null, null, rows.length);
      rows.forEach((row, index) => {
        const doc = this.rows.get(row.id);
        if (doc) doc.set(ROW_ORDER_KEY, keys[index]);
      });
    });
    return true;
  }

  // ----------------------------------------------------------------- reading

  getProperties(): PropertyDef[] {
    const result: PropertyDef[] = [];
    this.schema.forEach((prop) => {
      result.push({
        id: prop.get("id") as string,
        name: (prop.get("name") as string) ?? "",
        type: (prop.get("type") as PropType) ?? "text",
        order: (prop.get("order") as string) ?? "",
        format: prop.get("format") as string | undefined,
        options: this.readOptions(prop),
      });
    });
    return sortByOrder(result);
  }

  private readOptions(prop: Y.Map<unknown>): OptionDef[] {
    const optionMap = prop.get("options");
    if (!(optionMap instanceof Y.Map)) return [];
    const options: OptionDef[] = [];
    optionMap.forEach((opt) => {
      const doc = opt as Y.Map<unknown>;
      options.push({
        id: doc.get("id") as string,
        name: (doc.get("name") as string) ?? "",
        color: (doc.get("color") as string) ?? "default",
        order: (doc.get("order") as string) ?? "",
      });
    });
    return sortByOrder(options);
  }

  getProperty(propId: string): PropertyDef | undefined {
    return this.getProperties().find((prop) => prop.id === propId);
  }

  getTitleProperty(): PropertyDef | undefined {
    return this.getProperties().find((prop) => prop.type === "title");
  }

  /** All rows, sorted by their own `order` key rather than by container position. */
  getRows(): RowData[] {
    const props = this.getProperties();
    const result: RowData[] = [];
    this.rows.forEach((row, rowId) => {
      const values: Record<string, unknown> = {};
      for (const prop of props) {
        if (prop.type === "multi-select") {
          // Stored as one row key per selected option; see `multiSelectKey`.
          const selected: string[] = [];
          row.forEach((_value, key) => {
            const optId = optionIdFromKey(prop.id, key);
            if (optId !== null) selected.push(optId);
          });
          if (selected.length) values[prop.id] = selected;
          continue;
        }
        const value = row.get(propKey(prop.id));
        if (value !== undefined) values[prop.id] = value;
      }
      result.push({
        id: (row.get(ROW_ID_KEY) as string) ?? rowId,
        order: (row.get(ROW_ORDER_KEY) as string) ?? "",
        values,
      });
    });
    return sortByOrder(result);
  }

  getViews(): ViewDef[] {
    const result: ViewDef[] = [];
    this.views.forEach((view) => {
      result.push({
        id: view.get("id") as string,
        name: (view.get("name") as string) ?? "View",
        nameIsDefault:
          (view.get("nameIsDefault") as boolean | undefined) ?? false,
        layout: (view.get("layout") as ViewLayout) ?? "table",
        order: (view.get("order") as string) ?? "",
        visibleProps: (view.get("visibleProps") as string[]) ?? [],
        groupBy: view.get("groupBy") as string | undefined,
        filter: view.get("filter") as FilterNode | undefined,
        sorts: (view.get("sorts") as SortRule[] | undefined) ?? [],
        hideEmptyGroups:
          (view.get("hideEmptyGroups") as boolean | undefined) ?? false,
        calendarProp: view.get("calendarProp") as string | undefined,
        checklistProp: view.get("checklistProp") as string | undefined,
        hideStreaks: (view.get("hideStreaks") as boolean | undefined) ?? false,
        startProp: view.get("startProp") as string | undefined,
        endProp: view.get("endProp") as string | undefined,
        dependencyProp: view.get("dependencyProp") as string | undefined,
        milestoneProp: view.get("milestoneProp") as string | undefined,
        columnWidths: view.get("columnWidths") as
          | Record<string, number>
          | undefined,
        frozenColumns: view.get("frozenColumns") as number | undefined,
      });
    });
    return sortByOrder(result);
  }

  /**
   * Read a `Y.Text` cell without creating one.
   *
   * Returns `null` when the cell has never been written, which callers must treat
   * as empty. Creating the `Y.Text` on read would allocate a shared type for every
   * empty cell in the table.
   */
  getText(row: RowData, propId: string): Y.Text | null {
    const value = row.values[propId];
    return value instanceof Y.Text ? value : null;
  }

  getTextString(row: RowData, propId: string): string {
    return this.getText(row, propId)?.toString() ?? "";
  }

  // ----------------------------------------------------------------- writing

  addProperty(name: string, type: PropType): string {
    let propId = "";
    this.transact(() => {
      const orders = this.getProperties().map((prop) => prop.order);
      propId = this.createProperty(name, type, keyAtEnd(orders), []);
    });
    return propId;
  }

  private createProperty(
    name: string,
    type: PropType,
    order: string,
    options: { name: string; color: string }[],
  ): string {
    const propId = randomId();
    const prop = new Y.Map<unknown>();
    prop.set("id", propId);
    prop.set("name", name);
    prop.set("type", type);
    prop.set("order", order);

    if (isOptionPropType(type) || options.length) {
      const optionMap = new Y.Map<Y.Map<unknown>>();
      const optionOrders: string[] = [];
      for (const option of options) {
        const optOrder = keyAtEnd(optionOrders);
        optionOrders.push(optOrder);
        const optId = randomId();
        const opt = new Y.Map<unknown>();
        opt.set("id", optId);
        opt.set("name", option.name);
        opt.set("color", option.color);
        opt.set("order", optOrder);
        optionMap.set(optId, opt);
      }
      prop.set("options", optionMap);
    }

    this.schema.set(propId, prop);
    return propId;
  }

  renameProperty(propId: string, name: string): void {
    const prop = this.schema.get(propId);
    if (!prop) return;
    this.transact(() => prop.set("name", name));
  }

  /**
   * Change a property's type, reinterpreting existing values.
   *
   * The conversion rules live in `retype.ts`; this method only marshals between
   * the Yjs representation and the plain values those rules operate on. Runs in a
   * single transaction so no peer can observe half-converted state.
   */
  setPropertyType(propId: string, type: PropType): void {
    const prop = this.schema.get(propId);
    if (!prop) return;
    const fromType = (prop.get("type") as PropType) ?? "text";
    if (fromType === type) return;

    this.transact(() => {
      prop.set("type", type);
      if (isOptionPropType(type) && !(prop.get("options") instanceof Y.Map)) {
        prop.set("options", new Y.Map<Y.Map<unknown>>());
      }
      // Option lists are read from the *new* schema state.
      const options = this.readOptions(prop);
      const key = propKey(propId);

      this.rows.forEach((row) => {
        // Multi-select is spread across one key per option, so the existing value
        // has to be gathered rather than read from a single key.
        const stored =
          fromType === "multi-select"
            ? gatheredMultiSelect(row, propId)
            : row.get(key);

        if (stored === undefined) return;

        const plain = toPlainValue(stored);
        const result = retypeValue(plain, fromType, type, options);

        // Clear whatever the old type stored, then write the new shape.
        if (fromType === "multi-select") {
          this.setMultiSelect(row, propId, []);
        } else {
          row.delete(key);
        }

        if (result.value === DROP) return;

        if (type === "multi-select") {
          this.setMultiSelect(row, propId, result.value);
          return;
        }
        const next = fromPlainValue(result.value, type);
        if (next !== undefined) row.set(key, next);
      });
    });
  }

  /**
   * Remove a property, its values, and every reference to it.
   *
   * `Y.Map` has no foreign keys, so referential hygiene is entirely our
   * responsibility: a dangling reference left behind would be an inconsistent
   * state that every read site would then have to defend against.
   */
  deleteProperty(propId: string): void {
    this.transact(() => {
      this.schema.delete(propId);
      const key = propKey(propId);
      const optionPrefix = multiSelectPrefix(propId);
      this.rows.forEach((row) => {
        if (row.get(key) !== undefined) row.delete(key);
        // Multi-select values live under `p:<propId>:<optId>` keys.
        const stale: string[] = [];
        row.forEach((_value, rowKey) => {
          if (rowKey.startsWith(optionPrefix)) stale.push(rowKey);
        });
        for (const rowKey of stale) row.delete(rowKey);
      });
      this.views.forEach((view) => {
        const visible = (view.get("visibleProps") as string[]) ?? [];
        if (visible.includes(propId)) {
          view.set(
            "visibleProps",
            visible.filter((id) => id !== propId),
          );
        }
        if (view.get("groupBy") === propId) view.delete("groupBy");
        // A width keyed by a column that no longer exists is not merely stale: the stored
        // record would grow with every column ever deleted, and a new column could reuse
        // an old id and inherit a width nobody chose for it.
        const widths = view.get("columnWidths") as
          | Record<string, number>
          | undefined;
        if (widths && propId in widths) {
          const next = { ...widths };
          delete next[propId];
          if (Object.keys(next).length) view.set("columnWidths", next);
          else view.delete("columnWidths");
        }
        // The journal's fields are **load-bearing**, not presentation: a day key is
        // written into `calendarProp`. A dangling id there would send writes to a
        // column that no longer exists, which is silent data loss rather than a
        // cosmetic stale reference.
        //
        // Deleting (rather than re-pointing) is correct: for this view, an absent
        // value means "choose one automatically", so the next render falls back to
        // another date column if there is one.
        if (view.get("calendarProp") === propId) view.delete("calendarProp");
        if (view.get("checklistProp") === propId) view.delete("checklistProp");
        // The Gantt fields are structural for the same reason: a bar's ends are read
        // from these ids, so a dangling one is a chart with no bars rather than a stale
        // label. Deleting is right for both — an absent start column is the view's
        // "pick one" state, and an absent end column makes every bar one day long.
        for (const key of [
          "startProp",
          "endProp",
          "dependencyProp",
          "milestoneProp",
        ] as const) {
          if (view.get(key) === propId) view.delete(key);
        }
        // A groupBy pointing at a deleted column has to go too: the Gantt view draws
        // its bar colours from it, so a stale id would leave every bar in the fallback
        // colour with no way to notice why.
      });
    });
  }

  /** Move a property to `targetIndex`, rewriting only the affected order keys. */
  moveProperty(propId: string, targetIndex: number): void {
    const others = this.getProperties().filter((prop) => prop.id !== propId);
    const clamped = Math.max(0, Math.min(targetIndex, others.length));
    const orders = others.map((prop) => prop.order);

    this.transact(() => {
      const { keys, rebalance } = insertKey(orders, clamped);
      this.applyOrderRebalance(
        others.map((prop) => prop.id),
        orders,
        rebalance,
      );
      const prop = this.schema.get(propId);
      if (prop) prop.set("order", keys[clamped]);
    });
  }

  /**
   * Move a property so it sits immediately **before** another one.
   *
   * The table's column drag knows its drop target as a *neighbour*, not as an
   * index, and `null` means "at the end". That one rule covers both ends of the
   * list — the front is "before the first column" — so no view needs to do index
   * arithmetic against a list with the dragged property removed, which is exactly
   * where an off-by-one would live.
   */
  movePropertyBefore(propId: string, beforePropId: string | null): void {
    if (propId === beforePropId) return;
    const others = this.getProperties().filter((prop) => prop.id !== propId);
    if (beforePropId === null) {
      this.moveProperty(propId, others.length);
      return;
    }
    const index = others.findIndex((prop) => prop.id === beforePropId);
    if (index < 0) return;
    this.moveProperty(propId, index);
  }

  /** Write back the replacements for a rebalanced run of rows or properties. */
  private applyOrderRebalance(
    ids: string[],
    orders: string[],
    rebalance: RebalancePlan | null,
    container: "rows" | "properties" = "properties",
  ): void {
    if (!rebalance) return;
    const store = container === "rows" ? this.rows : this.schema;
    for (const [index, newOrder] of changedKeys(orders, rebalance)) {
      const doc = store.get(ids[index]);
      if (doc) doc.set(ROW_ORDER_KEY, newOrder);
    }
  }

  // -------------------------------------------------------------------- rows

  addRow(initialValues: Record<string, unknown> = {}): string {
    const rowId = randomId();
    this.transact(() => {
      const orders = this.getRows().map((row) => row.order);
      const row = new Y.Map<unknown>();
      row.set(ROW_ID_KEY, rowId);
      row.set(ROW_ORDER_KEY, keyAtEnd(orders));
      // Attach *before* writing values. Yjs warns ("Add Yjs type to a document
      // before reading data") when a detached shared type is written to, because
      // the write has a fresh clock that is then reconciled with the parent on
      // attach. Both orders happen to work today, but only this one is silent.
      this.rows.set(rowId, row);
      for (const [propId, value] of Object.entries(initialValues)) {
        this.writeValue(row, propId, value);
      }
    });
    return rowId;
  }

  deleteRow(rowId: string): void {
    this.transact(() => this.rows.delete(rowId));
  }

  /**
   * Copy a row, placing the copy immediately after the original.
   *
   * The copy is built from the **plain** read of the source, not from its
   * `Y.Map`, so text cells become fresh `Y.Text` instances instead of shared
   * ones: two rows holding the *same* `Y.Text` object would edit as one cell,
   * which is not what "duplicate" means. `getRows()` returns the live `Y.Text`
   * object for text columns, so those are flattened to strings first; date values
   * are shallow-copied so the two rows do not share one mutable object. Copying
   * only property values also means `order` is freshly generated, so the copy
   * lands next to the original rather than at the end.
   *
   * A row id that no longer exists is a silent no-op, since it can disappear while
   * a menu is open.
   */
  duplicateRow(rowId: string): string | null {
    const source = this.getRows().find((row) => row.id === rowId);
    if (!source) return null;

    // Flatten each value to something safe to write into a *second* row.
    const copyValues: Record<string, unknown> = {};
    for (const [propId, value] of Object.entries(source.values)) {
      const property = this.getProperty(propId);
      if (property && isTextPropType(property.type)) {
        copyValues[propId] = this.getTextString(source, propId);
      } else if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        copyValues[propId] = { ...(value as Record<string, unknown>) };
      } else {
        copyValues[propId] = value;
      }
    }

    const copyId = randomId();
    this.transact(() => {
      const rows = this.getRows();
      const ids = rows.map((row) => row.id);
      const orders = rows.map((row) => row.order);
      // The source's own position, so the copy lands under the original.
      // `getRows` is sorted by `order`, so that position is exactly the
      // insertion index and no search for "which key comes next" is needed.
      const index = rows.findIndex((row) => row.id === rowId);
      const { keys, rebalance } = insertKey(orders, index + 1);
      // A crowded gap is renumbered, which changes the *surrounding* rows' keys
      // too. Skipping this would leave the copy sharing an `order` key with its
      // neighbour — the same corruption `repairOrderIfNeeded` exists to fix.
      this.applyOrderRebalance(ids, orders, rebalance, "rows");

      const copy = new Y.Map<unknown>();
      copy.set(ROW_ID_KEY, copyId);
      copy.set(ROW_ORDER_KEY, keys[index + 1]);
      // Attached first, so the value writes below happen on a type that is part of
      // the document — writing to a detached `Y.Map` makes Yjs warn.
      this.rows.set(copyId, copy);
      for (const [propId, value] of Object.entries(copyValues)) {
        this.writeValue(copy, propId, value);
      }
    });
    return copyId;
  }

  /** Set a property value, splicing `Y.Text` cells and normalising empty ones. */
  setValue(rowId: string, propId: string, value: unknown): void {
    const row = this.rows.get(rowId);
    if (!row) return;
    this.transact(() => this.writeValue(row, propId, value));
  }

  /** Set a text cell from a full string, as one minimal splice. */
  setText(rowId: string, propId: string, next: string): void {
    const row = this.rows.get(rowId);
    if (!row) return;
    this.transact(() => {
      const key = propKey(propId);
      const existing = row.get(key);
      const text = existing instanceof Y.Text ? existing : new Y.Text();
      if (!(existing instanceof Y.Text)) row.set(key, text);
      applyTextDiff(text, next);
    });
  }

  private writeValue(
    row: Y.Map<unknown>,
    propId: string,
    value: unknown,
  ): void {
    const property = this.getProperty(propId);

    if (property?.type === "multi-select") {
      this.setMultiSelect(row, propId, value);
      return;
    }

    const key = propKey(propId);

    if (property && isTextPropType(property.type)) {
      const existing = row.get(key);
      const text = existing instanceof Y.Text ? existing : new Y.Text();
      if (!(existing instanceof Y.Text)) row.set(key, text);
      applyTextDiff(text, typeof value === "string" ? value : "");
      return;
    }

    // Empty means absent: storing "" or 0 for an untouched cell would make
    // `is_empty` filtering and retype coercion both wrong.
    if (value === undefined || value === null || value === "") {
      row.delete(key);
      return;
    }
    row.set(key, value);
  }

  /**
   * Move a row to `targetIndex`.
   *
   * Rewrites only that row's `order`, never the container, so concurrent reorders
   * of different rows both survive. Repairs the surrounding run when it is
   * exhausted, which is why a rebalance can touch neighbouring rows.
   */
  moveRow(rowId: string, targetIndex: number): void {
    const others = this.getRows().filter((row) => row.id !== rowId);
    const clamped = Math.max(0, Math.min(targetIndex, others.length));
    const orders = others.map((row) => row.order);

    this.transact(() => {
      const { keys, rebalance } = insertKey(orders, clamped);
      this.applyOrderRebalance(
        others.map((row) => row.id),
        orders,
        rebalance,
        "rows",
      );
      const row = this.rows.get(rowId);
      if (row) row.set(ROW_ORDER_KEY, keys[clamped]);
    });
  }

  /**
   * Move a row so it sits immediately **before** another one; `null` means the end.
   *
   * The neighbour form of `moveRow`, for the same reason as `movePropertyBefore`:
   * the drop target the user pointed at is a row, and translating that into an
   * index in the list *without* the moved row is exactly the arithmetic a view
   * should not be doing.
   */
  moveRowBefore(rowId: string, beforeRowId: string | null): void {
    if (rowId === beforeRowId) return;
    const others = this.getRows().filter((row) => row.id !== rowId);
    if (beforeRowId === null) {
      this.moveRow(rowId, others.length);
      return;
    }
    const index = others.findIndex((row) => row.id === beforeRowId);
    if (index < 0) return;
    this.moveRow(rowId, index);
  }

  // -------------------------------------------------------------------- meta

  /**
   * Which view is open, shared with every collaborator.
   *
   * Shared rather than personal so two people looking at the same document see the
   * same slice of it — switching tabs is treated as "let's look at this", like
   * moving a shared cursor rather than a private scroll position.
   *
   * Returns `null` when unset or when the stored id no longer refers to a view
   * (deleted by anyone, including a client that had not yet seen the deletion).
   * Callers must fall back rather than assume a hit.
   */
  getActiveViewId(): string | null {
    const stored = this.meta.get(ACTIVE_VIEW_KEY);
    if (typeof stored !== "string") return null;
    // A dangling id would otherwise make the editor render nothing.
    return this.views.has(stored) ? stored : null;
  }

  /** Set the open view. Ignores an id that is not a real view. */
  setActiveViewId(viewId: string): void {
    if (!this.views.has(viewId)) return;
    if (this.getActiveViewId() === viewId) return;
    this.transact(() => this.meta.set(ACTIVE_VIEW_KEY, viewId));
  }

  /**
   * Make a name unique among the existing views by appending a number.
   *
   * Compared case-insensitively, so "List" and "list" are treated as the same name
   * — two tabs differing only in case are indistinguishable to a reader.
   */
  private uniqueViewName(base: string): string {
    const taken = new Set(
      this.getViews().map((view) => view.name.trim().toLowerCase()),
    );
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base} ${randomId().slice(0, 4)}`;
  }

  /**
   * The properties a view should render, in order.
   *
   * An empty `visibleProps` means "all of them", matching how the setting is
   * stored (the UI materialises the list only once something is hidden). A
   * `title` property is always included even if it was excluded somehow: a record
   * with no visible name is unusable, and the record panel keys off it.
   *
   * The filter also drops ids of properties that no longer exist, so a view cannot
   * ask for a column that has been deleted.
   */
  getViewProperties(viewId: string): PropertyDef[] {
    const all = this.getProperties();
    const view = this.getViews().find((candidate) => candidate.id === viewId);
    const title = all.filter((property) => property.type === "title");

    if (!view || view.visibleProps.length === 0) return all;

    const visible = all.filter((property) =>
      view.visibleProps.includes(property.id),
    );
    const missingTitle = title.filter(
      (property) => !visible.some((candidate) => candidate.id === property.id),
    );
    // Keep the declared order, then ensure the title is present.
    return [...missingTitle, ...visible].sort((a, b) =>
      a.order < b.order ? -1 : a.order > b.order ? 1 : 0,
    );
  }

  /** The open view, or the first one when unset or dangling. */
  getActiveView(): ViewDef | undefined {
    const views = this.getViews();
    const activeId = this.getActiveViewId();
    return views.find((view) => view.id === activeId) ?? views[0];
  }

  // ------------------------------------------------------------------- views

  /**
   * Create a view.
   *
   * When `name` is omitted the layout's default is used, made unique against the
   * existing views — otherwise creating three views produces three identically
   * named tabs that the user cannot tell apart.
   */
  addView(
    name: string | undefined,
    layout: ViewLayout,
    options: { isDefaultName?: boolean } = {},
  ): string {
    const viewId = randomId();
    const isDefaultName = options.isDefaultName ?? !name?.trim();
    const resolvedName = this.uniqueViewName(
      name?.trim() || defaultViewName(layout),
    );
    this.transact(() => {
      const orders = this.getViews().map((view) => view.order);
      const view = new Y.Map<unknown>();
      view.set("id", viewId);
      view.set("name", resolvedName);
      if (isDefaultName) view.set("nameIsDefault", true);
      view.set("layout", layout);
      view.set("order", keyAtEnd(orders));
      view.set("visibleProps", [] as string[]);
      // A board is meaningless without a grouping column, so open on the best
      // available one instead of an empty board that has to be configured first.
      if (layout === "board") this.applyDefaultGroupBy(view);
      this.views.set(viewId, view);
      // Creating a view means wanting to look at it.
      this.meta.set(ACTIVE_VIEW_KEY, viewId);
    });
    return viewId;
  }

  /** Rename a view. The name is now the user's, so it stops being auto-managed. */
  renameView(viewId: string, name: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.transact(() => {
      view.set("name", name);
      view.delete("nameIsDefault");
    });
  }

  /**
   * Change a view's layout.
   *
   * If the view still carries the default name for its **old** layout, the name is
   * updated to the new default. That keeps a tab honest — a view called "Table" that
   * shows a board reads as a stale label. A name the user chose is left alone, since
   * only they know what it means.
   */
  setViewLayout(viewId: string, layout: ViewLayout): void {
    const view = this.views.get(viewId);
    if (!view) return;

    // Only a name the user has not chosen is rewritten. Once they rename a view,
    // its name is theirs and changing the layout must not overwrite it.
    const isAutoNamed =
      (view.get("nameIsDefault") as boolean | undefined) === true;

    this.transact(() => {
      view.set("layout", layout);
      if (isAutoNamed) {
        const base = defaultViewName(layout);
        const others = this.getViews().filter(
          (candidate) => candidate.id !== viewId,
        );
        const taken = new Set(
          others
            .filter((candidate) => candidate.nameIsDefault)
            .map((candidate) => candidate.name.trim().toLowerCase()),
        );
        let next = base;
        for (let n = 2; taken.has(next.toLowerCase()); n++)
          next = `${base} ${n}`;
        view.set("name", next);
      }
      // Switching an ungrouped view to a board would otherwise render an empty board
      // asking to be configured. Only ever fills a *gap*: an existing groupBy is the
      // user's choice, and switching layout must not silently re-point it.
      if (layout === "board" && !view.get("groupBy"))
        this.applyDefaultGroupBy(view);
    });
  }

  /**
   * Give a board view a grouping column when it has none.
   *
   * Called only for a board that has never been grouped, so it fills a gap rather
   * than overriding a decision. Does nothing when the database has no groupable
   * property, in which case the board still explains what it needs.
   */
  private applyDefaultGroupBy(view: Y.Map<unknown>): void {
    const propId = defaultGroupByProperty(this.getProperties());
    if (propId) view.set("groupBy", propId);
  }

  /** Delete a view. Refuses to remove the last one, or there is nothing to render. */
  deleteView(viewId: string): void {
    if (this.getViews().length <= 1) return;
    const wasActive = this.getActiveViewId() === viewId;
    this.transact(() => {
      this.views.delete(viewId);
      if (wasActive) {
        // Point the shared selection at a surviving view in the same transaction,
        // so no collaborator can observe a dangling pointer.
        const remaining = this.getViews();
        if (remaining.length) this.meta.set(ACTIVE_VIEW_KEY, remaining[0].id);
      }
    });
  }

  /**
   * Point a board view at the `select` property whose options become its columns.
   *
   * A property that cannot define board columns is refused rather than stored, for
   * the same reason `setViewCalendarProp` refuses a non-date: the value is a
   * **structural** reference, and a `multi-select` column would mean a row appears
   * in several columns at once. Refusing keeps a stored `groupBy` always
   * resolvable, so the board never has to render half a grouping.
   */
  setViewGroupBy(viewId: string, propId: string | undefined): void {
    const view = this.views.get(viewId);
    if (!view) return;
    if (
      propId &&
      !isGroupablePropType(this.getProperty(propId)?.type ?? "text")
    )
      return;
    this.transact(() => {
      if (propId) view.set("groupBy", propId);
      else view.delete("groupBy");
    });
  }

  /**
   * Replace a view's filter tree, or clear it with `undefined`.
   *
   * Whole-value replacement, deliberately: a filter is a small structure the user
   * edits as a unit, and merging two concurrent edits field-by-field would produce
   * a tree neither person built.
   */
  setViewFilter(viewId: string, filter: FilterNode | undefined): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.transact(() => {
      if (filter) view.set("filter", filter);
      else view.delete("filter");
    });
  }

  /** Replace a view's sort rules. */
  setViewSorts(viewId: string, sorts: SortRule[]): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.transact(() => {
      if (sorts.length) view.set("sorts", sorts);
      else view.delete("sorts");
    });
  }

  /** Whether a board hides columns with no rows. */
  setViewHideEmptyGroups(viewId: string, hide: boolean): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.transact(() => {
      if (hide) view.set("hideEmptyGroups", true);
      else view.delete("hideEmptyGroups");
    });
  }

  /**
   * Whether the journal hides its streak bar.
   *
   * Stored as the **non-default** value only, matching `setViewHideEmptyGroups`: the
   * absence of the key means "show it", which is also what a document written before
   * streaks existed should get.
   */
  setViewHideStreaks(viewId: string, hide: boolean): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.transact(() => {
      if (hide) view.set("hideStreaks", true);
      else view.delete("hideStreaks");
    });
  }

  /**
   * A column's stored width in a view, or `undefined` when it uses the default.
   *
   * Returns the stored value unclamped; the table clamps through `columnLayout.ts`, which
   * is also where the default lives. Clamping in both places would be two definitions of
   * the bounds, and the writer's is the one that would go stale.
   */
  getViewColumnWidth(viewId: string, propId: string): number | undefined {
    const view = this.getViews().find((candidate) => candidate.id === viewId);
    return view?.columnWidths?.[propId];
  }

  /**
   * Set a column's width in a view, or clear it back to the default.
   *
   * Whole-map replacement rather than a nested shared type, for the same reason filters and
   * sorts are whole values: a width map is small and is replaced as a unit. Merging
   * field-by-field would not help either — the entries are independent, and last-write-wins
   * on one width is what a user expects when they drag a column and a collaborator drags
   * the same one.
   *
   * A width equal to the default is **deleted** rather than stored, so a view that matches
   * the default keeps no key for it and a future change to the default still reaches it.
   */
  setViewColumnWidth(
    viewId: string,
    propId: string,
    width: number | undefined,
  ): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.transact(() => {
      const current =
        (view.get("columnWidths") as Record<string, number> | undefined) ?? {};
      const next = { ...current };
      if (width === undefined) delete next[propId];
      else next[propId] = width;

      if (Object.keys(next).length) view.set("columnWidths", next);
      else view.delete("columnWidths");
    });
  }

  /**
   * How many leading columns a table view keeps in place while scrolling sideways.
   *
   * Clamped against the **visible** column count, because the setting is about what is on
   * screen: a hidden column cannot be frozen, and a count beyond the last column would
   * render as "frozen everything", which looks like the setting did nothing at all.
   */
  getViewFrozenColumns(viewId: string, columnCount: number): number {
    const view = this.getViews().find((candidate) => candidate.id === viewId);
    return clampFrozenCount(view?.frozenColumns ?? 0, columnCount);
  }

  setViewFrozenColumns(viewId: string, count: number): void {
    const view = this.views.get(viewId);
    if (!view) return;
    const columnCount = this.getViewProperties(viewId).length;
    const clamped = clampFrozenCount(count, columnCount);
    this.transact(() => {
      // The non-default value only, matching `hideEmptyGroups` and `hideStreaks`: a view
      // that was never frozen keeps no key for it.
      if (clamped > 0) view.set("frozenColumns", clamped);
      else view.delete("frozenColumns");
    });
  }

  /**
   * Point a journal view at a `date` property, or clear the choice.
   *
   * A property of the wrong type is refused rather than stored: the value is a
   * **write target** for day keys, so storing a non-date column would send the
   * writes somewhere they cannot be read back from.
   */
  setViewCalendarProp(viewId: string, propId: string | undefined): void {
    const view = this.views.get(viewId);
    if (!view) return;
    if (propId && this.getProperty(propId)?.type !== "date") return;
    this.transact(() => {
      if (propId) view.set("calendarProp", propId);
      else view.delete("calendarProp");
    });
  }

  /**
   * Point a journal view at a `multi-select` property for its completion ring.
   *
   * Same type guard as `setViewCalendarProp`, and the same reason: the value is a
   * write target for ticks.
   */
  setViewChecklistProp(viewId: string, propId: string | undefined): void {
    const view = this.views.get(viewId);
    if (!view) return;
    if (
      propId &&
      !isChecklistPropType(this.getProperty(propId)?.type ?? "text")
    )
      return;
    this.transact(() => {
      if (propId) view.set("checklistProp", propId);
      else view.delete("checklistProp");
    });
  }

  /**
   * Point a Gantt view at the columns its bars, arrows and milestones come from.
   *
   * Each is guarded by its own type and each is refused rather than coerced when the
   * type does not match, for the same reason `setViewCalendarProp` refuses a non-date:
   * these values are **read targets** with a shape attached — a bar's pixel geometry
   * comes from parsing the cell as a date — so a wrong-typed id would draw a chart of
   * nothing rather than fail.
   *
   * `startProp` and `endProp` are **not** validated against each other. Pointing both at
   * the same column is legal and means what it says: every bar is one day long, which
   * is a reasonable starting state while a schedule is being set up.
   */
  setViewGanttColumn(
    viewId: string,
    column: "startProp" | "endProp" | "dependencyProp" | "milestoneProp",
    propId: string | undefined,
  ): void {
    const view = this.views.get(viewId);
    if (!view) return;

    const accepts: Record<typeof column, (type: PropType) => boolean> = {
      startProp: isCalendarPropType,
      endProp: isCalendarPropType,
      dependencyProp: isDependencyPropType,
      milestoneProp: isMilestonePropType,
    };

    if (propId && !accepts[column](this.getProperty(propId)?.type ?? "text"))
      return;
    this.transact(() => {
      if (propId) view.set(column, propId);
      else view.delete(column);
    });
  }

  /**
   * The `date` property a journal view should use, resolved against the live schema.
   *
   * Prefers the stored choice, falls back to the first date column when it is
   * absent **or dangling** (the column was deleted), and returns `undefined` when
   * the database has no date column at all. Read-side tolerance is deliberate: the
   * stored id is a preference, and a preference that cannot be honoured is not an
   * error — it is a request to pick the best available one.
   *
   * Returns the property itself, so callers do not have to look it up again and
   * cannot accidentally use an id that resolves to nothing.
   */
  getViewCalendarProperty(viewId: string): PropertyDef | undefined {
    const properties = this.getProperties();
    const view = this.getViews().find((candidate) => candidate.id === viewId);
    const stored = view?.calendarProp
      ? properties.find(
          (property) =>
            property.id === view.calendarProp && property.type === "date",
        )
      : undefined;
    return (
      stored ??
      properties.find((property) => property.type === "date") ??
      undefined
    );
  }

  /**
   * The `multi-select` property a journal view uses for its completion ring.
   *
   * Unlike the calendar property there is **no fallback**: a checklist is optional,
   * and silently picking an arbitrary multi-select column would put a progress ring
   * on a column the user never nominated. Returns `undefined` when unset or danging.
   */
  getViewChecklistProperty(viewId: string): PropertyDef | undefined {
    const view = this.getViews().find((candidate) => candidate.id === viewId);
    if (!view?.checklistProp) return undefined;
    const property = this.getProperty(view.checklistProp);
    if (!property || !isChecklistPropType(property.type)) return undefined;
    return property;
  }

  /**
   * The three columns a Gantt view draws from, resolved against the live schema.
   *
   * The date pair goes through `resolveGanttPair` (see there for why the end is the
   * *next* date column when nothing is stored). The optional columns have no fallback and
   * each absence carries a meaning: no dependency column means no arrows, no milestone
   * column means every scheduled record is a bar.
   *
   * Wrong-typed and dangling ids resolve to `undefined` here rather than being trusted,
   * so no caller has to defend against a stored id the schema no longer agrees with: a
   * document written before this layout existed, or one whose column was retyped by a
   * collaborator, arrives as "not configured".
   */
  getViewGanttColumns(viewId: string): {
    start?: PropertyDef;
    end?: PropertyDef;
    dependency?: PropertyDef;
    milestone?: PropertyDef;
  } {
    const view = this.getViews().find((candidate) => candidate.id === viewId);
    if (!view) return {};

    const ofType = (
      propId: string | undefined,
      matches: (type: PropType) => boolean,
    ): PropertyDef | undefined => {
      if (!propId) return undefined;
      const property = this.getProperty(propId);
      return property && matches(property.type) ? property : undefined;
    };

    const dates = this.getProperties().filter((property) =>
      isCalendarPropType(property.type),
    );
    const storedStart = ofType(view.startProp, isCalendarPropType);
    const storedEnd = ofType(view.endProp, isCalendarPropType);
    const pair = resolveGanttPair(
      dates.map((property) => property.id),
      storedStart?.id,
      storedEnd?.id,
    );

    return {
      start: dates.find((property) => property.id === pair.start),
      end: dates.find((property) => property.id === pair.end),
      dependency: ofType(view.dependencyProp, isDependencyPropType),
      milestone: ofType(view.milestoneProp, isMilestonePropType),
    };
  }

  /**
   * The rows a view should show: filtered, then sorted.
   *
   * One place computes this, so every view (and the record panel's notion of
   * neighbours) agrees on what "the rows" means for a given view. Views that render
   * a subset still receive filtered rows, which is what a user expects when a view
   * has a filter.
   */
  getViewRows(viewId: string): RowData[] {
    const view = this.getViews().find((candidate) => candidate.id === viewId);
    const rows = this.getRows();
    if (!view) return rows;
    return selectRows(
      rows,
      view.filter,
      view.sorts ?? [],
      this.getProperties(),
    );
  }

  /**
   * A view's rows arranged into groups, for the board.
   *
   * Read-side tolerance for `groupBy`, matching the journal's resolvers: a stored
   * id that is missing, dangling, or names a property that cannot define board
   * columns (a `multi-select` written by an older client, before grouping was
   * restricted to `select`) yields no groups rather than a half-defined board. The
   * board then shows its "pick a column" prompt, which is the actionable state.
   */
  getViewGroups(viewId: string): RowGroup[] {
    const view = this.getViews().find((candidate) => candidate.id === viewId);
    if (!view || !view.groupBy) return [];
    const property = this.getProperty(view.groupBy);
    if (!property || !isGroupablePropType(property.type)) return [];
    return applyGroup(this.getViewRows(viewId), view.groupBy, [property], {
      hideEmpty: view.hideEmptyGroups ?? false,
    });
  }

  /**
   * A view's rows grouped by an **arbitrary** property, not by the view's own
   * `groupBy`.
   *
   * Used by a view that has to arrange rows for display without changing what the
   * view is grouped by — the list view's drag-and-drop, which buckets rows by the
   * property the list is sorted on so a drop can write that property back. Reading
   * `groupBy` would either change the document or ignore the sort the user can
   * actually see.
   */
  getViewRowGroups(viewId: string, propId: string): RowGroup[] {
    const view = this.getViews().find((candidate) => candidate.id === viewId);
    if (!view) return [];
    return applyGroup(this.getViewRows(viewId), propId, this.getProperties(), {
      hideEmpty: false,
    });
  }

  toggleViewProperty(viewId: string, propId: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.transact(() => {
      const visible = (view.get("visibleProps") as string[]) ?? [];
      // An empty list means "show all", so materialise it before toggling off —
      // otherwise hiding one column would make every other column reappear.
      const effective = visible.length
        ? visible
        : this.getProperties().map((prop) => prop.id);
      view.set(
        "visibleProps",
        effective.includes(propId)
          ? effective.filter((id) => id !== propId)
          : [...effective, propId],
      );
    });
  }

  // ----------------------------------------------------------------- options

  /**
   * Add an option to a `select` / `multi-select` column.
   *
   * `color` is optional and defaults to the next palette colour, so an option created
   * from a cell picker looks like one created in the options editor. Passing `"default"`
   * explicitly still means grey — that is a real choice, distinct from "no opinion".
   */
  addOption(propId: string, name: string, color?: string): string | null {
    const prop = this.schema.get(propId);
    if (!prop) return null;
    let optId: string | null = null;

    this.transact(() => {
      let optionMap = prop.get("options");
      if (!(optionMap instanceof Y.Map)) {
        optionMap = new Y.Map<Y.Map<unknown>>();
        prop.set("options", optionMap);
      }
      optId = randomId();
      const option = new Y.Map<unknown>();
      option.set("id", optId);
      option.set("name", name);
      option.set(
        "color",
        color ?? suggestOptionColor(this.readOptions(prop).length),
      );
      option.set(
        "order",
        keyAtEnd(this.readOptions(prop).map((opt) => opt.order)),
      );
      (optionMap as Y.Map<Y.Map<unknown>>).set(optId, option);
    });

    return optId;
  }

  /**
   * Rename an option in place.
   *
   * Row values store the option *ID*, so renaming must never delete and re-add the
   * option — that would detach every row using it.
   */
  renameOption(propId: string, optId: string, name: string): void {
    const option = this.getOptionDoc(propId, optId);
    if (!option) return;
    this.transact(() => option.set("name", name));
  }

  setOptionColor(propId: string, optId: string, color: string): void {
    const option = this.getOptionDoc(propId, optId);
    if (!option) return;
    this.transact(() => option.set("color", color));
  }

  private getOptionDoc(
    propId: string,
    optId: string,
  ): Y.Map<unknown> | undefined {
    const prop = this.schema.get(propId);
    if (!prop) return undefined;
    const optionMap = prop.get("options");
    if (!(optionMap instanceof Y.Map)) return undefined;
    return optionMap.get(optId) as Y.Map<unknown> | undefined;
  }

  /** Remove an option and clear it from every cell that used it. */
  deleteOption(propId: string, optId: string): void {
    const prop = this.schema.get(propId);
    if (!prop) return;
    const optionMap = prop.get("options");
    if (!(optionMap instanceof Y.Map)) return;

    this.transact(() => {
      optionMap.delete(optId);
      const key = propKey(propId);
      const optionKey = multiSelectKey(propId, optId);
      this.rows.forEach((row) => {
        const value = row.get(key);
        if (value === optId) row.delete(key);
        // Multi-select stores one key per option.
        if (row.get(optionKey) !== undefined) row.delete(optionKey);
      });
    });
  }

  /**
   * Replace a multi-select cell with an explicit set of option IDs.
   *
   * Each option is a separate row key, so this patches only the difference:
   * option keys that are already present are left untouched, which keeps
   * concurrent additions of *different* options from being clobbered.
   */
  private setMultiSelect(
    row: Y.Map<unknown>,
    propId: string,
    value: unknown,
  ): void {
    const next = new Set<string>(
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [],
    );

    const current = new Set<string>();
    row.forEach((_value, key) => {
      const optId = optionIdFromKey(propId, key);
      if (optId !== null) current.add(optId);
    });

    for (const optId of current) {
      if (!next.has(optId)) row.delete(multiSelectKey(propId, optId));
    }
    for (const optId of next) {
      if (!current.has(optId)) row.set(multiSelectKey(propId, optId), true);
    }
  }

  /**
   * Move an option so it sits immediately before another one.
   *
   * Option order is user data — it decides the order of a board's columns, the
   * order of the option picker, and how the column sorts. It was
   * previously "whatever order the options happened to be created in", which is not
   * an arrangement anyone chose.
   *
   * Same neighbour form as rows and columns (`moveRowBefore`), and for the same
   * reason: no caller should have to translate a drop target into an index in a list
   * with the moved option removed.
   */
  moveOptionBefore(
    propId: string,
    optId: string,
    beforeOptId: string | null,
  ): void {
    if (optId === beforeOptId) return;
    const prop = this.schema.get(propId);
    if (!prop) return;
    const others = this.readOptions(prop).filter(
      (option) => option.id !== optId,
    );
    const orders = others.map((option) => option.order);

    const index =
      beforeOptId === null
        ? others.length
        : others.findIndex((option) => option.id === beforeOptId);
    if (index < 0) return;

    this.transact(() => {
      const { keys, rebalance } = insertKey(orders, index);
      // A crowded gap renumbers the neighbourhood too, so the rebalance cannot be
      // skipped: `changedKeys` reports which options need rewriting.
      if (rebalance) {
        for (const [runIndex, newOrder] of changedKeys(orders, rebalance)) {
          const option = this.getOptionDoc(propId, others[runIndex].id);
          if (option) option.set("order", newOrder);
        }
      }
      const option = this.getOptionDoc(propId, optId);
      if (option) option.set("order", keys[index]);
    });
  }

  /** Add or remove one option on a multi-select cell. */
  toggleMultiSelect(rowId: string, propId: string, optId: string): void {
    const row = this.rows.get(rowId);
    if (!row) return;
    this.transact(() => {
      const key = multiSelectKey(propId, optId);
      // A single disjoint key per option: concurrent toggles of different options
      // cannot interfere, which a nested `Y.Map` could not guarantee.
      if (row.get(key) !== undefined) row.delete(key);
      else row.set(key, true);
    });
  }
}

/** The option IDs currently selected in a multi-select row. */
function gatheredMultiSelect(
  row: Y.Map<unknown>,
  propId: string,
): string[] | undefined {
  const ids: string[] = [];
  row.forEach((_value, key) => {
    const optId = optionIdFromKey(propId, key);
    if (optId !== null) ids.push(optId);
  });
  return ids.length ? ids : undefined;
}

/** Ascending by `order`; equal keys keep insertion order for determinism. */
function sortByOrder<T extends { order: string }>(items: T[]): T[] {
  return items.sort((a, b) =>
    a.order < b.order ? -1 : a.order > b.order ? 1 : 0,
  );
}

/**
 * Convert a stored Yjs value into the plain shape `retype.ts` understands.
 *
 * Multi-select is handled by the caller, since it is spread across one row key
 * per option and has no single stored value to convert.
 */
function toPlainValue(stored: unknown): PlainValue {
  if (stored instanceof Y.Text) return stored.toString();
  if (typeof stored === "string" || typeof stored === "number") return stored;
  if (typeof stored === "boolean") return stored;
  if (stored !== null && typeof stored === "object") return stored as DateValue;
  return null;
}

/** The stored form for a single-value cell of the given type. */
function fromPlainValue(value: PlainValue, type: PropType): unknown {
  if (value === null) return undefined;

  if (isTextPropType(type)) {
    const text = new Y.Text();
    const stringValue = typeof value === "string" ? value : String(value);
    if (stringValue) text.insert(0, stringValue);
    return text;
  }

  if (type === "multi-select") {
    // Written as one key per option by `setMultiSelect`, not as a single value.
    return Array.isArray(value) ? value : [value];
  }

  return value;
}

/**
 * Encode the initial state for a new database document.
 *
 * The default schema is created **once, at document creation**, rather than when
 * the editor opens a document whose schema happens to look empty. Seeding on open
 * is unsafe here: `NoteDocument.init()` calls `editor.onInit()` — which is when an
 * editor first sees the `Y.Doc` — *before* `initOfflineSaver()` loads the stored
 * state. Seeding at that moment writes defaults into an empty document, and then
 * the real state is applied on top, so a document ends up with two of every column
 * and two views. Deferring to "after load" does not fix it either, because a
 * document with no local copy loads empty and its content only arrives with the
 * first sync.
 *
 * Creating the state up front has no such window: the bytes are stored with the
 * document, so every client that opens it sees the same schema and no client ever
 * needs to invent one.
 */
export function buildInitialDatabaseState(): ArrayBuffer {
  const yDoc = new Y.Doc();
  const binding = new DatabaseBinding(yDoc, () => undefined);
  try {
    binding.initIfEmpty();
    return Y.encodeStateAsUpdate(yDoc).buffer as ArrayBuffer;
  } finally {
    binding.destroy();
  }
}
