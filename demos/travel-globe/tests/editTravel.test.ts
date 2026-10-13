import { describe, expect, it } from "vitest";
import { addCity, removeCity, setPost, setProfile, setStatus, setYears, updateCity, type PlaceRef } from "../src/editor/editTravel.js";
import type { TravelData } from "../src/places.js";

const base: TravelData = {
  version: 1,
  profile: { title: "Rick's World" },
  places: { countries: { FR: { name: "France", status: "visited", years: [1999], cities: [] } }, states: {} },
};
const france: PlaceRef = { id: "FR", kind: "country", name: "France" };
const ohio: PlaceRef = { id: "US-OH", kind: "state", name: "Ohio" };

describe("editTravel", () => {
  it("adds a place when it gets a status, and removes it with no status", () => {
    const added = setStatus(base, ohio, "seen");
    expect(added.places.states["US-OH"]).toEqual({ name: "Ohio", status: "seen", years: [], cities: [] });
    expect(base.places.states["US-OH"]).toBeUndefined();
    const removed = setStatus(added, ohio, null);
    expect(removed.places.states["US-OH"]).toBeUndefined();
  });

  it("changes status, years and post without touching other fields", () => {
    let data = setStatus(base, france, "lived");
    data = setYears(data, france, [1999, 2024]);
    data = setPost(data, france, { title: "Paris", slug: "paris-post", body: "" });
    expect(data.places.countries.FR).toEqual({
      name: "France",
      status: "lived",
      years: [1999, 2024],
      cities: [],
      post: { title: "Paris" },
      blogPostSlug: "paris-post",
    });
    expect(setPost(data, france, { title: "", slug: "", body: "" }).places.countries.FR.post).toBeUndefined();
  });

  it("adds, edits and removes cities", () => {
    let data = addCity(base, france, { name: "", lat: 43.3, lng: 5.37, kind: "visited" });
    data = updateCity(data, france, 0, { name: "Marseille" });
    expect(data.places.countries.FR.cities).toEqual([{ name: "Marseille", lat: 43.3, lng: 5.37, kind: "visited" }]);
    expect(removeCity(data, france, 0).places.countries.FR.cities).toEqual([]);
  });

  it("adding a city to an unvisited place marks it visited", () => {
    const data = addCity(base, ohio, { name: "Columbus", lat: 39.96, lng: -83, kind: "visited" });
    expect(data.places.states["US-OH"].status).toBe("visited");
  });

  it("updates the profile", () => {
    expect(setProfile(base, { title: "New", homeBase: "Huntsville" }).profile).toEqual({ title: "New", homeBase: "Huntsville" });
  });
});
