import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@vector-demos/demo-kit";
import { ParticleWorld } from "../src/sim/ParticleWorld.js";
import { createRandomRules } from "../src/sim/rules.js";
import { interactionForce } from "../src/sim/force.js";

function createWorld(seed = 11, particleCount = 600) {
  const random = createSeededRandom(seed);
  const rules = createRandomRules(random, 5);
  return new ParticleWorld({
    width: 900,
    height: 600,
    particleCount,
    rules,
    random,
    interactionRadius: 60,
  });
}

// Reference O(n²) accelerations, to check the spatial grid finds every neighbor.
function bruteForceAccelerations(world: ParticleWorld): Float32Array {
  const { positionX, positionY, species, particleCount, width, height } = world;
  const radius = world.settings.interactionRadius;
  const out = new Float32Array(particleCount * 2);
  for (let i = 0; i < particleCount; i++) {
    let sumX = 0;
    let sumY = 0;
    for (let j = 0; j < particleCount; j++) {
      if (i === j) continue;
      let dx = positionX[j] - positionX[i];
      let dy = positionY[j] - positionY[i];
      if (dx > width / 2) dx -= width;
      else if (dx < -width / 2) dx += width;
      if (dy > height / 2) dy -= height;
      else if (dy < -height / 2) dy += height;
      const distance = Math.hypot(dx, dy);
      if (distance <= 0 || distance >= radius) continue;
      const attraction = world.attraction[species[i] * world.speciesCount + species[j]];
      const force = interactionForce(distance / radius, attraction, world.settings.repulsionRadius);
      sumX += (dx / distance) * force;
      sumY += (dy / distance) * force;
    }
    out[i * 2] = sumX * radius * world.settings.forceScale;
    out[i * 2 + 1] = sumY * radius * world.settings.forceScale;
  }
  return out;
}

describe("ParticleWorld", () => {
  it("places particles inside the world with species spread evenly", () => {
    const world = createWorld();
    const counts = new Array(world.speciesCount).fill(0);
    for (let i = 0; i < world.particleCount; i++) {
      expect(world.positionX[i]).toBeGreaterThanOrEqual(0);
      expect(world.positionX[i]).toBeLessThan(world.width);
      expect(world.positionY[i]).toBeGreaterThanOrEqual(0);
      expect(world.positionY[i]).toBeLessThan(world.height);
      counts[world.species[i]]++;
    }
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("computes the same accelerations as a brute-force pass, including across the wrapped edges", () => {
    const world = createWorld();
    // Put a pair across the left/right seam so wrapping is exercised directly.
    world.positionX[0] = 2;
    world.positionY[0] = 300;
    world.positionX[1] = 897;
    world.positionY[1] = 300;
    world.computeAccelerations();
    const expected = bruteForceAccelerations(world);
    for (let i = 0; i < world.particleCount * 2; i++) {
      expect(world.acceleration[i]).toBeCloseTo(expected[i], 3);
    }
    expect(Math.abs(world.acceleration[0])).toBeGreaterThan(0);
  });

  it("keeps particles inside the torus after many steps", () => {
    const world = createWorld();
    for (let step = 0; step < 120; step++) world.step(1 / 60);
    for (let i = 0; i < world.particleCount; i++) {
      expect(world.positionX[i]).toBeGreaterThanOrEqual(0);
      expect(world.positionX[i]).toBeLessThan(world.width);
      expect(world.positionY[i]).toBeGreaterThanOrEqual(0);
      expect(world.positionY[i]).toBeLessThan(world.height);
      expect(Number.isFinite(world.velocityX[i])).toBe(true);
    }
  });

  it("is deterministic for a seed", () => {
    const first = createWorld(21);
    const second = createWorld(21);
    for (let step = 0; step < 30; step++) {
      first.step(1 / 60);
      second.step(1 / 60);
    }
    expect(Array.from(first.positionX)).toEqual(Array.from(second.positionX));
  });

  it("pulls particles toward an attractor point", () => {
    const world = createWorld(4, 50);
    world.attraction.fill(0);
    world.setAttractor({ x: 450, y: 300, strength: 1, radius: 400 });
    const before = Math.hypot(world.positionX[0] - 450, world.positionY[0] - 300);
    for (let step = 0; step < 30; step++) world.step(1 / 60);
    const after = Math.hypot(world.positionX[0] - 450, world.positionY[0] - 300);
    expect(after).toBeLessThan(before);
  });

  it("rescales positions when the world is resized", () => {
    const world = createWorld();
    const x = world.positionX[3];
    const y = world.positionY[3];
    world.resize(1800, 600);
    expect(world.positionX[3]).toBeCloseTo(x * 2, 3);
    expect(world.positionY[3]).toBeCloseTo(y, 3);
  });

  it("changes species count by reassigning species and resizing the matrix", () => {
    const world = createWorld();
    world.setRules(createRandomRules(createSeededRandom(2), 3));
    expect(world.speciesCount).toBe(3);
    expect(world.attraction.length).toBe(9);
    expect(Math.max(...world.species)).toBe(2);
  });
});
