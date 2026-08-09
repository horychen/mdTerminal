# mdterm — Markdown in the terminal, with images and math

**Status:** approved design, not yet implemented
**Date:** 2026-08-10

## Problem

No terminal Markdown reader renders LaTeX. `glow` prints formulas as raw
source; `mdcat` does the same and is now archived. Images fare better — the
Kitty graphics protocol has solved them for years — but the combination of
*images and math, both rendered properly* does not exist.

The target environment is Ghostty, which implements the Kitty graphics
protocol. The immediate user reads technical documents with heavy math over
both local and SSH sessions.

## Scope

**In:** one-shot rendering of a Markdown file to the terminal, with GFM
features, images, and LaTeX math.

**Out for now:** an interactive pager. It is a deliberate later phase — see
*Phasing*.

**Out entirely:** editing, file management, non-Kitty-protocol terminals.
Terminals without the graphics protocol degrade to text; they are not a
supported target.

## Architecture

```
notes.md
  │
  ▼ normalizeTexDelimiters()
  ▼ remark-parse + remark-gfm + remark-math + guardInlineMath
  │
mdast
  │
  ▼ renderer (mdast → terminal byte stream)
      ├─ headings / emphasis / lists / quotes  → ANSI styling
      ├─ tables                                → column layout for terminal width
      ├─ code blocks                           → ANSI syntax highlighting
      ├─ image nodes                           → file → Kitty graphics protocol
      └─ math nodes
           ├─ inlineMath → Unicode approximation; image if not convertible
           └─ math       → MathJax → SVG → resvg → PNG → Kitty protocol
```

### Why this parser

`remark` rather than `marked`, because two modules from
[mdViewer](https://github.com/horychen/mdViewer) transfer directly and they
cover this project's least obvious problems:

- **`normalizeTexDelimiters`** rewrites `\(...\)` and `\[...\]` into `$` form
  *before* parsing. This ordering is not optional: CommonMark treats `(` and
  `[` as escapable punctuation, so by the time an mdast plugin runs, `\(x\)`
  is already indistinguishable from a literal `(x)`. It also skips fenced
  blocks and inline code spans.
- **`guardInlineMath`** restores inline matches whose value is hugged by
  whitespace, so `$100 and $200` stays a price rather than becoming a formula.

Choosing `marked` would mean re-deriving both from scratch on a different
parser. `remark-math` also supplies math nodes for free.

The two modules are **copied**, not extracted into a shared package. They are
about 130 lines together; a package with its own release process and version
synchronisation costs more than it saves. Each copy carries a header noting its
origin. Revisit if they diverge, or if a third project needs them.

## Modules

| Module | Responsibility | Testing |
| --- | --- | --- |
| `math/toPng.ts` | LaTeX → SVG → PNG, with a disk cache | Pure; assert on output |
| `math/unicode.ts` | Unicode approximation and the **convertibility decision** | Pure; the highest-value tests in the project |
| `terminal/kitty.ts` | Kitty graphics protocol encoding | Assert on escape-sequence bytes |
| `terminal/metrics.ts` | Terminal width, cell pixel size, foreground colour | Thin wrapper over a real terminal |
| `render.ts` | mdast → output | Snapshot tests |
| `cli.ts` | Argument parsing, file reading | Thin |

`math/unicode.ts` deserves the emphasis: a wrong convertibility decision
renders a complex formula as Unicode gibberish, which is worse than leaving it
as source text. Its tests define the boundary.

## Key decisions

### Inline math: Unicode first, image as fallback

Most inline math in real documents is a single symbol or a simple subscript —
`q`, `x_o`, `\lambda`, `N_G`, `\mathcal{H}_T`. Unicode expresses these
clearly, and the result stays **real text**: selectable, copyable, greppable.
An image loses all three.

Anything Unicode cannot express falls back to an image. Complex constructs are
normally written as display math by the author anyway, which takes the image
path regardless.

**The convertibility rule:** a formula is convertible when every part of it
maps to a Unicode codepoint sequence that needs no two-dimensional layout.
Greek letters, named symbols, single-level sub/superscripts, and operators
qualify. Anything requiring vertical arrangement does not — fractions,
radicals, matrices, `\begin{...}` environments, over/under braces, and
integrals or sums carrying limits. Sub/superscripts qualify only when every
character has a Unicode sub/superscript form; `x_o` converts, `x_{ij}` does
not, because no subscript `j` exists. When any part fails, the whole formula
becomes an image — never a mix of the two.

### Colour: transparent PNG, glyphs in the terminal foreground

Formula PNGs are rendered with an alpha channel, so no background compositing
is needed and no background colour has to be matched.

The glyph colour is the terminal's own foreground, queried at runtime with
**OSC 10**. Querying the foreground is more direct than reading the background
and inferring from it. Fallback chain: OSC 10 → `COLORFGBG` → `--color` →
light default.

The colour is part of the cache key.

### Images are placed in whole cells

The Kitty protocol positions images on integer cell boundaries, so rendering
needs the cell pixel size — from `ioctl(TIOCGWINSZ)` (`ws_xpixel` /
`ws_ypixel`) or a `CSI 14 t` query. When neither answers, fall back to a
conservative default and scale by column count.

### Caching is a requirement, not an optimisation

Every formula costs one MathJax run plus one SVG rasterisation. A document with
dozens of formulas would visibly stall. Key on
`hash(latex + colour + font size)`, store PNGs in a cache directory.

## Phasing

**Phase 1 — one-shot output.** `mdterm notes.md` writes to stdout.

The project's value and its risk both live in the rendering pipeline, not in a
pager. Phase 1 answers the decisive question — *do formulas actually look good
in Ghostty?* — in the least time. If the answer is no, the design changes
before any pager work exists to throw away.

**Phase 2 — interactive pager.** Scrolling, search, navigation. Deferred until
Phase 1 proves the premise. Note that this will likely require implementing
paging directly rather than piping to `less` (see Risk 2).

## Risks

1. **Inline formulas may look bad as images.** Whether a fraction compressed to
   one line height is legible cannot be predicted here. *Mitigation:* the first
   implementation task is a spike — render one `\frac{1}{2}` inline, look at
   it. If it fails, inline math drops the image path entirely and becomes
   Unicode-or-source-text.
2. **Piping to `less` will probably break images.** Graphics escape sequences
   are likely to be swallowed or misplaced by a pager. This is a known cost of
   Phase 1 and the reason Phase 2 exists.
3. **MathJax is large.** The full `mathjax-full` package would make
   `npm i -g` slow. Import only the `tex-input` and `svg-output` components.

## Open items

- The ANSI syntax-highlighting library is not chosen. `cli-highlight` is a
  candidate; its maintenance status needs checking during implementation.
  This does not affect the architecture.

## Distribution

An npm package installed with `npm i -g mdterm`. No Rust, no TeX, no browser
required at runtime.
