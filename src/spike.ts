/**
 * Risk spike for inline math.
 *
 * Prints the same formulas inline and as display math so their size, baseline,
 * and effect on line flow can be judged side by side.
 *
 * Run with: npm run spike
 * Delete once the question is settled.
 */

import { renderMathToPng } from "./math/toPng.js";
import { encodeImage } from "./terminal/kitty.js";
import { exPxForCell, readTerminalMetrics } from "./terminal/metrics.js";

const COLOR = "#c0caf5"; // Pending an OSC 10 query.

const INLINE_CASES = [
  String.raw`x^2`,
  String.raw`\lambda`,
  String.raw`\mathcal{H}_T`,
  String.raw`\frac{1}{2}`,
  String.raw`\frac{\partial \phi}{\partial q}`,
  String.raw`\sum_{i=1}^{n} i`,
];

const DISPLAY_CASES = [
  String.raw`\frac{\partial \phi}{\partial q}`,
  String.raw`A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}`,
];

async function main(): Promise<void> {
  const metrics = await readTerminalMetrics();
  // `npm run spike -- 1.2` renders 20% larger, for tuning by eye.
  const scale = Number(process.argv[2] ?? "1") || 1;
  const exPx = exPxForCell(metrics.cellHeightPx, scale);

  process.stdout.write(
    `\ncell ${metrics.cellWidthPx}x${metrics.cellHeightPx}px  ` +
      `grid ${metrics.columns}x${metrics.rows}  ex=${exPx.toFixed(1)}px\n`,
  );

  process.stdout.write("\n=== INLINE (forced to one row) ===\n\n");

  for (const latex of INLINE_CASES) {
    const math = await renderMathToPng(latex, { color: COLOR, exPx, display: false });

    // Native size. `exPx` already fixed the font size for every formula; any
    // per-formula rescaling here would undo exactly that.
    const image = encodeImage(math.png, {});
    const rowsNeeded = Math.ceil(math.heightPx / metrics.cellHeightPx);

    process.stdout.write(
      `  we know ${image} holds here    <- ${latex} ` +
        `(${math.widthPx}x${math.heightPx}px, ${rowsNeeded} row${rowsNeeded > 1 ? "s" : ""})\n`,
    );
  }

  process.stdout.write("\n=== DISPLAY (own block) ===\n\n");

  for (const latex of DISPLAY_CASES) {
    const math = await renderMathToPng(latex, { color: COLOR, exPx, display: true });

    process.stdout.write(`  ${encodeImage(math.png, {})}\n\n`);
    process.stdout.write(`  ^ ${latex}\n\n`);
  }

  process.stdout.write("\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`spike failed: ${String(error)}\n`);
  process.exitCode = 1;
});
