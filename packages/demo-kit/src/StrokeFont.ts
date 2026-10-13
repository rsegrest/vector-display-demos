import { Shape, type DisplayList, type Polyline } from "@vector-display/core";

// A glyph's strokes in font units (y down, top of the capitals at 0), with its left edge at x = 0.
export interface StrokeGlyph {
  readonly polylines: readonly Polyline[];
  // Distance from this glyph's left edge to the next one's.
  readonly advance: number;
}

export interface StrokeFontDefinition {
  readonly name: string;
  // Height of a capital letter in font units; text sizes are given as this height in world units.
  readonly capHeight: number;
  readonly glyphs: Readonly<Record<string, StrokeGlyph>>;
  // For fonts with capitals only: draw lowercase letters as capitals.
  readonly hasLowercase?: boolean;
}

export type StrokeTextAlignment = "left" | "center" | "right";

export interface StrokeTextRun {
  readonly text: string;
  // Top of the first line's capitals. x is the left edge, the center or the right edge, by alignment.
  readonly x: number;
  readonly y: number;
  // Height of capital letters in world units.
  readonly size: number;
  readonly alignment?: StrokeTextAlignment;
  // Lines longer than this are wrapped between words.
  readonly maxWidth?: number;
  // Distance from one line to the next, as a multiple of size.
  readonly lineHeight?: number;
  // Extra space after every character, as a multiple of size.
  readonly tracking?: number;
  readonly intensity?: number;
}

export interface StrokeTextExtent {
  readonly lineCount: number;
  // From the top of the first line to the top of the line that would follow the last.
  readonly height: number;
}

export const DEFAULT_LINE_HEIGHT = 1.7;

const ALIGNMENT_FACTORS: Readonly<Record<StrokeTextAlignment, number>> = { left: 0, center: 0.5, right: 1 };

// Typographic characters drawn as their plain equivalents when the font has no glyph for them.
const SUBSTITUTES: Readonly<Record<string, string>> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "−": "-",
  "–": "-",
  "—": "-",
  "\u00A0": " ",
};

interface PreparedGlyph {
  readonly shape: Shape | null;
  readonly advance: number;
}

// A stroke font in which every glyph has its own width, with word wrap for running text.
// (VectorFont in @vector-display/font gives every character the same width.)
export class StrokeFont {
  public readonly name: string;
  public readonly capHeight: number;
  private readonly definition: StrokeFontDefinition;
  private readonly prepared = new Map<string, PreparedGlyph>();
  private readonly placement = { x: 0, y: 0, rotation: 0, scale: 1, intensity: 1 };

  public constructor(definition: StrokeFontDefinition) {
    this.definition = definition;
    this.name = definition.name;
    this.capHeight = definition.capHeight;
  }

  public hasGlyph(character: string): boolean {
    return this.findDefinition(character) !== undefined;
  }

  public measureWidth(text: string, size: number, tracking = 0): number {
    const scale = size / this.capHeight;
    let width = 0;
    let count = 0;
    for (const character of text) {
      width += this.glyphFor(character).advance * scale;
      count++;
    }
    return width + Math.max(0, count - 1) * tracking * size;
  }

  // Breaks text into lines no wider than maxWidth, between words. Line breaks in the text are kept,
  // and a single word wider than maxWidth gets a line to itself.
  public wrap(text: string, size: number, maxWidth: number, tracking = 0): string[] {
    const lines: string[] = [];
    const spaceWidth = this.measureWidth(" ", size) + 2 * tracking * size;
    for (const paragraph of text.split("\n")) {
      let line = "";
      let lineWidth = 0;
      for (const word of paragraph.split(" ")) {
        if (word === "") continue;
        const wordWidth = this.measureWidth(word, size, tracking);
        if (line !== "" && lineWidth + spaceWidth + wordWidth > maxWidth) {
          lines.push(line);
          line = "";
        }
        lineWidth = line === "" ? wordWidth : lineWidth + spaceWidth + wordWidth;
        line = line === "" ? word : `${line} ${word}`;
      }
      lines.push(line);
    }
    return lines;
  }

  public measureText(run: Omit<StrokeTextRun, "x" | "y">): StrokeTextExtent {
    const lineCount = this.linesOf(run).length;
    return { lineCount, height: lineCount * run.size * (run.lineHeight ?? DEFAULT_LINE_HEIGHT) };
  }

  // Characters without a glyph are skipped but take up the room of a space.
  public addText(displayList: DisplayList, run: StrokeTextRun): StrokeTextExtent {
    const scale = run.size / this.capHeight;
    const tracking = (run.tracking ?? 0) * run.size;
    const lineAdvance = run.size * (run.lineHeight ?? DEFAULT_LINE_HEIGHT);
    const alignmentFactor = ALIGNMENT_FACTORS[run.alignment ?? "left"];
    const lines = this.linesOf(run);
    this.placement.scale = scale;
    this.placement.intensity = run.intensity ?? 1;
    lines.forEach((line, lineIndex) => {
      let x = run.x - (alignmentFactor === 0 ? 0 : this.measureWidth(line, run.size, run.tracking) * alignmentFactor);
      for (const character of line) {
        const glyph = this.glyphFor(character);
        if (glyph.shape) {
          this.placement.x = x;
          this.placement.y = run.y + lineIndex * lineAdvance;
          displayList.addShape(glyph.shape, this.placement);
        }
        x += glyph.advance * scale + tracking;
      }
    });
    return { lineCount: lines.length, height: lines.length * lineAdvance };
  }

  private linesOf(run: Omit<StrokeTextRun, "x" | "y">): string[] {
    return run.maxWidth === undefined ? run.text.split("\n") : this.wrap(run.text, run.size, run.maxWidth, run.tracking);
  }

  private glyphFor(character: string): PreparedGlyph {
    let glyph = this.prepared.get(character);
    if (!glyph) {
      const definition = this.findDefinition(character) ?? this.definition.glyphs[" "];
      const hasStrokes = definition !== undefined && definition.polylines.length > 0;
      glyph = { shape: hasStrokes ? Shape.fromPolylines(definition.polylines) : null, advance: definition?.advance ?? 0 };
      this.prepared.set(character, glyph);
    }
    return glyph;
  }

  // The glyph for a character, else for its plain equivalent, else for the letter under its accent.
  private findDefinition(character: string): StrokeGlyph | undefined {
    const glyphs = this.definition.glyphs;
    const candidates = [character, SUBSTITUTES[character], character.normalize("NFD")[0]];
    for (const candidate of candidates) {
      if (candidate === undefined) continue;
      if (glyphs[candidate]) return glyphs[candidate];
      if (this.definition.hasLowercase === false && glyphs[candidate.toUpperCase()]) return glyphs[candidate.toUpperCase()];
    }
    return undefined;
  }
}
