// Turns the site's stroke fonts into web fonts, so ordinary HTML pages (the Live Guide) can set text
// in them: the arcade font for headings and Hershey Sans for reading, as the canvas pages do.
//
//   npx vite-node tools/build-stroke-fonts.ts
//
// Each stroke of a glyph becomes a thin outline (a capsule: the segment widened, with round ends);
// overlapping outlines all wind the same way, so the font's nonzero fill joins them. The fonts are
// written to site/public/fonts/ and served as they are.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as opentype from "opentype.js";
import { getArcadeStrokeFont, getHersheyFont, type StrokeFont } from "../packages/demo-kit/src/index.js";

const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), "../site/public/fonts");
const UNITS_PER_EM = 1000;
// Capitals 700 units tall, as in most text fonts, so a given font-size looks about as large.
const CAP_HEIGHT_UNITS = 700;
// Points around each round end.
const END_STEPS = 6;

interface FontPlan {
  readonly font: StrokeFont;
  readonly familyName: string;
  readonly file: string;
  // Stroke width as a share of the capital height.
  readonly strokeShare: number;
  // For fonts with capitals only: lowercase letters map to the capitals.
  readonly capitalsForLowercase: boolean;
}

type Point = { readonly x: number; readonly y: number };

// A segment's capsule, counterclockwise in font units (y up).
function capsule(from: Point, to: Point, radius: number): Point[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const along = length > 1e-9 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : { x: 1, y: 0 };
  const angle = Math.atan2(along.y, along.x);
  const points: Point[] = [];
  // Around the far end from one side to the other, then around the near end back.
  for (let step = 0; step <= END_STEPS; step++) {
    const turn = angle - Math.PI / 2 + (step / END_STEPS) * Math.PI;
    points.push({ x: to.x + radius * Math.cos(turn), y: to.y + radius * Math.sin(turn) });
  }
  for (let step = 0; step <= END_STEPS; step++) {
    const turn = angle + Math.PI / 2 + (step / END_STEPS) * Math.PI;
    points.push({ x: from.x + radius * Math.cos(turn), y: from.y + radius * Math.sin(turn) });
  }
  return points;
}

function signedArea(points: readonly Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function glyphPath(plan: FontPlan, polylines: readonly { readonly points: readonly Point[]; readonly isClosed: boolean }[], scale: number): opentype.Path {
  const path = new opentype.Path();
  const radius = (plan.strokeShare * CAP_HEIGHT_UNITS) / 2;
  // Stroke units are y down with the capitals' top at 0; font units are y up from the baseline.
  const toFont = (point: Point): Point => ({ x: point.x * scale + radius, y: (plan.font.capHeight - point.y) * scale });
  for (const polyline of polylines) {
    const points = polyline.points.map(toFont);
    const segments: [Point, Point][] = [];
    for (let index = 0; index + 1 < points.length; index++) segments.push([points[index], points[index + 1]]);
    if (polyline.isClosed && points.length > 2) segments.push([points[points.length - 1], points[0]]);
    // A single point is a dot.
    if (points.length === 1) segments.push([points[0], points[0]]);
    for (const [from, to] of segments) {
      let outline = capsule(from, to, radius);
      if (signedArea(outline) < 0) outline = outline.reverse();
      path.moveTo(Math.round(outline[0].x), Math.round(outline[0].y));
      for (const point of outline.slice(1)) path.lineTo(Math.round(point.x), Math.round(point.y));
      path.close();
    }
  }
  return path;
}

function buildFont(plan: FontPlan): void {
  const scale = CAP_HEIGHT_UNITS / plan.font.capHeight;
  const strokeWidth = plan.strokeShare * CAP_HEIGHT_UNITS;
  const glyphs = [new opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth: Math.round(CAP_HEIGHT_UNITS * 0.6), path: new opentype.Path() })];
  const added = new Set<number>();
  const add = (character: string, glyph: { readonly polylines: readonly { readonly points: readonly Point[]; readonly isClosed: boolean }[]; readonly advance: number }): void => {
    const code = character.codePointAt(0)!;
    if (added.has(code) || character.length !== [...character][0].length) return;
    added.add(code);
    glyphs.push(
      new opentype.Glyph({
        name: `u${code.toString(16).toUpperCase().padStart(4, "0")}`,
        unicode: code,
        advanceWidth: Math.round(glyph.advance * scale + strokeWidth),
        path: glyphPath(plan, glyph.polylines, scale),
      }),
    );
  };
  const table = plan.font.glyphs;
  for (const [character, glyph] of Object.entries(table)) add(character, glyph);
  if (plan.capitalsForLowercase) {
    for (const [character, glyph] of Object.entries(table)) {
      const lower = character.toLowerCase();
      if (lower !== character) add(lower, glyph);
    }
  }
  // A space, if the font has none of its own.
  if (!added.has(32)) add(" ", { polylines: [], advance: plan.font.capHeight * 0.5 });

  const font = new opentype.Font({
    familyName: plan.familyName,
    styleName: "Regular",
    unitsPerEm: UNITS_PER_EM,
    ascender: 900,
    descender: -300,
    glyphs,
  });
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(resolve(OUTPUT, plan.file), Buffer.from(font.toArrayBuffer()));
  console.log(`${plan.file}: ${glyphs.length - 1} glyphs`);
}

buildFont({ font: getArcadeStrokeFont(), familyName: "Vector Arcade", file: "vector-arcade.otf", strokeShare: 0.09, capitalsForLowercase: true });
buildFont({ font: getHersheyFont("sans"), familyName: "Hershey Sans", file: "hershey-sans.otf", strokeShare: 0.075, capitalsForLowercase: false });
