import { describe, expect, it } from "vitest";
import { parseLeniaRle } from "../src/sim/rle.js";

describe("parseLeniaRle", () => {
  it("decodes single-letter, two-letter and empty cells", () => {
    // A = 1/255, X = 24/255, pA = 25/255, yO = 255/255? (y = 9 × 24 + 14 + 25 = 255)
    const pattern = parseLeniaRle("A.X$pAyO!");
    expect(pattern.width).toBe(3);
    expect(pattern.height).toBe(2);
    expect(pattern.cells[0]).toBeCloseTo(1 / 255);
    expect(pattern.cells[1]).toBe(0);
    expect(pattern.cells[2]).toBeCloseTo(24 / 255);
    expect(pattern.cells[3]).toBeCloseTo(25 / 255);
    expect(pattern.cells[4]).toBeCloseTo(1);
    // Short rows are padded with empty cells.
    expect(pattern.cells[5]).toBe(0);
  });

  it("expands run counts for cells and for row breaks", () => {
    const pattern = parseLeniaRle("3A2$B!");
    expect(pattern.width).toBe(3);
    // "2$" ends the row and adds one empty row after it.
    expect(pattern.height).toBe(3);
    expect(Array.from(pattern.cells.subarray(0, 3)).every((v) => Math.abs(v - 1 / 255) < 1e-7)).toBe(true);
    expect(Array.from(pattern.cells.subarray(3, 6))).toEqual([0, 0, 0]);
    expect(pattern.cells[6]).toBeCloseTo(2 / 255);
  });

  it("decodes the reference Orbium to a roughly 20-cell creature", async () => {
    const { LENIA_CREATURES } = await import("../src/sim/creatures.js");
    const orbium = LENIA_CREATURES.find((creature) => creature.code === "O2u")!;
    const pattern = parseLeniaRle(orbium.cells);
    expect(pattern.width).toBeGreaterThan(15);
    expect(pattern.width).toBeLessThan(30);
    expect(Math.max(...pattern.cells)).toBeLessThanOrEqual(1);
  });
});
