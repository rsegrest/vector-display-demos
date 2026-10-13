// Reading the two public feeds the demo runs on.
//
// Satellites come as "two-line elements": a name line followed by two fixed-width
// lines of orbital numbers, the form tracking data has been exchanged in since the
// 1960s. Earthquakes come from the USGS as GeoJSON.

export interface TleEntry {
  readonly name: string;
  readonly line1: string;
  readonly line2: string;
}

export interface Quake {
  readonly lng: number;
  readonly lat: number;
  readonly depthKm: number;
  readonly magnitude: number;
  readonly timeMilliseconds: number;
  readonly place: string;
}

// Element sets from a block of text. Names are optional in the format; an element
// set without one is named after its catalogue number. Malformed sets are skipped.
export function parseTle(text: string): TleEntry[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const entries: TleEntry[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.startsWith("1 ") || index + 1 >= lines.length || !lines[index + 1].startsWith("2 ")) continue;
    const line2 = lines[index + 1];
    // Both lines carry the catalogue number in the same columns; a mismatch means they are not a pair.
    if (line.length < 60 || line2.length < 60 || line.slice(2, 7) !== line2.slice(2, 7)) continue;
    const previous = index > 0 ? lines[index - 1] : "";
    const hasName = previous.length > 0 && !previous.startsWith("1 ") && !previous.startsWith("2 ");
    entries.push({ name: hasName ? previous.replace(/^0 /, "").trim() : `NORAD ${line.slice(2, 7).trim()}`, line1: line, line2 });
    index++;
  }
  return entries;
}

// The form quakes are kept in for the bundled snapshot and the browser's cache:
// just the six numbers and the place name for each.
export type CompactQuake = readonly [lng: number, lat: number, depthKm: number, magnitude: number, timeMilliseconds: number, place: string];

export function compactQuakes(quakes: readonly Quake[]): CompactQuake[] {
  return quakes.map((quake) => [quake.lng, quake.lat, quake.depthKm, quake.magnitude, quake.timeMilliseconds, quake.place]);
}

export function expandQuakes(compact: readonly CompactQuake[]): Quake[] {
  return compact.map(([lng, lat, depthKm, magnitude, timeMilliseconds, place]) => ({ lng, lat, depthKm, magnitude, timeMilliseconds, place }));
}

// Earthquakes from a USGS GeoJSON summary feed, oldest first. Entries missing a
// position, magnitude or time are skipped.
export function parseQuakes(feed: unknown): Quake[] {
  const features = (feed as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const quakes: Quake[] = [];
  for (const feature of features as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }[]) {
    const coordinates = feature?.geometry?.coordinates;
    const properties = feature?.properties;
    if (!Array.isArray(coordinates) || !properties) continue;
    const [lng, lat, depthKm] = coordinates as unknown[];
    const { mag, time, place } = properties;
    if (typeof lng !== "number" || typeof lat !== "number" || typeof mag !== "number" || typeof time !== "number") continue;
    quakes.push({
      lng,
      lat,
      depthKm: typeof depthKm === "number" ? depthKm : 0,
      magnitude: mag,
      timeMilliseconds: time,
      place: typeof place === "string" ? place : "",
    });
  }
  return quakes.sort((first, second) => first.timeMilliseconds - second.timeMilliseconds);
}
