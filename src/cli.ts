#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root } from "mdast";
import { normalizeTexDelimiters } from "./normalizeTexDelimiters.js";
import { remarkGuardInlineMath } from "./guardInlineMath.js";
import { renderDocument, type RenderContext } from "./render.js";
import {
  exPxForCell,
  readForegroundColor,
  readTerminalMetrics,
} from "./terminal/metrics.js";

const USAGE = `mdterm — read Markdown in the terminal, with images and maths

Usage:
  mdterm <file.md> [options]

Options:
  --scale <n>    Size of rendered maths relative to the text (default 1)
  --no-graphics  Never emit images; print text placeholders instead
  --color <hex>  Formula colour, overriding the terminal's foreground
  -h, --help     Show this message
`;

type Options = {
  file: string | null;
  scale: number;
  graphics: boolean;
  color: string | null;
  help: boolean;
};

function parseArguments(argv: string[]): Options {
  const options: Options = {
    file: null,
    scale: 1,
    graphics: true,
    color: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--no-graphics":
        options.graphics = false;
        break;
      case "--scale":
        options.scale = Number(argv[++index]) || 1;
        break;
      case "--color":
        options.color = argv[++index] ?? null;
        break;
      default:
        if (!argument.startsWith("-")) {
          options.file ??= argument;
        }
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  if (options.help || !options.file) {
    process.stdout.write(USAGE);
    process.exitCode = options.file ? 0 : 1;
    return;
  }

  const path = resolve(options.file);

  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    process.stderr.write(`mdterm: cannot read ${options.file}\n`);
    process.exitCode = 1;
    return;
  }

  const metrics = await readTerminalMetrics();
  const foreground = options.color ?? (await readForegroundColor()) ?? "#c0caf5";

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkGuardInlineMath);

  // The delimiter rewrite has to happen before parsing: CommonMark treats `(`
  // and `[` as escapable, so `\(x\)` loses its backslashes during parse and
  // becomes indistinguishable from a literal `(x)`.
  const tree = processor.runSync(
    processor.parse(normalizeTexDelimiters(source)),
  ) as Root;

  const context: RenderContext = {
    metrics,
    exPx: exPxForCell(metrics.cellHeightPx, options.scale),
    foreground,
    baseDir: dirname(path),
    // Piping to a file or a pager should not spray escape sequences.
    graphics: options.graphics && process.stdout.isTTY === true,
  };

  process.stdout.write(`${await renderDocument(tree, context)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`mdterm: ${String(error)}\n`);
  process.exitCode = 1;
});
