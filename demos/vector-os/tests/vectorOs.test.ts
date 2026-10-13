import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT, SCREEN_SPACE_PLACEMENT, Shape } from "@vector-display/core";
import { BeamSettingsStore, DEFAULT_BEAM_SETTINGS, type Demo } from "@vector-demos/demo-kit";
import { BeamPanel, ROW_HEIGHT, TOP_MARGIN } from "../src/apps/beamPanel.js";
import { handAngles } from "../src/apps/clock.js";
import type { AppEntry, OsServices } from "../src/apps/OsApp.js";
import { APP_ENTRIES } from "../src/apps/registry.js";
import { Terminal, runCommand } from "../src/apps/terminal.js";
import { BootSequence } from "../src/Boot.js";
import { SegmentBlitter, type BlitTransform } from "../src/SegmentBlitter.js";
import { LAUNCHER_WIDTH, MAXIMUM_WINDOWS, MENU_BAR_HEIGHT, VectorOsDemo } from "../src/VectorOsDemo.js";
import { MINIMUM_HEIGHT, MINIMUM_WIDTH, TITLE_BAR_HEIGHT, WindowManager, ZOOM_SECONDS } from "../src/WindowManager.js";

const FRAME = { width: 1778, height: 1000, seconds: 0 };

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  red: number;
  intensity: number;
  joined: boolean;
}

function segmentsOf(list: DisplayList): Segment[] {
  const data = list.getSegmentData();
  const result: Segment[] = [];
  for (let offset = 0; offset < data.length; offset += FLOATS_PER_BEAM_SEGMENT) {
    result.push({ x0: data[offset], y0: data[offset + 1], x1: data[offset + 2], y1: data[offset + 3], red: data[offset + 8], intensity: data[offset + 11], joined: data[offset + 12] === 1 });
  }
  return result;
}

function listOf(coordinates: number[], color = { red: 1, green: 1, blue: 1 }, intensity = 1): DisplayList {
  const list = new DisplayList();
  list.setColor(color);
  list.addShape(Shape.fromSegmentCoordinates(coordinates), { ...SCREEN_SPACE_PLACEMENT, intensity });
  return list;
}

const WHOLE: BlitTransform = { offsetX: 0, offsetY: 0, scale: 1, intensity: 1, inside: { left: 0, top: 0, right: 1000, bottom: 1000 }, outside: [] };

function blit(source: DisplayList, transform: Partial<BlitTransform> = {}): Segment[] {
  const target = new DisplayList();
  const blitter = new SegmentBlitter();
  blitter.beginFrame();
  blitter.blit(source, target, { ...WHOLE, ...transform });
  return segmentsOf(target);
}

describe("SegmentBlitter", () => {
  it("moves and scales strokes into place", () => {
    const [segment] = blit(listOf([10, 20, 30, 40]), { offsetX: 100, offsetY: 200, scale: 0.5 });
    expect([segment.x0, segment.y0, segment.x1, segment.y1]).toEqual([105, 210, 115, 220]);
  });

  it("keeps each stroke's colour and scales its brightness", () => {
    const source = listOf([0, 0, 10, 0], { red: 0.25, green: 1, blue: 1 }, 0.8);
    source.setColor({ red: 0.75, green: 0, blue: 0 });
    source.addShape(Shape.fromSegmentCoordinates([0, 5, 10, 5]), { ...SCREEN_SPACE_PLACEMENT, intensity: 1 });
    const copied = blit(source, { intensity: 0.5 });
    expect(copied.map((segment) => segment.red)).toEqual([0.25, 0.75]);
    expect(copied[0].intensity).toBeCloseTo(0.4, 6);
    expect(copied[1].intensity).toBeCloseTo(0.5, 6);
  });

  it("trims a stroke at the window's edge and drops one wholly outside", () => {
    const copied = blit(listOf([50, 50, 150, 50, 300, 300, 400, 400]), { inside: { left: 0, top: 0, right: 100, bottom: 100 } });
    expect(copied).toHaveLength(1);
    expect([copied[0].x0, copied[0].x1]).toEqual([50, 100]);
  });

  it("cuts a gap where another window lies on top", () => {
    const copied = blit(listOf([0, 50, 300, 50]), { outside: [{ left: 100, top: 0, right: 200, bottom: 100 }] });
    expect(copied.map((segment) => [segment.x0, segment.x1])).toEqual([
      [0, 100],
      [200, 300],
    ]);
  });

  it("leaves strokes that merely pass near a window alone", () => {
    const copied = blit(listOf([0, 150, 300, 150]), { outside: [{ left: 100, top: 0, right: 200, bottom: 100 }] });
    expect(copied).toHaveLength(1);
    expect([copied[0].x0, copied[0].x1]).toEqual([0, 300]);
  });

  it("keeps a dot that is in view and drops one that is covered or outside", () => {
    const dots = new DisplayList();
    for (const [x, y] of [[50, 50], [150, 50], [500, 500]]) dots.addShape(Shape.createDot(), { ...SCREEN_SPACE_PLACEMENT, x, y });
    const copied = blit(dots, { inside: { left: 0, top: 0, right: 300, bottom: 300 }, outside: [{ left: 100, top: 0, right: 200, bottom: 100 }] });
    expect(copied).toHaveLength(1);
    expect([copied[0].x0, copied[0].y0]).toEqual([50, 50]);
  });

  it("keeps connected strokes connected, so joints stay seamless", () => {
    const path = new DisplayList();
    path.addShape(Shape.fromPolyline({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], isClosed: false }), SCREEN_SPACE_PLACEMENT);
    const copied = blit(path);
    expect(copied).toHaveLength(2);
    expect(copied[1].joined).toBe(true);
  });

  it("reuses its buffers from frame to frame without mixing frames up", () => {
    const blitter = new SegmentBlitter();
    for (const coordinates of [[0, 0, 10, 0, 0, 5, 10, 5], [1, 1, 2, 2]]) {
      const target = new DisplayList();
      blitter.beginFrame();
      expect(blitter.blit(listOf(coordinates), target, WHOLE)).toBe(coordinates.length / 4);
      expect(target.segmentCount).toBe(coordinates.length / 4);
    }
  });
});

describe("WindowManager", () => {
  const ORIGIN = { x: 0, y: 100, width: 200, height: 30 };

  function manager(): WindowManager<string> {
    const windows = new WindowManager<string>();
    windows.setBounds({ x: 250, y: 44, width: 1500, height: 950 });
    return windows;
  }

  function settle(windows: WindowManager<string>): void {
    windows.update(ZOOM_SECONDS + 0.01);
  }

  it("puts new windows where they cover nothing, while there is room", () => {
    const windows = manager();
    const opened = ["a", "b", "c", "d"].map((name) => windows.open(name, name, { width: 400, height: 300 }, ORIGIN));
    expect(opened[0].rect.x).toBeGreaterThanOrEqual(250);
    for (const first of opened) {
      for (const second of opened) {
        if (first === second) continue;
        const overlapX = Math.min(first.rect.x + 400, second.rect.x + 400) - Math.max(first.rect.x, second.rect.x);
        const overlapY = Math.min(first.rect.y + 300, second.rect.y + 300) - Math.max(first.rect.y, second.rect.y);
        expect(overlapX <= 0 || overlapY <= 0).toBe(true);
      }
    }
  });

  it("once the screen is full, never hides one title bar exactly behind another", () => {
    const windows = manager();
    const opened = Array.from({ length: 12 }, (_unused, index) => windows.open(`W${index}`, "x", { width: 700, height: 500 }, ORIGIN));
    const corners = new Set(opened.map((window) => `${Math.round(window.rect.x / 20)},${Math.round(window.rect.y / 20)}`));
    expect(corners.size).toBe(opened.length);
    for (const window of opened) {
      expect(window.rect.y).toBeGreaterThanOrEqual(44);
      expect(window.rect.x).toBeGreaterThanOrEqual(250);
    }
  });

  it("grows a window from where it was launched, and only then shows it", () => {
    const windows = manager();
    const window = windows.open("ONE", "a", { width: 400, height: 300 }, ORIGIN);
    expect(window.state).toBe("opening");
    expect(windows.zoomRect(window)).toEqual(ORIGIN);
    expect(windows.hitTest(window.rect.x + 50, window.rect.y + 100)).toBeNull();
    windows.update(ZOOM_SECONDS / 2);
    const half = windows.zoomRect(window);
    expect(half.width).toBeGreaterThan(ORIGIN.width);
    expect(half.width).toBeLessThan(400);
    settle(windows);
    expect(window.state).toBe("open");
    expect(windows.zoomRect(window)).toEqual(window.rect);
  });

  it("tells which part of a window is under a point", () => {
    const windows = manager();
    const window = windows.open("ONE", "a", { width: 400, height: 300 }, ORIGIN, true);
    settle(windows);
    const { x, y, width, height } = window.rect;
    expect(windows.hitTest(x + 15, y + 15)?.part).toBe("close");
    expect(windows.hitTest(x + width - 15, y + 15)?.part).toBe("launch");
    expect(windows.hitTest(x + width / 2, y + 15)?.part).toBe("title");
    expect(windows.hitTest(x + width - 5, y + height - 5)?.part).toBe("resize");
    expect(windows.hitTest(x + width / 2, y + height / 2)?.part).toBe("content");
    expect(windows.hitTest(x - 10, y + 15)).toBeNull();
    expect(windows.contentRect(window)).toEqual({ x, y: y + TITLE_BAR_HEIGHT, width, height: height - TITLE_BAR_HEIGHT });
  });

  it("has no full-screen box on a window that was not given one", () => {
    const windows = manager();
    const window = windows.open("ONE", "a", { width: 400, height: 300 }, ORIGIN);
    settle(windows);
    expect(windows.hitTest(window.rect.x + window.rect.width - 15, window.rect.y + 15)?.part).toBe("title");
  });

  it("finds the frontmost window where two overlap, and brings one forward", () => {
    const windows = manager();
    const back = windows.open("BACK", "a", { width: 400, height: 300 }, ORIGIN);
    const front = windows.open("FRONT", "b", { width: 400, height: 300 }, ORIGIN);
    settle(windows);
    // Slide the front window over the back one.
    front.rect.x = back.rect.x + 40;
    front.rect.y = back.rect.y + 40;
    const shared = { x: front.rect.x + 100, y: front.rect.y + 100 };
    expect(windows.hitTest(shared.x, shared.y)?.window).toBe(front);
    expect(windows.focused).toBe(front);
    windows.bringToFront(back);
    expect(windows.hitTest(shared.x, shared.y)?.window).toBe(back);
    expect(windows.focused).toBe(back);
  });

  it("lists the frames in front of a window, which are what get cut out of it", () => {
    const windows = manager();
    const back = windows.open("BACK", "a", { width: 400, height: 300 }, ORIGIN);
    const front = windows.open("FRONT", "b", { width: 400, height: 300 }, ORIGIN);
    settle(windows);
    expect(windows.framesInFront(front)).toEqual([]);
    expect(windows.framesInFront(back)).toEqual([{ left: front.rect.x, top: front.rect.y, right: front.rect.x + 400, bottom: front.rect.y + 300 }]);
    expect(windows.framesInFront(null)).toHaveLength(2);
  });

  it("moves a window by its title bar, keeping the bar on screen", () => {
    const windows = manager();
    const window = windows.open("ONE", "a", { width: 400, height: 300 }, ORIGIN);
    settle(windows);
    const start = { ...window.rect };
    windows.beginDrag(window, "move", start.x + 100, start.y + 10);
    windows.dragTo(start.x + 160, start.y + 90);
    expect(window.rect.x).toBe(start.x + 60);
    expect(window.rect.y).toBe(start.y + 80);
    windows.dragTo(-5000, -5000);
    expect(window.rect.y).toBe(44);
    expect(window.rect.x + window.rect.width).toBeGreaterThan(250);
    windows.dragTo(9000, 9000);
    expect(window.rect.y).toBeLessThanOrEqual(44 + 950 - TITLE_BAR_HEIGHT);
    windows.endDrag();
    expect(windows.isDragging).toBe(false);
  });

  it("resizes from the corner, down to a minimum", () => {
    const windows = manager();
    const window = windows.open("ONE", "a", { width: 400, height: 300 }, ORIGIN);
    settle(windows);
    const { x, y } = window.rect;
    windows.beginDrag(window, "resize", x + 395, y + 295);
    windows.dragTo(x + 495, y + 345);
    expect(window.rect.width).toBe(500);
    expect(window.rect.height).toBe(350);
    windows.dragTo(x, y);
    expect(window.rect.width).toBe(MINIMUM_WIDTH);
    expect(window.rect.height).toBe(MINIMUM_HEIGHT);
  });

  it("shrinks a closing window away and then forgets it", () => {
    const windows = manager();
    const window = windows.open("ONE", "a", { width: 400, height: 300 }, ORIGIN);
    settle(windows);
    windows.close(window);
    expect(windows.focused).toBeNull();
    expect(windows.windows).toHaveLength(1);
    expect(windows.update(ZOOM_SECONDS + 0.01)).toEqual([window]);
    expect(windows.windows).toHaveLength(0);
  });
});

function fakeServices(overrides: Partial<OsServices> = {}): OsServices & { launched: string[]; rebooted: number } {
  const state = { launched: [] as string[], rebooted: 0 };
  const entries: AppEntry[] = [
    { id: "terminal", title: "Terminal", kind: "tool", size: { width: 400, height: 300 }, create: () => ({ demo: { update() {}, draw() {} }, worldHeight: null }) },
    { id: "lenia", title: "Lenia", kind: "demo", size: { width: 400, height: 300 }, create: () => ({ demo: { update() {}, draw() {} }, worldHeight: 1000 }) },
    { id: "slime-mold", title: "Slime Mold", kind: "demo", size: { width: 400, height: 300 }, create: () => ({ demo: { update() {}, draw() {} }, worldHeight: 1000 }) },
  ];
  return Object.assign(state, {
    beam: new BeamSettingsStore(),
    entries,
    launch: (id: string) => {
      state.launched.push(id);
      return true;
    },
    openWindows: () => ["Lenia", "Clock"],
    close: (name: string) => (name === "ALL" ? 2 : name === "LENIA" ? 1 : 0),
    reboot: () => void state.rebooted++,
    now: () => new Date(Date.UTC(2026, 9, 13, 3, 4, 5)),
    ...overrides,
  });
}

describe("terminal commands", () => {
  it("lists programs, all or of one kind", () => {
    const services = fakeServices();
    expect(runCommand("ls", services)!.join(" ")).toMatch(/TERMINAL\s+LENIA\s+SLIME-MOLD/);
    expect(runCommand("ls", services)).toHaveLength(2);
    expect(runCommand("ls demos", services)!.join(" ")).not.toContain("TERMINAL");
    expect(runCommand("LS TOOLS", services)!.join(" ").trim()).toBe("TERMINAL");
  });

  it("runs a program by its name, the start of it, or its title", () => {
    const services = fakeServices();
    expect(runCommand("run lenia", services)).toEqual(["STARTING LENIA"]);
    expect(runCommand("RUN SLIME", services)).toEqual(["STARTING SLIME MOLD"]);
    expect(runCommand("run slime mold", services)).toEqual(["STARTING SLIME MOLD"]);
    expect(services.launched).toEqual(["lenia", "slime-mold", "slime-mold"]);
    expect(runCommand("run nothing", services)![0]).toContain("NO PROGRAM");
    expect(runCommand("run", services)![0]).toContain("RUN WHAT");
  });

  it("changes a beam setting and reports the value actually set", () => {
    const services = fakeServices();
    expect(runCommand("set persistence 200", services)).toEqual(["PERSISTENCE 200 MS"]);
    expect(services.beam.current.persistenceHalfLifeMilliseconds).toBe(200);
    // Out of range values are brought back within it.
    expect(runCommand("SET FLICKER 5", services)).toEqual(["FLICKER 0.15"]);
    expect(runCommand("set colour 3", services)![0]).toContain("SET WHAT");
    expect(runCommand("set bloom lots", services)![0]).toContain("WHAT NUMBER");
    expect(runCommand("reset", services)).toEqual(["BEAM SETTINGS RESET"]);
    expect(services.beam.current).toEqual(DEFAULT_BEAM_SETTINGS);
  });

  it("shows every beam setting", () => {
    const lines = runCommand("get", fakeServices())!;
    expect(lines).toHaveLength(7);
    expect(lines.find((line) => line.startsWith("PERSISTENCE"))).toContain("80 MS");
  });

  it("lists and closes windows", () => {
    const services = fakeServices();
    expect(runCommand("ps", services)).toEqual(["LENIA", "CLOCK"]);
    expect(runCommand("close lenia", services)).toEqual(["CLOSED 1"]);
    expect(runCommand("close all", services)).toEqual(["CLOSED 2"]);
    expect(runCommand("close teapot", services)![0]).toContain("NOTHING OPEN");
  });

  it("tells the time, echoes, reboots, and admits what it does not know", () => {
    const services = fakeServices();
    expect(runCommand("date", services)).toEqual(["2026-10-13 03:04:05 UTC"]);
    expect(runCommand("echo hello there", services)).toEqual(["HELLO THERE"]);
    expect(runCommand("reboot", services)).toEqual(["REBOOTING"]);
    expect(services.rebooted).toBe(1);
    expect(runCommand("frobnicate", services)![0]).toContain("UNKNOWN COMMAND FROBNICATE");
    expect(runCommand("   ", services)).toEqual([]);
    expect(runCommand("clear", services)).toBeNull();
    expect(runCommand("help", services)!.length).toBeGreaterThan(8);
  });
});

describe("Terminal", () => {
  function type(terminal: Terminal, text: string): void {
    for (const character of text) terminal.key(character);
  }

  it("takes typing, runs the line on Enter, and prints the result", () => {
    const services = fakeServices();
    const terminal = new Terminal(services);
    type(terminal, "run leniq");
    terminal.key("Backspace");
    terminal.key("a");
    expect(terminal.input).toBe("RUN LENIA");
    terminal.key("Enter");
    expect(terminal.input).toBe("");
    expect(terminal.lines.slice(-2)).toEqual(["> RUN LENIA", "STARTING LENIA"]);
    expect(services.launched).toEqual(["lenia"]);
  });

  it("recalls earlier lines with the up arrow", () => {
    const terminal = new Terminal(fakeServices());
    type(terminal, "date");
    terminal.key("Enter");
    type(terminal, "ps");
    terminal.key("Enter");
    terminal.key("ArrowUp");
    expect(terminal.input).toBe("PS");
    terminal.key("ArrowUp");
    expect(terminal.input).toBe("DATE");
    terminal.key("ArrowDown");
    terminal.key("ArrowDown");
    expect(terminal.input).toBe("");
  });

  it("wipes the screen on CLEAR and ignores keys that are not characters", () => {
    const terminal = new Terminal(fakeServices());
    terminal.key("Shift");
    terminal.key("F5");
    expect(terminal.input).toBe("");
    type(terminal, "clear");
    terminal.key("Enter");
    expect(terminal.lines).toEqual([]);
  });

  it("draws its text and a prompt", () => {
    const terminal = new Terminal(fakeServices());
    const list = new DisplayList();
    terminal.draw(list, { width: 500, height: 300, seconds: 0 });
    expect(list.segmentCount).toBeGreaterThan(20);
  });
});

describe("clock", () => {
  it("points the hands where a clock's hands point", () => {
    const three = handAngles(new Date(2026, 0, 1, 3, 0, 0));
    expect(three.hour).toBeCloseTo(Math.PI / 2, 6);
    expect(three.minute).toBeCloseTo(0, 6);
    const halfPastNine = handAngles(new Date(2026, 0, 1, 21, 30, 15));
    // Half way between nine and ten.
    expect(halfPastNine.hour).toBeCloseTo((9.5 / 12) * Math.PI * 2, 2);
    expect(halfPastNine.minute).toBeCloseTo(Math.PI + (0.25 / 60) * Math.PI * 2, 6);
    expect(halfPastNine.second).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("BeamPanel", () => {
  it("sets a value by dragging its slider, and only while dragging", () => {
    const store = new BeamSettingsStore();
    const panel = new BeamPanel(store);
    panel.draw(new DisplayList(), { width: 460, height: 320, seconds: 0 });
    const rowY = (row: number): number => TOP_MARGIN + ROW_HEIGHT / 2 + row * ROW_HEIGHT;
    // Hovering changes nothing.
    panel.pointer("hover", 300, rowY(0));
    expect(store.current).toEqual(DEFAULT_BEAM_SETTINGS);
    // The track runs from 205 to 368; its far end is the maximum.
    panel.pointer("down", 368, rowY(0));
    expect(store.current.beamWidth).toBe(4);
    panel.pointer("move", 150, rowY(3));
    // Still the first slider, wherever the pointer wanders.
    expect(store.current.beamWidth).toBe(0.5);
    expect(store.current.persistenceHalfLifeMilliseconds).toBe(DEFAULT_BEAM_SETTINGS.persistenceHalfLifeMilliseconds);
    panel.pointer("up", 150, rowY(3));
    panel.pointer("move", 368, rowY(0));
    expect(store.current.beamWidth).toBe(0.5);
  });

  it("snaps to round values and resets from its button", () => {
    const store = new BeamSettingsStore();
    const panel = new BeamPanel(store);
    panel.draw(new DisplayList(), { width: 460, height: 320, seconds: 0 });
    panel.pointer("down", 259, TOP_MARGIN + ROW_HEIGHT / 2 + 3 * ROW_HEIGHT);
    expect(store.current.persistenceHalfLifeMilliseconds % 10).toBe(0);
    panel.pointer("up", 0, 0);
    panel.pointer("down", 30, TOP_MARGIN + 7 * ROW_HEIGHT + 12);
    expect(store.current).toEqual(DEFAULT_BEAM_SETTINGS);
  });
});

describe("BootSequence", () => {
  it("types out the self-test, then writes the logo, then finishes", () => {
    const boot = new BootSequence(18);
    const draw = (): number => {
      const list = new DisplayList();
      boot.draw(list, FRAME);
      return list.segmentCount;
    };
    boot.update(0.05);
    const first = draw();
    boot.update(1);
    expect(draw()).toBeGreaterThan(first);
    // Into the logo: more of it is drawn as the beam gets further.
    boot.update(boot.duration - boot.seconds - 2.2);
    const early = draw();
    boot.update(1);
    expect(draw()).toBeGreaterThan(early);
    expect(boot.isDone).toBe(false);
    boot.update(2);
    expect(boot.isDone).toBe(true);
  });

  it("can be skipped", () => {
    const boot = new BootSequence(18);
    boot.skip();
    expect(boot.isDone).toBe(true);
  });
});

// A program that draws a known shape, to see where the OS puts it.
function probeEntry(id: string, worldHeight: number | null, record: { resized: [number, number][]; pointers: unknown[]; keys: string[]; disposed: number }): AppEntry {
  const demo: Demo = {
    update() {},
    draw(list, frame) {
      // A box round the whole of the program's space, and a stroke far outside it.
      list.setColor({ red: 0.25, green: 0.5, blue: 0.5 });
      list.addShape(Shape.fromPolyline({ points: [{ x: 0, y: 0 }, { x: frame.width, y: 0 }, { x: frame.width, y: frame.height }, { x: 0, y: frame.height }], isClosed: true }), SCREEN_SPACE_PLACEMENT);
      list.addShape(Shape.fromSegmentCoordinates([-5000, frame.height / 2, 5000, frame.height / 2]), SCREEN_SPACE_PLACEMENT);
    },
    resize: (width, height) => void record.resized.push([width, height]),
  };
  return {
    id,
    title: id.toUpperCase(),
    kind: worldHeight === null ? "tool" : "demo",
    size: { width: 500, height: 336 },
    create: () => ({
      demo,
      worldHeight,
      onKey: (key) => void record.keys.push(key),
      onPointer: (kind, x, y) => void record.pointers.push([kind, Math.round(x), Math.round(y)]),
      dispose: () => void record.disposed++,
    }),
  };
}

async function settleOs(os: VectorOsDemo): Promise<void> {
  // Let the programs finish loading, then the windows finish opening.
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let frame = 0; frame < 30; frame++) os.update(1 / 60);
}

function drawOs(os: VectorOsDemo): Segment[] {
  const list = new DisplayList();
  os.draw(list, FRAME);
  return segmentsOf(list);
}

describe("VectorOsDemo", () => {
  function createOs(ids: string[] = ["one"], worldHeight: number | null = 1000) {
    const record = { resized: [] as [number, number][], pointers: [] as unknown[], keys: [] as string[], disposed: 0 };
    const entries = [...ids.map((id) => probeEntry(id, worldHeight, record)), probeEntry("spare", worldHeight, record)];
    const os = new VectorOsDemo({ skipBoot: true, entries, startup: ids });
    os.resize(FRAME.width, FRAME.height);
    return { os, record };
  }

  it("boots first, and any key takes you straight to the desktop", async () => {
    const os = new VectorOsDemo({ entries: [], startup: [] });
    expect(os.isBooting).toBe(true);
    expect(drawOs(os).length).toBe(0);
    os.update(0.5);
    expect(drawOs(os).length).toBeGreaterThan(0);
    os.key("a");
    os.update(1 / 60);
    expect(os.isBooting).toBe(false);
  });

  it("opens the startup programs in windows on the desktop", async () => {
    const { os } = createOs(["one", "two"]);
    await settleOs(os);
    expect(os.openTitles).toEqual(["ONE", "TWO"]);
    expect(os.focusedTitle).toBe("TWO");
    expect(drawOs(os).length).toBeGreaterThan(100);
  });

  it("shrinks a demo's whole screen into its window and trims what spills out", async () => {
    const { os, record } = createOs(["one"], 1000);
    await settleOs(os);
    const window = os.windowManager.windows[0];
    const content = os.windowManager.contentRect(window);
    // The demo was told its space is 1000 tall, and as wide as the window is in proportion.
    expect(record.resized.at(-1)![1]).toBe(1000);
    expect(record.resized.at(-1)![0]).toBeCloseTo((1000 * content.width) / content.height, 3);
    const grey = drawOs(os).filter((segment) => segment.red === 0.25);
    expect(grey.length).toBeGreaterThan(0);
    for (const segment of grey) {
      for (const [x, y] of [[segment.x0, segment.y0], [segment.x1, segment.y1]]) {
        expect(x).toBeGreaterThanOrEqual(content.x);
        expect(x).toBeLessThanOrEqual(content.x + content.width);
        expect(y).toBeGreaterThanOrEqual(content.y);
        expect(y).toBeLessThanOrEqual(content.y + content.height);
      }
    }
    // The stroke that ran far off both sides now spans the window and no more.
    const longest = Math.max(...grey.map((segment) => Math.abs(segment.x1 - segment.x0)));
    expect(longest).toBeCloseTo(content.width - 2, 0);
  });

  it("gives an OS tool one unit per screen unit", async () => {
    const { os, record } = createOs(["one"], null);
    await settleOs(os);
    const content = os.windowManager.contentRect(os.windowManager.windows[0]);
    expect(record.resized.at(-1)).toEqual([content.width, content.height]);
  });

  it("cuts the window behind out from under the window in front", async () => {
    const { os } = createOs(["one", "two"]);
    await settleOs(os);
    const [back, front] = os.windowManager.windows;
    // Slide the front window half over the back one.
    front.rect.x = back.rect.x + back.rect.width / 2;
    front.rect.y = back.rect.y + 30;
    const frontRect = front.rect;
    const inside = (x: number, y: number): boolean => x > frontRect.x + 0.5 && x < frontRect.x + frontRect.width - 0.5 && y > frontRect.y + 0.5 && y < frontRect.y + frontRect.height - 0.5;
    const backContent = os.windowManager.contentRect(back);
    // Everything belonging to the back window: its strokes lie within its frame.
    const drawn = drawOs(os);
    const crossing = drawn.filter((segment) => {
      const middleX = (segment.x0 + segment.x1) / 2;
      const middleY = (segment.y0 + segment.y1) / 2;
      // A stroke through the overlap that is not part of the front window's own picture.
      return inside(middleX, middleY) && segment.red === 0.25 && Math.abs(segment.y0 - (backContent.y + backContent.height / 2)) < 1 && segment.y0 === segment.y1;
    });
    expect(crossing).toEqual([]);
    expect(back.rect.x).toBeLessThan(frontRect.x);
  });

  it("launches from the list on the left, once, and marks it running", async () => {
    const { os } = createOs(["one"]);
    await settleOs(os);
    // Rows: a heading, ONE, then SPARE.
    const spareY = MENU_BAR_HEIGHT + 22 + 31 * 2 + 10;
    expect(os.cursorAt(LAUNCHER_WIDTH - 20, spareY)).toBe("pointer");
    expect(os.cursorAt(60, spareY)).toBe("pointer");
    os.pointer("down", 60, spareY);
    os.pointer("up", 60, spareY);
    await settleOs(os);
    expect(os.openTitles).toEqual(["ONE", "SPARE"]);
    os.pointer("down", 60, spareY);
    await settleOs(os);
    expect(os.openTitles).toEqual(["ONE", "SPARE"]);
  });

  it("sends keys to the window in front, and the pointer in that program's own coordinates", async () => {
    const { os, record } = createOs(["one"], 1000);
    await settleOs(os);
    os.key("x");
    expect(record.keys).toEqual(["x"]);
    const content = os.windowManager.contentRect(os.windowManager.windows[0]);
    os.pointer("down", content.x + content.width / 2, content.y + content.height / 2);
    os.pointer("move", content.x + content.width, content.y + content.height);
    os.pointer("up", content.x, content.y);
    const scale = 1000 / content.height;
    expect(record.pointers).toEqual([
      ["down", Math.round((content.width / 2) * scale), 500],
      ["move", Math.round(content.width * scale), 1000],
      ["up", 0, 0],
    ]);
    // With no button held, movement is a hover.
    os.pointer("move", content.x + 10, content.y + 10);
    expect((record.pointers.at(-1) as unknown[])[0]).toBe("hover");
  });

  it("drags a window by its title bar and closes it from its box", async () => {
    const { os, record } = createOs(["one"]);
    await settleOs(os);
    const window = os.windowManager.windows[0];
    const start = { ...window.rect };
    expect(os.cursorAt(start.x + start.width / 2, start.y + 10)).toBe("move");
    os.pointer("down", start.x + start.width / 2, start.y + 10);
    os.pointer("move", start.x + start.width / 2 + 120, start.y + 70);
    os.pointer("up", start.x + start.width / 2 + 120, start.y + 70);
    expect(window.rect.x).toBe(start.x + 120);
    expect(window.rect.y).toBe(start.y + 60);
    os.pointer("down", window.rect.x + 15, window.rect.y + 15);
    await settleOs(os);
    expect(os.openTitles).toEqual([]);
    expect(record.disposed).toBe(1);
  });

  it("asks the page to open a demo full screen from the box on its title bar", async () => {
    const { os } = createOs(["one"]);
    await settleOs(os);
    const opened: string[] = [];
    os.onNavigate = (id) => void opened.push(id);
    const { rect } = os.windowManager.windows[0];
    os.pointer("down", rect.x + rect.width - 15, rect.y + 15);
    expect(opened).toEqual(["one"]);
  });

  it("closes the oldest window rather than open too many", async () => {
    const record = { resized: [] as [number, number][], pointers: [] as unknown[], keys: [] as string[], disposed: 0 };
    const ids = Array.from({ length: MAXIMUM_WINDOWS + 1 }, (_unused, index) => `p${index}`);
    const os = new VectorOsDemo({ skipBoot: true, entries: ids.map((id) => probeEntry(id, 1000, record)), startup: ids });
    await settleOs(os);
    expect(os.openTitles).toHaveLength(MAXIMUM_WINDOWS);
    expect(os.openTitles).not.toContain("P0");
  });

  it("shows a program that fails to load as such, without stopping the rest", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const broken: AppEntry = { id: "broken", title: "Broken", kind: "demo", size: { width: 400, height: 300 }, create: () => Promise.reject(new Error("offline")) };
      const os = new VectorOsDemo({ skipBoot: true, entries: [broken], startup: ["broken"] });
      await settleOs(os);
      expect(os.openTitles).toEqual(["Broken"]);
      expect(drawOs(os).length).toBeGreaterThan(50);
    } finally {
      console.error = original;
    }
  });
});

describe("the real programs", () => {
  it("are all listed, each with its own id", () => {
    expect(new Set(APP_ENTRIES.map((entry) => entry.id)).size).toBe(APP_ENTRIES.length);
    expect(APP_ENTRIES.filter((entry) => entry.kind === "tool").map((entry) => entry.id)).toEqual(["terminal", "clock", "beam"]);
    expect(APP_ENTRIES.filter((entry) => entry.kind === "demo")).toHaveLength(15);
  });

  // Lenia needs a Web Worker and Live Earth fetches from the network, so those two are left to the browser.
  const runnable = APP_ENTRIES.filter((entry) => entry.id !== "lenia" && entry.id !== "live-earth");

  it.each(runnable.map((entry) => [entry.id, entry] as const))("%s runs in a window and draws inside it", async (_id, entry) => {
    const os = new VectorOsDemo({ skipBoot: true, entries: [entry], startup: [entry.id] });
    os.resize(FRAME.width, FRAME.height);
    const window = os.windowManager.windows[0];
    // The demo's code is imported on launch; wait for it to arrive.
    for (let waited = 0; waited < 200 && !window.payload.app; waited++) await new Promise((resolve) => setTimeout(resolve, 25));
    for (let frame = 0; frame < 90; frame++) os.update(1 / 60);
    expect(window.payload.app, `${entry.id} should have loaded`).not.toBeNull();
    const content = os.windowManager.contentRect(window);
    const list = new DisplayList();
    os.draw(list, { ...FRAME, seconds: 1.5 });
    os.draw(list, { ...FRAME, seconds: 1.52 });
    const drawn = segmentsOf(list);
    // Something inside the window, beyond the frame and title.
    const inContent = drawn.filter((segment) => segment.y0 > content.y + 2 && segment.y0 < content.y + content.height - 2 && segment.x0 > content.x + 2 && segment.x0 < content.x + content.width - 2);
    expect(inContent.length).toBeGreaterThan(0);
    for (const segment of drawn) {
      expect(Number.isFinite(segment.x0 + segment.y0 + segment.x1 + segment.y1)).toBe(true);
    }
  });
});
