import type { DisplayList } from "@vector-display/core";
import { DemoHud, createRandomSeed, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { LeniaClient } from "./LeniaClient.js";
import { ContourRenderer } from "./render/ContourRenderer.js";
import { LENIA_CREATURES } from "./sim/creatures.js";

export const GRID_WIDTH = 256;
export const GRID_HEIGHT = 128;
export const SPEEDS: readonly number[] = [10, 20, 30, 45, 60];
export const LEVEL_COUNTS: readonly number[] = [3, 5, 7, 9];
export const TRAIL_MODES: readonly { readonly name: string; readonly halfLifeMilliseconds: number }[] = [
  { name: "SHORT", halfLifeMilliseconds: 40 },
  { name: "MEDIUM", halfLifeMilliseconds: 150 },
  { name: "LONG", halfLifeMilliseconds: 500 },
  { name: "INK", halfLifeMilliseconds: 1500 },
];
const RELIEF_PER_LEVEL = 7;

// When to move on to the next species in auto mode.
const SPECIES_SECONDS = 70;
const BLOOM_MASS_RATIO = 3;
const BLOOM_SECONDS = 12;
const EXTINCT_MASS_RATIO = 0.05;
const EXTINCT_SECONDS = 2.5;

const HELP_LINES = [
  "CLICK DROP CREATURE   SHIFT+CLICK ERASE   N NEXT SPECIES   B PREVIOUS   R RESEED   A AUTO",
  "L LEVELS   V RELIEF   T TRAILS   - + SPEED   SPACE PAUSE   . STEP   H HUD   F FULLSCREEN   ESC MENU",
];

// Lenia drawn as contour lines. Runs the reference catalog's creatures a species at a time and, in
// auto mode, moves on when they bloom into a labyrinth, die out, or have had the stage for a while.
export class LeniaDemo implements Demo {
  public autoAdvance = true;
  public speedIndex = 2;
  public levelIndex = 2;
  public trailIndex = 1;
  public hasRelief = true;
  public isPaused = false;
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly client = new LeniaClient(GRID_WIDTH, GRID_HEIGHT);
  private readonly contours = new ContourRenderer(GRID_WIDTH, GRID_HEIGHT);
  private readonly hud = new DemoHud();
  private speciesIndex: number;
  private speciesSeconds = 0;
  private bloomSeconds = 0;
  private extinctSeconds = 0;
  private segmentCount = 0;
  private worldWidth = 2000;
  private worldHeight = 1000;

  public constructor(startSpecies = 0) {
    this.speciesIndex = startSpecies % LENIA_CREATURES.length;
    this.client.setRate(SPEEDS[this.speedIndex]);
    this.loadSpecies(this.speciesIndex);
  }

  public get speciesCount(): number {
    return LENIA_CREATURES.length;
  }

  public get currentSpecies(): number {
    return this.speciesIndex;
  }

  public resize(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    const frame = this.client.latest;
    if (this.isPaused || !frame || frame.speciesIndex !== this.speciesIndex) return;
    this.speciesSeconds += deltaSeconds;
    const ratio = frame.seededMass > 0 ? frame.mass / frame.seededMass : 0;
    this.bloomSeconds = ratio > BLOOM_MASS_RATIO ? this.bloomSeconds + deltaSeconds : 0;
    this.extinctSeconds = ratio < EXTINCT_MASS_RATIO ? this.extinctSeconds + deltaSeconds : 0;
    if (this.extinctSeconds > EXTINCT_SECONDS) {
      this.hud.showBanner("EXTINCT");
      this.advance(1);
    } else if (this.autoAdvance && (this.bloomSeconds > BLOOM_SECONDS || this.speciesSeconds > SPECIES_SECONDS)) {
      this.advance(1);
    }
  }

  public draw(displayList: DisplayList): void {
    const field = this.client.blendedField(performance.now());
    if (!field) return;
    this.segmentCount = this.contours.draw(displayList, field, this.worldWidth, this.worldHeight, {
      levelCount: LEVEL_COUNTS[this.levelIndex],
      reliefPerLevel: this.hasRelief ? RELIEF_PER_LEVEL : 0,
    });
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const creature = LENIA_CREATURES[this.speciesIndex];
    const latest = this.client.latest;
    const { radius, timeSteps, growthCenter, growthWidth } = creature.parameters;
    const bloom = this.bloomSeconds > 0 ? "  BLOOMING" : "";
    this.hud.draw(displayList, {
      title: "LENIA",
      statusLines: [
        `${creature.name.toUpperCase()}  (${this.speciesIndex + 1}/${LENIA_CREATURES.length})`,
        `R ${radius}  T ${timeSteps}  M ${growthCenter}  S ${growthWidth}  RINGS ${creature.parameters.rings.length}`,
        `STEP ${latest?.stepCount ?? 0}  MASS ${Math.round(latest?.mass ?? 0)}${bloom}${this.isPaused ? "  PAUSED" : ""}`,
        `SPEED ${SPEEDS[this.speedIndex]}/S  LEVELS ${LEVEL_COUNTS[this.levelIndex]}  TRAILS ${TRAIL_MODES[this.trailIndex].name}  AUTO ${this.autoAdvance ? "ON" : "OFF"}  SEGMENTS ${this.segmentCount}`,
      ],
      helpLines: HELP_LINES,
      width: frame.width,
      height: frame.height,
    });
  }

  // --- Actions -------------------------------------------------------------------------------------------

  public noteActivity(): void {
    this.hud.noteActivity();
  }

  public toggleHud(): void {
    this.hud.toggle();
  }

  public advance(delta: number): void {
    const count = LENIA_CREATURES.length;
    this.loadSpecies((((this.speciesIndex + delta) % count) + count) % count);
  }

  public reseed(): void {
    this.loadSpecies(this.speciesIndex);
  }

  public toggleAuto(): void {
    this.autoAdvance = !this.autoAdvance;
    this.speciesSeconds = 0;
    this.hud.showBanner(`AUTO ${this.autoAdvance ? "ON" : "OFF"}`);
  }

  public changeSpeed(delta: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIndex + delta));
    this.client.setRate(SPEEDS[this.speedIndex]);
    this.hud.showBanner(`SPEED ${SPEEDS[this.speedIndex]} STEPS/S`);
  }

  public cycleLevels(): void {
    this.levelIndex = (this.levelIndex + 1) % LEVEL_COUNTS.length;
    this.hud.showBanner(`LEVELS ${LEVEL_COUNTS[this.levelIndex]}`);
  }

  public toggleRelief(): void {
    this.hasRelief = !this.hasRelief;
    this.hud.showBanner(`RELIEF ${this.hasRelief ? "ON" : "OFF"}`);
  }

  public cycleTrails(): void {
    this.trailIndex = (this.trailIndex + 1) % TRAIL_MODES.length;
    this.onTrailChange(TRAIL_MODES[this.trailIndex].halfLifeMilliseconds);
    this.hud.showBanner(`TRAILS ${TRAIL_MODES[this.trailIndex].name}`);
  }

  public togglePause(): void {
    this.isPaused = !this.isPaused;
    this.client.setPaused(this.isPaused);
  }

  public stepOnce(): void {
    if (!this.isPaused) this.togglePause();
    this.client.stepOnce();
  }

  // Screen (world) coordinates to grid cells, inverting the renderer's cover mapping.
  public dropAt(worldX: number, worldY: number): void {
    const cell = this.worldToCell(worldX, worldY);
    this.client.drop(cell.x, cell.y);
  }

  public eraseAt(worldX: number, worldY: number): void {
    const cell = this.worldToCell(worldX, worldY);
    this.client.erase(cell.x, cell.y, 12);
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private loadSpecies(index: number): void {
    this.speciesIndex = index;
    this.speciesSeconds = 0;
    this.bloomSeconds = 0;
    this.extinctSeconds = 0;
    this.client.load(index, createRandomSeed());
    this.hud.showBanner(LENIA_CREATURES[index].name.toUpperCase());
  }

  private worldToCell(worldX: number, worldY: number): { x: number; y: number } {
    const scale = Math.max(this.worldWidth / GRID_WIDTH, this.worldHeight / GRID_HEIGHT);
    const offsetX = (this.worldWidth - GRID_WIDTH * scale) / 2;
    const offsetY = (this.worldHeight - GRID_HEIGHT * scale) / 2;
    return { x: (worldX - offsetX) / scale, y: (worldY - offsetY) / scale };
  }
}
