import type { Polyline } from "@vector-display/core";
import { ARCADE_FONT_METRICS, ARCADE_GLYPHS } from "@vector-display/font";
import { HERSHEY_DATA } from "./hersheyData.js";
import { getDemoFontGlyphs } from "./font.js";
import { StrokeFont, type StrokeGlyph } from "./StrokeFont.js";

export type HersheyFontId = "sans" | "sansDuplex" | "romanTriplex" | "serif" | "serifItalic" | "script";

interface HersheyFontSource {
  readonly name: string;
  readonly file: string;
  // Characters whose glyphs come from another file, where this one's are misplaced.
  readonly borrow?: { readonly file: string; readonly characters: string };
  // Replacement glyphs, as Hershey coordinate pairs.
  readonly replace?: Readonly<Record<string, string>>;
}

// Several files draw "^" as an upward arrow; this caret is the one from the futural file.
const CARET = { "^": "JZRDJR RRDZR" };

const SOURCES: Readonly<Record<HersheyFontId, HersheyFontSource>> = {
  sans: { name: "Hershey Sans", file: "rowmans", replace: CARET },
  sansDuplex: { name: "Hershey Sans Duplex", file: "rowmand", replace: CARET },
  romanTriplex: { name: "Hershey Roman Triplex", file: "rowmant", replace: CARET },
  // This file's full stop, comma, colon and semicolon sit above the baseline.
  serif: { name: "Hershey Serif", file: "timesr", borrow: { file: "timesi", characters: ".,:;" } },
  serifItalic: { name: "Hershey Serif Italic", file: "timesi" },
  script: { name: "Hershey Script", file: "scripts", replace: CARET },
};

export const HERSHEY_FONT_IDS = Object.keys(SOURCES) as readonly HersheyFontId[];

// Hershey coordinates put the top of the capitals at y = -12 and the baseline at y = 9.
const HERSHEY_CAP_TOP = -12;
export const HERSHEY_CAP_HEIGHT = 21;
// Height of the hyphen and dashes above the baseline: the middle of the lowercase letters.
const DASH_Y = 14;
const FIRST_CHARACTER_CODE = 32;
const COORDINATE_ORIGIN = "R".charCodeAt(0);

// Decodes one glyph: the first pair holds its left and right edges, " R" lifts the pen.
function decodeGlyph(pairs: string): StrokeGlyph {
  const value = (index: number): number => pairs.charCodeAt(index) - COORDINATE_ORIGIN;
  const left = value(0);
  const polylines: Polyline[] = [];
  let points: { x: number; y: number }[] = [];
  const endStroke = (): void => {
    if (points.length > 1) polylines.push({ points, isClosed: false });
    points = [];
  };
  for (let index = 2; index + 1 < pairs.length; index += 2) {
    if (pairs[index] === " " && pairs[index + 1] === "R") endStroke();
    else points.push({ x: value(index) - left, y: value(index + 1) - HERSHEY_CAP_TOP });
  }
  endStroke();
  return { polylines, advance: value(1) - left };
}

function dash(advance: number): StrokeGlyph {
  return { polylines: [{ points: [{ x: 2, y: DASH_Y }, { x: advance - 2, y: DASH_Y }], isClosed: false }], advance };
}

function repeated(glyph: StrokeGlyph, times: number): StrokeGlyph {
  const polylines: Polyline[] = [];
  for (let copy = 0; copy < times; copy++) {
    for (const polyline of glyph.polylines) {
      polylines.push({ ...polyline, points: polyline.points.map((point) => ({ x: point.x + copy * glyph.advance, y: point.y })) });
    }
  }
  return { polylines, advance: glyph.advance * times };
}

function buildHersheyFont(id: HersheyFontId): StrokeFont {
  const source = SOURCES[id];
  const glyphs: Record<string, StrokeGlyph> = {};
  HERSHEY_DATA[source.file].forEach((pairs, index) => {
    glyphs[String.fromCharCode(FIRST_CHARACTER_CODE + index)] = decodeGlyph(pairs);
  });
  for (const character of source.borrow?.characters ?? "") {
    glyphs[character] = decodeGlyph(HERSHEY_DATA[source.borrow!.file][character.charCodeAt(0) - FIRST_CHARACTER_CODE]);
  }
  for (const [character, pairs] of Object.entries(source.replace ?? {})) glyphs[character] = decodeGlyph(pairs);
  // The "-" in these fonts is a wide minus sign on the math axis; running text wants a short hyphen.
  glyphs["−"] = glyphs["-"];
  glyphs["-"] = dash(12);
  glyphs["–"] = dash(18);
  glyphs["—"] = dash(28);
  glyphs["…"] = repeated(glyphs["."], 3);
  glyphs["•"] = {
    polylines: [{ points: [{ x: 7, y: 11 }, { x: 10, y: 14 }, { x: 7, y: 17 }, { x: 4, y: 14 }], isClosed: true }],
    advance: 14,
  };
  return new StrokeFont({ name: source.name, capHeight: HERSHEY_CAP_HEIGHT, glyphs });
}

const hersheyFonts = new Map<HersheyFontId, StrokeFont>();

// A Hershey font with lowercase, full ASCII punctuation, dashes, an ellipsis and a bullet.
// Draw it from Demo.drawText, never from draw: these fonts are for reading, and that layer has no glow.
export function getHersheyFont(id: HersheyFontId): StrokeFont {
  let font = hersheyFonts.get(id);
  if (!font) {
    font = buildHersheyFont(id);
    hersheyFonts.set(id, font);
  }
  return font;
}

let arcadeStrokeFont: StrokeFont | null = null;

// The fixed-width arcade font as a StrokeFont, so the same layout code can set text in either.
export function getArcadeStrokeFont(): StrokeFont {
  if (!arcadeStrokeFont) {
    const advance = ARCADE_FONT_METRICS.glyphWidth + ARCADE_FONT_METRICS.letterSpacing;
    const glyphs: Record<string, StrokeGlyph> = {};
    for (const [character, polylines] of Object.entries({ ...ARCADE_GLYPHS, ...getDemoFontGlyphs() })) {
      glyphs[character] = { polylines, advance };
    }
    arcadeStrokeFont = new StrokeFont({ name: "Arcade", capHeight: ARCADE_FONT_METRICS.capHeight, glyphs, hasLowercase: false });
  }
  return arcadeStrokeFont;
}
