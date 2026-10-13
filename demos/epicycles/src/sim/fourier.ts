// Any closed path can be drawn by a chain of circles, each turning at a steady
// whole-number speed with its centre riding on the rim of the one before. The
// Fourier transform is what tells you which circles: treat the path as a list of
// points in the plane, and for each turning speed it gives a radius and a starting
// angle. Add the fastest circles last and the tip of the chain traces the path;
// stop early and it traces a smoothed version of it.

import { samplePath, type BeamPath } from "@vector-demos/demo-kit";

export interface SampledPath {
  readonly x: Float64Array;
  readonly y: Float64Array;
  // 1 where the beam is drawing, 0 where it is jumping between strokes with the pen up.
  readonly drawn: Uint8Array;
  readonly count: number;
}

// One circle of the chain.
export interface Epicycle {
  // Whole turns per trip round the path; negative turns the other way. 0 is a fixed offset.
  readonly frequency: number;
  readonly radius: number;
  // Angle at the start of the trip, in radians.
  readonly phase: number;
}

// The path at `count` moments evenly spaced through one trip round it.
export function resamplePath(path: BeamPath, count: number): SampledPath {
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const drawn = new Uint8Array(count);
  const point: [number, number, number] = [0, 0, 0];
  let hint = 0;
  for (let index = 0; index < count; index++) {
    hint = samplePath(path, index / count, hint, point);
    x[index] = point[0];
    y[index] = point[1];
    // The beam is on its way to the stop after `hint`.
    drawn[index] = path.drawn[Math.min(path.stopCount - 1, hint + 1)];
  }
  return { x, y, drawn, count };
}

// The circles that reproduce the sampled path: one per turning speed from -count/2
// up to count/2 - 1. The fixed offset comes first, then the rest from largest to
// smallest, which is the order that makes each added circle matter least.
export function epicyclesFor(samples: SampledPath): Epicycle[] {
  const { x, y, count } = samples;
  const epicycles: Epicycle[] = [];
  const half = Math.floor(count / 2);
  for (let frequency = -half; frequency < count - half; frequency++) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < count; index++) {
      const angle = (-2 * Math.PI * frequency * index) / count;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      real += x[index] * cosine - y[index] * sine;
      imaginary += x[index] * sine + y[index] * cosine;
    }
    real /= count;
    imaginary /= count;
    epicycles.push({ frequency, radius: Math.hypot(real, imaginary), phase: Math.atan2(imaginary, real) });
  }
  return epicycles.sort((first, second) => {
    if (first.frequency === 0) return -1;
    if (second.frequency === 0) return 1;
    return second.radius - first.radius;
  });
}

// Where every joint of the chain is at `time` (0..1 of a trip), using the first
// `termCount` circles. Writes x, y pairs into `joints`: entry 0 is the origin,
// entry k the centre of circle k (the rim point of circle k - 1), and the last
// written entry the tip. Returns the number of joints written, termCount + 1.
export function chainAt(epicycles: readonly Epicycle[], termCount: number, time: number, joints: Float64Array): number {
  const used = Math.min(termCount, epicycles.length);
  let x = 0;
  let y = 0;
  joints[0] = 0;
  joints[1] = 0;
  for (let index = 0; index < used; index++) {
    const { frequency, radius, phase } = epicycles[index];
    const angle = 2 * Math.PI * frequency * time + phase;
    x += radius * Math.cos(angle);
    y += radius * Math.sin(angle);
    joints[(index + 1) * 2] = x;
    joints[(index + 1) * 2 + 1] = y;
  }
  return used + 1;
}

// How far, on average, the tip of a chain of `termCount` circles is from the path it is meant to trace.
export function meanError(epicycles: readonly Epicycle[], termCount: number, samples: SampledPath): number {
  const joints = new Float64Array((epicycles.length + 1) * 2);
  let total = 0;
  for (let index = 0; index < samples.count; index++) {
    const count = chainAt(epicycles, termCount, index / samples.count, joints);
    total += Math.hypot(joints[(count - 1) * 2] - samples.x[index], joints[(count - 1) * 2 + 1] - samples.y[index]);
  }
  return total / samples.count;
}
