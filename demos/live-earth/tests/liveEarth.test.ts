import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { GlobeView } from "@vector-demos/travel-globe/geo";
import {
  QUAKE_MAXIMUM_AGE_MILLISECONDS,
  QUAKE_URL,
  TLE_MAXIMUM_AGE_MILLISECONDS,
  loadQuakes,
  loadSatelliteElements,
  type DataEnvironment,
  type Snapshot,
} from "../src/data/LiveData.js";
import snapshotData from "../src/data/snapshot.json";
import { LiveEarthDemo, TIME_RATES, formatUtc } from "../src/LiveEarthDemo.js";
import { EarthProjector, type EarthPoint } from "../src/render/EarthProjector.js";
import { quakeRingDegrees } from "../src/render/EarthRenderer.js";
import { compactQuakes, expandQuakes, parseQuakes, parseTle } from "../src/sim/feeds.js";
import { Satellite, createSatellites, radiusFactor, type SatellitePosition } from "../src/sim/orbits.js";
import { angularDistance, destination, unitVector, wrapLongitude } from "../src/sim/sphere.js";
import { subsolarPoint } from "../src/sim/sun.js";

const snapshot = snapshotData as unknown as Snapshot;

// A real element set for the International Space Station, fixed here so the orbit tests do not depend on the snapshot's date.
const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   26285.14422154  .00005771  00000+0  11345-3 0  9992
2 25544  51.6314  81.3064 0006731 252.4466 107.5787 15.48833724589888`;
const ISS_EPOCH = Date.UTC(2026, 0, 1) + (285.14422154 - 1) * 86400000;

const QUAKE_FEED = {
  features: [
    { properties: { mag: 5.1, time: 2000, place: "Somewhere" }, geometry: { coordinates: [10, 20, 33] } },
    { properties: { mag: 6.2, time: 1000, place: "Elsewhere" }, geometry: { coordinates: [-70, -30, 10] } },
    { properties: { mag: null, time: 3000, place: "No magnitude" }, geometry: { coordinates: [0, 0, 0] } },
    { properties: { mag: 4.6, time: 4000 }, geometry: null },
  ],
};

describe("sphere geometry", () => {
  it("wraps longitudes into -180..180", () => {
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(45)).toBe(45);
  });

  it("travels along great circles", () => {
    const out = { lng: 0, lat: 0 };
    destination(0, 0, 90, 90, out);
    expect(out.lng).toBeCloseTo(90, 6);
    expect(out.lat).toBeCloseTo(0, 6);
    destination(20, 10, 0, 30, out);
    expect(out.lng).toBeCloseTo(20, 6);
    expect(out.lat).toBeCloseTo(40, 6);
    // Wherever you set out from, you end up as far away as you travelled.
    for (const bearing of [0, 37, 180, 271]) {
      destination(-120, 55, bearing, 25, out);
      expect(angularDistance(-120, 55, out.lng, out.lat)).toBeCloseTo(25, 5);
    }
  });

  it("measures a quarter of the way round as 90 degrees", () => {
    expect(angularDistance(0, 0, 0, 90)).toBeCloseTo(90, 6);
    expect(angularDistance(0, 0, 180, 0)).toBeCloseTo(180, 6);
    expect(angularDistance(12, 34, 12, 34)).toBeCloseTo(0, 5);
  });
});

describe("subsolarPoint", () => {
  it("puts the Sun over the equator at an equinox and over a tropic at a solstice", () => {
    expect(Math.abs(subsolarPoint(Date.UTC(2026, 2, 20, 14, 46)).lat)).toBeLessThan(0.3);
    expect(subsolarPoint(Date.UTC(2026, 5, 21, 8, 24)).lat).toBeCloseTo(23.44, 1);
    expect(subsolarPoint(Date.UTC(2026, 11, 21, 20, 50)).lat).toBeCloseTo(-23.44, 1);
  });

  it("puts the Sun near the Greenwich meridian at noon UTC and half way round at midnight", () => {
    // Clock noon and solar noon differ by up to a quarter of an hour over the year, which is four degrees.
    expect(Math.abs(subsolarPoint(Date.UTC(2026, 3, 15, 12, 0)).lng)).toBeLessThan(4.5);
    expect(Math.abs(Math.abs(subsolarPoint(Date.UTC(2026, 3, 15, 0, 0)).lng) - 180)).toBeLessThan(4.5);
  });

  it("moves the Sun west by fifteen degrees an hour", () => {
    const first = subsolarPoint(Date.UTC(2026, 6, 1, 6, 0)).lng;
    const second = subsolarPoint(Date.UTC(2026, 6, 1, 7, 0)).lng;
    expect(wrapLongitude(first - second)).toBeCloseTo(15, 1);
  });
});

describe("parseTle", () => {
  it("reads named element sets", () => {
    const entries = parseTle(ISS_TLE);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("ISS (ZARYA)");
    expect(entries[0].line1.startsWith("1 25544")).toBe(true);
    expect(entries[0].line2.startsWith("2 25544")).toBe(true);
  });

  it("copes with missing names, blank lines and Windows line endings", () => {
    const [, line1, line2] = ISS_TLE.split("\n");
    const entries = parseTle(`${line1}\r\n${line2}\r\n\r\nSECOND\r\n${line1}\r\n${line2}\r\n`);
    expect(entries.map((entry) => entry.name)).toEqual(["NORAD 25544", "SECOND"]);
  });

  it("skips lines that are not a matching pair", () => {
    const [name, line1, line2] = ISS_TLE.split("\n");
    expect(parseTle(`${name}\n${line1}\n`)).toEqual([]);
    expect(parseTle(`${name}\n${line1}\n${line2.replace("25544", "99999")}`)).toEqual([]);
    expect(parseTle("an error page, not elements")).toEqual([]);
  });

  it("reads every element set in the bundled snapshot", () => {
    const entries = parseTle(snapshot.tle);
    expect(entries.length).toBeGreaterThan(100);
    expect(entries.some((entry) => entry.name === "ISS (ZARYA)")).toBe(true);
  });
});

describe("parseQuakes", () => {
  it("keeps complete entries, oldest first", () => {
    const quakes = parseQuakes(QUAKE_FEED);
    expect(quakes.map((quake) => quake.place)).toEqual(["Elsewhere", "Somewhere"]);
    expect(quakes[0]).toEqual({ lng: -70, lat: -30, depthKm: 10, magnitude: 6.2, timeMilliseconds: 1000, place: "Elsewhere" });
  });

  it("returns nothing for something that is not a feed", () => {
    expect(parseQuakes(null)).toEqual([]);
    expect(parseQuakes({ error: "rate limited" })).toEqual([]);
  });

  it("survives the trip to its compact form and back", () => {
    const quakes = parseQuakes(QUAKE_FEED);
    expect(expandQuakes(compactQuakes(quakes))).toEqual(quakes);
  });
});

describe("Satellite", () => {
  const station = new Satellite(parseTle(ISS_TLE)[0]);
  const position: SatellitePosition = { lng: 0, lat: 0, altitudeKm: 0 };

  it("knows the station's period and the date of its elements", () => {
    expect(station.periodMinutes).toBeCloseTo(92.97, 1);
    expect(Math.abs(station.epochMilliseconds - ISS_EPOCH)).toBeLessThan(1000);
  });

  it("keeps the station about 420 km up and within its orbit's tilt of the equator", () => {
    let highest = 0;
    for (let minute = 0; minute < 200; minute += 2) {
      expect(station.locate(ISS_EPOCH + minute * 60000, position)).toBe(true);
      expect(position.altitudeKm).toBeGreaterThan(400);
      expect(position.altitudeKm).toBeLessThan(440);
      expect(Math.abs(position.lat)).toBeLessThan(51.9);
      highest = Math.max(highest, Math.abs(position.lat));
    }
    // Over a couple of orbits it reaches nearly as far north or south as it ever goes.
    expect(highest).toBeGreaterThan(51);
  });

  it("brings the station back to the same latitude one orbit later, further west as the Earth turns under it", () => {
    station.locate(ISS_EPOCH, position);
    const first = { ...position };
    station.locate(ISS_EPOCH + station.periodMinutes * 60000, position);
    expect(position.lat).toBeCloseTo(first.lat, 0);
    // The Earth turns about 23 degrees in one 93-minute orbit.
    expect(wrapLongitude(first.lng - position.lng)).toBeGreaterThan(21);
    expect(wrapLongitude(first.lng - position.lng)).toBeLessThan(25);
  });

  it("moves at orbital speed", () => {
    station.locate(ISS_EPOCH, position);
    const first = { ...position };
    station.locate(ISS_EPOCH + 60000, position);
    // About 3.9 degrees of arc a minute for a 93-minute orbit.
    expect(angularDistance(first.lng, first.lat, position.lng, position.lat)).toBeGreaterThan(3.5);
    expect(angularDistance(first.lng, first.lat, position.lng, position.lat)).toBeLessThan(4.2);
  });

  it("builds satellites from the snapshot, dropping none of the ordinary ones", () => {
    const entries = parseTle(snapshot.tle);
    const satellites = createSatellites(entries);
    expect(satellites.length).toBeGreaterThan(entries.length * 0.9);
    expect(createSatellites([{ name: "JUNK", line1: "1 junk", line2: "2 junk" }])).toEqual([]);
  });

  it("converts height to distance from the Earth's centre", () => {
    expect(radiusFactor(0)).toBe(1);
    expect(radiusFactor(6371)).toBe(2);
  });
});

describe("EarthProjector", () => {
  const view = new GlobeView();
  view.setScreen({ centerX: 800, centerY: 500, radius: 300 });
  view.centerLng = 37;
  view.centerLat = 22;
  view.zoom = 1.5;
  const projector = new EarthProjector();
  projector.setView(view);
  const out: EarthPoint = { x: 0, y: 0, depth: 0, visible: false };

  it("agrees with the globe view for points on the surface", () => {
    for (const [lng, lat] of [[37, 22], [0, 0], [-120, 45], [170, -60], [80, 89]]) {
      const expected = view.project(lng, lat);
      projector.project(lng, lat, 1, out);
      expect(out.x).toBeCloseTo(expected.x, 6);
      expect(out.y).toBeCloseTo(expected.y, 6);
      expect(out.depth).toBeCloseTo(expected.depth, 9);
      expect(out.visible).toBe(expected.depth >= 0);
    }
  });

  it("gives the same answer from a unit vector as from longitude and latitude", () => {
    const vector = [0, 0, 0];
    unitVector(-45, 30, vector);
    const fromVector = { ...projector.projectVector(vector[0], vector[1], vector[2], 1.2, out) };
    projector.project(-45, 30, 1.2, out);
    expect(out.x).toBeCloseTo(fromVector.x, 6);
    expect(out.y).toBeCloseTo(fromVector.y, 6);
  });

  it("places something overhead the view's centre straight out toward the viewer", () => {
    projector.project(37, 22, 1.5, out);
    expect(out.x).toBeCloseTo(800, 6);
    expect(out.y).toBeCloseTo(500, 6);
    expect(out.depth).toBeCloseTo(1.5, 6);
    expect(out.visible).toBe(true);
  });

  it("hides what is behind the globe, but not what shows past its edge", () => {
    // Directly behind the centre, at any height: hidden.
    projector.project(37 + 180, -22, 1.07, out);
    expect(out.visible).toBe(false);
    // Low orbit, a little beyond the edge as seen from here: the globe covers it.
    projector.project(37 + 110, 0, 1.03, out);
    expect(out.visible).toBe(false);
    // The same direction but far out: it clears the edge.
    projector.project(37 + 110, 0, 3, out);
    expect(out.visible).toBe(true);
    expect(out.depth).toBeLessThan(0);
  });
});

describe("loading data", () => {
  const [, line1, line2] = ISS_TLE.split("\n");
  const LIVE_TLE = `LIVE SAT\n${line1}\n${line2}`;

  function environment(overrides: Partial<DataEnvironment> & { time?: number } = {}): DataEnvironment & { store: Map<string, string>; requests: string[] } {
    const store = new Map<string, string>();
    const requests: string[] = [];
    return {
      store,
      requests,
      now: () => overrides.time ?? 1_000_000_000,
      readCache: (key) => store.get(key) ?? null,
      writeCache: (key, value) => void store.set(key, value),
      fetchText: async (url) => {
        requests.push(url);
        if (overrides.fetchText) return overrides.fetchText(url);
        return url === QUAKE_URL ? JSON.stringify(QUAKE_FEED) : LIVE_TLE;
      },
    };
  }

  it("uses the live feeds when they answer, and remembers the result", async () => {
    const env = environment();
    const elements = await loadSatelliteElements(env, snapshot);
    expect(elements.origin).toBe("LIVE");
    // The same satellite came back from both lists; it is kept once.
    expect(elements.items.map((entry) => entry.name)).toEqual(["LIVE SAT"]);
    const quakes = await loadQuakes(env, snapshot);
    expect(quakes.origin).toBe("LIVE");
    expect(quakes.items).toHaveLength(2);
    expect(env.store.size).toBe(2);
  });

  it("does not ask a feed again while its cached copy is recent", async () => {
    const env = environment();
    await loadSatelliteElements(env, snapshot);
    const asked = env.requests.length;
    const again = await loadSatelliteElements(env, snapshot);
    expect(again.origin).toBe("CACHED");
    expect(again.items.map((entry) => entry.name)).toEqual(["LIVE SAT"]);
    expect(env.requests.length).toBe(asked);
  });

  it("asks again once the cached copy is old", async () => {
    const env = environment();
    await loadQuakes(env, snapshot);
    const later = { ...env, now: () => 1_000_000_000 + QUAKE_MAXIMUM_AGE_MILLISECONDS + 1 };
    const asked = env.requests.length;
    expect((await loadQuakes(later, snapshot)).origin).toBe("LIVE");
    expect(env.requests.length).toBe(asked + 1);
  });

  it("falls back to an old cached copy when the feed fails", async () => {
    const env = environment();
    await loadSatelliteElements(env, snapshot);
    const failing: DataEnvironment = {
      ...env,
      now: () => 1_000_000_000 + TLE_MAXIMUM_AGE_MILLISECONDS + 1,
      fetchText: async () => {
        throw new Error("offline");
      },
    };
    const result = await loadSatelliteElements(failing, snapshot);
    expect(result.origin).toBe("CACHED");
    expect(result.fetchedAtMilliseconds).toBe(1_000_000_000);
  });

  it("falls back to the bundled snapshot when there is nothing else", async () => {
    const env = environment({
      fetchText: async () => {
        throw new Error("offline");
      },
    });
    const elements = await loadSatelliteElements(env, snapshot);
    expect(elements.origin).toBe("SNAPSHOT");
    expect(elements.items.length).toBeGreaterThan(100);
    expect(elements.fetchedAtMilliseconds).toBe(snapshot.takenAtMilliseconds);
    const quakes = await loadQuakes(env, snapshot);
    expect(quakes.origin).toBe("SNAPSHOT");
    expect(quakes.items.length).toBeGreaterThan(10);
  });

  it("treats an error page or an empty feed as a failure, not as data", async () => {
    const env = environment({ fetchText: async (url) => (url === QUAKE_URL ? '{"features":[]}' : "<html>Service unavailable</html>") });
    expect((await loadSatelliteElements(env, snapshot)).origin).toBe("SNAPSHOT");
    expect((await loadQuakes(env, snapshot)).origin).toBe("SNAPSHOT");
    expect(env.store.size).toBe(0);
  });

  it("carries on when the browser's storage is unavailable", async () => {
    const env = environment();
    const broken: DataEnvironment = {
      ...env,
      readCache: () => {
        throw new Error("blocked");
      },
      writeCache: () => {
        throw new Error("blocked");
      },
    };
    expect((await loadQuakes(broken, snapshot)).origin).toBe("LIVE");
  });
});

describe("LiveEarthDemo", () => {
  const NOW = snapshot.takenAtMilliseconds;
  const FRAME = { width: 1778, height: 1000, seconds: 0 };
  const COAST = [[-10, 0, 0, 10, 10, 0, 0, -10, -10, 0]];

  function createDemo(): LiveEarthDemo {
    const demo = new LiveEarthDemo({ coastLines: COAST, clock: () => NOW });
    demo.setSatellites({ items: parseTle(snapshot.tle), origin: "SNAPSHOT", fetchedAtMilliseconds: NOW });
    demo.setQuakes({ items: expandQuakes(snapshot.quakes), origin: "SNAPSHOT", fetchedAtMilliseconds: NOW });
    demo.autoSpin = false;
    return demo;
  }

  function draw(demo: LiveEarthDemo): number {
    const displayList = new DisplayList();
    demo.draw(displayList, FRAME);
    return displayList.segmentCount;
  }

  it("starts at the present and runs time at the chosen rate", () => {
    const demo = createDemo();
    expect(demo.time).toBe(NOW);
    demo.update(2);
    expect(demo.time - NOW).toBe(2000 * TIME_RATES[demo.rateIndex].rate);
    demo.changeRate(-5);
    const before = demo.time;
    demo.update(3);
    expect(demo.time - before).toBe(3000);
    demo.togglePause();
    demo.update(3);
    expect(demo.time - before).toBe(3000);
    demo.goToNow();
    expect(demo.time).toBe(NOW);
  });

  it("shows the week's earthquakes, and brings them back one by one on replay", () => {
    const demo = createDemo();
    demo.update(0);
    const all = demo.shownQuakes.length;
    expect(all).toBeGreaterThan(10);
    demo.replayWeek();
    demo.update(0);
    expect(demo.shownQuakes.length).toBeLessThan(all / 4);
    // A day and a half of the week, at an hour a second.
    for (let second = 0; second < 36; second++) demo.update(1);
    const partWay = demo.shownQuakes.length;
    expect(partWay).toBeGreaterThan(0);
    expect(partWay).toBeLessThan(all);
    // On to within two hours of the present: nearly all of them are back.
    for (let second = 0; second < 130; second++) demo.update(1);
    expect(demo.shownQuakes.length).toBeGreaterThanOrEqual(all - 6);
    expect(demo.shownQuakes.length).toBeLessThanOrEqual(all);
  });

  it("draws the globe, and less with layers switched off", () => {
    const demo = createDemo();
    demo.update(0);
    const everything = draw(demo);
    expect(everything).toBeGreaterThan(500);
    demo.toggleSatellites();
    const withoutSatellites = draw(demo);
    demo.toggleQuakes();
    const withoutQuakes = draw(demo);
    demo.toggleGraticule();
    expect(withoutSatellites).toBeLessThan(everything);
    expect(withoutQuakes).toBeLessThan(withoutSatellites);
    expect(draw(demo)).toBeLessThan(withoutQuakes);
  });

  it("finds the space station and turns the view to follow it", () => {
    const demo = createDemo();
    expect(demo.stationName).toBe("ISS (ZARYA)");
    demo.toggleFollow();
    for (let frame = 0; frame < 240; frame++) demo.update(1 / 60);
    const station = new Satellite(parseTle(snapshot.tle).find((entry) => entry.name === "ISS (ZARYA)")!);
    const position: SatellitePosition = { lng: 0, lat: 0, altitudeKm: 0 };
    station.locate(demo.time, position);
    expect(angularDistance(demo.view.centerLng, demo.view.centerLat, position.lng, position.lat)).toBeLessThan(3);
    // Dragging takes the view back.
    demo.dragBy(50, 0);
    expect(demo.followStation).toBe(false);
  });

  it("picks the satellite or earthquake under the pointer", () => {
    const demo = createDemo();
    demo.toggleFollow();
    for (let frame = 0; frame < 300; frame++) demo.update(1 / 60);
    draw(demo);
    // The station is being followed, so it is in the middle of the screen.
    const picked = demo.pickAt(FRAME.width / 2, FRAME.height / 2);
    expect(picked?.kind).toBe("satellite");
    expect(demo.pickAt(5, 5)).toBeNull();
    demo.setPointer(FRAME.width / 2, FRAME.height / 2);
    draw(demo);
    expect(demo.pickedItem?.kind).toBe("satellite");
    demo.setPointer(null);
    expect(demo.pickedItem).toBeNull();
  });

  it("turns with a drag and limits zoom", () => {
    const demo = createDemo();
    const before = demo.view.centerLng;
    demo.dragBy(100, 0);
    expect(demo.view.centerLng).not.toBe(before);
    for (let step = 0; step < 50; step++) demo.zoomBy(2);
    const zoomedIn = demo.view.zoom;
    for (let step = 0; step < 50; step++) demo.zoomBy(0.5);
    expect(zoomedIn).toBeGreaterThan(demo.view.zoom);
    expect(Number.isFinite(demo.view.zoom)).toBe(true);
  });

  it("draws before any data has arrived", () => {
    const demo = new LiveEarthDemo({ coastLines: COAST, clock: () => NOW });
    demo.update(1 / 60);
    expect(draw(demo)).toBeGreaterThan(0);
    expect(demo.satelliteCount).toBe(0);
  });
});

describe("formatting", () => {
  it("writes times as UTC", () => {
    expect(formatUtc(Date.UTC(2026, 9, 13, 3, 4, 5))).toBe("2026-10-13 03:04:05");
  });

  it("sizes earthquake rings by magnitude", () => {
    expect(quakeRingDegrees(4.5)).toBeCloseTo(1, 6);
    expect(quakeRingDegrees(7)).toBeGreaterThan(quakeRingDegrees(5));
    expect(quakeRingDegrees(1)).toBeGreaterThan(0);
  });
});
