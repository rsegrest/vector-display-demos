import { describe, expect, it } from "vitest";
import { coinKeyFor, heldKeys, keyEdges, profileFor } from "../src/vr/controllerKeys.js";
import { lookAt, multiply, perspective, rayOfPose, rayOnScreen, screenFor } from "../src/vr/geometry.js";

describe("the virtual cabinet's room", () => {
  const screen = screenFor(16 / 10);

  it("puts the screen 2.6 m ahead at eye height, 3.2 m wide at the desktop's shape", () => {
    expect(screen.centre).toEqual([0, 1.5, -2.6]);
    expect(screen.height).toBeCloseTo(2);
  });

  it("finds where a ray meets the picture, 0..1 across and down, and misses outside or behind", () => {
    expect(rayOnScreen([0, 1.5, 0], [0, 0, -1], screen)).toEqual({ x: 0.5, y: 0.5 });
    const corner = rayOnScreen([0, 1.5, 0], [-1.6 / 2.6, 1 / 2.6, -1], screen)!;
    expect(corner.x).toBeCloseTo(0);
    expect(corner.y).toBeCloseTo(0);
    expect(rayOnScreen([0, 1.5, 0], [0, 0, 1], screen)).toBeNull();
    expect(rayOnScreen([0, 1.5, 0], [3, 0, -1], screen)).toBeNull();
  });

  it("takes a controller's ray from its pose: the -z axis from its position", () => {
    const identityAt = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, 1.2, -0.3, 1]);
    const ray = rayOfPose(identityAt);
    [0.2, 1.2, -0.3].forEach((value, i) => expect(ray.origin[i]).toBeCloseTo(value));
    [0, 0, -1].forEach((value, i) => expect(ray.direction[i]).toBeCloseTo(value));
  });

  it("projects the screen's middle to the middle of the preview", () => {
    const mvp = multiply(perspective(Math.PI / 3, 1.6, 0.05, 50), lookAt([0, 1.5, 0], [0, 1.5, -1]));
    const [x, y, , w] = [0, 1, 2, 3].map((row) => mvp[row] * 0 + mvp[4 + row] * 1.5 + mvp[8 + row] * -2.6 + mvp[12 + row]);
    expect(x / w).toBeCloseTo(0);
    expect(y / w).toBeCloseTo(0);
  });
});

describe("the controllers as keys", () => {
  const idle = { pressed: [false, false, false, false, false, false], stick: [0, 0] as [number, number] };

  it("turns the left thumbstick into arrows, with hysteresis, and its buttons into fire, shields, coin and start", () => {
    const left = heldKeys({ ...idle, hand: "left", stick: [-0.6, -0.7] }, new Set());
    expect([...left].sort()).toEqual(["ArrowLeft", "ArrowUp"]);
    expect(heldKeys({ ...idle, hand: "left", stick: [-0.4, 0] }, left).has("ArrowLeft")).toBe(true);
    expect(heldKeys({ ...idle, hand: "left", stick: [-0.4, 0] }, new Set()).has("ArrowLeft")).toBe(false);
    expect([...heldKeys({ hand: "left", pressed: [true, true, false, false, true, true], stick: [0, 0] }, new Set())].sort()).toEqual([" ", "1", "Enter", "Shift"]);
  });

  it("gives the right hand's A and B as Enter and 2, leaving its trigger to the pointer", () => {
    expect([...heldKeys({ hand: "right", pressed: [true, false, false, false, true, true], stick: [0, 0] }, new Set())].sort()).toEqual(["2", "Enter"]);
  });

  it("drops a coin with the key of the game in front (Tempest's is 5)", () => {
    expect(coinKeyFor("tempest")).toBe("5");
    expect(coinKeyFor("asteroids")).toBe("1");
    expect(coinKeyFor(null)).toBe("1");
    expect(heldKeys({ hand: "left", pressed: [false, false, false, false, true], stick: [0, 0] }, new Set(), profileFor("tempest")).has("5")).toBe(true);
  });

  it("drives Battlezone's treads with a thumbstick each: left W/S, right ArrowUp/ArrowDown", () => {
    const treads = profileFor("battlezone");
    expect([...heldKeys({ ...idle, hand: "left", stick: [0.9, -0.8] }, new Set(), treads)]).toEqual(["w"]);
    expect([...heldKeys({ ...idle, hand: "right", stick: [0, 0.8] }, new Set(), treads)]).toEqual(["ArrowDown"]);
    expect(heldKeys({ ...idle, hand: "right", stick: [0, -0.8] }, new Set(), profileFor("asteroids")).size).toBe(0);
  });

  it("reports releases before presses", () => {
    expect(keyEdges(new Set(["ArrowLeft"]), new Set(["ArrowRight"]))).toEqual([
      { key: "ArrowLeft", down: false },
      { key: "ArrowRight", down: true },
    ]);
  });
});
