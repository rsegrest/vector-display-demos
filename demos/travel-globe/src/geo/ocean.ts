// Where to draw the little waves that mark open water. Points sit on a jittered, staggered grid that
// keeps roughly even spacing on the sphere, are dropped wherever land is, and are computed lazily in
// 10° tiles per zoom level, since the finest levels would be far too many points for the whole globe.

export const TILE_DEGREES = 10;
// Grid spacing in degrees for each level, and the zoom where it takes over: each level switches in
// before the waves drift more than about 50 world units apart on screen.
const LEVELS: readonly { readonly fromZoom: number; readonly spacing: number }[] = [
  { fromZoom: 0, spacing: 5 },
  { fromZoom: 1.4, spacing: 2.5 },
  { fromZoom: 2.7, spacing: 1.2 },
  { fromZoom: 5.7, spacing: 0.6 },
];
const MAX_LATITUDE = 78;

export class OceanField {
  private readonly cache = new Map<string, Float32Array>();

  public constructor(private readonly isLand: (lng: number, lat: number) => boolean) {}

  public get levelCount(): number {
    return LEVELS.length;
  }

  public levelFor(zoom: number): number {
    let level = 0;
    while (level + 1 < LEVELS.length && zoom >= LEVELS[level + 1].fromZoom) level++;
    return level;
  }

  // Wave positions in the tile containing (lng, lat), as a flat [lng, lat, ...] array.
  public tile(lng: number, lat: number, level: number): Float32Array {
    const tileLng = Math.floor(lng / TILE_DEGREES) * TILE_DEGREES;
    const tileLat = Math.floor(lat / TILE_DEGREES) * TILE_DEGREES;
    const key = `${level}:${tileLng}:${tileLat}`;
    let points = this.cache.get(key);
    if (!points) {
      points = this.computeTile(tileLng, tileLat, LEVELS[level].spacing);
      this.cache.set(key, points);
    }
    return points;
  }

  // The tile around a point and its eight neighbors.
  public tilesNear(lng: number, lat: number, level: number): Float32Array[] {
    const tiles: Float32Array[] = [];
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const tileLat = lat + dLat * TILE_DEGREES;
        if (tileLat < -90 || tileLat >= 90) continue;
        tiles.push(this.tile(wrap(lng + dLng * TILE_DEGREES), tileLat, level));
      }
    }
    return tiles;
  }

  private computeTile(tileLng: number, tileLat: number, spacing: number): Float32Array {
    const points: number[] = [];
    // Rows are global (aligned to the equator) so neighboring tiles line up.
    const firstRow = Math.ceil(tileLat / spacing);
    for (let row = firstRow; row * spacing < tileLat + TILE_DEGREES; row++) {
      const lat = row * spacing;
      if (Math.abs(lat) > MAX_LATITUDE) continue;
      // Widen the longitude step toward the poles so waves stay evenly spaced on the globe.
      const lngSpacing = spacing / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      const stagger = (row % 2) * 0.5;
      const firstColumn = Math.ceil(tileLng / lngSpacing - stagger);
      for (let column = firstColumn; (column + stagger) * lngSpacing < tileLng + TILE_DEGREES; column++) {
        const jitterLng = (hash(row, column) - 0.5) * 0.5 * lngSpacing;
        const jitterLat = (hash(column, row) - 0.5) * 0.4 * spacing;
        const lng = (column + stagger) * lngSpacing + jitterLng;
        const pointLat = lat + jitterLat;
        if (lng < tileLng || lng >= tileLng + TILE_DEGREES || pointLat < tileLat || pointLat >= tileLat + TILE_DEGREES) continue;
        if (this.isLand(lng, pointLat)) continue;
        points.push(lng, pointLat);
      }
    }
    return Float32Array.from(points);
  }
}

// A small deterministic hash in [0, 1), so the jitter is the same every frame.
function hash(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function wrap(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}
