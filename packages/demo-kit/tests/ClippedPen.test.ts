import { describe, expect, it } from "vitest";
import { NO_NEIGHBOR_SEGMENT } from "@vector-display/core";
import { ClippedPen } from "../src/ClippedPen.js";
import { DynamicGeometry } from "../src/DynamicGeometry.js";

function square(pen: ClippedPen, size: number) {
  pen.moveTo(0, 0);
  pen.lineTo(size, 0);
  pen.lineTo(size, size);
  pen.lineTo(0, size);
  pen.closePath();
}

describe("ClippedPen", () => {
  it("draws an unclipped closed shape as one closed, linked path", () => {
    const geometry = new DynamicGeometry();
    const pen = new ClippedPen();
    pen.begin(geometry);
    square(pen, 10);
    expect(geometry.segmentCount).toBe(4);
    for (let i = 0; i < 8; i++) expect(geometry.segmentNeighbors[i]).not.toBe(NO_NEIGHBOR_SEGMENT);
  });

  it("clips to an inside rectangle", () => {
    const geometry = new DynamicGeometry();
    const pen = new ClippedPen();
    pen.begin(geometry, { inside: { left: 0, top: 0, right: 5, bottom: 20 } });
    square(pen, 10);
    const xs: number[] = [];
    for (let i = 0; i < geometry.segmentCount * 4; i += 2) xs.push(geometry.segmentCoordinates[i]);
    expect(Math.max(...xs)).toBeCloseTo(5);
    expect(geometry.segmentCount).toBe(3);
  });

  it("leaves a hole where an outside rectangle covers the shape", () => {
    const geometry = new DynamicGeometry();
    const pen = new ClippedPen();
    pen.begin(geometry, { outside: [{ left: 4, top: -1, right: 6, bottom: 1 }] });
    pen.moveTo(0, 0);
    pen.lineTo(10, 0);
    expect(geometry.segmentCount).toBe(2);
    expect(geometry.segmentCoordinates[2]).toBeCloseTo(4);
    expect(geometry.segmentCoordinates[4]).toBeCloseTo(6);
  });
});

describe("ClippedPen zero-length steps", () => {
  it("skips them instead of drawing a dot", () => {
    const geometry = new DynamicGeometry();
    const pen = new ClippedPen();
    pen.begin(geometry);
    pen.moveTo(3, 3);
    pen.lineTo(3, 3);
    expect(geometry.segmentCount).toBe(0);
    pen.lineTo(5, 3);
    expect(geometry.segmentCount).toBe(1);
  });
});
