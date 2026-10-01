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
 * Strip block and line comments, so a mention of an attribute in prose is not mistaken
 * for a use of it.
 *
 * Load-bearing for the check below: a view that explains in a comment *why* it has no
 * HTML5 drag handlers is precisely the view that does not have them, and matching the
 * word in prose would demand four handlers it deliberately omits.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * Which of the two drag systems a file uses, if either.
 *
 * **HTML5** (`draggable` + `dragstart`/`dragover`/`drop`): a whole element is picked up
 * and dropped on another, and the browser draws the avatar. Fine for reordering cards
 * and rows, where the payload is an id and a 1-pixel drop indicator is the whole
 * feedback.
 *
 * **Pointer** (`pointerdown` + a move handler): a gesture that has to be measured in
 * pixels, resized from an edge, previewed while it runs, and moved with a finger. The
 * Gantt view is the second kind — it cannot be the first, because `dragstart` cannot
 * resize and never fires for touch at all.
 *
 * Comments are stripped first, so a view that documents *why* it uses pointer events —
 * or quotes the HTML5 attribute while explaining that it does not — is measured by what
 * it does rather than by what it says.
 */
function dragKind(source: string): "html5" | "pointer" | null {
  const code = stripComments(source);
  if (!/\bdraggable\b/.test(code) && !/\bonDragStart\b/.test(code)) {
    return /\bonPointerDown\b/.test(code) ? "pointer" : null;
  }
  return "html5";
}

/**
 * The drag invariants a source file must satisfy, as a list of violations.
 *
 * Returned rather than asserted so the detector can be tested with synthetic input,
 * and so a failure names every missing piece instead of only the first.
 */
function findDragViolations(source: string): string[] {
  const kind = dragKind(source);
  if (kind === null) return [];

  // A pointer gesture has its own invariants and none of the four below: it is not a
  // drag-and-drop at all, it is a measured gesture. Checked separately rather than
  // exempted, so "this view does not drag" cannot be claimed to skip the guard.
  if (kind === "pointer") return findPointerDragViolations(source);

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

/**
 * The invariants a **pointer** drag must satisfy, as a list of violations.
 *
 * Two silent failures, neither of which throws or fails to compile:
 *
 * 1. A gesture with no release handling leaves the drag state set, so the bar stays
 *    lifted and the next gesture starts from a stale origin. Worse, `pointerup` is
 *    where the write happens here, so a drag that looks perfect commits nothing.
 *    Cancellation counts too: the browser fires `pointercancel` *instead of* `pointerup`
 *    when it takes the gesture over (a system gesture on touch).
 * 2. The pointer routinely leaves the element it was pressed on — for a left-edge
 *    resize it does so immediately — so the move events have to keep arriving. One of
 *    two mechanisms is required: `setPointerCapture` on the grabbed element, or
 *    listeners on the window. A press that reaches only its own element gives a drag
 *    that dies at its own edge.
 *
 * Both mechanisms are recognised in **either** form — React props (`onPointerUp`) or
 * `addEventListener` — because which one a gesture uses is a real design choice and the
 * invariant is about the behaviour, not the spelling. The Gantt view listens on the
 * window: capture demands a live pointer id and throws for one the browser does not
 * know, which aborts the very handler that called it.
 */
function findPointerDragViolations(source: string): string[] {
  const missing: string[] = [];
  const code = stripComments(source);

  const releases =
    /\bonPointerUp\b/.test(code) ||
    /addEventListener\s*\(\s*["']pointerup/.test(code);
  const cancels =
    /\bonPointerCancel\b/.test(code) ||
    /addEventListener\s*\(\s*["']pointercancel/.test(code);
  if (!releases || !cancels) {
    missing.push(
      "pointer drag with no release handling (onPointerUp/onPointerCancel or their window listeners): the gesture is never committed and the drag state survives",
    );
  }

  const moves =
    /\bonPointerMove\b/.test(code) ||
    /addEventListener\s*\(\s*["']pointermove/.test(code);
  if (!moves) {
    missing.push("pointer drag with no move handling");
  }

  if (
    !/setPointerCapture\s*\(/.test(code) &&
    !/window\.addEventListener/.test(code)
  ) {
    missing.push(
      "pointer drag without setPointerCapture or a window listener: the gesture dies as soon as the pointer leaves the element",
    );
  }

  return missing;
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

  it("actually finds both kinds of drag surface, so the guard cannot pass vacuously", () => {
    // A rename or a moved file would otherwise make the checks above assert nothing at
    // all — the same failure mode as a test that never runs its subject. Both kinds are
    // asserted, because the detector splitting in two means a whole branch could go
    // unexercised while every test still passes.
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
    const kinds = componentFiles(join(root, DRAG_DIRECTORY)).map((path) =>
      dragKind(readFileSync(path, "utf8")),
    );
    expect(
      kinds.filter((kind) => kind === "html5").length,
    ).toBeGreaterThanOrEqual(3);
    expect(kinds).toContain("pointer");
  });

  it("accepts a complete pointer drag", () => {
    const source = [
      "<Box onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}",
      "  onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} />",
    ].join("\n");
    expect(findDragViolations(source)).toEqual([]);
  });

  it("catches a pointer drag that never commits", () => {
    // The silent one: the bar follows the pointer and looks right, and nothing is
    // written, because the write lives in the release handler.
    const source = [
      "<Box onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={move} onPointerCancel={cancel} />",
    ].join("\n");
    expect(findDragViolations(source)).toContain(
      "pointer drag with no release handling (onPointerUp/onPointerCancel or their window listeners): the gesture is never committed and the drag state survives",
    );
  });

  it("catches a pointer drag that is not captured", () => {
    // A left-edge resize leaves the element immediately, so an uncaptured pointer
    // stops delivering moves at exactly the moment the gesture starts mattering.
    const source = [
      "<Box onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} />",
    ].join("\n");
    expect(findDragViolations(source)).toContain(
      "pointer drag without setPointerCapture or a window listener: the gesture dies as soon as the pointer leaves the element",
    );
  });

  it("accepts a pointer drag built on window listeners", () => {
    // The other legal form, and the one the Gantt view uses: capture demands a live
    // pointer id and throws for one the browser does not know, which aborts the
    // handler that called it.
    const source = [
      "useEffect(() => {",
      "  if (!drag) return;",
      "  window.addEventListener('pointermove', moveDrag);",
      "  window.addEventListener('pointerup', endDrag);",
      "  window.addEventListener('pointercancel', endDrag);",
      "}, [drag !== null]);",
    ].join("\n");
    expect(findDragViolations(source)).toEqual([]);
  });

  it("does not read the word in a comment as a drag source", () => {
    // A view documenting why it has no HTML5 handlers must not be held to them.
    const source = [
      "// this view sets no draggable attribute",
      "export const A = () => <div />;",
    ].join("\n");
    expect(findDragViolations(source)).toEqual([]);
  });
});
