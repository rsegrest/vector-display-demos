import * as Astronomy from "astronomy-engine";
import type { BeamColor } from "@vector-display/core";
import type { Place } from "./astronomy.js";

// The Sun, the Moon and the planets for a place and moment, from Astronomy Engine (MIT): their
// right ascension and declination in the same J2000 frame as the catalog stars (so one rotation turns
// them all), seen from the place itself (the Moon is close enough for that to move it by a degree),
// and the Moon's phase.

export type BodyKind = "sun" | "moon" | "planet";

export interface SolarBody {
  readonly name: string;
  readonly kind: BodyKind;
  readonly rightAscension: number;
  readonly declination: number;
  readonly magnitude: number;
  readonly color: BeamColor;
}

export interface MoonPhase {
  // The share of the disc that is lit, 0 new to 1 full.
  readonly litShare: number;
  // Waxing (lit on the side toward the Sun as it moves away from it) or waning.
  readonly isWaxing: boolean;
  // In words: "waxing crescent", "full"...
  readonly name: string;
}

const PLANETS: readonly { readonly body: Astronomy.Body; readonly name: string; readonly color: BeamColor }[] = [
  { body: Astronomy.Body.Mercury, name: "Mercury", color: { red: 0.85, green: 0.8, blue: 0.75 } },
  { body: Astronomy.Body.Venus, name: "Venus", color: { red: 1, green: 0.97, blue: 0.85 } },
  { body: Astronomy.Body.Mars, name: "Mars", color: { red: 1, green: 0.5, blue: 0.35 } },
  { body: Astronomy.Body.Jupiter, name: "Jupiter", color: { red: 1, green: 0.88, blue: 0.7 } },
  { body: Astronomy.Body.Saturn, name: "Saturn", color: { red: 1, green: 0.9, blue: 0.6 } },
  { body: Astronomy.Body.Uranus, name: "Uranus", color: { red: 0.65, green: 0.95, blue: 1 } },
  { body: Astronomy.Body.Neptune, name: "Neptune", color: { red: 0.5, green: 0.65, blue: 1 } },
];
const SUN_COLOR: BeamColor = { red: 1, green: 0.85, blue: 0.4 };
const MOON_COLOR: BeamColor = { red: 0.9, green: 0.92, blue: 1 };

function bodyAt(body: Astronomy.Body, time: Date, observer: Astronomy.Observer): { rightAscension: number; declination: number } {
  // ofdate false: the J2000 frame the star catalog uses.
  const equatorial = Astronomy.Equator(body, time, observer, false, true);
  return { rightAscension: equatorial.ra * 15, declination: equatorial.dec };
}

export function solarSystemAt(time: Date, place: Place): SolarBody[] {
  const observer = new Astronomy.Observer(place.latitude, place.longitude, 0);
  const bodies: SolarBody[] = [
    { name: "Sun", kind: "sun", ...bodyAt(Astronomy.Body.Sun, time, observer), magnitude: -26.7, color: SUN_COLOR },
    { name: "Moon", kind: "moon", ...bodyAt(Astronomy.Body.Moon, time, observer), magnitude: Astronomy.Illumination(Astronomy.Body.Moon, time).mag, color: MOON_COLOR },
  ];
  for (const planet of PLANETS) {
    bodies.push({ name: planet.name, kind: "planet", ...bodyAt(planet.body, time, observer), magnitude: Astronomy.Illumination(planet.body, time).mag, color: planet.color });
  }
  return bodies;
}

export function moonPhaseAt(time: Date): MoonPhase {
  // The Moon's ecliptic longitude ahead of the Sun's: 0 new, 90 first quarter, 180 full, 270 last quarter.
  const elongation = Astronomy.MoonPhase(time);
  const litShare = Astronomy.Illumination(Astronomy.Body.Moon, time).phase_fraction;
  const isWaxing = elongation < 180;
  const name =
    litShare < 0.03 ? "new" : litShare > 0.97 ? "full" : litShare < 0.47 ? `${isWaxing ? "waxing" : "waning"} crescent` : litShare <= 0.53 ? `${isWaxing ? "first" : "last"} quarter` : `${isWaxing ? "waxing" : "waning"} gibbous`;
  return { litShare, isWaxing, name };
}
