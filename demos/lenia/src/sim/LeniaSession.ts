import { createSeededRandom, type RandomSource } from "@vector-demos/demo-kit";
import { LeniaWorld } from "./LeniaWorld.js";
import { LENIA_CREATURES } from "./creatures.js";
import { parseLeniaRle, type LeniaPattern } from "./rle.js";

// Roughly how much of the field the creatures of one species start out covering.
const TARGET_COVERAGE = 0.08;
const MAX_CREATURES = 6;
const PLACEMENT_ATTEMPTS = 200;

// One running Lenia field plus the species loaded into it. Runs in the worker (or on the main thread
// as a fallback); everything here is plain data so it can be tested without a browser.
export class LeniaSession {
  public readonly world: LeniaWorld;
  public speciesIndex = 0;
  public placedCount = 0;
  public seededMass = 0;
  public stepCount = 0;
  private pattern: LeniaPattern;
  private random: RandomSource = createSeededRandom(1);
  private quarterTurns = 0;

  public constructor(width: number, height: number) {
    this.world = new LeniaWorld(width, height, LENIA_CREATURES[0].parameters);
    this.pattern = parseLeniaRle(LENIA_CREATURES[0].cells);
  }

  // Clears the field and places a few copies of one species, all facing the same way so they travel
  // in parallel and roam for a while before any collision.
  public loadSpecies(index: number, seed: number): void {
    const creature = LENIA_CREATURES[index];
    this.speciesIndex = index;
    this.random = createSeededRandom(seed);
    this.pattern = parseLeniaRle(creature.cells);
    this.world.setParameters(creature.parameters);
    this.world.clear();
    this.stepCount = 0;
    this.quarterTurns = Math.floor(this.random() * 4);

    const { width, height } = this.world;
    const footprint = this.pattern.width * this.pattern.height;
    const wanted = Math.max(1, Math.min(MAX_CREATURES, Math.round((TARGET_COVERAGE * width * height) / footprint)));
    const spacing = Math.max(this.pattern.width, this.pattern.height) * 1.6;
    const centers: { x: number; y: number }[] = [];
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS && centers.length < wanted; attempt++) {
      const candidate = { x: this.random() * width, y: this.random() * height };
      const isClear = centers.every((other) => torusDistance(candidate, other, width, height) >= spacing);
      if (isClear) centers.push(candidate);
    }
    for (const center of centers) this.world.stamp(this.pattern, center.x, center.y, this.quarterTurns);
    this.placedCount = centers.length;
    this.seededMass = this.world.mass();
  }

  public dropCreature(x: number, y: number, quarterTurns = this.quarterTurns): void {
    this.world.stamp(this.pattern, x, y, quarterTurns);
  }

  public erase(x: number, y: number, radius: number): void {
    this.world.erase(x, y, radius);
  }

  public step(): void {
    this.world.step();
    this.stepCount++;
  }
}

function torusDistance(a: { x: number; y: number }, b: { x: number; y: number }, width: number, height: number): number {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  dx = Math.min(dx, width - dx);
  dy = Math.min(dy, height - dy);
  return Math.hypot(dx, dy);
}
