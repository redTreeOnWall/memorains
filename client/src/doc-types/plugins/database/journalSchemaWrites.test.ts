import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A regression guard for the one **silent** failure mode the renderer views share.
 *
 * Switching a view to the journal layout creates a `date` column when the database
 * has none. That write belongs to a user action — one person clicked "Journal" — and
 * the failure mode if it ever moves somewhere else is invisible:
 *
 * - If it runs during **render** (component body, `useMemo`, `useEffect`), then every
 *   client that merely *displays* the view adds a column. The document grows a
 *   duplicate column per viewer, each in that viewer's language, and nothing throws,
 *   logs, or fails to type-check. The trigger is "someone looked at it".
 * - If it runs from the **view** rather than the editor, the same thing happens
 *   whenever the view re-renders — including on every remote keystroke, since a
 *   document change bumps `revision` and re-runs the memos.
 *
 * So the invariant is a separation of roles, and it is asserted on source text
 * rather than by rendering: vitest runs without a DOM, and the bug would not raise
 * anything a test could catch anyway — it is a *missing permission*, not an error.
 *
 * The rule: **a view renders rows; only the editor, from a user action, changes the
 * schema.**
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** Files that render the journal. None of them may touch the schema. */
const RENDERERS = [
  "JournalView.tsx",
  "cards.tsx",
  "CompletionRing.tsx",
  // Gantt renders rows too, and schedules an undated one on a lane click, so the same
  // rule applies to it: a view renders rows, the editor owns the schema.
  "GanttView.tsx",
];

/** The one file allowed to write the schema on a user's behalf. */
const EDITOR = "DatabaseEditor.tsx";

/**
 * Methods that change the **schema**: the set of columns, their names, types and
 * per-view references to them.
 *
 * Deliberately excludes the row-level writers (`addRow`, `setValue`,
 * `toggleMultiSelect`). Creating a record when the user clicks a day is exactly what
 * the view is for; the rule is about columns, not rows.
 *
 * View **settings** (`setViewZoom`, `setViewFilter`, …) are in the list even though
 * they are not columns: a zoom or a filter written while rendering would be applied to
 * every collaborator by whoever merely opened the view, and the settings panels already
 * call them from a user event. They are also what a view is most tempted to "fix up"
 * on the fly — snapping a zoom, clamping a filter — so the guard is worth having there.
 * Row-level writes stay out for the reason above.
 */
const SCHEMA_WRITES = [
  "addProperty",
  "renameProperty",
  "setPropertyType",
  "deleteProperty",
  "addOption",
  "renameOption",
  "setOptionColor",
  "deleteOption",
  "moveOptionBefore",
  "moveProperty",
  "movePropertyBefore",
  "setViewCalendarProp",
  "setViewChecklistProp",
  "setViewGroupBy",
  "setViewCalendarProp",
  "setViewChecklistProp",
  "setViewGanttColumn",
  "setViewZoom",
  "setViewHideStreaks",
  "setViewHideEmptyGroups",
  "setViewFilter",
  "setViewSorts",
  "initIfEmpty",
];

/** React hooks whose bodies run during render or in response to a document change. */
const RENDER_HOOKS = ["useMemo(", "useEffect(", "useCallback("];

/** Which schema-writing methods a piece of source calls, if any. */
export function findSchemaWrites(source: string): string[] {
  return SCHEMA_WRITES.filter((method) =>
    // Anchored on the call, so a mention in a comment or a doc string does not count.
    new RegExp(`\\bthis\\?\\.?${method}\\s*\\(|\\.${method}\\s*\\(`).test(
      source,
    ),
  );
}

/**
 * The body of every `useMemo` / `useEffect` / `useCallback` call in a source file,
 * found by matching brackets from the opening parenthesis.
 *
 * Returned rather than reported directly so the detector can be tested with synthetic
 * input, and so a failure can name the hook that contains the write.
 */
export function hookBodies(source: string): { hook: string; body: string }[] {
  const bodies: { hook: string; body: string }[] = [];

  for (const hook of RENDER_HOOKS) {
    let index = source.indexOf(hook);
    while (index !== -1) {
      const open = index + hook.length - 1;
      const close = matchBracket(source, open);
      if (close !== -1) {
        bodies.push({
          hook: hook.replace("(", ""),
          body: source.slice(open, close + 1),
        });
      }
      index = source.indexOf(hook, index + hook.length);
    }
  }

  return bodies;
}

/** Index of the bracket matching the one at `open`, or -1. Quotes are respected. */
function matchBracket(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Schema writes reachable from render, as a list of violations.
 *
 * Two ways in: a view that writes the schema at all, and a write inside a hook body
 * in the editor. The second is the subtler one — the method is called from the right
 * file, but at the wrong time.
 */
export function findRenderTimeSchemaWrites(
  fileName: string,
  source: string,
): string[] {
  const violations: string[] = [];

  if (RENDERERS.includes(fileName)) {
    const writes = findSchemaWrites(source);
    if (writes.length) {
      violations.push(
        `${fileName} writes the schema (${writes.join(", ")}); a view may only ask the editor to`,
      );
    }
  }

  if (fileName === EDITOR) {
    for (const { hook, body } of hookBodies(source)) {
      const writes = findSchemaWrites(body);
      if (writes.length) {
        violations.push(
          `${hook} writes the schema (${writes.join(", ")}); it would run for every viewer`,
        );
      }
    }
  }

  return violations;
}

describe("findSchemaWrites", () => {
  it("finds a call and ignores a mention in prose", () => {
    expect(findSchemaWrites("binding.addProperty(name, 'date');")).toEqual([
      "addProperty",
    ]);
    expect(
      findSchemaWrites("// we do not call addProperty here, ever"),
    ).toEqual([]);
  });

  it("ignores row-level writers, which a view may call", () => {
    // Clicking a day creates a record: that is the feature, not a violation.
    expect(findSchemaWrites("binding.addRow({ [propId]: value })")).toEqual([]);
    expect(
      findSchemaWrites("binding.setValue(row.id, prop.id, value)"),
    ).toEqual([]);
    expect(findSchemaWrites("binding.toggleMultiSelect(row.id, p, o)")).toEqual(
      [],
    );
  });
});

describe("hookBodies", () => {
  it("extracts the whole call, so a write anywhere in the hook is seen", () => {
    // The body is the call's argument list, not just the callback: scanning the
    // dependency array too is what makes the detector catch a write placed there,
    // and costs nothing for callbacks that do not write.
    const source = `useMemo(() => f({ a: [1, 2] }), [x])`;
    const bodies = hookBodies(source);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].hook).toBe("useMemo");
    expect(bodies[0].body).toBe("(() => f({ a: [1, 2] }), [x])");
  });

  it("does not truncate on a brace or a string containing a bracket", () => {
    const source = `useEffect(() => { if (a) { b(")") } }, [a])`;
    expect(hookBodies(source)[0].body).toBe(
      `(() => { if (a) { b(")") } }, [a])`,
    );
  });

  it("finds every hook in a file", () => {
    const source = [
      "const a = useMemo(() => 1, []);",
      "const b = useCallback(() => 2, []);",
      "useEffect(() => { three(); }, []);",
    ].join("\n");
    // Grouped by hook kind rather than document order: the detector only needs every
    // body, and a kind-per-pass loop is simpler than one interleaved scan.
    expect(
      hookBodies(source)
        .map((entry) => entry.hook)
        .sort(),
    ).toEqual(["useCallback", "useEffect", "useMemo"]);
  });
});

describe("findRenderTimeSchemaWrites", () => {
  it("permits a schema write from an editor event handler", () => {
    const editor = [
      "const switchLayout = (viewId, layout) => {",
      "  binding.addProperty('Date', 'date');",
      "  binding.setViewLayout(viewId, layout);",
      "};",
    ].join("\n");
    expect(findRenderTimeSchemaWrites("DatabaseEditor.tsx", editor)).toEqual(
      [],
    );
  });

  it("catches a schema write inside a render hook", () => {
    // The silent one: a memo that "helpfully" creates the column, so every client
    // that displays the view adds one.
    const editor = [
      "const props = useMemo(() => {",
      "  if (!binding.getViewCalendarProperty(viewId)) {",
      "    binding.addProperty('Date', 'date');",
      "  }",
      "  return binding.getProperties();",
      "}, [binding, revision]);",
    ].join("\n");
    const violations = findRenderTimeSchemaWrites("DatabaseEditor.tsx", editor);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("useMemo writes the schema");
  });

  it("catches a view that writes the schema itself", () => {
    const view =
      "const calendar = useMemo(() => { binding.addProperty('D', 'date'); }, []);";
    const violations = findRenderTimeSchemaWrites("JournalView.tsx", view);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("JournalView.tsx writes the schema");
  });
});

describe("the journal's schema writes are confined to user actions", () => {
  const read = (name: string) => readFileSync(join(HERE, name), "utf8");

  it("no journal renderer writes the schema", () => {
    const offenders = RENDERERS.map((name) => ({
      name,
      violations: findRenderTimeSchemaWrites(name, read(name)),
    })).filter((entry) => entry.violations.length);

    expect(offenders).toEqual([]);
  });

  it("the editor writes the schema only outside its render hooks", () => {
    expect(findRenderTimeSchemaWrites(EDITOR, read(EDITOR))).toEqual([]);
  });

  it("actually found the creator and the hooks, so the guard is not vacuous", () => {
    // A rename would otherwise turn every assertion above into one that checks
    // nothing — the same trap the drag guard documents.
    const editor = read(EDITOR);
    expect(editor).toContain("addProperty");
    expect(hookBodies(editor).length).toBeGreaterThan(5);

    // And the renderers must be the ones rendering the journal.
    expect(read("JournalView.tsx")).toContain("JournalView");
    expect(read("JournalView.tsx")).toContain("addRow");
  });
});
