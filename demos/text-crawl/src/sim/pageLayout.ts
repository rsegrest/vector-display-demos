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

// A line beginning with "#" is a title: larger, and flagged so it can be colored differently.
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

// The longest line, in characters, that fits the screen up close; titles are drawn larger, so fewer fit.
export const LINE_CHARACTERS = 26;
export const TITLE_CHARACTERS = Math.floor(LINE_CHARACTERS / TITLE_SCALE);
// Lines of text on one page, after the title.
export const PAGE_LINES = 8;

// Words laid into lines no longer than `limit` characters; a word longer than a line is broken.
export function wrapWords(text: string, limit: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > limit) {
      if (line) lines.push(line);
      line = "";
      lines.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    if (!rest) continue;
    if (line && line.length + 1 + rest.length > limit) {
      lines.push(line);
      line = rest;
    } else {
      line = line ? `${line} ${rest}` : rest;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Pages from a header and text as typed into the customize panel: each typed line wrapped to fit
// (a blank line kept as a gap), PAGE_LINES lines to a page, the header as the first page's title.
export function pagesFromText(header: string, text: string): string[][] {
  const titleLines = wrapWords(header.trim(), TITLE_CHARACTERS).map((line) => `#${line}`);
  const bodyLines = text
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((typed) => (typed.trim() === "" ? [""] : wrapWords(typed, LINE_CHARACTERS)));
  // No gaps at the very start or end.
  while (bodyLines[0] === "") bodyLines.shift();
  while (bodyLines.at(-1) === "") bodyLines.pop();
  const pages: string[][] = [];
  for (let start = 0; start < bodyLines.length; start += PAGE_LINES) pages.push(bodyLines.slice(start, start + PAGE_LINES));
  if (pages.length === 0) pages.push([]);
  pages[0] = [...titleLines, ...pages[0]];
  return pages.filter((page) => page.some((line) => line.replace("#", "").trim().length > 0));
}

// Pages written the way the address's ?text= takes them, the inverse of parsePages. A blank line
// is written as a space: two "|" in a row would end the page.
export function pagesToText(pages: readonly (readonly string[])[]): string {
  return pages.map((page) => page.map((line) => line || " ").join("|")).join("||");
}
