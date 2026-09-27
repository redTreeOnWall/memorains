import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyTextDiff, computeTextDiff } from "./textDiff";

/** Apply a diff to a plain string, to check the diff is correct on its own. */
function applyToString(
  current: string,
  diff: { start: number; deleteCount: number; insertText: string },
) {
  return (
    current.slice(0, diff.start) +
    diff.insertText +
    current.slice(diff.start + diff.deleteCount)
  );
}

describe("computeTextDiff", () => {
  it("returns null when nothing changed", () => {
    expect(computeTextDiff("abc", "abc")).toBeNull();
    expect(computeTextDiff("", "")).toBeNull();
  });

  it("reconstructs the target string from the source", () => {
    const cases: [string, string][] = [
      ["", "a"],
      ["a", ""],
      ["a", "ab"],
      ["ab", "a"],
      ["abc", "axc"],
      ["hello world", "hello brave world"],
      ["hello brave world", "hello world"],
      ["abc", "xyz"],
      ["aaaa", "aa"],
      ["prefix common suffix", "prefix inserted common suffix"],
      ["The quick brown fox", "The quick red fox"],
      ["line one\nline two", "line one\nline two\nline three"],
      ["same", "same "],
      [" same", "same"],
    ];

    for (const [current, next] of cases) {
      const diff = computeTextDiff(current, next);
      expect(
        diff,
        `diff for ${JSON.stringify(current)} -> ${JSON.stringify(next)}`,
      ).not.toBeNull();
      expect(applyToString(current, diff!)).toBe(next);
    }
  });

  it("keeps the diff minimal for a single appended character", () => {
    // The property that makes typing cheap: one keystroke must not resend the
    // whole value.
    const current = "a".repeat(500);
    const diff = computeTextDiff(current, current + "x");
    expect(diff).toEqual({ start: 500, deleteCount: 0, insertText: "x" });
  });

  it("keeps the diff minimal for a single deleted character", () => {
    const diff = computeTextDiff("hello", "hell");
    expect(diff).toEqual({ start: 4, deleteCount: 1, insertText: "" });
  });

  it("keeps the diff minimal for a single replaced character", () => {
    const diff = computeTextDiff("hello", "hallo");
    expect(diff).toEqual({ start: 1, deleteCount: 1, insertText: "a" });
  });

  it("does not confuse repeated characters", () => {
    // A naive indexOf-based diff gets this wrong; prefix/suffix trimming does not.
    const diff = computeTextDiff("aaa", "aaaa");
    expect(applyToString("aaa", diff!)).toBe("aaaa");

    const diff2 = computeTextDiff("aaaa", "aaa");
    expect(applyToString("aaaa", diff2!)).toBe("aaa");

    const diff3 = computeTextDiff("abab", "ab");
    expect(applyToString("abab", diff3!)).toBe("ab");
  });

  it("handles inserting at the very start and end", () => {
    const atStart = computeTextDiff("bc", "abc");
    expect(atStart).toEqual({ start: 0, deleteCount: 0, insertText: "a" });

    const atEnd = computeTextDiff("ab", "abc");
    expect(atEnd).toEqual({ start: 2, deleteCount: 0, insertText: "c" });
  });

  it("handles a complete replacement", () => {
    const diff = computeTextDiff("abc", "xyz");
    expect(applyToString("abc", diff!)).toBe("xyz");
    expect(diff!.insertText).toBe("xyz");
  });

  it("handles clearing and filling", () => {
    const cleared = computeTextDiff("content", "");
    expect(applyToString("content", cleared!)).toBe("");
    expect(cleared!.deleteCount).toBe(7);

    const filled = computeTextDiff("", "content");
    expect(applyToString("", filled!)).toBe("content");
  });
});

describe("applyTextDiff", () => {
  const makeText = (initial = "") => {
    const doc = new Y.Doc();
    const text = doc.getText("cell");
    if (initial) text.insert(0, initial);
    return { doc, text };
  };

  it("applies a diff to a Y.Text", () => {
    const { text } = makeText("hello");
    applyTextDiff(text, "hello world");
    expect(text.toString()).toBe("hello world");
  });

  it("returns null and makes no change for an identical value", () => {
    const { text } = makeText("same");
    expect(applyTextDiff(text, "same")).toBeNull();
    expect(text.toString()).toBe("same");
  });

  it("round-trips arbitrary edits", () => {
    const { text } = makeText("");
    const targets = [
      "a",
      "ab",
      "abc",
      "ab",
      "xbc",
      "x",
      "",
      "hello world",
      "hello world!",
    ];
    for (const target of targets) {
      applyTextDiff(text, target);
      expect(text.toString()).toBe(target);
    }
  });

  it("emits a small update for a small edit (the point of using Y.Text)", () => {
    // This is the property that justifies Y.Text cells: typing must not resend
    // the whole cell value.
    const { doc, text } = makeText("x".repeat(1000));
    let bytes = 0;
    doc.on("update", (update: Uint8Array) => {
      bytes += update.byteLength;
    });
    applyTextDiff(text, "x".repeat(1000) + "y");
    expect(text.toString()).toBe("x".repeat(1000) + "y");
    expect(bytes).toBeLessThan(50);
  });
});

describe("concurrent edits merge instead of overwriting", () => {
  /** Two docs sharing a starting cell value, used to test merge behaviour. */
  const pair = (initial: string) => {
    const seed = new Y.Doc();
    const seedText = seed.getText("cell");
    seedText.insert(0, initial);

    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(seed));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(seed));
    return { a, b };
  };

  const merge = (a: Y.Doc, b: Y.Doc) => {
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  };

  it("keeps both edits when two peers append to the same cell", () => {
    // The offline scenario: this is why text cells are Y.Text rather than a
    // string. With a string column one edit would be silently lost.
    const { a, b } = pair("Room 204");
    applyTextDiff(a.getText("cell"), "Room 204 - projector broken");
    applyTextDiff(b.getText("cell"), "Room 204 - needs 2 chairs");
    merge(a, b);

    const merged = a.getText("cell").toString();
    expect(merged).toBe(b.getText("cell").toString());
    expect(merged).toContain("projector broken");
    expect(merged).toContain("needs 2 chairs");
  });

  it("keeps both edits when peers edit different ends", () => {
    const { a, b } = pair("middle");
    applyTextDiff(a.getText("cell"), "start middle");
    applyTextDiff(b.getText("cell"), "middle end");
    merge(a, b);
    expect(a.getText("cell").toString()).toBe("start middle end");
  });

  it("converges when peers replace the whole value", () => {
    // Replacing a whole cell concurrently concatenates, which is not a value
    // either user typed. That is a UI concern: the cell editor should present the
    // merged result so it can be corrected. Assert the guarantees we actually
    // have — both peers converge, and nothing is lost.
    const { a, b } = pair("Alice");
    applyTextDiff(a.getText("cell"), "Bob");
    applyTextDiff(b.getText("cell"), "Carol");
    merge(a, b);

    const merged = a.getText("cell").toString();
    expect(merged).toBe(b.getText("cell").toString());
    expect(merged).toContain("Bob");
    expect(merged).toContain("Carol");
  });

  it("converges to identical documents after interleaved edits", () => {
    const { a, b } = pair("");
    applyTextDiff(a.getText("cell"), "one");
    applyTextDiff(b.getText("cell"), "two");
    merge(a, b);
    applyTextDiff(a.getText("cell"), a.getText("cell").toString() + "!");
    applyTextDiff(b.getText("cell"), "prefix " + b.getText("cell").toString());
    merge(a, b);

    expect(a.getText("cell").toString()).toBe(b.getText("cell").toString());
  });
});
