import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { TerrainRenderer, worldWidthFor, type TerrainStyle } from "../src/render/TerrainRenderer.js";
import { projectPoint, type ProjectionSettings } from "../src/render/terrainProjector.js";

const PROJECTION: ProjectionSettings = {
  centreX: 800,
  horizonY: 340,
  focalLength: 900,
  cameraHeight: 160,
  nearDepth: 240,
};

function rows(live: boolean): Uint8Array[] {
  return [0, 1, 2].map((index) => {
    const row = new Uint8Array(4);
    if (live || index === 1) row.fill(1);
    return row;
  });
}

const STYLE: TerrainStyle = {
  worldWidth: 400,
  ridgeHeight: 30,
  rowSpacing: 26,
  nearDepth: 240,
  bandCount: 3,
  showWalls: true,
};

describe("worldWidthFor", () => {
  it("makes the nearest row span the whole screen", () => {
    const width = worldWidthFor(PROJECTION, 1600, PROJECTION.nearDepth);
    const edge = projectPoint(width / 2, 0, PROJECTION.nearDepth, PROJECTION);
    expect(edge.x).toBeCloseTo(1600, 6);
  });
});

describe("TerrainRenderer", () => {
  it("draws one connected segment per gap between cells on every ridgeline", () => {
    const renderer = new TerrainRenderer();
    const displayList = new DisplayList();
    const segmentCount = renderer.draw(displayList, rows(true), PROJECTION, { ...STYLE, showWalls: false });
    // 3 rows x (4 - 1) segments, with no walls.
    expect(segmentCount).toBe(9);
    expect(displayList.segmentCount).toBe(9);
  });

  it("adds wall segments only where a cell is raised", () => {
    const renderer = new TerrainRenderer();
    const withWalls = renderer.draw(new DisplayList(), rows(false), PROJECTION, STYLE);
    const withoutWalls = renderer.draw(new DisplayList(), rows(false), PROJECTION, { ...STYLE, showWalls: false });
    expect(withWalls).toBeGreaterThan(withoutWalls);
  });

  it("draws nothing for an empty history and reuses its buffers across frames", () => {
    const renderer = new TerrainRenderer();
    expect(renderer.draw(new DisplayList(), [], PROJECTION, STYLE)).toBe(0);
    const first = renderer.draw(new DisplayList(), rows(true), PROJECTION, STYLE);
    const second = renderer.draw(new DisplayList(), rows(true), PROJECTION, STYLE);
    expect(second).toBe(first);
  });
});
