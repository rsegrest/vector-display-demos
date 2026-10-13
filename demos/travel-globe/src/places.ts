import { pointInRings, ringsBounds, type Bounds } from "./geo/shapes.js";

export const PLACE_STATUSES = ["visited", "seen", "planned", "want", "lived"] as const;
export type PlaceStatus = (typeof PLACE_STATUSES)[number];

// The travel map's data format (travel-map/lib/schema.ts), stored as a static file.
export interface TravelCity {
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly kind: "visited" | "lived" | "want";
}

export interface TravelEntry {
  readonly name?: string;
  readonly status: PlaceStatus;
  readonly years?: readonly number[];
  readonly cities?: readonly TravelCity[];
  readonly post?: { readonly title?: string; readonly body?: string };
  readonly blogPostSlug?: string;
}

export interface TravelData {
  readonly version: number;
  readonly profile: { readonly displayName?: string; readonly title?: string; readonly homeBase?: string };
  readonly places: {
    readonly countries: Readonly<Record<string, TravelEntry>>;
    readonly states: Readonly<Record<string, TravelEntry>>;
  };
}

// Built by tools/build-geo.mjs.
export interface GeoFeatureData {
  readonly id: string;
  readonly name: string;
  // Earth-tone index for unvisited land; neighbors never share one.
  readonly tone?: number;
  readonly rings: readonly (readonly number[])[];
}

export interface GeoData {
  readonly countries: readonly GeoFeatureData[];
  readonly states: readonly GeoFeatureData[];
  readonly countryLines: readonly (readonly number[])[];
  readonly stateLines: readonly (readonly number[])[];
}

export type PlaceKind = "country" | "state";

export interface GeoFeature {
  readonly id: string;
  readonly name: string;
  readonly kind: PlaceKind;
  readonly tone: number;
  readonly rings: readonly (readonly number[])[];
  readonly bounds: Bounds;
  // Center and bounds of the largest piece, so France focuses on France and not between it and French Guiana.
  readonly focus: { readonly lng: number; readonly lat: number };
  readonly focusBounds: Bounds;
  // Too small to see at whole-globe scale; drawn with a ring marker as well as hatching.
  readonly isTiny: boolean;
}

export interface Place extends GeoFeature {
  readonly status: PlaceStatus;
  readonly years: readonly number[];
  readonly cities: readonly TravelCity[];
  readonly postTitle?: string;
  readonly blogPostSlug?: string;
}

export type StatusTally = Record<PlaceStatus, number>;

const TINY_DEGREES = 1.5;

export interface Atlas {
  readonly title: string;
  readonly homeBase?: string;
  // Countries first, then states, each alphabetical: the order for stepping through places.
  readonly places: readonly Place[];
  readonly countries: readonly GeoFeature[];
  readonly states: readonly GeoFeature[];
  readonly geo: GeoData;
  tally(kind: PlaceKind): StatusTally;
  featureAt(lng: number, lat: number): GeoFeature | null;
  // True for a country that also has state-level travel entries (the US).
  hasStates(feature: GeoFeature): boolean;
  placeFor(feature: GeoFeature): Place | undefined;
}

export function createAtlas(travel: TravelData, geo: GeoData): Atlas {
  const countries = geo.countries.map((data) => toFeature(data, "country"));
  const states = geo.states.map((data) => toFeature(data, "state"));
  const featuresById = new Map([...countries, ...states].map((feature) => [feature.id, feature]));

  const toPlaces = (entries: Readonly<Record<string, TravelEntry>>) =>
    Object.entries(entries)
      .flatMap(([id, entry]): Place[] => {
        const feature = featuresById.get(id);
        if (!feature) return [];
        return [
          {
            ...feature,
            name: entry.name ?? feature.name,
            status: entry.status,
            years: entry.years ?? [],
            cities: entry.cities ?? [],
            postTitle: entry.post?.title,
            blogPostSlug: entry.blogPostSlug,
          },
        ];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  const places = [...toPlaces(travel.places.countries), ...toPlaces(travel.places.states)];
  const placesById = new Map(places.map((place) => [place.id, place]));
  const countriesWithStates = new Set(Object.keys(travel.places.states).map((id) => id.split("-")[0]));

  return {
    title: travel.profile.title ?? "Travel Map",
    homeBase: travel.profile.homeBase,
    places,
    countries,
    states,
    geo,
    tally(kind) {
      const tally = Object.fromEntries(PLACE_STATUSES.map((status) => [status, 0])) as StatusTally;
      for (const place of places) if (place.kind === kind) tally[place.status]++;
      return tally;
    },
    // States are checked first, since the United States' shape contains them. Rings that cross the
    // 180° meridian are stored unwrapped past +180 (see build-geo.mjs), so try lng + 360 as well.
    featureAt(lng, lat) {
      for (const list of [states, countries]) {
        for (const feature of list) {
          for (const candidate of [lng, lng + 360]) {
            const b = feature.bounds;
            if (candidate < b.minLng || candidate > b.maxLng || lat < b.minLat || lat > b.maxLat) continue;
            if (pointInRings(candidate, lat, feature.rings)) return feature;
          }
        }
      }
      return null;
    },
    hasStates(feature) {
      return feature.kind === "country" && countriesWithStates.has(feature.id);
    },
    placeFor(feature) {
      return placesById.get(feature.id);
    },
  };
}

function toFeature(data: GeoFeatureData, kind: PlaceKind): GeoFeature {
  const bounds = ringsBounds(data.rings);
  let largest = data.rings[0];
  let largestArea = -1;
  for (const ring of data.rings) {
    const b = ringsBounds([ring]);
    const area = (b.maxLng - b.minLng) * (b.maxLat - b.minLat);
    if (area > largestArea) {
      largestArea = area;
      largest = ring;
    }
  }
  const largestBounds = ringsBounds([largest]);
  return {
    id: data.id,
    name: data.name,
    kind,
    tone: data.tone ?? 0,
    rings: data.rings,
    bounds,
    focus: { lng: (largestBounds.minLng + largestBounds.maxLng) / 2, lat: (largestBounds.minLat + largestBounds.maxLat) / 2 },
    focusBounds: largestBounds,
    isTiny: Math.max(largestBounds.maxLng - largestBounds.minLng, largestBounds.maxLat - largestBounds.minLat) < TINY_DEGREES,
  };
}
