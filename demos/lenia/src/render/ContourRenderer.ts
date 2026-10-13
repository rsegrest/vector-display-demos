import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList, type ShapePlacement } from "@vector-display/core";
import { DynamicGeometry, hslToBeamColor } from "@vector-demos/demo-kit";
import { ContourTracer } from "./contours.js";

export interface ContourStyle {
  readonly levelCount: number;
  // World units each level is lifted above the one below, for a stacked-terrain look; 0 draws flat.
  readonly reliefPerLevel: number;
}

interface Level {
  readonly value: number;
  readonly color: BeamColor;
  readonly placement: ShapePlacement;
  readonly geometry: DynamicGeometry;
}

// Draws a Lenia field as nested iso-lines, like a topographic map: faint deep blue at the creature's
// edge, rising through cyan and green to near-white at its densest core.
export class ContourRenderer {
  private readonly tracer: ContourTracer;
  private levels: Level[] = [];

  public constructor(
    private readonly gridWidth: number,
    private readonly gridHeight: number,
  ) {
    this.tracer = new ContourTracer(gridWidth, gridHeight);
  }

  public draw(displayList: DisplayList, field: Float32Array, worldWidth: number, worldHeight: number, style: ContourStyle): number {
    if (this.levels.length !== style.levelCount) this.levels = createLevels(style.levelCount);
    // Cover the screen: the grid's 2:1 aspect is cropped slightly rather than letterboxed.
    const scale = Math.max(worldWidth / this.gridWidth, worldHeight / this.gridHeight);
    const offsetX = (worldWidth - this.gridWidth * scale) / 2;
    const offsetY = (worldHeight - this.gridHeight * scale) / 2;
    let segmentCount = 0;
    this.levels.forEach((level, index) => {
      level.geometry.clear();
      this.tracer.trace(field, level.value, level.geometry, {
        offsetX,
        offsetY: offsetY - index * style.reliefPerLevel,
        scale,
      });
      if (level.geometry.segmentCount === 0) return;
      segmentCount += level.geometry.segmentCount;
      displayList.setColor(level.color);
      displayList.addShape(level.geometry, level.placement);
    });
    return segmentCount;
  }
}

function createLevels(count: number): Level[] {
  const levels: Level[] = [];
  for (let index = 0; index < count; index++) {
    const amount = count === 1 ? 0.5 : index / (count - 1);
    // Hue from blue (0.62) to yellow-green (0.2); lightness rises toward white at the top.
    const color = hslToBeamColor(0.62 - 0.42 * amount, 0.9 - 0.4 * amount, 0.5 + 0.35 * amount);
    levels.push({
      value: 0.06 + 0.82 * amount,
      color,
      placement: { ...SCREEN_SPACE_PLACEMENT, intensity: 0.55 + 0.75 * amount },
      geometry: new DynamicGeometry(2048),
    });
  }
  return levels;
}
