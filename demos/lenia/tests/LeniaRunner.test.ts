import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeniaRunner } from "../src/sim/LeniaRunner.js";
import type { SimulationFrame } from "../src/sim/protocol.js";

describe("LeniaRunner", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => vi.useRealTimers());

  it("posts a frame on load and then steps at the requested rate", () => {
    const frames: SimulationFrame[] = [];
    const runner = new LeniaRunner((frame) => frames.push(frame));
    runner.handle({ type: "init", width: 64, height: 32 });
    runner.handle({ type: "rate", stepsPerSecond: 20 });
    runner.handle({ type: "load", speciesIndex: 0, seed: 4 });
    expect(frames).toHaveLength(1);
    expect(frames[0].stepCount).toBe(0);
    expect(frames[0].cells).toHaveLength(64 * 32);
    vi.advanceTimersByTime(1000);
    const steps = frames[frames.length - 1].stepCount;
    expect(steps).toBeGreaterThanOrEqual(15);
    expect(steps).toBeLessThanOrEqual(25);
    runner.stop();
  });

  it("does not step while paused, but single-steps on request", () => {
    const frames: SimulationFrame[] = [];
    const runner = new LeniaRunner((frame) => frames.push(frame));
    runner.handle({ type: "init", width: 32, height: 32 });
    runner.handle({ type: "load", speciesIndex: 0, seed: 4 });
    runner.handle({ type: "pause", isPaused: true });
    vi.advanceTimersByTime(1000);
    expect(frames[frames.length - 1].stepCount).toBe(0);
    runner.handle({ type: "step" });
    expect(frames[frames.length - 1].stepCount).toBe(1);
    runner.stop();
  });
});
