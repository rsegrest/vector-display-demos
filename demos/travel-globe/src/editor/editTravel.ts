// Edits to the travel data, each returning a new object (the old one is left untouched).
import type { PlaceStatus, TravelCity, TravelData, TravelEntry } from "../places.js";

export interface PlaceRef {
  readonly id: string;
  readonly kind: "country" | "state";
  readonly name: string;
}

export interface PostFields {
  readonly title: string;
  readonly slug: string;
  readonly body: string;
}

type MutableEntry = { -readonly [K in keyof TravelEntry]: TravelEntry[K] };

function groupOf(place: PlaceRef): "countries" | "states" {
  return place.kind === "country" ? "countries" : "states";
}

export function entryFor(data: TravelData, place: PlaceRef): TravelEntry | undefined {
  return data.places[groupOf(place)][place.id];
}

// Applies a change to one place's entry; a null result removes the place.
function withEntry(data: TravelData, place: PlaceRef, change: (entry: MutableEntry | undefined) => MutableEntry | null): TravelData {
  const group = groupOf(place);
  const entries = { ...data.places[group] };
  const current = entries[place.id];
  const next = change(current ? structuredClone(current) as MutableEntry : undefined);
  if (next) entries[place.id] = next;
  else delete entries[place.id];
  return { ...data, places: { ...data.places, [group]: entries } };
}

function newEntry(place: PlaceRef, status: PlaceStatus): MutableEntry {
  return { name: place.name, status, years: [], cities: [] };
}

export function setStatus(data: TravelData, place: PlaceRef, status: PlaceStatus | null): TravelData {
  return withEntry(data, place, (entry) => (status === null ? null : entry ? { ...entry, status } : newEntry(place, status)));
}

export function setYears(data: TravelData, place: PlaceRef, years: readonly number[]): TravelData {
  return withEntry(data, place, (entry) => (entry ? { ...entry, years: [...years] } : entry ?? null));
}

// Blank fields are dropped rather than saved as empty strings.
export function setPost(data: TravelData, place: PlaceRef, post: PostFields): TravelData {
  return withEntry(data, place, (entry) => {
    if (!entry) return null;
    const next: MutableEntry = { ...entry };
    const title = post.title.trim();
    const body = post.body.trim();
    if (title || body) next.post = { ...(title ? { title } : {}), ...(body ? { body } : {}) };
    else delete next.post;
    if (post.slug.trim()) next.blogPostSlug = post.slug.trim();
    else delete next.blogPostSlug;
    return next;
  });
}

// A city on a place not yet in the data adds the place as visited.
export function addCity(data: TravelData, place: PlaceRef, city: TravelCity): TravelData {
  return withEntry(data, place, (entry) => {
    const base = entry ?? newEntry(place, "visited");
    return { ...base, cities: [...(base.cities ?? []), city] };
  });
}

export function updateCity(data: TravelData, place: PlaceRef, index: number, change: Partial<TravelCity>): TravelData {
  return withEntry(data, place, (entry) =>
    entry ? { ...entry, cities: (entry.cities ?? []).map((city, i) => (i === index ? { ...city, ...change } : city)) } : null,
  );
}

export function removeCity(data: TravelData, place: PlaceRef, index: number): TravelData {
  return withEntry(data, place, (entry) => (entry ? { ...entry, cities: (entry.cities ?? []).filter((_, i) => i !== index) } : null));
}

export function setProfile(data: TravelData, profile: { title: string; homeBase: string }): TravelData {
  return { ...data, profile: { ...data.profile, title: profile.title, homeBase: profile.homeBase } };
}
