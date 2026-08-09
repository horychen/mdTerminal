/** Minimal ANSI styling. Small enough not to warrant a dependency. */

const ESC = String.fromCharCode(0x1b);
const CSI = `${ESC}[`;

export const RESET = `${CSI}0m`;

export function bold(text: string): string {
  return `${CSI}1m${text}${CSI}22m`;
}

export function dim(text: string): string {
  return `${CSI}2m${text}${CSI}22m`;
}

export function italic(text: string): string {
  return `${CSI}3m${text}${CSI}23m`;
}

export function underline(text: string): string {
  return `${CSI}4m${text}${CSI}24m`;
}

export function strikethrough(text: string): string {
  return `${CSI}9m${text}${CSI}29m`;
}

/** Truecolor foreground. Ghostty, Kitty, and WezTerm all support it. */
export function color(text: string, hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return text;
  }

  return `${CSI}38;2;${rgb.r};${rgb.g};${rgb.b}m${text}${CSI}39m`;
}

export function hexToRgb(
  hex: string,
): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 16);

  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** Visible width, ignoring escape sequences. Used for table layout. */
export function visibleWidth(text: string): number {
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  let width = 0;

  for (const char of stripped) {
    const code = char.codePointAt(0) ?? 0;
    // CJK and fullwidth forms occupy two cells.
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
        ? 2
        : 1;
  }

  return width;
}
