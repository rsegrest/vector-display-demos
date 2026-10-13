import { describe, expect, it } from "vitest";
import { clipSegmentInside, clipSegmentOutside, type ClipRect } from "../src/clip.js";

const rect: ClipRect = { left: 0, top: 0, right: 10, bottom: 10 };

describe("clipSegmentInside", () => {
  it("keeps a segment that is fully inside", () => {
    expect(clipSegmentInside(1, 1, 9, 9, rect)).toEqual([0, 1]);
  });

  it("returns null for a segment fully outside", () => {
    expect(clipSegmentInside(-5, -5, -1, 20, rect)).toBeNull();
  });

  it("trims a segment that crosses the edges", () => {
    const [start, end] = clipSegmentInside(-10, 5, 20, 5, rect)!;
    expect(-10 + 30 * start).toBeCloseTo(0);
    expect(-10 + 30 * end).toBeCloseTo(10);
  });
});

describe("clipSegmentOutside", () => {
  it("removes the part of a segment inside the rectangle", () => {
    const pieces = clipSegmentOutside(-10, 5, 20, 5, rect);
    expect(pieces).toHaveLength(2);
    expect(-10 + 30 * pieces[0][1]).toBeCloseTo(0);
    expect(-10 + 30 * pieces[1][0]).toBeCloseTo(10);
  });

  it("keeps a segment that misses the rectangle", () => {
    expect(clipSegmentOutside(-5, -5, 20, -1, rect)).toEqual([[0, 1]]);
  });

  it("drops a segment fully inside", () => {
    expect(clipSegmentOutside(2, 2, 8, 8, rect)).toEqual([]);
  });

  it("subtracts several rectangles", () => {
    const second: ClipRect = { left: 20, top: 0, right: 30, bottom: 10 };
    const pieces = clipSegmentOutside(-10, 5, 40, 5, [rect, second]);
    expect(pieces.map(([a, b]) => [-10 + 50 * a, -10 + 50 * b].map((v) => Math.round(v)))).toEqual([[-10, 0], [10, 20], [30, 40]]);
  });
});
