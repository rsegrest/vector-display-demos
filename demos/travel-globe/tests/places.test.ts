import { describe, expect, it } from "vitest";
import { createAtlas } from "../src/places.js";
import geo from "../src/data/geo.json";
import travel from "../src/data/travel.json";
import type { GeoData, TravelData } from "../src/places.js";

const atlas = createAtlas(travel as TravelData, geo as GeoData);

describe("createAtlas", () => {
  it("joins every travel entry to its map shape", () => {
    expect(atlas.places).toHaveLength(Object.keys(travel.places.countries).length + Object.keys(travel.places.states).length);
    for (const place of atlas.places) expect(place.rings.length).toBeGreaterThan(0);
  });

  it("includes Turks and Caicos as a tiny visited place from 2026", () => {
    const place = atlas.places.find((p) => p.id === "TC")!;
    expect(place.name).toBe("Turks and Caicos Islands");
    expect(place.status).toBe("visited");
    expect(place.years).toEqual([2026]);
    expect(place.isTiny).toBe(true);
  });

  it("tallies statuses separately for the world and the United States", () => {
    expect(atlas.tally("country")).toMatchObject({ visited: 26, lived: 1 });
    expect(atlas.tally("state")).toMatchObject({ visited: 28, seen: 8, lived: 3 });
  });

  it("finds the region under a point, preferring US states", () => {
    expect(atlas.featureAt(2.35, 48.86)?.id).toBe("FR");
    expect(atlas.featureAt(-86.59, 34.73)?.id).toBe("US-AL");
    expect(atlas.featureAt(-30, 30)).toBeNull();
    // Unvisited countries are still found, so hovering names them.
    expect(atlas.featureAt(-68.15, -16.5)?.id).toBe("BO");
  });

  it("keeps overseas regions out of their parent country", () => {
    const france = atlas.places.find((p) => p.id === "FR")!;
    // Mainland France and Corsica only: nothing west of the Atlantic or south of the Mediterranean.
    expect(france.bounds.minLng).toBeGreaterThan(-6);
    expect(france.bounds.minLat).toBeGreaterThan(41);
    expect(atlas.featureAt(-53, 4)?.id).toBe("GF");
    expect(atlas.placeFor(atlas.featureAt(-53, 4)!)).toBeUndefined();
  });

  it("marks the places Rick has lived", () => {
    const lived = atlas.places.filter((p) => p.status === "lived").map((p) => p.id);
    expect(lived).toEqual(expect.arrayContaining(["US-AL", "US-TN", "US-TX"]));
    const cities = atlas.places.flatMap((p) => p.cities.filter((c) => c.kind === "lived").map((c) => c.name));
    expect(cities).toEqual(expect.arrayContaining(["Auburn", "Huntsville", "Nashville", "Abilene"]));
  });

  it("knows which countries are mapped state by state", () => {
    const us = atlas.countries.find((c) => c.id === "US")!;
    const france = atlas.countries.find((c) => c.id === "FR")!;
    expect(atlas.hasStates(us)).toBe(true);
    expect(atlas.hasStates(france)).toBe(false);
  });

  it("handles shapes that cross the 180° meridian", () => {
    expect(atlas.featureAt(178.0, -17.8)?.id).toBe("FJ");
    // Chukotka, Russia's far east, lies past -180 going west.
    expect(atlas.featureAt(-175, 66)?.id).toBe("RU");
  });

  it("focuses multi-part places on their largest piece", () => {
    const us = atlas.places.find((p) => p.id === "US")!;
    expect(us.focus.lng).toBeGreaterThan(-110);
    expect(us.focus.lng).toBeLessThan(-85);
    const france = atlas.places.find((p) => p.id === "FR")!;
    expect(france.focus.lng).toBeGreaterThan(-5);
    expect(france.focus.lat).toBeGreaterThan(42);
  });

  it("orders places countries first, then states, alphabetically", () => {
    const names = atlas.places.map((p) => `${p.kind}:${p.name}`);
    const sorted = [...names].sort((a, b) => (a.startsWith("country") === b.startsWith("country") ? a.localeCompare(b) : a.startsWith("country") ? -1 : 1));
    expect(names).toEqual(sorted);
  });
});
