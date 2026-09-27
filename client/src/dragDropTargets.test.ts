import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A regression guard for a class of bug that is invisible at runtime.
 *
 * HTML5 drag and drop fails **silently** in three ways, and none of them throws,
 * logs, or fails to compile:
 *
 * 1. A drop target must call `preventDefault()` in `dragOver`. Without it the
 *    browser decides the element is not a drop target and never fires `drop` at all
 *    — the user drags, the indicator never appears, and nothing happens on release.
 * 2. Firefox (and Safari) refuse to *start* a drag unless `dragStart` sets some
 *    data on `dataTransfer`, even when the payload is carried in React state.
 * 3. A drag that ends outside any drop target still needs `onDragEnd` to clear the
 *    "which item is being dragged" state; otherwise the source stays dimmed and the
 *    next drag starts from a stale id.
 *
 * All three are asserted here on source text rather than by rendering, because
 * vitest runs without a DOM and a synthetic `DragEvent` would not reproduce a real
 * browser's decision to withhold `drop`.
 */

/** Files that make up the drag-and-drop surface of the app. */
const DRAG_DIRECTORY = "doc-types/plugins/database";

/**
 * Whether a source file participates in drag and drop at all.
 *
 * `draggable` is the signal: it is what makes an element a drag *source*, and every
 * source in this codebase also has a target in the same file, because the two are
 * halves of one interaction.
 */
function isDragSource(source: string): boolean {
  return /\bdraggable\b/.test(source);
}

/**
 * The drag invariants a source file must satisfy, as a list of violations.
 *
 * Returned rather than asserted so the detector can be tested with synthetic input,
 * and so a failure names every missing piece instead of only the first.
 */
function findDragViolations(source: string): string[] {
  if (!isDragSource(source)) return [];

  const missing: string[] = [];

  // (1) A drop must be accepted, or `drop` never fires.
  if (!source.includes("onDragOver")) {
    missing.push("no onDragOver: the browser will never fire onDrop");
  } else {
    // Scoped to each opening tag, so a comment that mentions `preventDefault()`
    // cannot satisfy the check for a handler that does not call it.
    const refusing = openingTags(source, "onDragOver").filter(
      (tag) => !tag.includes("preventDefault()"),
    );
    if (refusing.length) {
      missing.push("onDragOver without preventDefault(): the drop is refused");
    }
  }

  // (2) A drop handler, or accepting the drag accomplishes nothing.
  if (!source.includes("onDrop")) {
    missing.push("no onDrop handler");
  }

  // (3) The payload must be set at drag start, or Firefox refuses to start.
  if (!/onDragStart[\s\S]{0,600}?dataTransfer\.setData\(/.test(source)) {
    missing.push(
      "onDragStart without dataTransfer.setData(): Firefox will not drag",
    );
  }

  // (4) The in-progress state must be cleared when the drag ends anywhere.
  if (!source.includes("onDragEnd")) {
    missing.push("no onDragEnd: stale drag state survives a cancelled drag");
  }

  return missing;
}

/**
 * The opening tags that carry a given prop.
 *
 * Reads to the matching `>` with brace and quote nesting tracked, so an attribute
 * containing `>` (which `sx={{ "& > div": {} }}` does) does not truncate the tag.
 */
function openingTags(source: string, prop: string): string[] {
  const tags: string[] = [];
  let index = 0;
  while ((index = source.indexOf(prop, index)) !== -1) {
    const start = source.lastIndexOf("<", index);
    const end = findTagEnd(source, index);
    if (start !== -1 && end !== -1) tags.push(source.slice(start, end));
    index += prop.length;
  }
  return tags;
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

/** Every `.tsx` file under a directory, recursively. */
function componentFiles(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      found.push(...componentFiles(path));
    } else if (entry.endsWith(".tsx") && !entry.includes(".test.")) {
      found.push(path);
    }
  }
  return found;
}

describe("findDragViolations", () => {
  it("ignores a file that does not drag", () => {
    expect(findDragViolations("export const A = () => <div />;")).toEqual([]);
  });

  it("accepts a complete drag source and target", () => {
    const source = [
      "<Box draggable",
      "  onDragStart={(e) => e.dataTransfer.setData('text/plain', id)}",
      "  onDragEnd={end} />",
      "<Box onDragOver={(e) => e.preventDefault()} onDrop={drop} />",
    ].join("\n");
    expect(findDragViolations(source)).toEqual([]);
  });

  it("catches a drop target that never calls preventDefault", () => {
    // The silent one: the drag looks alive and `drop` is simply never delivered.
    const source = [
      "<Box draggable onDragStart={(e) => e.dataTransfer.setData('t', id)} onDragEnd={e} />",
      "<Box onDragOver={() => setTarget(id)} onDrop={drop} />",
    ].join("\n");
    expect(findDragViolations(source)).toContain(
      "onDragOver without preventDefault(): the drop is refused",
    );
  });

  it("catches a drag source with no drop handler at all", () => {
    const source =
      "<Box draggable onDragStart={() => {}} onDragEnd={() => {}} />";
    const violations = findDragViolations(source);
    expect(violations).toContain(
      "no onDragOver: the browser will never fire onDrop",
    );
    expect(violations).toContain("no onDrop handler");
  });

  it("catches a drag start that sets no dataTransfer payload", () => {
    const source = [
      "<Box draggable onDragStart={() => setDragging(id)} onDragEnd={end} />",
      "<Box onDragOver={(e) => e.preventDefault()} onDrop={drop} />",
    ].join("\n");
    expect(findDragViolations(source)).toContain(
      "onDragStart without dataTransfer.setData(): Firefox will not drag",
    );
  });

  it("catches a drag with no end handler", () => {
    const source = [
      "<Box draggable onDragStart={(e) => e.dataTransfer.setData('t', id)} />",
      "<Box onDragOver={(e) => e.preventDefault()} onDrop={drop} />",
    ].join("\n");
    expect(findDragViolations(source)).toContain(
      "no onDragEnd: stale drag state survives a cancelled drag",
    );
  });

  it("does not mistake a mention for a handler", () => {
    // `// does not preventDefault()` in a comment must not satisfy the check,
    // which is why the pattern is anchored on the prop rather than the call.
    const source = [
      "<Box draggable onDragStart={(e) => e.dataTransfer.setData('t', id)} onDragEnd={end} />",
      "// onDragOver would preventDefault() here",
      "<Box onDragOver={() => setTarget(id)} onDrop={drop} />",
    ].join("\n");
    expect(findDragViolations(source)).toContain(
      "onDragOver without preventDefault(): the drop is refused",
    );
  });
});

describe("the database views' drag and drop is complete", () => {
  it("every file with a draggable element has a working drop target", () => {
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
    const offenders: string[] = [];

    for (const path of componentFiles(join(root, DRAG_DIRECTORY))) {
      const source = readFileSync(path, "utf8");
      const violations = findDragViolations(source);
      if (violations.length) {
        offenders.push(`${relative(root, path)}: ${violations.join("; ")}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("actually finds drag sources, so the guard cannot pass vacuously", () => {
    // A rename or a moved file would otherwise make the check above assert nothing
    // at all — the same failure mode as a test that never runs its subject.
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
    const sources = componentFiles(join(root, DRAG_DIRECTORY)).filter((path) =>
      isDragSource(readFileSync(path, "utf8")),
    );
    expect(sources.length).toBeGreaterThanOrEqual(3);
  });
});
