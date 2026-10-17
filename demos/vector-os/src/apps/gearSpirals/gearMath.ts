// The mathematics of a gear rolling around a fixed ring with a pen in it, apart from any drawing.
//
// Version one has a single base shape, a circle, so these functions take the circle's radius
// directly. Other bases (an ellipse, a rounded bar) would need the pen's path to be worked out
// by rolling along an outline instead of by a closed formula; that would sit beside these
// functions behind a common "base shape" interface, and nothing here would need to change.

// Whether the gear rolls around the inside of the ring (a hypotrochoid) or the outside (an epitrochoid).
export type RollMode = "inside" | "outside";

export interface SpiralParameters {
  readonly mode: RollMode;
  // R: the fixed ring's radius.
  readonly baseRadius: number;
  // r: the rolling gear's radius.
  readonly gearRadius: number;
  // d: how far the pen sits from the rolling gear's centre.
  readonly penDistance: number;
}

export interface Point {
  x: number;
  y: number;
}

// How a curve closes: after this many trips of the gear around the base, having drawn this many petals.
export interface Closure {
  readonly trips: number;
  readonly petals: number;
}

// The curve counts as closed when, after a whole number of trips, the gear is within this
// fraction of a turn of where it started: at the sizes the program draws, a ten-thousandth of a
// turn leaves a gap far smaller than a pixel. The tolerance has to be this tight because some
// number of trips always comes close: within N trips there is always one that comes back within
// 1/N of a turn, so a loose tolerance would find every curve closing eventually.
export const CLOSURE_TOLERANCE_TURNS = 1e-4;
// A curve that needs more trips than this to close is reported as never closing. Whole-number
// sizes always close sooner: after r / gcd(R, r) trips, and r is at most 150.
export const MAXIMUM_CLOSING_TRIPS = 200;

// The radius of the circle the gear's centre travels on, and how many times the gear turns
// (relative to the line from the base's centre to its own) for each radian it travels.
export function gearOrbit(parameters: SpiralParameters): { readonly orbitRadius: number; readonly spinRatio: number } {
  const { mode, baseRadius, gearRadius } = parameters;
  const orbitRadius = mode === "inside" ? baseRadius - gearRadius : baseRadius + gearRadius;
  return { orbitRadius, spinRatio: orbitRadius / gearRadius };
}

// Where the rolling gear's centre is at time t, in the curve's own coordinates (y up, base centre at the origin).
export function gearCentreAt(parameters: SpiralParameters, t: number, out: Point): Point {
  const { orbitRadius } = gearOrbit(parameters);
  out.x = orbitRadius * Math.cos(t);
  out.y = orbitRadius * Math.sin(t);
  return out;
}

// Where the pen is at time t, in the same coordinates. Inside:
//   x = (R − r)·cos t + d·cos(((R − r)/r)·t),  y = (R − r)·sin t − d·sin(((R − r)/r)·t)
// Outside:
//   x = (R + r)·cos t − d·cos(((R + r)/r)·t),  y = (R + r)·sin t − d·sin(((R + r)/r)·t)
// Written into `out`, so that drawing thousands of points a second allocates nothing.
export function penPointAt(parameters: SpiralParameters, t: number, out: Point): Point {
  const { orbitRadius, spinRatio } = gearOrbit(parameters);
  const d = parameters.penDistance;
  const sign = parameters.mode === "inside" ? 1 : -1;
  out.x = orbitRadius * Math.cos(t) + sign * d * Math.cos(spinRatio * t);
  out.y = orbitRadius * Math.sin(t) - d * Math.sin(spinRatio * t);
  return out;
}

// The fastest the pen can move, in units per radian of t: the gear's centre moves at its
// orbit's radius, and the pen swings round it at d times the spin ratio. Dividing a wanted
// step length by this gives a step in t that never draws a longer line than that.
export function maximumPenSpeed(parameters: SpiralParameters): number {
  const { orbitRadius, spinRatio } = gearOrbit(parameters);
  return Math.abs(orbitRadius) + parameters.penDistance * Math.abs(spinRatio);
}

// After how many trips around the base the curve comes back to where it started, or null if it never does.
//
// The pen is back at its start when t is a whole number of turns (the gear is back at its
// place on the base) and the gear has also turned a whole number of times. In t = 2πk the
// gear turns k·R/r times, counting the petals, so the curve closes after the smallest k for
// which k·R/r is a whole number. That is found from the continued fraction of R/r: its
// convergents h/k are its best approximations, in the sense that no smaller k comes closer to
// a whole number than a convergent's does, so the first convergent within the tolerance gives
// the fewest trips. Sizes that are whole numbers always close; those typed with many
// decimals may not, and are reported as never closing.
export function findClosure(parameters: SpiralParameters, toleranceTurns = CLOSURE_TOLERANCE_TURNS, maximumTrips = MAXIMUM_CLOSING_TRIPS): Closure | null {
  const ratio = parameters.baseRadius / parameters.gearRadius;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  // With the pen at the gear's centre the curve is a plain circle, closed after one trip.
  if (parameters.penDistance === 0) return { trips: 1, petals: 0 };
  let previousNumerator = 1;
  let numerator = Math.floor(ratio);
  let previousDenominator = 0;
  let denominator = 1;
  let remainder = ratio - Math.floor(ratio);
  for (let term = 0; term < 64 && denominator <= maximumTrips; term++) {
    if (Math.abs(denominator * ratio - numerator) <= toleranceTurns) return { trips: denominator, petals: numerator };
    if (remainder < 1e-12) break;
    const inverse = 1 / remainder;
    const next = Math.floor(inverse);
    remainder = inverse - next;
    [previousNumerator, numerator] = [numerator, next * numerator + previousNumerator];
    [previousDenominator, denominator] = [denominator, next * denominator + previousDenominator];
  }
  return null;
}

// A size as it is shown and typed: whole numbers bare, others to at most two decimal places.
export function formatSize(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "");
}

// The two lines of the curve's equation, with the current sizes put in for R, r and d.
// They use the true minus sign and a middle dot for multiplying, as a book would print them.
export function equationLines(parameters: SpiralParameters): readonly [string, string] {
  const R = formatSize(parameters.baseRadius);
  const r = formatSize(parameters.gearRadius);
  const d = formatSize(parameters.penDistance);
  const sum = parameters.mode === "inside" ? `(${R} − ${r})` : `(${R} + ${r})`;
  const spin = `((${sum.slice(1, -1)})/${r})`;
  const xJoin = parameters.mode === "inside" ? "+" : "−";
  return [`x(t) = ${sum}·cos t ${xJoin} ${d}·cos(${spin}·t)`, `y(t) = ${sum}·sin t − ${d}·sin(${spin}·t)`];
}
