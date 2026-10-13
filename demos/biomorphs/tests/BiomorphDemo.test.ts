import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { ARRIVE_SECONDS, BIOMORPH_PRESETS, BiomorphDemo, EMERGE_SECONDS, parseGenome } from "../src/BiomorphDemo.js";

const SETTLE_SECONDS = ARRIVE_SECONDS + EMERGE_SECONDS + 0.1;

function createDemo(): BiomorphDemo {
  return new BiomorphDemo({ seed: 21 });
}

function settle(demo: BiomorphDemo): void {
  for (let elapsed = 0; elapsed < SETTLE_SECONDS; elapsed += 1 / 60) demo.update(1 / 60);
}

describe("BiomorphDemo breeding", () => {
  it("promotes the chosen child and breeds a litter of its mutants", () => {
    const demo = createDemo();
    const chosen = demo.childGenomes[3];
    demo.choose(3);
    expect(demo.parentGenome).toEqual(chosen);
    expect(demo.generationCount).toBe(1);
    expect(demo.childGenomes).toHaveLength(8);
    for (const child of demo.childGenomes) {
      const changed = child.filter((gene, index) => gene !== chosen[index]);
      expect(changed).toHaveLength(1);
    }
  });

  it("steps the generation count back when a choice is undone", () => {
    const demo = createDemo();
    const original = demo.parentGenome;
    demo.choose(0);
    demo.choose(1);
    expect(demo.generationCount).toBe(2);
    demo.undo();
    expect(demo.generationCount).toBe(1);
    demo.undo();
    expect(demo.generationCount).toBe(0);
    expect(demo.parentGenome).toEqual(original);
    // Nothing further back to undo.
    demo.undo();
    expect(demo.generationCount).toBe(0);
  });

  it("starts a fresh lineage from a preset or a random creature", () => {
    const demo = createDemo();
    demo.choose(0);
    demo.nextPreset();
    expect(demo.parentGenome).toEqual(BIOMORPH_PRESETS[1].genome);
    expect(demo.generationCount).toBe(0);
    demo.choose(0);
    demo.randomize();
    expect(demo.generationCount).toBe(0);
    demo.undo();
    expect(demo.generationCount).toBe(0);
  });

  it("reports every change of parent, so the address can follow it", () => {
    const demo = createDemo();
    let changes = 0;
    demo.onParentChange = () => changes++;
    demo.choose(0);
    demo.undo();
    demo.randomize();
    demo.nextPreset();
    expect(changes).toBe(4);
  });

  it("breeds on its own under autopilot without revisiting a creature", () => {
    const demo = createDemo();
    demo.toggleAutopilot();
    const seen = new Set<string>([demo.parentGenome.join(",")]);
    for (let generation = 1; generation <= 12; generation++) {
      for (let elapsed = 0; elapsed < 3.05; elapsed += 1 / 60) demo.update(1 / 60);
      expect(demo.generationCount).toBe(generation);
      const key = demo.parentGenome.join(",");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("BiomorphDemo transitions", () => {
  it("brings a chosen child to the middle before its litter grows out", () => {
    const demo = createDemo();
    settle(demo);
    expect(demo.arriveProgress).toBe(1);
    expect(demo.emergeProgress).toBe(1);
    demo.choose(2);
    expect(demo.arriveProgress).toBe(0);
    expect(demo.emergeProgress).toBe(0);
    demo.update(ARRIVE_SECONDS / 2);
    expect(demo.arriveProgress).toBeGreaterThan(0);
    expect(demo.arriveProgress).toBeLessThan(1);
    expect(demo.emergeProgress).toBe(0);
    settle(demo);
    expect(demo.arriveProgress).toBe(1);
    expect(demo.emergeProgress).toBe(1);
  });

  it("grows a rerolled litter straight out of the parent, with nothing to arrive", () => {
    const demo = createDemo();
    settle(demo);
    demo.reroll();
    expect(demo.arriveProgress).toBe(1);
    expect(demo.emergeProgress).toBe(0);
    demo.update(EMERGE_SECONDS / 2);
    expect(demo.emergeProgress).toBeGreaterThan(0);
    expect(demo.emergeProgress).toBeLessThan(1);
  });

  it("draws the parent alone at first and all nine creatures once settled", () => {
    const demo = createDemo();
    demo.resize(1600, 1000);
    settle(demo);
    demo.choose(4);
    const early = new DisplayList();
    demo.draw(early);
    const late = new DisplayList();
    settle(demo);
    demo.draw(late);
    expect(early.segmentCount).toBeGreaterThan(0);
    expect(late.segmentCount).toBeGreaterThan(early.segmentCount * 4);
  });
});

describe("parseGenome", () => {
  it("reads nine genes and holds them in range", () => {
    expect(parseGenome("1,-3,1,-1,2,2,2,3,7")).toEqual([1, -3, 1, -1, 2, 2, 2, 3, 7]);
    expect(parseGenome("99,0,0,0,0,0,0,0,99")).toEqual([9, 0, 0, 0, 0, 0, 0, 0, 8]);
  });

  it("rejects anything that is not nine whole numbers", () => {
    expect(parseGenome(null)).toBeNull();
    expect(parseGenome("1,2,3")).toBeNull();
    expect(parseGenome("a,b,c,d,e,f,g,h,i")).toBeNull();
  });
});
