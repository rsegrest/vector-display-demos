import { describe, expect, it } from "vitest";
import { createSeededRandom } from "../src/random.js";
import { hslToBeamColor } from "../src/color.js";

describe("createSeededRandom", () => {
  it("repeats for the same seed and stays in [0, 1)", () => {
    const first = createSeededRandom(42);
    const second = createSeededRandom(42);
    for (let index = 0; index < 1000; index++) {
      const value = first();
      expect(value).toBe(second());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("differs between seeds", () => {
    expect(createSeededRandom(1)()).not.toBe(createSeededRandom(2)());
  });
});

describe("hslToBeamColor", () => {
  it("converts primary hues", () => {
    expect(hslToBeamColor(0, 1, 0.5)).toEqual({ red: 1, green: 0, blue: 0 });
    const green = hslToBeamColor(1 / 3, 1, 0.5);
    expect(green.green).toBeCloseTo(1);
    expect(green.red).toBeCloseTo(0);
  });
});
