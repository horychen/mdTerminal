/**
 * Terminal geometry.
 *
 * Placing an image on the character grid needs the pixel size of one cell,
 * which no standard Node API exposes. `CSI 14 t` asks the terminal for its
 * window size in pixels; dividing by the character grid gives the cell.
 */

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const QUERY_WINDOW_PIXELS = `${ESC}[14t`;
const QUERY_FOREGROUND = `${ESC}]10;?${BEL}`;
const QUERY_TIMEOUT_MS = 100;

export type TerminalMetrics = {
  columns: number;
  rows: number;
  cellWidthPx: number;
  cellHeightPx: number;
};

// Used when the terminal will not answer. Chosen for a Retina cell at a
// typical font size; images stay reasonable rather than correct.
const FALLBACK_CELL_WIDTH_PX = 17;
const FALLBACK_CELL_HEIGHT_PX = 34;

/**
 * Sends a query and waits for the terminal's reply.
 *
 * `isComplete` decides when enough has arrived, because each query terminates
 * differently. The timeout matters: a terminal that does not implement the
 * query simply never answers, and the caller must not hang because of it.
 */
function query(
  request: string,
  isComplete: (buffer: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolveReply) => {
    const stdin = process.stdin;
    let buffer = "";
    let settled = false;

    const finish = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stdin.removeListener("data", onData);
      if (stdin.isTTY) {
        stdin.setRawMode(false);
      }
      stdin.pause();
      resolveReply(value);
    };

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (isComplete(buffer)) {
        finish(buffer);
      }
    };

    const timer = setTimeout(() => finish(buffer), timeoutMs);

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
    process.stdout.write(request);
  });
}

/**
 * The terminal's foreground colour, via OSC 10.
 *
 * Asking for the foreground is more direct than reading the background and
 * inferring from it, and it makes formulas exactly the colour of the text they
 * sit beside. The reply gives 16 bits per channel; only the top 8 are kept.
 */
export async function readForegroundColor(): Promise<string | null> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return null;
  }

  const reply = await query(
    QUERY_FOREGROUND,
    (buffer) => buffer.includes(BEL) || buffer.includes(`${ESC}\\`),
    QUERY_TIMEOUT_MS,
  );

  const parsed = /rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(reply);
  if (!parsed) {
    return null;
  }

  const channel = (raw: string) =>
    Math.round(
      (Number.parseInt(raw, 16) / (16 ** raw.length - 1)) * 255,
    )
      .toString(16)
      .padStart(2, "0");

  return `#${channel(parsed[1])}${channel(parsed[2])}${channel(parsed[3])}`;
}

export async function readTerminalMetrics(): Promise<TerminalMetrics> {
  const columns = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return {
      columns,
      rows,
      cellWidthPx: FALLBACK_CELL_WIDTH_PX,
      cellHeightPx: FALLBACK_CELL_HEIGHT_PX,
    };
  }

  const reply = await query(
    QUERY_WINDOW_PIXELS,
    // The reply ends with `t`, e.g. ESC [ 4 ; 1864 ; 2880 t
    (buffer) => buffer.includes("t"),
    QUERY_TIMEOUT_MS,
  );

  // Expected shape: ESC [ 4 ; <height> ; <width> t
  const parsed = /\[4;(\d+);(\d+)t/.exec(reply);
  if (!parsed) {
    return {
      columns,
      rows,
      cellWidthPx: FALLBACK_CELL_WIDTH_PX,
      cellHeightPx: FALLBACK_CELL_HEIGHT_PX,
    };
  }

  const windowHeightPx = Number(parsed[1]);
  const windowWidthPx = Number(parsed[2]);

  return {
    columns,
    rows,
    cellWidthPx: Math.round(windowWidthPx / columns),
    cellHeightPx: Math.round(windowHeightPx / rows),
  };
}

/**
 * The x-height to target when rendering math, derived from the cell.
 *
 * A monospace cell is mostly leading and ascender space, so its x-height is a
 * fraction of the cell rather than the half that "half a line" intuition
 * suggests. Getting this wrong is what makes rendered math tower over the text
 * it sits in.
 *
 * The ratio is tuned by eye against the terminal font; `scale` lets a reader
 * nudge it without touching the code.
 */
const EX_TO_CELL_RATIO = 0.34;

export function exPxForCell(cellHeightPx: number, scale = 1): number {
  return cellHeightPx * EX_TO_CELL_RATIO * scale;
}
