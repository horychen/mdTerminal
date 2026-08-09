/**
 * Renders an mdast tree to a terminal byte stream.
 *
 * Block elements each produce their own lines; inline elements return strings
 * that the block level assembles. Images and formulas are the exception: they
 * are escape sequences embedded in the text flow, which the terminal draws over
 * the cells the cursor passes.
 */

import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Root, RootContent, PhrasingContent, TableRow } from "mdast";
import { renderMathToPng } from "./math/toPng.js";
import { toUnicode } from "./math/unicode.js";
import { encodeImage } from "./terminal/kitty.js";
import { highlightCode } from "./terminal/highlight.js";
import { bold, color, dim, italic, strikethrough, underline, visibleWidth } from "./terminal/ansi.js";
import type { TerminalMetrics } from "./terminal/metrics.js";

export type RenderContext = {
  metrics: TerminalMetrics;
  exPx: number;
  foreground: string;
  /** Directory the document lives in, for resolving relative images. */
  baseDir: string;
  /** Terminals without the graphics protocol get text instead of pictures. */
  graphics: boolean;
};

const HEADING_COLORS = ["#7aa2f7", "#7dcfff", "#9ece6a", "#e0af68", "#bb9af7", "#c0caf5"];

async function renderImageFile(
  url: string,
  context: RenderContext,
): Promise<string | null> {
  if (!context.graphics || /^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return null;
  }

  try {
    const path = isAbsolute(url) ? url : resolve(context.baseDir, url);
    const bytes = await readFile(path);
    return encodeImage(bytes, { columns: Math.min(context.metrics.columns - 2, 60) });
  } catch {
    return null;
  }
}

async function renderMath(
  latex: string,
  display: boolean,
  context: RenderContext,
): Promise<string> {
  // Real text beats a picture whenever it is available: it can be selected,
  // copied, and searched.
  if (!display) {
    const unicode = toUnicode(latex);
    if (unicode.convertible) {
      return unicode.text;
    }
  }

  if (!context.graphics) {
    return dim(display ? `[${latex}]` : `$${latex}$`);
  }

  try {
    const math = await renderMathToPng(latex, {
      color: context.foreground,
      exPx: context.exPx,
      display,
    });
    return encodeImage(math.png, {});
  } catch {
    return dim(display ? `[${latex}]` : `$${latex}$`);
  }
}

async function renderInline(
  nodes: PhrasingContent[],
  context: RenderContext,
): Promise<string> {
  const parts: string[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        parts.push(node.value);
        break;
      case "strong":
        parts.push(bold(await renderInline(node.children, context)));
        break;
      case "emphasis":
        parts.push(italic(await renderInline(node.children, context)));
        break;
      case "delete":
        parts.push(strikethrough(await renderInline(node.children, context)));
        break;
      case "inlineCode":
        parts.push(color(node.value, "#e0af68"));
        break;
      case "link": {
        const label = await renderInline(node.children, context);
        parts.push(`${underline(label)}${dim(` (${node.url})`)}`);
        break;
      }
      case "image": {
        const image = await renderImageFile(node.url, context);
        parts.push(image ?? dim(`[image: ${node.alt ?? node.url}]`));
        break;
      }
      case "break":
        parts.push("\n");
        break;
      case "inlineMath":
        parts.push(await renderMath((node as { value: string }).value, false, context));
        break;
      default:
        if ("children" in node) {
          parts.push(await renderInline(node.children as PhrasingContent[], context));
        } else if ("value" in node) {
          parts.push(String(node.value));
        }
    }
  }

  return parts.join("");
}

async function renderTable(
  rows: TableRow[],
  context: RenderContext,
): Promise<string[]> {
  const cells: string[][] = [];

  for (const row of rows) {
    const rendered: string[] = [];
    for (const cell of row.children) {
      rendered.push(await renderInline(cell.children, context));
    }
    cells.push(rendered);
  }

  const columnCount = Math.max(...cells.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(...cells.map((row) => visibleWidth(row[index] ?? ""))),
  );

  const pad = (text: string, width: number) =>
    text + " ".repeat(Math.max(0, width - visibleWidth(text)));

  const lines: string[] = [];

  cells.forEach((row, rowIndex) => {
    const line = widths
      .map((width, index) => pad(row[index] ?? "", width))
      .join(dim(" │ "));
    lines.push(`  ${line}`);

    if (rowIndex === 0) {
      lines.push(`  ${dim(widths.map((w) => "─".repeat(w)).join("─┼─"))}`);
    }
  });

  return lines;
}

async function renderBlock(
  node: RootContent,
  context: RenderContext,
  indent: string,
): Promise<string[]> {
  switch (node.type) {
    case "heading": {
      const text = await renderInline(node.children, context);
      const hue = HEADING_COLORS[Math.min(node.depth - 1, HEADING_COLORS.length - 1)];
      return ["", `${indent}${bold(color(text, hue))}`, ""];
    }

    case "paragraph":
      return [`${indent}${await renderInline(node.children, context)}`, ""];

    case "blockquote": {
      const inner: string[] = [];
      for (const child of node.children) {
        inner.push(...(await renderBlock(child, context, "")));
      }
      return inner.map((line) => `${indent}${dim("│ ")}${line}`);
    }

    case "list": {
      const lines: string[] = [];
      let counter = node.start ?? 1;

      for (const item of node.children) {
        const marker = node.ordered ? `${counter++}.` : "•";
        const checkbox =
          item.checked === null || item.checked === undefined
            ? ""
            : item.checked
              ? "[x] "
              : "[ ] ";

        const inner: string[] = [];
        for (const child of item.children) {
          inner.push(...(await renderBlock(child, context, "")));
        }

        const body = inner.filter((line, index) => line !== "" || index < inner.length - 1);
        body.forEach((line, index) => {
          lines.push(
            index === 0
              ? `${indent}  ${color(marker, "#7aa2f7")} ${checkbox}${line}`
              : `${indent}    ${line}`,
          );
        });
      }

      lines.push("");
      return lines;
    }

    case "code": {
      const highlighted = await highlightCode(node.value, node.lang ?? null);
      const lines = highlighted.split("\n").map((line) => `${indent}  ${line}`);
      return [dim(`${indent}  ${node.lang ?? "text"}`), ...lines, ""];
    }

    case "math":
      return [
        `${indent}  ${await renderMath((node as { value: string }).value, true, context)}`,
        "",
      ];

    case "table":
      return [...(await renderTable(node.children, context)), ""];

    case "thematicBreak":
      return [dim(indent + "─".repeat(Math.min(context.metrics.columns - 4, 60))), ""];

    case "html":
      return [];

    default:
      if ("children" in node) {
        const lines: string[] = [];
        for (const child of node.children as RootContent[]) {
          lines.push(...(await renderBlock(child, context, indent)));
        }
        return lines;
      }
      return [];
  }
}

export async function renderDocument(
  tree: Root,
  context: RenderContext,
): Promise<string> {
  const lines: string[] = [];

  for (const node of tree.children) {
    lines.push(...(await renderBlock(node, context, "")));
  }

  // Collapse the runs of blank lines that block spacing naturally produces.
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimStart();
}

export { dirname };
