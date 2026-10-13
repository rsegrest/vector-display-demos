import type { Polyline } from "@vector-display/core";
import { ARCADE_GLYPHS, VectorFont } from "@vector-display/font";

// Marks drawn above (negative y) or below (y > 6) the 4 × 6 capital grid.
const MARKS: Readonly<Record<string, readonly Polyline[]>> = {
  "̀": [{ points: [{ x: 1.4, y: -2.6 }, { x: 2.4, y: -1.2 }], isClosed: false }], // grave
  "́": [{ points: [{ x: 1.6, y: -1.2 }, { x: 2.6, y: -2.6 }], isClosed: false }], // acute
  "̂": [{ points: [{ x: 1, y: -1.2 }, { x: 2, y: -2.4 }, { x: 3, y: -1.2 }], isClosed: false }], // circumflex
  "̃": [{ points: [{ x: 0.6, y: -1.4 }, { x: 1.5, y: -2.2 }, { x: 2.5, y: -1.4 }, { x: 3.4, y: -2.2 }], isClosed: false }], // tilde
  "̄": [{ points: [{ x: 1, y: -1.6 }, { x: 3, y: -1.6 }], isClosed: false }], // macron
  "̆": [{ points: [{ x: 1, y: -2.4 }, { x: 2, y: -1.3 }, { x: 3, y: -2.4 }], isClosed: false }], // breve
  "̇": [{ points: [{ x: 2, y: -1.6 }], isClosed: false }], // dot above
  "̈": [{ points: [{ x: 1, y: -1.6 }], isClosed: false }, { points: [{ x: 3, y: -1.6 }], isClosed: false }], // diaeresis
  "̊": [{ points: [{ x: 2, y: -2.6 }, { x: 2.6, y: -1.9 }, { x: 2, y: -1.2 }, { x: 1.4, y: -1.9 }], isClosed: true }], // ring
  "̌": [{ points: [{ x: 1, y: -2.4 }, { x: 2, y: -1.2 }, { x: 3, y: -2.4 }], isClosed: false }], // caron
  "̧": [{ points: [{ x: 2, y: 6 }, { x: 2.4, y: 6.8 }, { x: 1.4, y: 7.6 }], isClosed: false }], // cedilla
  "̨": [{ points: [{ x: 3.4, y: 6 }, { x: 2.6, y: 7 }, { x: 3.4, y: 7.6 }], isClosed: false }], // ogonek
};

// Letters that are their own shape rather than base + mark.
const SPECIAL: Readonly<Record<string, readonly Polyline[]>> = {
  "Ø": [...(ARCADE_GLYPHS["O"] ?? []), { points: [{ x: 0, y: 6.4 }, { x: 4, y: -0.4 }], isClosed: false }],
};

// Latin-1 Supplement and Latin Extended-A capitals that decompose into a base letter plus known marks.
function accentedGlyphs(): Record<string, readonly Polyline[]> {
  const glyphs: Record<string, readonly Polyline[]> = { ...SPECIAL };
  for (let code = 0xc0; code <= 0x17f; code++) {
    const character = String.fromCharCode(code);
    if (character !== character.toUpperCase()) continue;
    const [base, ...marks] = character.normalize("NFD");
    const baseGlyph = ARCADE_GLYPHS[base];
    if (!baseGlyph || marks.length === 0 || !marks.every((mark) => MARKS[mark])) continue;
    glyphs[character] = [...baseGlyph, ...marks.flatMap((mark) => MARKS[mark])];
  }
  return glyphs;
}

const EXTRA_GLYPHS: Record<string, readonly Polyline[]> = {
  // The arcade font has no square brackets, which key help needs.
  "[": [{ points: [{ x: 3, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 6 }, { x: 3, y: 6 }], isClosed: false }],
  "]": [{ points: [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 6 }, { x: 1, y: 6 }], isClosed: false }],
  // For the calculator: the arcade font has no signs for multiplying, dividing or raising to a power.
  "×": [{ points: [{ x: 0.5, y: 1.5 }, { x: 3.5, y: 4.5 }], isClosed: false }, { points: [{ x: 3.5, y: 1.5 }, { x: 0.5, y: 4.5 }], isClosed: false }],
  "÷": [{ points: [{ x: 0, y: 3 }, { x: 4, y: 3 }], isClosed: false }, { points: [{ x: 2, y: 1.2 }], isClosed: false }, { points: [{ x: 2, y: 4.8 }], isClosed: false }],
  "^": [{ points: [{ x: 0.5, y: 2 }, { x: 2, y: 0 }, { x: 3.5, y: 2 }], isClosed: false }],
  "π": [{ points: [{ x: 0, y: 2 }, { x: 4, y: 2 }], isClosed: false }, { points: [{ x: 1, y: 2 }, { x: 1, y: 6 }], isClosed: false }, { points: [{ x: 3, y: 2 }, { x: 3, y: 6 }], isClosed: false }],
  ...accentedGlyphs(),
};

// The glyphs getDemoFont adds to the arcade font.
export function getDemoFontGlyphs(): Readonly<Record<string, readonly Polyline[]>> {
  return EXTRA_GLYPHS;
}

let sharedFont: VectorFont | null = null;

// The arcade font plus square brackets, × ÷ ^ π, and accented capitals (Ü, É, Ç, Å, Ñ, Ø…).
export function getDemoFont(): VectorFont {
  sharedFont ??= VectorFont.createArcadeFont(EXTRA_GLYPHS);
  return sharedFont;
}

const PUNCTUATION: Readonly<Record<string, string>> = {
  "–": "-",
  "—": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
};

// Uppercases text and replaces anything the font cannot draw: typographic punctuation becomes ASCII,
// and accented letters without a glyph lose their accent.
export function fontSafeText(text: string): string {
  let result = "";
  for (const character of text.toUpperCase()) {
    if (PUNCTUATION[character]) result += PUNCTUATION[character];
    else if (ARCADE_GLYPHS[character] || EXTRA_GLYPHS[character] || character === " " || character === "\n") result += character;
    else result += character.normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  return result;
}
