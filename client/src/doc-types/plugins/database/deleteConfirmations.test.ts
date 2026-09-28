import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A guard for a class of bug no unit test can see.
 *
 * `DatabaseBinding`'s destructive methods are permanent — a deleted record, column,
 * option or view is gone, with no undo. A green test on `deleteRow` asserts the CRDT
 * write; it says nothing about whether the UI asked first. That gap is how three
 * delete buttons shipped with no confirmation at all, and how
 * `db_confirm_delete_row` came to exist as an i18n key with no caller.
 *
 * The failure mode is silent and **additive**: every new call site is a fresh chance
 * to forget, and the code reads correctly either way. Multi-select row deletion is
 * planned, which will add call sites — this guard is what makes that safe to attempt.
 *
 * ## The invariant
 *
 * **A destructive call must sit inside a modal.** If it does, the user cannot reach it
 * without the modal being opened, which means the modal is what asks. If it does not —
 * a call in a live button's `onClick` — it fires on one click with nothing in between.
 *
 * That framing is deliberate rather than demanding one specific component. `TableView`
 *'s retype preview needs before/after type icons and a loss count, which a plain
 * string `content` cannot express, so it legitimately uses its own `Dialog`. The
 * invariant is about reachability, so both satisfy it and both are accepted.
 *
 * ## What it does not catch
 *
 * A destructive call in a **named** function that some live button calls
 * (`const remove = () => binding.deleteRow(id)` … `onClick={remove}`). Resolving a
 * reference textually means following identifiers, which is beyond a source scan. The
 * common mistake is the inline handler, and that is what this pins.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * Destructive binding methods.
 *
 * `setPropertyType` counts because a retype clears values it cannot convert, behind a
 * preview for exactly that reason. `initIfEmpty` does not — it seeds a default schema
 * rather than destroying one — and neither do `moveRow` / `moveProperty`, since a
 * reorder is undone by dragging back.
 */
const DESTRUCTIVE = [
  "deleteRow",
  "deleteProperty",
  "deleteOption",
  "deleteView",
  "setPropertyType",
] as const;

/**
 * Components that gate what is inside them behind an explicit user action.
 *
 * `Dialog`, `ConfirmDialog` and `Drawer` all qualify: content inside one is unreachable
 * until the user opens it, which is the property being checked.
 */
const MODALS = ["Dialog", "ConfirmDialog", "Drawer"] as const;

/** Components that render, and therefore may delete. */
function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) return componentFiles(path);
    if (!entry.endsWith(".tsx") || entry.includes(".test.")) return [];
    return [path];
  });
}

/** Index just past the `>` that closes the tag containing `from`. */
function findTagEnd(source: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i - 1] !== "\\") quote = null;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return i + 1;
  }
  return -1;
}

/**
 * The source span of every modal in a file.
 *
 * A self-closing tag contributes just itself, so `<ConfirmDialog onConfirm={…} />` is a
 * region containing its own handler. A paired tag spans to its close.
 */
/**
 * The source span of every modal in a file, as `[start, end)` offsets.
 *
 * Offsets rather than strings: a file can contain two identical region substrings
 * (two `<ConfirmDialog … />` blocks differing only in a handler name), and `indexOf`
 * would report the first one's position for both — silently checking the wrong span.
 *
 * A self-closing tag contributes just itself, so `<ConfirmDialog onConfirm={…} />`
 * contains its own handler. A paired tag spans to its close.
 */
export function modalRegions(source: string): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = [];

  for (const name of MODALS) {
    // `\b` keeps `<DialogActions` and `<DialogTitle` from matching `Dialog`.
    const pattern = new RegExp(`<${name}\\b`, "g");
    for (const match of source.matchAll(pattern)) {
      const start = match.index;
      const tagEnd = findTagEnd(source, start);
      if (tagEnd === -1) continue;

      const tag = source.slice(start, tagEnd);
      // `<ConfirmDialog … />` is its own region, handler included. Checked on the
      // closing characters rather than by searching for a close tag, which would
      // otherwise swallow the rest of the file.
      if (/\/>\s*,?\s*$/.test(tag.trimEnd())) {
        regions.push({ start, end: tagEnd });
        continue;
      }
      const close = source.indexOf(`</${name}>`, tagEnd);
      regions.push({
        start,
        end: close === -1 ? source.length : close + name.length + 3,
      });
    }
  }

  return regions;
}

/** Every index at which `source` calls a binding method. */
function callSites(source: string, method: string): number[] {
  const pattern = new RegExp(`\\.${method}\\s*\\(`, "g");
  return [...source.matchAll(pattern)].map((match) => match.index);
}

/**
 * Destructive calls reachable without opening a modal.
 *
 * Judged **per call site**, not per file: a file can render a confirmation for one
 * deletion while a different button deletes immediately, and a file-level check passes
 * on exactly that.
 *
 * @param requireConfirmation Set false for a file that legitimately writes without one
 *   — a real escape hatch, so the exception is documented here rather than the code
 *   being contorted around the guard.
 */
export function findUnconfirmedDeletions(
  source: string,
  options: { requireConfirmation?: boolean } = {},
): string[] {
  if (options.requireConfirmation === false) return [];

  const regions = modalRegions(source);
  const unguarded: string[] = [];

  for (const method of DESTRUCTIVE) {
    const sites = callSites(source, method);
    if (sites.length === 0) continue;

    const allInside = sites.every((index) =>
      regions.some((region) => index >= region.start && index < region.end),
    );
    if (!allInside) unguarded.push(method);
  }

  return unguarded;
}

describe("modalRegions", () => {
  const slice = (source: string) =>
    modalRegions(source).map((r) => source.slice(r.start, r.end));

  it("spans a paired dialog and stops at its close tag", () => {
    const source = "<Dialog><DialogActions>x</DialogActions></Dialog>after";
    const regions = slice(source);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toContain("x");
    expect(regions[0]).not.toContain("after");
  });

  it("treats a self-closing confirmation as its own region", () => {
    const source = "<ConfirmDialog onConfirm={() => go()} />tail";
    const regions = slice(source);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toContain("onConfirm");
    expect(regions[0]).not.toContain("tail");
  });

  it("does not mistake DialogTitle for Dialog", () => {
    expect(modalRegions("<DialogTitle>Hello</DialogTitle>")).toEqual([]);
  });

  it("is not confused by a brace containing an angle bracket", () => {
    const source = "<Dialog sx={{ '& > div': {} }}><b>x</b></Dialog>after";
    const regions = slice(source);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toContain("x");
    expect(regions[0]).not.toContain("after");
  });

  it("keeps two identical regions at their own offsets", () => {
    // The bug the offsets exist to prevent: string regions made `indexOf` report the
    // first block's position for both, so a call in the second was checked against the
    // first — or read as unguarded.
    const source = [
      "<ConfirmDialog onConfirm={() => a()} />",
      "filler filler filler filler",
      "<ConfirmDialog onConfirm={() => b()} />",
    ].join("\n");
    const regions = modalRegions(source);
    expect(regions).toHaveLength(2);
    const second = source.indexOf("b()");
    expect(second).toBeGreaterThan(regions[0].end);
    expect(regions[1].start).toBeLessThan(second);
    expect(regions[1].end).toBeGreaterThan(second);
  });
});

describe("findUnconfirmedDeletions", () => {
  it("flags a delete with no modal anywhere", () => {
    expect(findUnconfirmedDeletions("binding.deleteRow(row.id);")).toEqual([
      "deleteRow",
    ]);
  });

  it("accepts a delete performed by the confirmation's own handler", () => {
    const source = [
      "<IconButton onClick={() => setPending(row.id)} />",
      "<ConfirmDialog",
      "  open={pending !== null}",
      "  onConfirm={() => {",
      "    binding.deleteRow(row.id);",
      "  }}",
      "/>,",
    ].join("\n");
    expect(findUnconfirmedDeletions(source)).toEqual([]);
  });

  it("accepts a delete in a dialog's action button", () => {
    const source = [
      "<Dialog open={x}>",
      "  <DialogActions>",
      "    <Button onClick={() => binding.deleteProperty(id)}>Go</Button>",
      "  </DialogActions>",
      "</Dialog>,",
    ].join("\n");
    expect(findUnconfirmedDeletions(source)).toEqual([]);
  });

  it("flags a direct delete even when the file also renders a confirmation", () => {
    // The bug the per-call-site check exists for: a prompt is present and wired to one
    // action, while another button deletes immediately. A file-level check — the first
    // version of this guard — passes on exactly this code.
    const source = [
      "<IconButton onClick={() => binding.deleteRow(row.id)} />",
      "<ConfirmDialog open={x} onConfirm={() => binding.deleteRow(other.id)} />,",
    ].join("\n");
    expect(findUnconfirmedDeletions(source)).toEqual(["deleteRow"]);
  });

  it("flags a direct delete in a view that renders no modal at all", () => {
    const source = [
      "{rows.map((row) => (",
      "  <IconButton onClick={() => binding.deleteRow(row.id)} />",
      "))}",
    ].join("\n");
    expect(findUnconfirmedDeletions(source)).toEqual(["deleteRow"]);
  });

  it("ignores a mention inside a comment", () => {
    // A doc comment saying a view must NOT delete is not a call site.
    expect(findUnconfirmedDeletions("// never call deleteRow here")).toEqual(
      [],
    );
  });

  it("ignores non-destructive binding methods", () => {
    const source = [
      "binding.addRow({});",
      "binding.setValue(id, p, v);",
      "binding.moveRowBefore(id, null);",
      "binding.toggleMultiSelect(id, p, o);",
    ].join("\n");
    expect(findUnconfirmedDeletions(source)).toEqual([]);
  });

  it("treats a retype as destructive, since it clears values", () => {
    expect(
      findUnconfirmedDeletions("binding.setPropertyType(propId, 'number');"),
    ).toEqual(["setPropertyType"]);
  });

  it("allows an explicit opt-out", () => {
    expect(
      findUnconfirmedDeletions("binding.deleteRow(row.id);", {
        requireConfirmation: false,
      }),
    ).toEqual([]);
  });
});

describe("every destructive write in the database plugin is gated by a modal", () => {
  const root = resolve(HERE);
  const files = componentFiles(root);

  it("has no destructive call reachable without confirming", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const calls = findUnconfirmedDeletions(readFileSync(path, "utf8"));
      if (calls.length) {
        offenders.push(`${relative(root, path)}: ${calls.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually found destructive calls, so the guard cannot pass vacuously", () => {
    // A rename of `deleteRow`, or a moved file, would otherwise make the check above
    // assert nothing at all — the same trap the drag guard documents.
    const withDeletes = files.filter((path) =>
      DESTRUCTIVE.some(
        (method) => callSites(readFileSync(path, "utf8"), method).length > 0,
      ),
    );
    expect(withDeletes.length).toBeGreaterThanOrEqual(4);

    // Every destructive method must still be reachable from some file, so a method
    // that loses its UI is noticed here rather than by a user.
    const all = files.map((path) => readFileSync(path, "utf8")).join("\n");
    for (const method of DESTRUCTIVE) {
      expect(all).toContain(`.${method}(`);
    }
  });

  it("finds real modals, so the regions are not silently empty", () => {
    const withModals = files.filter(
      (path) => modalRegions(readFileSync(path, "utf8")).length > 0,
    );
    expect(withModals.length).toBeGreaterThanOrEqual(4);
  });
});
