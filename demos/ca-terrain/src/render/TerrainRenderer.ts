import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry, hslToBeamColor } from "@vector-demos/demo-kit";
import { projectPoint, type ProjectionSettings } from "./terrainProjector.js";

export interface TerrainStyle {
  // Full lateral extent of the automaton, in world units.
  readonly worldWidth: number;
  // How high a live cell rises above the ground.
  readonly ridgeHeight: number;
  // Depth between one generation and the next.
  readonly rowSpacing: number;
  // Depth of the nearest generation.
  readonly nearDepth: number;
  // Number of depth bands; each is one colour and one geometry batch.
  readonly bandCount: number;
  // Draw the walls joining one ridgeline to the next.
  readonly showWalls: boolean;
}

interface Band {
  readonly geometry: DynamicGeometry;
  color: BeamColor;
  intensity: number;
}

// Draws a stack of generations as receding ridgelines: each row of the automaton is
// a cross-section of terrain, and the walls between rows turn the stack into a
// surface. Lines are rebuilt each frame as the history scrolls, so the phosphor
// smears them into motion.
export class TerrainRenderer {
  private bands: Band[] = [];

  public draw(
    displayList: DisplayList,
    rows: readonly Uint8Array[],
    projection: ProjectionSettings,
    style: TerrainStyle,
  ): number {
    if (this.bands.length !== style.bandCount) this.bands = createBands(style.bandCount);
    for (const band of this.bands) band.geometry.clear();
    if (rows.length === 0) return 0;

    const rowCount = rows.length;
    const cellCount = rows[0].length;
    const denominator = Math.max(1, cellCount - 1);
    let segmentCount = 0;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const depth = style.nearDepth + rowIndex * style.rowSpacing;
      const band = this.bands[Math.min(style.bandCount - 1, Math.floor((rowIndex / rowCount) * style.bandCount))];
      const geometry = band.geometry;

      // The ridgeline for this generation.
      for (let column = 0; column < cellCount; column++) {
        const lateral = (column / denominator - 0.5) * style.worldWidth;
        const altitude = rows[rowIndex][column] ? style.ridgeHeight : 0;
        const point = projectPoint(lateral, altitude, depth, projection);
        if (column === 0) geometry.moveTo(point.x, point.y);
        else geometry.lineTo(point.x, point.y);
      }

      // The wall down to the next generation, only where something is raised.
      if (style.showWalls && rowIndex + 1 < rowCount) {
        const nextDepth = style.nearDepth + (rowIndex + 1) * style.rowSpacing;
        for (let column = 0; column < cellCount; column++) {
          if (!rows[rowIndex][column] && !rows[rowIndex + 1][column]) continue;
          const lateral = (column / denominator - 0.5) * style.worldWidth;
          const start = projectPoint(lateral, rows[rowIndex][column] ? style.ridgeHeight : 0, depth, projection);
          const end = projectPoint(lateral, rows[rowIndex + 1][column] ? style.ridgeHeight : 0, nextDepth, projection);
          geometry.addSegment(start.x, start.y, end.x, end.y);
        }
      }
    }

    this.bands.forEach((band, index) => {
      if (band.geometry.segmentCount === 0) return;
      const amount = index / Math.max(1, style.bandCount - 1);
      band.color = hslToBeamColor(0.5 + 0.14 * amount, 0.9 - 0.35 * amount, 0.82 - 0.5 * amount);
      band.intensity = 0.95 - 0.85 * amount;
      segmentCount += band.geometry.segmentCount;
      displayList.setColor(band.color);
      displayList.addShape(band.geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: band.intensity });
    });
    return segmentCount;
  }
}

function createBands(count: number): Band[] {
  const bands: Band[] = [];
  for (let index = 0; index < count; index++) {
    bands.push({ geometry: new DynamicGeometry(2048), color: { red: 1, green: 1, blue: 1 }, intensity: 1 });
  }
  return bands;
}

// The lateral width that makes the nearest generation span the whole screen. The
// vanishing point sits at the screen centre, so the world is centred on it too.
export function worldWidthFor(projection: ProjectionSettings, screenWidth: number, nearDepth: number): number {
  return (screenWidth * nearDepth) / projection.focalLength;
}
