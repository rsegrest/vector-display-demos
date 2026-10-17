import { DynamicGeometry, clipSegmentInside, type ClipRect } from "@vector-demos/demo-kit";
import { findClosure, formatSize, gearCentreAt, maximumPenSpeed, penPointAt, type Closure, type Point, type RollMode, type SpiralParameters } from "./gearMath.js";

// The values that can be set with a slider or typed in.
export type SpiralField = "baseRadius" | "gearRadius" | "penDistance" | "speed" | "hue";

export interface FieldRange {
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  // Sliders snap to this; typed values keep up to two decimal places.
  readonly step: number;
  readonly unit: string;
}

// The drawing area is a square "plate" this many units either side of its centre, whatever
// size the window is: the sizes mean the same thing in a small window as in a large one, and
// the largest ring just fits, as does the default curve rolled outside.
export const PLATE_HALF_SIZE = 170;

export const FIELD_RANGES: Readonly<Record<SpiralField, FieldRange>> = {
  baseRadius: { label: "BASE RADIUS", minimum: 20, maximum: PLATE_HALF_SIZE, step: 1, unit: "" },
  gearRadius: { label: "GEAR RADIUS", minimum: 5, maximum: 150, step: 1, unit: "" },
  penDistance: { label: "PEN DISTANCE", minimum: 0, maximum: 150, step: 1, unit: "" },
  speed: { label: "SPEED", minimum: 0.1, maximum: 10, step: 0.1, unit: "TRIPS/S" },
  hue: { label: "COLOUR", minimum: 0, maximum: 359, step: 1, unit: "" },
};

// The order of the sliders, and the order Tab moves through the typed fields.
export const FIELD_ORDER: readonly SpiralField[] = ["baseRadius", "gearRadius", "penDistance", "speed", "hue"];

// The pen colours offered as swatches, as hues in degrees: amber, green, cyan, blue, violet, red.
export const PALETTE_HUES: readonly number[] = [38, 120, 180, 215, 285, 350];

// A gear inside the ring must be at least this much smaller than it, or it has no room to roll.
export const INSIDE_CLEARANCE = 1;
// The ink kept on the plate, in line segments. Every one is copied to the screen every frame,
// so the plate holds a few large drawings' worth; past this the oldest kept drawing is dropped.
export const INK_SEGMENT_CAP = 60000;
// The longest line drawn between two pen positions, in plate units: short enough that the curve looks smooth.
export const INK_STEP_LENGTH = 2;
// No step in t is longer than this, so even a slow pen draws its circles round.
const MAXIMUM_STEP_RADIANS = 0.05;
// A curve that never closes is stopped after this many trips.
export const MAXIMUM_OPEN_TRIPS = 40;
// Typed values are cut off at this many characters.
const MAXIMUM_ENTRY_LENGTH = 7;
// Pressing on the plate this close to the gear's rim, in plate units, still takes hold of it.
const GEAR_GRAB_MARGIN = 8;
// A press that moves less than this while placing the base only moves its centre.
const BASE_DRAG_THRESHOLD = 4;

export const DEFAULT_PARAMETERS: SpiralParameters = { mode: "inside", baseRadius: 100, gearRadius: 37, penDistance: 30 };
export const DEFAULT_SPEED = 1.5;

// Why a drawing stopped by itself.
export type StopReason = "closed" | "open" | "ink";

// Defining the drawing with the mouse goes through three steps: the base, the gear, the pen.
export type DefineStep = "none" | "base" | "gear" | "pen";

const PLATE_CLIP: ClipRect = { left: -PLATE_HALF_SIZE, top: -PLATE_HALF_SIZE, right: PLATE_HALF_SIZE, bottom: PLATE_HALF_SIZE };
const TURN = Math.PI * 2;

// One curve on the plate: its settings, its ink, and how far the gear has got.
// Plate coordinates have their origin at the plate's centre with y pointing down, as the
// screen's do; the curve's own coordinates have y up, so a point (x, y) on the curve is
// drawn at (centreX + x, centreY − y) and the gear turns anticlockwise on screen.
export class Drawing {
  public readonly ink = new DynamicGeometry(1024);
  public parameters: SpiralParameters = DEFAULT_PARAMETERS;
  public centreX = 0;
  public centreY = 0;
  public hue = PALETTE_HUES[0];
  public closure: Closure | null = null;
  // The gear starts at this angle and has the curve finished by endT.
  public startT = 0;
  public endT = 0;
  // Where the gear is now, and how far the ink has been drawn: the gear can be cranked back
  // over ink already drawn without drawing it again.
  public t = 0;
  public drawnT = 0;
  public stopReason: StopReason | null = null;
  private stepT = 0.01;
  // Where the pen last was, and whether the ink reaches it (it does not off the edge of the plate).
  private hasPen = false;
  private isInkAtPen = false;
  private penX = 0;
  private penY = 0;
  private readonly point: Point = { x: 0, y: 0 };

  public get isFinished(): boolean {
    return this.stopReason !== null;
  }

  // Trips of the gear around the base so far.
  public get trips(): number {
    return (this.t - this.startT) / TURN;
  }

  // Starts the drawing over with these settings, keeping its buffer.
  public reset(parameters: SpiralParameters, centreX: number, centreY: number, hue: number, startT = 0): void {
    this.parameters = parameters;
    this.centreX = centreX;
    this.centreY = centreY;
    this.hue = hue;
    this.closure = findClosure(parameters);
    this.startT = this.t = this.drawnT = startT;
    this.endT = startT + TURN * (this.closure?.trips ?? MAXIMUM_OPEN_TRIPS);
    this.stopReason = null;
    this.stepT = Math.min(MAXIMUM_STEP_RADIANS, INK_STEP_LENGTH / Math.max(1e-6, maximumPenSpeed(parameters)));
    this.ink.clear();
    this.hasPen = false;
    this.isInkAtPen = false;
    this.addPenPoint(startT);
  }

  // Moves the gear to `target` (never before the start or past the end), inking whatever has
  // not been inked yet. `room` is how many more segments the plate can take; if that runs out
  // the drawing stops there. Returns how many segments were added.
  public advanceTo(target: number, room: number): number {
    const before = this.ink.segmentCount;
    const goal = Math.min(this.endT, Math.max(this.startT, target));
    let isOutOfRoom = false;
    // Whole steps only, so the ink is made of even lines; the gear may be up to a step ahead of it.
    while (this.drawnT + this.stepT <= goal) {
      if (this.ink.segmentCount - before >= room) {
        isOutOfRoom = true;
        break;
      }
      this.drawnT += this.stepT;
      this.addPenPoint(this.drawnT);
    }
    // The last, shorter step lands exactly on the end, so a closed curve meets its start.
    if (!isOutOfRoom && goal >= this.endT && this.drawnT < this.endT) {
      if (this.ink.segmentCount - before >= room) isOutOfRoom = true;
      else {
        this.drawnT = this.endT;
        this.addPenPoint(this.endT);
      }
    }
    this.t = isOutOfRoom ? this.drawnT : goal;
    if (this.drawnT >= this.endT) this.stopReason = this.closure ? "closed" : "open";
    else if (isOutOfRoom) this.stopReason = "ink";
    return this.ink.segmentCount - before;
  }

  // About how many segments moving the gear on to `target` would add.
  public segmentsToReach(target: number): number {
    return Math.ceil(Math.max(0, Math.min(target, this.endT) - this.drawnT) / this.stepT) + 1;
  }

  // The gear's centre at its present place, in plate coordinates.
  public gearCentre(out: Point): Point {
    gearCentreAt(this.parameters, this.t, out);
    out.x = this.centreX + out.x;
    out.y = this.centreY - out.y;
    return out;
  }

  // The pen at the gear's present place, in plate coordinates.
  public penPoint(out: Point): Point {
    penPointAt(this.parameters, this.t, out);
    out.x = this.centreX + out.x;
    out.y = this.centreY - out.y;
    return out;
  }

  // Inks a line to the pen's place at time t, cut at the plate's edge.
  private addPenPoint(t: number): void {
    penPointAt(this.parameters, t, this.point);
    const x = this.centreX + this.point.x;
    const y = this.centreY - this.point.y;
    const isInside = Math.abs(x) <= PLATE_HALF_SIZE && Math.abs(y) <= PLATE_HALF_SIZE;
    if (!this.hasPen) {
      if (isInside) this.ink.moveTo(x, y);
      this.isInkAtPen = isInside;
    } else if (this.isInkAtPen && isInside) {
      this.ink.lineTo(x, y);
    } else {
      // Only a line crossing the edge gets here, so the clipper's small allocation is rare.
      const visible = clipSegmentInside(this.penX, this.penY, x, y, PLATE_CLIP);
      if (visible) {
        const [start, end] = visible;
        const dx = x - this.penX;
        const dy = y - this.penY;
        if (!(start === 0 && this.isInkAtPen)) this.ink.moveTo(this.penX + dx * start, this.penY + dy * start);
        this.ink.lineTo(this.penX + dx * end, this.penY + dy * end);
      }
      this.isInkAtPen = visible !== null && visible[1] === 1;
    }
    this.hasPen = true;
    this.penX = x;
    this.penY = y;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// Angle of a plate point about a centre, in the curve's coordinates (y up), so it can be compared with t.
function angleAbout(centreX: number, centreY: number, x: number, y: number): number {
  return Math.atan2(centreY - y, x - centreX);
}

// The gear-and-pen toy without its window: the settings, the curves on the plate, the steps
// of defining a drawing with the mouse, and the typing of values. The window (GearSpirals)
// lays out the controls and turns presses into calls on this, in plate coordinates.
export class GearSpiralsModel {
  public parameters: SpiralParameters = DEFAULT_PARAMETERS;
  // Where the base's centre is on the plate.
  public centreX = 0;
  public centreY = 0;
  public speed = DEFAULT_SPEED;
  public hue = PALETTE_HUES[0];
  // Whether the motor is turning the gear.
  public isRunning = true;
  public defineStep: DefineStep = "none";
  // The value being typed, if any: `text` is what has been typed so far.
  public entry: { readonly field: SpiralField; text: string } | null = null;
  // The curve being drawn, and the finished ones kept underneath it, oldest first.
  public current = new Drawing();
  public readonly kept: Drawing[] = [];
  private cranking = false;
  private crankAngle = 0;
  // Where the press that started placing the base went down.
  private pressX = 0;
  private pressY = 0;
  private readonly point: Point = { x: 0, y: 0 };

  public constructor() {
    this.restart();
  }

  public get isCranking(): boolean {
    return this.cranking;
  }

  // Segments of ink on the plate, kept and current together.
  public get inkSegmentCount(): number {
    let count = this.current.ink.segmentCount;
    for (const drawing of this.kept) count += drawing.ink.segmentCount;
    return count;
  }

  public value(field: SpiralField): number {
    switch (field) {
      case "baseRadius": return this.parameters.baseRadius;
      case "gearRadius": return this.parameters.gearRadius;
      case "penDistance": return this.parameters.penDistance;
      case "speed": return this.speed;
      case "hue": return this.hue;
    }
  }

  // The largest value a field can take just now: a gear inside the ring has to be smaller than it.
  public maximumOf(field: SpiralField): number {
    const range = FIELD_RANGES[field];
    if (field === "gearRadius" && this.parameters.mode === "inside") return Math.min(range.maximum, this.parameters.baseRadius - INSIDE_CLEARANCE);
    return range.maximum;
  }

  // Sets a field, held to its range. Changing a size starts the curve again; colour recolours it; speed just changes speed.
  public setValue(field: SpiralField, value: number): void {
    if (!Number.isFinite(value)) return;
    const range = FIELD_RANGES[field];
    const held = Math.round(clamp(value, range.minimum, this.maximumOf(field)) * 100) / 100;
    if (field === "speed") {
      this.speed = held;
    } else if (field === "hue") {
      this.hue = held;
      this.current.hue = held;
    } else if (held !== this.value(field)) {
      this.setParameters({ ...this.parameters, [field]: held });
    }
  }

  // Sets a field from a slider's position, 0 at its left end and 1 at its right, snapped to its step.
  public setFromSlider(field: SpiralField, fraction: number): void {
    const range = FIELD_RANGES[field];
    const raw = range.minimum + clamp(fraction, 0, 1) * (range.maximum - range.minimum);
    this.setValue(field, roundTo(raw, range.step));
  }

  public setMode(mode: RollMode): void {
    if (mode !== this.parameters.mode) this.setParameters({ ...this.parameters, mode });
  }

  public toggleMode(): void {
    this.setMode(this.parameters.mode === "inside" ? "outside" : "inside");
  }

  public pickColour(index: number): void {
    const hue = PALETTE_HUES[index];
    if (hue !== undefined) this.setValue("hue", hue);
  }

  // The motor's switch. A finished curve is drawn again from the start.
  public toggleRunning(): void {
    if (this.defineStep !== "none") return;
    if (this.current.isFinished) {
      this.restart();
      this.isRunning = true;
    } else {
      this.isRunning = !this.isRunning;
    }
  }

  // Wipes the plate and starts the curve again.
  public clear(): void {
    this.kept.length = 0;
    this.restart();
    this.isRunning = this.defineStep === "none";
  }

  // Keeps what is on the plate and starts another curve on top, in the next colour of the
  // palette. It waits for a change of settings or the motor, so it does not simply retrace the last one.
  public overlay(): void {
    if (this.current.ink.segmentCount === 0) return;
    this.kept.push(this.current);
    const next = PALETTE_HUES.indexOf(this.hue);
    this.hue = PALETTE_HUES[(next + 1) % PALETTE_HUES.length];
    this.current = new Drawing();
    this.restart();
    this.isRunning = false;
  }

  // --- Defining with the mouse -----------------------------------------------------------------------

  // Starts defining the drawing with the mouse, or stops if already doing so.
  public toggleDefine(): void {
    this.cranking = false;
    if (this.defineStep !== "none") {
      this.defineStep = "none";
      return;
    }
    this.defineStep = "base";
    this.isRunning = false;
  }

  // A press, drag or release on the plate, in plate coordinates.
  public platePointer(kind: "down" | "move" | "up", x: number, y: number): void {
    if (this.defineStep !== "none") this.definePointer(kind, x, y);
    else this.crankPointer(kind, x, y);
  }

  private definePointer(kind: "down" | "move" | "up", x: number, y: number): void {
    const { baseRadius } = this.parameters;
    switch (this.defineStep) {
      case "base": {
        // Press at the centre, drag out to the ring.
        if (kind === "down") {
          this.pressX = clamp(x, -PLATE_HALF_SIZE, PLATE_HALF_SIZE);
          this.pressY = clamp(y, -PLATE_HALF_SIZE, PLATE_HALF_SIZE);
          this.centreX = this.pressX;
          this.centreY = this.pressY;
          this.restart();
          return;
        }
        const distance = Math.hypot(x - this.centreX, y - this.centreY);
        if (distance >= BASE_DRAG_THRESHOLD) this.setValue("baseRadius", Math.round(distance));
        if (kind === "up") this.defineStep = "gear";
        return;
      }
      case "gear": {
        // The gear touches the ring where the pointer points, and its far side follows the
        // pointer: dragged inside the ring it rolls inside, dragged outside it rolls outside.
        if (kind === "up") {
          this.defineStep = "pen";
          return;
        }
        const distance = Math.hypot(x - this.centreX, y - this.centreY);
        const mode: RollMode = distance < baseRadius ? "inside" : "outside";
        const diameter = Math.abs(distance - baseRadius);
        const range = FIELD_RANGES.gearRadius;
        const maximum = mode === "inside" ? Math.min(range.maximum, baseRadius - INSIDE_CLEARANCE) : range.maximum;
        const gearRadius = clamp(Math.round(diameter / 2), range.minimum, maximum);
        this.parameters = { ...this.parameters, mode, gearRadius };
        this.restart(angleAbout(this.centreX, this.centreY, x, y));
        return;
      }
      case "pen": {
        // A click inside the gear puts the pen there; only its distance from the centre counts.
        if (kind !== "down") return;
        const centre = this.current.gearCentre(this.point);
        const distance = Math.hypot(x - centre.x, y - centre.y);
        if (distance > this.parameters.gearRadius + GEAR_GRAB_MARGIN) return;
        this.parameters = { ...this.parameters, penDistance: Math.round(Math.min(distance, this.parameters.gearRadius)) };
        this.restart(this.current.startT);
        this.defineStep = "none";
        this.isRunning = true;
        return;
      }
      case "none":
        return;
    }
  }

  // Dragging the gear around the base cranks it by hand: t follows the pointer's angle about the base's centre.
  private crankPointer(kind: "down" | "move" | "up", x: number, y: number): void {
    const drawing = this.current;
    if (kind === "down") {
      const centre = drawing.gearCentre(this.point);
      if (drawing.isFinished || Math.hypot(x - centre.x, y - centre.y) > this.parameters.gearRadius + GEAR_GRAB_MARGIN) return;
      this.cranking = true;
      this.isRunning = false;
      this.crankAngle = angleAbout(drawing.centreX, drawing.centreY, x, y);
      return;
    }
    if (!this.cranking) return;
    if (kind === "up") {
      this.cranking = false;
      return;
    }
    const angle = angleAbout(drawing.centreX, drawing.centreY, x, y);
    // The change since the last move, taken the short way round, so the gear can be cranked round and round.
    let change = angle - this.crankAngle;
    change -= TURN * Math.round(change / TURN);
    this.crankAngle = angle;
    this.advance(drawing.t + change);
  }

  // --- Typing values ---------------------------------------------------------------------------------

  // Starts typing a value for a field, finishing any other first.
  public beginEntry(field: SpiralField): void {
    this.commitEntry();
    this.entry = { field, text: "" };
  }

  // Finishes typing: a number is set, held to its range; anything else leaves the value as it was.
  public commitEntry(): void {
    const entry = this.entry;
    if (!entry) return;
    this.entry = null;
    if (/^(\d+\.?\d*|\.\d+)$/.test(entry.text)) this.setValue(entry.field, Number(entry.text));
  }

  public cancelEntry(): void {
    this.entry = null;
  }

  // A key typed while a value is being typed. Returns whether it was used.
  public typeIntoEntry(key: string): boolean {
    const entry = this.entry;
    if (!entry) return false;
    if (/^\d$/.test(key) || (key === "." && !entry.text.includes("."))) {
      if (entry.text.length < MAXIMUM_ENTRY_LENGTH) entry.text += key;
    } else if (key === "Backspace") {
      entry.text = entry.text.slice(0, -1);
    } else if (key === "Enter") {
      this.commitEntry();
    } else if (key === "Tab") {
      const next = FIELD_ORDER[(FIELD_ORDER.indexOf(entry.field) + 1) % FIELD_ORDER.length];
      this.beginEntry(next);
    } else {
      return false;
    }
    return true;
  }

  // A key typed to the window: into the value being typed, or as a shortcut.
  public key(key: string): boolean {
    if (this.typeIntoEntry(key)) return true;
    switch (key.toLowerCase()) {
      case " ": this.toggleRunning(); return true;
      case "c": this.clear(); return true;
      case "o": this.overlay(); return true;
      case "m": this.toggleMode(); return true;
      case "d": this.toggleDefine(); return true;
      default: return false;
    }
  }

  // --- Running ---------------------------------------------------------------------------------------

  public update(deltaSeconds: number): void {
    if (!this.isRunning || this.cranking || this.defineStep !== "none" || this.current.isFinished) return;
    this.advance(this.current.t + this.speed * TURN * deltaSeconds);
    if (this.current.isFinished) this.isRunning = false;
  }

  // What the curve is doing, for the line under the controls.
  public get status(): string {
    switch (this.defineStep) {
      case "base": return "DRAG FROM THE CENTRE\nOUT TO THE BASE RING";
      case "gear": return "DRAG INSIDE OR OUTSIDE\nTHE RING TO SIZE THE GEAR";
      case "pen": return "CLICK IN THE GEAR\nTO PLACE THE PEN";
      case "none": break;
    }
    const drawing = this.current;
    const trips = drawing.trips.toFixed(1);
    switch (drawing.stopReason) {
      case "closed": return "FINISHED: THE CURVE HAS CLOSED";
      case "open": return `STOPPED AFTER ${MAXIMUM_OPEN_TRIPS} TRIPS`;
      case "ink": return "OUT OF INK\nCLEAR TO DRAW MORE";
      case null: break;
    }
    if (this.cranking) return `CRANKING  TRIP ${trips}`;
    if (this.isRunning) return `DRAWING  TRIP ${trips}`;
    return drawing.t === drawing.startT ? "PRESS DRAW, OR DRAG\nTHE GEAR ROUND BY HAND" : `PAUSED  TRIP ${trips}`;
  }

  // How the curve closes, for the readout.
  public get closureText(): string {
    const closure = this.current.closure;
    if (!closure) return "DOES NOT CLOSE";
    if (closure.petals === 0) return "1 TRIP (A CIRCLE)";
    return `${closure.trips} ${closure.trips === 1 ? "TRIP" : "TRIPS"}, ${closure.petals} PETALS`;
  }

  // The value shown in a field's box: what is being typed, or the value itself.
  public fieldText(field: SpiralField): string {
    if (this.entry?.field === field) return this.entry.text;
    return formatSize(this.value(field));
  }

  // Moves the current curve's gear, dropping the oldest kept drawings if the plate's ink runs out.
  private advance(target: number): void {
    let room = INK_SEGMENT_CAP - this.inkSegmentCount;
    // Drop old drawings until there is room for this move's ink.
    const wanted = Math.min(INK_SEGMENT_CAP, this.current.segmentsToReach(target));
    while (room < wanted && this.kept.length > 0) {
      this.kept.shift();
      room = INK_SEGMENT_CAP - this.inkSegmentCount;
    }
    this.current.advanceTo(target, Math.max(0, room));
  }

  private setParameters(parameters: SpiralParameters): void {
    // A gear inside the ring is kept smaller than it, whichever was changed.
    const gearRadius = parameters.mode === "inside" ? Math.min(parameters.gearRadius, parameters.baseRadius - INSIDE_CLEARANCE) : parameters.gearRadius;
    this.parameters = { ...parameters, gearRadius };
    this.restart(this.current.startT);
    // A change starts the drawing again by itself, except part-way through defining it.
    if (this.defineStep === "none") this.isRunning = true;
  }

  private restart(startT = this.current.startT): void {
    this.cranking = false;
    this.current.reset(this.parameters, this.centreX, this.centreY, this.hue, startT);
  }
}
