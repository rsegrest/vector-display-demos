import { describe, expect, it } from "vitest";
import { buildBiomorph, describeGenome, rawSegments } from "../src/render/biomorph.js";

// depth d draws 2^(d+1) - 1 segments: one at the root, two at each next level.
function expectedSegments(depth: number): number {
  return 2 ** (depth + 1) - 1;
}

describe("rawSegments", () => {
  it("draws the full binary tree for the depth gene", () => {
    expect(rawSegments([1, 1, 1, 1, 1, 1, 1, 1, 1]).length / 4).toBe(expectedSegments(1));
    expect(rawSegments([1, 1, 1, 1, 1, 1, 1, 1, 4]).length / 4).toBe(expectedSegments(4));
    expect(rawSegments([1, 1, 1, 1, 1, 1, 1, 1, 8]).length / 4).toBe(expectedSegments(8));
  });

  it("starts at the origin and is deterministic", () => {
    const first = Array.from(rawSegments([0, 1, 2, 3, 4, 5, 6, 7, 5]));
    const second = Array.from(rawSegments([0, 1, 2, 3, 4, 5, 6, 7, 5]));
    expect(first[0]).toBe(0);
    expect(first[1]).toBe(0);
    expect(first).toEqual(second);
  });

  it("is bilaterally symmetric about the starting direction", () => {
    // The two halves of the first fork start at the same point and later diverge,
    // but the very first two child segments should be mirror images in x.
    const segments = rawSegments([0, 1, 2, 3, 4, 5, 6, 7, 2]);
    // Segment 0 is the trunk; 1 and 2 are the two first children.
    const childOneStartX = segments[1 * 4];
    const childTwoStartX = segments[2 * 4];
    expect(childOneStartX).toBeCloseTo(childTwoStartX, 6);
    const childOneEndX = segments[1 * 4 + 2];
    const childTwoEndX = segments[2 * 4 + 2];
    expect(childOneEndX).toBeCloseTo(-childTwoEndX, 6);
  });
});

describe("buildBiomorph", () => {
  it("normalises every creature into the unit box", () => {
    const genome = [3, -7, 5, 2, -4, 6, -2, 8, 5];
    const biomorph = buildBiomorph(genome);
    const coordinates = biomorph.shape.segmentCoordinates;
    for (let index = 0; index < coordinates.length; index += 2) {
      expect(coordinates[index]).toBeGreaterThanOrEqual(-0.5001);
      expect(coordinates[index]).toBeLessThanOrEqual(0.5001);
      expect(coordinates[index + 1]).toBeGreaterThanOrEqual(-0.5001);
      expect(coordinates[index + 1]).toBeLessThanOrEqual(0.5001);
    }
  });

  it("fills the unit box on its longest side", () => {
    const biomorph = buildBiomorph([3, -7, 5, 2, -4, 6, -2, 8, 5]);
    expect(Math.max(biomorph.width, biomorph.height)).toBeCloseTo(1, 5);
  });

  it("reports the segment count and survives a depth-8 genome", () => {
    const biomorph = buildBiomorph([0, 0, 0, 0, 0, 0, 0, 0, 8]);
    expect(biomorph.segmentCount).toBe(expectedSegments(8));
  });
});

describe("describeGenome", () => {
  it("lists the eight direction genes and the depth", () => {
    expect(describeGenome([1, 2, 3, 4, 5, 6, 7, 8, 6])).toBe("1 2 3 4 5 6 7 8   DEPTH 6");
  });
});
