import { describe, expect, it } from "vitest";
import { CELL_COUNT, CaTerrainDemo, SPEEDS } from "../src/CaTerrainDemo.js";
import { RULE_PRESETS, nextRow, populationOf } from "../src/sim/elementaryCA.js";

function createDemo(ruleIndex = 0): CaTerrainDemo {
  const demo = new CaTerrainDemo({ seed: 11, ruleIndex, cameraIndex: 0 });
  demo.autoAdvance = false;
  return demo;
}

describe("CaTerrainDemo", () => {
  it("slides smoothly between generations instead of jumping a row at a time", () => {
    const demo = createDemo();
    const before = demo.newestRow;
    const generationSeconds = 1 / SPEEDS[demo.speedIndex];
    demo.update(generationSeconds * 0.25);
    expect(demo.scroll).toBeCloseTo(0.25, 6);
    demo.update(generationSeconds * 0.5);
    expect(demo.scroll).toBeCloseTo(0.75, 6);
    expect(demo.newestRow).toBe(before);
    demo.update(generationSeconds * 0.5);
    expect(demo.scroll).toBeCloseTo(0.25, 6);
    expect(Array.from(demo.newestRow)).toEqual(Array.from(nextRow(before, demo.currentRule)));
  });

  it("holds still while paused, and steps one generation at a time", () => {
    const demo = createDemo();
    demo.togglePause();
    const before = demo.newestRow;
    demo.update(10);
    expect(demo.newestRow).toBe(before);
    demo.stepOnce();
    expect(Array.from(demo.newestRow)).toEqual(Array.from(nextRow(before, demo.currentRule)));
  });

  it("carries the land on under a new rule rather than starting over", () => {
    const demo = createDemo(0);
    const before = demo.newestRow;
    demo.nextRule(1);
    expect(demo.currentRule).toBe(RULE_PRESETS[1].rule);
    expect(demo.newestRow).toBe(before);
    demo.stepOnce();
    expect(Array.from(demo.newestRow)).toEqual(Array.from(nextRow(before, RULE_PRESETS[1].rule)));
  });

  it("plants a single cell or a random row at the horizon on request", () => {
    const demo = createDemo();
    demo.singleSeed();
    expect(populationOf(demo.newestRow)).toBe(1);
    expect(demo.newestRow[CELL_COUNT / 2]).toBe(1);
    demo.randomize();
    expect(populationOf(demo.newestRow)).toBeGreaterThan(CELL_COUNT / 4);
  });

  it("reseeds after the land has been barren for a while", () => {
    // Rule 90 turns an all-on row all off, and all off stays off for good.
    const demo = createDemo(1);
    demo.newestRow.fill(1);
    for (let generation = 0; generation < 40; generation++) demo.update(1 / SPEEDS[demo.speedIndex]);
    const population = populationOf(demo.newestRow);
    expect(population).toBeGreaterThan(0);
    expect(population).toBeLessThan(CELL_COUNT);
  });

  it("reproduces the same starting land for the same seed", () => {
    expect(Array.from(createDemo().newestRow)).toEqual(Array.from(createDemo().newestRow));
  });
});
