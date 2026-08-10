/**
 * The pager's image strategy: transmit once, then draw by id.
 *
 * Scrolling repaints the whole window on every keypress. Re-sending a diagram's
 * PNG each time would make the pager unusable — a single Mermaid figure runs to
 * tens of kilobytes of base64. Here each image is transmitted once before the
 * first paint, and every repaint costs a few dozen bytes per visible image.
 */

import type { ImageSink } from "../render.js";
import {
  encodePlace,
  encodeTransmit,
  type ImagePlacement,
} from "../terminal/kitty.js";

export type CollectingImageSink = ImageSink & {
  /** Everything that must reach the terminal before the first paint. */
  transmissions(): string;
};

export function createPagerImageSink(): CollectingImageSink {
  const transmits: string[] = [];
  // Ids start above zero because 0 means "unspecified" in the protocol.
  let nextId = 1;

  return {
    emit(png: Buffer, placement: ImagePlacement): string {
      const id = nextId++;
      transmits.push(encodeTransmit(id, png));
      return encodePlace(id, placement);
    },

    transmissions(): string {
      return transmits.join("");
    },
  };
}
