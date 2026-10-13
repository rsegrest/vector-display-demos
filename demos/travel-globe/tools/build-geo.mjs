#!/usr/bin/env node
// Builds src/data/geo.json from Natural Earth data (world-atlas 50m countries, us-atlas 10m states).
//
//   node tools/build-geo.mjs [lineToleranceDegrees] [ringToleranceDegrees]
//
// Output, all coordinates as flat [lng, lat, lng, lat, ...] arrays rounded to 3 decimals:
//   countries / states: { id, name, tone, rings }   one entry per feature, for hatching and hit testing;
//                                                  tone (0-4) differs between neighbors
//   countryLines / stateLines: polylines        each shared border once, so it is not drawn twice as bright
// Countries are keyed by ISO 3166-1 alpha-2 ("FR") and states by "US-AL", matching the travel data.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { feature, mesh, neighbors } from "topojson-client";
import countries from "i18n-iso-countries";

const require = createRequire(import.meta.url);
const worldTopology = require("world-atlas/countries-50m.json");
const usTopology = require("us-atlas/states-10m.json");
// Outlines are what you see, so they keep more detail; feature rings only drive hatching and clicks.
const lineTolerance = Number(process.argv[2] ?? 0.06);
const ringTolerance = Number(process.argv[3] ?? 0.15);

const STATE_CODES = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
  "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
  "72": "PR", "78": "VI",
};

// Douglas–Peucker in degrees. Endpoints are always kept, so shared border ends still meet.
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
      const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (distance > worstDistance) {
        worst = i;
        worstDistance = distance;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (value) => Math.round(value * 1000) / 1000;
const flatten = (points) => points.flatMap(([lng, lat]) => [round(lng), round(lat)]);

// Rings smaller than the tolerance would vanish; keep at least a triangle so tiny islands stay clickable.
function simplifyRing(ring) {
  const simplified = simplify(ring, ringTolerance);
  return simplified.length >= 4 ? simplified : ring.length >= 4 ? [ring[0], ring[Math.floor(ring.length / 3)], ring[Math.floor((2 * ring.length) / 3)], ring[0]] : ring;
}

// A ring that crosses the 180° meridian jumps from +180 to -180, which in flat lng/lat terms
// stretches it across the whole map. Shift points by 360° so each step stays short. A ring that
// circles a pole (Antarctica) cannot be unwrapped and is left as it is.
function unwrapAntimeridian(ring) {
  const unwrapped = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const previous = unwrapped[i - 1][0];
    let lng = ring[i][0];
    while (lng - previous > 180) lng -= 360;
    while (lng - previous < -180) lng += 360;
    unwrapped.push([lng, ring[i][1]]);
  }
  const circlesPole = Math.abs(unwrapped[unwrapped.length - 1][0] - unwrapped[0][0]) > 180;
  if (circlesPole) return ring;
  const minLng = Math.min(...unwrapped.map(([lng]) => lng));
  const shift = minLng < -180 ? 360 : 0;
  return unwrapped.map(([lng, lat]) => [lng + shift, lat]);
}

function featureRings(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.flat().map((ring) => flatten(simplifyRing(unwrapAntimeridian(ring))));
}

// Everyday names where the ISO name is inverted or formal ("Virgin Islands, British").
const NAME_OVERRIDES = {
  BN: "Brunei", BQ: "Caribbean Netherlands", CD: "DR Congo", CG: "Republic of the Congo", CI: "Côte d'Ivoire",
  CN: "China", FK: "Falkland Islands", FM: "Micronesia", GM: "The Gambia", IR: "Iran", LA: "Laos",
  MD: "Moldova", MF: "Saint Martin", MK: "North Macedonia", PS: "Palestine", RU: "Russia", SX: "Sint Maarten",
  SY: "Syria", TW: "Taiwan", TZ: "Tanzania", US: "United States", VA: "Vatican City",
  VG: "British Virgin Islands", VI: "US Virgin Islands",
};
const countryName = (id, fallback) => NAME_OVERRIDES[id] ?? countries.getName(id, "en") ?? fallback;

// Earth tones for unvisited land: neighbors get different tones (greedy coloring over shared borders).
const TONE_COUNT = 5;
function assignTones(ids, adjacency) {
  const tones = new Map();
  const order = [...ids].sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0));
  for (const id of order) {
    const used = new Set([...(adjacency.get(id) ?? [])].map((other) => tones.get(other)));
    let tone = 0;
    while (used.has(tone) && tone < TONE_COUNT - 1) tone++;
    tones.set(id, tone);
  }
  return tones;
}

function adjacencyOf(geometries, idOf) {
  const adjacency = new Map();
  neighbors(geometries).forEach((list, index) => {
    const id = idOf(geometries[index]);
    if (!id) return;
    const set = adjacency.get(id) ?? new Set();
    for (const other of list) {
      const otherId = idOf(geometries[other]);
      if (otherId && otherId !== id) set.add(otherId);
    }
    adjacency.set(id, set);
  });
  return adjacency;
}

const alpha2Of = (geometry) =>
  geometry.id === undefined ? undefined : countries.numericToAlpha2(String(geometry.id).padStart(3, "0"));

const countryFeatures = feature(worldTopology, worldTopology.objects.countries).features.flatMap((f) => {
  const id = alpha2Of(f);
  if (!id) return [];
  return [{ id, name: countryName(id, f.properties.name), rings: featureRings(f.geometry) }];
});

// Natural Earth folds overseas regions into their country's shape, so visiting France would also fill in
// French Guiana. These are split out as their own places (ISO codes where they have one). Each ring
// moves if its center falls in one of the boxes [minLng, minLat, maxLng, maxLat].
const OVERSEAS = [
  { parent: "FR", id: "GF", boxes: [[-55, 1, -51, 7]] },
  { parent: "FR", id: "GP", boxes: [[-62, 15.8, -60.8, 16.6]] },
  { parent: "FR", id: "MQ", boxes: [[-61.4, 14.3, -60.7, 15]] },
  { parent: "FR", id: "RE", boxes: [[55, -21.5, 56, -20.8]] },
  { parent: "FR", id: "YT", boxes: [[44.8, -13.2, 45.4, -12.5]] },
  { parent: "NL", id: "BQ", boxes: [[-68.5, 11.9, -62.8, 17.8]] },
  { parent: "NO", id: "SJ", boxes: [[9, 74, 35, 81], [-10, 70.5, -7, 71.5]] },
];

function ringCenter(ring) {
  let lng = 0;
  let lat = 0;
  for (let i = 0; i < ring.length; i += 2) {
    lng += ring[i];
    lat += ring[i + 1];
  }
  return [lng / (ring.length / 2), lat / (ring.length / 2)];
}

for (const { parent, id, boxes } of OVERSEAS) {
  const parentFeature = countryFeatures.find((f) => f.id === parent);
  const inBoxes = (ring) => {
    const [lng, lat] = ringCenter(ring);
    return boxes.some(([minLng, minLat, maxLng, maxLat]) => lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat);
  };
  const moved = parentFeature.rings.filter(inBoxes);
  if (moved.length === 0) throw new Error(`no ${id} rings found in ${parent}`);
  parentFeature.rings = parentFeature.rings.filter((ring) => !inBoxes(ring));
  const existing = countryFeatures.find((f) => f.id === id);
  if (existing) existing.rings.push(...moved);
  else countryFeatures.push({ id, name: countryName(id, id), rings: moved });
}

// Overseas parts inherit their parent's neighbors, which is stricter than needed but never wrong.
const countryAdjacency = adjacencyOf(worldTopology.objects.countries.geometries, alpha2Of);
for (const { parent, id } of OVERSEAS) countryAdjacency.set(id, new Set(countryAdjacency.get(parent)));
const countryTones = assignTones(countryFeatures.map((f) => f.id), countryAdjacency);
for (const f of countryFeatures) f.tone = countryTones.get(f.id);

const stateFeatures = feature(usTopology, usTopology.objects.states).features.flatMap((f) => {
  const code = STATE_CODES[String(f.id).padStart(2, "0")];
  if (!code) return [];
  return [{ id: `US-${code}`, name: f.properties.name, rings: featureRings(f.geometry) }];
});

const lines = (multiLineString) =>
  multiLineString.coordinates.map((line) => flatten(simplify(line, lineTolerance))).filter((line) => line.length >= 4);
const stateIdOf = (geometry) => {
  const code = STATE_CODES[String(geometry.id).padStart(2, "0")];
  return code ? `US-${code}` : undefined;
};
const stateTones = assignTones(stateFeatures.map((f) => f.id), adjacencyOf(usTopology.objects.states.geometries, stateIdOf));
for (const f of stateFeatures) f.tone = stateTones.get(f.id);

const countryLines = lines(mesh(worldTopology, worldTopology.objects.countries));
// Only borders between two states: the coast and the national border already come from countryLines.
const stateLines = lines(mesh(usTopology, usTopology.objects.states, (a, b) => a !== b));

const output = { lineTolerance, ringTolerance, countries: countryFeatures, states: stateFeatures, countryLines, stateLines };
const json = JSON.stringify(output);
const outPath = new URL("../src/data/geo.json", import.meta.url);
writeFileSync(outPath, json);

const pointCount = (list) => list.reduce((sum, line) => sum + line.length / 2, 0);
console.log(
  `tolerance ${lineTolerance}° lines, ${ringTolerance}° rings: ${countryFeatures.length} countries, ${stateFeatures.length} states, ` +
    `${pointCount(countryLines)} country-line points, ${pointCount(stateLines)} state-line points, ` +
    `${pointCount(countryFeatures.flatMap((c) => c.rings))} feature points, ${Math.round(json.length / 1024)} KB`,
);

// Every place in the travel data must exist in the map data.
const travel = JSON.parse(readFileSync(new URL("../src/data/travel.json", import.meta.url), "utf8"));
const known = new Set([...countryFeatures, ...stateFeatures].map((f) => f.id));
const missing = [...Object.keys(travel.places.countries), ...Object.keys(travel.places.states)].filter((id) => !known.has(id));
if (missing.length) {
  console.error("travel places missing from map data:", missing.join(" "));
  process.exit(1);
}
console.log("all travel places present");
