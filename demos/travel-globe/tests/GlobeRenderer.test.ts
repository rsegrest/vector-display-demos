import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT } from "@vector-display/core";
import { GlobeView } from "../src/geo/GlobeView.js";
import { GlobeRenderer } from "../src/render/GlobeRenderer.js";
import { createAtlas, type GeoData, type TravelData } from "../src/places.js";

// A tiny atlas: one country line along the equator from 60°E to 120°E, crossing the limb at 90°E.
const geo: GeoData = { countries: [], states: [], countryLines: [[60, 0, 75, 0, 90.5, 0, 105, 0, 120, 0]], stateLines: [] };
const travel: TravelData = { version: 1, profile: {}, places: { countries: {}, states: {} } };

function segments(displayList: DisplayList) {
  const data = displayList.getSegmentData();
  const out: number[][] = [];
  for (let i = 0; i < displayList.segmentCount; i++) out.push(Array.from(data.subarray(i * FLOATS_PER_BEAM_SEGMENT, i * FLOATS_PER_BEAM_SEGMENT + 4)));
  return out;
}

describe("GlobeRenderer", () => {
  it("cuts lines at the horizon and hides the far side", () => {
    const view = new GlobeView();
    view.centerLat = 0;
    view.setScreen({ centerX: 500, centerY: 400, radius: 300 });
    const renderer = new GlobeRenderer(createAtlas(travel, geo));
    const displayList = new DisplayList();
    renderer.draw(displayList, view, { hovered: null, selected: null, seconds: 0 }, { bounds: { left: 0, top: 0, right: 1000, bottom: 800 } });
    // Equator segments are at y = 400; the limb circle and graticule are elsewhere or also on y = 400,
    // so pick out the country line by its x range (60°E starts at x = 500 + 300 sin 60°).
    const startX = 500 + 300 * Math.sin(Math.PI / 3);
    const countrySegments = segments(displayList).filter((s) => s[1] === 400 && s[3] === 400 && s[0] >= startX - 1);
    const maxX = Math.max(...countrySegments.flatMap((s) => [s[0], s[2]]));
    expect(maxX).toBeCloseTo(800, 0);
    expect(countrySegments.every((s) => s[0] <= 800.5 && s[2] <= 800.5)).toBe(true);
  });
});
