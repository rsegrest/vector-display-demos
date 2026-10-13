import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import {
  DemoHud,
  DynamicGeometry,
  buildPath,
  heartPath,
  starPath,
  textPath,
  trianglePath,
  type BeamPath,
  type Demo,
  type DemoFrame,
  type Point3,
} from "@vector-demos/demo-kit";
import { chainAt, epicyclesFor, resamplePath, type Epicycle, type SampledPath } from "./sim/fourier.js";

export const EPICYCLES_WORLD_HEIGHT = 1000;
// Points the path is measured at, and so the number of circles available.
export const SAMPLE_COUNT = 512;
// How many circles to use, from a crude blob to every one there is.
export const TERM_LEVELS: readonly number[] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 255];
// The levels the hands-off mode steps through, one per trip round the shape.
const AUTO_LEVELS: readonly number[] = [1, 3, 5, 7, 9, 11];
export const SPEEDS: readonly number[] = [0.5, 1, 2, 4];
export const TRAIL_MODES: readonly { readonly name: string; readonly halfLifeMilliseconds: number }[] = [
  { name: "SHORT", halfLifeMilliseconds: 40 },
  { name: "MEDIUM", halfLifeMilliseconds: 140 },
  { name: "LONG", halfLifeMilliseconds: 500 },
];
// Seconds for one trip round the shape at speed 1.
export const REVOLUTION_SECONDS = 7;

export interface ShapeEntry {
  readonly name: string;
  readonly path: () => BeamPath;
}

export const SHAPES: readonly ShapeEntry[] = [
  { name: "STAR", path: starPath },
  { name: "HEART", path: heartPath },
  { name: "LETTER R", path: () => textPath("R") },
  { name: "TRIANGLE", path: trianglePath },
  { name: "LETTER S", path: () => textPath("S") },
  { name: "NUMBER 8", path: () => textPath("8") },
  { name: "QUESTION MARK", path: () => textPath("?") },
  { name: "VECTOR", path: () => textPath("VECTOR") },
];

// Share of the screen's shorter side that the shape's bounding radius covers.
const SHAPE_SHARE = 0.36;
// The traced line is remembered at this many points round the shape.
const TRACE_POINTS = 1024;
const TRACE_BANDS = 4;
// Circles smaller than this (world units) are too small to see and are not drawn.
const SMALLEST_CIRCLE = 1.5;
// A sketch needs at least this many points, this far apart, to be worth tracing.
const SKETCH_MINIMUM_POINTS = 8;
const SKETCH_SPACING = 6;

const CIRCLE_COLOR: BeamColor = { red: 0.3, green: 0.55, blue: 1 };
const ARM_COLOR: BeamColor = { red: 0.55, green: 0.9, blue: 1 };
const TRACE_COLOR: BeamColor = { red: 1, green: 0.8, blue: 0.4 };
const GHOST_COLOR: BeamColor = { red: 0.5, green: 0.55, blue: 0.65 };
const SKETCH_COLOR: BeamColor = { red: 0.6, green: 1, blue: 0.7 };

const HELP_LINES = [
  "DRAW A SHAPE WITH THE POINTER   N / B SHAPE   [ ] CIRCLES   0-9 TRACE THAT DIGIT   A AUTO",
  "- + SPEED   C CIRCLES   G GHOST   T TRAILS   SPACE PAUSE   H HUD   F FULLSCREEN   ESC MENU",
];

export interface EpicyclesOptions {
  readonly shapeIndex: number;
}

// A chain of turning circles redrawing a shape. The chain is the whole machine:
// each circle turns at a fixed whole-number rate, the next one rides on its rim,
// and the path left by the very last point is the drawing. With few circles the
// result is a smooth caricature; each one added sharpens it.
export class EpicyclesDemo implements Demo {
  public isPaused = false;
  public autoCycle = true;
  public showCircles = true;
  public showGhost = true;
  public speedIndex = 1;
  public trailIndex = 1;
  public termIndex = AUTO_LEVELS[0];
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly hud = new DemoHud();
  private readonly circles = new DynamicGeometry(4096);
  private readonly arms = new DynamicGeometry(512);
  private readonly ghost = new DynamicGeometry(1024);
  private readonly sketchLine = new DynamicGeometry(1024);
  private readonly traceBands: DynamicGeometry[] = [];
  private readonly joints = new Float64Array((SAMPLE_COUNT + 1) * 2);
  private readonly traceX = new Float32Array(TRACE_POINTS);
  private readonly traceY = new Float32Array(TRACE_POINTS);
  private readonly traceDrawn = new Uint8Array(TRACE_POINTS);
  // The moment (in trips round the shape) each trace point was last written; negative if never.
  private readonly traceStamp = new Float64Array(TRACE_POINTS).fill(-1);
  private shapeIndex: number;
  private shapeName: string;
  private samples: SampledPath;
  private epicycles: Epicycle[];
  // Trips round the shape since it was set, as a running total.
  private revolutions = 0;
  private lastTraceIndex = -1;
  private autoStep = 0;
  private sketch: number[] | null = null;
  private centreX = 889;
  private centreY = 500;
  private scale = 360;
  private segmentCount = 0;

  public constructor(options: EpicyclesOptions) {
    this.shapeIndex = options.shapeIndex % SHAPES.length;
    this.shapeName = SHAPES[this.shapeIndex].name;
    this.samples = resamplePath(SHAPES[this.shapeIndex].path(), SAMPLE_COUNT);
    this.epicycles = epicyclesFor(this.samples);
    for (let band = 0; band < TRACE_BANDS; band++) this.traceBands.push(new DynamicGeometry(1024));
    this.hud.showBanner(this.shapeName);
  }

  public get shape(): number {
    return this.shapeIndex;
  }

  public get name(): string {
    return this.shapeName;
  }

  // Circles in use, not counting the fixed offset that centres the drawing.
  public get termCount(): number {
    return Math.min(TERM_LEVELS[this.termIndex], this.epicycles.length - 1);
  }

  // How far round the shape the chain is, 0..1.
  public get progress(): number {
    return this.revolutions - Math.floor(this.revolutions);
  }

  public get isSketching(): boolean {
    return this.sketch !== null;
  }

  public resize(width: number, height: number): void {
    this.centreX = width / 2;
    this.centreY = height / 2;
    this.scale = Math.min(width, height) * SHAPE_SHARE;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (this.isPaused || this.sketch) return;
    const before = Math.floor(this.revolutions);
    this.revolutions += (deltaSeconds * SPEEDS[this.speedIndex]) / REVOLUTION_SECONDS;
    this.extendTrace();
    if (this.autoCycle && Math.floor(this.revolutions) > before) this.advanceAuto();
  }

  public draw(displayList: DisplayList): void {
    this.segmentCount = 0;
    if (this.sketch) {
      this.drawSketch(displayList);
      return;
    }
    if (this.showGhost) this.drawGhost(displayList);
    const jointCount = chainAt(this.epicycles, this.termCount + 1, this.progress, this.joints);
    if (this.showCircles) this.drawCircles(displayList, jointCount);
    this.drawArms(displayList, jointCount);
    this.drawTrace(displayList);
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    this.hud.draw(displayList, {
      title: "FOURIER EPICYCLES",
      statusLines: [
        this.sketch ? "SKETCHING  RELEASE TO TRACE IT" : `${this.shapeName}  ${this.termCount} OF ${this.epicycles.length - 1} CIRCLES`,
        `SPEED ${SPEEDS[this.speedIndex]}X  TRAILS ${TRAIL_MODES[this.trailIndex].name}  AUTO ${this.autoCycle ? "ON" : "OFF"}  SEGMENTS ${this.segmentCount}${this.isPaused ? "  PAUSED" : ""}`,
      ],
      helpLines: HELP_LINES,
      width: frame.width,
      height: frame.height,
      scale: frame.height / 1000,
    });
  }

  // --- Actions -------------------------------------------------------------------------------------------

  public noteActivity(): void {
    this.hud.noteActivity();
  }

  public toggleHud(): void {
    this.hud.toggle();
  }

  public togglePause(): void {
    this.isPaused = !this.isPaused;
  }

  public changeShape(delta: number): void {
    const count = SHAPES.length;
    this.shapeIndex = (((this.shapeIndex + delta) % count) + count) % count;
    this.setPath(SHAPES[this.shapeIndex].name, SHAPES[this.shapeIndex].path());
  }

  // Traces a single character from the vector font.
  public traceGlyph(character: string): void {
    this.setPath(`GLYPH ${character}`, textPath(character));
    this.autoCycle = false;
  }

  public changeTerms(delta: number): void {
    this.termIndex = Math.max(0, Math.min(TERM_LEVELS.length - 1, this.termIndex + delta));
    this.autoCycle = false;
    this.clearTrace();
    this.hud.showBanner(`${this.termCount} CIRCLES`);
  }

  public changeSpeed(delta: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIndex + delta));
    this.hud.showBanner(`SPEED ${SPEEDS[this.speedIndex]}X`);
  }

  public toggleAuto(): void {
    this.autoCycle = !this.autoCycle;
    this.hud.showBanner(`AUTO ${this.autoCycle ? "ON" : "OFF"}`);
  }

  public toggleCircles(): void {
    this.showCircles = !this.showCircles;
    this.hud.showBanner(`CIRCLES ${this.showCircles ? "ON" : "OFF"}`);
  }

  public toggleGhost(): void {
    this.showGhost = !this.showGhost;
    this.hud.showBanner(`GHOST ${this.showGhost ? "ON" : "OFF"}`);
  }

  public cycleTrails(): void {
    this.trailIndex = (this.trailIndex + 1) % TRAIL_MODES.length;
    this.onTrailChange(TRAIL_MODES[this.trailIndex].halfLifeMilliseconds);
    this.hud.showBanner(`TRAILS ${TRAIL_MODES[this.trailIndex].name}`);
  }

  // Starts a freehand shape at a screen position (world units).
  public beginSketch(x: number, y: number): void {
    this.sketch = [x, y];
  }

  public extendSketch(x: number, y: number): void {
    if (!this.sketch) return;
    const last = this.sketch.length - 2;
    if (Math.hypot(x - this.sketch[last], y - this.sketch[last + 1]) >= SKETCH_SPACING) this.sketch.push(x, y);
  }

  // Finishes the sketch and sets the circles to tracing it. A sketch too short to
  // be a shape is dropped. Returns whether it was used.
  public endSketch(): boolean {
    const sketch = this.sketch;
    this.sketch = null;
    if (!sketch || sketch.length / 2 < SKETCH_MINIMUM_POINTS) return false;
    const points: Point3[] = [];
    for (let index = 0; index < sketch.length; index += 2) points.push([sketch[index], -sketch[index + 1], 0]);
    // One open stroke: the pen lifts for the trip from its end back to its start.
    this.setPath("SKETCH", buildPath([{ points }]));
    this.autoCycle = false;
    this.termIndex = TERM_LEVELS.length - 4;
    return true;
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private setPath(name: string, path: BeamPath): void {
    this.shapeName = name;
    this.samples = resamplePath(path, SAMPLE_COUNT);
    this.epicycles = epicyclesFor(this.samples);
    this.autoStep = 0;
    if (this.autoCycle) this.termIndex = AUTO_LEVELS[0];
    this.clearTrace();
    this.hud.showBanner(name);
  }

  // One more trip done: use more circles, or once they are all in use, move to the next shape.
  private advanceAuto(): void {
    this.autoStep++;
    if (this.autoStep < AUTO_LEVELS.length) {
      this.termIndex = AUTO_LEVELS[this.autoStep];
      this.hud.showBanner(`${this.termCount} CIRCLES`);
    } else {
      this.changeShape(1);
    }
  }

  private clearTrace(): void {
    this.traceStamp.fill(-1);
    this.revolutions = 0;
    this.lastTraceIndex = -1;
  }

  // Records where the tip has been since the last update, at every trace point it passed.
  private extendTrace(): void {
    const target = Math.floor(this.revolutions * TRACE_POINTS);
    // After a stall, one trip's worth is all that can be shown anyway.
    let index = Math.max(this.lastTraceIndex + 1, target - TRACE_POINTS + 1);
    for (; index <= target; index++) {
      const slot = index % TRACE_POINTS;
      const time = slot / TRACE_POINTS;
      const count = chainAt(this.epicycles, this.termCount + 1, time, this.joints);
      this.traceX[slot] = this.joints[(count - 1) * 2];
      this.traceY[slot] = this.joints[(count - 1) * 2 + 1];
      this.traceDrawn[slot] = this.samples.drawn[Math.floor(time * this.samples.count)];
      this.traceStamp[slot] = index / TRACE_POINTS;
    }
    this.lastTraceIndex = Math.max(this.lastTraceIndex, target);
  }

  private toScreenX(x: number): number {
    return this.centreX + x * this.scale;
  }

  private toScreenY(y: number): number {
    return this.centreY - y * this.scale;
  }

  private add(displayList: DisplayList, geometry: DynamicGeometry, color: BeamColor, intensity: number): void {
    if (geometry.segmentCount === 0) return;
    this.segmentCount += geometry.segmentCount;
    displayList.setColor(color);
    displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity });
  }

  // The shape being aimed for, faintly, so the approximation can be judged against it.
  private drawGhost(displayList: DisplayList): void {
    const { x, y, drawn, count } = this.samples;
    this.ghost.clear();
    let penDown = false;
    for (let index = 0; index <= count; index++) {
      const sample = index % count;
      if (!drawn[sample]) {
        penDown = false;
        continue;
      }
      if (penDown) this.ghost.lineTo(this.toScreenX(x[sample]), this.toScreenY(y[sample]));
      else this.ghost.moveTo(this.toScreenX(x[sample]), this.toScreenY(y[sample]));
      penDown = true;
    }
    this.add(displayList, this.ghost, GHOST_COLOR, 0.16);
  }

  private drawCircles(displayList: DisplayList, jointCount: number): void {
    this.circles.clear();
    // Joint 1 is the fixed offset; the circles proper start from there.
    for (let joint = 1; joint < jointCount - 1; joint++) {
      const radius = this.epicycles[joint].radius * this.scale;
      if (radius < SMALLEST_CIRCLE) continue;
      const centreX = this.toScreenX(this.joints[joint * 2]);
      const centreY = this.toScreenY(this.joints[joint * 2 + 1]);
      const sides = Math.max(10, Math.min(72, Math.round(radius / 2.5)));
      this.circles.moveTo(centreX + radius, centreY);
      for (let side = 1; side < sides; side++) {
        const angle = (side / sides) * Math.PI * 2;
        this.circles.lineTo(centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius);
      }
      this.circles.closePath();
    }
    this.add(displayList, this.circles, CIRCLE_COLOR, 0.3);
  }

  // The radius of each circle, end to end: the chain itself.
  private drawArms(displayList: DisplayList, jointCount: number): void {
    this.arms.clear();
    this.arms.moveTo(this.toScreenX(this.joints[2]), this.toScreenY(this.joints[3]));
    for (let joint = 2; joint < jointCount; joint++) {
      this.arms.lineTo(this.toScreenX(this.joints[joint * 2]), this.toScreenY(this.joints[joint * 2 + 1]));
    }
    this.add(displayList, this.arms, ARM_COLOR, 0.7);
  }

  // The line the tip has left over the last trip, brightest where it is newest.
  private drawTrace(displayList: DisplayList): void {
    for (const geometry of this.traceBands) geometry.clear();
    const newest = this.lastTraceIndex;
    let lastBand = -1;
    let penDown = false;
    for (let index = Math.max(0, newest - TRACE_POINTS + 1); index <= newest; index++) {
      const slot = index % TRACE_POINTS;
      if (this.traceStamp[slot] < 0 || !this.traceDrawn[slot]) {
        penDown = false;
        continue;
      }
      const age = (newest - index) / TRACE_POINTS;
      const band = Math.min(TRACE_BANDS - 1, Math.floor(age * TRACE_BANDS));
      const screenX = this.toScreenX(this.traceX[slot]);
      const screenY = this.toScreenY(this.traceY[slot]);
      const geometry = this.traceBands[band];
      if (!penDown) {
        geometry.moveTo(screenX, screenY);
      } else if (band !== lastBand) {
        // Carry the line across into the new band from the previous point.
        const previous = (index - 1) % TRACE_POINTS;
        geometry.moveTo(this.toScreenX(this.traceX[previous]), this.toScreenY(this.traceY[previous]));
        geometry.lineTo(screenX, screenY);
      } else {
        geometry.lineTo(screenX, screenY);
      }
      penDown = true;
      lastBand = band;
    }
    this.traceBands.forEach((geometry, band) => this.add(displayList, geometry, TRACE_COLOR, 1.15 - 0.27 * band));
  }

  private drawSketch(displayList: DisplayList): void {
    const sketch = this.sketch;
    if (!sketch) return;
    this.sketchLine.clear();
    this.sketchLine.moveTo(sketch[0], sketch[1]);
    for (let index = 2; index < sketch.length; index += 2) this.sketchLine.lineTo(sketch[index], sketch[index + 1]);
    this.add(displayList, this.sketchLine, SKETCH_COLOR, 1);
  }
}
