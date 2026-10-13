import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@vector-demos/demo-kit";
import { AttractorSwarm, ESCAPE_RADIUS, SPAWN_RADIUS } from "../src/sim/AttractorSwarm.js";
import { ATTRACTORS, blendedField, calibrate, commonFrameDerivative, stepRungeKutta, type Vector3 } from "../src/sim/attractors.js";

const calibrated = ATTRACTORS.map(calibrate);

describe("stepRungeKutta", () => {
  it("follows a circle accurately", () => {
    // dx = -y, dy = x turns at one radian per unit time.
    const point: Vector3 = [1, 0, 0];
    for (let step = 0; step < 100; step++) stepRungeKutta((x, y, _z, out) => { out[0] = -y; out[1] = x; out[2] = 0; }, point, Math.PI / 200);
    expect(point[0]).toBeCloseTo(0, 6);
    expect(point[1]).toBeCloseTo(1, 6);
  });
});

describe("attractor equations", () => {
  it("gives the textbook Lorenz rates", () => {
    const out: Vector3 = [0, 0, 0];
    ATTRACTORS[0].derivative(1, 2, 3, out);
    expect(out[0]).toBeCloseTo(10, 9);
    expect(out[1]).toBeCloseTo(1 * (28 - 3) - 2, 9);
    expect(out[2]).toBeCloseTo(2 - 8, 9);
  });

  it("has distinct names", () => {
    expect(new Set(ATTRACTORS.map((attractor) => attractor.name)).size).toBe(ATTRACTORS.length);
  });
});

describe.each(calibrated.map((entry) => [entry.attractor.name, entry] as const))("%s in the common frame", (_name, entry) => {
  it("is measured to a sensible size and pace", () => {
    expect(entry.radius).toBeGreaterThan(0.5);
    expect(entry.radius).toBeLessThan(100);
    expect(entry.pace).toBeGreaterThan(0);
    expect(Number.isFinite(entry.pace)).toBe(true);
  });

  it("stays inside the unit box and travels at about unit speed", () => {
    const { attractor, centre, radius } = entry;
    const point: Vector3 = [(attractor.seed[0] - centre[0]) / radius, (attractor.seed[1] - centre[1]) / radius, (attractor.seed[2] - centre[2]) / radius];
    const field = blendedField(entry, entry, 0);
    const out: Vector3 = [0, 0, 0];
    let totalSpeed = 0;
    let largest = 0;
    const steps = 20000;
    for (let step = 0; step < steps; step++) {
      stepRungeKutta(field, point, 0.005);
      if (step < 4000) continue;
      largest = Math.max(largest, Math.abs(point[0]), Math.abs(point[1]), Math.abs(point[2]));
      commonFrameDerivative(entry, point[0], point[1], point[2], out);
      totalSpeed += Math.hypot(out[0], out[1], out[2]);
    }
    expect(largest).toBeLessThan(1.1);
    expect(largest).toBeGreaterThan(0.6);
    const meanSpeed = totalSpeed / (steps - 4000);
    expect(meanSpeed).toBeGreaterThan(0.6);
    expect(meanSpeed).toBeLessThan(1.6);
  });

  it("holds a scattered swarm: once settled, hardly any particle escapes", () => {
    const swarm = new AttractorSwarm(400, createSeededRandom(5));
    const field = blendedField(entry, entry, 0);
    let respawned = 0;
    for (let step = 0; step < 1500; step++) {
      swarm.step(field, 1 / 60, 2);
      if (step >= 900) respawned += swarm.respawnedLastStep;
    }
    // Fewer than one particle in a hundred put back over the last ten seconds.
    expect(respawned).toBeLessThan(4);
    for (const value of swarm.positions) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("blendedField", () => {
  it("is exactly one attractor at either end and the average in the middle", () => {
    const [from, to] = calibrated;
    const a: Vector3 = [0, 0, 0];
    const b: Vector3 = [0, 0, 0];
    const mid: Vector3 = [0, 0, 0];
    commonFrameDerivative(from, 0.2, -0.3, 0.4, a);
    commonFrameDerivative(to, 0.2, -0.3, 0.4, b);
    const out: Vector3 = [0, 0, 0];
    blendedField(from, to, 0)(0.2, -0.3, 0.4, out);
    expect(out).toEqual(a);
    blendedField(from, to, 1)(0.2, -0.3, 0.4, out);
    expect(out).toEqual(b);
    blendedField(from, to, 0.5)(0.2, -0.3, 0.4, mid);
    for (let axis = 0; axis < 3; axis++) expect(mid[axis]).toBeCloseTo((a[axis] + b[axis]) / 2, 9);
  });

  it("keeps the swarm on screen all the way across every crossing", () => {
    for (let index = 0; index < calibrated.length; index++) {
      const from = calibrated[index];
      const to = calibrated[(index + 1) % calibrated.length];
      const swarm = new AttractorSwarm(200, createSeededRandom(9));
      for (let step = 0; step < 300; step++) swarm.step(blendedField(from, from, 0), 1 / 60, 2);
      let respawned = 0;
      const steps = 360;
      for (let step = 0; step < steps; step++) {
        swarm.step(blendedField(from, to, step / steps), 1 / 60, 2);
        respawned += swarm.respawnedLastStep;
      }
      // Some particles may be thrown out mid-crossing, but never most of the cloud at once.
      expect(respawned).toBeLessThan(200);
    }
  });
});

describe("AttractorSwarm", () => {
  it("starts every particle inside the spawn ball, reproducibly", () => {
    const first = new AttractorSwarm(100, createSeededRandom(3));
    const second = new AttractorSwarm(100, createSeededRandom(3));
    expect(Array.from(first.positions)).toEqual(Array.from(second.positions));
    for (let particle = 0; particle < 100; particle++) {
      const distance = Math.hypot(first.positions[particle * 3], first.positions[particle * 3 + 1], first.positions[particle * 3 + 2]);
      expect(distance).toBeLessThanOrEqual(SPAWN_RADIUS + 1e-6);
    }
  });

  it("remembers where each particle was, and how fast it moved", () => {
    const swarm = new AttractorSwarm(1, createSeededRandom(3));
    swarm.positions.set([0.1, 0.2, 0.3]);
    swarm.step((_x, _y, _z, out) => { out[0] = 2; out[1] = 0; out[2] = 0; }, 0.5);
    expect(Array.from(swarm.previousPositions)).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3])));
    expect(swarm.positions[0]).toBeCloseTo(1.1, 5);
    expect(swarm.speeds[0]).toBeCloseTo(2, 5);
  });

  it("puts back a particle that flies off, with no stroke behind it", () => {
    const swarm = new AttractorSwarm(1, createSeededRandom(3));
    swarm.step((_x, _y, _z, out) => { out[0] = 1000; out[1] = 0; out[2] = 0; }, 1);
    expect(swarm.respawnedLastStep).toBe(1);
    expect(Math.hypot(swarm.positions[0], swarm.positions[1], swarm.positions[2])).toBeLessThan(ESCAPE_RADIUS);
    expect(Array.from(swarm.previousPositions)).toEqual(Array.from(swarm.positions));
  });

  it("keeps existing particles when the count changes", () => {
    const swarm = new AttractorSwarm(10, createSeededRandom(3));
    const firstX = swarm.positions[0];
    swarm.setCount(25);
    expect(swarm.count).toBe(25);
    expect(swarm.positions[0]).toBe(firstX);
    swarm.setCount(4);
    expect(swarm.positions).toHaveLength(12);
    expect(swarm.positions[0]).toBe(firstX);
  });
});
