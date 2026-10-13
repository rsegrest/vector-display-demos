// Strange attractors: three coupled equations each, whose solutions never settle
// and never repeat, yet stay on one intricate shape for ever. Every system here
// lives at its own size and runs at its own pace (Lorenz spans about fifty units,
// Aizawa about three), so each is measured once and from then on handled in a
// common frame: centred on the origin, about one unit in radius, moving at about
// one unit per unit of time. In that frame two systems can simply be averaged,
// which is how the demo flows from one attractor into the next.

export type Vector3 = [number, number, number];

export interface Attractor {
  readonly name: string;
  // Writes the rate of change at (x, y, z) into `out`.
  readonly derivative: (x: number, y: number, z: number, out: Vector3) => void;
  // A point known to fall onto the attractor.
  readonly seed: Readonly<Vector3>;
  // A time step that integrates this system accurately in its own units.
  readonly stepSeconds: number;
}

export const ATTRACTORS: readonly Attractor[] = [
  {
    name: "LORENZ",
    derivative: (x, y, z, out) => {
      out[0] = 10 * (y - x);
      out[1] = x * (28 - z) - y;
      out[2] = x * y - (8 / 3) * z;
    },
    seed: [0.1, 0, 20],
    stepSeconds: 0.005,
  },
  {
    name: "AIZAWA",
    derivative: (x, y, z, out) => {
      out[0] = (z - 0.7) * x - 3.5 * y;
      out[1] = 3.5 * x + (z - 0.7) * y;
      out[2] = 0.6 + 0.95 * z - (z * z * z) / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x;
    },
    seed: [0.1, 0, 0],
    stepSeconds: 0.01,
  },
  {
    name: "THOMAS",
    derivative: (x, y, z, out) => {
      out[0] = Math.sin(y) - 0.208186 * x;
      out[1] = Math.sin(z) - 0.208186 * y;
      out[2] = Math.sin(x) - 0.208186 * z;
    },
    seed: [1.1, 1.1, -0.01],
    stepSeconds: 0.05,
  },
  {
    name: "HALVORSEN",
    derivative: (x, y, z, out) => {
      out[0] = -1.89 * x - 4 * y - 4 * z - y * y;
      out[1] = -1.89 * y - 4 * z - 4 * x - z * z;
      out[2] = -1.89 * z - 4 * x - 4 * y - x * x;
    },
    seed: [-1.48, -1.51, 2.04],
    stepSeconds: 0.004,
  },
  {
    name: "ROSSLER",
    derivative: (x, y, z, out) => {
      out[0] = -y - z;
      out[1] = x + 0.2 * y;
      out[2] = 0.2 + z * (x - 5.7);
    },
    seed: [1, 1, 0],
    stepSeconds: 0.02,
  },
  {
    name: "DADRAS",
    derivative: (x, y, z, out) => {
      out[0] = y - 3 * x + 2.7 * y * z;
      out[1] = 1.7 * y - x * z + z;
      out[2] = 2 * x * y - 9 * z;
    },
    seed: [1.1, 2.1, -2],
    stepSeconds: 0.005,
  },
];

// An attractor together with what is needed to bring it into the common frame.
export interface CalibratedAttractor {
  readonly attractor: Attractor;
  // Middle of the attractor's bounding box, in its own units.
  readonly centre: Readonly<Vector3>;
  // Half the longest side of that box: the attractor fits in [-1, 1] once divided by this.
  readonly radius: number;
  // Average speed along the attractor, in radii per unit of its own time.
  readonly pace: number;
}

const scratch: Vector3 = [0, 0, 0];
const k1: Vector3 = [0, 0, 0];
const k2: Vector3 = [0, 0, 0];
const k3: Vector3 = [0, 0, 0];
const k4: Vector3 = [0, 0, 0];

type Field = (x: number, y: number, z: number, out: Vector3) => void;

// One classical fourth-order Runge-Kutta step of `field`, advancing `point` in place.
export function stepRungeKutta(field: Field, point: Vector3, stepSize: number): void {
  const [x, y, z] = point;
  field(x, y, z, k1);
  field(x + (k1[0] * stepSize) / 2, y + (k1[1] * stepSize) / 2, z + (k1[2] * stepSize) / 2, k2);
  field(x + (k2[0] * stepSize) / 2, y + (k2[1] * stepSize) / 2, z + (k2[2] * stepSize) / 2, k3);
  field(x + k3[0] * stepSize, y + k3[1] * stepSize, z + k3[2] * stepSize, k4);
  point[0] = x + (stepSize / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
  point[1] = y + (stepSize / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
  point[2] = z + (stepSize / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
}

const SETTLE_STEPS = 3000;
const MEASURE_STEPS = 100000;

// Follows one trajectory from the seed, lets it settle onto the attractor, then
// measures the box it stays inside and how fast it travels.
export function calibrate(attractor: Attractor): CalibratedAttractor {
  const point: Vector3 = [...attractor.seed];
  for (let step = 0; step < SETTLE_STEPS; step++) stepRungeKutta(attractor.derivative, point, attractor.stepSeconds);
  const minimum: Vector3 = [Infinity, Infinity, Infinity];
  const maximum: Vector3 = [-Infinity, -Infinity, -Infinity];
  let totalSpeed = 0;
  for (let step = 0; step < MEASURE_STEPS; step++) {
    stepRungeKutta(attractor.derivative, point, attractor.stepSeconds);
    for (let axis = 0; axis < 3; axis++) {
      if (point[axis] < minimum[axis]) minimum[axis] = point[axis];
      if (point[axis] > maximum[axis]) maximum[axis] = point[axis];
    }
    attractor.derivative(point[0], point[1], point[2], scratch);
    totalSpeed += Math.hypot(scratch[0], scratch[1], scratch[2]);
  }
  const radius = Math.max(maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]) / 2;
  return {
    attractor,
    centre: [(minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2, (minimum[2] + maximum[2]) / 2],
    radius,
    pace: totalSpeed / MEASURE_STEPS / radius,
  };
}

// The attractor's equations in the common frame: positions in radii from its
// centre, time scaled so the average speed is one.
export function commonFrameDerivative(calibrated: CalibratedAttractor, x: number, y: number, z: number, out: Vector3): void {
  const { attractor, centre, radius, pace } = calibrated;
  attractor.derivative(centre[0] + x * radius, centre[1] + y * radius, centre[2] + z * radius, out);
  const scale = 1 / (radius * pace);
  out[0] *= scale;
  out[1] *= scale;
  out[2] *= scale;
}

const blendScratch: Vector3 = [0, 0, 0];

// A field part-way between two attractors: amount 0 is `from`, 1 is `to`. Averaging
// the equations, rather than the pictures, means every particle keeps moving under
// one consistent law the whole way across.
export function blendedField(from: CalibratedAttractor, to: CalibratedAttractor, amount: number): Field {
  if (amount <= 0) return (x, y, z, out) => commonFrameDerivative(from, x, y, z, out);
  if (amount >= 1) return (x, y, z, out) => commonFrameDerivative(to, x, y, z, out);
  return (x, y, z, out) => {
    commonFrameDerivative(from, x, y, z, blendScratch);
    const fromX = blendScratch[0];
    const fromY = blendScratch[1];
    const fromZ = blendScratch[2];
    commonFrameDerivative(to, x, y, z, out);
    out[0] = fromX + (out[0] - fromX) * amount;
    out[1] = fromY + (out[1] - fromY) * amount;
    out[2] = fromZ + (out[2] - fromZ) * amount;
  };
}
