import { describe, expect, it } from "vitest";
import { coinKeyFor, heldKeys, keyEdges, profileFor } from "../src/vr/controllerKeys.js";
import { anchorAt, lookAt, multiply, panelFor, panelOpacity, perspective, rayOfPose, rayOnScreen, ROOM_EYE_HEIGHT, screenFor, transformRay } from "../src/vr/geometry.js";

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
    expect(coinKeyFor("starwars")).toBe("c");
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

describe("the controls panel under the screen", () => {
  const screen = screenFor(16 / 9, 3.6);
  const eye: [number, number, number] = [0, 1.6, 0];
  const lookingAt = (y: number): [number, number, number] => [0, y - eye[1], screen.centre[2] - eye[2]];

  it("stays hidden while the gaze is on the screen above its bottom 15%", () => {
    expect(panelOpacity(eye, lookingAt(screen.centre[1]), screen)).toBe(0);
    const bottom = screen.centre[1] - screen.height / 2;
    expect(panelOpacity(eye, lookingAt(bottom + 0.2 * screen.height), screen)).toBe(0);
  });

  it("fades in below that, and is fully shown when the gaze reaches it", () => {
    const bottom = screen.centre[1] - screen.height / 2;
    const between = panelOpacity(eye, lookingAt(bottom), screen);
    expect(between).toBeGreaterThan(0);
    expect(between).toBeLessThan(1);
    expect(panelOpacity(eye, lookingAt(panelFor(screen).centre[1]), screen)).toBe(1);
    expect(panelOpacity(eye, lookingAt(-1), screen)).toBe(1);
  });
});

describe("recentring the room on the head", () => {
  it("puts the room's eye on a seated head, facing where it faces", () => {
    // A head 1.1 m up, turned 90 degrees to the left (facing -x), at x 0.3.
    const head = Float32Array.from([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0.3, 1.1, 0, 1]);
    const { toWorld, toRoom } = anchorAt(head);
    const eye = transformRay(toWorld, [0, ROOM_EYE_HEIGHT, 0], [0, 0, -1]);
    [0.3, 1.1, 0].forEach((v, i) => expect(eye.origin[i]).toBeCloseTo(v));
    [-1, 0, 0].forEach((v, i) => expect(eye.direction[i]).toBeCloseTo(v));
    const back = transformRay(toRoom, eye.origin, eye.direction);
    [0, ROOM_EYE_HEIGHT, 0].forEach((v, i) => expect(back.origin[i]).toBeCloseTo(v));
    [0, 0, -1].forEach((v, i) => expect(back.direction[i]).toBeCloseTo(v));
  });
});


describe("the space backdrop", () => {
  it("has stars all round, a nebula of contour lines, and a solar system, all far behind the playfield", async () => {
    const { spaceBackdrop, STAR_COUNT } = await import("../src/vr/backdrop.js");
    const space = spaceBackdrop();
    const lines = space.positions.length / 6;
    expect(space.colours.length / 4).toBe(lines);
    expect(lines).toBeGreaterThan(STAR_COUNT + 500); // stars, plus the nebula's and the system's lines
    let nearest = Infinity;
    let behind = 0;
    for (let i = 0; i < space.positions.length; i += 3) {
      nearest = Math.min(nearest, Math.hypot(space.positions[i], space.positions[i + 1], space.positions[i + 2]));
      if (space.positions[i + 2] > 0) behind += 1;
    }
    expect(nearest).toBeGreaterThan(30);
    expect(behind).toBeGreaterThan(0); // stars all round, not only ahead
    for (let i = 3; i < space.colours.length; i += 4) expect(space.colours[i]).toBeLessThan(0.7); // dim
    expect(spaceBackdrop().positions).toEqual(space.positions); // the same every time
  });
});

describe("the backdrop's layout", () => {
  it("keeps the solar system clear of the nebula", async () => {
    const { NEBULA, SOLAR_SYSTEM } = await import("../src/vr/backdrop.js");
    // The system reaches about 15 degrees from its center (its widest orbit, 13 m at 55 m).
    expect(SOLAR_SYSTEM.azimuth - 15).toBeGreaterThan(NEBULA.azimuthTo);
  });
});
