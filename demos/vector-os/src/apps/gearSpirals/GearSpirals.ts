import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry, getDemoFont, getHersheyFont, hslToBeamColor, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import type { OsApp, PointerKind } from "../OsApp.js";
import { equationLines, gearOrbit, type Point } from "./gearMath.js";
import { FIELD_ORDER, FIELD_RANGES, GearSpiralsModel, PALETTE_HUES, PLATE_HALF_SIZE, type Drawing, type SpiralField } from "./GearSpiralsModel.js";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ButtonId = "inside" | "outside" | "run" | "define" | "overlay" | "clear";

export interface SliderLayout {
  readonly field: SpiralField;
  // Top of the label's capitals.
  readonly labelY: number;
  // The box showing the value, which is clicked to type one.
  readonly valueBox: Rect;
  readonly trackLeft: number;
  readonly trackRight: number;
  readonly trackY: number;
}

export interface GearSpiralsLayout {
  // The square plate the curves are drawn on.
  readonly plate: Rect;
  // Where the equation goes, under the plate.
  readonly equationX: number;
  readonly equationY: number;
  readonly equationWidth: number;
  readonly buttons: readonly { readonly id: ButtonId; readonly rect: Rect }[];
  readonly sliders: readonly SliderLayout[];
  readonly swatches: readonly Rect[];
  // Top of the readouts under the controls.
  readonly readoutX: number;
  readonly readoutY: number;
}

const PADDING = 12;
const PANEL_MINIMUM_WIDTH = 300;
// Room under the plate for the equation's two lines.
const EQUATION_ROOM = 50;
const BUTTON_HEIGHT = 26;
const BUTTON_GAP = 8;
const SLIDER_PITCH = 46;
const VALUE_BOX_WIDTH = 86;
const VALUE_BOX_HEIGHT = 20;
const SWATCH_SIZE = 24;
const LABEL_SIZE = 10;
const VALUE_SIZE = 11;
const BUTTON_TEXT_SIZE = 10;
const READOUT_PITCH = 18;
const KNOB_HALF = 5;
// The equation's capitals are this tall: small enough for both lines to fit under the plate.
const EQUATION_CAP_HEIGHT = 9;
const EQUATION_MINIMUM_CAP_HEIGHT = 6;
const EQUATION_LINE_PITCH = 19;
// Sides of the polygons drawn for the base and the gear.
const BASE_SIDES = 144;
const GEAR_SIDES = 72;
const PEN_MARK_RADIUS = 2.5;

const LABEL_COLOR: BeamColor = { red: 0.6, green: 0.85, blue: 1 };
const TRACK_COLOR: BeamColor = { red: 0.3, green: 0.5, blue: 0.75 };
const KNOB_COLOR: BeamColor = { red: 1, green: 0.85, blue: 0.4 };
const MECHANISM_COLOR: BeamColor = { red: 0.55, green: 0.7, blue: 0.9 };
const PLATE_COLOR: BeamColor = { red: 0.3, green: 0.45, blue: 0.7 };
const EQUATION_COLOR: BeamColor = { red: 0.8, green: 0.92, blue: 1 };

// The ink is a little under full brightness, so that where strokes cross and add up they still have somewhere to go.
const INK_INTENSITY = 0.7;
const MECHANISM_INTENSITY = 0.4;
const BASE_INTENSITY = 0.3;

const BUTTON_LABELS: Readonly<Record<Exclude<ButtonId, "run">, string>> = {
  inside: "INSIDE",
  outside: "OUTSIDE",
  define: "DEFINE",
  overlay: "OVERLAY",
  clear: "CLEAR",
};

// Where everything goes in a window of this size: the plate as large a square as fits at the
// left, the equation under it, and the controls in a column at the right.
export function layoutGearSpirals(width: number, height: number): GearSpiralsLayout {
  const plateSize = Math.max(120, Math.min(height - 2 * PADDING - EQUATION_ROOM, width - PANEL_MINIMUM_WIDTH - 3 * PADDING));
  const plate = { x: PADDING, y: PADDING, width: plateSize, height: plateSize };
  const left = plate.x + plateSize + PADDING * 2;
  const right = width - PADDING;
  const panelWidth = right - left;
  const halfWidth = (panelWidth - BUTTON_GAP) / 2;
  const buttons: { id: ButtonId; rect: Rect }[] = [];
  let y = PADDING;
  buttons.push({ id: "inside", rect: { x: left, y, width: halfWidth, height: BUTTON_HEIGHT } });
  buttons.push({ id: "outside", rect: { x: left + halfWidth + BUTTON_GAP, y, width: halfWidth, height: BUTTON_HEIGHT } });
  y += BUTTON_HEIGHT + 18;

  const sliders = FIELD_ORDER.map((field, index): SliderLayout => {
    const labelY = y + index * SLIDER_PITCH;
    return {
      field,
      labelY,
      valueBox: { x: right - VALUE_BOX_WIDTH, y: labelY - (VALUE_BOX_HEIGHT - LABEL_SIZE) / 2, width: VALUE_BOX_WIDTH, height: VALUE_BOX_HEIGHT },
      trackLeft: left + KNOB_HALF,
      trackRight: right - KNOB_HALF,
      trackY: labelY + 26,
    };
  });
  y += FIELD_ORDER.length * SLIDER_PITCH + 2;

  const swatchGap = (panelWidth - PALETTE_HUES.length * SWATCH_SIZE) / Math.max(1, PALETTE_HUES.length - 1);
  const swatches = PALETTE_HUES.map((_, index) => ({ x: left + index * (SWATCH_SIZE + swatchGap), y, width: SWATCH_SIZE, height: SWATCH_SIZE }));
  y += SWATCH_SIZE + 16;

  const grid: ButtonId[] = ["run", "define", "overlay", "clear"];
  grid.forEach((id, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    buttons.push({ id, rect: { x: left + column * (halfWidth + BUTTON_GAP), y: y + row * (BUTTON_HEIGHT + BUTTON_GAP), width: halfWidth, height: BUTTON_HEIGHT } });
  });
  y += 2 * BUTTON_HEIGHT + BUTTON_GAP + 18;

  return {
    plate,
    equationX: plate.x,
    equationY: plate.y + plateSize + 14,
    equationWidth: plateSize,
    buttons,
    sliders,
    swatches,
    readoutX: left,
    readoutY: y,
  };
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function inkColour(hue: number): BeamColor {
  return hslToBeamColor(hue / 360, 1, 0.6);
}

// The gear-and-pen spiral toy: a ring, a gear rolling round it with a pen in one of its holes,
// and the curve the pen draws, with the controls to change them all and the curve's equation.
export class GearSpirals implements Demo {
  public readonly model = new GearSpiralsModel();
  private layout = layoutGearSpirals(980, 644);
  private readonly mechanism = new DynamicGeometry(512);
  private readonly frame = new DynamicGeometry(16);
  private readonly tracks = new DynamicGeometry(16);
  private readonly hueTrack = new DynamicGeometry(4);
  private readonly knobs = new DynamicGeometry(64);
  private readonly outlines = new DynamicGeometry(64);
  private readonly litOutlines = new DynamicGeometry(64);
  private readonly swatch = new DynamicGeometry(32);
  private readonly pen = new DynamicGeometry(16);
  // Reused so drawing a frame allocates nothing for the ink.
  private readonly placement = { ...SCREEN_SPACE_PLACEMENT, intensity: INK_INTENSITY };
  private readonly point: Point = { x: 0, y: 0 };
  private readonly gearPoint: Point = { x: 0, y: 0 };
  // What the pointer is holding: a slider, or the plate.
  private held: { readonly kind: "slider"; readonly field: SpiralField } | { readonly kind: "plate" } | null = null;
  private hovered: ButtonId | null = null;

  public update(deltaSeconds: number): void {
    this.model.update(deltaSeconds);
  }

  public resize(width: number, height: number): void {
    this.layout = layoutGearSpirals(width, height);
  }

  public key(key: string): boolean {
    return this.model.key(key);
  }

  public pointer(kind: PointerKind, x: number, y: number): void {
    const model = this.model;
    if (kind === "hover") {
      this.hovered = this.layout.buttons.find(({ rect }) => contains(rect, x, y))?.id ?? null;
      return;
    }
    const held = this.held;
    if (kind !== "down") {
      if (held?.kind === "slider") this.slide(held.field, x);
      else if (held?.kind === "plate") model.platePointer(kind, ...this.toPlate(x, y));
      if (kind === "up") this.held = null;
      return;
    }

    const slider = this.layout.sliders.find((candidate) => contains(candidate.valueBox, x, y));
    if (slider) {
      model.beginEntry(slider.field);
      return;
    }
    // Pressing anywhere else finishes a value being typed.
    model.commitEntry();
    const button = this.layout.buttons.find(({ rect }) => contains(rect, x, y));
    if (button) {
      this.press(button.id);
      return;
    }
    const swatch = this.layout.swatches.findIndex((rect) => contains(rect, x, y));
    if (swatch >= 0) {
      model.pickColour(swatch);
      return;
    }
    const track = this.layout.sliders.find((candidate) => x >= candidate.trackLeft - 10 && x <= candidate.trackRight + 10 && Math.abs(y - candidate.trackY) <= 10);
    if (track) {
      this.held = { kind: "slider", field: track.field };
      this.slide(track.field, x);
      return;
    }
    if (contains(this.layout.plate, x, y)) {
      this.held = { kind: "plate" };
      model.platePointer("down", ...this.toPlate(x, y));
    }
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    this.layout = layoutGearSpirals(frame.width, frame.height);
    this.drawPlate(displayList);
    this.drawControls(displayList, frame.seconds);
  }

  // The equation, in a Hershey font on the plain text layer: it is read rather than glanced at.
  public drawText(displayList: DisplayList): void {
    const font = getHersheyFont("serif");
    const lines = equationLines(this.model.parameters);
    const { equationX, equationY, equationWidth } = this.layout;
    const widest = Math.max(...lines.map((line) => font.measureWidth(line, EQUATION_CAP_HEIGHT)));
    // Long decimals can make a line too wide for the plate; then both lines are set smaller.
    const size = Math.max(EQUATION_MINIMUM_CAP_HEIGHT, Math.min(EQUATION_CAP_HEIGHT, (EQUATION_CAP_HEIGHT * equationWidth) / widest));
    displayList.setColor(EQUATION_COLOR);
    lines.forEach((line, index) => {
      font.addText(displayList, { text: line, x: equationX, y: equationY + index * EQUATION_LINE_PITCH, size, intensity: 0.9 });
    });
  }

  // Converts a point in the window to plate coordinates.
  public toPlate(x: number, y: number): [number, number] {
    const { plate } = this.layout;
    const scale = plate.width / 2 / PLATE_HALF_SIZE;
    return [(x - plate.x - plate.width / 2) / scale, (y - plate.y - plate.height / 2) / scale];
  }

  private press(id: ButtonId): void {
    const model = this.model;
    switch (id) {
      case "inside": model.setMode("inside"); break;
      case "outside": model.setMode("outside"); break;
      case "run": model.toggleRunning(); break;
      case "define": model.toggleDefine(); break;
      case "overlay": model.overlay(); break;
      case "clear": model.clear(); break;
    }
  }

  private slide(field: SpiralField, x: number): void {
    const slider = this.layout.sliders.find((candidate) => candidate.field === field);
    if (slider) this.model.setFromSlider(field, (x - slider.trackLeft) / (slider.trackRight - slider.trackLeft));
  }

  private drawPlate(displayList: DisplayList): void {
    const model = this.model;
    const { plate } = this.layout;
    const scale = plate.width / 2 / PLATE_HALF_SIZE;
    const centreX = plate.x + plate.width / 2;
    const centreY = plate.y + plate.height / 2;

    // A faint edge to the plate, so it is clear where the drawing can go.
    this.frame.clear();
    addRectangle(this.frame, plate, 0);
    displayList.setColor(PLATE_COLOR);
    displayList.addShape(this.frame, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.25 });

    // The ink: each drawing's segments, kept from frame to frame and placed with one transform.
    this.placement.x = centreX;
    this.placement.y = centreY;
    this.placement.scale = scale;
    for (const drawing of model.kept) this.drawInk(displayList, drawing);
    this.drawInk(displayList, model.current);

    // The base, the gear and the pen arm, dimmer than the ink. Once a curve is finished they are
    // put away, so the drawing can be seen by itself; while defining they show what is being set.
    const drawing = model.current;
    const isDefining = model.defineStep !== "none";
    if (drawing.isFinished && !isDefining) return;
    const toScreenX = (plateX: number): number => centreX + plateX * scale;
    const toScreenY = (plateY: number): number => centreY + plateY * scale;
    const { baseRadius, gearRadius } = drawing.parameters;

    this.mechanism.clear();
    addCircle(this.mechanism, toScreenX(drawing.centreX), toScreenY(drawing.centreY), baseRadius * scale, BASE_SIDES);
    displayList.setColor(MECHANISM_COLOR);
    displayList.addShape(this.mechanism, { ...SCREEN_SPACE_PLACEMENT, intensity: BASE_INTENSITY });
    if (isDefining && model.defineStep === "base") return;

    const gear = drawing.gearCentre(this.gearPoint);
    const penPoint = drawing.penPoint(this.point);
    const gearX = toScreenX(gear.x);
    const gearY = toScreenY(gear.y);
    const penX = toScreenX(penPoint.x);
    const penY = toScreenY(penPoint.y);
    this.mechanism.clear();
    addCircle(this.mechanism, gearX, gearY, gearRadius * scale, GEAR_SIDES);
    // A spoke from the centre to the rim, opposite the pen and turning with the gear, so the gear
    // is seen to roll even when the pen sits at its centre. The arm points at the angle
    // (±cos kt, sin kt) on screen, k being the spin ratio and the sign that of the mode.
    const { spinRatio } = gearOrbit(drawing.parameters);
    const sign = drawing.parameters.mode === "inside" ? 1 : -1;
    const spoke = gearRadius * scale;
    this.mechanism.addSegment(gearX, gearY, gearX - sign * Math.cos(spinRatio * drawing.t) * spoke, gearY - Math.sin(spinRatio * drawing.t) * spoke);
    if (model.defineStep !== "pen") this.mechanism.addSegment(gearX, gearY, penX, penY);
    displayList.addShape(this.mechanism, { ...SCREEN_SPACE_PLACEMENT, intensity: MECHANISM_INTENSITY });

    // The pen itself, a small ring in the ink's colour.
    if (model.defineStep === "pen") return;
    this.pen.clear();
    addCircle(this.pen, penX, penY, PEN_MARK_RADIUS, 10);
    displayList.setColor(inkColour(drawing.hue));
    displayList.addShape(this.pen, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.9 });
  }

  private drawInk(displayList: DisplayList, drawing: Drawing): void {
    if (drawing.ink.segmentCount === 0) return;
    displayList.setColor(inkColour(drawing.hue));
    displayList.addShape(drawing.ink, this.placement);
  }

  private drawControls(displayList: DisplayList, seconds: number): void {
    const model = this.model;
    const font = getDemoFont();
    const layout = this.layout;

    // Buttons: the mode in use and the one under the pointer are lit.
    this.outlines.clear();
    this.litOutlines.clear();
    for (const { id, rect } of layout.buttons) {
      const isLit = id === this.hovered || id === model.parameters.mode || (id === "define" && model.defineStep !== "none");
      addRectangle(isLit ? this.litOutlines : this.outlines, rect, 0);
      if (id === model.parameters.mode) addRectangle(this.litOutlines, rect, 3);
      const label = id === "run" ? (model.isRunning ? "PAUSE" : "DRAW") : BUTTON_LABELS[id];
      displayList.setColor(LABEL_COLOR);
      font.addText(displayList, { text: label, x: rect.x + rect.width / 2, y: rect.y + (rect.height - BUTTON_TEXT_SIZE) / 2, size: BUTTON_TEXT_SIZE, alignment: "center", intensity: isLit ? 1.2 : 0.9 });
    }

    // Sliders, each with its label, a box with its value, and a track with a knob.
    this.tracks.clear();
    this.knobs.clear();
    for (const slider of layout.sliders) {
      const range = FIELD_RANGES[slider.field];
      const isTyping = model.entry?.field === slider.field;
      displayList.setColor(LABEL_COLOR);
      font.addText(displayList, { text: range.label, x: slider.trackLeft - KNOB_HALF, y: slider.labelY, size: LABEL_SIZE, intensity: 0.85 });
      // The box: what is being typed with a blinking cursor, or the value.
      const box = slider.valueBox;
      addRectangle(isTyping ? this.litOutlines : this.outlines, box, 0);
      const cursor = isTyping && Math.floor(seconds * 2.5) % 2 === 0 ? "_" : isTyping ? " " : "";
      const shown = `${model.fieldText(slider.field)}${cursor}`;
      font.addText(displayList, { text: shown, x: box.x + box.width - 6, y: box.y + (box.height - VALUE_SIZE) / 2, size: VALUE_SIZE, alignment: "right", intensity: isTyping ? 1.25 : 1 });
      if (range.unit) font.addText(displayList, { text: range.unit, x: box.x - 8, y: slider.labelY + (LABEL_SIZE - 8) / 2, size: 8, alignment: "right", intensity: 0.6 });

      const fraction = (model.value(slider.field) - range.minimum) / (range.maximum - range.minimum);
      const knobX = slider.trackLeft + fraction * (slider.trackRight - slider.trackLeft);
      if (slider.field === "hue") this.drawHueTrack(displayList, slider);
      else this.tracks.addSegment(slider.trackLeft, slider.trackY, slider.trackRight, slider.trackY);
      addRectangle(this.knobs, { x: knobX - KNOB_HALF, y: slider.trackY - KNOB_HALF * 1.6, width: KNOB_HALF * 2, height: KNOB_HALF * 3.2 }, 0);
    }
    displayList.setColor(TRACK_COLOR);
    displayList.addShape(this.tracks, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.7 });
    displayList.setColor(KNOB_COLOR);
    displayList.addShape(this.knobs, { ...SCREEN_SPACE_PLACEMENT, intensity: 1.1 });

    // The palette: a ring of each colour, the one in use ringed twice.
    layout.swatches.forEach((rect, index) => {
      const hue = PALETTE_HUES[index];
      const centreX = rect.x + rect.width / 2;
      const centreY = rect.y + rect.height / 2;
      this.swatch.clear();
      addCircle(this.swatch, centreX, centreY, rect.width / 2 - 4, 16);
      if (hue === model.hue) addCircle(this.swatch, centreX, centreY, rect.width / 2, 20);
      displayList.setColor(inkColour(hue));
      displayList.addShape(this.swatch, { ...SCREEN_SPACE_PLACEMENT, intensity: hue === model.hue ? 1.2 : 0.8 });
    });

    displayList.setColor(LABEL_COLOR);
    displayList.addShape(this.outlines, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.5 });
    displayList.addShape(this.litOutlines, { ...SCREEN_SPACE_PLACEMENT, intensity: 1 });

    // Readouts: how the curve closes, then what it is doing.
    let y = layout.readoutY;
    font.addText(displayList, { text: model.current.closure ? "CLOSES AFTER" : "CLOSURE", x: layout.readoutX, y, size: LABEL_SIZE, intensity: 0.6 });
    y += READOUT_PITCH;
    displayList.setColor(KNOB_COLOR);
    font.addText(displayList, { text: model.closureText, x: layout.readoutX, y, size: VALUE_SIZE, intensity: 1 });
    y += READOUT_PITCH + 6;
    displayList.setColor(LABEL_COLOR);
    for (const line of model.status.split("\n")) {
      font.addText(displayList, { text: line, x: layout.readoutX, y, size: LABEL_SIZE, intensity: 0.85 });
      y += READOUT_PITCH - 2;
    }
  }

  // The colour slider's track is drawn in the colours it chooses between, as short dashes:
  // pieces that touched would burn a bright dot where each meets the next.
  private drawHueTrack(displayList: DisplayList, slider: SliderLayout): void {
    const pieces = 12;
    const width = (slider.trackRight - slider.trackLeft) / pieces;
    for (let piece = 0; piece < pieces; piece++) {
      this.hueTrack.clear();
      this.hueTrack.addSegment(slider.trackLeft + piece * width + 2, slider.trackY, slider.trackLeft + (piece + 1) * width - 2, slider.trackY);
      displayList.setColor(inkColour(((piece + 0.5) / pieces) * 360));
      displayList.addShape(this.hueTrack, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.7 });
    }
  }
}

function addRectangle(geometry: DynamicGeometry, rect: Rect, inset: number): void {
  const left = rect.x + inset;
  const top = rect.y + inset;
  const right = rect.x + rect.width - inset;
  const bottom = rect.y + rect.height - inset;
  geometry.moveTo(left, top);
  geometry.lineTo(right, top);
  geometry.lineTo(right, bottom);
  geometry.lineTo(left, bottom);
  geometry.closePath();
}

function addCircle(geometry: DynamicGeometry, centreX: number, centreY: number, radius: number, sides: number): void {
  geometry.moveTo(centreX + radius, centreY);
  for (let side = 1; side < sides; side++) {
    const angle = (side / sides) * Math.PI * 2;
    geometry.lineTo(centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius);
  }
  geometry.closePath();
}

export function createGearSpirals(): OsApp {
  const spirals = new GearSpirals();
  return {
    demo: spirals,
    worldHeight: null,
    brightness: 1,
    onKey: (key) => spirals.key(key),
    onPointer: (kind, x, y) => spirals.pointer(kind, x, y),
  };
}
