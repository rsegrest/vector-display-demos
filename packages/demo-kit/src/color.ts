import type { BeamColor } from "@vector-display/core";

// Hue in turns (0–1); saturation and lightness 0–1.
export function hslToBeamColor(hue: number, saturation: number, lightness: number): BeamColor {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = (((hue % 1) + 1) % 1) * 6;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const [red, green, blue] =
    huePrime < 1 ? [chroma, secondary, 0]
    : huePrime < 2 ? [secondary, chroma, 0]
    : huePrime < 3 ? [0, chroma, secondary]
    : huePrime < 4 ? [0, secondary, chroma]
    : huePrime < 5 ? [secondary, 0, chroma]
    : [chroma, 0, secondary];
  const lightnessOffset = lightness - chroma / 2;
  return { red: red + lightnessOffset, green: green + lightnessOffset, blue: blue + lightnessOffset };
}
