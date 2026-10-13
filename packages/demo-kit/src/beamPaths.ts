// Shapes for the beam to trace. To draw a picture on an oscilloscope you move the
// beam round its outline over and over, fast enough that the eye sees the whole
// outline at once; play the beam's x and y positions through the left and right
// speakers and that picture is also a sound. A path here is one closed tour of a
// shape: its strokes in order, joined by quick jumps where the pen would lift.

import { ARCADE_FONT_METRICS, ARCADE_GLYPHS } from "@vector-display/font";

export type Point3 = readonly [number, number, number];

export interface Stroke {
  readonly points: readonly Point3[];
  readonly closed?: boolean;
}

export interface BeamPath {
  // x, y, z for each stop on the tour. The last stop is the first again.
  readonly points: Float32Array;
  // 1 if the beam draws its way to this stop, 0 if it jumps there with the pen up.
  readonly drawn: Uint8Array;
  // When the beam reaches each stop, as a fraction of one tour: 0 at the first, 1 at the last.
  readonly times: Float32Array;
  readonly stopCount: number;
}

// The beam crosses a gap between strokes this many times faster than it draws, so
// the jump shows only as a faint line, as it does on a real scope.
const JUMP_SPEED = 7;

// Joins strokes into one closed tour, centred on the origin and scaled to fit a
// unit sphere. Time along the tour is shared out by distance, so the beam moves at
// a steady speed while drawing.
export function buildPath(strokes: readonly Stroke[]): BeamPath {
  const stops: Point3[] = [];
  const drawn: boolean[] = [];
  const visit = (point: Point3, isDrawn: boolean): void => {
    stops.push(point);
    drawn.push(isDrawn);
  };
  // Each stop records whether the beam drew its way there or jumped: the first
  // point of every stroke is jumped to, the rest are drawn.
  for (const stroke of strokes) {
    stroke.points.forEach((point, index) => visit(point, index > 0));
    if (stroke.closed) visit(stroke.points[0], true);
  }
  // Close the tour with a jump back to the start, unless it already ends there.
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1] || first[2] !== last[2]) visit(first, false);

  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const stop of stops) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], stop[axis]);
      maximum[axis] = Math.max(maximum[axis], stop[axis]);
    }
  }
  const centre = [0, 1, 2].map((axis) => (minimum[axis] + maximum[axis]) / 2);
  let radius = 1e-9;
  for (const stop of stops) radius = Math.max(radius, Math.hypot(stop[0] - centre[0], stop[1] - centre[1], stop[2] - centre[2]));

  const points = new Float32Array(stops.length * 3);
  const times = new Float32Array(stops.length);
  const drawnFlags = Uint8Array.from(drawn, (isDrawn) => (isDrawn ? 1 : 0));
  let elapsed = 0;
  stops.forEach((stop, index) => {
    for (let axis = 0; axis < 3; axis++) points[index * 3 + axis] = (stop[axis] - centre[axis]) / radius;
    if (index > 0) {
      const previous = stops[index - 1];
      const distance = Math.hypot(stop[0] - previous[0], stop[1] - previous[1], stop[2] - previous[2]) / radius;
      elapsed += drawn[index] ? distance : distance / JUMP_SPEED;
    }
    times[index] = elapsed;
  });
  for (let index = 0; index < times.length; index++) times[index] = elapsed > 0 ? times[index] / elapsed : 0;
  times[times.length - 1] = 1;
  return { points, times, drawn: drawnFlags, stopCount: stops.length };
}

// Where the beam is at `time` (0..1 of a tour). `hint` is the stop to start
// searching from; pass the previous return value to make a steady sweep cheap.
export function samplePath(path: BeamPath, time: number, hint: number, out: [number, number, number]): number {
  const { points, times, stopCount } = path;
  let index = hint < stopCount - 1 && times[hint] <= time ? hint : 0;
  while (index < stopCount - 2 && times[index + 1] <= time) index++;
  const span = times[index + 1] - times[index];
  const amount = span > 0 ? Math.max(0, Math.min(1, (time - times[index]) / span)) : 0;
  const from = index * 3;
  const to = from + 3;
  out[0] = points[from] + (points[to] - points[from]) * amount;
  out[1] = points[from + 1] + (points[to + 1] - points[from + 1]) * amount;
  out[2] = points[from + 2] + (points[to + 2] - points[from + 2]) * amount;
  return index;
}

function flat(points: readonly (readonly [number, number])[], closed = true): Stroke {
  return { points: points.map(([x, y]) => [x, y, 0] as const), closed };
}

function polygonPoints(sides: number, step: number, phase = Math.PI / 2): [number, number][] {
  const points: [number, number][] = [];
  for (let index = 0; index < sides; index++) {
    const angle = phase + (index * step * Math.PI * 2) / sides;
    points.push([Math.cos(angle), Math.sin(angle)]);
  }
  return points;
}

export function starPath(): BeamPath {
  return buildPath([flat(polygonPoints(5, 2))]);
}

export function trianglePath(): BeamPath {
  return buildPath([flat(polygonPoints(3, 1))]);
}

// Out along a spiral and straight back in along the next arm, so the tour closes without a jump.
export function spiralPath(): BeamPath {
  const points: [number, number][] = [];
  const turns = 4;
  const steps = 160;
  for (let step = 0; step <= steps; step++) {
    const amount = step / steps;
    const angle = amount * turns * Math.PI * 2;
    points.push([Math.cos(angle) * amount, Math.sin(angle) * amount]);
  }
  for (let step = steps; step >= 0; step--) {
    const amount = step / steps;
    const angle = amount * turns * Math.PI * 2 + Math.PI;
    points.push([Math.cos(angle) * amount, Math.sin(angle) * amount]);
  }
  return buildPath([flat(points)]);
}

export function heartPath(): BeamPath {
  const points: [number, number][] = [];
  const steps = 96;
  for (let step = 0; step < steps; step++) {
    const angle = (step / steps) * Math.PI * 2;
    const sine = Math.sin(angle);
    points.push([16 * sine * sine * sine, 13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)]);
  }
  return buildPath([flat(points)]);
}

// A walk along every edge of the cube that ends where it began. Each corner has
// three edges, so no walk can cover them all exactly once; four are retraced.
export function cubePath(): BeamPath {
  const corner = (index: number): Point3 => [index & 1 ? 1 : -1, index & 2 ? 1 : -1, index & 4 ? 1 : -1];
  const walk = [0, 1, 3, 2, 0, 4, 5, 1, 5, 7, 3, 7, 6, 2, 6, 4];
  return buildPath([{ points: walk.map(corner), closed: true }]);
}

// Every corner of the octahedron has four edges, so one walk covers each edge exactly once.
export function octahedronPath(): BeamPath {
  const corners: Point3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const walk = [0, 2, 4, 3, 5, 2, 1, 3, 0, 4, 1, 5];
  return buildPath([{ points: walk.map((index) => corners[index]), closed: true }]);
}

// The strokes of a line of text in the vector font: x to the right from 0, y up,
// capitals six units tall. Characters the font lacks are skipped but keep their space.
export function glyphStrokes(text: string): Stroke[] {
  const advance = ARCADE_FONT_METRICS.glyphWidth + ARCADE_FONT_METRICS.letterSpacing;
  const strokes: Stroke[] = [];
  [...text].forEach((character, index) => {
    for (const polyline of ARCADE_GLYPHS[character] ?? []) {
      if (polyline.points.length < 2) continue;
      strokes.push({
        // Glyphs are drawn y-down; here y is up.
        points: polyline.points.map((point) => [point.x + index * advance, ARCADE_FONT_METRICS.capHeight - point.y, 0] as const),
        closed: polyline.isClosed,
      });
    }
  });
  return strokes;
}

// A word in the vector font as one tour. The gaps between letters and strokes become jumps.
export function textPath(text: string): BeamPath {
  const strokes = glyphStrokes(text);
  if (strokes.length === 0) throw new Error(`no glyphs to trace for "${text}"`);
  return buildPath(strokes);
}
