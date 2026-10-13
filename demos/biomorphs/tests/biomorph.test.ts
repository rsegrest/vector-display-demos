import { describe, expect, it } from "vitest";
import { DynamicGeometry } from "@vector-demos/demo-kit";
import { addBiomorph, blendGenomes, createSegmentBuffer, describeGenome, growSegments, levelsForBlend, rawSegments } from "../src/render/biomorph.js";

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

describe("growSegments", () => {
  it("draws Dawkins' tree exactly when the depth is a whole number", () => {
    const genome = [3, -7, 5, 2, -4, 6, -2, 8, 5];
    const out = createSegmentBuffer();
    expect(growSegments(genome, 5, out)).toBe(expectedSegments(5));
    expect(Array.from(out.subarray(0, expectedSegments(5) * 4))).toEqual(Array.from(rawSegments(genome)));
  });

  it("folds extra fork levels into the tips, so a shallower creature can be drawn as a deeper one", () => {
    const genome = [1, 2, -1, 3, 1, -2, 2, 1, 3];
    const out = createSegmentBuffer();
    const count = growSegments(genome, 5, out);
    expect(count).toBe(expectedSegments(5));
    const lengths = (segments: Float32Array, segmentCount: number): number[] => {
      const result: number[] = [];
      for (let index = 0; index < segmentCount; index++) {
        result.push(Math.hypot(segments[index * 4 + 2] - segments[index * 4], segments[index * 4 + 3] - segments[index * 4 + 1]));
      }
      return result.filter((length) => length > 0).sort((a, b) => a - b);
    };
    // The same set of visible branches, plus twigs of no length at all.
    const plain = rawSegments(genome);
    expect(lengths(out, count)).toEqual(lengths(plain, plain.length / 4));
  });
});

describe("blendGenomes", () => {
  it("starts at one creature, ends at the other, and passes evenly between", () => {
    const from = [1, 2, 3, 4, 5, 6, 7, 8, 4];
    const to = [3, 2, 1, 4, 5, 6, 7, 8, 6];
    expect(blendGenomes(from, to, 0)).toEqual(from);
    expect(blendGenomes(from, to, 1)).toEqual(to);
    expect(blendGenomes(from, to, 0.5)).toEqual([2, 2, 2, 4, 5, 6, 7, 8, 5]);
  });

  it("moves every branch end smoothly, with no jump, even as the depth changes", () => {
    const from = [1, -3, 1, -1, 2, 2, 2, 3, 5];
    const to = [1, -3, 1, -1, 2, 2, 2, 3, 6];
    const levels = levelsForBlend(from, to);
    expect(levels).toBe(6);
    const frame = (amount: number): number[] => {
      const out = createSegmentBuffer();
      const count = growSegments(blendGenomes(from, to, amount), levels, out);
      return Array.from(out.subarray(0, count * 4));
    };
    const steps = 50;
    let previous = frame(0);
    let largestMove = 0;
    for (let step = 1; step <= steps; step++) {
      const current = frame(step / steps);
      for (let index = 0; index < current.length; index++) largestMove = Math.max(largestMove, Math.abs(current[index] - previous[index]));
      previous = current;
    }
    // The whole change is a few dozen units; no single fiftieth of it should be large.
    expect(largestMove).toBeLessThan(1.5);
    expect(frame(1).slice(0, expectedSegments(6) * 4)).toEqual(Array.from(rawSegments(to)));
  });
});

describe("addBiomorph", () => {
  function placed(genome: number[], centreX: number, centreY: number, size: number): Float32Array {
    const out = createSegmentBuffer();
    const count = growSegments(genome, genome[8], out);
    const geometry = new DynamicGeometry();
    addBiomorph(geometry, out, count, centreX, centreY, size);
    expect(geometry.segmentCount).toBe(count);
    return geometry.segmentCoordinates.subarray(0, count * 4);
  }

  it("fits every creature inside its box, filling the longest side", () => {
    const coordinates = placed([3, -7, 5, 2, -4, 6, -2, 8, 5], 400, 300, 200);
    let minimumX = Infinity;
    let maximumX = -Infinity;
    let minimumY = Infinity;
    let maximumY = -Infinity;
    for (let index = 0; index < coordinates.length; index += 2) {
      minimumX = Math.min(minimumX, coordinates[index]);
      maximumX = Math.max(maximumX, coordinates[index]);
      minimumY = Math.min(minimumY, coordinates[index + 1]);
      maximumY = Math.max(maximumY, coordinates[index + 1]);
    }
    expect(minimumX).toBeGreaterThanOrEqual(299.99);
    expect(maximumX).toBeLessThanOrEqual(500.01);
    expect(minimumY).toBeGreaterThanOrEqual(199.99);
    expect(maximumY).toBeLessThanOrEqual(400.01);
    expect(Math.max(maximumX - minimumX, maximumY - minimumY)).toBeCloseTo(200, 3);
    expect((minimumX + maximumX) / 2).toBeCloseTo(400, 3);
    expect((minimumY + maximumY) / 2).toBeCloseTo(300, 3);
  });

  it("survives a creature with no size at all", () => {
    const coordinates = placed([0, 0, 0, 0, 0, 0, 0, 0, 8], 50, 60, 100);
    for (const value of coordinates) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("describeGenome", () => {
  it("lists the eight direction genes and the depth", () => {
    expect(describeGenome([1, 2, 3, 4, 5, 6, 7, 8, 6])).toBe("1 2 3 4 5 6 7 8   DEPTH 6");
  });
});
