import { FLOATS_PER_BEAM_SEGMENT, SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry, clipSegmentInside, clipSegmentOutside, type ClipRect } from "@vector-demos/demo-kit";

export interface BlitTransform {
  // Where the source's origin lands, and how much it is scaled.
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
  // A different scale for heights, for a picture whose screen was not the shape of its
  // coordinates (Tempest's tube is taller than its units are wide). By default, `scale`.
  readonly scaleY?: number;
  // Multiplies the brightness of everything copied.
  readonly intensity: number;
  // Only what falls inside this rectangle is kept...
  readonly inside: ClipRect;
  // ...and nothing that falls inside any of these, which are the windows in front.
  readonly outside: readonly ClipRect[];
}

interface Batch {
  readonly geometry: DynamicGeometry;
  color: BeamColor;
  intensity: number;
}

// Copies one display list into another, moved, scaled and cut to a rectangle.
//
// This is what makes windows possible. Every program draws into a display list of
// its own, at whatever size it likes, with no idea it is in a window; the strokes
// are then shrunk into the window's frame, trimmed at its edges, and cut away
// where another window lies on top. Trimming matters more here than on an
// ordinary screen: the beam's light adds up, so anything drawn "behind" a window
// would shine straight through it.
export class SegmentBlitter {
  private readonly batches: Batch[] = [];
  private used = 0;

  // Forget the last frame's copies. Call once per frame, before any blit.
  public beginFrame(): void {
    this.used = 0;
  }

  // Copies `source` into `target` and returns the number of segments written.
  public blit(source: DisplayList, target: DisplayList, transform: BlitTransform): number {
    const data = source.getSegmentData();
    const { offsetX, offsetY, scale, inside, outside } = transform;
    const scaleY = transform.scaleY ?? scale;
    const firstBatch = this.used;
    let batch: Batch | null = null;
    let red = Number.NaN;
    let green = 0;
    let blue = 0;
    let intensity = 0;
    // Where the last stroke written ended, if it was written whole, so the next can join on to it.
    let chainX = Number.NaN;
    let chainY = 0;

    for (let offset = 0; offset < data.length; offset += FLOATS_PER_BEAM_SEGMENT) {
      // A change of colour or brightness starts a new batch: each is drawn in one colour.
      if (data[offset + 8] !== red || data[offset + 9] !== green || data[offset + 10] !== blue || data[offset + 11] !== intensity) {
        red = data[offset + 8];
        green = data[offset + 9];
        blue = data[offset + 10];
        intensity = data[offset + 11];
        batch = this.nextBatch({ red, green, blue }, intensity * transform.intensity);
        chainX = Number.NaN;
      }
      const geometry = batch!.geometry;
      const x0 = offsetX + data[offset] * scale;
      const y0 = offsetY + data[offset + 1] * scaleY;
      const x1 = offsetX + data[offset + 2] * scale;
      const y1 = offsetY + data[offset + 3] * scaleY;

      // A stroke of no length is a dot: it is either there or not.
      if (x0 === x1 && y0 === y1) {
        if (isInside(x0, y0, inside) && !outside.some((rect) => isInside(x0, y0, rect))) geometry.addSegment(x0, y0, x1, y1);
        chainX = Number.NaN;
        continue;
      }

      // Most strokes lie wholly within the window and clear of every other: copy them straight across.
      if (isInside(x0, y0, inside) && isInside(x1, y1, inside) && !outside.some((rect) => mayCross(x0, y0, x1, y1, rect))) {
        if (data[offset + 12] === 1 && x0 === chainX && y0 === chainY) {
          geometry.lineTo(x1, y1);
        } else {
          geometry.moveTo(x0, y0);
          geometry.lineTo(x1, y1);
        }
        chainX = x1;
        chainY = y1;
        continue;
      }

      // The rest are cut: first to the window, then round whatever lies on top.
      chainX = Number.NaN;
      const kept = clipSegmentInside(x0, y0, x1, y1, inside);
      if (!kept) continue;
      const pieces = outside.length === 0 ? [kept] : clipSegmentOutside(x0, y0, x1, y1, outside);
      for (const [pieceStart, pieceEnd] of pieces) {
        const start = Math.max(pieceStart, kept[0]);
        const end = Math.min(pieceEnd, kept[1]);
        if (end <= start) continue;
        geometry.moveTo(x0 + (x1 - x0) * start, y0 + (y1 - y0) * start);
        geometry.lineTo(x0 + (x1 - x0) * end, y0 + (y1 - y0) * end);
      }
    }

    let written = 0;
    for (let index = firstBatch; index < this.used; index++) {
      const { geometry, color, intensity: batchIntensity } = this.batches[index];
      if (geometry.segmentCount === 0) continue;
      written += geometry.segmentCount;
      target.setColor(color);
      target.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: batchIntensity });
    }
    return written;
  }

  // Geometry buffers are kept and reused from frame to frame.
  private nextBatch(color: BeamColor, intensity: number): Batch {
    if (this.used === this.batches.length) this.batches.push({ geometry: new DynamicGeometry(256), color, intensity });
    const batch = this.batches[this.used++];
    batch.geometry.clear();
    batch.color = color;
    batch.intensity = intensity;
    return batch;
  }
}

function isInside(x: number, y: number, rect: ClipRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// Whether a stroke could touch a rectangle: true unless both ends are off the same side of it.
function mayCross(x0: number, y0: number, x1: number, y1: number, rect: ClipRect): boolean {
  return !((x0 < rect.left && x1 < rect.left) || (x0 > rect.right && x1 > rect.right) || (y0 < rect.top && y1 < rect.top) || (y0 > rect.bottom && y1 > rect.bottom));
}
