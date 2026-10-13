// Where on Earth the Sun is directly overhead at a given moment. Everything
// within 90 degrees of that point is in daylight, so it also gives the line
// between day and night. Uses the standard low-precision solar formulae, good to a
// fraction of a degree, which is far finer than a line on a globe can show.

import { wrapLongitude, type LngLat } from "./sphere.js";

const RADIANS = Math.PI / 180;
const MILLISECONDS_PER_DAY = 86400000;
// 2000 January 1, 12:00 UTC, the epoch the formulae count days from.
const J2000_MILLISECONDS = Date.UTC(2000, 0, 1, 12, 0, 0);

export function subsolarPoint(timeMilliseconds: number, out: LngLat = { lng: 0, lat: 0 }): LngLat {
  const days = (timeMilliseconds - J2000_MILLISECONDS) / MILLISECONDS_PER_DAY;
  const meanLongitude = 280.46 + 0.9856474 * days;
  const meanAnomaly = (357.528 + 0.9856003 * days) * RADIANS;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RADIANS;
  const obliquity = (23.439 - 0.0000004 * days) * RADIANS;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude)) / RADIANS;
  // Greenwich mean sidereal time, in degrees: how far the Earth has turned against the stars.
  const siderealTime = 280.46061837 + 360.98564736629 * days;
  out.lat = declination / RADIANS;
  out.lng = wrapLongitude(rightAscension - siderealTime);
  return out;
}
