#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Root } from "mdast";
import { normalizeTexDelimiters } from "./normalizeTexDelimiters.js";
import { remarkGuardInlineMath } from "./guardInlineMath.js";
import { closeBrowser } from "./mermaid/toPng.js";
import { createPagerImageSink } from "./pager/imageSink.js";
import { runPager } from "./pager/run.js";
import {
  inlineImageSink,
  renderDocument,
  type RenderContext,
} from "./render.js";
import {
  exPxForCell,
  readForegroundColor,
  readTerminalMetrics,
} from "./terminal/metrics.js";

const USAGE = `mdterm — read Markdown in the terminal, with images and maths

Usage:
  mdterm <file.md> [options]

Options:
  -p, --pager    Read in a full-screen pager instead of printing once
  --scale <n>    Size of rendered maths relative to the text (default 1)
  --no-graphics  Never emit images; print text placeholders instead
  --color <hex>  Formula colour, overriding the terminal's foreground
  -h, --help     Show this message

In the pager: j/k or arrows scroll, space/b page, g/G jump to the ends, q quits.
`;

type Options = {
  file: string | null;
  pager: boolean;
  scale: number;
  graphics: boolean;
  color: string | null;
  help: boolean;
};

function parseArguments(argv: string[]): Options {
  const options: Options = {
    file: null,
    pager: false,
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
      case "-p":
      case "--pager":
        options.pager = true;
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

  // The pager needs a real terminal at both ends: keys arrive on stdin, images
  // leave on stdout. Asked for without one, it degrades to a single pass.
  const usePager =
    options.pager &&
    process.stdout.isTTY === true &&
    process.stdin.isTTY === true;
  const pagerSink = createPagerImageSink();

  const context: RenderContext = {
    metrics,
    exPx: exPxForCell(metrics.cellHeightPx, options.scale),
    foreground,
    baseDir: dirname(path),
    // Piping to a file or another program should not spray escape sequences.
    graphics: options.graphics && process.stdout.isTTY === true,
    images: usePager ? pagerSink : inlineImageSink,
    reserveImageRows: usePager,
  };

  try {
    const output = await renderDocument(tree, context);

    if (usePager) {
      await runPager({
        lines: output.split("\n"),
        expandImages: (text) => pagerSink.expand(text),
        title: basename(path),
      });
    } else {
      process.stdout.write(`${output}\n`);
    }
  } finally {
    // A borrowed browser keeps the process alive until it is let go.
    await closeBrowser();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`mdterm: ${String(error)}\n`);
  process.exitCode = 1;
});
