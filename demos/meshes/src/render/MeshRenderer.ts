import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry } from "@vector-demos/demo-kit";
import type { MeshTopology } from "../sim/mesh.js";
import { DepthBuffer } from "./DepthBuffer.js";

export type EdgeMode = "FEATURES" | "ALL EDGES";

export interface MeshView {
  // Turn about the vertical axis, then tip toward the viewer, in radians.
  readonly yaw: number;
  readonly pitch: number;
  readonly centreX: number;
  readonly centreY: number;
  // Screen units that the mesh's bounding radius covers.
  readonly scale: number;
  // Edges where the surface bends by more than this many degrees are drawn as creases.
  readonly creaseDegrees: number;
  readonly mode: EdgeMode;
  readonly hiddenLines: boolean;
}

export interface EdgeCounts {
  silhouette: number;
  crease: number;
  other: number;
  // Segments actually drawn, after hidden parts were cut away.
  segments: number;
}

const SILHOUETTE_COLOR: BeamColor = { red: 1, green: 0.95, blue: 0.8 };
const CREASE_COLOR: BeamColor = { red: 0.4, green: 0.9, blue: 1 };
const OTHER_COLOR: BeamColor = { red: 0.3, green: 0.5, blue: 0.9 };

// The eye sits this many bounding radii from the mesh's centre.
const EYE_DISTANCE = 4;
// How much nearer than a point a surface must be before it hides the point, as a
// fraction. Lines lie on the surface they belong to, so some slack is needed.
const DEPTH_TOLERANCE = 0.012;
// The depth grid covers the mesh's bounding sphere with this much margin.
const GRID_MARGIN = 1.08;

// Draws a mesh as a line drawing. Out of all its edges it keeps the ones a
// draughtsman would: the outline (silhouette edges, where a triangle facing the
// viewer meets one facing away), sharp folds (creases) and open borders. Then it
// cuts away whatever part of those the mesh itself hides.
export class MeshRenderer {
  private readonly depth = new DepthBuffer(512);
  private readonly silhouette = new DynamicGeometry(2048);
  private readonly crease = new DynamicGeometry(2048);
  private readonly other = new DynamicGeometry(4096);
  private screenX = new Float32Array(0);
  private screenY = new Float32Array(0);
  private nearness = new Float32Array(0);
  private facing = new Uint8Array(0);
  // Converts between screen and depth-grid coordinates for the current frame.
  private gridScale = 1;
  private gridOriginX = 0;
  private gridOriginY = 0;

  public draw(displayList: DisplayList, topology: MeshTopology, view: MeshView, intensity = 1): EdgeCounts {
    const { mesh, vertexCount, faceCount, edgeCount } = topology;
    const { positions, indices } = mesh;
    if (this.screenX.length < vertexCount) {
      this.screenX = new Float32Array(vertexCount);
      this.screenY = new Float32Array(vertexCount);
      this.nearness = new Float32Array(vertexCount);
    }
    if (this.facing.length < faceCount) this.facing = new Uint8Array(faceCount);
    const { screenX, screenY, nearness, facing } = this;

    const cosYaw = Math.cos(view.yaw);
    const sinYaw = Math.sin(view.yaw);
    const cosPitch = Math.cos(view.pitch);
    const sinPitch = Math.sin(view.pitch);
    const focal = view.scale * EYE_DISTANCE;
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const x = positions[vertex * 3];
      const y = positions[vertex * 3 + 1];
      const z = positions[vertex * 3 + 2];
      const turnedX = x * cosYaw + z * sinYaw;
      const turnedZ = -x * sinYaw + z * cosYaw;
      const tippedY = y * cosPitch - turnedZ * sinPitch;
      const tippedZ = y * sinPitch + turnedZ * cosPitch;
      const inverse = 1 / (EYE_DISTANCE - tippedZ);
      screenX[vertex] = view.centreX + turnedX * focal * inverse;
      screenY[vertex] = view.centreY - tippedY * focal * inverse;
      nearness[vertex] = inverse;
    }

    // Where the eye is, in the mesh's own frame: the view rotation undone.
    const eyeY = EYE_DISTANCE * sinPitch;
    const eyeHorizontal = EYE_DISTANCE * cosPitch;
    const eyeX = -eyeHorizontal * sinYaw;
    const eyeZ = eyeHorizontal * cosYaw;
    const { faceNormals } = topology;
    for (let face = 0; face < faceCount; face++) {
      const corner = indices[face * 3] * 3;
      const towardEye =
        faceNormals[face * 3] * (eyeX - positions[corner]) +
        faceNormals[face * 3 + 1] * (eyeY - positions[corner + 1]) +
        faceNormals[face * 3 + 2] * (eyeZ - positions[corner + 2]);
      facing[face] = towardEye > 0 ? 1 : 0;
    }

    if (view.hiddenLines) this.fillDepth(topology, view);

    this.silhouette.clear();
    this.crease.clear();
    this.other.clear();
    const counts: EdgeCounts = { silhouette: 0, crease: 0, other: 0, segments: 0 };
    const creaseCosine = Math.cos((view.creaseDegrees * Math.PI) / 180);
    const { edgeVertices, edgeFaces, edgeCosine } = topology;
    for (let edge = 0; edge < edgeCount; edge++) {
      const firstFace = edgeFaces[edge * 2];
      const secondFace = edgeFaces[edge * 2 + 1];
      const firstFront = facing[firstFace] === 1;
      const secondFront = secondFace >= 0 && facing[secondFace] === 1;
      let geometry: DynamicGeometry;
      if (secondFace < 0) {
        // An open border is where the surface simply stops.
        geometry = this.crease;
        counts.crease++;
      } else if (firstFront !== secondFront) {
        geometry = this.silhouette;
        counts.silhouette++;
      } else {
        // Both sides face away: with hidden lines on, the mesh's own front covers
        // this edge, so there is no need to test it.
        if (view.hiddenLines && !firstFront) continue;
        if (edgeCosine[edge] < creaseCosine) {
          geometry = this.crease;
          counts.crease++;
        } else if (view.mode === "ALL EDGES") {
          geometry = this.other;
          counts.other++;
        } else {
          continue;
        }
      }
      const from = edgeVertices[edge * 2];
      const to = edgeVertices[edge * 2 + 1];
      if (!view.hiddenLines) {
        geometry.addSegment(screenX[from], screenY[from], screenX[to], screenY[to]);
        continue;
      }
      this.depth.traceVisible(
        this.toGridX(screenX[from]),
        this.toGridY(screenY[from]),
        nearness[from],
        this.toGridX(screenX[to]),
        this.toGridY(screenY[to]),
        nearness[to],
        DEPTH_TOLERANCE,
        (startX, startY, endX, endY) =>
          geometry.addSegment(this.fromGridX(startX), this.fromGridY(startY), this.fromGridX(endX), this.fromGridY(endY)),
      );
    }

    for (const [geometry, color, strength] of [
      [this.other, OTHER_COLOR, 0.3],
      [this.crease, CREASE_COLOR, 0.7],
      [this.silhouette, SILHOUETTE_COLOR, 1.1],
    ] as const) {
      if (geometry.segmentCount === 0) continue;
      counts.segments += geometry.segmentCount;
      displayList.setColor(color);
      displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: strength * intensity });
    }
    return counts;
  }

  // Measures the triangles into the depth grid. On a closed surface only those
  // facing the viewer can hide anything, which halves the work. On a mesh with
  // holes the ones facing away are included too: they are what you see through a hole.
  private fillDepth(topology: MeshTopology, view: MeshView): void {
    const { indices } = topology.mesh;
    const { screenX, screenY, nearness, depth } = this;
    const halfExtent = view.scale * GRID_MARGIN * (EYE_DISTANCE / Math.sqrt(EYE_DISTANCE * EYE_DISTANCE - 1));
    this.gridScale = depth.size / (2 * halfExtent);
    this.gridOriginX = view.centreX - halfExtent;
    this.gridOriginY = view.centreY - halfExtent;
    depth.clear();
    const frontOnly = topology.isClosed;
    for (let face = 0; face < topology.faceCount; face++) {
      if (frontOnly && !this.facing[face]) continue;
      const a = indices[face * 3];
      const b = indices[face * 3 + 1];
      const c = indices[face * 3 + 2];
      depth.fillTriangle(
        this.toGridX(screenX[a]),
        this.toGridY(screenY[a]),
        nearness[a],
        this.toGridX(screenX[b]),
        this.toGridY(screenY[b]),
        nearness[b],
        this.toGridX(screenX[c]),
        this.toGridY(screenY[c]),
        nearness[c],
      );
    }
  }

  private toGridX(x: number): number {
    return (x - this.gridOriginX) * this.gridScale;
  }

  private toGridY(y: number): number {
    return (y - this.gridOriginY) * this.gridScale;
  }

  private fromGridX(x: number): number {
    return x / this.gridScale + this.gridOriginX;
  }

  private fromGridY(y: number): number {
    return y / this.gridScale + this.gridOriginY;
  }
}
