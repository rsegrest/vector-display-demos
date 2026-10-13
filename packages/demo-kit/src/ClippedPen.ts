import type { ClipRect } from "./clip.js";
import { clipSegmentInside, clipSegmentOutside } from "./clip.js";
import type { DynamicGeometry } from "./DynamicGeometry.js";

export interface PenClip {
  // Keep only what is inside this rectangle.
  readonly inside?: ClipRect;
  // Drop whatever falls inside these rectangles (windows drawn over this layer).
  readonly outside?: readonly ClipRect[];
}

// moveTo / lineTo / closePath onto a DynamicGeometry, clipped to rectangles. Unclipped runs stay
// connected paths (no bright beads at the joints); a closed shape that was never cut stays closed.
export class ClippedPen {
  private geometry: DynamicGeometry | null = null;
  private clip: PenClip = {};
  private penX = 0;
  private penY = 0;
  private startX = 0;
  private startY = 0;
  private hasPen = false;
  // Where the geometry's current subpath ends, if it is still open at the pen.
  private isDrawnToPen = false;
  private wasCut = false;
  private segmentsInPath = 0;

  public begin(geometry: DynamicGeometry, clip: PenClip = {}): void {
    this.geometry = geometry;
    this.clip = clip;
    this.hasPen = false;
    this.isDrawnToPen = false;
  }

  public moveTo(x: number, y: number): void {
    this.penX = this.startX = x;
    this.penY = this.startY = y;
    this.hasPen = true;
    this.isDrawnToPen = false;
    this.wasCut = false;
    this.segmentsInPath = 0;
  }

  public lineTo(x: number, y: number): void {
    if (!this.hasPen) {
      this.moveTo(x, y);
      return;
    }
    const geometry = this.geometry!;
    const x0 = this.penX;
    const y0 = this.penY;
    // A (near) zero-length step would draw a stray dot: the beam renders zero-length segments as dots.
    if (Math.abs(x - x0) < 1e-3 && Math.abs(y - y0) < 1e-3) return;
    for (const [start, end] of this.visibleParts(x0, y0, x, y)) {
      const startsAtPen = start === 0 && this.isDrawnToPen;
      if (!startsAtPen) {
        if (start !== 0) this.wasCut = true;
        geometry.moveTo(x0 + (x - x0) * start, y0 + (y - y0) * start);
      }
      geometry.lineTo(x0 + (x - x0) * end, y0 + (y - y0) * end);
      this.segmentsInPath++;
      this.isDrawnToPen = end === 1;
      if (end !== 1) this.wasCut = true;
    }
    if (!this.isDrawnToPen) this.wasCut = true;
    this.penX = x;
    this.penY = y;
  }

  public closePath(): void {
    if (!this.hasPen) return;
    if (!this.wasCut && this.isDrawnToPen && this.segmentsInPath > 0) {
      this.geometry!.closePath();
    } else {
      this.lineTo(this.startX, this.startY);
    }
    this.hasPen = false;
    this.isDrawnToPen = false;
  }

  private visibleParts(x0: number, y0: number, x1: number, y1: number): [number, number][] {
    const { inside, outside } = this.clip;
    let parts: [number, number][] = [[0, 1]];
    if (inside) {
      const range = clipSegmentInside(x0, y0, x1, y1, inside);
      parts = range ? [range] : [];
    }
    if (outside && outside.length && parts.length) {
      parts = parts.flatMap(([start, end]) =>
        clipSegmentOutside(x0, y0, x1, y1, outside)
          .map(([a, b]): [number, number] => [Math.max(a, start), Math.min(b, end)])
          .filter(([a, b]) => b > a),
      );
    }
    return parts;
  }
}
