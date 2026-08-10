/**
 * Renders a Mermaid diagram to a transparent PNG.
 *
 * The diagram is drawn in a borrowed browser and captured with an element
 * screenshot rather than exported as SVG and rasterised. The browser has
 * already resolved and measured the fonts it drew with; handing that SVG to a
 * separate rasteriser reintroduces exactly the mismatch between measured and
 * rendered text that clips labels.
 *
 * One browser serves the whole run, and results are cached on disk, so a
 * document opened twice pays the launch cost once.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Browser } from "puppeteer-core";
import { findBrowser } from "./browser.js";

export type MermaidRenderOptions = {
  /** Mermaid's built-in themes; picked from the terminal's own colours. */
  theme: "default" | "dark";
  /** Widest the diagram may be, in pixels. */
  maxWidthPx: number;
};

export type RenderedDiagram = {
  png: Buffer;
  widthPx: number;
  heightPx: number;
};

const CACHE_DIR = join(tmpdir(), "mdterm-mermaid-cache");
const require = createRequire(import.meta.url);

// Retina-sharp without being wasteful.
const DEVICE_SCALE = 2;

let browserPromise: Promise<Browser | null> | null = null;

async function getBrowser(): Promise<Browser | null> {
  browserPromise ??= (async () => {
    const executablePath = await findBrowser();
    if (!executablePath) {
      return null;
    }

    const puppeteer = await import("puppeteer-core");
    return puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
    });
  })();

  try {
    return await browserPromise;
  } catch {
    return null;
  }
}

/** Shuts the borrowed browser down. Safe to call when none was started. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) {
    return;
  }

  try {
    const browser = await browserPromise;
    await browser?.close();
  } catch {
    // Nothing useful to do if it has already gone.
  } finally {
    browserPromise = null;
  }
}

function cacheKey(code: string, options: MermaidRenderOptions): string {
  const material = [code, options.theme, options.maxWidthPx].join(" ");
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

function readPngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function buildPage(mermaidSource: string, theme: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #target { display: inline-block; padding: 8px; }
</style>
</head><body>
<div id="target"></div>
<script>${mermaidSource}</script>
<script>
  // useMaxWidth defaults on, which stretches each diagram to the container's
  // width. A naturally narrow state diagram then blows up while a naturally
  // wide flowchart stays put, so the two end up at visibly different text
  // sizes in the same document. Off, every diagram renders at its own scale.
  // (No backticks in here: this whole page is a template literal.)
  const noStretch = { useMaxWidth: false };
  window.mermaid.initialize({
    startOnLoad: false,
    theme: ${JSON.stringify(theme)},
    securityLevel: 'strict',
    flowchart: noStretch,
    sequence: noStretch,
    state: noStretch,
    class: noStretch,
    er: noStretch,
    journey: noStretch,
    gantt: noStretch,
    pie: noStretch,
    gitGraph: noStretch,
  });
  window.__render = async (code) => {
    const { svg } = await window.mermaid.render('diagram', code);
    document.getElementById('target').innerHTML = svg;
    return true;
  };
</script>
</body></html>`;
}

let mermaidBundle: string | null = null;

function loadMermaidBundle(): string {
  // The page needs Mermaid itself; the UMD build runs without a module loader.
  mermaidBundle ??= require("node:fs").readFileSync(
    require.resolve("mermaid/dist/mermaid.min.js"),
    "utf8",
  ) as string;

  return mermaidBundle;
}

/**
 * Returns the rendered diagram, or null when no browser is available or the
 * diagram cannot be drawn. Callers fall back to showing the source.
 */
export async function renderMermaidToPng(
  code: string,
  options: MermaidRenderOptions,
): Promise<RenderedDiagram | null> {
  const key = cacheKey(code, options);
  const cachePath = join(CACHE_DIR, `${key}.png`);

  try {
    const cached = await readFile(cachePath);
    const { width, height } = readPngSize(cached);
    return { png: cached, widthPx: width, heightPx: height };
  } catch {
    // First sighting of this diagram.
  }

  const browser = await getBrowser();
  if (!browser) {
    return null;
  }

  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({
      width: Math.max(400, options.maxWidthPx),
      height: 600,
      deviceScaleFactor: DEVICE_SCALE,
    });
    await page.setContent(buildPage(loadMermaidBundle(), options.theme), {
      waitUntil: "domcontentloaded",
    });

    // `globalThis` rather than `window`: this closure is serialised into the
    // page, but it is type-checked here, where no DOM lib is loaded.
    const drawn = await page.evaluate(
      (source: string) =>
        (
          globalThis as unknown as { __render: (c: string) => Promise<boolean> }
        ).__render(source),
      code,
    );

    if (!drawn) {
      return null;
    }

    const target = await page.$("#target");
    if (!target) {
      return null;
    }

    const png = Buffer.from(
      await target.screenshot({ type: "png", omitBackground: true }),
    );

    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, png);

    const { width, height } = readPngSize(png);
    return { png, widthPx: width, heightPx: height };
  } catch {
    // A malformed diagram is the reader's problem to see, not a crash.
    return null;
  } finally {
    await page?.close().catch(() => undefined);
  }
}
