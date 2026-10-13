import { describe, expect, it } from "vitest";
import { LeniaSession } from "../src/sim/LeniaSession.js";
import { LENIA_CREATURES } from "../src/sim/creatures.js";
import { parseLeniaRle } from "../src/sim/rle.js";

function patternMass(index: number): number {
  return parseLeniaRle(LENIA_CREATURES[index].cells).cells.reduce((sum, value) => sum + value, 0);
}

describe("LeniaSession", () => {
  it("loads a species with its parameters and several well-spaced creatures", () => {
    const session = new LeniaSession(256, 128);
    session.loadSpecies(0, 42);
    expect(session.world.parameters).toEqual(LENIA_CREATURES[0].parameters);
    expect(session.placedCount).toBeGreaterThan(1);
    expect(session.world.mass()).toBeCloseTo(session.placedCount * patternMass(0), 0);
    expect(session.seededMass).toBeCloseTo(session.world.mass(), 3);
  });

  it("places fewer copies of large species", () => {
    const session = new LeniaSession(256, 128);
    session.loadSpecies(0, 1);
    const smallCount = session.placedCount;
    const large = LENIA_CREATURES.findIndex((creature) => creature.code === "P6al");
    session.loadSpecies(large, 1);
    expect(session.placedCount).toBeLessThan(smallCount);
    expect(session.placedCount).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic for a seed", () => {
    const first = new LeniaSession(128, 64);
    const second = new LeniaSession(128, 64);
    first.loadSpecies(0, 9);
    second.loadSpecies(0, 9);
    first.step();
    second.step();
    expect(Array.from(first.world.cells)).toEqual(Array.from(second.world.cells));
  });

  it("drops an extra creature and erases cells on request", () => {
    const session = new LeniaSession(256, 128);
    session.loadSpecies(0, 3);
    session.world.clear();
    session.dropCreature(30, 30, 0);
    expect(session.world.mass()).toBeCloseTo(patternMass(0), 3);
    session.erase(30, 30, 20);
    expect(session.world.mass()).toBe(0);
  });

  it("counts steps", () => {
    const session = new LeniaSession(64, 64);
    session.loadSpecies(0, 3);
    session.step();
    session.step();
    expect(session.stepCount).toBe(2);
  });
});
