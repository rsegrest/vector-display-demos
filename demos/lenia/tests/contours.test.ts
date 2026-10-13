import { describe, expect, it } from "vitest";
import { NO_NEIGHBOR_SEGMENT } from "@vector-display/core";
import { DynamicGeometry } from "@vector-demos/demo-kit";
import { ContourTracer } from "../src/render/contours.js";

function circleField(width: number, height: number, centerX: number, centerY: number, radius: number) {
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      field[y * width + x] = Math.max(0, 1 - Math.hypot(x - centerX, y - centerY) / radius);
    }
  }
  return field;
}

const identity = { offsetX: 0, offsetY: 0, scale: 1 };

describe("ContourTracer", () => {
  it("traces a circle as one closed, fully linked loop of about the right length", () => {
    const field = circleField(40, 30, 20, 15, 10);
    const geometry = new DynamicGeometry();
    const tracer = new ContourTracer(40, 30);
    tracer.trace(field, 0.5, geometry, identity);
    let length = 0;
    for (let s = 0; s < geometry.segmentCount; s++) {
      const c = geometry.segmentCoordinates;
      length += Math.hypot(c[s * 4 + 2] - c[s * 4], c[s * 4 + 3] - c[s * 4 + 1]);
      expect(geometry.segmentNeighbors[s * 2]).not.toBe(NO_NEIGHBOR_SEGMENT);
      expect(geometry.segmentNeighbors[s * 2 + 1]).not.toBe(NO_NEIGHBOR_SEGMENT);
    }
    // The 0.5 level of a cone of radius 10 is a circle of radius 5.
    expect(length).toBeGreaterThan(2 * Math.PI * 5 * 0.95);
    expect(length).toBeLessThan(2 * Math.PI * 5 * 1.05);
  });

  it("chains consecutive segments end to start", () => {
    const field = circleField(40, 30, 20, 15, 10);
    const geometry = new DynamicGeometry();
    new ContourTracer(40, 30).trace(field, 0.3, geometry, identity);
    const c = geometry.segmentCoordinates;
    for (let s = 0; s < geometry.segmentCount; s++) {
      const next = geometry.segmentNeighbors[s * 2 + 1];
      expect(c[next * 4]).toBeCloseTo(c[s * 4 + 2], 5);
      expect(c[next * 4 + 1]).toBeCloseTo(c[s * 4 + 3], 5);
    }
  });

  it("leaves a shape cut by the grid border as an open chain", () => {
    const field = circleField(40, 30, 0, 15, 10);
    const geometry = new DynamicGeometry();
    new ContourTracer(40, 30).trace(field, 0.5, geometry, identity);
    expect(geometry.segmentCount).toBeGreaterThan(0);
    let openEnds = 0;
    for (let s = 0; s < geometry.segmentCount * 2; s++) {
      if (geometry.segmentNeighbors[s] === NO_NEIGHBOR_SEGMENT) openEnds++;
    }
    expect(openEnds).toBe(2);
  });

  it("draws nothing for a flat field and applies the screen transform", () => {
    const geometry = new DynamicGeometry();
    const tracer = new ContourTracer(10, 10);
    tracer.trace(new Float32Array(100), 0.5, geometry, identity);
    expect(geometry.segmentCount).toBe(0);
    tracer.trace(circleField(10, 10, 5, 5, 4), 0.5, geometry, { offsetX: 100, offsetY: 50, scale: 10 });
    const xs: number[] = [];
    for (let s = 0; s < geometry.segmentCount; s++) xs.push(geometry.segmentCoordinates[s * 4]);
    expect(Math.min(...xs)).toBeGreaterThan(100 + 10 * 2.5);
    expect(Math.max(...xs)).toBeLessThan(100 + 10 * 7.5);
  });
});
