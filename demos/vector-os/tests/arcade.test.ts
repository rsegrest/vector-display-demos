import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT, SCREEN_SPACE_PLACEMENT, Shape } from "@vector-display/core";
import { ARCADE_GAMES, arcadeGameDirectory } from "../arcadeGames.js";
import type { ArcadeCabinet } from "../src/apps/arcade/ArcadeCabinet.js";
import { arcadeLayout, createArcadeApp, wrapControls } from "../src/apps/arcade/arcadeApp.js";
import { FixedStepClock } from "../src/apps/arcade/FixedStepClock.js";
import type { AppEntry, KeyPress } from "../src/apps/OsApp.js";
import { APP_ENTRIES } from "../src/apps/registry.js";
import { HeldKeys } from "../src/HeldKeys.js";
import { VectorOsDemo } from "../src/VectorOsDemo.js";

const FRAME = { width: 1778, height: 1000, seconds: 0 };

const press = (key: string, code: string, repeat = false): KeyPress => ({ key, code, repeat });
const SPACE = press(" ", "Space");
const UP = press("ArrowUp", "ArrowUp");

describe("FixedStepClock", () => {
  it("runs a game's own steps, whatever the rate it is updated at", () => {
    // Asteroids' 62.5 steps a second, updated sixty times a second.
    const asteroids = new FixedStepClock(62.5, 6);
    let steps = 0;
    for (let update = 0; update < 120; update++) steps += asteroids.advance(1 / 60);
    expect(steps).toBe(125);
    // Battlezone's interrupt, 246.09 a second: four steps an update, and a fifth now and then.
    const battlezone = new FixedStepClock(12096000 / 4096 / 12, 50);
    const counts = new Set<number>();
    steps = 0;
    for (let update = 0; update < 60; update++) {
      const due = battlezone.advance(1 / 60);
      counts.add(due);
      steps += due;
    }
    expect(steps).toBe(246);
    expect([...counts].sort()).toEqual([4, 5]);
  });

  it("carries the fraction of a step to the next update", () => {
    const clock = new FixedStepClock(41.666, 6);
    expect(clock.advance(1 / 60)).toBe(0);
    expect(clock.advance(1 / 60)).toBe(1);
  });

  it("comes to whole steps exactly when the rates divide", () => {
    const clock = new FixedStepClock(60, 4);
    for (let update = 0; update < 600; update++) expect(clock.advance(1 / 60)).toBe(1);
  });

  it("makes up only so many steps after a stall, and drops the rest, as the games' pages do", () => {
    const clock = new FixedStepClock(62.5, 6);
    expect(clock.advance(5)).toBe(6);
    expect(clock.advance(1 / 60)).toBe(1);
    expect(clock.advance(-1)).toBe(0);
  });
});

describe("HeldKeys", () => {
  it("remembers which recipient each key went down to, by the key itself rather than what it types", () => {
    const held = new HeldKeys<string>();
    held.press(press("a", "KeyA"), "first", true);
    held.press(SPACE, "second", false);
    expect(held.count).toBe(2);
    // Shift went down meanwhile: the same key comes up as "A".
    expect(held.release(press("A", "KeyA"))).toEqual({ press: press("a", "KeyA"), recipient: "first", used: true });
    expect(held.release(press("A", "KeyA"))).toBeNull();
    expect(held.find(SPACE)?.used).toBe(false);
  });

  it("lets go of every key a recipient holds, leaving the others", () => {
    const held = new HeldKeys<string>();
    held.press(SPACE, "game", true);
    held.press(UP, "game", true);
    held.press(press("t", "KeyT"), "terminal", false);
    expect(held.releaseAll("game").map((key) => key.press.code)).toEqual(["Space", "ArrowUp"]);
    expect(held.count).toBe(1);
    expect(held.releaseAll()).toHaveLength(1);
    expect(held.count).toBe(0);
  });

  it("knows a key with no code by what it types", () => {
    const held = new HeldKeys<string>();
    held.press(press("x", ""), "one", true);
    expect(held.find(press("x", ""))).toBeDefined();
    expect(held.find(press("y", ""))).toBeUndefined();
  });
});

describe("arcadeLayout and wrapControls", () => {
  const screen = { width: 1000, height: 800, aspect: 1.25 };

  it("fits the screen into the window at its own shape, centred above the controls", () => {
    const wide = arcadeLayout(800, 416, screen, 1);
    // 416 less one 16-unit line and an 8-unit margin leaves 392 high, so 490 wide, centred in 800.
    expect(wide.picture).toEqual({ left: 155, top: 0, right: 645, bottom: 392 });
    expect(wide.scaleX).toBeCloseTo(0.49);
    expect(wide.scaleY).toBeCloseTo(0.49);
    expect(wide.controlsTop).toBe(396);
    const tall = arcadeLayout(500, 900, screen, 0);
    expect(tall.picture).toEqual({ left: 0, top: 250, right: 500, bottom: 650 });
  });

  it("stretches the coordinates when the screen is not their shape", () => {
    // Tempest: units almost square, shown on a 3:4 tube.
    const layout = arcadeLayout(300, 400, { width: 571, height: 581, aspect: 0.75 }, 0);
    expect(layout.scaleY / layout.scaleX).toBeCloseTo((571 / 581) / 0.75);
  });

  it("breaks the controls between their groups, never inside one", () => {
    const measure = (line: string) => line.length * 10;
    expect(wrapControls("1 COIN  ENTER START  SPACE FIRE", 200, measure)).toEqual(["1 COIN   ENTER START", "SPACE FIRE"]);
    expect(wrapControls("A VERY LONG GROUP", 50, measure)).toEqual(["A VERY LONG GROUP"]);
  });
});

// A stand-in for a game's src/embed.ts that writes down what it is asked to do.
function fakeCabinet(stepsPerSecond = 246) {
  const record = { steps: 0, advances: 0, downs: [] as string[], ups: [] as string[], audible: [] as boolean[], soundEnabled: 0, disposed: 0, moved: 0, buttons: [] as string[] };
  const cabinet: ArcadeCabinet = {
    screen: { width: 400, height: 300, aspect: 4 / 3 },
    stepsPerSecond,
    mostStepsAtOnce: 50,
    controls: "1 COIN  ENTER START",
    keyDown: (key) => {
      record.downs.push(key.code);
      return key.code !== "KeyQ";
    },
    keyUp: (key) => void record.ups.push(key.code),
    mouseMove: (dx) => void (record.moved += dx),
    mouseButton: (button, down) => void record.buttons.push(`${button}${down ? "down" : "up"}`),
    advance: (steps) => {
      record.steps += steps;
      record.advances++;
    },
    draw: (list) => {
      list.setColor({ red: 1, green: 0, blue: 0 });
      list.addShape(Shape.fromSegmentCoordinates([0, 0, 400, 300]), { ...SCREEN_SPACE_PLACEMENT, intensity: 1 });
    },
    enableSound: () => void record.soundEnabled++,
    setAudible: (audible) => void record.audible.push(audible),
    dispose: () => void record.disposed++,
  };
  return { cabinet, record };
}

// A stand-in for a game steered by where the pointer is (Red Baron's stick): no spinner.
function stickCabinet() {
  const { cabinet, record } = fakeCabinet();
  const points: ({ x: number; y: number } | null)[] = [];
  const { mouseMove: _spinner, ...rest } = cabinet;
  const steered: ArcadeCabinet = { ...rest, pointerAt: (point) => void points.push(point && { ...point }) };
  return { cabinet: steered, record, points };
}

function gameEntry(id: string, cabinet: ArcadeCabinet): AppEntry {
  return { id, title: id.toUpperCase(), kind: "demo", category: "arcade", page: `arcade/${id}`, size: { width: 500, height: 420 }, create: () => createArcadeApp(cabinet) };
}

function toolEntry(id: string, keys: string[]): AppEntry {
  return { id, title: id.toUpperCase(), kind: "tool", category: "utilities", size: { width: 400, height: 300 }, create: () => ({ demo: { update() {}, draw() {} }, worldHeight: null, onKey: (key) => void keys.push(key) }) };
}

async function settle(os: VectorOsDemo, frames = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let frame = 0; frame < frames; frame++) os.update(1 / 60);
}

function createDesk() {
  const first = fakeCabinet();
  const second = fakeCabinet(62.5);
  const typed: string[] = [];
  const os = new VectorOsDemo({ skipBoot: true, entries: [gameEntry("first", first.cabinet), gameEntry("second", second.cabinet), toolEntry("term", typed)], startup: [] });
  os.resize(FRAME.width, FRAME.height);
  return { os, first: first.record, second: second.record, typed };
}

function windowOf(os: VectorOsDemo, title: string) {
  return os.windowManager.windows.find((window) => window.title === title)!;
}

function clickContents(os: VectorOsDemo, title: string): void {
  const { rect } = windowOf(os, title);
  os.pointer("down", rect.x + rect.width / 2, rect.y + rect.height / 2);
  os.pointer("up", rect.x + rect.width / 2, rect.y + rect.height / 2);
}

describe("arcade games in Vector OS", () => {
  it("runs each game at its own rate, in front or behind", async () => {
    const { os, first, second } = createDesk();
    os.launch("first");
    os.launch("second");
    await settle(os, 0);
    // The windows open over 0.28 s, then run for a second.
    for (let frame = 0; frame < 20; frame++) os.update(1 / 60);
    const [firstBefore, secondBefore] = [first.steps, second.steps];
    for (let frame = 0; frame < 60; frame++) os.update(1 / 60);
    expect(first.steps - firstBefore).toBeGreaterThanOrEqual(245);
    expect(first.steps - firstBefore).toBeLessThanOrEqual(247);
    expect(second.steps - secondBefore).toBeGreaterThanOrEqual(62);
    expect(second.steps - secondBefore).toBeLessThanOrEqual(63);
    // Every update reaches the game, step or no step: that is when it updates its sound.
    expect(second.advances).toBeGreaterThanOrEqual(60);
  });

  it("gives held keys to the game in front, and lets go of them when it leaves the front", async () => {
    const { os, first, second } = createDesk();
    os.launch("first");
    os.launch("second");
    await settle(os);
    expect(os.focusedTitle).toBe("SECOND");
    expect(os.keyDown(UP)).toBe(true);
    // Its repeats are not presses, but are still kept from the browser.
    expect(os.keyDown(press("ArrowUp", "ArrowUp", true))).toBe(true);
    expect(second.downs).toEqual(["ArrowUp"]);
    expect(os.heldKeyCount).toBe(1);
    // Clicking the other game while thrusting: the thrust is let go, not left held for ever.
    clickContents(os, "FIRST");
    expect(os.focusedTitle).toBe("FIRST");
    expect(second.ups).toEqual(["ArrowUp"]);
    expect(os.heldKeyCount).toBe(0);
    // The key's real release, when it comes, goes nowhere: it was let go already.
    os.keyUp(UP);
    expect(second.ups).toEqual(["ArrowUp"]);
    expect(first.ups).toEqual([]);
    expect(os.keyDown(SPACE)).toBe(true);
    os.keyUp(SPACE);
    expect(first.downs).toEqual(["Space"]);
    expect(first.ups).toEqual(["Space"]);
    // A key the game does not use is left to the browser.
    expect(os.keyDown(press("q", "KeyQ"))).toBe(false);
  });

  it("lets go of every key when the browser stops sending them", async () => {
    const { os, second } = createDesk();
    os.launch("second");
    await settle(os);
    os.keyDown(SPACE);
    os.keyDown(UP);
    os.releaseKeys();
    expect(second.ups.sort()).toEqual(["ArrowUp", "Space"]);
  });

  it("still types into a program that takes typing, repeats and all", async () => {
    const { os, typed } = createDesk();
    os.launch("term");
    await settle(os);
    expect(os.keyDown(press("a", "KeyA"))).toBe(false);
    os.keyDown(press("a", "KeyA", true));
    os.key("b");
    expect(typed).toEqual(["a", "a", "b"]);
  });

  it("lets the game most recently in front be heard, and only that one", async () => {
    const { os, first, second } = createDesk();
    os.launch("first");
    await settle(os);
    expect(os.audibleTitle).toBe("FIRST");
    expect(first.audible).toEqual([true]);
    os.launch("second");
    await settle(os);
    expect(os.audibleTitle).toBe("SECOND");
    expect(first.audible).toEqual([true, false]);
    expect(second.audible).toEqual([true]);
    // A window that makes no sound leaves the sound where it was.
    os.launch("term");
    await settle(os);
    expect(os.audibleTitle).toBe("SECOND");
    // Closing the game heard silences it at once, and stops it when the window has gone.
    const { rect } = windowOf(os, "SECOND");
    os.pointer("down", rect.x + 15, rect.y + 15);
    os.pointer("up", rect.x + 15, rect.y + 15);
    os.update(1 / 60);
    expect(second.audible).toEqual([true, false]);
    expect(os.audibleTitle).toBeNull();
    await settle(os);
    expect(second.disposed).toBe(1);
    clickContents(os, "FIRST");
    expect(os.audibleTitle).toBe("FIRST");
  });

  it("starts a game's sound only from a key or a click, as browsers require", async () => {
    const { os, second } = createDesk();
    os.launch("second");
    await settle(os);
    expect(second.soundEnabled).toBe(0);
    os.keyDown(press("1", "Digit1"));
    expect(second.soundEnabled).toBe(1);
  });

  it("turns the spinner with the pointer and fires with its button, only in front", async () => {
    const { os, first } = createDesk();
    os.launch("first");
    os.launch("second");
    await settle(os);
    const { rect } = windowOf(os, "FIRST");
    const behind = { x: rect.x + 100, y: rect.y + 100 };
    // FIRST is behind SECOND; where it shows, moving over it turns nothing.
    const visible = os.windowManager.hitTest(rect.x + 5, rect.y + rect.height - 30)?.window.title === "FIRST";
    if (visible) os.pointer("move", rect.x + 5, rect.y + rect.height - 30);
    expect(first.moved).toBe(0);
    // Leaving the front let go of the button, in case it was held; the click presses and releases it.
    expect(first.buttons).toEqual(["0up"]);
    clickContents(os, "FIRST");
    expect(first.buttons).toEqual(["0up", "0down", "0up"]);
    os.pointer("move", behind.x, behind.y);
    const movedBefore = first.moved;
    os.update(1 / 60);
    os.pointer("move", behind.x + 30, behind.y);
    expect(first.moved - movedBefore).toBe(30);
    // Back after a pause (the pointer went elsewhere): the jump is not a turn.
    for (let frame = 0; frame < 30; frame++) os.update(1 / 60);
    os.pointer("move", behind.x - 200, behind.y);
    expect(first.moved - movedBefore).toBe(30);
  });

  it("steers a stick by where the pointer is over the picture, only in front, and centres it when the pointer leaves", async () => {
    const stick = stickCabinet();
    const typed: string[] = [];
    const os = new VectorOsDemo({ skipBoot: true, entries: [gameEntry("stick", stick.cabinet), toolEntry("term", typed)], startup: [] });
    os.resize(FRAME.width, FRAME.height);
    os.launch("stick");
    await settle(os);
    // The picture's place in the window is known once it has been drawn.
    os.draw(new DisplayList(), FRAME);
    const content = os.windowManager.contentRect(windowOf(os, "STICK"));
    const middle = { x: content.x + content.width / 2, y: content.y + (content.height - 24) / 2 };
    os.pointer("move", middle.x, middle.y);
    const over = stick.points.at(-1)!;
    expect(over.x).toBeCloseTo(0.5, 2);
    expect(over.y).toBeGreaterThan(0.3);
    expect(over.y).toBeLessThan(0.7);
    // A click is the game's: the point first, so a click that takes the stick takes it from there, then the button.
    os.pointer("down", middle.x + 50, middle.y);
    os.pointer("up", middle.x + 50, middle.y);
    expect(stick.points.at(-1)!.x).toBeGreaterThan(0.5);
    expect(stick.record.buttons.slice(-2)).toEqual(["0down", "0up"]);
    // Onto the title bar: the pointer has left the contents, and the stick is let go.
    const count = stick.points.length;
    os.pointer("move", content.x + 40, content.y - 10);
    expect(stick.points.slice(count)).toEqual([null]);
    // And off the page.
    os.pointer("move", middle.x, middle.y);
    os.pointer("leave", -1, -1);
    expect(stick.points.at(-1)).toBeNull();
    // Behind another window it is only watched: no steering, and it was let go as it left the front.
    os.pointer("move", middle.x, middle.y);
    os.launch("term");
    await settle(os);
    expect(stick.points.at(-1)).toBeNull();
    const behind = stick.points.length;
    os.pointer("move", content.x + 5, content.y + content.height - 5);
    expect(stick.points.slice(behind).every((point) => point === null)).toBe(true);
  });

  it("draws the game's picture inside its window, with its controls under it", async () => {
    const { os } = createDesk();
    os.launch("first");
    await settle(os);
    const list = new DisplayList();
    os.draw(list, FRAME);
    const content = os.windowManager.contentRect(windowOf(os, "FIRST"));
    const data = list.getSegmentData();
    const red: number[][] = [];
    for (let offset = 0; offset < data.length; offset += FLOATS_PER_BEAM_SEGMENT) {
      if (data[offset + 8] === 1 && data[offset + 9] === 0) red.push([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
    }
    // The game's one diagonal, from corner to corner of its screen fitted into the window.
    expect(red).toHaveLength(1);
    const [x0, y0, x1, y1] = red[0];
    expect(x0).toBeGreaterThanOrEqual(content.x);
    expect(x1).toBeLessThanOrEqual(content.x + content.width);
    expect(y0).toBeGreaterThanOrEqual(content.y);
    expect(y1).toBeLessThan(content.y + content.height - 16);
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo(4 / 3);
  });

  it("opens a game's own page, under arcade/, from the box on its title bar", async () => {
    const { os } = createDesk();
    os.launch("first");
    await settle(os);
    const opened: string[] = [];
    os.onNavigate = (page) => void opened.push(page);
    const { rect } = windowOf(os, "FIRST");
    os.pointer("down", rect.x + rect.width - 15, rect.y + 15);
    expect(opened).toEqual(["arcade/first"]);
  });
});

// The real games, from vector-games next to this repository, when it is there.
const gamesPresent = ARCADE_GAMES.every((game) => existsSync(arcadeGameDirectory(game)));

describe.skipIf(!gamesPresent)("the five games, as the launcher runs them", () => {
  it("lists all five under Arcade", () => {
    expect(APP_ENTRIES.filter((entry) => entry.category === "arcade").map((entry) => entry.id)).toEqual(ARCADE_GAMES);
  });

  for (const id of ARCADE_GAMES) {
    it(`runs ${id}: its attract mode draws, and it takes a coin`, async () => {
      const entry = APP_ENTRIES.find((candidate) => candidate.id === id)!;
      expect(entry.page).toBe(`arcade/${id}`);
      const app = await entry.create({} as never);
      app.setFocused?.(true);
      app.demo.resize?.(500, 400);
      for (let update = 0; update < 120; update++) app.demo.update(1 / 60);
      const list = new DisplayList();
      app.demo.draw(list, { width: 500, height: 400, seconds: 2 });
      expect(list.segmentCount).toBeGreaterThan(20);
      const coin = id === "tempest" ? press("5", "Digit5") : press("1", "Digit1");
      expect(app.onKeyDown?.(coin)).toBe(true);
      app.onKeyUp?.(coin);
      app.dispose?.();
    });
  }

  it("steers Red Baron's stick with the mouse once a click on its picture has handed it over, as its page does", async () => {
    const entry = APP_ENTRIES.find((candidate) => candidate.id === "red-baron")!;
    const app = await entry.create({} as never);
    app.setFocused?.(true);
    const frame = { width: 640, height: 520, seconds: 0 };
    app.demo.resize?.(frame.width, frame.height);
    for (let update = 0; update < 30; update++) app.demo.update(1 / 60);
    // The picture's place in the window is known once it has been drawn.
    app.demo.draw(new DisplayList(), frame);
    // The game's own cabinet, to read its line of controls (the OS draws it under the picture).
    const cabinet = (app.demo as unknown as { cabinet: ArcadeCabinet }).cabinet;
    expect(cabinet.controls).toContain("CLICK FOR MOUSE STEERING");
    // Near the picture's right edge, then the click that hands the stick over.
    app.onPointer?.("hover", frame.width - 20, frame.height / 3, false);
    app.onPointer?.("down", frame.width - 20, frame.height / 3, false);
    app.onPointer?.("up", frame.width - 20, frame.height / 3, false);
    expect(cabinet.controls).toContain("M LETS GO");
    expect(app.onKeyDown?.(press("m", "KeyM"))).toBe(true);
    expect(cabinet.controls).toContain("CLICK FOR MOUSE STEERING");
    app.dispose?.();
  });
});
