import { describe, expect, it } from "vitest";
import { DisplayList, NO_NEIGHBOR_SEGMENT, SCREEN_SPACE_PLACEMENT } from "@vector-display/core";
import { DynamicGeometry } from "../src/DynamicGeometry.js";

describe("DynamicGeometry", () => {
  it("collects unconnected segments and grows past its initial capacity", () => {
    const geometry = new DynamicGeometry(2);
    for (let index = 0; index < 5; index++) geometry.addSegment(index, 0, index, 1);
    expect(geometry.segmentCount).toBe(5);
    expect(Array.from(geometry.segmentCoordinates.subarray(16, 20))).toEqual([4, 0, 4, 1]);
    expect(Array.from(geometry.segmentNeighbors.subarray(0, 10)).every((n) => n === NO_NEIGHBOR_SEGMENT)).toBe(true);
  });

  it("clears without reallocating and is accepted by a DisplayList", () => {
    const geometry = new DynamicGeometry(4);
    geometry.addSegment(1, 2, 3, 4);
    const buffer = geometry.segmentCoordinates;
    geometry.clear();
    geometry.addSegment(5, 6, 7, 8);
    expect(geometry.segmentCoordinates).toBe(buffer);

    const displayList = new DisplayList();
    displayList.addShape(geometry, SCREEN_SPACE_PLACEMENT);
    expect(displayList.segmentCount).toBe(1);
    expect(Array.from(displayList.getSegmentData().subarray(0, 4))).toEqual([5, 6, 7, 8]);
  });
});

describe("DynamicGeometry paths", () => {
  it("links consecutive lineTo segments as neighbors", () => {
    const geometry = new DynamicGeometry(1);
    geometry.moveTo(0, 0);
    geometry.lineTo(1, 0);
    geometry.lineTo(1, 1);
    geometry.lineTo(0, 1);
    expect(geometry.segmentCount).toBe(3);
    expect(Array.from(geometry.segmentNeighbors.subarray(0, 6))).toEqual([
      NO_NEIGHBOR_SEGMENT, 1,
      0, 2,
      1, NO_NEIGHBOR_SEGMENT,
    ]);
  });

  it("closes a path back to its start and links the ends", () => {
    const geometry = new DynamicGeometry(2);
    geometry.moveTo(0, 0);
    geometry.lineTo(1, 0);
    geometry.lineTo(1, 1);
    geometry.closePath();
    expect(geometry.segmentCount).toBe(3);
    expect(Array.from(geometry.segmentCoordinates.subarray(8, 12))).toEqual([1, 1, 0, 0]);
    expect(geometry.segmentNeighbors[0]).toBe(2);
    expect(geometry.segmentNeighbors[5]).toBe(0);
  });

  it("starts a fresh chain on moveTo and resets neighbors left from earlier frames", () => {
    const geometry = new DynamicGeometry(4);
    geometry.moveTo(0, 0);
    geometry.lineTo(1, 0);
    geometry.lineTo(2, 0);
    geometry.clear();
    geometry.addSegment(0, 0, 1, 1);
    geometry.moveTo(5, 5);
    geometry.lineTo(6, 6);
    expect(Array.from(geometry.segmentNeighbors.subarray(0, 4))).toEqual([
      NO_NEIGHBOR_SEGMENT, NO_NEIGHBOR_SEGMENT,
      NO_NEIGHBOR_SEGMENT, NO_NEIGHBOR_SEGMENT,
    ]);
  });
});
