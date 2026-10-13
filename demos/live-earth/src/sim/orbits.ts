// Where a satellite is, from its published orbital elements. The elements describe
// the orbit at one moment; SGP4, the standard model they are made for, carries it
// forward (or back) from there, allowing for the Earth's bulge and thin air. The
// satellite.js library does that arithmetic. Predictions are good to a kilometre or
// so for a few days either side of the elements' date and drift after that.

import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate, twoline2satrec, type SatRec } from "satellite.js";
import type { TleEntry } from "./feeds.js";
import { EARTH_RADIUS_KM } from "./sphere.js";

export interface SatellitePosition {
  lng: number;
  lat: number;
  altitudeKm: number;
}

export class Satellite {
  public readonly name: string;
  // Minutes for one trip round the Earth.
  public readonly periodMinutes: number;
  // When the elements were measured.
  public readonly epochMilliseconds: number;

  private readonly record: SatRec;
  private readonly date = new Date();

  public constructor(entry: TleEntry) {
    this.name = entry.name;
    this.record = twoline2satrec(entry.line1, entry.line2);
    // Mean motion is kept in radians per minute.
    this.periodMinutes = (2 * Math.PI) / this.record.no;
    // The epoch is a Julian date, in days; the Unix epoch is Julian day 2440587.5.
    this.epochMilliseconds = (this.record.jdsatepoch - 2440587.5) * 86400000;
  }

  // The point on the ground beneath the satellite, and its height, at a moment.
  // Returns false if the model cannot place it (an orbit that has decayed, say).
  public locate(timeMilliseconds: number, out: SatellitePosition): boolean {
    this.date.setTime(timeMilliseconds);
    const position = propagate(this.record, this.date)?.position;
    // The library reports failure by returning a boolean in place of a position.
    if (!position || typeof position !== "object" || !Number.isFinite(position.x)) return false;
    const ground = eciToGeodetic(position, gstime(this.date));
    out.lng = degreesLong(ground.longitude);
    out.lat = degreesLat(ground.latitude);
    out.altitudeKm = ground.height;
    return Number.isFinite(out.lng) && Number.isFinite(out.lat) && Number.isFinite(out.altitudeKm);
  }
}

// Builds a satellite for each element set, leaving out any the model rejects, and
// any too far out to share a screen with the globe (geostationary orbit is at 6.6
// Earth radii; nothing in the lists used here is much higher).
export function createSatellites(entries: readonly TleEntry[], maximumAltitudeKm = 45000): Satellite[] {
  const satellites: Satellite[] = [];
  const position: SatellitePosition = { lng: 0, lat: 0, altitudeKm: 0 };
  for (const entry of entries) {
    try {
      const satellite = new Satellite(entry);
      if (!Number.isFinite(satellite.periodMinutes) || satellite.periodMinutes <= 0) continue;
      if (!satellite.locate(satellite.epochMilliseconds, position)) continue;
      if (position.altitudeKm > maximumAltitudeKm || position.altitudeKm < 80) continue;
      satellites.push(satellite);
    } catch {
      // A malformed element set: skip it.
    }
  }
  return satellites;
}

// Distance from the Earth's centre, in Earth radii, for a height above the ground.
export function radiusFactor(altitudeKm: number): number {
  return 1 + altitudeKm / EARTH_RADIUS_KM;
}
