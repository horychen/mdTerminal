/**
 * Finds a Chromium-family browser already installed on this machine.
 *
 * Mermaid decides how large each node is by measuring its rendered label, and
 * only a real browser measures text correctly — jsdom has no `getBBox`, and
 * approximating it produces layouts that are wrong by orders of magnitude.
 * Rather than bundling a browser, mdTerminal borrows one if the reader has any;
 * `puppeteer-core` ships no Chromium of its own, so the install stays small.
 *
 * Nothing here fails loudly. A reader with no browser gets diagram source
 * instead of a picture, which is what every other terminal reader gives them
 * anyway.
 */

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { platform } from "node:process";

const MACOS_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const LINUX_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/brave-browser",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
];

const WINDOWS_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

let cached: string | null | undefined;

/** Path to a usable browser, or null. Probed once per process. */
export async function findBrowser(): Promise<string | null> {
  if (cached !== undefined) {
    return cached;
  }

  // An explicit choice always wins over what happens to be installed.
  const override = process.env.MDTERM_BROWSER;
  if (override && (await isExecutable(override))) {
    cached = override;
    return cached;
  }

  const candidates =
    platform === "darwin"
      ? MACOS_CANDIDATES
      : platform === "win32"
        ? WINDOWS_CANDIDATES
        : LINUX_CANDIDATES;

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      cached = candidate;
      return cached;
    }
  }

  cached = null;
  return cached;
}
