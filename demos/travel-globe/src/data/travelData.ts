import { PLACE_STATUSES, type TravelData } from "../places.js";

const CITY_KINDS = new Set(["visited", "lived", "want"]);

// "1995-1997, 2001" -> [1995, 1996, 1997, 2001]. Accepts en dashes, any order, repeats.
export function parseYears(text: string): { years: number[]; error?: undefined } | { years?: undefined; error: string } {
  const years = new Set<number>();
  for (const part of text.split(",").map((piece) => piece.trim()).filter(Boolean)) {
    const match = /^(\d{4})(?:\s*[-–]\s*(\d{4}))?$/.exec(part);
    if (!match) return { error: `Could not read "${part}" as a year or range like 1995-1997.` };
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (end < start) return { error: `The range "${part}" runs backwards.` };
    for (let year = start; year <= end; year++) years.add(year);
  }
  return { years: [...years].sort((a, b) => a - b) };
}

// [1996, 1997, 1998, 2001] -> "1996-1998, 2001"
export function formatYears(years: readonly number[]): string {
  const sorted = [...years].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return parts.join(", ");
}

// Everything wrong with a travel data object, as readable messages (empty when it is valid).
// knownIds are the country and state ids in the map data.
export function validateTravelData(data: unknown, knownIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const value = data as Partial<TravelData> | null;
  if (!value || typeof value !== "object" || !value.places || typeof value.places !== "object") {
    return ["This is not travel data: it needs a places object with countries and states."];
  }
  if (typeof value.profile !== "object" || value.profile === null) problems.push("The profile is missing.");
  for (const group of ["countries", "states"] as const) {
    const entries = value.places[group];
    if (!entries || typeof entries !== "object") {
      problems.push(`places.${group} is missing.`);
      continue;
    }
    for (const [id, entry] of Object.entries(entries)) {
      if (!knownIds.has(id)) problems.push(`${id}: not a country or state in the map data.`);
      if (!PLACE_STATUSES.includes(entry?.status as never)) problems.push(`${id}: unknown status "${entry?.status}".`);
      for (const year of entry?.years ?? []) {
        if (!Number.isInteger(year) || year < 1900 || year > 2100) problems.push(`${id}: ${year} is not a year.`);
      }
      for (const city of entry?.cities ?? []) {
        const label = city?.name || "(unnamed)";
        if (!city?.name?.trim()) problems.push(`${id}: a city has no name.`);
        if (!(Math.abs(city?.lat) <= 90 && Math.abs(city?.lng) <= 180)) problems.push(`${id}: city ${label} has coordinates off the map.`);
        if (!CITY_KINDS.has(city?.kind)) problems.push(`${id}: city ${label} has unknown kind "${city?.kind}".`);
      }
    }
  }
  return problems;
}
