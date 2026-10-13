// Life on the Beam, hosted full screen with a vector HUD. The rules and beam geometry are the
// tested modules from vector-display/examples/demo, unchanged; this file replaces only the
// original page's HTML controls and frame loop.

import { Shape, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import {
  DEFAULT_BEAM_PALETTE,
  advanceAges,
  beamColorForBucket,
  beamIntensityForBucket,
  groupCellsByAgeBucket,
  polylinesForCellBoxes,
} from "./lifeBeamGeometry.js";
import {
  createEmptyGrid,
  nextGeneration,
  populationOf,
  stampDisk,
  stampGlider,
  wrapCoordinate,
  type LiveCells,
} from "./lifeRules.js";

export const LIFE_WORLD_HEIGHT = 640;
// The original page's 96 x 64 grid in a 960 x 640 world: 10 units per cell.
const CELL_SIZE = 10;
const CELL_FILL_RATIO = 0.62;
const AGE_BUCKET_COUNT = 8;
const RANDOM_SEED_DENSITY = 0.28;
const PAINT_RADIUS = 2;
export const MIN_SPEED = 1;
export const MAX_SPEED = 30;
export const PERSISTENCE_STEPS_MS: readonly number[] = [20, 80, 200, 400];
export const BLOOM_STEPS: readonly number[] = [0.6, 1.4, 2.2, 3];

const HELP_LINES = [
  "DRAG PAINT CELLS   SPACE PAUSE   . STEP   R RANDOMIZE   G GLIDERS   C CLEAR",
  "- + SPEED   T PERSISTENCE   B BLOOM   H HUD   F FULLSCREEN   ESC MENU",
];

interface BucketShape {
  readonly shape: Shape;
  readonly color: BeamColor;
  readonly intensity: number;
}

export class LifeDemo implements Demo {
  public generationsPerSecond = 8;
  public persistenceIndex = 1;
  public bloomIndex = 1;
  public isPaused = false;
  public onPhosphorChange: (persistenceMilliseconds: number, bloomStrength: number) => void = () => {};

  private live: LiveCells = createEmptyGrid({ columns: 96, rows: 64 });
  private ages: Uint8Array = new Uint8Array(this.live.cells.length);
  private generation = 0;
  private secondsSinceGeneration = 0;
  private offsetX = 0;
  private shapes: BucketShape[] = [];
  private segmentCount = 0;
  private readonly hud = new DemoHud();

  public constructor() {
    this.hud.showBanner("LIFE ON THE BEAM");
  }

  public get persistenceMilliseconds(): number {
    return PERSISTENCE_STEPS_MS[this.persistenceIndex];
  }

  public get bloomStrength(): number {
    return BLOOM_STEPS[this.bloomIndex];
  }

  // Columns follow the screen's aspect ratio; cells already on the board keep their place.
  public resize(width: number, height: number): void {
    const columns = Math.max(16, Math.floor(width / CELL_SIZE));
    const rows = Math.floor(height / CELL_SIZE);
    this.offsetX = (width - columns * CELL_SIZE) / 2;
    if (columns === this.live.columns && rows === this.live.rows) return;
    const wasEmpty = this.generation === 0 && populationOf(this.live) === 0;
    const resized = createEmptyGrid({ columns, rows });
    const resizedAges = new Uint8Array(columns * rows);
    for (let row = 0; row < Math.min(rows, this.live.rows); row++) {
      for (let column = 0; column < Math.min(columns, this.live.columns); column++) {
        resized.cells[row * columns + column] = this.live.cells[row * this.live.columns + column];
        resizedAges[row * columns + column] = this.ages[row * this.live.columns + column];
      }
    }
    this.live = resized;
    this.ages = resizedAges;
    if (wasEmpty) this.randomize();
    else this.rebuildShapes();
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (this.isPaused) return;
    this.secondsSinceGeneration += deltaSeconds;
    const secondsPerGeneration = 1 / this.generationsPerSecond;
    // At most one generation per update, so a slow tab does not stampede the automaton.
    if (this.secondsSinceGeneration >= secondsPerGeneration) {
      this.secondsSinceGeneration = Math.min(this.secondsSinceGeneration - secondsPerGeneration, secondsPerGeneration);
      this.stepGeneration();
    }
  }

  public draw(displayList: DisplayList): void {
    for (const bucket of this.shapes) {
      displayList.setColor(bucket.color);
      displayList.addShape(bucket.shape, { x: this.offsetX, y: 0, rotation: 0, scale: 1, intensity: bucket.intensity });
    }
    this.segmentCount = displayList.segmentCount;
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    this.hud.draw(displayList, {
      title: "LIFE ON THE BEAM",
      statusLines: [
        `GENERATION ${this.generation}  POPULATION ${populationOf(this.live)}`,
        `SPEED ${this.generationsPerSecond} GEN/S  PERSISTENCE ${this.persistenceMilliseconds} MS  BLOOM ${this.bloomStrength.toFixed(1)}${this.isPaused ? "  PAUSED" : ""}`,
        `SEGMENTS ${this.segmentCount}`,
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
    this.stepGeneration();
  }

  public randomize(): void {
    this.live = createEmptyGrid(this.live);
    for (let index = 0; index < this.live.cells.length; index++) {
      this.live.cells[index] = Math.random() < RANDOM_SEED_DENSITY ? 1 : 0;
    }
    this.ages = new Uint8Array(this.live.cells.length);
    this.generation = 0;
    this.rebuildShapes();
    this.hud.showBanner("RANDOMIZED");
  }

  // A diagonal file of gliders crossing the field: the clearest demonstration that the grid wraps.
  public launchGliders(): void {
    for (let index = 0; index < 6; index++) {
      stampGlider(this.live, (index * 7) % this.live.columns, index * 5);
    }
    this.rebuildShapes();
    this.hud.showBanner("GLIDERS");
  }

  public clear(): void {
    this.live = createEmptyGrid(this.live);
    this.ages = new Uint8Array(this.live.cells.length);
    this.generation = 0;
    this.rebuildShapes();
    this.hud.showBanner("CLEARED");
  }

  public changeSpeed(delta: number): void {
    this.generationsPerSecond = Math.max(MIN_SPEED, Math.min(MAX_SPEED, this.generationsPerSecond + delta));
    this.hud.showBanner(`SPEED ${this.generationsPerSecond} GEN/S`);
  }

  public cyclePersistence(): void {
    this.persistenceIndex = (this.persistenceIndex + 1) % PERSISTENCE_STEPS_MS.length;
    this.onPhosphorChange(this.persistenceMilliseconds, this.bloomStrength);
    this.hud.showBanner(`PERSISTENCE ${this.persistenceMilliseconds} MS`);
  }

  public cycleBloom(): void {
    this.bloomIndex = (this.bloomIndex + 1) % BLOOM_STEPS.length;
    this.onPhosphorChange(this.persistenceMilliseconds, this.bloomStrength);
    this.hud.showBanner(`BLOOM ${this.bloomStrength.toFixed(1)}`);
  }

  // Painted cells reset to newborn, so they flash white.
  public paintAt(worldX: number, worldY: number): void {
    const column = Math.floor((worldX - this.offsetX) / CELL_SIZE);
    const row = Math.floor(worldY / CELL_SIZE);
    for (let rowOffset = -PAINT_RADIUS; rowOffset <= PAINT_RADIUS; rowOffset++) {
      for (let columnOffset = -PAINT_RADIUS; columnOffset <= PAINT_RADIUS; columnOffset++) {
        const targetColumn = wrapCoordinate(column + columnOffset, this.live.columns);
        const targetRow = wrapCoordinate(row + rowOffset, this.live.rows);
        this.ages[targetRow * this.live.columns + targetColumn] = 0;
      }
    }
    stampDisk(this.live, column, row, PAINT_RADIUS);
    this.rebuildShapes();
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private stepGeneration(): void {
    const next = nextGeneration(this.live);
    this.ages = advanceAges(this.live, this.ages, next);
    this.live = next;
    this.generation++;
    this.rebuildShapes();
  }

  // A generation IS new geometry, so shapes are rebuilt once per generation rather than per frame.
  private rebuildShapes(): void {
    const buckets = groupCellsByAgeBucket(this.live, this.ages, CELL_SIZE, CELL_FILL_RATIO, AGE_BUCKET_COUNT);
    this.shapes = [];
    for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++) {
      const polylines = polylinesForCellBoxes(buckets[bucketIndex], CELL_SIZE);
      if (polylines.length === 0) continue;
      this.shapes.push({
        shape: Shape.fromPolylines(polylines),
        color: beamColorForBucket(bucketIndex, AGE_BUCKET_COUNT, DEFAULT_BEAM_PALETTE),
        intensity: beamIntensityForBucket(bucketIndex, AGE_BUCKET_COUNT, DEFAULT_BEAM_PALETTE),
      });
    }
  }
}
