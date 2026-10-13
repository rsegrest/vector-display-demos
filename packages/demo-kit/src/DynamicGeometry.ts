import { NO_NEIGHBOR_SEGMENT, type ShapeGeometry } from "@vector-display/core";

const FLOATS_PER_SEGMENT = 4;

// Line geometry rebuilt every frame. Reuses its buffers, growing only when a frame needs more room.
// addSegment() draws loose strokes; moveTo/lineTo/closePath draw connected paths, which the renderer
// joins seamlessly instead of doubling the brightness where segments meet.
export class DynamicGeometry implements ShapeGeometry {
  public segmentCoordinates: Float32Array;
  public segmentNeighbors: Int32Array;
  private usedSegmentCount = 0;
  private pathStartX = 0;
  private pathStartY = 0;
  private penX = 0;
  private penY = 0;
  private pathFirstSegment = NO_NEIGHBOR_SEGMENT;
  private pathLastSegment = NO_NEIGHBOR_SEGMENT;

  public constructor(initialSegmentCapacity = 256) {
    this.segmentCoordinates = new Float32Array(initialSegmentCapacity * FLOATS_PER_SEGMENT);
    this.segmentNeighbors = new Int32Array(initialSegmentCapacity * 2);
  }

  public get segmentCount(): number {
    return this.usedSegmentCount;
  }

  public clear(): void {
    this.usedSegmentCount = 0;
    this.pathFirstSegment = NO_NEIGHBOR_SEGMENT;
    this.pathLastSegment = NO_NEIGHBOR_SEGMENT;
  }

  // A loose segment. One whose ends coincide draws as a round dot.
  public addSegment(startX: number, startY: number, endX: number, endY: number): void {
    this.pathLastSegment = NO_NEIGHBOR_SEGMENT;
    this.appendSegment(startX, startY, endX, endY);
  }

  public moveTo(x: number, y: number): void {
    this.pathStartX = this.penX = x;
    this.pathStartY = this.penY = y;
    this.pathFirstSegment = NO_NEIGHBOR_SEGMENT;
    this.pathLastSegment = NO_NEIGHBOR_SEGMENT;
  }

  public lineTo(x: number, y: number): void {
    const segment = this.appendSegment(this.penX, this.penY, x, y);
    if (this.pathLastSegment !== NO_NEIGHBOR_SEGMENT) {
      this.segmentNeighbors[this.pathLastSegment * 2 + 1] = segment;
      this.segmentNeighbors[segment * 2] = this.pathLastSegment;
    } else {
      this.pathFirstSegment = segment;
    }
    this.pathLastSegment = segment;
    this.penX = x;
    this.penY = y;
  }

  public closePath(): void {
    if (this.pathLastSegment === NO_NEIGHBOR_SEGMENT) return;
    this.lineTo(this.pathStartX, this.pathStartY);
    if (this.pathLastSegment !== this.pathFirstSegment) {
      this.segmentNeighbors[this.pathLastSegment * 2 + 1] = this.pathFirstSegment;
      this.segmentNeighbors[this.pathFirstSegment * 2] = this.pathLastSegment;
    }
    this.pathFirstSegment = NO_NEIGHBOR_SEGMENT;
    this.pathLastSegment = NO_NEIGHBOR_SEGMENT;
  }

  private appendSegment(startX: number, startY: number, endX: number, endY: number): number {
    if (this.usedSegmentCount * FLOATS_PER_SEGMENT >= this.segmentCoordinates.length) this.grow();
    const segment = this.usedSegmentCount++;
    const offset = segment * FLOATS_PER_SEGMENT;
    this.segmentCoordinates[offset] = startX;
    this.segmentCoordinates[offset + 1] = startY;
    this.segmentCoordinates[offset + 2] = endX;
    this.segmentCoordinates[offset + 3] = endY;
    this.segmentNeighbors[segment * 2] = NO_NEIGHBOR_SEGMENT;
    this.segmentNeighbors[segment * 2 + 1] = NO_NEIGHBOR_SEGMENT;
    return segment;
  }

  private grow(): void {
    const grownCoordinates = new Float32Array(this.segmentCoordinates.length * 2);
    grownCoordinates.set(this.segmentCoordinates);
    this.segmentCoordinates = grownCoordinates;
    const grownNeighbors = new Int32Array(this.segmentNeighbors.length * 2);
    grownNeighbors.set(this.segmentNeighbors);
    this.segmentNeighbors = grownNeighbors;
  }
}
