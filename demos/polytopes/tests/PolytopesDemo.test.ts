import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT } from "@vector-display/core";
import { PolytopesDemo } from "../src/PolytopesDemo.js";
import type { Projection } from "../src/sim/rotation4.js";

const FRAME = { width: 1778, height: 1000, seconds: 0 };

function createDemo(polytopeIndex: number, projection: Projection = "PERSPECTIVE"): PolytopesDemo {
  const demo = new PolytopesDemo({ seed: 5, polytopeIndex, projection });
  demo.autoCycle = false;
  // Let the opening fade-in finish.
  for (let frame = 0; frame < 60; frame++) demo.update(1 / 60);
  return demo;
}

function drawn(demo: PolytopesDemo): { count: number; data: Float32Array } {
  const displayList = new DisplayList();
  demo.draw(displayList, FRAME);
  return { count: displayList.segmentCount, data: displayList.getSegmentData().slice(0, displayList.segmentCount * FLOATS_PER_BEAM_SEGMENT) };
}

describe("PolytopesDemo", () => {
  it("draws one segment per edge in perspective", () => {
    expect(drawn(createDemo(2)).count).toBe(32);
    expect(drawn(createDemo(4)).count).toBe(720);
    expect(drawn(createDemo(5)).count).toBe(1200);
  });

  it("draws each edge as several pieces of an arc stereographically", () => {
    const { count } = drawn(createDemo(2, "STEREOGRAPHIC"));
    expect(count).toBeGreaterThan(32 * 5);
    expect(count).toBeLessThanOrEqual(32 * 14);
  });

  it("keeps every drawn point finite and near the screen, whatever the orientation", () => {
    for (const projection of ["PERSPECTIVE", "STEREOGRAPHIC"] as const) {
      const demo = createDemo(4, projection);
      for (let frame = 0; frame < 600; frame++) {
        demo.update(1 / 60);
        if (frame % 60 !== 0) continue;
        const { count, data } = drawn(demo);
        for (let segment = 0; segment < count; segment++) {
          for (let coordinate = 0; coordinate < 4; coordinate++) {
            const value = data[segment * FLOATS_PER_BEAM_SEGMENT + coordinate];
            expect(Number.isFinite(value)).toBe(true);
            expect(Math.abs(value)).toBeLessThan(20000);
          }
        }
      }
    }
  });

  it("keeps turning on screen when rotation through w is off", () => {
    const demo = createDemo(2);
    demo.toggleRotateThroughW();
    const lengths = (): number[] => {
      const { count, data } = drawn(demo);
      const result: number[] = [];
      for (let segment = 0; segment < count; segment++) {
        const offset = segment * FLOATS_PER_BEAM_SEGMENT;
        result.push(Math.hypot(data[offset + 2] - data[offset], data[offset + 3] - data[offset + 1]));
      }
      return result;
    };
    const before = lengths();
    for (let frame = 0; frame < 120; frame++) demo.update(1 / 60);
    const after = lengths();
    // Still moving on screen.
    expect(after).not.toEqual(before);
  });

  it("fades out, switches polytope, and fades back in", () => {
    const demo = createDemo(0);
    expect(demo.visibility).toBe(1);
    demo.changePolytope(1);
    expect(demo.index).toBe(1);
    expect(demo.current.name).toBe("5-CELL");
    demo.update(0.1);
    expect(demo.visibility).toBeLessThan(1);
    for (let frame = 0; frame < 60; frame++) demo.update(1 / 60);
    expect(demo.current.name).toBe("16-CELL");
    expect(demo.visibility).toBe(1);
  });

  it("wraps round the list in both directions", () => {
    const demo = createDemo(0);
    demo.changePolytope(-1);
    expect(demo.index).toBe(5);
    demo.changePolytope(1);
    expect(demo.index).toBe(0);
  });

  it("moves the picture when dragged, differently through w", () => {
    const plain = createDemo(2);
    const throughW = createDemo(2);
    const start = Array.from(drawn(plain).data);
    plain.dragBy(0.3, 0, false);
    throughW.dragBy(0.3, 0, true);
    const afterPlain = Array.from(drawn(plain).data);
    const afterW = Array.from(drawn(throughW).data);
    expect(afterPlain).not.toEqual(start);
    expect(afterW).not.toEqual(start);
    expect(afterW).not.toEqual(afterPlain);
  });
});
