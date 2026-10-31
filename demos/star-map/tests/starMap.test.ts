import { describe, expect, it } from "vitest";
import { DisplayList } from "@vector-display/core";
import { equatorialVector, greenwichSiderealTime, julianDate, localSiderealTime, skyRotation, toHorizontal } from "../src/sim/astronomy.js";
import { horizonScreenShare, Projector } from "../src/sim/projection.js";
import { SKY } from "../src/sim/sky.js";
import { formatClock, StarMapDemo } from "../src/StarMapDemo.js";
import { moonPhaseAt, solarSystemAt, sunsetDuring } from "../src/sim/solarSystem.js";

const CHICAGO = { latitude: 41.88, longitude: -87.63 };

describe("astronomy", () => {
  it("gives the Julian date of the 2000 epoch", () => {
    expect(julianDate(new Date(Date.UTC(2000, 0, 1, 12)))).toBeCloseTo(2451545.0, 6);
  });

  it("matches Meeus's worked examples of Greenwich sidereal time (Astronomical Algorithms, 12.a and 12.b)", () => {
    // 1987 April 10, 0h UT: 13h 10m 46.3668s.
    expect(greenwichSiderealTime(new Date(Date.UTC(1987, 3, 10, 0, 0, 0)))).toBeCloseTo((13 + 10 / 60 + 46.3668 / 3600) * 15, 3);
    // 1987 April 10, 19:21:00 UT: 8h 34m 57.0896s.
    expect(greenwichSiderealTime(new Date(Date.UTC(1987, 3, 10, 19, 21, 0)))).toBeCloseTo((8 + 34 / 60 + 57.0896 / 3600) * 15, 3);
  });

  it("puts a star straight overhead when it is on the meridian at the latitude's declination", () => {
    const time = new Date(Date.UTC(2026, 9, 31, 3, 0, 0));
    const sidereal = localSiderealTime(time, CHICAGO.longitude);
    const overhead = toHorizontal(sidereal, CHICAGO.latitude, CHICAGO, sidereal);
    expect(overhead.altitude).toBeCloseTo(90, 6);
    // On the meridian, south of the zenith: due south.
    const south = toHorizontal(sidereal, CHICAGO.latitude - 30, CHICAGO, sidereal);
    expect(south.altitude).toBeCloseTo(60, 6);
    expect(south.azimuth).toBeCloseTo(180, 6);
  });

  it("keeps the pole star about as high as the latitude, due north, at any hour", () => {
    // Polaris: right ascension 2h 31m 49s, declination +89 15' 51" (J2000).
    for (let hour = 0; hour < 24; hour += 3) {
      const time = new Date(Date.UTC(2026, 9, 31, hour));
      const polaris = toHorizontal(37.954, 89.264, CHICAGO, localSiderealTime(time, CHICAGO.longitude));
      expect(Math.abs(polaris.altitude - CHICAGO.latitude)).toBeLessThan(0.8);
      expect(Math.min(polaris.azimuth, 360 - polaris.azimuth)).toBeLessThan(1.1);
    }
  });

  it("turns whole catalogs by a matrix that agrees with the formula star by star", () => {
    const sidereal = localSiderealTime(new Date(Date.UTC(2026, 9, 31, 4, 30)), CHICAGO.longitude);
    const { matrix } = skyRotation(CHICAGO, sidereal);
    for (const [rightAscension, declination] of SKY.stars.slice(0, 50)) {
      const [x, y, z] = equatorialVector(rightAscension, declination);
      const east = matrix[0] * x + matrix[1] * y + matrix[2] * z;
      const north = matrix[3] * x + matrix[4] * y + matrix[5] * z;
      const up = matrix[6] * x + matrix[7] * y + matrix[8] * z;
      const expected = toHorizontal(rightAscension, declination, CHICAGO, sidereal);
      expect((Math.asin(up) * 180) / Math.PI).toBeCloseTo(expected.altitude, 6);
      const azimuth = (((Math.atan2(east, north) * 180) / Math.PI) % 360 + 360) % 360;
      if (Math.abs(expected.altitude) < 89) expect(Math.abs(((azimuth - expected.azimuth + 540) % 360) - 180)).toBeLessThan(1e-6);
    }
  });
});

describe("projection", () => {
  it("puts the view's middle at the screen's middle and half the field of view at the top edge", () => {
    const projector = new Projector();
    projector.set({ azimuth: 90, altitude: 20, fieldOfView: 60 }, 1600, 1000);
    const out = new Float64Array(2);
    const toward = (altitude: number, azimuth: number): [number, number, number] => {
      const a = (altitude * Math.PI) / 180;
      const z = (azimuth * Math.PI) / 180;
      return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)];
    };
    expect(projector.project(...toward(20, 90), out, 0)).toBe(true);
    expect(out[0]).toBeCloseTo(800, 6);
    expect(out[1]).toBeCloseTo(500, 6);
    projector.project(...toward(50, 90), out, 0);
    expect(out[0]).toBeCloseTo(800, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    // To the right of the view (looking east, south is to the right).
    projector.project(...toward(20, 100), out, 0);
    expect(out[0]).toBeGreaterThan(800);
    // Straight behind is not drawn.
    expect(projector.project(...toward(-20, 270), out, 0)).toBe(false);
  });
});

describe("the star map", () => {
  const now = (): Date => new Date(Date.UTC(2026, 9, 31, 4, 0));

  it("has the sky's data: thousands of stars brightest first, the named bright stars, 89 constellations", () => {
    expect(SKY.stars.length).toBeGreaterThan(5000);
    expect(SKY.stars[0][2]).toBeLessThan(SKY.stars[100][2]);
    expect(SKY.starNames.find(([, name]) => name === "Sirius")?.[0]).toBe(0);
    expect(SKY.constellations).toHaveLength(89);
    expect(SKY.constellations.find((constellation) => constellation.id === "Ori")?.lines.length).toBeGreaterThan(0);
  });

  it("draws the sky, hides what is below the ground, and shows more of it with the ground off", () => {
    const demo = new StarMapDemo({ place: CHICAGO, placeName: "Chicago", now });
    demo.view = { azimuth: 180, altitude: 0, fieldOfView: 120 };
    const withGround = new DisplayList();
    demo.draw(withGround, { width: 1600, height: 1000, seconds: 0 });
    demo.toggle("ground");
    const withoutGround = new DisplayList();
    demo.draw(withoutGround, { width: 1600, height: 1000, seconds: 0 });
    expect(withGround.segmentCount).toBeGreaterThan(300);
    expect(withoutGround.segmentCount).toBeGreaterThan(withGround.segmentCount);
  });

  it("starts with the horizon near the bottom of the screen, and keeps it there while zooming", () => {
    const demo = new StarMapDemo({ place: CHICAGO, placeName: "Chicago", now });
    expect(horizonScreenShare(demo.view.altitude, demo.view.fieldOfView)).toBeCloseTo(0.84, 6);
    for (const factor of [1.6, 1.6, 0.3, 0.5]) {
      demo.zoom(factor);
      expect(horizonScreenShare(demo.view.altitude, demo.view.fieldOfView)).toBeCloseTo(0.84, 6);
    }
    // Looking high, with the horizon off the screen, the zoom keeps the middle where it is.
    demo.view = { azimuth: 0, altitude: 80, fieldOfView: 40 };
    demo.zoom(2);
    expect(demo.view.altitude).toBe(80);
  });

  it("looks around and zooms within limits, and runs its clock faster on request", () => {
    const demo = new StarMapDemo({ place: CHICAGO, placeName: "Chicago", now });
    demo.look(200, 100);
    expect(demo.view.azimuth).toBeCloseTo(20, 6);
    expect(demo.view.altitude).toBe(90);
    demo.zoom(0.01);
    expect(demo.view.fieldOfView).toBe(8);
    demo.zoom(1000);
    expect(demo.view.fieldOfView).toBe(160);
    demo.changeTimeRate(3);
    demo.update(10);
    expect(demo.time.getTime() - now().getTime()).toBeCloseTo((3600 - 1) * 10 * 1000, -2);
    demo.returnToNow();
    expect(demo.time.getTime()).toBe(now().getTime());
  });
});

describe("the Sun, Moon and planets", () => {
  it("puts the Sun at its solstice declinations and the seven planets in the list", () => {
    const june = solarSystemAt(new Date(Date.UTC(2026, 5, 21, 12)), CHICAGO);
    expect(june[0].name).toBe("Sun");
    expect(june[0].declination).toBeCloseTo(23.44, 1);
    const december = solarSystemAt(new Date(Date.UTC(2026, 11, 21, 12)), CHICAGO);
    expect(december[0].declination).toBeCloseTo(-23.44, 1);
    expect(june.map((body) => body.name)).toEqual(["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"]);
  });

  it("takes the Moon from new to full within a month, waxing between", () => {
    const shares = Array.from({ length: 30 }, (_, day) => moonPhaseAt(new Date(Date.UTC(2026, 9, 1 + day))));
    expect(Math.min(...shares.map((phase) => phase.litShare))).toBeLessThan(0.02);
    expect(Math.max(...shares.map((phase) => phase.litShare))).toBeGreaterThan(0.98);
    const fullIndex = shares.findIndex((phase) => phase.name === "full");
    expect(fullIndex).toBeGreaterThan(0);
    expect(shares.some((phase) => phase.name === "waxing gibbous")).toBe(true);
  });
});

describe("time and the headset", () => {
  const now = (): Date => new Date(Date.UTC(2026, 9, 31, 4, 0));

  it("shows the time of a faraway place, estimated from its longitude, and the browser's own nearby", () => {
    const demo = new StarMapDemo({ place: { latitude: -33.87, longitude: 151.21 }, placeName: "Sydney", now });
    const zone = demo.clockZone();
    if (!zone.isBrowsers) {
      expect(zone.offsetMinutes).toBe(600);
      expect(formatClock(now(), zone)).toContain("APPROX. TIME THERE");
      // 04:00 UT is 2 PM in a zone ten hours ahead.
      expect(formatClock(now(), zone)).toMatch(/02:00\sPM/);
    }
    demo.setTime(new Date(Date.UTC(2027, 0, 1)));
    expect(demo.time.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("gives the headset every visible star and the horizon on the sphere around the eye", () => {
    const demo = new StarMapDemo({ place: CHICAGO, placeName: "Chicago", now });
    demo.draw(new DisplayList(), { width: 1600, height: 1000, seconds: 0 });
    const picture = demo.picture3d();
    expect(picture.spread).toBe(1);
    expect(picture.drop).toBe(0);
    expect(picture.positions.length).toBe((picture.colors.length / 4) * 6);
    // About half the stars are above the horizon.
    const lines = picture.colors.length / 4;
    expect(lines).toBeGreaterThan(2500);
    for (let index = 0; index < picture.positions.length; index += 3) {
      const distance = Math.hypot(picture.positions[index], picture.positions[index + 1], picture.positions[index + 2]);
      expect(distance).toBeGreaterThan(0.95);
      expect(distance).toBeLessThan(1.05);
    }
  });
});

describe("sunset", () => {
  it("finds the day's sunset: Chicago on 2026 October 31 near 5:42 PM CDT, and none at the poles in their seasons", () => {
    // Chicago's midnight, CDT (UTC-5).
    const chicagoDay = new Date(Date.UTC(2026, 9, 31, 5, 0));
    const sunset = sunsetDuring(chicagoDay, CHICAGO);
    if (sunset.time === null) throw new Error("no sunset");
    // Published tables give 5:42 PM CDT (22:42 UT) for Chicago that day; within a few minutes.
    const minutesAfterMidnight = (sunset.time.getTime() - chicagoDay.getTime()) / 60_000;
    expect(Math.abs(minutesAfterMidnight - (17 * 60 + 42))).toBeLessThan(5);
    expect(sunsetDuring(new Date(Date.UTC(2026, 5, 21)), { latitude: 90, longitude: 0 })).toEqual({ time: null, sunStaysUp: true });
    expect(sunsetDuring(new Date(Date.UTC(2026, 5, 21)), { latitude: -90, longitude: 0 })).toEqual({ time: null, sunStaysUp: false });
  });

  it("says it in the status line in the clock's zone", () => {
    const demo = new StarMapDemo({ place: CHICAGO, placeName: "Chicago", now: () => new Date(Date.UTC(2026, 10, 1, 1, 0)) });
    expect(demo.sunsetText({ offsetMinutes: -300, isBrowsers: true })).toMatch(/^SUNSET 5:4\d PM$/);
  });
});
