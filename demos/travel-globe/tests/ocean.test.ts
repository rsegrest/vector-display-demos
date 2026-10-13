import { describe, expect, it } from "vitest";
import { OceanField } from "../src/geo/ocean.js";
import { createAtlas, type GeoData, type TravelData } from "../src/places.js";
import geo from "../src/data/geo.json";
import travel from "../src/data/travel.json";

const atlas = createAtlas(travel as TravelData, geo as GeoData);
const ocean = new OceanField((lng, lat) => atlas.featureAt(lng, lat) !== null);

describe("OceanField", () => {
  it("only puts waves on water", () => {
    for (let level = 0; level < ocean.levelCount; level++) {
      for (const tile of ocean.tilesNear(32, 42, level)) {
        for (let i = 0; i < tile.length; i += 2) expect(atlas.featureAt(tile[i], tile[i + 1])).toBeNull();
      }
    }
  });

  it("finds the Black Sea once zoomed in", () => {
    const fine = ocean.levelFor(4);
    const points = ocean.tilesNear(34, 43, fine).flatMap((tile) => {
      const inSea: number[][] = [];
      for (let i = 0; i < tile.length; i += 2) {
        const [lng, lat] = [tile[i], tile[i + 1]];
        if (lng > 29 && lng < 41 && lat > 41.5 && lat < 46) inSea.push([lng, lat]);
      }
      return inSea;
    });
    expect(points.length).toBeGreaterThan(5);
  });

  it("leaves the middle of a continent empty and fills open ocean", () => {
    const count = (lng: number, lat: number) => ocean.tile(lng, lat, 0).length / 2;
    expect(count(-55, -10)).toBe(0);
    expect(count(-150, -20)).toBeGreaterThan(2);
  });

  it("gets denser as the zoom level rises", () => {
    expect(ocean.tile(-150, -20, 2).length).toBeGreaterThan(ocean.tile(-150, -20, 0).length * 4);
  });
});
