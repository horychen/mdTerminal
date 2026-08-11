/**
 * A full-screen pager.
 *
 * Piping to `less` was never an option: the graphics escape sequences do not
 * survive a pager that does not understand them, so scrolling had to be built
 * here or not exist.
 *
 * The document is rendered once into an array of lines. Scrolling then only
 * changes which slice of that array is painted, so no Markdown is reparsed and
 * no image is re-rendered while the reader moves.
 */

import { encodeClearPlacements } from "../terminal/kitty.js";
import { dim } from "../terminal/ansi.js";

const ESC = String.fromCharCode(0x1b);
const CSI = `${ESC}[`;

const ENTER_FULLSCREEN = `${CSI}?1049h`;
const LEAVE_FULLSCREEN = `${CSI}?1049l`;
const HIDE_CURSOR = `${CSI}?25l`;
const SHOW_CURSOR = `${CSI}?25h`;
const CLEAR_SCREEN = `${CSI}2J${CSI}H`;

export type PagerOptions = {
  lines: string[];
  /** Turns the renderer's image markers into escape sequences. */
  expandImages: (text: string) => string;
  title: string;
};

type Key =
  | "down"
  | "up"
  | "pageDown"
  | "pageUp"
  | "top"
  | "bottom"
  | "quit"
  | "redraw"
  | "ignore";

// Spelled by code point rather than pasted, so they survive every editor.
const CTRL_C = String.fromCharCode(0x03);
const CTRL_D = String.fromCharCode(0x04);
const CTRL_L = String.fromCharCode(0x0c);

function classify(chunk: string): Key {
  switch (chunk) {
    case "j":
    case `${CSI}B`:
      return "down";
    case "k":
    case `${CSI}A`:
      return "up";
    case " ":
    case "f":
    case `${CSI}6~`:
      return "pageDown";
    case "b":
    case `${CSI}5~`:
      return "pageUp";
    case "g":
    case `${CSI}H`:
      return "top";
    case "G":
    case `${CSI}F`:
      return "bottom";
    case "q":
    case CTRL_C:
    case CTRL_D:
      return "quit";
    case CTRL_L:
      return "redraw";
    default:
      return "ignore";
  }
}

export async function runPager(options: PagerOptions): Promise<void> {
  const { lines, expandImages, title } = options;
  const out = process.stdout;

  let top = 0;

  const viewportHeight = () => Math.max(1, (out.rows ?? 24) - 1);
  const maxTop = () => Math.max(0, lines.length - viewportHeight());

  const paint = () => {
    const height = viewportHeight();
    const visible = lines.slice(top, top + height);

    let frame = encodeClearPlacements() + CLEAR_SCREEN;

    // Every line is placed at an absolute row rather than reached by newlines.
    // Drawing an image moves the cursor by an amount that depends on the
    // terminal, and one picture's worth of drift would push everything below it
    // out of place. Only the images on this screen are sent, so a repaint costs
    // what the viewport holds, not what the document holds.
    visible.forEach((line, index) => {
      frame += `${CSI}${index + 1};1H` + expandImages(line);
    });

    const atEnd = top >= maxTop();
    const position = lines.length ? Math.round((top / Math.max(1, maxTop())) * 100) : 100;
    const status = atEnd && top === 0 ? "all" : atEnd ? "end" : `${position}%`;

    frame += `${CSI}${height + 1};1H`;
    frame += dim(`  ${title} — ${status}  ·  j/k scroll  space/b page  g/G ends  q quit`);

    out.write(frame);
  };

  const readKey = (): Promise<string> =>
    new Promise((resolve) => {
      const onData = (chunk: Buffer) => {
        process.stdin.removeListener("data", onData);
        resolve(chunk.toString("utf8"));
      };
      process.stdin.on("data", onData);
    });

  const restore = () => {
    out.write(encodeClearPlacements() + SHOW_CURSOR + LEAVE_FULLSCREEN);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  };

  process.on("exit", restore);

  out.write(ENTER_FULLSCREEN + HIDE_CURSOR);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  const onResize = () => {
    top = Math.min(top, maxTop());
    paint();
  };
  out.on("resize", onResize);

  try {
    paint();

    for (;;) {
      const key = classify(await readKey());
      const height = viewportHeight();

      if (key === "quit") {
        break;
      }

      const previous = top;

      switch (key) {
        case "down":
          top = Math.min(maxTop(), top + 1);
          break;
        case "up":
          top = Math.max(0, top - 1);
          break;
        case "pageDown":
          top = Math.min(maxTop(), top + height - 1);
          break;
        case "pageUp":
          top = Math.max(0, top - height + 1);
          break;
        case "top":
          top = 0;
          break;
        case "bottom":
          top = maxTop();
          break;
        case "redraw":
          paint();
          continue;
        default:
          continue;
      }

      if (top !== previous) {
        paint();
      }
    }
  } finally {
    out.removeListener("resize", onResize);
    process.removeListener("exit", restore);
    restore();
  }
}
