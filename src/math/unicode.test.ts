import { describe, expect, it } from "vitest";
import { toUnicode } from "./unicode.js";

describe("toUnicode", () => {
  it("passes plain variables through", () => {
    expect(toUnicode("q")).toEqual({ convertible: true, text: "q" });
  });

  it("converts Greek letters", () => {
    expect(toUnicode("\\lambda")).toEqual({ convertible: true, text: "λ" });
    expect(toUnicode("\\Omega")).toEqual({ convertible: true, text: "Ω" });
  });

  it("converts single-character subscripts", () => {
    expect(toUnicode("x_o")).toEqual({ convertible: true, text: "xₒ" });
  });

  it("converts braced subscripts when every character has a form", () => {
    expect(toUnicode("a_{12}")).toEqual({ convertible: true, text: "a₁₂" });
  });

  it("converts superscripts", () => {
    expect(toUnicode("x^2")).toEqual({ convertible: true, text: "x²" });
  });

  it("converts symbols and operators", () => {
    expect(toUnicode("a \\leq b")).toEqual({ convertible: true, text: "a ≤ b" });
    expect(toUnicode("\\partial")).toEqual({ convertible: true, text: "∂" });
  });

  it("refuses subscripts with no Unicode form", () => {
    // There is no subscript `b`, so half-converting would be worse than an image.
    expect(toUnicode("x_{ab}")).toEqual({ convertible: false });
  });

  it("refuses stacked constructs", () => {
    expect(toUnicode("\\frac{1}{2}")).toEqual({ convertible: false });
    expect(toUnicode("\\sqrt{2}")).toEqual({ convertible: false });
    expect(toUnicode("\\begin{pmatrix} 1 \\end{pmatrix}")).toEqual({
      convertible: false,
    });
  });

  it("refuses operators carrying limits", () => {
    expect(toUnicode("\\sum_{i=1}^{n} i")).toEqual({ convertible: false });
  });

  it("refuses unknown commands rather than dropping them", () => {
    expect(toUnicode("\\mathcal{H}")).toEqual({ convertible: false });
  });

  it("refuses empty input", () => {
    expect(toUnicode("   ")).toEqual({ convertible: false });
  });
});
