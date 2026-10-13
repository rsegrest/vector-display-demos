import type { DisplayList } from "@vector-display/core";
import { DemoHud, createSeededRandom, type Demo, type DemoFrame, type RandomSource } from "@vector-demos/demo-kit";
import { TerrainRenderer, depthAtScreenBottom } from "./render/TerrainRenderer.js";
import type { ProjectionSettings } from "./render/terrainProjector.js";
import { RULE_PRESETS, createRandomRow, createSingleCellRow, growHistory, nextRow, populationOf } from "./sim/elementaryCA.js";
import { HEIGHT_GENERATIONS, terrainHeights } from "./sim/heightField.js";

export const TERRAIN_WORLD_HEIGHT = 1000;
// Wide enough that the ring rarely has to repeat before the horizon.
export const CELL_COUNT = 400;
export const ROW_COUNT = 72;
// Lateral size of one cell, in world units.
export const CELL_WIDTH = 20;
const BAND_COUNT = 8;
const AUTO_ADVANCE_SECONDS = 24;
// A row that is all on or all off has nothing left to compute; after this many in
// a row the land is reseeded so the flight never runs out over a blank plain.
const BARREN_GENERATIONS = 24;

// Generations per second; a row takes ROW_COUNT / speed seconds to cross.
export const SPEEDS: readonly number[] = [6, 12, 24, 48];
export const RIDGE_HEIGHTS: readonly number[] = [0, 45, 90, 150];
export const TRAIL_MODES: readonly { readonly name: string; readonly halfLifeMilliseconds: number }[] = [
  { name: "SHORT", halfLifeMilliseconds: 40 },
  { name: "MEDIUM", halfLifeMilliseconds: 120 },
  { name: "LONG", halfLifeMilliseconds: 320 },
  { name: "INK", halfLifeMilliseconds: 900 },
];

export interface CameraPreset {
  readonly name: string;
  readonly focalLength: number;
  readonly cameraHeight: number;
  readonly rowSpacing: number;
  // Where the vanishing point sits, as a fraction of the screen height.
  readonly horizon: number;
}

// Four flight heights, from hugging the ridges to looking down on the pattern.
export const CAMERA_PRESETS: readonly CameraPreset[] = [
  { name: "LOW", focalLength: 900, cameraHeight: 300, rowSpacing: 40, horizon: 0.24 },
  { name: "SKIMMER", focalLength: 800, cameraHeight: 170, rowSpacing: 34, horizon: 0.3 },
  { name: "WIDE", focalLength: 700, cameraHeight: 420, rowSpacing: 44, horizon: 0.2 },
  { name: "HIGH", focalLength: 1000, cameraHeight: 700, rowSpacing: 46, horizon: 0.14 },
];
// Ridge heights are given for this camera height and scaled for the others.
const REFERENCE_CAMERA_HEIGHT = 300;

const HELP_LINES = [
  "N / B RULE   R RANDOM ROW   G SINGLE CELL   A AUTO",
  "- + SPEED   C CAMERA   L HIDDEN LINES   [ ] RIDGE   T TRAILS   SPACE PAUSE   . STEP   H HUD   F FULLSCREEN   ESC MENU",
];

export interface CaTerrainOptions {
  readonly seed: number;
  readonly ruleIndex: number;
  readonly cameraIndex: number;
}

// One-dimensional cellular automata as terrain. Each new generation is extruded as
// a ridgeline at the horizon and slides toward the camera, so you fly over the
// computation: Rule 30's chaotic ranges on one pass, Rule 90's nested basins on the
// next. Changing the rule does not cut to a new scene; the new rule simply takes
// over at the horizon and its country arrives in its own time.
export class CaTerrainDemo implements Demo {
  public isPaused = false;
  public speedIndex = 1;
  public cameraIndex: number;
  public ridgeIndex = 2;
  public trailIndex = 0;
  public hiddenLines = true;
  public autoAdvance = true;
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly renderer = new TerrainRenderer();
  private readonly hud = new DemoHud();
  // Oldest generation first; the oldest is the one nearest the camera.
  private rows: Uint8Array[] = [];
  private heights: Float32Array[] = [];
  private ruleIndex: number;
  private seed: number;
  private random: RandomSource;
  private rowAccumulator = 0;
  private autoSeconds = 0;
  private barrenGenerations = 0;
  private segmentCount = 0;

  public constructor(options: CaTerrainOptions) {
    this.seed = options.seed;
    this.random = createSeededRandom(options.seed);
    this.ruleIndex = options.ruleIndex % RULE_PRESETS.length;
    this.cameraIndex = options.cameraIndex % CAMERA_PRESETS.length;
    this.rows = growHistory(createRandomRow(CELL_COUNT, 0.5, this.random), this.rule, ROW_COUNT);
    this.heights = this.rows.map((_row, index) => terrainHeights(this.rows.slice(Math.max(0, index + 1 - HEIGHT_GENERATIONS), index + 1)));
    this.hud.showBanner(`${RULE_PRESETS[this.ruleIndex].name}  ${CAMERA_PRESETS[this.cameraIndex].name}`);
  }

  public get currentSeed(): number {
    return this.seed;
  }

  public get currentRule(): number {
    return this.rule;
  }

  public get rulePreset(): number {
    return this.ruleIndex;
  }

  public get cameraPreset(): number {
    return this.cameraIndex;
  }

  // The latest generation, at the horizon.
  public get newestRow(): Uint8Array {
    return this.rows[this.rows.length - 1];
  }

  // How far the terrain has slid toward the next generation, 0..1.
  public get scroll(): number {
    return Math.max(0, Math.min(1, this.rowAccumulator));
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (this.isPaused) return;
    if (this.autoAdvance) {
      this.autoSeconds += deltaSeconds;
      if (this.autoSeconds >= AUTO_ADVANCE_SECONDS) this.nextRule(1);
    }
    this.advance(deltaSeconds * SPEEDS[this.speedIndex]);
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const camera = CAMERA_PRESETS[this.cameraIndex];
    const projection: ProjectionSettings = {
      centreX: frame.width / 2,
      horizonY: frame.height * camera.horizon,
      focalLength: camera.focalLength,
      cameraHeight: camera.cameraHeight,
      nearDepth: 1,
    };
    this.segmentCount = this.renderer.draw(displayList, this.heights, projection, {
      screenWidth: frame.width,
      cellWidth: CELL_WIDTH,
      // Scale the ridge with the camera height so the terrain reads the same from
      // every flight level.
      ridgeHeight: (RIDGE_HEIGHTS[this.ridgeIndex] * camera.cameraHeight) / REFERENCE_CAMERA_HEIGHT,
      rowSpacing: camera.rowSpacing,
      // Just below the bottom edge, so the nearest generation leaves unseen.
      firstDepth: depthAtScreenBottom(projection, frame.height) * 0.95,
      scroll: this.scroll,
      bandCount: BAND_COUNT,
      hiddenLines: this.hiddenLines,
    });
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const newest = this.newestRow;
    this.hud.draw(displayList, {
      title: "CELLULAR TERRAIN",
      statusLines: [
        `${RULE_PRESETS[this.ruleIndex].name}  SEED ${this.seed}  CAMERA ${CAMERA_PRESETS[this.cameraIndex].name}`,
        `SPEED ${SPEEDS[this.speedIndex]}/S  RIDGE ${RIDGE_HEIGHTS[this.ridgeIndex]}  HIDDEN LINES ${this.hiddenLines ? "ON" : "OFF"}  AUTO ${this.autoAdvance ? "ON" : "OFF"}`,
        `POPULATION ${populationOf(newest)}/${newest.length}  SEGMENTS ${this.segmentCount}${this.isPaused ? "  PAUSED" : ""}`,
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

  public stepOnce(): void {
    this.isPaused = true;
    this.appendRow(nextRow(this.newestRow, this.rule));
  }

  // The new rule carries on from the current generation, so its terrain grows out
  // of the old one at the horizon.
  public nextRule(delta: number): void {
    const count = RULE_PRESETS.length;
    this.ruleIndex = (((this.ruleIndex + delta) % count) + count) % count;
    this.autoSeconds = 0;
    this.hud.showBanner(RULE_PRESETS[this.ruleIndex].name);
  }

  // A fresh random generation at the horizon, so a deterministic rule gets a
  // different signature.
  public randomize(): void {
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.random = createSeededRandom(this.seed);
    this.appendRow(createRandomRow(CELL_COUNT, 0.5, this.random));
    this.hud.showBanner(`RANDOM  SEED ${this.seed}`);
  }

  // A single live cell at the horizon: the classic way to see a rule's signature,
  // here as one landform spreading across an empty plain.
  public singleSeed(): void {
    this.appendRow(createSingleCellRow(CELL_COUNT));
    this.hud.showBanner("SINGLE CELL");
  }

  public changeSpeed(delta: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIndex + delta));
    this.hud.showBanner(`SPEED ${SPEEDS[this.speedIndex]} GENERATIONS/S`);
  }

  public nextCamera(): void {
    this.cameraIndex = (this.cameraIndex + 1) % CAMERA_PRESETS.length;
    this.hud.showBanner(`CAMERA ${CAMERA_PRESETS[this.cameraIndex].name}`);
  }

  public changeRidge(delta: number): void {
    this.ridgeIndex = Math.max(0, Math.min(RIDGE_HEIGHTS.length - 1, this.ridgeIndex + delta));
    this.hud.showBanner(`RIDGE ${RIDGE_HEIGHTS[this.ridgeIndex]}`);
  }

  public toggleHiddenLines(): void {
    this.hiddenLines = !this.hiddenLines;
    this.hud.showBanner(`HIDDEN LINES ${this.hiddenLines ? "ON" : "OFF"}`);
  }

  public cycleTrails(): void {
    this.trailIndex = (this.trailIndex + 1) % TRAIL_MODES.length;
    this.onTrailChange(TRAIL_MODES[this.trailIndex].halfLifeMilliseconds);
    this.hud.showBanner(`PERSISTENCE ${TRAIL_MODES[this.trailIndex].name}`);
  }

  public toggleAuto(): void {
    this.autoAdvance = !this.autoAdvance;
    this.autoSeconds = 0;
    this.hud.showBanner(`AUTO ${this.autoAdvance ? "ON" : "OFF"}`);
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private get rule(): number {
    return RULE_PRESETS[this.ruleIndex].rule;
  }

  // Slides the terrain forward by `generations` (usually a fraction), computing a
  // new generation each time a whole row spacing has gone by. The cap stops a slow
  // tab from stampeding the terrain.
  private advance(generations: number): void {
    this.rowAccumulator += generations;
    let appended = 0;
    while (this.rowAccumulator >= 1 && appended < 16) {
      this.appendRow(this.nextGeneration());
      this.rowAccumulator -= 1;
      appended++;
    }
    if (appended === 16) this.rowAccumulator = 0;
  }

  private nextGeneration(): Uint8Array {
    const next = nextRow(this.newestRow, this.rule);
    const population = populationOf(next);
    this.barrenGenerations = population === 0 || population === next.length ? this.barrenGenerations + 1 : 0;
    if (this.barrenGenerations < BARREN_GENERATIONS) return next;
    this.barrenGenerations = 0;
    return createRandomRow(CELL_COUNT, 0.5, this.random);
  }

  // Adds a generation at the horizon and drops the one that has passed the camera.
  private appendRow(row: Uint8Array): void {
    this.rows.push(row);
    this.rows.shift();
    this.heights.push(terrainHeights(this.rows.slice(-HEIGHT_GENERATIONS)));
    this.heights.shift();
  }
}
