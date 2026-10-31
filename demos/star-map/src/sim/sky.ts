import skyData from "../data/sky.json";

// The sky the star map draws, from d3-celestial's data (see tools/build_sky_data.py): positions are
// right ascension and declination in degrees (J2000), stars brightest first.

// [right ascension, declination, magnitude, B-V color index]
export type CatalogStar = readonly [number, number, number, number];
// [right ascension, declination]
export type SkyPoint = readonly [number, number];

export interface Constellation {
  readonly id: string;
  readonly name: string;
  // 1 for the major constellations, up to 3 for the faint ones.
  readonly rank: number;
  readonly label: SkyPoint;
  readonly lines: readonly (readonly SkyPoint[])[];
}

export interface Sky {
  readonly source: string;
  readonly stars: readonly CatalogStar[];
  // [index into stars, proper name]
  readonly starNames: readonly (readonly [number, string])[];
  readonly constellations: readonly Constellation[];
  readonly milkyWay: readonly { readonly contour: string; readonly points: readonly SkyPoint[] }[];
}

export const SKY = skyData as unknown as Sky;
