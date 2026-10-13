import { describe, expect, it } from "vitest";
import { HEIGHT_GENERATIONS, terrainHeights } from "../src/sim/heightField.js";

const WIDTH = 16;

function row(...live: number[]): Uint8Array {
  const cells = new Uint8Array(WIDTH);
  for (const column of live) cells[column] = 1;
  return cells;
}

describe("terrainHeights", () => {
  it("is flat at zero over empty ground and flat at one over solid ground", () => {
    expect(Array.from(terrainHeights([row(), row(), row()]))).toEqual(new Array(WIDTH).fill(0));
    const solid = new Uint8Array(WIDTH).fill(1);
    for (const height of terrainHeights([solid, solid, solid])) expect(height).toBeCloseTo(1, 6);
  });

  it("peaks at a lone live cell and slopes away on both sides", () => {
    const heights = terrainHeights([row(8)]);
    expect(heights[8]).toBeGreaterThan(heights[7]);
    expect(heights[7]).toBeGreaterThan(heights[6]);
    expect(heights[6]).toBeGreaterThan(0);
    expect(heights[5]).toBe(0);
    expect(heights[7]).toBeCloseTo(heights[9], 6);
    expect(heights[6]).toBeCloseTo(heights[10], 6);
  });

  it("stands higher where earlier generations were crowded too", () => {
    const crowdedBefore = terrainHeights([row(7, 8, 9), row(7, 8, 9), row(8)]);
    const emptyBefore = terrainHeights([row(), row(), row(8)]);
    expect(crowdedBefore[8]).toBeGreaterThan(emptyBefore[8]);
  });

  it("leaves a rise behind where cells have just died", () => {
    const heights = terrainHeights([row(8), row(8), row()]);
    expect(heights[8]).toBeGreaterThan(0);
    expect(heights[8]).toBeLessThan(terrainHeights([row(8), row(8), row(8)])[8]);
  });

  it("wraps around the ring", () => {
    const heights = terrainHeights([row(0)]);
    expect(heights[WIDTH - 1]).toBeCloseTo(heights[1], 6);
    expect(heights[WIDTH - 1]).toBeGreaterThan(0);
  });

  it("reads only the last few generations and stays within 0..1", () => {
    const old = new Uint8Array(WIDTH).fill(1);
    const recent = [row(3), row(4), row(5)];
    expect(recent).toHaveLength(HEIGHT_GENERATIONS);
    expect(Array.from(terrainHeights([old, old, ...recent]))).toEqual(Array.from(terrainHeights(recent)));
    for (const height of terrainHeights(recent)) {
      expect(height).toBeGreaterThanOrEqual(0);
      expect(height).toBeLessThanOrEqual(1);
    }
  });
});
