# mdTerminal

Read Markdown in the terminal, with images and LaTeX maths actually rendered.

`glow` prints formulas as raw source. `mdcat` does the same, and is archived.
mdTerminal renders both — images through the Kitty graphics protocol, maths
through MathJax.

```sh
mdterm notes.md
mdterm ~/research/paper.md
```

## Requirements

A terminal implementing the **Kitty graphics protocol**: Ghostty, Kitty, or
WezTerm. Others still render text, tables, and highlighted code; they just
print placeholders where a picture would go.

Node 20 or newer. No TeX installation, no browser, no Rust.

## Maths

Both delimiter styles work:

| Style | Inline | Display |
| --- | --- | --- |
| Dollar | `$E = mc^2$` | `$$ ... $$` |
| LaTeX-native | `\(E = mc^2\)` | `\[ ... \]` |

The second row matters: notes exported from LaTeX documents and from LLM chats
overwhelmingly use `\(` and `\[`.

**Simple inline maths becomes real text, not a picture.** `$x_o$` renders as
`xₒ` and `$\lambda$` as `λ` — selectable, copyable, and findable with grep. An
image is used only where Unicode cannot express the formula: fractions,
radicals, matrices, and operators carrying limits. A formula is never half text
and half picture, because the two would not share a size or a baseline.

**Prices stay prices.** `$100 and $200` is left alone rather than being read as
a formula, following the rule Pandoc uses: real inline maths never has
whitespace hugging its delimiters.

**Formulas match your terminal.** The colour comes from an OSC 10 query, so
maths is exactly the colour of the text beside it and follows your theme. Size
is derived from your cell height; `--scale` adjusts it.

## Options

| Flag | Effect |
| --- | --- |
| `--scale <n>` | Size of rendered maths relative to the text (default 1) |
| `--no-graphics` | Never emit images; print text placeholders |
| `--color <hex>` | Formula colour, overriding the terminal's foreground |
| `-h`, `--help` | Usage |

## Install

From a release tarball:

```sh
npm i -g https://github.com/horychen/mdTerminal/releases/latest/download/mdterminal.tgz
```

Or from source:

```sh
git clone https://github.com/horychen/mdTerminal
cd mdTerminal && npm install && npm run build && npm link
```

Both `mdterm` and `mdterminal` are installed as commands.

## Not yet

**A pager.** This release renders a document in one pass; scrolling means your
terminal's own scrollback. Piping to `less` will not carry the images — the
graphics escape sequences do not survive it — so `mdterm` prints text
placeholders whenever its output is not a terminal.

An interactive pager is the next phase, and it will need to implement paging
itself rather than delegate.

## Develop

```sh
npm install
npm test            # unit tests
npm run dev -- file.md
npm run spike       # size and baseline tuning; `-- 1.2` to scale
npm run build
```

## License

MIT
