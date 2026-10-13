import { describe, expect, it } from "vitest";
import { centreOf, childIndexAt, layoutBiomorphs } from "../src/render/layout.js";

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

  it("puts the parent in the centre and the children around it", () => {
    const layout = layoutBiomorphs(WIDTH, HEIGHT, 130, 170);
    const parentCentre = centreOf(layout.parent);
    expect(parentCentre.x).toBeCloseTo(WIDTH / 2, 6);
    // The eight children surround the parent.
    for (const child of layout.children) {
      const centre = centreOf(child);
      expect(centre.x === parentCentre.x && centre.y === parentCentre.y).toBe(false);
    }
    const childCentres = layout.children.map(centreOf);
    expect(childCentres.some((centre) => centre.y < parentCentre.y)).toBe(true);
    expect(childCentres.some((centre) => centre.y > parentCentre.y)).toBe(true);
    expect(childCentres.some((centre) => centre.x < parentCentre.x)).toBe(true);
    expect(childCentres.some((centre) => centre.x > parentCentre.x)).toBe(true);
  });
});

describe("childIndexAt", () => {
  it("identifies the parent and each child", () => {
    const layout = layoutBiomorphs(WIDTH, HEIGHT, 130, 170);
    const parent = centreOf(layout.parent);
    expect(childIndexAt(layout, parent.x, parent.y)).toBe(-1);
    layout.children.forEach((rect, index) => {
      const centre = centreOf(rect);
      expect(childIndexAt(layout, centre.x, centre.y)).toBe(index);
    });
  });

  it("returns null for the gaps between cells", () => {
    const layout = layoutBiomorphs(WIDTH, HEIGHT, 130, 170);
    expect(childIndexAt(layout, 1, 500)).toBeNull();
  });
});
