/**
 * Converts a Quill delta (from Y.Text.toDelta()) to Markdown.
 *
 * Handles: bold, italic, underline, strike, inline code, links, images,
 * headers, blockquotes, ordered/bullet/checklist, code blocks.
 */
interface DeltaOperation {
  insert: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

type DeltaLines = {
  ops: DeltaOperation[];
  attributes: Record<string, unknown>;
}[];

/**
 * Convert a Quill delta array to a Markdown string.
 */
export function deltaToMarkdown(delta: DeltaOperation[]): string {
  const lines = groupLines(delta);
  const mdLines: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const attrs = line.attributes ?? {};
    const isCodeBlockLine = !!attrs["code-block"];

    if (isCodeBlockLine && !inCodeBlock) {
      const lang =
        typeof attrs["code-block"] === "string" && attrs["code-block"]
          ? (attrs["code-block"] as string)
          : "";
      mdLines.push("```" + lang);
      inCodeBlock = true;
      mdLines.push(getRawText(line.ops));
    } else if (!isCodeBlockLine && inCodeBlock) {
      mdLines.push("```");
      inCodeBlock = false;
      mdLines.push(renderLine(line.ops, attrs));
    } else if (isCodeBlockLine && inCodeBlock) {
      mdLines.push(getRawText(line.ops));
    } else {
      mdLines.push(renderLine(line.ops, attrs));
    }
  }

  if (inCodeBlock) {
    mdLines.push("```");
  }

  return mdLines.join("\n");
}

/** Get raw text from ops (no formatting). */
function getRawText(ops: DeltaOperation[]): string {
  let text = "";
  for (const op of ops) {
    if (typeof op.insert === "string") {
      text += op.insert;
    }
  }
  return text;
}

/**
 * Render a single line with block-level attributes.
 */
function renderLine(
  ops: DeltaOperation[],
  attrs: Record<string, unknown>,
): string {
  const text = renderInline(ops);

  // Empty line: still output for paragraph breaks
  if (ops.length === 0 || (ops.length === 1 && ops[0].insert === "")) {
    return "";
  }

  // Header
  const header = attrs["header"];
  if (typeof header === "number" && header >= 1 && header <= 6) {
    return "#".repeat(header) + " " + text;
  }

  // Blockquote
  if (attrs["blockquote"]) {
    return "> " + text;
  }

  // List
  const list = attrs["list"];
  if (list === "bullet" || list === "unordered") {
    return "- " + text;
  }
  if (list === "ordered") {
    return "1. " + text;
  }
  if (list === "checked") {
    return "- [x] " + text;
  }
  if (list === "unchecked") {
    return "- [ ] " + text;
  }

  // Table — not fully handled, just output as plain text
  if (attrs["table"] || attrs["table-cell"] || attrs["table-row"]) {
    return text;
  }

  return text;
}

/**
 * Render inline operations with inline formatting.
 */
function renderInline(ops: DeltaOperation[]): string {
  let result = "";

  for (const op of ops) {
    if (typeof op.insert === "string") {
      let text = op.insert;

      // Skip trailing newlines (already used for line grouping)
      if (text === "\n") continue;

      text = escapeMdText(text);
      const attrs = op.attributes ?? {};

      // Inline code — render verbatim before any other formatting
      if (attrs["code"]) {
        result += "`" + text + "`";
        continue;
      }

      // Link
      if (attrs["link"]) {
        const href = attrs["link"] as string;
        result += "[" + text + "](" + href + ")";
        continue;
      }

      // Bold
      if (attrs["bold"]) text = "**" + text + "**";
      // Italic
      if (attrs["italic"]) text = "*" + text + "*";
      // Strikethrough
      if (attrs["strike"]) text = "~~" + text + "~~";
      // Underline (no markdown equivalent, use inline HTML)
      if (attrs["underline"]) text = "<u>" + text + "</u>";

      result += text;
    } else if (typeof op.insert === "object" && op.insert !== null) {
      const embed = op.insert as Record<string, unknown>;
      if (embed["image"]) {
        const src = embed["image"] as string;
        result += "![" + (op.attributes?.["alt"] ?? "image") + "](" + src + ")";
      } else if (embed["video"]) {
        const src = embed["video"] as string;
        result += "[" + src + "](" + src + ")";
      } else if (embed["formula"]) {
        result += "$" + (embed["formula"] as string) + "$";
      }
    }
  }

  return result;
}

/**
 * Split a flat delta into lines.
 * Quill stores block-level formatting on the \n character's attributes.
 */
function groupLines(delta: DeltaOperation[]): DeltaLines {
  const lines: DeltaLines = [];
  let currentOps: DeltaOperation[] = [];
  let currentAttrs: Record<string, unknown> = {};

  for (const op of delta) {
    if (typeof op.insert === "string") {
      const parts = op.insert.split("\n");

      for (let i = 0; i < parts.length; i++) {
        // Push text segment before the \n
        if (parts[i].length > 0) {
          currentOps.push({
            insert: parts[i],
            attributes: { ...op.attributes },
          });
        }

        // If there's a \n, finalize the line
        if (i < parts.length - 1) {
          lines.push({
            ops: currentOps,
            attributes: { ...currentAttrs, ...op.attributes },
          });
          currentOps = [];
          currentAttrs = {};
        }
      }
    } else {
      // Embed (image, video, formula)
      currentOps.push({ ...op });
    }
  }

  // Flush remaining (no trailing \n)
  if (currentOps.length > 0) {
    lines.push({ ops: currentOps, attributes: { ...currentAttrs } });
  }

  return lines;
}

/**
 * Escape markdown special characters in text content.
 * Characters that have meaning in markdown are escaped so they render literally.
 */
function escapeMdText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/~/g, "\\~")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/#/g, "\\#")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
