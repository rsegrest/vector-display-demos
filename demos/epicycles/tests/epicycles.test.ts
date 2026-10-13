import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { buildPath, starPath, textPath } from "@vector-demos/demo-kit";
import { EpicyclesDemo, REVOLUTION_SECONDS, SHAPES, TERM_LEVELS } from "../src/EpicyclesDemo.js";
import { chainAt, epicyclesFor, meanError, resamplePath, type SampledPath } from "../src/sim/fourier.js";

function circleSamples(count: number, turns: number, radius: number, phase = 0): SampledPath {
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const angle = (2 * Math.PI * turns * index) / count + phase;
    x[index] = 3 + radius * Math.cos(angle);
    y[index] = -2 + radius * Math.sin(angle);
  }
  return { x, y, drawn: new Uint8Array(count).fill(1), count };
}

function tip(epicycles: ReturnType<typeof epicyclesFor>, termCount: number, time: number): [number, number] {
  const joints = new Float64Array((epicycles.length + 1) * 2);
  const count = chainAt(epicycles, termCount, time, joints);
  return [joints[(count - 1) * 2], joints[(count - 1) * 2 + 1]];
}

describe("epicyclesFor", () => {
  it("finds the one circle that draws a circle, with its centre as the fixed offset", () => {
    const epicycles = epicyclesFor(circleSamples(64, 1, 2.5, 0.7));
    expect(epicycles[0].frequency).toBe(0);
    expect(epicycles[0].radius).toBeCloseTo(Math.hypot(3, -2), 9);
    expect(epicycles[1].frequency).toBe(1);
    expect(epicycles[1].radius).toBeCloseTo(2.5, 9);
    expect(epicycles[1].phase).toBeCloseTo(0.7, 9);
    for (const epicycle of epicycles.slice(2)) expect(epicycle.radius).toBeLessThan(1e-9);
  });

  it("gives a path traced the other way round a circle turning the other way", () => {
    const epicycles = epicyclesFor(circleSamples(64, -3, 1));
    expect(epicycles[1].frequency).toBe(-3);
    expect(epicycles[1].radius).toBeCloseTo(1, 9);
  });

  it("orders the circles from largest to smallest after the offset", () => {
    const epicycles = epicyclesFor(resamplePath(starPath(), 128));
    expect(epicycles).toHaveLength(128);
    for (let index = 2; index < epicycles.length; index++) expect(epicycles[index].radius).toBeLessThanOrEqual(epicycles[index - 1].radius);
  });
});

describe("chainAt", () => {
  const samples = resamplePath(starPath(), 128);
  const epicycles = epicyclesFor(samples);

  it("passes through every sample when all the circles are used", () => {
    for (const index of [0, 17, 64, 127]) {
      const [x, y] = tip(epicycles, epicycles.length, index / samples.count);
      expect(x).toBeCloseTo(samples.x[index], 6);
      expect(y).toBeCloseTo(samples.y[index], 6);
    }
  });

  it("links each circle's centre to the rim of the one before", () => {
    const joints = new Float64Array((epicycles.length + 1) * 2);
    const count = chainAt(epicycles, 6, 0.3, joints);
    expect(count).toBe(7);
    expect(joints[0]).toBe(0);
    expect(joints[1]).toBe(0);
    for (let joint = 1; joint < count; joint++) {
      const armLength = Math.hypot(joints[joint * 2] - joints[(joint - 1) * 2], joints[joint * 2 + 1] - joints[(joint - 1) * 2 + 1]);
      expect(armLength).toBeCloseTo(epicycles[joint - 1].radius, 9);
    }
  });

  it("comes back to where it started after one trip", () => {
    const start = tip(epicycles, 20, 0);
    const end = tip(epicycles, 20, 1);
    expect(end[0]).toBeCloseTo(start[0], 9);
    expect(end[1]).toBeCloseTo(start[1], 9);
  });

  it("gets closer to the shape with every level of circles added", () => {
    const errors = [1, 3, 8, 21, 55, 127].map((terms) => meanError(epicycles, terms + 1, samples));
    for (let index = 1; index < errors.length; index++) expect(errors[index]).toBeLessThan(errors[index - 1]);
    expect(errors[errors.length - 1]).toBeLessThan(1e-6);
    expect(errors[0]).toBeGreaterThan(0.1);
  });
});

describe("resamplePath", () => {
  it("samples evenly in time and marks where the pen is up", () => {
    // Two strokes: the pen is up for the jumps between them.
    const path = buildPath([
      { points: [[0, 0, 0], [1, 0, 0]] },
      { points: [[1, 1, 0], [0, 1, 0]] },
    ]);
    const samples = resamplePath(path, 200);
    expect(samples.count).toBe(200);
    const up = Array.from(samples.drawn).filter((flag) => flag === 0).length;
    // Jumps are crossed seven times faster than strokes, so they take 1/8 of the time.
    expect(up / 200).toBeCloseTo(1 / 8, 1);
    expect(samples.drawn[10]).toBe(1);
  });

  it("marks the whole of a single closed outline as drawn", () => {
    const samples = resamplePath(starPath(), 100);
    expect(Array.from(samples.drawn).every((flag) => flag === 1)).toBe(true);
  });

  it("marks the gaps between letters as pen-up", () => {
    const samples = resamplePath(textPath("II"), 200);
    expect(Array.from(samples.drawn).some((flag) => flag === 0)).toBe(true);
    expect(Array.from(samples.drawn).some((flag) => flag === 1)).toBe(true);
  });
});

describe("EpicyclesDemo", () => {
  const STEP = 1 / 60;

  function createDemo(): EpicyclesDemo {
    const demo = new EpicyclesDemo({ shapeIndex: 0 });
    demo.resize(1778, 1000);
    return demo;
  }

  function run(demo: EpicyclesDemo, seconds: number): void {
    for (let elapsed = 0; elapsed < seconds; elapsed += STEP) demo.update(STEP);
  }

  function segments(demo: EpicyclesDemo): number {
    const displayList = new DisplayList();
    demo.draw(displayList);
    return displayList.segmentCount;
  }

  it("goes once round the shape in the set time", () => {
    const demo = createDemo();
    demo.autoCycle = false;
    run(demo, REVOLUTION_SECONDS / 2);
    expect(demo.progress).toBeCloseTo(0.5, 2);
  });

  it("uses more circles each trip in auto mode, then moves to the next shape", () => {
    const demo = createDemo();
    const seen: number[] = [demo.termCount];
    for (let trip = 0; trip < 5; trip++) {
      run(demo, REVOLUTION_SECONDS + 0.05);
      seen.push(demo.termCount);
    }
    for (let index = 1; index < seen.length; index++) expect(seen[index]).toBeGreaterThan(seen[index - 1]);
    expect(seen[seen.length - 1]).toBe(TERM_LEVELS[TERM_LEVELS.length - 1]);
    expect(demo.name).toBe(SHAPES[0].name);
    run(demo, REVOLUTION_SECONDS + 0.05);
    expect(demo.name).toBe(SHAPES[1].name);
  });

  it("draws more as the trace grows and as circles are added", () => {
    const demo = createDemo();
    demo.autoCycle = false;
    run(demo, 0.5);
    const early = segments(demo);
    run(demo, 3);
    expect(segments(demo)).toBeGreaterThan(early);
    const few = segments(demo);
    demo.changeTerms(4);
    run(demo, 3.5);
    expect(segments(demo)).toBeGreaterThan(few);
  });

  it("hides the circles and the ghost on request", () => {
    const demo = createDemo();
    demo.autoCycle = false;
    demo.changeTerms(5);
    run(demo, 1);
    const all = segments(demo);
    demo.toggleCircles();
    const withoutCircles = segments(demo);
    demo.toggleGhost();
    expect(withoutCircles).toBeLessThan(all);
    expect(segments(demo)).toBeLessThan(withoutCircles);
  });

  it("traces a digit from the font, and stops cycling so it stays", () => {
    const demo = createDemo();
    demo.traceGlyph("7");
    expect(demo.name).toBe("GLYPH 7");
    expect(demo.autoCycle).toBe(false);
  });

  it("turns a sketch into a shape, and ignores a mere dab", () => {
    const demo = createDemo();
    demo.beginSketch(400, 400);
    demo.extendSketch(402, 401);
    expect(demo.isSketching).toBe(true);
    expect(demo.endSketch()).toBe(false);
    expect(demo.name).toBe(SHAPES[0].name);

    demo.beginSketch(400, 400);
    for (let step = 1; step <= 40; step++) {
      const angle = (step / 40) * Math.PI * 1.8;
      demo.extendSketch(400 + Math.sin(angle) * 200, 400 + (1 - Math.cos(angle)) * 200);
    }
    // While sketching, the machine waits and only the sketch is drawn.
    const before = demo.progress;
    run(demo, 1);
    expect(demo.progress).toBe(before);
    expect(segments(demo)).toBeGreaterThan(20);
    expect(demo.endSketch()).toBe(true);
    expect(demo.name).toBe("SKETCH");
    expect(demo.isSketching).toBe(false);
    run(demo, 1);
    expect(demo.progress).toBeGreaterThan(0);
  });

  it("holds still while paused", () => {
    const demo = createDemo();
    run(demo, 1);
    demo.togglePause();
    const before = demo.progress;
    run(demo, 1);
    expect(demo.progress).toBe(before);
  });
});
