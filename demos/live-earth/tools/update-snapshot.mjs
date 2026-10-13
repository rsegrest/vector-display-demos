#!/usr/bin/env node
// Refreshes the data bundled with the demo, which it falls back on when a feed
// cannot be reached. Run from the package: npm run update:snapshot
//
// The feed addresses are repeated here from src/data/LiveData.ts so that this
// script needs no build step; keep the two in step.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TLE_URLS = [
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
];
const QUAKE_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";
const OUTPUT = fileURLToPath(new URL("../src/data/snapshot.json", import.meta.url));

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

const tle = (await Promise.all(TLE_URLS.map(fetchText)))
  .join("\n")
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .filter((line) => line.length > 0)
  .join("\n");
const feed = JSON.parse(await fetchText(QUAKE_URL));
const quakes = feed.features
  .filter((feature) => typeof feature.properties.mag === "number" && Array.isArray(feature.geometry?.coordinates))
  .map((feature) => {
    const [lng, lat, depth] = feature.geometry.coordinates;
    return [
      Math.round(lng * 1000) / 1000,
      Math.round(lat * 1000) / 1000,
      Math.round((depth ?? 0) * 10) / 10,
      feature.properties.mag,
      feature.properties.time,
      feature.properties.place ?? "",
    ];
  })
  .sort((first, second) => first[4] - second[4]);

const elementSets = tle.split("\n").filter((line) => line.startsWith("1 ")).length;
if (elementSets === 0 || quakes.length === 0) throw new Error("a feed returned nothing; snapshot left as it was");
writeFileSync(OUTPUT, `${JSON.stringify({ takenAtMilliseconds: Date.now(), tle, quakes })}\n`);
console.log(`snapshot written: ${elementSets} element sets, ${quakes.length} earthquakes`);
