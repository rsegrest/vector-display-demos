import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry, hslToBeamColor } from "@vector-demos/demo-kit";
import type { ProjectionSettings } from "./terrainProjector.js";

export interface TerrainStyle {
  // Width of the visible frame, in world units.
  readonly screenWidth: number;
  // Lateral size of one automaton cell, in world units.
  readonly cellWidth: number;
  // How high a height of 1 rises above the ground.
  readonly ridgeHeight: number;
  // Depth between one generation and the next.
  readonly rowSpacing: number;
  // Depth of the nearest generation when `scroll` is 0.
  readonly firstDepth: number;
  // How far the terrain has slid toward the camera since the last generation
  // arrived, 0..1 of a row spacing. This is what makes the flight continuous.
  readonly scroll: number;
  // Number of depth bands; each is one colour and one geometry batch.
  readonly bandCount: number;
  // Hide whatever a nearer ridge stands in front of.
  readonly hiddenLines: boolean;
}

interface Band {
  readonly geometry: DynamicGeometry;
  color: BeamColor;
  intensity: number;
}

// Hidden lines are resolved per screen column, at this resolution across the frame.
const OCCLUSION_COLUMNS = 1024;

// Draws a stack of generations as receding ridgelines, one line per generation and
// nothing else. The automaton is a ring, so each ridgeline is tiled sideways as far
// as the view needs: the land reaches the horizon on both sides instead of narrowing
// to a strip.
//
// Lines hidden behind nearer ground are removed with a floating horizon. Rows are
// traced nearest first, and for every screen column we remember the highest point
// drawn so far; a farther row shows only where it rises above that. It is exact for
// a surface like this one, seen from above, and costs one pass over the columns.
export class TerrainRenderer {
  private bands: Band[] = [];
  private readonly horizon = new Float32Array(OCCLUSION_COLUMNS);
  private readonly rowY = new Float32Array(OCCLUSION_COLUMNS);

  // `heights` holds one row of 0..1 heights per generation, oldest (nearest) first.
  public draw(
    displayList: DisplayList,
    heights: readonly Float32Array[],
    projection: ProjectionSettings,
    style: TerrainStyle,
  ): number {
    if (this.bands.length !== style.bandCount) this.bands = createBands(style.bandCount);
    for (const band of this.bands) band.geometry.clear();
    if (heights.length === 0) return 0;

    this.horizon.fill(Infinity);
    const rowCount = heights.length;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const position = rowIndex - style.scroll;
      const depth = style.firstDepth + position * style.rowSpacing;
      if (depth <= projection.nearDepth) continue;
      const bandIndex = Math.max(0, Math.min(style.bandCount - 1, Math.floor((position / rowCount) * style.bandCount)));
      this.traceRow(this.bands[bandIndex].geometry, heights[rowIndex], depth, projection, style);
    }

    let segmentCount = 0;
    this.bands.forEach((band, index) => {
      if (band.geometry.segmentCount === 0) return;
      const amount = index / Math.max(1, style.bandCount - 1);
      band.color = hslToBeamColor(0.5 + 0.16 * amount, 0.9 - 0.25 * amount, 0.8 - 0.4 * amount);
      // The farthest band is nearly dark, so a new generation fades in at the
      // horizon rather than popping.
      band.intensity = 0.05 + 0.65 * (1 - amount) * (1 - amount);
      segmentCount += band.geometry.segmentCount;
      displayList.setColor(band.color);
      displayList.addShape(band.geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: band.intensity });
    });
    return segmentCount;
  }

  // One generation, left edge of the screen to the right. Walks the ridgeline across
  // the occlusion columns, starting and ending strokes wherever it passes behind or
  // out from behind nearer ground, then lowers the horizon to include it.
  private traceRow(
    geometry: DynamicGeometry,
    heights: Float32Array,
    depth: number,
    projection: ProjectionSettings,
    style: TerrainStyle,
  ): void {
    const { horizon, rowY } = this;
    const cellCount = heights.length;
    const scale = projection.focalLength / depth;
    const cellScreenWidth = style.cellWidth * scale;
    const groundY = projection.horizonY + projection.cameraHeight * scale;
    const rise = style.ridgeHeight * scale;
    const columnWidth = style.screenWidth / OCCLUSION_COLUMNS;
    const centreColumn = Math.floor(cellCount / 2);
    // Enough cells either side of the flight path to pass both screen edges.
    const halfSpan = Math.ceil(Math.max(projection.centreX, style.screenWidth - projection.centreX) / cellScreenWidth) + 1;

    let drawing = false;
    let penX = 0;
    let lastX = 0;
    let lastY = 0;
    let firstTouched = OCCLUSION_COLUMNS;
    let lastTouched = -1;
    let previousX = 0;
    let previousY = 0;

    for (let offset = -halfSpan; offset <= halfSpan; offset++) {
      const cell = (((centreColumn + offset) % cellCount) + cellCount) % cellCount;
      const x = projection.centreX + offset * cellScreenWidth;
      const y = groundY - heights[cell] * rise;
      if (offset > -halfSpan) {
        const first = Math.max(0, Math.ceil(previousX / columnWidth - 0.5));
        const last = Math.min(OCCLUSION_COLUMNS - 1, Math.ceil(x / columnWidth - 0.5) - 1);
        for (let column = first; column <= last; column++) {
          const sampleX = (column + 0.5) * columnWidth;
          const sampleY = previousY + ((y - previousY) * (sampleX - previousX)) / (x - previousX);
          rowY[column] = sampleY;
          if (column < firstTouched) firstTouched = column;
          if (column > lastTouched) lastTouched = column;
          const visible = !style.hiddenLines || sampleY < horizon[column];
          if (visible) {
            if (!drawing) {
              geometry.moveTo(sampleX, sampleY);
              penX = sampleX;
              drawing = true;
            }
            lastX = sampleX;
            lastY = sampleY;
          } else if (drawing) {
            if (lastX !== penX) geometry.lineTo(lastX, lastY);
            drawing = false;
          }
        }
        // Keep the ridge's own corners while it is in view, so peaks stay sharp.
        if (drawing && x > penX && x <= style.screenWidth) {
          geometry.lineTo(x, y);
          penX = x;
          lastX = x;
          lastY = y;
        }
      }
      previousX = x;
      previousY = y;
    }
    if (drawing && lastX !== penX) geometry.lineTo(lastX, lastY);

    for (let column = firstTouched; column <= lastTouched; column++) {
      if (rowY[column] < horizon[column]) horizon[column] = rowY[column];
    }
  }
}

function createBands(count: number): Band[] {
  const bands: Band[] = [];
  for (let index = 0; index < count; index++) {
    bands.push({ geometry: new DynamicGeometry(2048), color: { red: 1, green: 1, blue: 1 }, intensity: 1 });
  }
  return bands;
}

// The depth at which the ground plane meets the bottom edge of the screen. Starting
// the nearest generation a little nearer than this keeps the terrain's leading edge
// out of sight as it slides past.
export function depthAtScreenBottom(projection: ProjectionSettings, screenHeight: number): number {
  return (projection.cameraHeight * projection.focalLength) / (screenHeight - projection.horizonY);
}
