import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { HERSHEY_FONT_IDS, getArcadeStrokeFont, getHersheyFont } from "../src/hersheyFonts.js";

const PRINTABLE_ASCII = Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index));

function segmentCount(font: ReturnType<typeof getHersheyFont>, text: string): number {
  const displayList = new DisplayList();
  font.addText(displayList, { text, x: 0, y: 0, size: 20 });
  return displayList.segmentCount;
}

describe("Hershey fonts", () => {
  it("draw every printable ASCII character, with lowercase unlike its capital", () => {
    for (const id of HERSHEY_FONT_IDS) {
      const font = getHersheyFont(id);
      for (const character of PRINTABLE_ASCII) expect(segmentCount(font, character), `${id} ${character}`).toBeGreaterThan(0);
      expect(font.measureWidth("abcdefghijklmnopqrstuvwxyz", 21)).toBeLessThan(font.measureWidth("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 21));
    }
  });

  it("give narrow letters less room than wide ones", () => {
    const font = getHersheyFont("sans");
    expect(font.measureWidth("i", 21)).toBeLessThan(font.measureWidth("m", 21) / 2);
  });

  it("rest the full stop on the baseline in every font", () => {
    for (const id of HERSHEY_FONT_IDS) {
      const displayList = new DisplayList();
      getHersheyFont(id).addText(displayList, { text: ".", x: 0, y: 0, size: 21 });
      const data = displayList.getSegmentData();
      // Each segment starts with its two end points; at size 21 the baseline is at y = 21.
      let lowest = -Infinity;
      for (let index = 0; index < displayList.segmentCount; index++) lowest = Math.max(lowest, data[index * 14 + 1], data[index * 14 + 3]);
      expect(lowest, id).toBeGreaterThan(20);
      expect(lowest, id).toBeLessThan(22);
    }
  });

  it("draw dashes, the ellipsis and curly quotes", () => {
    const font = getHersheyFont("sans");
    expect(font.measureWidth("-", 21)).toBeLessThan(font.measureWidth("–", 21));
    expect(font.measureWidth("–", 21)).toBeLessThan(font.measureWidth("—", 21));
    expect(segmentCount(font, "…")).toBe(3 * segmentCount(font, "."));
    expect(segmentCount(font, "“”’")).toBeGreaterThan(0);
    expect(segmentCount(font, "é")).toBe(segmentCount(font, "e"));
  });

  it("draw a middle dot for multiplying, small and level with the minus sign", () => {
    for (const id of HERSHEY_FONT_IDS) {
      const font = getHersheyFont(id);
      expect(segmentCount(font, "·"), id).toBeGreaterThan(0);
      expect(font.measureWidth("·", 21), id).toBeLessThan(font.measureWidth("−", 21));
    }
  });
});

describe("StrokeFont", () => {
  const font = getHersheyFont("sans");

  it("wraps between words and keeps every line within the width", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    const lines = font.wrap(text, 10, 120);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe(text);
    for (const line of lines) expect(font.measureWidth(line, 10)).toBeLessThanOrEqual(120);
  });

  it("keeps line breaks, including blank lines", () => {
    expect(font.wrap("one\n\ntwo", 10, 1000)).toEqual(["one", "", "two"]);
  });

  it("gives a word too long for the width a line to itself", () => {
    expect(font.wrap("a incomprehensibilities b", 10, 40)).toEqual(["a", "incomprehensibilities", "b"]);
  });

  it("reports the height its lines take", () => {
    const displayList = new DisplayList();
    const extent = font.addText(displayList, { text: "one\ntwo", x: 0, y: 0, size: 10, lineHeight: 2 });
    expect(extent).toEqual({ lineCount: 2, height: 40 });
  });

  it("right-aligns each line against x", () => {
    const displayList = new DisplayList();
    font.addText(displayList, { text: "HH", x: 100, y: 0, size: 21, alignment: "right" });
    const data = displayList.getSegmentData();
    let rightmost = -Infinity;
    for (let index = 0; index < displayList.segmentCount; index++) rightmost = Math.max(rightmost, data[index * 14], data[index * 14 + 2]);
    expect(rightmost).toBeLessThanOrEqual(100);
    expect(rightmost).toBeGreaterThan(90);
  });

  it("draws lowercase as capitals in the arcade font", () => {
    const arcade = getArcadeStrokeFont();
    expect(segmentCount(arcade, "a")).toBe(segmentCount(arcade, "A"));
    expect(arcade.measureWidth("il", 6)).toBe(arcade.measureWidth("MW", 6));
  });
});
