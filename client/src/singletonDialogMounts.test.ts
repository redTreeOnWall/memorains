import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A regression guard for singleton-backed dialog components.
 *
 * Several dialogs in this app are driven by a **module-level singleton**
 * (`askDialog`, `datePickerDialog`): a caller invokes `service.open(...)`, which sets
 * state on one shared object, and whatever renders that object shows the dialog.
 *
 * Rendering such a component in two places does not fail, warn, or throw — both
 * mounts subscribe to the same source of truth and display an identical dialog at
 * identical coordinates. The user sees one and interacts with whichever is on top, so
 * the double mount shows up as a dialog that behaves erratically rather than as an
 * obvious duplicate.
 *
 * This was a real bug in both directions:
 *
 * - `AskDialogComponent` was mounted in **two** places (globally in `index.tsx` and
 *   again inside `TodoListEditor`), so editing a todo rendered two stacked "Edit TODO"
 *   dialogs. Confirmed in the browser: two `.MuiDialog-root` elements at identical
 *   coordinates.
 * - `DatePickerDialogComponent` was mounted in exactly **one** place — inside
 *   `TodoListEditor` — so every *other* editor opened a picker that had nowhere to
 *   render, and the date cell in the database view could not be set at all.
 *
 * The second case is why checking the count alone is not enough: it was mounted once,
 * which is the right number, in the wrong place. A count-only check would have passed
 * on the broken code. So both the count *and* the location are asserted, and the
 * location must be the application shell, which is the only place rendered on every
 * route.
 *
 * Checked on source text rather than by rendering, because there is no DOM environment
 * here and mounting the whole app to count dialogs would be far more machinery than the
 * invariant is worth.
 */

/** A component that reads its state from a module-level singleton. */
export interface SingletonComponent {
  /** The exported component name, e.g. `AskDialogComponent`. */
  name: string;
  /** The singleton it reads, e.g. `askDialog`. */
  service: string;
}

/**
 * Find singleton-backed components exported from one file's source.
 *
 * The convention this relies on, which the codebase already follows: the service file
 * exports both the singleton (`export const askDialog = new AskDialog()`) and the
 * component that renders it (`export const AskDialogComponent`). Anything matching both
 * shapes is a component that must be mounted exactly once.
 *
 * @returns one entry per singleton-backed component found.
 */
export function findSingletonComponents(source: string): SingletonComponent[] {
  // The full name including the `Component` suffix, so it can be used as a JSX tag
  // when counting mounts. Stripping the suffix would make `<Foo` fail to match
  // `<FooComponent`, since there is no word boundary inside the identifier.
  const componentNames = [
    ...source.matchAll(/export const ([A-Za-z_$][\w$]*Component)\b/g),
  ].map((match) => match[1]);

  if (componentNames.length === 0) return [];

  // The singleton instance: a module-level `new Something()`, as opposed to a `new`
  // inside a function body, which would be a fresh instance per call.
  const service =
    /^export const ([a-z_$][\w$]*) = new [A-Za-z_$][\w$]*\(\)/m.exec(
      source,
    )?.[1];
  if (!service) return [];

  return componentNames.map((name) => ({ name, service }));
}

/**
 * Count how many times each component is rendered across the given sources.
 *
 * Counts `<Name` occurrences, so `<AskDialogComponent />` and `<AskDialogComponent
 * foo>` both register, while a mention of the bare name in an import is not counted.
 */
export function countMounts(
  sources: readonly string[],
  componentName: string,
): number {
  return mountLocations(sources, componentName).length;
}

/**
 * The indices of the sources that render `componentName`.
 *
 * Returning *where* rather than only *how many* is what makes the mount-site check
 * below possible. Counting alone is not enough: the date-picker bug was mounted
 * exactly once, but inside a document editor, so it passed a count-only check while
 * still being broken for every other document type.
 */
export function mountLocations(
  sources: readonly string[],
  componentName: string,
): number[] {
  const pattern = new RegExp(`<${componentName}\\b`);
  return sources.flatMap((source, index) =>
    pattern.test(source) ? [index] : [],
  );
}

/**
 * Whether a source is the application shell.
 *
 * Identified by hosting the router rather than by filename, so a rename does not
 * silently disable these checks. The shell is mounted for every route, which is the
 * property a global dialog needs: a document editor is only mounted while its own
 * document is open, so a dialog hosted there is missing everywhere else.
 */
export function isAppShell(source: string): boolean {
  return /<BrowserRouter\b/.test(source);
}

/** Every `.tsx` file under `dir`, excluding tests and build output. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!path.endsWith(".tsx")) return [];
    return path.includes(".test.") ? [] : [path];
  });
}

describe("singleton-backed dialogs", () => {
  it("recognises a singleton component", () => {
    const source = [
      "export class AskDialog {}",
      "export const askDialog = new AskDialog();",
      "export const AskDialogComponent: React.FC = () => null;",
    ].join("\n");

    expect(findSingletonComponents(source)).toEqual([
      { name: "AskDialogComponent", service: "askDialog" },
    ]);
  });

  it("ignores a component with no singleton behind it", () => {
    const source = "export const PlainComponent: React.FC = () => null;";
    expect(findSingletonComponents(source)).toEqual([]);
  });

  it("ignores a singleton that no component renders", () => {
    const source = "export const service = new Service();";
    expect(findSingletonComponents(source)).toEqual([]);
  });

  it("ignores a per-call instance, which is not shared state", () => {
    // `new` inside a function body is a fresh object each call, so a component
    // reading it is not affected by where else it is mounted.
    const source = [
      "export const makeThing = () => new Thing();",
      "export const ThingComponent: React.FC = () => null;",
    ].join("\n");

    expect(findSingletonComponents(source)).toEqual([]);
  });

  it("counts mounts, not imports or mentions", () => {
    const sources = [
      "import { XComponent } from './x';",
      "return <XComponent />;",
      "// see XComponent for details",
    ];
    expect(countMounts(sources, "XComponent")).toBe(1);
  });

  it("reports which source mounts, not just how many", () => {
    const sources = ["nothing", "<X />", "also nothing"];
    expect(mountLocations(sources, "X")).toEqual([1]);
  });

  it("recognises the app shell by its router", () => {
    expect(isAppShell("return <BrowserRouter><Routes /></BrowserRouter>")).toBe(
      true,
    );
    expect(isAppShell("export const Editor = () => <Table />")).toBe(false);
  });

  it("is not confused by a longer similarly-prefixed name", () => {
    expect(countMounts(["<XComponentExtra />"], "XComponent")).toBe(0);
  });

  it("mounts every singleton-backed dialog exactly once, in the app shell", () => {
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
    const all = sourceFiles(root).map((path) => ({
      path,
      source: readFileSync(path, "utf8"),
    }));
    const sources = all.map((file) => file.source);

    const offenders: string[] = [];
    for (const { path, source } of all) {
      for (const { name } of findSingletonComponents(source)) {
        const where = mountLocations(sources, name);

        if (where.length !== 1) {
          offenders.push(
            `${relative(root, path)}: <${name}> mounted ${where.length}× (expected exactly 1)`,
          );
          continue;
        }

        // Exactly one mount is not sufficient: it must also be somewhere that is
        // always rendered. A single mount inside a document editor leaves the dialog
        // missing for every other route — which is precisely how the date picker was
        // unreachable in the database view.
        const mount = all[where[0]];
        if (!isAppShell(mount.source)) {
          offenders.push(
            `${relative(root, path)}: <${name}> is mounted in ${relative(root, mount.path)}, which is not the app shell — it will be missing on other routes`,
          );
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
