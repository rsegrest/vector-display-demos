import { describe, expect, it } from "vitest";
import { interactionForce } from "../src/sim/force.js";

describe("interactionForce", () => {
  const beta = 0.3;

  it("always repels at close range, whatever the attraction", () => {
    expect(interactionForce(0, 1, beta)).toBe(-1);
    expect(interactionForce(0.15, -1, beta)).toBeCloseTo(-0.5);
    expect(interactionForce(0.15, 1, beta)).toBeCloseTo(-0.5);
  });

  it("peaks at the attraction value halfway through the outer band", () => {
    expect(interactionForce((1 + beta) / 2, 0.8, beta)).toBeCloseTo(0.8);
    expect(interactionForce((1 + beta) / 2, -0.6, beta)).toBeCloseTo(-0.6);
  });

  it("is zero at the band edges and beyond the interaction radius", () => {
    expect(interactionForce(beta, 1, beta)).toBeCloseTo(0);
    expect(interactionForce(1, 1, beta)).toBeCloseTo(0);
    expect(interactionForce(1.5, 1, beta)).toBe(0);
  });
});
