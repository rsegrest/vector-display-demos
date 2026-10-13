import { compactQuakes, expandQuakes, parseQuakes, parseTle, type CompactQuake, type Quake, type TleEntry } from "../sim/feeds.js";

// The feeds, both public and both readable straight from a browser.
// CelesTrak: element sets for space stations, and for the hundred or so brightest satellites.
export const TLE_URLS: readonly string[] = [
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
];
// USGS: every earthquake of magnitude 4.5 or more in the past seven days.
export const QUAKE_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";

// CelesTrak asks that its lists not be fetched more than once every two hours;
// orbits change slowly, so nothing is lost. Earthquakes are checked more often.
export const TLE_MAXIMUM_AGE_MILLISECONDS = 2 * 60 * 60 * 1000;
export const QUAKE_MAXIMUM_AGE_MILLISECONDS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MILLISECONDS = 12000;

// Where a set of data came from, most desirable first.
export type DataOrigin = "LIVE" | "CACHED" | "SNAPSHOT";

export interface DataSet<T> {
  readonly items: T;
  readonly origin: DataOrigin;
  // When the data was fetched from its source.
  readonly fetchedAtMilliseconds: number;
}

// Data bundled with the demo, used when a feed cannot be reached.
export interface Snapshot {
  readonly takenAtMilliseconds: number;
  readonly tle: string;
  readonly quakes: readonly CompactQuake[];
}

// The few things needed from the browser, so tests can supply their own.
export interface DataEnvironment {
  fetchText(url: string): Promise<string>;
  now(): number;
  readCache(key: string): string | null;
  writeCache(key: string, value: string): void;
}

const TLE_CACHE_KEY = "vector-demos:live-earth:tle";
const QUAKE_CACHE_KEY = "vector-demos:live-earth:quakes";

interface Cached<T> {
  readonly at: number;
  readonly data: T;
}

function readCached<T>(environment: DataEnvironment, key: string): Cached<T> | null {
  try {
    const text = environment.readCache(key);
    if (!text) return null;
    const cached = JSON.parse(text) as Cached<T>;
    return typeof cached?.at === "number" && cached.data !== undefined ? cached : null;
  } catch {
    return null;
  }
}

function writeCached<T>(environment: DataEnvironment, key: string, data: T): void {
  try {
    environment.writeCache(key, JSON.stringify({ at: environment.now(), data } satisfies Cached<T>));
  } catch {
    // Storage full or unavailable: the data is still used, just not remembered.
  }
}

// Loads one kind of data, preferring in order: a recent cached copy (so the feed is
// not asked again too soon), a fresh fetch, an old cached copy, the bundled snapshot.
async function load<Raw, T>(
  environment: DataEnvironment,
  key: string,
  maximumAge: number,
  fetchRaw: () => Promise<Raw>,
  parse: (raw: Raw) => T,
  isUsable: (items: T) => boolean,
  snapshot: () => DataSet<T>,
): Promise<DataSet<T>> {
  const cached = readCached<Raw>(environment, key);
  const fromCache = (): DataSet<T> | null => {
    if (!cached) return null;
    try {
      const items = parse(cached.data);
      return isUsable(items) ? { items, origin: "CACHED", fetchedAtMilliseconds: cached.at } : null;
    } catch {
      return null;
    }
  };
  if (cached && environment.now() - cached.at < maximumAge) {
    const recent = fromCache();
    if (recent) return recent;
  }
  try {
    const raw = await fetchRaw();
    const items = parse(raw);
    if (!isUsable(items)) throw new Error("the feed returned nothing usable");
    writeCached(environment, key, raw);
    return { items, origin: "LIVE", fetchedAtMilliseconds: environment.now() };
  } catch {
    return fromCache() ?? snapshot();
  }
}

export function loadSatelliteElements(environment: DataEnvironment, snapshot: Snapshot): Promise<DataSet<TleEntry[]>> {
  return load(
    environment,
    TLE_CACHE_KEY,
    TLE_MAXIMUM_AGE_MILLISECONDS,
    async () => (await Promise.all(TLE_URLS.map((url) => environment.fetchText(url)))).join("\n"),
    (text: string) => dedupe(parseTle(text)),
    (entries) => entries.length > 0,
    () => ({ items: dedupe(parseTle(snapshot.tle)), origin: "SNAPSHOT", fetchedAtMilliseconds: snapshot.takenAtMilliseconds }),
  );
}

export function loadQuakes(environment: DataEnvironment, snapshot: Snapshot): Promise<DataSet<Quake[]>> {
  return load(
    environment,
    QUAKE_CACHE_KEY,
    QUAKE_MAXIMUM_AGE_MILLISECONDS,
    // Only the compact form is cached: the full feed is several times larger.
    async () => compactQuakes(parseQuakes(JSON.parse(await environment.fetchText(QUAKE_URL)))),
    (compact: CompactQuake[]) => expandQuakes(compact),
    // A week with no large earthquakes anywhere does not happen; an empty list means a bad response.
    (quakes) => quakes.length > 0,
    () => ({ items: expandQuakes(snapshot.quakes), origin: "SNAPSHOT", fetchedAtMilliseconds: snapshot.takenAtMilliseconds }),
  );
}

// The same satellite can appear in more than one list; keep the first of each.
function dedupe(entries: TleEntry[]): TleEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const catalogueNumber = entry.line1.slice(2, 7);
    if (seen.has(catalogueNumber)) return false;
    seen.add(catalogueNumber);
    return true;
  });
}

// The real browser: fetch with a timeout, and localStorage.
export function browserEnvironment(): DataEnvironment {
  return {
    fetchText: async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MILLISECONDS);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`${url} answered ${response.status}`);
        return await response.text();
      } finally {
        clearTimeout(timer);
      }
    },
    now: () => Date.now(),
    readCache: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    writeCache: (key, value) => localStorage.setItem(key, value),
  };
}
