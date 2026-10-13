// Lays a page of text out as loose strokes. A page is flat: x runs to the right
// from the middle of the page, y runs up, and the first line sits at y = 0 with
// later lines below it. Every letter is only a few straight strokes from the
// vector font, and those strokes are all the demo ever moves.

import { glyphStrokes } from "@vector-demos/demo-kit";

export interface Page {
  // x0, y0, x1, y1 for each stroke, in page units (a capital is six units tall).
  readonly segments: Float32Array;
  // 1 for strokes of the title line.
  readonly isTitle: Uint8Array;
  readonly segmentCount: number;
  // The page spans y = 0 down to y = -height.
  readonly height: number;
  readonly width: number;
}

export const LINE_HEIGHT = 11;
export const TITLE_SCALE = 1.7;
// Extra room under a title, in line heights.
const TITLE_GAP = 0.9;
// Width of one character cell, and of a capital within it, in page units.
const CHARACTER_ADVANCE = 6;
const CAPITAL_WIDTH = 4;

// A line beginning with "#" is a title: larger, and flagged so it can be coloured differently.
export function layoutPage(lines: readonly string[]): Page {
  const coordinates: number[] = [];
  const titles: number[] = [];
  let y = 0;
  let width = 0;
  for (const rawLine of lines) {
    const isTitle = rawLine.startsWith("#");
    const text = (isTitle ? rawLine.slice(1) : rawLine).trim().toUpperCase();
    const scale = isTitle ? TITLE_SCALE : 1;
    const characters = [...text].length;
    const lineWidth = characters === 0 ? 0 : ((characters - 1) * CHARACTER_ADVANCE + CAPITAL_WIDTH) * scale;
    width = Math.max(width, lineWidth);
    // Glyphs sit with their baseline at y = 0 and capitals reaching up to 6.
    const baseline = y - 6 * scale;
    for (const stroke of glyphStrokes(text)) {
      const points = stroke.closed ? [...stroke.points, stroke.points[0]] : stroke.points;
      for (let index = 1; index < points.length; index++) {
        coordinates.push(
          points[index - 1][0] * scale - lineWidth / 2,
          baseline + points[index - 1][1] * scale,
          points[index][0] * scale - lineWidth / 2,
          baseline + points[index][1] * scale,
        );
        titles.push(isTitle ? 1 : 0);
      }
    }
    y -= LINE_HEIGHT * scale + (isTitle ? LINE_HEIGHT * TITLE_GAP : 0);
  }
  return {
    segments: Float32Array.from(coordinates),
    isTitle: Uint8Array.from(titles),
    segmentCount: titles.length,
    height: -y,
    width,
  };
}

// Splits text from a URL into pages and lines: "|" ends a line, "||" ends a page.
export function parsePages(text: string): string[][] {
  return text
    .split("||")
    .map((page) => page.split("|").map((line) => line.trim()))
    .filter((page) => page.some((line) => line.replace("#", "").trim().length > 0));
}
