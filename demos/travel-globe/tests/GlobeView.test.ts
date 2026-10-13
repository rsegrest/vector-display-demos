import { describe, expect, it } from "vitest";
import { GlobeView } from "../src/geo/GlobeView.js";

function view() {
  const globe = new GlobeView();
  globe.setScreen({ centerX: 500, centerY: 400, radius: 300 });
  return globe;
}

describe("GlobeView", () => {
  it("puts the view center in the middle of the screen, facing the viewer", () => {
    const globe = view();
    globe.centerLng = 20;
    globe.centerLat = 10;
    const point = globe.project(20, 10);
    expect(point.x).toBeCloseTo(500);
    expect(point.y).toBeCloseTo(400);
    expect(point.depth).toBeCloseTo(1);
  });

  it("puts north up and east to the right", () => {
    const globe = view();
    expect(globe.project(0, 30).y).toBeLessThan(400);
    expect(globe.project(30, 0).x).toBeGreaterThan(500);
  });

  it("marks the far side as hidden and the limb at depth zero", () => {
    const globe = view();
    globe.centerLat = 0;
    expect(globe.project(180, 0).depth).toBeCloseTo(-1);
    expect(globe.project(90, 0).depth).toBeCloseTo(0);
    expect(globe.project(90, 0).x).toBeCloseTo(800);
  });

  it("scales with zoom", () => {
    const globe = view();
    globe.zoom = 2;
    expect(globe.project(30, 0).x - 500).toBeCloseTo(2 * 300 * Math.sin(Math.PI / 6));
  });

  it("inverts projection for points on the visible disk", () => {
    const globe = view();
    globe.centerLng = -80;
    globe.centerLat = 25;
    globe.zoom = 1.7;
    const screen = globe.project(-72, 18);
    const back = globe.unproject(screen.x, screen.y)!;
    expect(back.lng).toBeCloseTo(-72, 6);
    expect(back.lat).toBeCloseTo(18, 6);
    expect(globe.unproject(500 + 300 * 1.7 + 5, 400)).toBeNull();
  });
});
