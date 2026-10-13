import { describe, expect, it } from "vitest";
import { formatYears, parseYears, validateTravelData } from "../src/data/travelData.js";
import geo from "../src/data/geo.json";
import travel from "../src/data/travel.json";
import type { GeoData } from "../src/places.js";

const knownIds = new Set([...(geo as GeoData).countries, ...(geo as GeoData).states].map((f) => f.id));

describe("parseYears", () => {
  it("reads single years and ranges in any order, without duplicates", () => {
    expect(parseYears("2001, 1995-1997, 2001")).toEqual({ years: [1995, 1996, 1997, 2001] });
    expect(parseYears("  ")).toEqual({ years: [] });
    expect(parseYears("2024–2025")).toEqual({ years: [2024, 2025] });
  });

  it("reports what it cannot read", () => {
    expect(parseYears("199x")).toEqual({ error: 'Could not read "199x" as a year or range like 1995-1997.' });
    expect(parseYears("2001-1995").error).toMatch(/backwards/);
  });
});

describe("formatYears", () => {
  it("collapses consecutive years into ranges", () => {
    expect(formatYears([1996, 1997, 1998, 1999, 2000, 2001])).toBe("1996-2001");
    expect(formatYears([1997, 2022, 2023, 2024, 2025])).toBe("1997, 2022-2025");
    expect(formatYears([])).toBe("");
  });
});

describe("validateTravelData", () => {
  it("accepts the current data", () => {
    expect(validateTravelData(travel, knownIds)).toEqual([]);
  });

  it("lists every problem it finds", () => {
    const bad = {
      version: 1,
      profile: {},
      places: {
        countries: { XX: { status: "visited" }, FR: { status: "partied", years: [1999.5] } },
        states: { "US-AL": { status: "lived", cities: [{ name: "", lat: 95, lng: 0, kind: "lived" }] } },
      },
    };
    const problems = validateTravelData(bad, knownIds);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("XX"),
        expect.stringContaining("partied"),
        expect.stringContaining("1999.5"),
        expect.stringMatching(/US-AL.*city/),
      ]),
    );
  });

  it("rejects something that is not travel data at all", () => {
    expect(validateTravelData({ hello: "world" }, knownIds).length).toBeGreaterThan(0);
  });
});
