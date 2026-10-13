import type { BeamColor, DisplayList } from "@vector-display/core";
import {
  HERSHEY_FONT_IDS,
  getArcadeStrokeFont,
  getHersheyFont,
  type Demo,
  type DemoFrame,
  type StrokeFont,
  type StrokeTextRun,
} from "@vector-demos/demo-kit";

export const SPECIMEN_WORLD_HEIGHT = 1000;

// The fonts on show: every Hershey font, then the arcade font the demos use now, for comparison.
export const SPECIMEN_FONTS: readonly StrokeFont[] = [...HERSHEY_FONT_IDS.map(getHersheyFont), getArcadeStrokeFont()];

export const TEXT_COLORS: readonly { readonly name: string; readonly color: BeamColor }[] = [
  { name: "WHITE", color: { red: 0.82, green: 0.94, blue: 1 } },
  { name: "GREEN", color: { red: 0.3, green: 1, blue: 0.45 } },
  { name: "AMBER", color: { red: 1, green: 0.72, blue: 0.2 } },
];
const LABEL_COLOR: BeamColor = { red: 0.35, green: 0.75, blue: 0.95 };

// Sizes are heights of a capital letter in CSS pixels. Ordinary type is about 1.4 times its capital height.
export const WATERFALL_SIZES: readonly number[] = [14, 11, 9, 7.5, 6];
export const READING_SIZE_RANGE = { low: 4, high: 20, step: 0.5 } as const;
export const BEAM_WIDTH_RANGE = { low: 0.5, high: 3, step: 0.1 } as const;
// Glow is the halo drawn around each stroke plus the bloom of the phosphor pass; 0 leaves the bare beam.
export const GLOW_RANGE = { low: 0, high: 1, step: 0.1 } as const;
const TYPE_SIZE_PER_CAP_HEIGHT = 1.4;

const MARGIN = 36;
const COLUMN_GAP = 48;
const LABEL_SIZE = 8;

const CHARACTER_SET = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789 .,:;!? '\" ()[]{}<> /\\| @#$%& *+-=_^~`",
].join("\n");

const WATERFALL_TEXT =
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs: 0123456789!";

const READING_TEXT = [
  "Before pixels, a screen was a single point of light. The beam went wherever it was sent, and it drew " +
    "nothing but lines; where two lines crossed, the glass burned a little brighter.",
  "",
  "Small type is the hard case. Each letter here is only a handful of straight strokes, so a curve is really " +
    "a polygon – look closely at the “o” or the “g” – and at this size the width of the beam matters more " +
    "than the shape of the letter.",
  "",
  "Can you read this comfortably? Press [ and ] to change the beam width, comma and full stop to change the " +
    "glow, - and + to change the size of this column, and C to switch between the phosphor layer and the crisp overlay.",
  "",
  "• 3 windows open  • 12:45 PM  • 98.6% idle — it's all strokes…",
].join("\n");

const HELP_TEXT =
  "Left / Right: font    C: phosphor or crisp    [ ]: beam width    , .: glow    - +: reading size    G: color    F: fullscreen    Esc: menu";

export interface TypeSpecimenOptions {
  readonly fontIndex?: number;
  readonly isCrisp?: boolean;
  readonly readingSize?: number;
  readonly beamWidth?: number;
  readonly glow?: number;
  readonly colorIndex?: number;
}

function clamp(value: number, range: { readonly low: number; readonly high: number }): number {
  return Math.max(range.low, Math.min(range.high, value));
}

// One screen per font: its character set, a sentence at several sizes, and a column of running text.
// Nothing moves; the point is to judge how small the type can go and still read comfortably.
export class TypeSpecimenDemo implements Demo {
  public fontIndex: number;
  // Crisp draws on the overlay layer, after the phosphor pass: no bloom and no trails.
  public isCrisp: boolean;
  public readingSize: number;
  public beamWidth: number;
  public glow: number;
  public colorIndex: number;
  // World units per CSS pixel, kept up to date by the page, so that sizes can be given in pixels.
  public unitsPerPixel = 1;
  public segmentCount = 0;

  private readonly chromeFont = SPECIMEN_FONTS[0];

  public constructor(options: TypeSpecimenOptions = {}) {
    this.fontIndex = Math.max(0, Math.min(SPECIMEN_FONTS.length - 1, options.fontIndex ?? 0));
    this.isCrisp = options.isCrisp ?? false;
    this.readingSize = clamp(options.readingSize ?? 9, READING_SIZE_RANGE);
    this.beamWidth = clamp(options.beamWidth ?? 1.3, BEAM_WIDTH_RANGE);
    this.glow = clamp(options.glow ?? 0.3, GLOW_RANGE);
    this.colorIndex = Math.max(0, Math.min(TEXT_COLORS.length - 1, options.colorIndex ?? 0));
  }

  public get font(): StrokeFont {
    return SPECIMEN_FONTS[this.fontIndex];
  }

  public changeFont(direction: number): void {
    this.fontIndex = (this.fontIndex + direction + SPECIMEN_FONTS.length) % SPECIMEN_FONTS.length;
  }

  public changeReadingSize(direction: number): void {
    this.readingSize = clamp(this.readingSize + direction * READING_SIZE_RANGE.step, READING_SIZE_RANGE);
  }

  public changeBeamWidth(direction: number): void {
    const stepped = this.beamWidth + direction * BEAM_WIDTH_RANGE.step;
    this.beamWidth = clamp(Math.round(stepped * 10) / 10, BEAM_WIDTH_RANGE);
  }

  public changeGlow(direction: number): void {
    this.glow = clamp(Math.round((this.glow + direction * GLOW_RANGE.step) * 10) / 10, GLOW_RANGE);
  }

  public cycleColor(): void {
    this.colorIndex = (this.colorIndex + 1) % TEXT_COLORS.length;
  }

  public update(): void {}

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    if (!this.isCrisp) this.compose(displayList, frame);
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    if (this.isCrisp) this.compose(displayList, frame);
  }

  private compose(displayList: DisplayList, frame: DemoFrame): void {
    const unit = this.unitsPerPixel;
    const font = this.font;
    const textColor = TEXT_COLORS[this.colorIndex].color;
    const left = MARGIN * unit;
    const right = frame.width - MARGIN * unit;
    let y = MARGIN * unit;

    const label = (text: string, x: number, top: number, alignment: "left" | "right" = "left"): number => {
      displayList.setColor(LABEL_COLOR);
      const extent = this.chromeFont.addText(displayList, { text, x, y: top, size: LABEL_SIZE * unit, alignment, tracking: 0.04 });
      displayList.setColor(textColor);
      return extent.height;
    };

    // Counts only the specimen's own text, so the figure does not depend on the digits that report it.
    let segmentCount = 0;
    const specimen = (run: StrokeTextRun): number => {
      const before = displayList.segmentCount;
      const extent = font.addText(displayList, run);
      segmentCount += displayList.segmentCount - before;
      return extent.height;
    };

    displayList.setColor(textColor);
    specimen({ text: font.name, x: left, y, size: 24 * unit });
    const layer = this.isCrisp ? "crisp overlay" : "phosphor";
    label(`${layer}   beam ${this.beamWidth.toFixed(1)} px   glow ${Math.round(this.glow * 100)}%   ${this.segmentCount} segments of text`, right, y, "right");
    label(`font ${this.fontIndex + 1} of ${SPECIMEN_FONTS.length}`, right, y + LABEL_SIZE * 2 * unit, "right");
    y += 24 * 2.1 * unit;

    y += specimen({ text: CHARACTER_SET, x: left, y, size: 14 * unit, maxWidth: right - left });
    y += 14 * unit;

    const columnWidth = (right - left - COLUMN_GAP * unit) / 2;
    let waterfallY = y;
    for (const size of WATERFALL_SIZES) {
      waterfallY += label(this.sizeLabel(size), left, waterfallY) + 3 * unit;
      waterfallY += specimen({ text: WATERFALL_TEXT, x: left, y: waterfallY, size: size * unit, maxWidth: columnWidth }) + 12 * unit;
    }

    const readingLeft = right - columnWidth;
    y += label(`running text, ${this.sizeLabel(this.readingSize)}`, readingLeft, y) + 3 * unit;
    specimen({ text: READING_TEXT, x: readingLeft, y, size: this.readingSize * unit, maxWidth: columnWidth });

    displayList.setColor(LABEL_COLOR);
    this.chromeFont.addText(displayList, {
      text: HELP_TEXT,
      x: left,
      y: frame.height - (MARGIN + LABEL_SIZE) * unit,
      size: LABEL_SIZE * unit,
      tracking: 0.04,
      intensity: 0.8,
    });
    this.segmentCount = segmentCount;
  }

  private sizeLabel(capHeight: number): string {
    return `capitals ${capHeight} px high, like ${Math.round(capHeight * TYPE_SIZE_PER_CAP_HEIGHT)} px type`;
  }
}
