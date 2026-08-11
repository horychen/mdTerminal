/**
 * The pager's image strategy: keep the pictures aside, draw the visible ones.
 *
 * The first attempt transmitted every image once under an id and then drew by
 * id on each repaint, which is what the protocol is designed for. Nothing
 * appeared: between the transmission and the first placement the pager clears
 * the screen, and the images did not survive it in practice.
 *
 * So instead the renderer leaves a marker in the text, and the pager expands
 * only the markers inside the slice it is about to paint. That reuses the exact
 * path one-shot output already proves works, and the cost is bounded by what
 * fits on screen rather than by the size of the document.
 */

import type { ImageSink } from "../render.js";
import { encodeImage, type ImagePlacement } from "../terminal/kitty.js";

// Private-use code points, spelled numerically so they stay visible in the
// source: they will not occur in a Markdown document, and they survive slicing
// and joining as ordinary characters.
const MARKER_START = String.fromCharCode(0xe000);
const MARKER_END = String.fromCharCode(0xe001);

const MARKER_PATTERN = new RegExp(`${MARKER_START}(\\d+)${MARKER_END}`, "g");

export type CollectingImageSink = ImageSink & {
  /** Replaces markers in `text` with the escape sequences that draw them. */
  expand(text: string): string;
  count(): number;
};

export function createPagerImageSink(): CollectingImageSink {
  const images: { png: Buffer; placement: ImagePlacement }[] = [];

  return {
    emit(png: Buffer, placement: ImagePlacement): string {
      const index = images.length;
      images.push({ png, placement });
      return `${MARKER_START}${index}${MARKER_END}`;
    },

    expand(text: string): string {
      return text.replace(MARKER_PATTERN, (_match, index: string) => {
        const image = images[Number(index)];
        return image ? encodeImage(image.png, image.placement) : "";
      });
    },

    count(): number {
      return images.length;
    },
  };
}
