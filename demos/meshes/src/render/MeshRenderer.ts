import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { createModelPlacement, DEFAULT_PERSPECTIVE_CAMERA, MeshScene, type MeshTopology, type PerspectiveCamera } from "@vector-display/3d";
import { Angle, Vector } from "es-vector-math";

export type EdgeMode = "FEATURES" | "ALL EDGES";

export interface MeshView {
  // Turn about the vertical axis, then tip toward the viewer, in radians.
  readonly yaw: number;
  readonly pitch: number;
  // The middle of the frame: the drawing is centred there, and the frame is twice this size.
  readonly centreX: number;
  readonly centreY: number;
  // Screen units that the mesh's bounding radius covers.
  readonly scale: number;
  // Edges where the surface bends by more than this many degrees are drawn as creases.
  readonly creaseDegrees: number;
  readonly mode: EdgeMode;
  readonly hiddenLines: boolean;
}

// Segments drawn, by kind, after hidden parts were cut away.
export interface EdgeCounts {
  silhouette: number;
  crease: number;
  other: number;
  segments: number;
}

const SILHOUETTE_COLOR: BeamColor = { red: 1, green: 0.95, blue: 0.8 };
const CREASE_COLOR: BeamColor = { red: 0.4, green: 0.9, blue: 1 };
const OTHER_COLOR: BeamColor = { red: 0.3, green: 0.5, blue: 0.9 };

// The eye sits this many bounding radii from the mesh's centre.
const EYE_DISTANCE = 4;
// Depth-grid cells across the mesh (with a margin), whatever its size on screen.
const DEPTH_CELLS_ACROSS_MESH = 512;
const GRID_MARGIN = 1.08;
const MAX_DEPTH_COLUMNS = 2048;

// Draws one mesh as a line drawing with @vector-display/3d's MeshScene: the outline,
// sharp folds and open borders (or every edge, in ALL EDGES mode), with whatever the
// mesh itself hides cut away. This maps the demo's view (turn, tip, size on screen)
// onto the library's camera and placement, and keeps the demo's colors and weights.
export class MeshRenderer {
  private scene: MeshScene | null = null;
  private sceneKey = "";

  public draw(displayList: DisplayList, topology: MeshTopology, view: MeshView, intensity = 1): EdgeCounts {
    const scene = this.sceneFor(view);
    // The mesh fits a unit sphere: scaled to `scale`, at the camera's position, on the projection
    // plane, where it keeps its size; the eye EYE_DISTANCE radii behind it.
    const camera: PerspectiveCamera = {
      ...DEFAULT_PERSPECTIVE_CAMERA,
      position: new Vector(0, 0, 0),
      pitch: Angle.fromRadians(view.pitch),
      viewDistance: view.scale * EYE_DISTANCE,
      nearDistance: 1,
      screenCenterX: view.centreX,
      screenCenterY: view.centreY,
    };
    // In the library's axes (z away from the viewer), turning the demo's way is a negative yaw.
    const placement = createModelPlacement({ rotationY: Angle.fromRadians(-view.yaw), scale: view.scale });
    const [lines] = scene.render(camera, [
      { topology, placement, creaseAngleDegrees: view.creaseDegrees, drawAllEdges: view.mode === "ALL EDGES" },
    ]);
    const counts: EdgeCounts = {
      silhouette: lines.silhouettes.segmentCount,
      crease: lines.creases.segmentCount,
      other: lines.otherEdges.segmentCount,
      segments: 0,
    };
    for (const [geometry, color, strength] of [
      [lines.otherEdges, OTHER_COLOR, 0.3],
      [lines.creases, CREASE_COLOR, 0.7],
      [lines.silhouettes, SILHOUETTE_COLOR, 1.1],
    ] as const) {
      if (geometry.segmentCount === 0) continue;
      counts.segments += geometry.segmentCount;
      displayList.setColor(color);
      displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: strength * intensity });
    }
    return counts;
  }

  // A scene for this frame size and mesh size, its depth grid as fine across the mesh as
  // the demo's own was; made again only when those change.
  private sceneFor(view: MeshView): MeshScene {
    const screenWidth = Math.max(1, view.centreX * 2);
    const screenHeight = Math.max(1, view.centreY * 2);
    const depthColumns = Math.min(MAX_DEPTH_COLUMNS, Math.ceil((DEPTH_CELLS_ACROSS_MESH * screenWidth) / (2 * view.scale * GRID_MARGIN)));
    const key = `${screenWidth}x${screenHeight}:${depthColumns}:${view.hiddenLines}`;
    if (!this.scene || key !== this.sceneKey) {
      this.scene = new MeshScene({ screenWidth, screenHeight, depthColumns, hiddenLines: view.hiddenLines });
      this.sceneKey = key;
    }
    return this.scene;
  }
}
