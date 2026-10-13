import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, DynamicGeometry, createSeededRandom, hslToBeamColor, type Demo, type DemoFrame, type RandomSource } from "@vector-demos/demo-kit";
import { PhysarumWorld, type PhysarumSettings } from "./sim/physarum.js";

export const SLIME_WORLD_HEIGHT = 1000;
export const GRID_WIDTH = 384;
export const GRID_HEIGHT = 216;
export const MIN_AGENTS = 2000;
export const MAX_AGENTS = 24000;
export const AGENT_STEP = 2000;
export const SPEEDS: readonly number[] = [1, 2, 3, 4];

export const TRAIL_MODES: readonly { readonly name: string; readonly halfLifeMilliseconds: number }[] = [
  { name: "SHORT", halfLifeMilliseconds: 180 },
  { name: "MEDIUM", halfLifeMilliseconds: 500 },
  { name: "LONG", halfLifeMilliseconds: 1200 },
  { name: "ECHO", halfLifeMilliseconds: 3000 },
];

export interface SlimePreset {
  readonly name: string;
  readonly settings: Partial<PhysarumSettings>;
}

// A small zoo of parameter sets. They differ in how far the mold can smell, how
// sharply it turns, how quickly the trail fades and how many agents may share a
// cell, and they grow recognisably different networks: from a fine froth of small
// cells to a few long strands spanning the dish.
export const SLIME_PRESETS: readonly SlimePreset[] = [
  { name: "FILIGREE", settings: { sensorAngle: 0.35, sensorDistance: 7, turnAngle: 0.4, moveDistance: 1.0, decayFactor: 0.93, cellCapacity: 3, trailLimit: 3 } },
  { name: "LATTICE", settings: { sensorAngle: 0.5, sensorDistance: 12, turnAngle: 0.6, moveDistance: 1.4, decayFactor: 0.95, cellCapacity: 2, trailLimit: 2 } },
  { name: "VINES", settings: { sensorAngle: 0.9, sensorDistance: 22, turnAngle: 1.1, moveDistance: 1.2, decayFactor: 0.97, cellCapacity: 2, trailLimit: 2 } },
  { name: "FROTH", settings: { sensorAngle: 0.6, sensorDistance: 9, turnAngle: 0.7, moveDistance: 0.9, decayFactor: 0.955, cellCapacity: 1, trailLimit: 1 } },
  { name: "WEBS", settings: { sensorAngle: 1.2, sensorDistance: 18, turnAngle: 1.4, moveDistance: 1.1, decayFactor: 0.965, cellCapacity: 1, trailLimit: 1 } },
];

export interface SlimeMoldOptions {
  readonly seed: number;
  readonly agentCount: number;
  readonly presetIndex: number;
}

const AUTO_EVOLVE_SECONDS = 35;
const BUCKET_COUNT = 6;
// Agents are drawn as a short tick along their heading; the phosphor does the rest.
const AGENT_STROKE_CELLS = 1.7;
const FOOD_INTENSITY = 0.3;

const FOOD_COLOR: BeamColor = { red: 1, green: 0.72, blue: 0.3 };
const FOOD_RING_SIDES = 10;
const FOOD_RING_CELLS = 5;
const ERASE_RADIUS_CELLS = 12;

const HELP_LINES = [
  "CLICK OR DRAG DROP FOOD   SHIFT+DRAG ERASE   N NEXT PRESET   R RESEED   C CLEAR DISH",
  "[ ] AGENTS   - + SPEED   T PERSISTENCE   E AUTO   SPACE PAUSE   . STEP   H HUD   F FULLSCREEN   ESC MENU",
];

interface Bucket {
  readonly geometry: DynamicGeometry;
  color: BeamColor;
  intensity: number;
}

// The slime mold demo. It draws only the agents, as short strokes, and lets the
// display's own phosphor decay be the visible trail -- exactly the idea the demo
// is meant to show off. The chemical field the agents actually sense lives only in
// memory; what you see is where the beam has been. Food sources are the one thing
// drawn that is not an agent: small rings marking where the mold is being fed.
export class SlimeMoldDemo implements Demo {
  public isPaused = false;
  public trailIndex = 2;
  public speedIndex = 0;
  public autoEvolve = true;
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly world: PhysarumWorld;
  private readonly hud = new DemoHud();
  private readonly buckets: Bucket[] = [];
  private readonly foodGeometry = new DynamicGeometry(512);
  private random: RandomSource;
  private seed: number;
  private presetIndex: number;
  private autoEvolveSeconds = 0;
  private worldWidth = 2000;
  private worldHeight = SLIME_WORLD_HEIGHT;
  private segmentCount = 0;

  public constructor(options: SlimeMoldOptions) {
    this.seed = options.seed;
    this.random = createSeededRandom(options.seed);
    this.presetIndex = options.presetIndex % SLIME_PRESETS.length;
    this.world = new PhysarumWorld({
      columns: GRID_WIDTH,
      rows: GRID_HEIGHT,
      agentCount: options.agentCount,
      random: this.random,
      settings: SLIME_PRESETS[this.presetIndex].settings,
    });
    for (let bucket = 0; bucket < BUCKET_COUNT; bucket++) {
      this.buckets.push({ geometry: new DynamicGeometry(2048), color: { red: 1, green: 1, blue: 1 }, intensity: 1 });
    }
    this.hud.showBanner(`SLIME MOLD  ${SLIME_PRESETS[this.presetIndex].name}`);
  }

  public get currentSeed(): number {
    return this.seed;
  }

  public get agentCount(): number {
    return this.world.agentCount;
  }

  public get preset(): number {
    return this.presetIndex;
  }

  public resize(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (this.isPaused) return;
    if (this.autoEvolve) {
      this.autoEvolveSeconds += deltaSeconds;
      if (this.autoEvolveSeconds >= AUTO_EVOLVE_SECONDS) {
        this.autoEvolveSeconds = 0;
        // A fresh dish each time: the growth out of noise is the best part, and a
        // settled network would otherwise only coarsen.
        this.selectPreset(this.presetIndex + 1, true);
        this.world.scatter();
        return;
      }
    }
    const steps = SPEEDS[this.speedIndex];
    for (let step = 0; step < steps; step++) this.world.step();
  }

  public draw(displayList: DisplayList): void {
    const scale = Math.max(this.worldWidth / GRID_WIDTH, this.worldHeight / GRID_HEIGHT);
    const offsetX = (this.worldWidth - GRID_WIDTH * scale) / 2;
    const offsetY = (this.worldHeight - GRID_HEIGHT * scale) / 2;
    const halfStroke = (AGENT_STROKE_CELLS * scale) / 2;
    const normalise = 1 / Math.max(0.7 * this.world.maximumTrail, 1e-3);

    for (const bucket of this.buckets) bucket.geometry.clear();
    for (let agent = 0; agent < this.world.agentCount; agent++) {
      const gridX = this.world.agentX[agent];
      const gridY = this.world.agentY[agent];
      const angle = this.world.heading[agent];
      const directionX = Math.cos(angle) * halfStroke;
      const directionY = Math.sin(angle) * halfStroke;
      const x = offsetX + gridX * scale;
      const y = offsetY + gridY * scale;
      const brightness = Math.min(1, this.world.trailAt(gridX, gridY) * normalise);
      const bucketIndex = Math.min(BUCKET_COUNT - 1, Math.floor(brightness * BUCKET_COUNT));
      this.buckets[bucketIndex].geometry.addSegment(
        x - directionX,
        y - directionY,
        x + directionX,
        y + directionY,
      );
    }

    this.segmentCount = 0;
    this.buckets.forEach((bucket, index) => {
      if (bucket.geometry.segmentCount === 0) return;
      const amount = index / (BUCKET_COUNT - 1);
      bucket.color = hslToBeamColor(0.56 - 0.4 * amount, 0.9 - 0.25 * amount, 0.4 + 0.25 * amount);
      bucket.intensity = 0.05 + 0.13 * amount;
      this.segmentCount += bucket.geometry.segmentCount;
      displayList.setColor(bucket.color);
      displayList.addShape(bucket.geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: bucket.intensity });
    });

    this.foodGeometry.clear();
    const ringRadius = FOOD_RING_CELLS * scale;
    for (const source of this.world.foodSources) {
      const centreX = offsetX + source.x * scale;
      const centreY = offsetY + source.y * scale;
      this.foodGeometry.moveTo(centreX + ringRadius, centreY);
      for (let side = 1; side < FOOD_RING_SIDES; side++) {
        const angle = (side / FOOD_RING_SIDES) * Math.PI * 2;
        this.foodGeometry.lineTo(centreX + Math.cos(angle) * ringRadius, centreY + Math.sin(angle) * ringRadius);
      }
      this.foodGeometry.closePath();
    }
    if (this.foodGeometry.segmentCount > 0) {
      displayList.setColor(FOOD_COLOR);
      displayList.addShape(this.foodGeometry, { ...SCREEN_SPACE_PLACEMENT, intensity: FOOD_INTENSITY });
    }
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    this.hud.draw(displayList, {
      title: "SLIME MOLD",
      statusLines: [
        `${SLIME_PRESETS[this.presetIndex].name}  SEED ${this.seed}  STEP ${this.world.stepCount}`,
        `AGENTS ${this.world.agentCount}  FOOD ${this.world.foodSources.length}  SPEED ${SPEEDS[this.speedIndex]}/FRAME  TRAIL ${TRAIL_MODES[this.trailIndex].name}  AUTO ${this.autoEvolve ? "ON" : "OFF"}`,
        `SEGMENTS ${this.segmentCount}${this.isPaused ? "  PAUSED" : ""}`,
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
    this.world.step();
  }

  public reseed(): void {
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.random = createSeededRandom(this.seed);
    this.world.scatter(this.random);
    this.hud.showBanner(`SLIME MOLD  SEED ${this.seed}`);
  }

  // Wipes the trail and takes the food away; the agents stay where they are.
  public clearDish(): void {
    this.world.clearTrail();
    this.world.clearFood();
    this.hud.showBanner("DISH CLEARED");
  }

  public selectPreset(index: number, announce: boolean): void {
    this.presetIndex = ((index % SLIME_PRESETS.length) + SLIME_PRESETS.length) % SLIME_PRESETS.length;
    this.world.settings = { ...this.world.settings, ...SLIME_PRESETS[this.presetIndex].settings };
    this.autoEvolveSeconds = 0;
    if (announce) this.hud.showBanner(`PRESET ${SLIME_PRESETS[this.presetIndex].name}`);
  }

  public nextPreset(): void {
    this.selectPreset(this.presetIndex + 1, true);
  }

  public changeSpeed(delta: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIndex + delta));
    this.hud.showBanner(`SPEED ${SPEEDS[this.speedIndex]} STEP${SPEEDS[this.speedIndex] === 1 ? "" : "S"}/FRAME`);
  }

  public changeAgentCount(delta: number): void {
    const count = Math.max(MIN_AGENTS, Math.min(MAX_AGENTS, this.world.agentCount + delta));
    if (count === this.world.agentCount) return;
    this.world.setAgentCount(count);
    this.hud.showBanner(`AGENTS ${count}`);
  }

  public cycleTrails(): void {
    this.trailIndex = (this.trailIndex + 1) % TRAIL_MODES.length;
    this.onTrailChange(TRAIL_MODES[this.trailIndex].halfLifeMilliseconds);
    this.hud.showBanner(`PERSISTENCE ${TRAIL_MODES[this.trailIndex].name}`);
  }

  public toggleAuto(): void {
    this.autoEvolve = !this.autoEvolve;
    this.autoEvolveSeconds = 0;
    this.hud.showBanner(`AUTO ${this.autoEvolve ? "ON" : "OFF"}`);
  }

  // The pointer drops a food source, or with `erase` wipes the trail and any food
  // under it. World coordinates in, grid cells inside.
  public pointerAt(worldX: number, worldY: number, erase: boolean): void {
    const scale = Math.max(this.worldWidth / GRID_WIDTH, this.worldHeight / GRID_HEIGHT);
    const gridX = (worldX - (this.worldWidth - GRID_WIDTH * scale) / 2) / scale;
    const gridY = (worldY - (this.worldHeight - GRID_HEIGHT * scale) / 2) / scale;
    if (erase) {
      this.world.removeFoodNear(gridX, gridY, ERASE_RADIUS_CELLS);
      this.world.paint(gridX, gridY, ERASE_RADIUS_CELLS, -8);
    } else {
      this.world.addFood(gridX, gridY);
    }
  }
}
