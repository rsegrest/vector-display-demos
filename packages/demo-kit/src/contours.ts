import type { DynamicGeometry } from "./DynamicGeometry.js";

export interface ContourTransform {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
}

const NONE = -1;

// Marching squares edge pairs for each of the 16 corner cases. Corners: 0 top-left, 1 top-right,
// 2 bottom-right, 3 bottom-left (bit i set = corner i at or above the level). Edges: 0 top, 1 right,
// 2 bottom, 3 left. The saddles (5 and 10) are listed for "center below"; trace() flips them.
const CASE_EDGES: readonly (readonly number[])[] = [
  [], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
  [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [3, 1], [0, 1], [3, 0], [],
];
const SADDLE_CENTER_ABOVE: Readonly<Record<number, readonly number[]>> = {
  5: [0, 1, 2, 3],
  10: [3, 0, 1, 2],
};

// Traces iso-lines of a scalar grid into connected paths. Each crossing point lies on a grid edge
// shared by exactly two cells, so segments are linked through their edges into chains; closed loops
// become closed paths, which the renderer joins without bright beads at every vertex.
// The torus seam is not crossed, so contours cut by the grid border stay open.
export class ContourTracer {
  private readonly edgeFirstSegment: Int32Array;
  private readonly edgeSecondSegment: Int32Array;
  private readonly edgePointX: Float32Array;
  private readonly edgePointY: Float32Array;
  private segmentEdgeA = new Int32Array(1024);
  private segmentEdgeB = new Int32Array(1024);
  private visited = new Uint8Array(1024);
  private segmentCount = 0;
  private readonly touchedEdges: Int32Array;
  private touchedCount = 0;

  public constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    const edgeCount = 2 * width * height;
    this.edgeFirstSegment = new Int32Array(edgeCount).fill(NONE);
    this.edgeSecondSegment = new Int32Array(edgeCount).fill(NONE);
    this.edgePointX = new Float32Array(edgeCount);
    this.edgePointY = new Float32Array(edgeCount);
    this.touchedEdges = new Int32Array(edgeCount);
  }

  public trace(field: Float32Array, level: number, geometry: DynamicGeometry, transform: ContourTransform): void {
    this.resetEdges();
    this.findSegments(field, level);
    this.emitChains(geometry, transform);
  }

  private findSegments(field: Float32Array, level: number): void {
    const { width, height } = this;
    const verticalBase = width * height;
    const edgeIds = [0, 0, 0, 0];
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const topLeft = field[y * width + x];
        const topRight = field[y * width + x + 1];
        const bottomRight = field[(y + 1) * width + x + 1];
        const bottomLeft = field[(y + 1) * width + x];
        const caseIndex =
          (topLeft >= level ? 1 : 0) | (topRight >= level ? 2 : 0) | (bottomRight >= level ? 4 : 0) | (bottomLeft >= level ? 8 : 0);
        if (caseIndex === 0 || caseIndex === 15) continue;
        let edges = CASE_EDGES[caseIndex];
        if ((caseIndex === 5 || caseIndex === 10) && (topLeft + topRight + bottomRight + bottomLeft) / 4 >= level) {
          edges = SADDLE_CENTER_ABOVE[caseIndex];
        }
        edgeIds[0] = y * width + x;
        edgeIds[1] = verticalBase + y * width + x + 1;
        edgeIds[2] = (y + 1) * width + x;
        edgeIds[3] = verticalBase + y * width + x;
        for (let pair = 0; pair < edges.length; pair += 2) {
          const edgeA = edgeIds[edges[pair]];
          const edgeB = edgeIds[edges[pair + 1]];
          this.placeEdgePoint(field, level, edgeA);
          this.placeEdgePoint(field, level, edgeB);
          this.addSegment(edgeA, edgeB);
        }
      }
    }
  }

  // Linear interpolation of where the level crosses an edge, in grid units.
  private placeEdgePoint(field: Float32Array, level: number, edge: number): void {
    if (this.edgeFirstSegment[edge] !== NONE) return;
    const { width } = this;
    const verticalBase = width * this.height;
    const isVertical = edge >= verticalBase;
    const index = isVertical ? edge - verticalBase : edge;
    const x = index % width;
    const y = (index - x) / width;
    const start = field[index];
    const end = isVertical ? field[index + width] : field[index + 1];
    const t = (level - start) / (end - start);
    this.edgePointX[edge] = isVertical ? x : x + t;
    this.edgePointY[edge] = isVertical ? y + t : y;
  }

  private addSegment(edgeA: number, edgeB: number): void {
    if (this.segmentCount >= this.segmentEdgeA.length) this.growSegments();
    const segment = this.segmentCount++;
    this.segmentEdgeA[segment] = edgeA;
    this.segmentEdgeB[segment] = edgeB;
    this.visited[segment] = 0;
    this.attach(edgeA, segment);
    this.attach(edgeB, segment);
  }

  private attach(edge: number, segment: number): void {
    if (this.edgeFirstSegment[edge] === NONE) {
      this.edgeFirstSegment[edge] = segment;
      this.touchedEdges[this.touchedCount++] = edge;
    } else {
      this.edgeSecondSegment[edge] = segment;
    }
  }

  private across(edge: number, fromSegment: number): number {
    const first = this.edgeFirstSegment[edge];
    return first === fromSegment ? this.edgeSecondSegment[edge] : first;
  }

  private otherEdge(segment: number, edge: number): number {
    return this.segmentEdgeA[segment] === edge ? this.segmentEdgeB[segment] : this.segmentEdgeA[segment];
  }

  private emitChains(geometry: DynamicGeometry, transform: ContourTransform): void {
    const { offsetX, offsetY, scale } = transform;
    for (let seed = 0; seed < this.segmentCount; seed++) {
      if (this.visited[seed]) continue;

      // Walk backward to the start of an open chain, or all the way round a closed loop.
      let startSegment = seed;
      let startEdge = this.segmentEdgeA[seed];
      let isClosed = false;
      for (;;) {
        const previous = this.across(startEdge, startSegment);
        if (previous === NONE) break;
        if (previous === seed) {
          isClosed = true;
          startSegment = seed;
          startEdge = this.segmentEdgeA[seed];
          break;
        }
        startEdge = this.otherEdge(previous, startEdge);
        startSegment = previous;
      }

      geometry.moveTo(offsetX + this.edgePointX[startEdge] * scale, offsetY + this.edgePointY[startEdge] * scale);
      let segment = startSegment;
      let entryEdge = startEdge;
      for (;;) {
        this.visited[segment] = 1;
        const exitEdge = this.otherEdge(segment, entryEdge);
        const next = this.across(exitEdge, segment);
        if (isClosed && next === startSegment) {
          geometry.closePath();
          break;
        }
        geometry.lineTo(offsetX + this.edgePointX[exitEdge] * scale, offsetY + this.edgePointY[exitEdge] * scale);
        if (next === NONE || this.visited[next]) break;
        segment = next;
        entryEdge = exitEdge;
      }
    }
  }

  private resetEdges(): void {
    for (let i = 0; i < this.touchedCount; i++) {
      const edge = this.touchedEdges[i];
      this.edgeFirstSegment[edge] = NONE;
      this.edgeSecondSegment[edge] = NONE;
    }
    this.touchedCount = 0;
    this.segmentCount = 0;
  }

  private growSegments(): void {
    const grow = <T extends Int32Array | Uint8Array>(array: T, make: (size: number) => T): T => {
      const grown = make(array.length * 2);
      grown.set(array);
      return grown;
    };
    this.segmentEdgeA = grow(this.segmentEdgeA, (size) => new Int32Array(size));
    this.segmentEdgeB = grow(this.segmentEdgeB, (size) => new Int32Array(size));
    this.visited = grow(this.visited, (size) => new Uint8Array(size));
  }
}
