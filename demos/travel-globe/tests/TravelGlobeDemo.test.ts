import { describe, expect, it } from "vitest";
import { TravelGlobeDemo } from "../src/TravelGlobeDemo.js";
import { GlobeView } from "../src/geo/GlobeView.js";
import { createAtlas, type GeoData, type TravelData } from "../src/places.js";
import geo from "../src/data/geo.json";
import travel from "../src/data/travel.json";

function createDemo() {
  const demo = new TravelGlobeDemo(createAtlas(travel as TravelData, geo as GeoData));
  demo.resize(1600, 1000);
  return demo;
}

function run(demo: TravelGlobeDemo, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) demo.update(1 / 60);
}

describe("TravelGlobeDemo", () => {
  it("steps through countries on the globe and states on the US map", () => {
    const demo = createDemo();
    expect(demo.scopePlaces.every((p) => p.kind === "country")).toBe(true);
    demo.stepPlace(1);
    expect(demo.selected?.id).toBe(demo.scopePlaces[0].id);
    demo.stepPlace(-1);
    expect(demo.selected?.id).toBe(demo.scopePlaces[demo.scopePlaces.length - 1].id);

    demo.setMode("us");
    expect(demo.selected).toBeNull();
    expect(demo.scopePlaces.every((p) => p.kind === "state")).toBe(true);
    demo.stepPlace(1);
    expect(demo.selected?.id).toBe("US-AL");
  });

  it("flies to a selected country and frames it", () => {
    const demo = createDemo();
    const france = demo.atlas.places.find((p) => p.id === "FR")!;
    demo.select(france);
    run(demo, 2);
    expect(demo.view.centerLng).toBeCloseTo(france.focus.lng, 0);
    expect(demo.view.centerLat).toBeCloseTo(france.focus.lat, 0);
    expect(demo.view.zoom).toBeGreaterThan(3);
  });

  it("freezes the US map: dragging and zooming do nothing", () => {
    const demo = createDemo();
    demo.setMode("us");
    run(demo, 2);
    const { centerLng, centerLat, zoom } = demo.view;
    demo.dragBy(200, 100, 0.016);
    demo.zoomBy(2);
    run(demo, 1);
    expect([demo.view.centerLng, demo.view.centerLat, demo.view.zoom]).toEqual([centerLng, centerLat, zoom]);
  });

  it("selects Hawaii by clicking its inset window", () => {
    const demo = createDemo();
    demo.setMode("us");
    run(demo, 2);
    // The Hawaii window: left 348, width 230, 120 up from the bottom, 140 tall, centered on -157.4, 20.4.
    const inset = new GlobeView();
    inset.setScreen({ centerX: 348 + 115, centerY: 1000 - 120 - 70, radius: 420 });
    inset.centerLng = -157.4;
    inset.centerLat = 20.4;
    inset.zoom = 4.6;
    const bigIsland = inset.project(-155.5, 19.6);
    demo.clickAt(bigIsland.x, bigIsland.y);
    expect(demo.selected?.id).toBe("US-HI");
  });

  it("focuses a place on double-click, leaving the frozen US map for another country", () => {
    const demo = createDemo();
    demo.setMode("us");
    run(demo, 2);
    // Somewhere in Mexico, south of Texas on the US map.
    const target = demo.view.project(-102, 24);
    demo.focusAt(target.x, target.y);
    expect(demo.selected?.id).toBe("MX");
    expect(demo.mode).toBe("world");
    run(demo, 2);
    expect(demo.view.centerLng).toBeCloseTo(demo.selected!.focus.lng, 0);
  });

  it("swaps in edited data and keeps the selection", () => {
    const demo = createDemo();
    demo.select(demo.atlas.places.find((p) => p.id === "FR")!, false);
    const edited = structuredClone(travel) as TravelData;
    (edited.places.countries as Record<string, unknown>).FR = { name: "France", status: "lived", years: [2030], cities: [] };
    demo.replaceAtlas(createAtlas(edited, geo as GeoData));
    expect(demo.selected?.id).toBe("FR");
    expect(demo.selectedPlace?.status).toBe("lived");
  });

  it("reports a map location instead of selecting while picking", () => {
    const demo = createDemo();
    run(demo, 1);
    const picked: { lng: number; lat: number }[] = [];
    demo.onPickLocation = (location) => picked.push(location);
    const paris = demo.view.project(2.35, 48.86);
    if (paris.depth > 0) {
      demo.clickAt(paris.x, paris.y);
      expect(picked[0].lng).toBeCloseTo(2.35, 1);
      expect(picked[0].lat).toBeCloseTo(48.86, 1);
      expect(demo.selected).toBeNull();
    }
  });

  it("tours through places on its own and stops when the viewer takes over", () => {
    const demo = createDemo();
    const seen = new Set<string>();
    demo.onSelectionChange = (feature) => feature && seen.add(feature.id);
    demo.toggleTour();
    run(demo, 20);
    expect(seen.size).toBeGreaterThanOrEqual(3);
    demo.dragBy(10, 0, 0.016);
    expect(demo.isTouring).toBe(false);
  });
});
