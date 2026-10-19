// A space backdrop for a game drawn in 3D with no depth of its own (Asteroids): something behind the
// playfield to see its motion and depth against, drawn in lines as the games are.  Pure geometry,
// in the room's metres with the eye at the origin looking down -z, y up:
//
//   stars          several hundred dots scattered on a shell 40-80 m away, all round;
//   a nebula       glowing contour lines of a noise field, laid on a patch of sky ahead and above;
//   a solar system a sun with rays, three planets (one ringed) on dotted orbits, far off to the left.
//
// Everything is dim (brightness well under the game's), so it frames the field without competing.

import { createSeededRandom, type RandomSource } from "@vector-demos/demo-kit";

export interface BackdropLines {
  /** x, y, z per line end, two ends a line (metres; a dot is a line of no length). */
  readonly positions: Float32Array;
  /** r, g, b, brightness per line. */
  readonly colours: Float32Array;
}

type Vec3 = [number, number, number];

/** A direction from azimuth (degrees, 0 ahead, positive to the right) and elevation (degrees up). */
function direction(azimuth: number, elevation: number): Vec3 {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

class LineSink {
  readonly positions: number[] = [];
  readonly colours: number[] = [];
  line(from: Vec3, to: Vec3, colour: readonly [number, number, number, number]): void {
    this.positions.push(...from, ...to);
    this.colours.push(...colour);
  }
  done(): BackdropLines {
    return { positions: Float32Array.from(this.positions), colours: Float32Array.from(this.colours) };
  }
}

/** Star counts and the shell they sit on. */
export const STAR_COUNT = 700;
export const STAR_NEAREST = 40;
export const STAR_FARTHEST = 80;

function stars(sink: LineSink, random: RandomSource): void {
  const tints: readonly (readonly [number, number, number])[] = [
    [1, 1, 1],
    [0.75, 0.85, 1],
    [1, 0.9, 0.7],
  ];
  for (let i = 0; i < STAR_COUNT; i += 1) {
    // Uniform on the sphere: z uniform in -1..1, angle uniform.
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    const distance = STAR_NEAREST + random() * (STAR_FARTHEST - STAR_NEAREST);
    const point: Vec3 = [ring * Math.cos(angle) * distance, z * distance, ring * Math.sin(angle) * distance];
    const tint = tints[Math.floor(random() * tints.length)];
    // Most faint, a few bright.
    const brightness = 0.12 + 0.5 * random() ** 3;
    sink.line(point, point, [tint[0], tint[1], tint[2], brightness]);
  }
}

/** Smooth value noise on a grid, summed over octaves (fractal), roughly 0..1. */
function fractalNoise(random: RandomSource): (x: number, y: number) => number {
  const size = 64;
  const lattice = Float32Array.from({ length: size * size }, () => random());
  const at = (x: number, y: number) => lattice[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return top + (bottom - top) * ty;
  };
  return (x, y) => {
    let total = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let octave = 0; octave < 4; octave += 1) {
      total += value(x * frequency, y * frequency) * amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return total / 0.9375;
  };
}

/** The nebula's patch of sky (degrees) and distance, and its contour levels with their colours. */
export const NEBULA = { azimuthFrom: -60, azimuthTo: 70, elevationFrom: 5, elevationTo: 55, distance: 60 };
const NEBULA_GRID = { across: 80, up: 34 };
/** How many grid cells one unit of the noise spans: larger is smoother, broader clouds. */
const NEBULA_SMOOTHNESS = 14;
const NEBULA_LEVELS: readonly { level: number; colour: readonly [number, number, number, number] }[] = [
  { level: 0.58, colour: [0.35, 0.3, 1, 0.07] },
  { level: 0.66, colour: [0.65, 0.3, 1, 0.1] },
  { level: 0.74, colour: [1, 0.45, 0.9, 0.13] },
];

/** Marching squares: the pieces of each contour level of the field, laid on the nebula's patch. */
function nebula(sink: LineSink, random: RandomSource): void {
  const noise = fractalNoise(random);
  const { across, up } = NEBULA_GRID;
  const field = new Float32Array(across * up);
  for (let j = 0; j < up; j += 1) {
    for (let i = 0; i < across; i += 1) {
      // Fainter towards the patch's edges, so the cloud has no hard border.
      const edge = Math.min(i, across - 1 - i, j, up - 1 - j) / 6;
      field[j * across + i] = noise(i / NEBULA_SMOOTHNESS, j / NEBULA_SMOOTHNESS) * Math.min(1, edge);
    }
  }
  const toSky = (i: number, j: number): Vec3 => {
    const azimuth = NEBULA.azimuthFrom + ((NEBULA.azimuthTo - NEBULA.azimuthFrom) * i) / (across - 1);
    const elevation = NEBULA.elevationFrom + ((NEBULA.elevationTo - NEBULA.elevationFrom) * j) / (up - 1);
    const d = direction(azimuth, elevation);
    return [d[0] * NEBULA.distance, d[1] * NEBULA.distance, d[2] * NEBULA.distance];
  };
  for (const { level, colour } of NEBULA_LEVELS) {
    for (let j = 0; j < up - 1; j += 1) {
      for (let i = 0; i < across - 1; i += 1) {
        const corners = [field[j * across + i], field[j * across + i + 1], field[(j + 1) * across + i + 1], field[(j + 1) * across + i]];
        const cornerAt: [number, number][] = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        // Where the level crosses each edge (top, right, bottom, left), if it does.
        const crossings: [number, number][] = [];
        for (let edge = 0; edge < 4; edge += 1) {
          const a = corners[edge];
          const b = corners[(edge + 1) % 4];
          if ((a >= level) === (b >= level)) continue;
          const t = (level - a) / (b - a);
          const [ax, ay] = cornerAt[edge];
          const [bx, by] = cornerAt[(edge + 1) % 4];
          crossings.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        }
        // Two crossings make a piece; four (a saddle) make two.
        for (let k = 0; k + 1 < crossings.length; k += 2) sink.line(toSky(...crossings[k]), toSky(...crossings[k + 1]), colour);
      }
    }
  }
}

/** The solar system's place in the sky (degrees) and distance, and its size (metres at that distance). */
export const SOLAR_SYSTEM = { azimuth: -55, elevation: 18, distance: 55 };

function solarSystem(sink: LineSink): void {
  // A plane facing the eye at the system's place, tilted so the orbits are ellipses.
  const centre = direction(SOLAR_SYSTEM.azimuth, SOLAR_SYSTEM.elevation).map((v) => v * SOLAR_SYSTEM.distance) as Vec3;
  const azimuth = (SOLAR_SYSTEM.azimuth * Math.PI) / 180;
  const right: Vec3 = [Math.cos(azimuth), 0, Math.sin(azimuth)];
  const upward: Vec3 = [0, 1, 0];
  const tilt = 0.35; // the orbits seen nearly edge on
  const onPlane = (x: number, y: number, lift = 0): Vec3 => [
    centre[0] + right[0] * x + upward[0] * (y * tilt + lift),
    centre[1] + right[1] * x + upward[1] * (y * tilt + lift),
    centre[2] + right[2] * x + upward[2] * (y * tilt + lift),
  ];
  const circle = (radius: number, x0: number, y0: number, colour: readonly [number, number, number, number], flat = true, steps = 32, dashed = false) => {
    for (let s = 0; s < steps; s += 1) {
      if (dashed && s % 2 === 1) continue;
      const a0 = (2 * Math.PI * s) / steps;
      const a1 = (2 * Math.PI * (s + 1)) / steps;
      const from = flat ? onPlane(x0 + radius * Math.cos(a0), y0 + radius * Math.sin(a0)) : onPlane(x0 + radius * Math.cos(a0), y0, radius * Math.sin(a0));
      const to = flat ? onPlane(x0 + radius * Math.cos(a1), y0 + radius * Math.sin(a1)) : onPlane(x0 + radius * Math.cos(a1), y0, radius * Math.sin(a1));
      sink.line(from, to, colour);
    }
  };
  const sunColour = [1, 0.8, 0.35, 0.55] as const;
  // The sun: a round disc (not on the tilted plane) with short rays.
  circle(1.6, 0, 0, sunColour, false, 40);
  for (let ray = 0; ray < 16; ray += 1) {
    const a = (2 * Math.PI * ray) / 16;
    sink.line(onPlane(Math.cos(a) * 2.1, 0, Math.sin(a) * 2.1), onPlane(Math.cos(a) * 2.8, 0, Math.sin(a) * 2.8), [1, 0.7, 0.3, 0.4]);
  }
  const orbitColour = [0.5, 0.6, 0.8, 0.14] as const;
  const planets: readonly { orbit: number; at: number; size: number; colour: readonly [number, number, number, number]; ring?: boolean }[] = [
    { orbit: 5, at: 2.2, size: 0.35, colour: [0.9, 0.5, 0.35, 0.45] },
    { orbit: 8.5, at: 4.1, size: 0.6, colour: [0.45, 0.75, 1, 0.45] },
    { orbit: 13, at: 0.9, size: 0.9, colour: [0.95, 0.85, 0.6, 0.45], ring: true },
  ];
  for (const planet of planets) {
    circle(planet.orbit, 0, 0, orbitColour, true, 72, true);
    const x = planet.orbit * Math.cos(planet.at);
    const y = planet.orbit * Math.sin(planet.at);
    // The planet itself faces the eye (not squashed by the tilt).
    const body = onPlane(x, y);
    for (let s = 0; s < 20; s += 1) {
      const a0 = (2 * Math.PI * s) / 20;
      const a1 = (2 * Math.PI * (s + 1)) / 20;
      const point = (a: number): Vec3 => [body[0] + right[0] * planet.size * Math.cos(a), body[1] + planet.size * Math.sin(a), body[2] + right[2] * planet.size * Math.cos(a)];
      sink.line(point(a0), point(a1), planet.colour);
    }
    if (planet.ring) {
      // A ring, seen tilted: an ellipse round the planet, wider than it is tall.
      for (let s = 0; s < 32; s += 1) {
        const a0 = (2 * Math.PI * s) / 32;
        const a1 = (2 * Math.PI * (s + 1)) / 32;
        const point = (a: number): Vec3 => [
          body[0] + right[0] * planet.size * 1.9 * Math.cos(a),
          body[1] + planet.size * 0.45 * Math.sin(a),
          body[2] + right[2] * planet.size * 1.9 * Math.cos(a),
        ];
        sink.line(point(a0), point(a1), [0.95, 0.85, 0.6, 0.3]);
      }
    }
  }
}

/** The whole backdrop, the same every time for a seed. */
export function spaceBackdrop(seed = 1979): BackdropLines {
  const random = createSeededRandom(seed);
  const sink = new LineSink();
  stars(sink, random);
  nebula(sink, random);
  solarSystem(sink);
  return sink.done();
}
