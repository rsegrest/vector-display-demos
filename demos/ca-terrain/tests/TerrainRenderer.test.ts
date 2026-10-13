import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT } from "@vector-display/core";
import { TerrainRenderer, depthAtScreenBottom, type TerrainStyle } from "../src/render/TerrainRenderer.js";
import { projectPoint, type ProjectionSettings } from "../src/render/terrainProjector.js";

const SCREEN_WIDTH = 1600;
const SCREEN_HEIGHT = 1000;
const CELL_COUNT = 64;

const PROJECTION: ProjectionSettings = {
  centreX: SCREEN_WIDTH / 2,
  horizonY: 240,
  focalLength: 900,
  cameraHeight: 300,
  nearDepth: 1,
};

const STYLE: TerrainStyle = {
  screenWidth: SCREEN_WIDTH,
  cellWidth: 20,
  ridgeHeight: 90,
  rowSpacing: 40,
  firstDepth: 400,
  scroll: 0,
  bandCount: 1,
  hiddenLines: true,
};

interface Segment {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
}

function flatRows(count: number, height = 0): Float32Array[] {
  return Array.from({ length: count }, () => new Float32Array(CELL_COUNT).fill(height));
}

function drawSegments(heights: readonly Float32Array[], style: Partial<TerrainStyle> = {}): Segment[] {
  const displayList = new DisplayList();
  new TerrainRenderer().draw(displayList, heights, PROJECTION, { ...STYLE, ...style });
  const data = displayList.getSegmentData();
  const segments: Segment[] = [];
  for (let index = 0; index < displayList.segmentCount; index++) {
    const offset = index * FLOATS_PER_BEAM_SEGMENT;
    segments.push({ startX: data[offset], startY: data[offset + 1], endX: data[offset + 2], endY: data[offset + 3] });
  }
  return segments;
}

function groundY(depth: number): number {
  return projectPoint(0, 0, depth, PROJECTION).y;
}

describe("depthAtScreenBottom", () => {
  it("is where the ground plane meets the bottom edge", () => {
    const depth = depthAtScreenBottom(PROJECTION, SCREEN_HEIGHT);
    expect(groundY(depth)).toBeCloseTo(SCREEN_HEIGHT, 6);
  });
});

describe("TerrainRenderer", () => {
  it("draws nothing for an empty history and the same thing twice for the same input", () => {
    const renderer = new TerrainRenderer();
    expect(renderer.draw(new DisplayList(), [], PROJECTION, STYLE)).toBe(0);
    const first = renderer.draw(new DisplayList(), flatRows(5), PROJECTION, STYLE);
    const second = renderer.draw(new DisplayList(), flatRows(5), PROJECTION, STYLE);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("puts each generation of flat ground at its own depth", () => {
    const segments = drawSegments(flatRows(3));
    const levels = [...new Set(segments.map((segment) => Math.round(segment.startY * 1000) / 1000))].sort((a, b) => a - b);
    expect(levels).toHaveLength(3);
    // Oldest generation first means nearest first, which is lowest on the screen.
    expect(levels[2]).toBeCloseTo(groundY(400), 2);
    expect(levels[1]).toBeCloseTo(groundY(440), 2);
    expect(levels[0]).toBeCloseTo(groundY(480), 2);
  });

  it("reaches both screen edges on every row, however far away, and never leaves the screen", () => {
    // Far enough that the ring has to repeat to cover the view.
    const rows = flatRows(40);
    const segments = drawSegments(rows);
    const byLevel = new Map<number, Segment[]>();
    for (const segment of segments) {
      const level = Math.round(segment.startY * 100);
      byLevel.set(level, [...(byLevel.get(level) ?? []), segment]);
    }
    expect(byLevel.size).toBe(40);
    for (const row of byLevel.values()) {
      const left = Math.min(...row.map((segment) => segment.startX));
      const right = Math.max(...row.map((segment) => segment.endX));
      expect(left).toBeLessThan(2);
      expect(right).toBeGreaterThan(SCREEN_WIDTH - 2);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(SCREEN_WIDTH);
    }
  });

  it("slides every row toward the camera as scroll grows, meeting the next row's place at 1", () => {
    const resting = drawSegments(flatRows(2), { scroll: 0 });
    const halfway = drawSegments(flatRows(2), { scroll: 0.5 });
    const arrived = drawSegments(flatRows(2), { scroll: 1 });
    const farthest = (segments: Segment[]) => Math.min(...segments.map((segment) => segment.startY));
    expect(farthest(resting)).toBeCloseTo(groundY(440), 2);
    expect(farthest(halfway)).toBeCloseTo(groundY(420), 2);
    expect(farthest(arrived)).toBeCloseTo(groundY(400), 2);
  });

  it("hides ground behind a nearer ridge, and shows it again with hidden lines off", () => {
    // A wall across the whole view in the nearest generation, tall enough to cover
    // the flat ground of every generation behind it.
    const rows = [new Float32Array(CELL_COUNT).fill(1), ...flatRows(6)];
    const style = { ridgeHeight: 250 };
    const hidden = drawSegments(rows, style);
    const shown = drawSegments(rows, { ...style, hiddenLines: false });
    const wallY = projectPoint(0, 250, 400, PROJECTION).y;
    expect(groundY(400 + 6 * 40)).toBeGreaterThan(wallY);
    for (const segment of hidden) expect(segment.startY).toBeCloseTo(wallY, 2);
    expect(shown.length).toBeGreaterThan(hidden.length * 6);
  });

  it("shows a far peak that rises above the ground in front of it", () => {
    const rows = flatRows(4);
    rows[3] = new Float32Array(CELL_COUNT).fill(1);
    const segments = drawSegments(rows, { ridgeHeight: 60 });
    const peakY = projectPoint(0, 60, 400 + 3 * 40, PROJECTION).y;
    expect(segments.some((segment) => Math.abs(segment.startY - peakY) < 0.01)).toBe(true);
  });

  it("cuts a ridgeline where it dips behind nearer ground instead of dropping the whole row", () => {
    // Near wall with a gap in the middle of the view; the far row shows only through the gap.
    const wall = new Float32Array(CELL_COUNT).fill(1);
    const centre = CELL_COUNT / 2;
    for (let cell = centre - 3; cell <= centre + 3; cell++) wall[cell] = 0;
    const segments = drawSegments([wall, ...flatRows(1)], { ridgeHeight: 250 });
    const farY = groundY(440);
    const far = segments.filter((segment) => Math.abs(segment.startY - farY) < 0.01 && Math.abs(segment.endY - farY) < 0.01);
    expect(far.length).toBeGreaterThan(0);
    const left = Math.min(...far.map((segment) => segment.startX));
    const right = Math.max(...far.map((segment) => segment.endX));
    expect(left).toBeGreaterThan(SCREEN_WIDTH / 2 - 200);
    expect(right).toBeLessThan(SCREEN_WIDTH / 2 + 200);
  });
});
