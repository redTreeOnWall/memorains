import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A regression guard for a class of bug that is invisible to every other test.
 *
 * MUI's `Menu` / `Popover` / `Popper` position themselves against `anchorEl`. Rendering
 * one as `open` without an `anchorEl` is not a compile error and does not throw: MUI
 * logs a prop-type warning and mounts the panel unpositioned, so the filter, sort and
 * columns panels of the database view were reachable only as a console warning.
 *
 * The check is deliberately done on source text rather than by rendering, because
 * vitest runs without a DOM here and adding jsdom just to mount ten overlays would be
 * far more machinery than the invariant deserves.
 */

/**
 * Overlays that position themselves against something, and the prop that says what.
 *
 * `anchorPosition` is accepted alongside `anchorEl` because MUI also supports
 * anchoring at raw viewport coordinates via `anchorReference="anchorPosition"`.
 */
const ANCHORED_COMPONENTS = ["Menu", "Popover", "Popper"] as const;
const ANCHOR_PROPS = ["anchorEl", "anchorPosition"] as const;

/**
 * Find the opening tags of the anchored components that lack an anchor prop.
 *
 * Returns one entry per offending tag, so a failure names every site rather than
 * only the first. Pure: it takes source text, so the detector itself can be tested
 * with synthetic input below.
 */
export function findUnanchoredOverlays(
  source: string,
): { line: number; component: string }[] {
  const found: { line: number; component: string }[] = [];
  const pattern = new RegExp(`<(${ANCHORED_COMPONENTS.join("|")})\\b`, "g");

  for (const match of source.matchAll(pattern)) {
    const tag = readOpeningTag(source, match.index + match[0].length);
    if (!ANCHOR_PROPS.some((prop) => tag.includes(prop))) {
      found.push({
        component: match[1],
        line: source.slice(0, match.index).split("\n").length,
      });
    }
  }

  return found;
}

/**
 * Return the full text of the opening tag starting at `from` (just past the element
 * name) up to and including its closing `>`.
 *
 * Brace nesting and string literals are both tracked, because an attribute value can
 * contain a `>` that would otherwise look like the end of the tag — `sx={{ "& > div":
 * {} }}` is exactly that case, and it appears in this codebase.
 */
function readOpeningTag(source: string, from: number): string {
  let braces = 0;
  let quote: string | null = null;

  for (let i = from; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (char === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") braces += 1;
    else if (char === "}") braces -= 1;
    else if (char === ">" && braces === 0) return source.slice(from, i + 1);
  }

  return source.slice(from);
}

/** Every `.tsx` file under `src/`, excluding tests and build output. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!path.endsWith(".tsx")) return [];
    return path.includes(".test.") ? [] : [path];
  });
}

describe("anchored overlays", () => {
  it("recognises an anchor however it is written", () => {
    expect(findUnanchoredOverlays("<Menu open={x} anchorEl={el} />")).toEqual(
      [],
    );
    expect(
      findUnanchoredOverlays("<Menu open={x} anchorPosition={pos} />"),
    ).toEqual([]);
  });

  it("reports an overlay with no anchor", () => {
    expect(findUnanchoredOverlays("<Menu open={x} onClose={f}>")).toEqual([
      { component: "Menu", line: 1 },
    ]);
  });

  it("is not fooled by a `>` inside an attribute value", () => {
    const source = `<Popover\n  open\n  anchorEl={el}\n  sx={{ "& > div": { p: 1 } }}\n>`;
    expect(findUnanchoredOverlays(source)).toEqual([]);
  });

  it("counts lines so the failure is locatable", () => {
    expect(findUnanchoredOverlays("a\nb\n<Popper open />")).toEqual([
      { component: "Popper", line: 3 },
    ]);
  });

  it("does not confuse a subcomponent with an anchored one", () => {
    // `<MenuItem>` must not be read as `<Menu>`.
    expect(findUnanchoredOverlays("<MenuItem value={1} />")).toEqual([]);
  });

  it("anchors every overlay in the client", () => {
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
    const offenders = sourceFiles(root).flatMap((path) =>
      findUnanchoredOverlays(readFileSync(path, "utf8")).map(
        (hit) => `${relative(root, path)}:${hit.line} <${hit.component}>`,
      ),
    );

    expect(offenders).toEqual([]);
  });
});
