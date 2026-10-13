// Hidden-line removal for any mesh, by the method graphics hardware uses for
// surfaces: a depth buffer. The triangles are not drawn, only measured: for each
// cell of a grid over the picture, how near is the nearest surface there. A line
// is then walked across the grid, and the parts of it that lie behind that
// nearest surface are left out.
//
// It is approximate where an exact method would be exact (a line can be cut a
// grid cell early or late), but it works for every shape, however tangled, and
// costs the same whatever the shape is.

export type SegmentSink = (startX: number, startY: number, endX: number, endY: number) => void;

// Depth is stored as nearness, 1 / distance: larger is nearer, and 0 means nothing
// is there. Nearness, unlike distance, varies evenly across a triangle on screen.
export class DepthBuffer {
  public readonly size: number;
  private readonly nearness: Float32Array;

  public constructor(size = 512) {
    this.size = size;
    this.nearness = new Float32Array(size * size);
  }

  public clear(): void {
    this.nearness.fill(0);
  }

  // Nearness at a cell, or 0 outside the grid.
  public at(column: number, row: number): number {
    if (column < 0 || row < 0 || column >= this.size || row >= this.size) return 0;
    return this.nearness[row * this.size + column];
  }

  // Records a triangle given its corners in grid coordinates and their nearness.
  // Cells the triangle only clips are included, so thin triangles leave no pinholes
  // for hidden lines to show through.
  public fillTriangle(x0: number, y0: number, w0: number, x1: number, y1: number, w1: number, x2: number, y2: number, w2: number): void {
    const { size, nearness } = this;
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return;
    // Put the corners in a consistent order, so "inside" has one meaning below.
    if (area < 0) {
      [x1, x2] = [x2, x1];
      [y1, y2] = [y2, y1];
      [w1, w2] = [w2, w1];
      area = -area;
    }
    const left = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const right = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const top = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const bottom = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (left > right || top > bottom) return;

    // For each edge, a function that is positive on the triangle's side of it.
    const a0 = y0 - y1;
    const b0 = x1 - x0;
    const a1 = y1 - y2;
    const b1 = x2 - x1;
    const a2 = y2 - y0;
    const b2 = x0 - x2;
    // Half a cell's worth of slack on each edge takes in the cells merely clipped.
    const slack0 = (Math.abs(a0) + Math.abs(b0)) / 2;
    const slack1 = (Math.abs(a1) + Math.abs(b1)) / 2;
    const slack2 = (Math.abs(a2) + Math.abs(b2)) / 2;
    // Nearness as a flat function of position across the triangle.
    const slopeX = ((w1 - w0) * (y2 - y0) - (w2 - w0) * (y1 - y0)) / area;
    const slopeY = ((w2 - w0) * (x1 - x0) - (w1 - w0) * (x2 - x0)) / area;
    const lowest = Math.min(w0, w1, w2);
    const highest = Math.max(w0, w1, w2);

    // Step across each row adding the per-cell change, instead of working each cell out afresh.
    const startX = left + 0.5;
    for (let row = top; row <= bottom; row++) {
      const y = row + 0.5;
      let edge0 = a0 * (startX - x0) + b0 * (y - y0);
      let edge1 = a1 * (startX - x1) + b1 * (y - y1);
      let edge2 = a2 * (startX - x2) + b2 * (y - y2);
      let value = w0 + (startX - x0) * slopeX + (y - y0) * slopeY;
      let cell = row * size + left;
      for (let column = left; column <= right; column++) {
        if (edge0 >= -slack0 && edge1 >= -slack1 && edge2 >= -slack2) {
          // Kept within the triangle's own range, since clipped cells lie a little outside it.
          const clamped = value < lowest ? lowest : value > highest ? highest : value;
          if (clamped > nearness[cell]) nearness[cell] = clamped;
        }
        edge0 += a0;
        edge1 += a1;
        edge2 += a2;
        value += slopeX;
        cell++;
      }
    }
  }

  // Whether a point is in front of (or on) the nearest surface recorded around
  // it. A point counts as hidden only if every cell touching it holds something
  // clearly nearer, so a line lying on a surface is not broken by the grid's coarseness.
  public isVisible(x: number, y: number, pointNearness: number, tolerance: number): boolean {
    const column = Math.floor(x - 0.5);
    const row = Math.floor(y - 0.5);
    const limit = pointNearness * (1 + tolerance);
    return this.at(column, row) <= limit || this.at(column + 1, row) <= limit || this.at(column, row + 1) <= limit || this.at(column + 1, row + 1) <= limit;
  }

  // Walks a line (grid coordinates, with nearness at each end) and reports the
  // stretches of it that are not hidden.
  public traceVisible(x0: number, y0: number, w0: number, x1: number, y1: number, w1: number, tolerance: number, emit: SegmentSink): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    let runStart = -1;
    for (let step = 0; step <= steps; step++) {
      const amount = step / steps;
      const visible = this.isVisible(x0 + (x1 - x0) * amount, y0 + (y1 - y0) * amount, w0 + (w1 - w0) * amount, tolerance);
      if (visible && runStart < 0) runStart = step;
      if ((!visible || step === steps) && runStart >= 0) {
        // The run ends at the last visible sample: this one if still visible, else the one before.
        const end = visible ? step : step - 1;
        if (end > runStart || steps === 1) {
          const from = runStart / steps;
          const to = end / steps;
          emit(x0 + (x1 - x0) * from, y0 + (y1 - y0) * from, x0 + (x1 - x0) * to, y0 + (y1 - y0) * to);
        }
        runStart = -1;
      }
    }
  }
}
