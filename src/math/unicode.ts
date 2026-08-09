/**
 * Unicode approximation for simple inline math.
 *
 * An image is always correct but never text: it cannot be selected, copied, or
 * found by grep. Most inline math in real documents is a single symbol or a
 * one-level subscript — `q`, `x_o`, `\lambda`, `N_G` — and those read better as
 * real characters.
 *
 * The rule: a formula converts when every part maps to codepoints needing no
 * two-dimensional layout. Anything stacked — fractions, radicals, matrices,
 * environments, limits above and below an operator — does not. When any part
 * fails, the caller falls back to an image for the whole formula; a formula is
 * never half text and half picture, because the two never share a size or a
 * baseline.
 */

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ",
  omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ",
  Omega: "Ω",
};

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓",
  leq: "≤", geq: "≥", neq: "≠", approx: "≈", equiv: "≡",
  sim: "∼", propto: "∝", infty: "∞", partial: "∂", nabla: "∇",
  in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪",
  cap: "∩", forall: "∀", exists: "∃", neg: "¬", land: "∧",
  lor: "∨", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒",
  Leftarrow: "⇐", leftrightarrow: "↔", mapsto: "↦", circ: "∘",
  star: "⋆", bullet: "∙", dots: "…", ldots: "…", cdots: "⋯",
  angle: "∠", perp: "⊥", parallel: "∥", emptyset: "∅",
  Re: "ℜ", Im: "ℑ", ell: "ℓ", hbar: "ℏ", prime: "′",
};

const SUPERSCRIPTS: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  n: "ⁿ", i: "ⁱ", T: "ᵀ",
};

const SUBSCRIPTS: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ",
  l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ",
  s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

/** Constructs that need vertical arrangement, so can never be plain text. */
const STACKED = [
  "\\frac", "\\dfrac", "\\tfrac", "\\binom", "\\sqrt", "\\begin",
  "\\over", "\\atop", "\\overbrace", "\\underbrace", "\\overline",
  "\\underline", "\\sum_", "\\prod_", "\\int_", "\\lim_", "\\substack",
  "\\matrix", "\\pmatrix", "\\bmatrix", "\\array", "\\stackrel",
];

/**
 * Symbols LaTeX surrounds with space because of their class, regardless of how
 * the source was written. Reproducing that keeps `a\leq b` from reading as
 * `a≤b`, while `\alpha x` still correctly comes out as `αx`.
 */
const SPACED = new Set([
  "≤", "≥", "≠", "≈", "≡", "∼", "∝", "∈", "∉", "⊂", "⊆",
  "∪", "∩", "→", "←", "⇒", "⇐", "↔", "↦", "±", "∓", "×",
  "÷", "·", "∧", "∨", "⊥", "∥", "=", "<", ">", "+",
]);

export type UnicodeResult =
  | { convertible: true; text: string }
  | { convertible: false };

function convertScript(
  body: string,
  table: Record<string, string>,
): string | null {
  let out = "";

  for (const char of body) {
    const mapped = table[char];
    if (!mapped) {
      return null;
    }
    out += mapped;
  }

  return out;
}

/**
 * Converts `latex` to plain Unicode, or reports that it cannot be done.
 */
export function toUnicode(latex: string): UnicodeResult {
  const source = latex.trim();

  if (!source) {
    return { convertible: false };
  }

  if (STACKED.some((marker) => source.includes(marker))) {
    return { convertible: false };
  }

  let rest = source;
  let out = "";

  const append = (piece: string) => {
    out += SPACED.has(piece) ? ` ${piece} ` : piece;
  };

  while (rest.length > 0) {
    // \command
    const command = /^\\([A-Za-z]+)\s*/.exec(rest);
    if (command) {
      const name = command[1];
      const mapped = GREEK[name] ?? SYMBOLS[name];
      if (!mapped) {
        return { convertible: false };
      }
      append(mapped);
      rest = rest.slice(command[0].length);
      continue;
    }

    // ^{...} ^x  and  _{...} _x
    const script = /^([\^_])(?:\{([^{}]*)\}|(.))/.exec(rest);
    if (script) {
      const body = script[2] ?? script[3] ?? "";
      const table = script[1] === "^" ? SUPERSCRIPTS : SUBSCRIPTS;
      const mapped = convertScript(body, table);
      if (mapped === null) {
        return { convertible: false };
      }
      out += mapped;
      rest = rest.slice(script[0].length);
      continue;
    }

    // Braces carry no meaning once their contents are plain.
    if (rest.startsWith("{") || rest.startsWith("}")) {
      rest = rest.slice(1);
      continue;
    }

    const char = rest[0];

    // Anything left that is not ordinary maths text is out of scope.
    if (!/[A-Za-z0-9 .,;:!?()[\]|+\-*/=<>'"]/.test(char)) {
      return { convertible: false };
    }

    append(char);
    rest = rest.slice(1);
  }

  // Collapse the padding introduced above into single spaces.
  return { convertible: true, text: out.replace(/\s+/g, " ").trim() };
}
