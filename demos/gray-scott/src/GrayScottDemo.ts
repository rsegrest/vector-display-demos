import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { ContourTracer, DemoHud, DynamicGeometry, createSeededRandom, hslToBeamColor, type Demo, type DemoFrame, type RandomSource } from "@vector-demos/demo-kit";
import { GrayScottWorld, type ReactionRates } from "./sim/GrayScottWorld.js";

export const GRAY_SCOTT_WORLD_HEIGHT = 1000;
export const GRID_WIDTH = 200;
export const GRID_HEIGHT = 112;
// Simulation steps per display frame.
export const SPEEDS: readonly number[] = [2, 4, 8, 16];
export const MIN_LEVELS = 2;
export const MAX_LEVELS = 7;

export interface ReactionPreset extends ReactionRates {
  readonly name: string;
}

// Feed and kill rates that each settle into a different kind of pattern. They are
// neighbours in a small corner of the model's parameter space; almost everywhere
// else the dish simply dies or fills up.
export const REACTION_PRESETS: readonly ReactionPreset[] = [
  { name: "CORAL", feed: 0.0545, kill: 0.062 },
  { name: "MITOSIS", feed: 0.0367, kill: 0.0649 },
  { name: "MAZE", feed: 0.029, kill: 0.057 },
  { name: "SPOTS", feed: 0.03, kill: 0.062 },
  { name: "FINGERPRINT", feed: 0.037, kill: 0.06 },
  { name: "HOLES", feed: 0.039, kill: 0.058 },
  { name: "CELLS", feed: 0.062, kill: 0.0609 },
  { name: "PULSE", feed: 0.018, kill: 0.051 },
  { name: "TURBULENCE", feed: 0.026, kill: 0.051 },
];

// The corner of parameter space laid out across the screen in map mode: kill rate
// rising left to right, feed rate rising bottom to top.
export const RATE_MAP_LOW: ReactionRates = { feed: 0.012, kill: 0.048 };
export const RATE_MAP_HIGH: ReactionRates = { feed: 0.07, kill: 0.068 };

const MORPH_SECONDS = 4;
const AUTO_SECONDS = 28;
const SEED_PATCHES = 14;
const SEED_RADIUS = 5;
const BRUSH_RADIUS = 4;
// Contour levels span this range of V; little of interest happens outside it.
const LOWEST_LEVEL = 0.07;
const HIGHEST_LEVEL = 0.34;

const HELP_LINES = [
  "DRAG ADD CHEMICAL   SHIFT+DRAG WIPE   N / B PATTERN   M RATE MAP   R RESEED   C CLEAR",
  "E AUTO   - + SPEED   [ ] CONTOURS   SPACE PAUSE   . STEP   H HUD   F FULLSCREEN   ESC MENU",
];

export interface GrayScottOptions {
  readonly seed: number;
  readonly presetIndex: number;
}

interface Level {
  readonly value: number;
  readonly color: BeamColor;
  readonly intensity: number;
  readonly geometry: DynamicGeometry;
}

// Reaction-diffusion as line art. The concentration of one chemical is treated as
// a height map and drawn as nested contour lines, so a spot is a small set of rings
// and a maze wall a pair of long parallel tracks. Changing pattern does not reset
// the dish: the rates slide to their new values and the old pattern is reworked
// into the new one where it stands.
export class GrayScottDemo implements Demo {
  public isPaused = false;
  public autoEvolve = true;
  public speedIndex = 2;
  public levelCount = 4;
  public mapMode = false;

  private readonly world: GrayScottWorld;
  private readonly tracer = new ContourTracer(GRID_WIDTH, GRID_HEIGHT);
  private readonly hud = new DemoHud();
  private levels: Level[] = [];
  private random: RandomSource;
  private seed: number;
  private presetIndex: number;
  private rates: ReactionRates;
  private morphFrom: ReactionRates;
  private morphSeconds = MORPH_SECONDS;
  private autoSeconds = 0;
  private worldWidth = 1778;
  private worldHeight = GRAY_SCOTT_WORLD_HEIGHT;
  private segmentCount = 0;

  public constructor(options: GrayScottOptions) {
    this.seed = options.seed;
    this.random = createSeededRandom(options.seed);
    this.presetIndex = options.presetIndex % REACTION_PRESETS.length;
    this.rates = this.morphFrom = REACTION_PRESETS[this.presetIndex];
    this.world = new GrayScottWorld(GRID_WIDTH, GRID_HEIGHT, this.rates);
    this.world.seed(this.random, SEED_PATCHES, SEED_RADIUS);
    this.hud.showBanner(`GRAY-SCOTT  ${REACTION_PRESETS[this.presetIndex].name}`);
  }

  public get currentSeed(): number {
    return this.seed;
  }

  public get preset(): number {
    return this.presetIndex;
  }

  // The rates in force right now, part-way between patterns while morphing.
  public get currentRates(): ReactionRates {
    return this.rates;
  }

  public get totalV(): number {
    return this.world.totalV();
  }

  public resize(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (this.isPaused) return;

    if (this.autoEvolve && !this.mapMode) {
      this.autoSeconds += deltaSeconds;
      if (this.autoSeconds >= AUTO_SECONDS) this.changePreset(1);
    }
    if (!this.mapMode && this.morphSeconds < MORPH_SECONDS) {
      this.morphSeconds = Math.min(MORPH_SECONDS, this.morphSeconds + deltaSeconds);
      const amount = this.morphSeconds / MORPH_SECONDS;
      const target = REACTION_PRESETS[this.presetIndex];
      this.rates = {
        feed: this.morphFrom.feed + (target.feed - this.morphFrom.feed) * amount,
        kill: this.morphFrom.kill + (target.kill - this.morphFrom.kill) * amount,
      };
      this.world.setRates(this.rates);
    }
    for (let step = 0; step < SPEEDS[this.speedIndex]; step++) this.world.step();
    // A dish with no V left will never do anything again on its own.
    if (this.autoEvolve && this.world.stepCount % 240 < SPEEDS[this.speedIndex] && this.world.totalV() < 1) {
      this.world.seed(this.random, SEED_PATCHES, SEED_RADIUS);
    }
  }

  public draw(displayList: DisplayList): void {
    if (this.levels.length !== this.levelCount) this.levels = createLevels(this.levelCount);
    // Cover the screen; the grid is 16:9, so most screens crop it only slightly.
    const scale = Math.max(this.worldWidth / GRID_WIDTH, this.worldHeight / GRID_HEIGHT);
    const transform = {
      offsetX: (this.worldWidth - GRID_WIDTH * scale) / 2 + scale / 2,
      offsetY: (this.worldHeight - GRID_HEIGHT * scale) / 2 + scale / 2,
      scale,
    };
    this.segmentCount = 0;
    for (const level of this.levels) {
      level.geometry.clear();
      this.tracer.trace(this.world.v, level.value, level.geometry, transform);
      if (level.geometry.segmentCount === 0) continue;
      this.segmentCount += level.geometry.segmentCount;
      displayList.setColor(level.color);
      displayList.addShape(level.geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: level.intensity });
    }
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const rates = this.mapMode
      ? `RATE MAP  FEED ${RATE_MAP_LOW.feed}-${RATE_MAP_HIGH.feed} UP  KILL ${RATE_MAP_LOW.kill}-${RATE_MAP_HIGH.kill} ACROSS`
      : `${REACTION_PRESETS[this.presetIndex].name}  FEED ${this.rates.feed.toFixed(4)}  KILL ${this.rates.kill.toFixed(4)}`;
    this.hud.draw(displayList, {
      title: "GRAY-SCOTT",
      statusLines: [
        `${rates}  SEED ${this.seed}`,
        `STEP ${this.world.stepCount}  SPEED ${SPEEDS[this.speedIndex]}/FRAME  CONTOURS ${this.levelCount}  AUTO ${this.autoEvolve ? "ON" : "OFF"}`,
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

  // Slides the rates toward another pattern's, leaving the dish as it is.
  public changePreset(delta: number): void {
    const count = REACTION_PRESETS.length;
    this.presetIndex = (((this.presetIndex + delta) % count) + count) % count;
    this.morphFrom = this.rates;
    this.morphSeconds = 0;
    this.autoSeconds = 0;
    if (this.mapMode) {
      this.mapMode = false;
      this.world.setRates(this.rates);
    }
    this.hud.showBanner(REACTION_PRESETS[this.presetIndex].name);
  }

  // Every regime at once: the rates vary across the screen instead of over time.
  public toggleMap(): void {
    this.mapMode = !this.mapMode;
    if (this.mapMode) {
      this.world.setRateMap(RATE_MAP_LOW, RATE_MAP_HIGH);
      this.world.seed(this.random, SEED_PATCHES * 3, SEED_RADIUS);
    } else {
      this.world.setRates(this.rates);
    }
    this.hud.showBanner(this.mapMode ? "RATE MAP" : REACTION_PRESETS[this.presetIndex].name);
  }

  public reseed(): void {
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.random = createSeededRandom(this.seed);
    this.world.seed(this.random, this.mapMode ? SEED_PATCHES * 3 : SEED_PATCHES, SEED_RADIUS);
    this.hud.showBanner(`RESEEDED  SEED ${this.seed}`);
  }

  public clear(): void {
    this.world.clear();
    this.hud.showBanner("CLEARED  DRAG TO ADD CHEMICAL");
  }

  public changeSpeed(delta: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIndex + delta));
    this.hud.showBanner(`SPEED ${SPEEDS[this.speedIndex]} STEPS/FRAME`);
  }

  public changeLevels(delta: number): void {
    this.levelCount = Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, this.levelCount + delta));
    this.hud.showBanner(`CONTOURS ${this.levelCount}`);
  }

  public toggleAuto(): void {
    this.autoEvolve = !this.autoEvolve;
    this.autoSeconds = 0;
    this.hud.showBanner(`AUTO ${this.autoEvolve ? "ON" : "OFF"}`);
  }

  // The pointer adds a dab of V, or with `wipe` returns the spot to rest. World coordinates in.
  public pointerAt(worldX: number, worldY: number, wipe: boolean): void {
    const scale = Math.max(this.worldWidth / GRID_WIDTH, this.worldHeight / GRID_HEIGHT);
    const gridX = (worldX - (this.worldWidth - GRID_WIDTH * scale) / 2) / scale;
    const gridY = (worldY - (this.worldHeight - GRID_HEIGHT * scale) / 2) / scale;
    this.world.paint(gridX, gridY, wipe ? BRUSH_RADIUS * 2 : BRUSH_RADIUS, !wipe);
  }
}

// Evenly spaced levels of V, from a dim violet outline at the edge of a feature up
// to a bright warm line around its core.
export function createLevels(count: number): Level[] {
  const levels: Level[] = [];
  for (let index = 0; index < count; index++) {
    const amount = count === 1 ? 0.5 : index / (count - 1);
    levels.push({
      value: LOWEST_LEVEL + (HIGHEST_LEVEL - LOWEST_LEVEL) * amount,
      color: hslToBeamColor(0.78 + 0.34 * amount, 0.9 - 0.2 * amount, 0.5 + 0.2 * amount),
      intensity: 0.5 + 0.7 * amount,
      geometry: new DynamicGeometry(2048),
    });
  }
  return levels;
}
