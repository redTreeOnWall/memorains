import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { DatabaseBinding } from "./model";
import {
  databaseToCsv,
  databaseToMarkdownFromBinding,
  escapeCsvCell,
  escapeMarkdownCell,
} from "./exporters";

const make = () => {
  const yDoc = new Y.Doc();
  const binding = new DatabaseBinding(yDoc, () => {});
  return { yDoc, binding };
};

describe("escapeMarkdownCell", () => {
  it("escapes pipes so a table row cannot be broken", () => {
    expect(escapeMarkdownCell("a|b")).toBe("a\\|b");
  });

  it("escapes backslashes before pipes", () => {
    // Order matters: escaping pipes first would double-escape the backslash.
    expect(escapeMarkdownCell("a\\|b")).toBe("a\\\\\\|b");
  });

  it("replaces newlines with a break tag", () => {
    // A raw newline would terminate the table row.
    expect(escapeMarkdownCell("line1\nline2")).toBe("line1<br>line2");
    expect(escapeMarkdownCell("line1\r\nline2")).toBe("line1<br>line2");
  });
});

describe("escapeCsvCell", () => {
  it("quotes fields containing separators", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("leaves plain values unquoted", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("")).toBe("");
  });

  it("neutralises spreadsheet formulas", () => {
    // Values come from other users; a formula would execute when opened.
    expect(escapeCsvCell("=1+1")).toBe("\t=1+1");
    expect(escapeCsvCell("+1")).toBe("\t+1");
    expect(escapeCsvCell("-1")).toBe("\t-1");
    expect(escapeCsvCell("@SUM(A1)")).toBe("\t@SUM(A1)");
  });
});

describe("markdown export", () => {
  it("emits a table with a header and separator", () => {
    const { binding } = make();
    binding.initIfEmpty();
    const title = binding.getProperties().find((p) => p.type === "title")!;
    const rowId = binding.addRow();
    binding.setValue(rowId, title.id, "Alice");

    const markdown = databaseToMarkdownFromBinding(binding);
    const lines = markdown.split("\n");

    expect(lines[0]).toContain("Name");
    expect(lines[0]).toMatch(/^\|/);
    expect(lines[1]).toContain("---");
    expect(lines[2]).toContain("Alice");
  });

  it("includes options by name, not by id", () => {
    // Option ids are meaningless outside the document.
    const { binding } = make();
    const propId = binding.addProperty("Role", "select");
    const optId = binding.addOption(propId, "Editor")!;
    const rowId = binding.addRow();
    binding.setValue(rowId, propId, optId);

    const markdown = databaseToMarkdownFromBinding(binding);
    expect(markdown).toContain("Editor");
    expect(markdown).not.toContain(optId);
  });

  it("survives a value containing a pipe", () => {
    const { binding } = make();
    const propId = binding.addProperty("Note", "text");
    const rowId = binding.addRow();
    binding.setValue(rowId, propId, "a|b|c");

    const markdown = databaseToMarkdownFromBinding(binding);
    const dataLine = markdown.split("\n")[2];
    // The escaped pipes must not increase the column count.
    const columns = dataLine.split(/(?<!\\)\|/).length - 2;
    expect(columns).toBe(binding.getProperties().length);
  });

  it("returns an empty string for a database with no properties", () => {
    const { binding } = make();
    expect(databaseToMarkdownFromBinding(binding)).toBe("");
  });

  it("emits only the header when there are no rows", () => {
    const { binding } = make();
    binding.initIfEmpty();
    const markdown = databaseToMarkdownFromBinding(binding);
    expect(markdown.split("\n")).toHaveLength(2);
  });

  it("renders an empty text cell as empty", () => {
    const { binding } = make();
    binding.addProperty("Note", "text");
    binding.addRow();
    const markdown = databaseToMarkdownFromBinding(binding);
    expect(markdown.split("\n")[2]).toBe("|  |");
  });
});

describe("csv export", () => {
  it("emits a header row and one line per record", () => {
    const { binding } = make();
    binding.initIfEmpty();
    const title = binding.getProperties().find((p) => p.type === "title")!;
    binding.setValue(binding.addRow(), title.id, "Alice");
    binding.setValue(binding.addRow(), title.id, "Bob");

    const csv = databaseToCsv(binding);
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Name");
    expect(lines[1]).toContain("Alice");
    expect(lines[2]).toContain("Bob");
  });

  it("quotes a value containing a comma so columns do not shift", () => {
    const { binding } = make();
    const propId = binding.addProperty("Note", "text");
    binding.setValue(binding.addRow(), propId, "a, b, c");

    const csv = databaseToCsv(binding);
    expect(csv).toContain('"a, b, c"');
  });

  it("ends with a newline", () => {
    const { binding } = make();
    binding.initIfEmpty();
    expect(databaseToCsv(binding).endsWith("\n")).toBe(true);
  });

  it("includes a header even with no rows", () => {
    const { binding } = make();
    binding.initIfEmpty();
    const csv = databaseToCsv(binding);
    expect(csv.trimEnd().split("\n")).toHaveLength(1);
  });

  it("renders dates and checkboxes readably", () => {
    const { binding } = make();
    const dateProp = binding.addProperty("Due", "date");
    const checkProp = binding.addProperty("Done", "checkbox");
    const rowId = binding.addRow();
    binding.setValue(rowId, dateProp, { start: "2026-01-01" });
    binding.setValue(rowId, checkProp, true);

    const csv = databaseToCsv(binding);
    expect(csv).toContain("2026-01-01");
    expect(csv).toContain("true");
  });

  it("joins multi-select values with a comma inside a quoted field", () => {
    const { binding } = make();
    const propId = binding.addProperty("Tags", "multi-select");
    const a = binding.addOption(propId, "One")!;
    const b = binding.addOption(propId, "Two")!;
    const rowId = binding.addRow();
    binding.toggleMultiSelect(rowId, propId, a);
    binding.toggleMultiSelect(rowId, propId, b);

    const csv = databaseToCsv(binding);
    expect(csv).toContain('"One, Two"');
  });
});
