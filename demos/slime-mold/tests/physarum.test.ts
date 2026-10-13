import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@vector-demos/demo-kit";
import { SLIME_PRESETS } from "../src/SlimeMoldDemo.js";
import { FOOD_REACH, MAXIMUM_FOOD_SOURCES, PhysarumWorld, wrapCoordinate, type PhysarumSettings } from "../src/sim/physarum.js";

const COLUMNS = 64;
const ROWS = 36;

const STILL_SETTINGS: PhysarumSettings = {
  sensorAngle: 0.5,
  sensorDistance: 8,
  turnAngle: 0.6,
  moveDistance: 1.5,
  depositAmount: 0.5,
  decayFactor: 0.9,
  diffuseAmount: 0,
  jitter: 0,
  // No crowding or trail ceiling, so each rule below can be checked on its own.
  cellCapacity: 0,
  trailLimit: Infinity,
};

function createWorld(agentCount: number, settings: Partial<PhysarumSettings> = {}, seed = 123): PhysarumWorld {
  return new PhysarumWorld({
    columns: COLUMNS,
    rows: ROWS,
    agentCount,
    random: createSeededRandom(seed),
    settings: { ...STILL_SETTINGS, ...settings },
  });
}

describe("wrapCoordinate", () => {
  it("leaves a coordinate inside the range alone", () => {
    expect(wrapCoordinate(5, 64)).toBe(5);
  });

  it("wraps past either edge", () => {
    expect(wrapCoordinate(-1, 64)).toBe(63);
    expect(wrapCoordinate(64, 64)).toBe(0);
    expect(wrapCoordinate(-65, 64)).toBe(63);
  });

  it("never returns the size itself once stored as a 32-bit float", () => {
    const wrapped = wrapCoordinate(-1e-9, 64);
    expect(Math.fround(wrapped)).toBeLessThan(64);
  });
});

describe("PhysarumWorld seeding", () => {
  it("reproduces the same dish for the same seed", () => {
    const first = createWorld(30, {}, 7);
    const second = createWorld(30, {}, 7);
    expect(Array.from(first.agentX)).toEqual(Array.from(second.agentX));
    expect(Array.from(first.heading)).toEqual(Array.from(second.heading));
  });

  it("restarts from a new random source when one is passed to scatter", () => {
    const world = createWorld(30, {}, 7);
    world.scatter(createSeededRandom(99));
    const reference = createWorld(30, {}, 99);
    expect(Array.from(world.agentX)).toEqual(Array.from(reference.agentX));
  });

  it("starts with a blank trail", () => {
    const world = createWorld(30);
    expect(world.trail.every((value) => value === 0)).toBe(true);
    expect(world.maximumTrail).toBe(1);
  });
});

describe("PhysarumWorld stepping", () => {
  it("keeps every agent on the torus", () => {
    const world = createWorld(200);
    for (let step = 0; step < 120; step++) world.step();
    for (let agent = 0; agent < world.agentCount; agent++) {
      expect(world.agentX[agent]).toBeGreaterThanOrEqual(0);
      expect(world.agentX[agent]).toBeLessThan(COLUMNS);
      expect(world.agentY[agent]).toBeGreaterThanOrEqual(0);
      expect(world.agentY[agent]).toBeLessThan(ROWS);
    }
  });

  it("never leaves the trail negative and keeps it finite", () => {
    const world = createWorld(500);
    for (let step = 0; step < 200; step++) world.step();
    for (const value of world.trail) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("deposits trail where an agent crawls", () => {
    // One agent at a known spot heading right. After a step it must have fed the
    // cells just ahead of it.
    const world = createWorld(1, { depositAmount: 0.8 });
    world.clearTrail();
    world.agentX[0] = 10;
    world.agentY[0] = 10;
    world.heading[0] = 0;
    world.step();
    expect(world.trailAt(10 + STILL_SETTINGS.moveDistance, 10)).toBeGreaterThan(0);
    expect(world.trailAt(50, 30)).toBe(0);
  });

  it("fades a trail that nobody is feeding", () => {
    const world = createWorld(1);
    world.paint(20, 20, 3, 10);
    const before = world.trailAt(20, 20);
    // Park the agent far away so only decay acts on the spot.
    world.agentX[0] = 2;
    world.agentY[0] = 2;
    for (let step = 0; step < 20; step++) world.step();
    expect(world.trailAt(20, 20)).toBeLessThan(before);
  });

  it("spreads trail into neighbouring cells as it diffuses", () => {
    const world = createWorld(1, { diffuseAmount: 1, decayFactor: 1 });
    world.clearTrail();
    // Deposit a single cell, then park the agent away from it and step.
    world.trail[20 * COLUMNS + 20] = 1;
    world.agentX[0] = 2;
    world.agentY[0] = 2;
    world.step();
    expect(world.trail[20 * COLUMNS + 21]).toBeGreaterThan(0);
    expect(world.trailAt(20, 20)).toBeLessThan(1);
  });

  it("does not modify the trail of the step it is reading beyond decay", () => {
    const world = createWorld(0, { diffuseAmount: 0, decayFactor: 0.5 });
    world.clearTrail();
    world.trail[5 * COLUMNS + 5] = 8;
    world.step();
    expect(world.trail[5 * COLUMNS + 5]).toBeCloseTo(4, 5);
  });

  it("leaves no NaN even from coincident agents with zero jitter", () => {
    const world = createWorld(4, { jitter: 0 });
    world.agentX.fill(10);
    world.agentY.fill(10);
    world.heading.fill(0);
    for (let step = 0; step < 50; step++) world.step();
    for (const value of world.trail) expect(Number.isFinite(value)).toBe(true);
    for (const value of world.heading) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("PhysarumWorld painting and resizing", () => {
  it("raises the trail under a painted blob and wraps across edges", () => {
    const world = createWorld(0);
    world.paint(0, 0, 4, 5);
    expect(world.trailAt(0, 0)).toBeGreaterThan(0);
    // Just off the left/top edge is just inside the right/bottom edge on a torus.
    expect(world.trailAt(COLUMNS - 1, ROWS - 1)).toBeGreaterThan(0);
  });

  it("never paints the trail below zero", () => {
    const world = createWorld(0);
    world.paint(10, 10, 4, 5);
    world.paint(10, 10, 4, -100);
    for (const value of world.trail) expect(value).toBeGreaterThanOrEqual(0);
  });

  it("keeps the old agents when the count grows and scatters the new ones", () => {
    const world = createWorld(5);
    const firstX = world.agentX[0];
    world.setAgentCount(9);
    expect(world.agentCount).toBe(9);
    expect(world.agentX[0]).toBe(firstX);
    for (let agent = 5; agent < 9; agent++) {
      expect(world.agentX[agent]).toBeGreaterThanOrEqual(0);
      expect(world.agentX[agent]).toBeLessThan(COLUMNS);
    }
  });

  it("clears the trail and the step count", () => {
    const world = createWorld(20);
    for (let step = 0; step < 10; step++) world.step();
    world.clearTrail();
    expect(world.stepCount).toBe(0);
    expect(world.trail.every((value) => value === 0)).toBe(true);
  });
});

function occupiedCells(world: PhysarumWorld): Map<number, number> {
  const counts = new Map<number, number>();
  for (let agent = 0; agent < world.agentCount; agent++) {
    const cell = Math.floor(world.agentY[agent]) * world.columns + Math.floor(world.agentX[agent]);
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  return counts;
}

describe("PhysarumWorld crowding", () => {
  it("caps the trail at the limit", () => {
    const world = createWorld(400, { trailLimit: 0.7, depositAmount: 0.6, decayFactor: 0.99 });
    for (let step = 0; step < 100; step++) world.step();
    // The limit applies as the trail carries over; one step of fresh deposits may sit on top.
    expect(world.maximumTrail).toBeLessThanOrEqual(0.7);
  });

  it("turns an agent away from a full cell instead of letting it in", () => {
    const run = (cellCapacity: number): number => {
      const world = createWorld(2, { cellCapacity, moveDistance: 1 });
      world.agentX[0] = 10.5;
      world.agentY[0] = 10.5;
      world.heading[0] = 0;
      // A strong smell dead ahead, so the first agent goes straight for the next cell,
      // where the second agent already sits.
      for (const cell of [10 * COLUMNS + 18, 10 * COLUMNS + 19, 11 * COLUMNS + 18, 11 * COLUMNS + 19]) world.trail[cell] = 5;
      world.agentX[1] = 11.5;
      world.agentY[1] = 10.5;
      world.step();
      return world.agentX[0];
    };
    expect(run(0)).toBeCloseTo(11.5, 5);
    expect(run(1)).toBeCloseTo(10.5, 5);
  });

  // The regression this demo once shipped with: with nothing to stop strands
  // merging, every preset drained into one line within a thousand steps or so.
  it.each(SLIME_PRESETS.map((preset) => [preset.name, preset] as const))("%s keeps a wide network instead of collapsing", (_name, preset) => {
    const world = new PhysarumWorld({ columns: 144, rows: 81, agentCount: 1400, random: createSeededRandom(7), settings: preset.settings });
    for (let step = 0; step < 1000; step++) world.step();
    const counts = occupiedCells(world);
    expect(counts.size / (144 * 81)).toBeGreaterThan(0.04);
    // Agents scattered onto the same cell at the start have long since spread out.
    const overfull = [...counts.values()].filter((count) => count > world.settings.cellCapacity).length;
    expect(overfull / counts.size).toBeLessThan(0.01);
  });
});

describe("PhysarumWorld food", () => {
  it("adds a standing smell that does not fade", () => {
    const world = createWorld(0, { trailLimit: 1 });
    expect(world.addFood(20, 20)).toBe(true);
    const before = world.scentAt(20, 20);
    expect(before).toBeGreaterThan(0);
    for (let step = 0; step < 50; step++) world.step();
    expect(world.scentAt(20, 20)).toBe(before);
    expect(world.trailAt(20, 20)).toBe(0);
  });

  it("smells strongest at the source and not at all beyond its reach", () => {
    const world = new PhysarumWorld({ columns: 200, rows: 200, agentCount: 0, random: createSeededRandom(1) });
    world.addFood(100, 100);
    expect(world.scentAt(100, 100)).toBeGreaterThan(world.scentAt(110, 100));
    expect(world.scentAt(110, 100)).toBeGreaterThan(0);
    expect(world.scentAt(100 + FOOD_REACH + 2, 100)).toBe(0);
  });

  it("draws nearby agents in", () => {
    const world = new PhysarumWorld({ columns: 120, rows: 120, agentCount: 300, random: createSeededRandom(3) });
    world.addFood(60, 60);
    const near = () => {
      let count = 0;
      for (let agent = 0; agent < world.agentCount; agent++) {
        if (Math.hypot(world.agentX[agent] - 60, world.agentY[agent] - 60) < 15) count++;
      }
      return count;
    };
    const before = near();
    for (let step = 0; step < 400; step++) world.step();
    expect(near()).toBeGreaterThan(before * 2);
  });

  it("refuses a source on top of another, and past the limit", () => {
    const world = new PhysarumWorld({ columns: 400, rows: 400, agentCount: 0, random: createSeededRandom(1) });
    expect(world.addFood(50, 50)).toBe(true);
    expect(world.addFood(52, 50)).toBe(false);
    for (let index = 1; index < MAXIMUM_FOOD_SOURCES; index++) world.addFood((index % 10) * 30 + 100, Math.floor(index / 10) * 30 + 100);
    expect(world.foodSources.length).toBe(MAXIMUM_FOOD_SOURCES);
    expect(world.addFood(380, 380)).toBe(false);
  });

  it("removes sources near a point and clears them all", () => {
    const world = new PhysarumWorld({ columns: 200, rows: 200, agentCount: 0, random: createSeededRandom(1) });
    world.addFood(10, 10);
    world.addFood(140, 120);
    expect(world.removeFoodNear(11, 11, 5)).toBe(1);
    expect(world.foodSources.length).toBe(1);
    expect(world.scentAt(10, 10)).toBe(0);
    world.clearFood();
    expect(world.foodSources.length).toBe(0);
    expect(world.scentAt(140, 120)).toBe(0);
  });
});
