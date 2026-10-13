// Planar helpers for lng/lat rings stored as flat [lng, lat, lng, lat, ...] arrays.
// Planar is accurate enough at country scale for hatching and hit testing.

export type Ring = ArrayLike<number>;

export interface Bounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface HatchLine {
  readonly lat: number;
  readonly lngStart: number;
  readonly lngEnd: number;
}

const MIN_LINES = 3;

export function ringsBounds(rings: readonly Ring[]): Bounds {
  const bounds = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity };
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 2) {
      bounds.minLng = Math.min(bounds.minLng, ring[i]);
      bounds.maxLng = Math.max(bounds.maxLng, ring[i]);
      bounds.minLat = Math.min(bounds.minLat, ring[i + 1]);
      bounds.maxLat = Math.max(bounds.maxLat, ring[i + 1]);
    }
  }
  return bounds;
}

// Even-odd rule across all rings, so a hole (or an enclave) counts as outside.
export function pointInRings(lng: number, lat: number, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const lngI = ring[i];
      const latI = ring[i + 1];
      const lngJ = ring[j];
      const latJ = ring[j + 1];
      if (latI > lat !== latJ > lat && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) inside = !inside;
    }
  }
  return inside;
}

// Parallels (constant latitude) clipped to the shape: a pen-plotter style fill for a vector display.
// Lines sit on a global grid (latitude = (n + 0.5 + phase) × step), so neighboring shapes line up;
// phase in [0, 1) slides them by a fraction of the spacing, for animation. Spacing shrinks for small
// shapes so even a tiny island gets a few lines.
export function hatchSegments(rings: readonly Ring[], spacing: number, phase = 0): HatchLine[] {
  const bounds = ringsBounds(rings);
  const height = bounds.maxLat - bounds.minLat;
  if (!(height > 0)) return [];
  const step = Math.min(spacing, height / MIN_LINES);
  const offset = 0.5 + phase;
  const lines: HatchLine[] = [];
  const crossings: number[] = [];
  const first = Math.ceil(bounds.minLat / step - offset);
  for (let n = first; (n + offset) * step < bounds.maxLat; n++) {
    const lat = (n + offset) * step;
    if (lat <= bounds.minLat) continue;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const latI = ring[i + 1];
        const latJ = ring[j + 1];
        if (latI > lat === latJ > lat) continue;
        crossings.push(ring[i] + ((ring[j] - ring[i]) * (lat - latI)) / (latJ - latI));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      lines.push({ lat: Math.round(lat * 1e6) / 1e6, lngStart: crossings[k], lngEnd: crossings[k + 1] });
    }
  }
  return lines;
}

export interface AngledHatchLine {
  readonly lng0: number;
  readonly lat0: number;
  readonly lng1: number;
  readonly lat1: number;
}

// Parallel lines at an angle (radians, counterclockwise from east), clipped to the shape: rotate the
// shape, hatch it with horizontal lines, and rotate the lines back.
export function angledHatchSegments(rings: readonly Ring[], spacing: number, angle: number): AngledHatchLine[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotated = rings.map((ring) => {
    const out = new Float64Array(ring.length);
    for (let i = 0; i < ring.length; i += 2) {
      out[i] = ring[i] * cos + ring[i + 1] * sin;
      out[i + 1] = -ring[i] * sin + ring[i + 1] * cos;
    }
    return out;
  });
  return hatchSegments(rotated, spacing).map((line) => ({
    lng0: line.lngStart * cos - line.lat * sin,
    lat0: line.lngStart * sin + line.lat * cos,
    lng1: line.lngEnd * cos - line.lat * sin,
    lat1: line.lngEnd * sin + line.lat * cos,
  }));
}
