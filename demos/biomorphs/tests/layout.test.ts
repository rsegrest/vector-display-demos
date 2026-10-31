import { describe, expect, it } from "vitest";
import { centerOf, childIndexAt, layoutBiomorphs } from "../src/render/layout.js";

const WIDTH = 1600;
const HEIGHT = 1000;

describe("layoutBiomorphs", () => {
  it("makes nine equal square cells", () => {
    const layout = layoutBiomorphs(WIDTH, HEIGHT, 130, 170);
    expect(layout.parent.width).toBeCloseTo(layout.cellSize, 6);
    expect(layout.parent.height).toBeCloseTo(layout.cellSize, 6);
    expect(layout.children).toHaveLength(8);
    for (const child of layout.children) {
      expect(child.width).toBeCloseTo(layout.cellSize, 6);
      expect(child.height).toBeCloseTo(layout.cellSize, 6);
    }
  });

  it("keeps the whole grid on screen", () => {
    const layout = layoutBiomorphs(WIDTH, HEIGHT, 130, 170);
    const rects = [layout.parent, ...layout.children];
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(WIDTH);
      expect(rect.y + rect.height).toBeLessThanOrEqual(HEIGHT);
    }
  });

  it("puts the parent in the center and the children around it", () => {
    const layout = layoutBiomorphs(WIDTH, HEIGHT, 130, 170);
    const parentCenter = centerOf(layout.parent);
    expect(parentCenter.x).toBeCloseTo(WIDTH / 2, 6);
    // The eight children surround the parent.
    for (const child of layout.children) {
      const center = centerOf(child);
      expect(center.x === parentCenter.x && center.y === parentCenter.y).toBe(false);
    }
    const childCenters = layout.children.map(centerOf);
    expect(childCenters.some((center) => center.y < parentCenter.y)).toBe(true);
    expect(childCenters.some((center) => center.y > parentCenter.y)).toBe(true);
    expect(childCenters.some((center) => center.x < parentCenter.x)).toBe(true);
    expect(childCenters.some((center) => center.x > parentCenter.x)).toBe(true);
  });
});

describe("childIndexAt", () => {
  it("identifies the parent and each child", () => {
    const layout = layoutBiomorphs(WIDTH, HEIGHT, 130, 170);
    const parent = centerOf(layout.parent);
    expect(childIndexAt(layout, parent.x, parent.y)).toBe(-1);
    layout.children.forEach((rect, index) => {
      const center = centerOf(rect);
      expect(childIndexAt(layout, center.x, center.y)).toBe(index);
    });
  });

  it("returns null for the gaps between cells", () => {
    const layout = layoutBiomorphs(WIDTH, HEIGHT, 130, 170);
    expect(childIndexAt(layout, 1, 500)).toBeNull();
  });
});
