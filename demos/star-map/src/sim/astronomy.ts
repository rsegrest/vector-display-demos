// Where a star is in your sky: from its fixed place among the stars (right ascension and
// declination) to how high it is and in which compass direction (altitude and azimuth), for a
// place on Earth and a moment in time. All angles are in degrees unless a name says otherwise.
//
// The steps, from any astronomy primer: the moment as a Julian date; from that, how far the Earth
// has turned against the stars (Greenwich mean sidereal time); add the longitude for the local
// sidereal time, which is the right ascension now crossing the meridian; then a rotation from the
// sky's coordinates to the horizon's. Precession (the slow drift of the coordinates, a third of a
// degree since 2000) and refraction (which lifts stars near the horizon about half a degree) are
// left out: both are below what this display can show.

const DEGREES = Math.PI / 180;
// The Julian date of 2000 January 1, 12:00 UT, from which the formulas count.
const J2000 = 2451545.0;
const MILLISECONDS_PER_DAY = 86_400_000;
// The Julian date at the Unix epoch, 1970 January 1, 00:00 UT.
const UNIX_EPOCH_JULIAN_DATE = 2440587.5;

export interface Place {
  // North positive.
  readonly latitude: number;
  // East positive.
  readonly longitude: number;
}

export interface Horizontal {
  // Height above the horizon: 90 straight up, negative below the horizon.
  readonly altitude: number;
  // Compass direction: 0 north, 90 east, 180 south, 270 west.
  readonly azimuth: number;
}

export function julianDate(time: Date): number {
  return time.getTime() / MILLISECONDS_PER_DAY + UNIX_EPOCH_JULIAN_DATE;
}

// Greenwich mean sidereal time in degrees, 0 to 360 (the IAU 1982 expression, good to well under a
// second of time for centuries around 2000).
export function greenwichSiderealTime(time: Date): number {
  const days = julianDate(time) - J2000;
  const centuries = days / 36525;
  const degrees = 280.46061837 + 360.98564736629 * days + 0.000387933 * centuries * centuries - (centuries * centuries * centuries) / 38710000;
  return ((degrees % 360) + 360) % 360;
}

// The right ascension on the meridian here, now.
export function localSiderealTime(time: Date, longitude: number): number {
  return (((greenwichSiderealTime(time) + longitude) % 360) + 360) % 360;
}

export function toHorizontal(rightAscension: number, declination: number, place: Place, siderealTime: number): Horizontal {
  const hourAngle = (siderealTime - rightAscension) * DEGREES;
  const latitude = place.latitude * DEGREES;
  const dec = declination * DEGREES;
  const sinAltitude = Math.sin(dec) * Math.sin(latitude) + Math.cos(dec) * Math.cos(latitude) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAltitude)));
  // Azimuth measured from north through east.
  const azimuth = Math.atan2(-Math.cos(dec) * Math.sin(hourAngle), Math.sin(dec) * Math.cos(latitude) - Math.cos(dec) * Math.sin(latitude) * Math.cos(hourAngle));
  return { altitude: altitude / DEGREES, azimuth: (((azimuth / DEGREES) % 360) + 360) % 360 };
}

// A direction in the sky as a unit vector in the horizon's frame: x east, y north, z up.
export function horizonVector(altitude: number, azimuth: number, out: Float64Array, offset: number): void {
  const alt = altitude * DEGREES;
  const az = azimuth * DEGREES;
  out[offset] = Math.cos(alt) * Math.sin(az);
  out[offset + 1] = Math.cos(alt) * Math.cos(az);
  out[offset + 2] = Math.sin(alt);
}

// The same, straight from right ascension and declination: the rotation toHorizontal does, written
// out so a whole catalog can be turned each frame without trigonometry per star beyond these few.
export interface SkyRotation {
  // Rows of the matrix that takes a star's equatorial unit vector (x toward right ascension 0,
  // y toward 90, z toward the celestial north pole) to the horizon frame (x east, y north, z up).
  readonly matrix: Float64Array;
}

export function skyRotation(place: Place, siderealTime: number): SkyRotation {
  const latitude = place.latitude * DEGREES;
  const sidereal = siderealTime * DEGREES;
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const sinSidereal = Math.sin(sidereal);
  const cosSidereal = Math.cos(sidereal);
  // The equatorial frame turned by the sidereal time about the pole (so the meridian's right
  // ascension faces south), then tipped by the colatitude so the pole stands at the latitude's height.
  return {
    matrix: Float64Array.of(
      // east
      -sinSidereal,
      cosSidereal,
      0,
      // north
      -sinLatitude * cosSidereal,
      -sinLatitude * sinSidereal,
      cosLatitude,
      // up
      cosLatitude * cosSidereal,
      cosLatitude * sinSidereal,
      sinLatitude,
    ),
  };
}

export function equatorialVector(rightAscension: number, declination: number): [number, number, number] {
  const ra = rightAscension * DEGREES;
  const dec = declination * DEGREES;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}
