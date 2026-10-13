import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@vector-demos/demo-kit";
import {
  LeniaWorld,
  exponentialCore,
  gaussianGrowth,
  polynomialCore,
  polynomialGrowth,
} from "../src/sim/LeniaWorld.js";

const ORBIUM = { radius: 13, timeSteps: 10, rings: [1], growthCenter: 0.15, growthWidth: 0.015 };

describe("Lenia functions", () => {
  it("kernel cores are bumps that peak mid-ring and vanish at the edges", () => {
    for (const core of [polynomialCore, exponentialCore]) {
      expect(core(0.5)).toBeCloseTo(1);
      expect(core(0)).toBe(0);
      expect(core(1)).toBe(0);
      expect(core(0.25)).toBeLessThan(1);
    }
    expect(polynomialCore(0.25)).toBeCloseTo(0.75 ** 4);
  });

  it("growth is +1 at the center and -1 far from it", () => {
    for (const growth of [polynomialGrowth, gaussianGrowth]) {
      expect(growth(0.15, 0.15, 0.015)).toBeCloseTo(1);
      expect(growth(0.5, 0.15, 0.015)).toBeCloseTo(-1);
    }
    expect(gaussianGrowth(0.165, 0.15, 0.015)).toBeCloseTo(2 * Math.exp(-0.5) - 1);
    // The polynomial reaches -1 at exactly three widths from the center.
    expect(polynomialGrowth(0.15 + 3 * 0.015, 0.15, 0.015)).toBeCloseTo(-1);
  });
});

describe("LeniaWorld", () => {
  it("normalizes the kernel to sum to one", () => {
    const world = new LeniaWorld(64, 32, ORBIUM);
    let sum = 0;
    for (const value of world.kernel) sum += value;
    expect(sum).toBeCloseTo(1, 6);
  });

  it("computes the same neighborhood sums as a direct circular convolution", () => {
    const world = new LeniaWorld(32, 32, { ...ORBIUM, radius: 5 });
    const random = createSeededRandom(3);
    for (let i = 0; i < world.cells.length; i++) world.cells[i] = random() < 0.3 ? random() : 0;
    world.computePotential();
    const { width, height, kernel, cells } = world;
    for (const [x, y] of [[0, 0], [5, 17], [31, 31], [16, 2]]) {
      let sum = 0;
      for (let ky = 0; ky < height; ky++) {
        for (let kx = 0; kx < width; kx++) {
          const weight = kernel[ky * width + kx];
          if (weight === 0) continue;
          sum += weight * cells[((y - ky + height) % height) * width + ((x - kx + width) % width)];
        }
      }
      expect(world.potential[y * width + x]).toBeCloseTo(sum, 6);
    }
  });

  it("keeps cells within [0, 1] while stepping", () => {
    const world = new LeniaWorld(64, 32, ORBIUM);
    world.seedPatch(createSeededRandom(1), 32, 16, 12);
    for (let step = 0; step < 20; step++) world.step();
    for (const value of world.cells) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("stamps a pattern centered on a point, rotated by quarter turns", () => {
    const world = new LeniaWorld(32, 32, ORBIUM);
    // An L: (0,0) and (0,1) and (1,1) in a 2 x 2 pattern.
    const pattern = { width: 2, height: 2, cells: Float32Array.from([1, 0, 1, 1]) };
    world.stamp(pattern, 10, 10);
    expect([world.cells[9 * 32 + 9], world.cells[9 * 32 + 10], world.cells[10 * 32 + 9], world.cells[10 * 32 + 10]]).toEqual([1, 0, 1, 1]);
    world.clear();
    world.stamp(pattern, 10, 10, 1);
    // A quarter turn clockwise moves the empty corner from top right to bottom right.
    expect([world.cells[9 * 32 + 9], world.cells[9 * 32 + 10], world.cells[10 * 32 + 9], world.cells[10 * 32 + 10]]).toEqual([1, 1, 1, 0]);
  });

  it("empty space stays empty", () => {
    const world = new LeniaWorld(32, 32, ORBIUM);
    world.step();
    expect(world.mass()).toBe(0);
  });

  it("seeds a patch of living cells around a point, wrapping at the edges", () => {
    const world = new LeniaWorld(64, 32, ORBIUM);
    world.seedPatch(createSeededRandom(2), 1, 1, 6);
    expect(world.mass()).toBeGreaterThan(0);
    expect(world.cells[31 * 64 + 63]).toBeGreaterThanOrEqual(0);
    let farMass = 0;
    for (let y = 10; y < 22; y++) for (let x = 20; x < 44; x++) farMass += world.cells[y * 64 + x];
    expect(farMass).toBe(0);
  });

});
