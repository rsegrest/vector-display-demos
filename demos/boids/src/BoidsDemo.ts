// Boids on the Beam, hosted full screen with a vector HUD. The flocking rules and beam geometry are
// the tested modules from vector-display/examples/demo, unchanged; this file replaces only the
// original page's HTML controls and frame loop.

import { Shape, type DisplayList } from "@vector-display/core";
import { DemoHud, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import {
  BOID_BEAM_COLOR,
  DEFAULT_BOID_BEAM_SETTINGS,
  placedBoids,
  trailPolylines,
  type BoidBeamSettings,
} from "./boidsBeamGeometry.js";
import {
  createFlock,
  createSeededRandom,
  polarizationOf,
  stepFlock,
  type BoidFlock,
  type FlockingSettings,
} from "./boidsRules.js";

export const BOIDS_WORLD_HEIGHT = 640;
const ORIGINAL_WORLD_WIDTH = 960;
const ORIGINAL_BOID_COUNT = 220;
const INITIAL_SEED = 20261004;
export const MIN_BOIDS = 20;
export const MAX_BOIDS = 600;
const COUNT_STEP = 20;
const WEIGHT_STEP = 15;
const MAX_WEIGHT = 180;
export const PERSISTENCE_STEPS_MS: readonly number[] = [40, 120, 250, 400];
export const TRAIL_STEPS: readonly number[] = [0, 14, 28, 40];
const TRAIL_COLOR = { red: 0.2, green: 0.5, blue: 0.36 };

const HELP_LINES = [
  "SPACE PAUSE   . STEP   R SCATTER   - + BOIDS   P PERSISTENCE   T TRAIL",
  "Q A SEPARATION   W S ALIGNMENT   E D COHESION   H HUD   F FULLSCREEN   ESC MENU",
];

const OUTLINE = Shape.fromPolyline({
  points: [{ x: 4.5, y: 0 }, { x: -4.5, y: -2.5 }, { x: -4.5, y: 2.5 }],
  isClosed: true,
});
// Trails are unit segments placed, rotated and stretched onto each boid's tail.
const UNIT_SEGMENT = Shape.fromPolyline({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], isClosed: false });

export type FlockingWeight = "separationWeight" | "alignmentWeight" | "cohesionWeight";

export class BoidsDemo implements Demo {
  public isPaused = false;
  public persistenceIndex = 1;
  public trailIndex = 1;
  public onPersistenceChange: (milliseconds: number) => void = () => {};
  public readonly weights: Record<FlockingWeight, number> = {
    separationWeight: 90,
    alignmentWeight: 60,
    cohesionWeight: 45,
  };

  private flock: BoidFlock;
  private readonly hud = new DemoHud();

  public constructor() {
    this.flock = createFlock(ORIGINAL_BOID_COUNT, ORIGINAL_WORLD_WIDTH, BOIDS_WORLD_HEIGHT, createSeededRandom(INITIAL_SEED));
    this.hud.showBanner("BOIDS ON THE BEAM");
  }

  public get persistenceMilliseconds(): number {
    return PERSISTENCE_STEPS_MS[this.persistenceIndex];
  }

  public get boidCount(): number {
    return this.flock.count;
  }

  // The field follows the screen's aspect ratio. Boids keep their relative positions, and the first
  // layout scales the original 220 boids to the wider field so the density matches the original page.
  public resize(width: number, height: number): void {
    if (width === this.flock.width && height === this.flock.height) return;
    const isFirstLayout = this.flock.width === ORIGINAL_WORLD_WIDTH;
    const count = isFirstLayout
      ? clampCount(Math.round((ORIGINAL_BOID_COUNT * width) / ORIGINAL_WORLD_WIDTH / COUNT_STEP) * COUNT_STEP)
      : this.flock.count;
    const resized = createFlock(count, width, height, createSeededRandom(INITIAL_SEED + count));
    const kept = Math.min(count, this.flock.count);
    for (let index = 0; index < kept; index++) {
      resized.x[index] = (this.flock.x[index] / this.flock.width) * width;
      resized.y[index] = (this.flock.y[index] / this.flock.height) * height;
      resized.vx[index] = this.flock.vx[index];
      resized.vy[index] = this.flock.vy[index];
    }
    this.flock = resized;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (!this.isPaused) this.flock = stepFlock(this.flock, this.flockingSettings(), deltaSeconds);
  }

  public draw(displayList: DisplayList): void {
    const beam = this.beamSettings();
    // Trails first so the arrowheads draw on top of them.
    displayList.setColor(TRAIL_COLOR);
    for (const trail of trailPolylines(this.flock, beam)) {
      const [start, end] = trail.points;
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const length = Math.hypot(deltaX, deltaY);
      // A tail that wrapped to the far edge would otherwise streak across the whole field.
      if (length > beam.trailLength * 1.5) continue;
      displayList.addShape(UNIT_SEGMENT, {
        x: start.x,
        y: start.y,
        rotation: Math.atan2(deltaY, deltaX),
        scale: Math.max(length, 1e-3),
        intensity: 0.55,
      });
    }
    displayList.setColor(BOID_BEAM_COLOR);
    for (const placed of placedBoids(this.flock, beam)) {
      displayList.addShape(OUTLINE, { x: placed.x, y: placed.y, rotation: placed.rotation, scale: 1, intensity: placed.intensity });
    }
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    this.hud.draw(displayList, {
      title: "BOIDS ON THE BEAM",
      statusLines: [
        `BOIDS ${this.flock.count}  POLARIZATION ${polarizationOf(this.flock).toFixed(2)}${this.isPaused ? "  PAUSED" : ""}`,
        `SEPARATION ${this.weights.separationWeight}  ALIGNMENT ${this.weights.alignmentWeight}  COHESION ${this.weights.cohesionWeight}`,
        `PERSISTENCE ${this.persistenceMilliseconds} MS  TRAIL ${TRAIL_STEPS[this.trailIndex]}`,
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

  // A fresh random seed each scatter, so no two look alike.
  public scatter(): void {
    const { count, width, height } = this.flock;
    this.flock = createFlock(count, width, height, createSeededRandom((Math.random() * 0xffffffff) >>> 0));
    this.hud.showBanner("SCATTER");
  }

  // Keeps the existing boids where they are and only adds or drops the difference.
  public changeCount(delta: number): void {
    const count = clampCount(this.flock.count + delta * COUNT_STEP);
    if (count === this.flock.count) return;
    const { width, height } = this.flock;
    const resized = createFlock(count, width, height, createSeededRandom(INITIAL_SEED + count));
    const kept = Math.min(count, this.flock.count);
    resized.x.set(this.flock.x.subarray(0, kept));
    resized.y.set(this.flock.y.subarray(0, kept));
    resized.vx.set(this.flock.vx.subarray(0, kept));
    resized.vy.set(this.flock.vy.subarray(0, kept));
    this.flock = resized;
    this.hud.showBanner(`BOIDS ${count}`);
  }

  public changeWeight(weight: FlockingWeight, delta: number): void {
    this.weights[weight] = Math.max(0, Math.min(MAX_WEIGHT, this.weights[weight] + delta * WEIGHT_STEP));
    const label = weight.replace("Weight", "").toUpperCase();
    this.hud.showBanner(`${label} ${this.weights[weight]}`);
  }

  public cyclePersistence(): void {
    this.persistenceIndex = (this.persistenceIndex + 1) % PERSISTENCE_STEPS_MS.length;
    this.onPersistenceChange(this.persistenceMilliseconds);
    this.hud.showBanner(`PERSISTENCE ${this.persistenceMilliseconds} MS`);
  }

  public cycleTrail(): void {
    this.trailIndex = (this.trailIndex + 1) % TRAIL_STEPS.length;
    this.hud.showBanner(`TRAIL ${TRAIL_STEPS[this.trailIndex]}`);
  }

  // --- Internals -----------------------------------------------------------------------------------------

  // The original page's settings, with the three weights under keyboard control.
  private flockingSettings(): FlockingSettings {
    return { perceptionRadius: 70, separationRadius: 18, minimumSpeed: 40, maximumSpeed: 110, ...this.weights };
  }

  private beamSettings(): BoidBeamSettings {
    return { ...DEFAULT_BOID_BEAM_SETTINGS, trailLength: TRAIL_STEPS[this.trailIndex] };
  }
}

function clampCount(count: number): number {
  return Math.max(MIN_BOIDS, Math.min(MAX_BOIDS, count));
}
