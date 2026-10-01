import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A regression guard for the table's absolutely-positioned overlays.
 *
 * The resize handle and the row's affordances are `position: absolute` inside a header or
 * body cell. An absolutely-positioned box resolves its offsets against its nearest
 * **positioned** ancestor, and a `<td>` is `position: static` by default — so a cell that
 * is not itself positioned sends the overlay looking up the tree for an ancestor that is.
 *
 * The failure is silent and absurd: the handle renders hundreds of pixels from the column
 * it belongs to, so that column cannot be resized, at all, with no error, no warning, and
 * nothing failing to compile. It shipped once — the column-width work positioned only the
 * frozen cells, so every unfrozen column lost its handle.
 *
 * Asserted on source text because it is a CSS-cascade fact rather than a behaviour any
 * unit test can exercise: vitest runs without a DOM, and a synthetic event would not
 * reproduce which ancestor the browser picked.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * The cell-style helpers that must position the cell, and the overlays that need it.
 *
 * Both are read from the source rather than hard-coded, so a rename fails the test loudly
 * instead of quietly checking nothing.
 */
const POSITIONED_CELLS = ["frozenCellSx"];

describe("the table's cell overlays have a positioned ancestor", () => {
  const source = readFileSync(join(HERE, "TableView.tsx"), "utf8");

  it("positions every column cell, frozen or not", () => {
    // The helper must return a `position` on **both** branches. Returning it only for the
    // frozen case is exactly the bug: frozen columns kept their handles and unfrozen ones
    // silently lost them.
    for (const helper of POSITIONED_CELLS) {
      const start = source.indexOf(`const ${helper} =`);
      expect(
        start,
        `${helper} not found — the guard needs updating`,
      ).toBeGreaterThan(-1);
      // The helper body runs to the end of its arrow function's expression.
      const body = source.slice(start, start + 1400);
      const positions =
        body.match(/position:\s*"(sticky|relative|absolute)"/g) ?? [];
      expect(
        positions.length,
        `${helper} must set a position on every path`,
      ).toBeGreaterThanOrEqual(2);
      expect(positions).toContain('position: "relative"');
    }
  });

  it("places the resize handle as an absolute child of the cell", () => {
    // The handle is `position: absolute` with `right: -3`, which is meaningless unless the
    // cell is its containing block. This asserts the pairing rather than either half.
    const handleIndex = source.indexOf('className="column-resize"');
    expect(handleIndex).toBeGreaterThan(-1);
    const handleTag = source.slice(handleIndex, handleIndex + 1200);
    expect(handleTag).toContain('position: "absolute"');
    expect(handleTag).toContain("right:");
  });

  it("attaches the handle to every resizable column, not only the frozen ones", () => {
    // Gated on `!readOnly` and on a resize being in progress — never on being frozen.
    const handleIndex = source.indexOf('className="column-resize"');
    const before = source.slice(Math.max(0, handleIndex - 400), handleIndex);
    expect(before).toContain("!readOnly");
    expect(before).not.toContain("frozenCount");
  });
});
