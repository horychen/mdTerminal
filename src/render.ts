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
import { renderMermaidToPng } from "./mermaid/toPng.js";
import { encodeImage, type ImagePlacement } from "./terminal/kitty.js";
import { highlightCode } from "./terminal/highlight.js";
import { bold, color, dim, hexToRgb, italic, strikethrough, underline, visibleWidth } from "./terminal/ansi.js";
import type { TerminalMetrics } from "./terminal/metrics.js";

/**
 * Decides how an image reaches the screen.
 *
 * One-shot output transmits and draws in a single sequence, because the bytes
 * are written once and never revisited. A pager redraws on every keypress, so
 * it transmits each image once up front and afterwards emits only a short
 * draw-by-id command. Same renderer, different economics.
 */
export type ImageSink = {
  emit(png: Buffer, placement: ImagePlacement): string;
};

export const inlineImageSink: ImageSink = {
  emit: (png, placement) => encodeImage(png, placement),
};

export type RenderContext = {
  metrics: TerminalMetrics;
  exPx: number;
  foreground: string;
  /** Directory the document lives in, for resolving relative images. */
  baseDir: string;
  /** Terminals without the graphics protocol get text instead of pictures. */
  graphics: boolean;
  images: ImageSink;
  /**
   * Pad each picture out to the rows it covers.
   *
   * Only the pager wants this. Printing once, the terminal itself walks the
   * cursor past an image, so padding as well would double the gap. The pager
   * places every line at an absolute row instead, and needs the line model to
   * match what the screen will show.
   */
  reserveImageRows: boolean;
};

const HEADING_COLORS = ["#7aa2f7", "#7dcfff", "#9ece6a", "#e0af68", "#bb9af7", "#c0caf5"];

/** Width and height from a PNG's IHDR, or null for any other format. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const isPng =
    bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47;

  return isPng
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    : null;
}

// Used when the format's dimensions cannot be read. Both cell counts are then
// stated explicitly, so the layout is predictable even if the aspect is not.
const UNKNOWN_IMAGE_ROWS = 10;

async function renderImageFile(
  url: string,
  context: RenderContext,
): Promise<string[] | null> {
  if (!context.graphics || /^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return null;
  }

  try {
    const path = isAbsolute(url) ? url : resolve(context.baseDir, url);
    const bytes = await readFile(path);

    const columns = Math.min(context.metrics.columns - 2, 60);
    const size = pngSize(bytes);
    const rows = size
      ? Math.max(
          1,
          Math.round(
            (columns * context.metrics.cellWidthPx * (size.height / size.width)) /
              context.metrics.cellHeightPx,
          ),
        )
      : UNKNOWN_IMAGE_ROWS;

    // Both counts are given, so the row budget reserved below is exactly what
    // the terminal will use.
    const escape = context.images.emit(bytes, { columns, rows });
    return context.reserveImageRows
      ? [escape, ...Array.from({ length: rows - 1 }, () => " ")]
      : [escape];
  } catch {
    return null;
  }
}

/**
 * Mermaid's own theme is chosen from the terminal's foreground: light text
 * means a dark terminal, which wants the dark diagram palette.
 */
function diagramTheme(foreground: string): "default" | "dark" {
  const rgb = hexToRgb(foreground);
  if (!rgb) {
    return "dark";
  }

  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.5 ? "dark" : "default";
}

/**
 * A picture occupies many rows of the character grid, but the renderer emits
 * one string per line. Padding with blank lines keeps the line model and the
 * screen in agreement — without it, whatever follows is drawn over the image,
 * and a pager counting lines concludes the document fits on one screen.
 */
function asBlock(
  escape: string,
  heightPx: number,
  context: RenderContext,
): string[] {
  if (!context.reserveImageRows) {
    return [escape];
  }

  const rows = Math.max(
    1,
    Math.ceil(heightPx / context.metrics.cellHeightPx),
  );
  // A space, not an empty string: renderDocument collapses runs of blank lines,
  // and it would eat the very rows being reserved here.
  return [escape, ...Array.from({ length: rows - 1 }, () => " ")];
}

async function renderDiagram(
  code: string,
  context: RenderContext,
): Promise<string[] | null> {
  if (!context.graphics) {
    return null;
  }

  const maxWidthPx = (context.metrics.columns - 4) * context.metrics.cellWidthPx;
  const diagram = await renderMermaidToPng(code, {
    theme: diagramTheme(context.foreground),
    maxWidthPx,
  });

  if (!diagram) {
    return null;
  }

  return asBlock(context.images.emit(diagram.png, {}), diagram.heightPx, context);
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
    return context.images.emit(math.png, {});
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
      case "image":
        // Only an image that owns its paragraph becomes a picture; see the
        // paragraph case below. One sitting mid-sentence cannot reserve the
        // rows it needs without pushing the sentence apart.
        parts.push(dim(`[image: ${node.alt ?? node.url}]`));
        break;
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

    case "paragraph": {
      // A lone image is the usual way pictures appear, and owning the paragraph
      // is what lets it claim the rows it needs.
      const only = node.children.length === 1 ? node.children[0] : null;
      if (only?.type === "image") {
        const block = await renderImageFile(only.url, context);
        if (block) {
          return [`${indent}  ${block[0]}`, ...block.slice(1), ""];
        }
      }

      return [`${indent}${await renderInline(node.children, context)}`, ""];
    }

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
      if (node.lang === "mermaid") {
        const diagram = await renderDiagram(node.value, context);
        if (diagram) {
          return [
            `${indent}  ${diagram[0]}`,
            ...diagram.slice(1),
            "",
          ];
        }
        // Falls through to the highlighted source, which is what a reader
        // without a browser should see rather than an error.
      }

      const highlighted = await highlightCode(node.value, node.lang ?? null);
      const lines = highlighted.split("\n").map((line) => `${indent}  ${line}`);
      return [dim(`${indent}  ${node.lang ?? "text"}`), ...lines, ""];
    }

    case "math": {
      const latex = (node as { value: string }).value;

      if (context.graphics) {
        try {
          const math = await renderMathToPng(latex, {
            color: context.foreground,
            exPx: context.exPx,
            display: true,
          });
          const block = asBlock(context.images.emit(math.png, {}), math.heightPx, context);
          return [`${indent}  ${block[0]}`, ...block.slice(1), ""];
        } catch {
          // Falls through to the text form below.
        }
      }

      return [`${indent}  ${dim(`[${latex}]`)}`, ""];
    }

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
