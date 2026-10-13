import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { createSeededRandom } from "@vector-demos/demo-kit";
import { GrayScottDemo, REACTION_PRESETS, createLevels } from "../src/GrayScottDemo.js";
import { GrayScottWorld } from "../src/sim/GrayScottWorld.js";

const CORAL = { feed: 0.0545, kill: 0.062 };

function seededWorld(rates = CORAL, columns = 64, rows = 48): GrayScottWorld {
  const world = new GrayScottWorld(columns, rows, rates);
  world.seed(createSeededRandom(7), 4, 4);
  return world;
}

describe("GrayScottWorld", () => {
  it("rests for ever when there is no V", () => {
    const world = new GrayScottWorld(32, 32, CORAL);
    for (let step = 0; step < 200; step++) world.step();
    expect(world.totalV()).toBe(0);
    for (const value of world.u) expect(value).toBe(1);
  });

  it("grows a seeded patch into a pattern that fills the dish", () => {
    const world = seededWorld();
    const before = world.totalV();
    for (let step = 0; step < 4000; step++) world.step();
    expect(world.totalV()).toBeGreaterThan(before * 4);
  });

  it("lets the reaction die where the kill rate is too high", () => {
    const world = seededWorld({ feed: 0.03, kill: 0.075 });
    for (let step = 0; step < 3000; step++) world.step();
    expect(world.totalV()).toBeLessThan(1e-3);
  });

  it("keeps both chemicals finite and between 0 and 1", () => {
    for (const preset of REACTION_PRESETS) {
      const world = seededWorld(preset);
      for (let step = 0; step < 1500; step++) world.step();
      for (let cell = 0; cell < world.u.length; cell++) {
        expect(world.u[cell]).toBeGreaterThanOrEqual(0);
        expect(world.u[cell]).toBeLessThanOrEqual(1.0001);
        expect(world.v[cell]).toBeGreaterThanOrEqual(0);
        expect(world.v[cell]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is a torus: a patch across the corner evolves like one in the middle", () => {
    const corner = new GrayScottWorld(40, 40, CORAL);
    const middle = new GrayScottWorld(40, 40, CORAL);
    corner.paint(0, 0, 4, true);
    middle.paint(20, 20, 4, true);
    for (let step = 0; step < 300; step++) {
      corner.step();
      middle.step();
    }
    expect(corner.totalV()).toBeCloseTo(middle.totalV(), 3);
    expect(corner.v[39 * 40 + 39]).toBeCloseTo(middle.v[19 * 40 + 19], 5);
  });

  it("reproduces the same dish from the same seed", () => {
    const first = seededWorld();
    const second = seededWorld();
    for (let step = 0; step < 100; step++) {
      first.step();
      second.step();
    }
    expect(Array.from(first.v)).toEqual(Array.from(second.v));
  });

  it("wipes a painted disc back to rest", () => {
    const world = new GrayScottWorld(32, 32, CORAL);
    world.paint(10, 10, 3, true);
    expect(world.totalV()).toBeGreaterThan(0);
    world.paint(10, 10, 5, false);
    expect(world.totalV()).toBe(0);
  });

  it("lays the rate map out with kill rising across and feed rising up", () => {
    const world = new GrayScottWorld(10, 6, CORAL);
    world.setRateMap({ feed: 0.01, kill: 0.04 }, { feed: 0.08, kill: 0.07 });
    expect(world.kill[0]).toBeCloseTo(0.04, 6);
    expect(world.kill[9]).toBeCloseTo(0.07, 6);
    expect(world.feed[0]).toBeCloseTo(0.08, 6);
    expect(world.feed[5 * 10]).toBeCloseTo(0.01, 6);
    world.setRates(CORAL);
    expect(world.feed[37]).toBeCloseTo(CORAL.feed, 6);
    expect(world.kill[37]).toBeCloseTo(CORAL.kill, 6);
  });
});

describe.each(REACTION_PRESETS.map((preset) => [preset.name, preset] as const))("%s", (_name, preset) => {
  it("is still alive after a long run", () => {
    const world = seededWorld(preset, 80, 56);
    for (let step = 0; step < 4000; step++) world.step();
    expect(world.totalV()).toBeGreaterThan(20);
  });
});

describe("GrayScottDemo", () => {
  function createDemo(): GrayScottDemo {
    const demo = new GrayScottDemo({ seed: 3, presetIndex: 0 });
    demo.autoEvolve = false;
    return demo;
  }

  it("slides the rates to the next pattern instead of jumping, and keeps the dish", () => {
    const demo = createDemo();
    for (let frame = 0; frame < 30; frame++) demo.update(1 / 60);
    const before = demo.totalV;
    demo.changePreset(1);
    expect(demo.currentRates.feed).toBeCloseTo(REACTION_PRESETS[0].feed, 6);
    expect(demo.totalV).toBe(before);
    for (let frame = 0; frame < 120; frame++) demo.update(1 / 60);
    const feed = demo.currentRates.feed;
    expect(feed).toBeLessThan(REACTION_PRESETS[0].feed);
    expect(feed).toBeGreaterThan(REACTION_PRESETS[1].feed);
    for (let frame = 0; frame < 180; frame++) demo.update(1 / 60);
    expect(demo.currentRates.feed).toBeCloseTo(REACTION_PRESETS[1].feed, 6);
    expect(demo.currentRates.kill).toBeCloseTo(REACTION_PRESETS[1].kill, 6);
  });

  it("draws contours of a growing pattern, more of them with more levels", () => {
    const demo = createDemo();
    demo.resize(1778, 1000);
    for (let frame = 0; frame < 120; frame++) demo.update(1 / 60);
    const few = new DisplayList();
    demo.levelCount = 2;
    demo.draw(few);
    const many = new DisplayList();
    demo.levelCount = 6;
    demo.draw(many);
    expect(few.segmentCount).toBeGreaterThan(0);
    expect(many.segmentCount).toBeGreaterThan(few.segmentCount);
  });

  it("adds chemical under the pointer and wipes it again", () => {
    const demo = createDemo();
    demo.resize(1778, 1000);
    demo.clear();
    expect(demo.totalV).toBe(0);
    demo.pointerAt(900, 500, false);
    expect(demo.totalV).toBeGreaterThan(0);
    demo.pointerAt(900, 500, true);
    expect(demo.totalV).toBe(0);
  });

  it("spaces contour levels evenly from low to high", () => {
    const levels = createLevels(4).map((level) => level.value);
    expect(levels[0]).toBeLessThan(levels[3]);
    expect(levels[1] - levels[0]).toBeCloseTo(levels[3] - levels[2], 6);
  });
});
