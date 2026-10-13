import { describe, expect, it } from "vitest";
import { Camera } from "../src/render/Camera.js";

describe("Camera", () => {
  it("maps the camera center to the screen center", () => {
    const camera = new Camera();
    camera.setView({ worldWidth: 1000, worldHeight: 500 });
    camera.centerX = 100;
    camera.centerY = 50;
    camera.zoom = 2;
    const point = camera.toScreen(100, 50);
    expect(point.x).toBeCloseTo(500);
    expect(point.y).toBeCloseTo(250);
  });

  it("wraps around the torus so the nearest copy of a point is shown", () => {
    const camera = new Camera();
    camera.setView({ worldWidth: 1000, worldHeight: 500 });
    camera.centerX = 990;
    camera.centerY = 250;
    // x = 10 is 20 units to the right of the camera center through the seam.
    expect(camera.toScreen(10, 250).x).toBeCloseTo(520);
  });

  it("inverts toScreen with toWorld", () => {
    const camera = new Camera();
    camera.setView({ worldWidth: 1000, worldHeight: 500 });
    camera.centerX = 300;
    camera.centerY = 400;
    camera.zoom = 1.7;
    const screen = camera.toScreen(420, 330);
    const world = camera.toWorld(screen.x, screen.y);
    expect(world.x).toBeCloseTo(420);
    expect(world.y).toBeCloseTo(330);
  });

  it("zooms about a screen point, keeping it fixed", () => {
    const camera = new Camera();
    camera.setView({ worldWidth: 1000, worldHeight: 500 });
    const before = camera.toWorld(800, 100);
    camera.zoomAbout(1.5, 800, 100);
    const after = camera.toWorld(800, 100);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("never zooms out past one copy of the world", () => {
    const camera = new Camera();
    camera.setView({ worldWidth: 1000, worldHeight: 500 });
    camera.zoomAbout(0.2, 500, 250);
    expect(camera.zoom).toBe(1);
  });
});
