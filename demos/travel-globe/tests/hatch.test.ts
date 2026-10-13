import { describe, expect, it } from "vitest";
import { angledHatchSegments, hatchSegments, pointInRings, ringsBounds } from "../src/geo/shapes.js";

const square = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
const hole = [4, 4, 6, 4, 6, 6, 4, 6, 4, 4];

describe("ringsBounds", () => {
  it("finds the bounding box of all rings", () => {
    expect(ringsBounds([square, hole])).toEqual({ minLng: 0, minLat: 0, maxLng: 10, maxLat: 10 });
  });
});

describe("pointInRings", () => {
  it("uses the even-odd rule, so holes are outside", () => {
    expect(pointInRings(2, 2, [square])).toBe(true);
    expect(pointInRings(12, 2, [square])).toBe(false);
    expect(pointInRings(5, 5, [square, hole])).toBe(false);
    expect(pointInRings(5, 2, [square, hole])).toBe(true);
  });
});

describe("hatchSegments", () => {
  it("fills a square with evenly spaced parallels spanning its width", () => {
    const lines = hatchSegments([square], 2);
    expect(lines.length).toBe(5);
    for (const line of lines) {
      expect(line.lngStart).toBeCloseTo(0);
      expect(line.lngEnd).toBeCloseTo(10);
    }
    expect(lines.map((line) => line.lat)).toEqual([1, 3, 5, 7, 9]);
  });

  it("splits a parallel around a hole", () => {
    const lines = hatchSegments([square, hole], 2).filter((line) => line.lat === 5);
    expect(lines).toHaveLength(2);
    expect(lines[0].lngEnd).toBeCloseTo(4);
    expect(lines[1].lngStart).toBeCloseTo(6);
  });

  it("still gives a tiny shape at least a few lines", () => {
    const tiny = [0, 0, 0.2, 0, 0.2, 0.2, 0, 0.2, 0, 0];
    expect(hatchSegments([tiny], 2).length).toBeGreaterThanOrEqual(3);
  });
});

describe("angledHatchSegments", () => {
  it("draws diagonal lines that stay inside the shape", () => {
    const lines = angledHatchSegments([square], 2, Math.PI / 4);
    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) {
      // At 45° every segment rises as much as it runs.
      expect(Math.abs(line.lng1 - line.lng0)).toBeCloseTo(Math.abs(line.lat1 - line.lat0), 6);
      for (const [lng, lat] of [[line.lng0, line.lat0], [line.lng1, line.lat1]]) {
        expect(lng).toBeGreaterThanOrEqual(-1e-6);
        expect(lng).toBeLessThanOrEqual(10 + 1e-6);
        expect(lat).toBeGreaterThanOrEqual(-1e-6);
        expect(lat).toBeLessThanOrEqual(10 + 1e-6);
      }
    }
  });

  it("matches the parallel hatch at angle zero", () => {
    const flat = angledHatchSegments([square], 2, 0);
    expect(flat.map((l) => l.lat0)).toEqual(hatchSegments([square], 2).map((l) => l.lat));
  });
});

describe("hatchSegments phase", () => {
  it("slides the lines by a fraction of the spacing", () => {
    const shifted = hatchSegments([square], 2, 0.25).map((line) => line.lat);
    expect(shifted).toEqual([1.5, 3.5, 5.5, 7.5, 9.5]);
  });

  it("lines up across neighboring shapes", () => {
    const left = [0, 0.3, 5, 0.3, 5, 9.7, 0, 9.7, 0, 0.3];
    const right = [5, 1.1, 10, 1.1, 10, 9.2, 5, 9.2, 5, 1.1];
    const leftLats = new Set(hatchSegments([left], 2).map((line) => line.lat));
    for (const line of hatchSegments([right], 2)) expect(leftLats.has(line.lat)).toBe(true);
  });
});
