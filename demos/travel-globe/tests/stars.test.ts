import { describe, expect, it } from "vitest";
import { DisplayList, FLOATS_PER_BEAM_SEGMENT } from "@vector-display/core";
import { createStars } from "../src/geo/stars.js";
import { GlobeView } from "../src/geo/GlobeView.js";
import { GlobeRenderer } from "../src/render/GlobeRenderer.js";
import { createAtlas, type GeoData, type TravelData } from "../src/places.js";

const emptyGeo: GeoData = { countries: [], states: [], countryLines: [], stateLines: [] };
const travel: TravelData = { version: 1, profile: {}, places: { countries: {}, states: {} } };

function dots(displayList: DisplayList) {
  const data = displayList.getSegmentData();
  const out: [number, number][] = [];
  for (let i = 0; i < displayList.segmentCount; i++) {
    const o = i * FLOATS_PER_BEAM_SEGMENT;
    if (data[o] === data[o + 2] && data[o + 1] === data[o + 3]) out.push([data[o], data[o + 1]]);
  }
  return out;
}

describe("stars", () => {
  it("spreads stars over the whole sky with a few bright ones", () => {
    const stars = createStars(2000);
    const north = stars.filter((s) => s.lat > 0).length;
    expect(north / stars.length).toBeGreaterThan(0.45);
    expect(north / stars.length).toBeLessThan(0.55);
    expect(stars.filter((s) => s.magnitude === 2).length).toBeGreaterThan(40);
  });

  it("draws stars around the globe, never in front of it, and turns them as the globe turns", () => {
    const view = new GlobeView();
    view.setScreen({ centerX: 800, centerY: 500, radius: 300 });
    const renderer = new GlobeRenderer(createAtlas(travel, emptyGeo));
    const bounds = { left: 0, top: 0, right: 1600, bottom: 1000 };
    const draw = () => {
      const displayList = new DisplayList();
      renderer.draw(displayList, view, { hovered: null, selected: null, seconds: 0 }, { bounds });
      return dots(displayList);
    };
    const before = draw();
    expect(before.length).toBeGreaterThan(150);
    for (const [x, y] of before) expect(Math.hypot(x - 800, y - 500)).toBeGreaterThan(300);
    view.centerLng += 20;
    const after = draw();
    expect(after).not.toEqual(before);
  });

  it("leaves stars out of inset maps", () => {
    const view = new GlobeView();
    view.setScreen({ centerX: 800, centerY: 500, radius: 300 });
    const renderer = new GlobeRenderer(createAtlas(travel, emptyGeo));
    const displayList = new DisplayList();
    renderer.draw(displayList, view, { hovered: null, selected: null, seconds: 0 }, { bounds: { left: 0, top: 0, right: 1600, bottom: 1000 }, isInset: true });
    expect(dots(displayList)).toHaveLength(0);
  });
});
