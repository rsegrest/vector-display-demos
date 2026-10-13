import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@vector-demos/demo-kit";
import { PhysarumWorld, wrapCoordinate, type PhysarumSettings } from "../src/sim/physarum.js";

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
});

describe("PhysarumWorld seeding", () => {
  it("reproduces the same dish for the same seed", () => {
    const first = createWorld(30, {}, 7);
    const second = createWorld(30, {}, 7);
    expect(Array.from(first.agentX)).toEqual(Array.from(second.agentX));
    expect(Array.from(first.heading)).toEqual(Array.from(second.heading));
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
