/**
 * Kitty graphics protocol encoding.
 *
 * An image is transmitted as base64 PNG split across escape sequences of at
 * most 4096 payload bytes each. Every chunk but the last carries `m=1`,
 * meaning "more follows".
 *
 * Ghostty, Kitty, and WezTerm all speak this. Terminals that do not will print
 * nothing for these sequences rather than garbage, because the payload sits
 * inside an APC string that unknown terminals discard.
 */

const CHUNK_SIZE = 4096;

// Built from char codes so the ESC and backslash bytes are unmistakable:
// the protocol frames each command as ESC _ G ... ESC \.
const ESC = String.fromCharCode(0x1b);
const BACKSLASH = String.fromCharCode(0x5c);
const APC_START = `${ESC}_G`;
const APC_END = `${ESC}${BACKSLASH}`;

/**
 * Cells the image should be scaled into.
 *
 * Omit both to display at native pixel size. That is usually what you want:
 * scaling each image to a fixed cell count normalises its *bounding box*, and
 * since a formula's bounding box grows with its content — a lone `\lambda` is
 * short, a fraction is tall — equal boxes mean unequal font sizes.
 */
export type ImagePlacement = {
  columns?: number;
  rows?: number;
};

function encodeChunk(controls: string, payload: string): string {
  return `${APC_START}${controls};${payload}${APC_END}`;
}

/**
 * Builds the escape sequence that displays `png` at the cursor.
 *
 * `a=T` transmits and displays in one step; `f=100` declares PNG data; `c` and
 * `r` scale the image into that many cells, which is what keeps it aligned to
 * the character grid.
 */
export function encodeImage(png: Buffer, placement: ImagePlacement): string {
  const data = png.toString("base64");
  const chunks: string[] = [];

  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const payload = data.slice(offset, offset + CHUNK_SIZE);
    const isFirst = offset === 0;
    const isLast = offset + CHUNK_SIZE >= data.length;

    const controls = isFirst
      ? [
          "a=T",
          "f=100",
          ...(placement.columns === undefined
            ? []
            : [`c=${placement.columns}`]),
          ...(placement.rows === undefined ? [] : [`r=${placement.rows}`]),
          `m=${isLast ? 0 : 1}`,
        ].join(",")
      : `m=${isLast ? 0 : 1}`;

    chunks.push(encodeChunk(controls, payload));
  }

  return chunks.join("");
}

/** Removes every image the terminal is currently holding for us. */
export function encodeDeleteAllImages(): string {
  return `${APC_START}a=d,d=A${APC_END}`;
}

/**
 * Sends the image data without drawing it, storing it under `id`.
 *
 * A pager redraws on every keypress, and re-sending a PNG each time would make
 * scrolling crawl. Transmitting once and then placing by id keeps each redraw
 * to a few dozen bytes per image.
 */
export function encodeTransmit(id: number, png: Buffer): string {
  const data = png.toString("base64");
  const chunks: string[] = [];

  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const payload = data.slice(offset, offset + CHUNK_SIZE);
    const isFirst = offset === 0;
    const isLast = offset + CHUNK_SIZE >= data.length;

    const controls = isFirst
      ? ["a=t", "f=100", `i=${id}`, `m=${isLast ? 0 : 1}`].join(",")
      : `m=${isLast ? 0 : 1}`;

    chunks.push(encodeChunk(controls, payload));
  }

  return chunks.join("");
}

/** Draws an already-transmitted image at the cursor. */
export function encodePlace(id: number, placement: ImagePlacement): string {
  const controls = [
    "a=p",
    `i=${id}`,
    ...(placement.columns === undefined ? [] : [`c=${placement.columns}`]),
    ...(placement.rows === undefined ? [] : [`r=${placement.rows}`]),
  ].join(",");

  return `${APC_START}${controls}${APC_END}`;
}

/** Clears drawn images while keeping the transmitted data for reuse. */
export function encodeClearPlacements(): string {
  return `${APC_START}a=d,d=a${APC_END}`;
}
