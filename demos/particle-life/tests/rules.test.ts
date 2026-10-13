import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@vector-demos/demo-kit";
import { RULE_PRESETS, blendRules, createRandomRules, mutateRules } from "../src/sim/rules.js";

describe("rules", () => {
  it("creates a square matrix with values in [-1, 1]", () => {
    const rules = createRandomRules(createSeededRandom(7), 5);
    expect(rules.speciesCount).toBe(5);
    expect(rules.attraction.length).toBe(25);
    for (const value of rules.attraction) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for a seed", () => {
    const first = createRandomRules(createSeededRandom(3), 4);
    const second = createRandomRules(createSeededRandom(3), 4);
    expect(Array.from(first.attraction)).toEqual(Array.from(second.attraction));
  });

  it("blends linearly between two rule sets", () => {
    const from = createRandomRules(createSeededRandom(1), 3);
    const to = createRandomRules(createSeededRandom(2), 3);
    const out = new Float32Array(9);
    blendRules(from.attraction, to.attraction, 0.25, out);
    for (let index = 0; index < 9; index++) {
      expect(out[index]).toBeCloseTo(from.attraction[index] * 0.75 + to.attraction[index] * 0.25);
    }
  });

  it("mutates by small, clamped amounts", () => {
    const rules = createRandomRules(createSeededRandom(9), 6);
    const mutated = mutateRules(rules, createSeededRandom(10), 0.2);
    let changed = 0;
    for (let index = 0; index < 36; index++) {
      const delta = Math.abs(mutated.attraction[index] - rules.attraction[index]);
      expect(delta).toBeLessThanOrEqual(0.2 + 1e-6);
      expect(Math.abs(mutated.attraction[index])).toBeLessThanOrEqual(1);
      if (delta > 0) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("provides presets that build valid matrices for any species count", () => {
    for (const preset of RULE_PRESETS) {
      for (const count of [2, 4, 8]) {
        const rules = preset.create(createSeededRandom(5), count);
        expect(rules.attraction.length).toBe(count * count);
        expect(rules.attraction.every((value) => value >= -1 && value <= 1)).toBe(true);
      }
    }
  });
});
