import { describe, expect, it } from "vitest";
import { projectPoint, type ProjectionSettings } from "../src/render/terrainProjector.js";

const SETTINGS: ProjectionSettings = {
  centreX: 800,
  horizonY: 340,
  focalLength: 900,
  cameraHeight: 160,
  nearDepth: 240,
};

describe("projectPoint", () => {
  it("sends far-away points to the vanishing point", () => {
    const far = projectPoint(500, 0, 1e9, SETTINGS);
    expect(far.x).toBeCloseTo(SETTINGS.centreX, 3);
    expect(far.y).toBeCloseTo(SETTINGS.horizonY, 3);
  });

  it("places the ground plane below the horizon and the nearest row lowest", () => {
    const near = projectPoint(0, 0, SETTINGS.nearDepth, SETTINGS);
    const far = projectPoint(0, 0, SETTINGS.nearDepth * 4, SETTINGS);
    expect(near.y).toBeGreaterThan(SETTINGS.horizonY);
    expect(near.y).toBeCloseTo(SETTINGS.horizonY + (SETTINGS.cameraHeight * SETTINGS.focalLength) / SETTINGS.nearDepth, 3);
    expect(far.y).toBeLessThan(near.y);
    expect(far.y).toBeGreaterThan(SETTINGS.horizonY);
  });

  it("draws higher ground higher on the screen", () => {
    const ground = projectPoint(0, 0, SETTINGS.nearDepth, SETTINGS);
    const ridge = projectPoint(0, 40, SETTINGS.nearDepth, SETTINGS);
    expect(ridge.y).toBeLessThan(ground.y);
  });

  it("moves points right for increasing lateral position", () => {
    const left = projectPoint(-100, 0, SETTINGS.nearDepth, SETTINGS);
    const right = projectPoint(100, 0, SETTINGS.nearDepth, SETTINGS);
    expect(left.x).toBeLessThan(SETTINGS.centreX);
    expect(right.x).toBeGreaterThan(SETTINGS.centreX);
    expect(SETTINGS.centreX - left.x).toBeCloseTo(right.x - SETTINGS.centreX, 6);
  });

  it("compresses distant rows toward the centre", () => {
    const near = projectPoint(100, 0, SETTINGS.nearDepth, SETTINGS);
    const far = projectPoint(100, 0, SETTINGS.nearDepth * 4, SETTINGS);
    expect(far.x - SETTINGS.centreX).toBeLessThan(near.x - SETTINGS.centreX);
  });

  it("clamps depths nearer than the near plane", () => {
    const atNear = projectPoint(0, 0, SETTINGS.nearDepth, SETTINGS);
    const behind = projectPoint(0, 0, -100, SETTINGS);
    expect(behind.y).toBeCloseTo(atNear.y, 6);
    expect(Number.isFinite(behind.x)).toBe(true);
    expect(Number.isFinite(behind.y)).toBe(true);
  });
});
