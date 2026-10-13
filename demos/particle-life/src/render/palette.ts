import { hslToBeamColor } from "@vector-demos/demo-kit";
import type { BeamColor } from "@vector-display/core";

// Evenly spaced hues, slightly desaturated so the glow reads as light rather than paint.
export function createSpeciesPalette(speciesCount: number, hueOffset = 0.02): BeamColor[] {
  const colors: BeamColor[] = [];
  for (let index = 0; index < speciesCount; index++) {
    colors.push(hslToBeamColor(hueOffset + index / speciesCount, 0.85, 0.62));
  }
  return colors;
}
