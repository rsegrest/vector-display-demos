import type { DisplayList } from "@vector-display/core";
import { DemoHud, createSeededRandom, type Demo, type DemoFrame, type RandomSource } from "@vector-demos/demo-kit";
import { TerrainRenderer, worldWidthFor } from "./render/TerrainRenderer.js";
import type { ProjectionSettings } from "./render/terrainProjector.js";
import { RULE_PRESETS, createRandomRow, createSingleCellRow, growHistory, nextRow, populationOf } from "./sim/elementaryCA.js";

export const TERRAIN_WORLD_HEIGHT = 1000;
export const CELL_COUNT = 120;
export const ROW_COUNT = 76;
const BAND_COUNT = 6;
const AUTO_ADVANCE_SECONDS = 24;

// Generations per second; a row takes ROW_COUNT / speed seconds to cross.
export const SPEEDS: readonly number[] = [15, 30, 60, 120];
export const RIDGE_HEIGHTS: readonly number[] = [0, 14, 30, 52];
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
  readonly nearDepth: number;
  readonly rowSpacing: number;
  // Where the vanishing point sits, as a fraction of the screen height.
  readonly horizon: number;
}

// Four flight heights. The near plane is chosen so the nearest generation reaches
// the bottom of the screen; they differ in how steeply the terrain falls away.
export const CAMERA_PRESETS: readonly CameraPreset[] = [
  { name: "SKIMMER", focalLength: 900, cameraHeight: 190, nearDepth: 225, rowSpacing: 30, horizon: 0.24 },
  { name: "LOW", focalLength: 700, cameraHeight: 220, nearDepth: 220, rowSpacing: 34, horizon: 0.3 },
  { name: "WIDE", focalLength: 1100, cameraHeight: 340, nearDepth: 468, rowSpacing: 22, horizon: 0.2 },
  { name: "HIGH", focalLength: 1000, cameraHeight: 560, nearDepth: 667, rowSpacing: 18, horizon: 0.16 },
];

const HELP_LINES = [
  "N / B RULE   R RANDOM SEED ROW   G SINGLE CELL   A AUTO",
  "- + SPEED   C CAMERA   L WALLS   [ ] RIDGE   T TRAILS   SPACE PAUSE   . STEP   H HUD   F FULLSCREEN   ESC MENU",
];

export interface CaTerrainOptions {
  readonly seed: number;
  readonly ruleIndex: number;
  readonly cameraIndex: number;
}

// One-dimensional cellular automata as terrain. Each new generation is extruded as
// a ridgeline and scrolls toward the camera, so you fly over the computation: Rule
// 30's chaotic cliffs on one pass, Rule 90's Sierpinski forest on the next.
export class CaTerrainDemo implements Demo {
  public isPaused = false;
  public speedIndex = 1;
  public cameraIndex: number;
  public ridgeIndex = 2;
  public trailIndex = 1;
  public showWalls = true;
  public autoAdvance = true;
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly renderer = new TerrainRenderer();
  private readonly hud = new DemoHud();
  private rows: Uint8Array[] = [];
  private ruleIndex: number;
  private seed: number;
  private random: RandomSource;
  private rowAccumulator = 0;
  private autoSeconds = 0;
  private segmentCount = 0;

  public constructor(options: CaTerrainOptions) {
    this.seed = options.seed;
    this.random = createSeededRandom(options.seed);
    this.ruleIndex = options.ruleIndex % RULE_PRESETS.length;
    this.cameraIndex = options.cameraIndex % CAMERA_PRESETS.length;
    this.rebuild("random");
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

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (this.isPaused) return;
    if (this.autoAdvance) {
      this.autoSeconds += deltaSeconds;
      if (this.autoSeconds >= AUTO_ADVANCE_SECONDS) {
        this.autoSeconds = 0;
        this.nextRule(1);
        return;
      }
    }
    this.appendGenerations(deltaSeconds * SPEEDS[this.speedIndex]);
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const camera = CAMERA_PRESETS[this.cameraIndex];
    const projection: ProjectionSettings = {
      centreX: frame.width / 2,
      horizonY: frame.height * camera.horizon,
      focalLength: camera.focalLength,
      cameraHeight: camera.cameraHeight,
      nearDepth: camera.nearDepth,
    };
    this.segmentCount = this.renderer.draw(displayList, this.rows, projection, {
      worldWidth: worldWidthFor(projection, frame.width, camera.nearDepth),
      // Scale the ridge with the camera height so the terrain reads the same from
      // every flight level.
      ridgeHeight: (RIDGE_HEIGHTS[this.ridgeIndex] * camera.cameraHeight) / 220,
      rowSpacing: camera.rowSpacing,
      nearDepth: camera.nearDepth,
      bandCount: BAND_COUNT,
      showWalls: this.showWalls,
    });
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const newest = this.rows[this.rows.length - 1];
    this.hud.draw(displayList, {
      title: "CELLULAR TERRAIN",
      statusLines: [
        `${RULE_PRESETS[this.ruleIndex].name}  SEED ${this.seed}  CAMERA ${CAMERA_PRESETS[this.cameraIndex].name}`,
        `SPEED ${SPEEDS[this.speedIndex]}/S  RIDGE ${RIDGE_HEIGHTS[this.ridgeIndex]}  WALLS ${this.showWalls ? "ON" : "OFF"}  AUTO ${this.autoAdvance ? "ON" : "OFF"}`,
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
    this.appendGenerations(1);
  }

  public nextRule(delta: number): void {
    const count = RULE_PRESETS.length;
    this.ruleIndex = (((this.ruleIndex + delta) % count) + count) % count;
    this.autoSeconds = 0;
    this.rebuild("single");
    this.hud.showBanner(RULE_PRESETS[this.ruleIndex].name);
  }

  // A fresh initial row, so a deterministic rule gets a different signature.
  public randomize(): void {
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.random = createSeededRandom(this.seed);
    this.rebuild("random");
    this.hud.showBanner(`RANDOM  SEED ${this.seed}`);
  }

  public singleSeed(): void {
    this.rebuild("single");
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

  public toggleWalls(): void {
    this.showWalls = !this.showWalls;
    this.hud.showBanner(`WALLS ${this.showWalls ? "ON" : "OFF"}`);
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

  private rebuild(seedMode: "single" | "random"): void {
    const seedRow = seedMode === "single" ? createSingleCellRow(CELL_COUNT) : createRandomRow(CELL_COUNT, 0.5, this.random);
    this.rows = growHistory(seedRow, this.rule, ROW_COUNT);
    this.rowAccumulator = 0;
  }

  // Adds as many generations as the elapsed time has earned, keeping the history
  // at a fixed length. The cap stops a slow tab from stampeding the terrain.
  private appendGenerations(count: number): void {
    this.rowAccumulator += count;
    let appended = 0;
    while (this.rowAccumulator >= 1 && appended < 16) {
      this.rows.push(nextRow(this.rows[this.rows.length - 1], this.rule));
      this.rows.shift();
      this.rowAccumulator -= 1;
      appended++;
    }
    if (appended === 16) this.rowAccumulator = 0;
  }
}
