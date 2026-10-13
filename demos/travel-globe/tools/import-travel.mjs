#!/usr/bin/env node
// Copies travel data into src/data/travel.json, checking every place against the map data.
//
//   node tools/import-travel.mjs <file>
//
// <file> can be the travel-map app's saved map (data/maps/rick.json, which wraps the data in a record)
// or bare travel data. To edit places, run the travel-map app locally without Supabase settings, edit
// in its admin page (it saves to data/maps/rick.json), then import that file here.

import { readFileSync, writeFileSync } from "node:fs";

const STATUSES = new Set(["visited", "seen", "planned", "want", "lived"]);
const source = process.argv[2];
if (!source) {
  console.error("usage: import-travel.mjs <travel-map record or data JSON>");
  process.exit(2);
}

const parsed = JSON.parse(readFileSync(source, "utf8"));
const data = parsed.data ?? parsed;
const geo = JSON.parse(readFileSync(new URL("../src/data/geo.json", import.meta.url), "utf8"));
const known = new Set([...geo.countries, ...geo.states].map((feature) => feature.id));

const problems = [];
for (const group of ["countries", "states"]) {
  for (const [id, entry] of Object.entries(data.places?.[group] ?? {})) {
    if (!known.has(id)) problems.push(`${id}: not in the map data`);
    if (!STATUSES.has(entry.status)) problems.push(`${id}: unknown status "${entry.status}"`);
    for (const city of entry.cities ?? []) {
      if (!(Math.abs(city.lat) <= 90 && Math.abs(city.lng) <= 180)) problems.push(`${id}: city ${city.name} has bad coordinates`);
    }
  }
}
if (problems.length) {
  console.error("not imported:\n  " + problems.join("\n  "));
  process.exit(1);
}

writeFileSync(new URL("../src/data/travel.json", import.meta.url), JSON.stringify(data, null, 2) + "\n");
const count = (group) => Object.keys(data.places[group]).length;
console.log(`imported ${count("countries")} countries and ${count("states")} states`);
