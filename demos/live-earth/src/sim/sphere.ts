// Small pieces of spherical geometry, all in degrees of longitude and latitude.

const RADIANS = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371;

export interface LngLat {
  lng: number;
  lat: number;
}

// Brings a longitude into -180..180.
export function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

// The point reached by setting out from (lng, lat) on `bearing` (clockwise from
// north) and travelling `distance` degrees of arc along a great circle.
export function destination(lng: number, lat: number, bearing: number, distance: number, out: LngLat): LngLat {
  const phi = lat * RADIANS;
  const theta = bearing * RADIANS;
  const delta = distance * RADIANS;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinDelta = Math.sin(delta);
  const cosDelta = Math.cos(delta);
  const sinLat = sinPhi * cosDelta + cosPhi * sinDelta * Math.cos(theta);
  out.lat = Math.asin(Math.max(-1, Math.min(1, sinLat))) / RADIANS;
  out.lng = wrapLongitude(lng + Math.atan2(Math.sin(theta) * sinDelta * cosPhi, cosDelta - sinPhi * sinLat) / RADIANS);
  return out;
}

// Great-circle distance between two points, in degrees of arc.
export function angularDistance(lngA: number, latA: number, lngB: number, latB: number): number {
  const phiA = latA * RADIANS;
  const phiB = latB * RADIANS;
  const cosine = Math.sin(phiA) * Math.sin(phiB) + Math.cos(phiA) * Math.cos(phiB) * Math.cos((lngB - lngA) * RADIANS);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / RADIANS;
}

// The unit vector for a point on the globe, in the frame the globe view uses:
// x toward longitude 90 east on the equator, y toward the north pole, z toward
// longitude 0 on the equator.
export function unitVector(lng: number, lat: number, out: Float32Array | number[], offset = 0): void {
  const phi = lat * RADIANS;
  const lambda = lng * RADIANS;
  const cosPhi = Math.cos(phi);
  out[offset] = cosPhi * Math.sin(lambda);
  out[offset + 1] = Math.sin(phi);
  out[offset + 2] = cosPhi * Math.cos(lambda);
}
