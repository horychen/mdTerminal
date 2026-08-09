/**
 * Syntax highlighting for fenced code blocks.
 *
 * Shiki has no ANSI output, but `codeToTokens` hands back tokens carrying hex
 * colours, which map straight onto 24-bit ANSI. `cli-highlight`, the obvious
 * alternative, was last published in 2021.
 */

import { createHighlighter, type Highlighter } from "shiki";
import { color, dim } from "./ansi.js";

const THEME = "github-dark";

let highlighterPromise: Promise<Highlighter> | null = null;

/** Loaded lazily and once: creating a highlighter is slow. */
async function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: [THEME], langs: [] });
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  language: string | null,
): Promise<string> {
  if (!language) {
    return dim(code);
  }

  try {
    const highlighter = await getHighlighter();
    await highlighter.loadLanguage(language as never);

    const { tokens } = highlighter.codeToTokens(code, {
      lang: language as never,
      theme: THEME,
    });

    return tokens
      .map((line) =>
        line
          .map((token) =>
            token.color ? color(token.content, token.color) : token.content,
          )
          .join(""),
      )
      .join("\n");
  } catch {
    // An unknown language is not worth failing a document over.
    return dim(code);
  }
}
