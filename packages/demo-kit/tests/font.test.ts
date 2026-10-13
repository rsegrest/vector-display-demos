import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { fontSafeText, getDemoFont } from "../src/font.js";

function segmentCount(text: string): number {
  const displayList = new DisplayList();
  getDemoFont().addText(displayList, { text, x: 0, y: 0, size: 20 });
  return displayList.segmentCount;
}

describe("demo font", () => {
  it("draws accented capitals as the base letter plus a mark", () => {
    for (const [accented, base] of [["Ü", "U"], ["É", "E"], ["Ç", "C"], ["Å", "A"], ["Ñ", "N"], ["Ø", "O"]]) {
      expect(segmentCount(accented)).toBeGreaterThan(segmentCount(base));
    }
  });

  it("keeps accented names the same width as their plain spelling", () => {
    const font = getDemoFont();
    expect(font.measureText("TÜRKIYE", 20).width).toBeCloseTo(font.measureText("TURKIYE", 20).width);
  });

  it("draws square brackets", () => {
    expect(segmentCount("[]")).toBeGreaterThan(0);
  });
});

describe("fontSafeText", () => {
  it("uppercases and keeps characters the font can draw", () => {
    expect(fontSafeText("Türkiye")).toBe("TÜRKIYE");
    expect(fontSafeText("Curaçao")).toBe("CURAÇAO");
  });

  it("replaces typographic punctuation and strips accents the font cannot draw", () => {
    expect(fontSafeText("Auburn, AL 1996–2001 — “home”")).toBe('AUBURN, AL 1996-2001 - "HOME"');
    // Ő (double acute) has no mark; it falls back to O.
    expect(fontSafeText("Győr")).toBe("GYOR");
  });
});
