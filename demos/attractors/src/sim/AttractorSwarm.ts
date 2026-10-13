import type { RandomSource } from "@vector-demos/demo-kit";
import { stepRungeKutta, type Vector3 } from "./attractors.js";

type Field = (x: number, y: number, z: number, out: Vector3) => void;

// Beyond this many radii a particle has left the attractor's basin and is on its
// way to infinity; it is put back near the middle instead.
export const ESCAPE_RADIUS = 4;
// New and returned particles start inside a ball of this radius.
export const SPAWN_RADIUS = 0.6;

// A cloud of independent particles, all following the same field in the common
// frame. Each keeps its previous position, so it can be drawn as the stroke it
// just travelled.
export class AttractorSwarm {
  public positions: Float32Array;
  public previousPositions: Float32Array;
  // Distance covered in the last step, per unit of time: the local flow speed.
  public speeds: Float32Array;
  // How many particles had to be put back during the last step.
  public respawnedLastStep = 0;

  private countValue: number;
  private readonly point: Vector3 = [0, 0, 0];

  public constructor(
    count: number,
    private readonly random: RandomSource,
  ) {
    this.countValue = count;
    this.positions = new Float32Array(count * 3);
    this.previousPositions = new Float32Array(count * 3);
    this.speeds = new Float32Array(count);
    this.scatter();
  }

  public get count(): number {
    return this.countValue;
  }

  // Throws every particle back into the starting ball, to watch them find the attractor again.
  public scatter(): void {
    for (let particle = 0; particle < this.countValue; particle++) this.spawn(particle);
  }

  public setCount(count: number): void {
    if (count === this.countValue) return;
    const kept = Math.min(count, this.countValue);
    const positions = new Float32Array(count * 3);
    const previousPositions = new Float32Array(count * 3);
    positions.set(this.positions.subarray(0, kept * 3));
    previousPositions.set(this.previousPositions.subarray(0, kept * 3));
    const speeds = new Float32Array(count);
    speeds.set(this.speeds.subarray(0, kept));
    const previousCount = this.countValue;
    this.positions = positions;
    this.previousPositions = previousPositions;
    this.speeds = speeds;
    this.countValue = count;
    for (let particle = previousCount; particle < count; particle++) this.spawn(particle);
  }

  // Advances every particle by `duration` of common-frame time, in `substeps` equal pieces.
  public step(field: Field, duration: number, substeps = 1): void {
    const { positions, previousPositions, point } = this;
    const stepSize = duration / substeps;
    this.respawnedLastStep = 0;
    for (let particle = 0; particle < this.countValue; particle++) {
      const offset = particle * 3;
      const startX = positions[offset];
      const startY = positions[offset + 1];
      const startZ = positions[offset + 2];
      point[0] = startX;
      point[1] = startY;
      point[2] = startZ;
      for (let substep = 0; substep < substeps; substep++) stepRungeKutta(field, point, stepSize);
      const distanceSquared = point[0] * point[0] + point[1] * point[1] + point[2] * point[2];
      if (!(distanceSquared < ESCAPE_RADIUS * ESCAPE_RADIUS)) {
        this.spawn(particle);
        this.respawnedLastStep++;
        continue;
      }
      previousPositions[offset] = startX;
      previousPositions[offset + 1] = startY;
      previousPositions[offset + 2] = startZ;
      positions[offset] = point[0];
      positions[offset + 1] = point[1];
      positions[offset + 2] = point[2];
      this.speeds[particle] = duration > 0 ? Math.hypot(point[0] - startX, point[1] - startY, point[2] - startZ) / duration : 0;
    }
  }

  // A uniformly random point in the starting ball, with no stroke behind it.
  private spawn(particle: number): void {
    let x = 0;
    let y = 0;
    let z = 0;
    do {
      x = this.random() * 2 - 1;
      y = this.random() * 2 - 1;
      z = this.random() * 2 - 1;
    } while (x * x + y * y + z * z > 1);
    const offset = particle * 3;
    this.positions[offset] = this.previousPositions[offset] = x * SPAWN_RADIUS;
    this.positions[offset + 1] = this.previousPositions[offset + 1] = y * SPAWN_RADIUS;
    this.positions[offset + 2] = this.previousPositions[offset + 2] = z * SPAWN_RADIUS;
    this.speeds[particle] = 0;
  }
}
