export interface ClipRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

// The part of segment (x0, y0)–(x1, y1) inside the rectangle, as [startT, endT] along it, or null.
// Liang–Barsky: clip the segment's parameter range against each of the four edges in turn.
export function clipSegmentInside(x0: number, y0: number, x1: number, y1: number, rect: ClipRect): [number, number] | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let start = 0;
  let end = 1;
  const edges: [number, number][] = [
    [-dx, x0 - rect.left],
    [dx, rect.right - x0],
    [-dy, y0 - rect.top],
    [dy, rect.bottom - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) start = Math.max(start, t);
    else end = Math.min(end, t);
    if (start > end) return null;
  }
  return [start, end];
}

// The parts of a segment outside every rectangle, as [startT, endT] ranges in order along it.
// Used to keep one layer from drawing over a window drawn on top of it, since beams add up.
export function clipSegmentOutside(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rects: ClipRect | readonly ClipRect[],
): [number, number][] {
  let pieces: [number, number][] = [[0, 1]];
  for (const rect of Array.isArray(rects) ? rects : [rects as ClipRect]) {
    const inside = clipSegmentInside(x0, y0, x1, y1, rect);
    if (!inside) continue;
    const [cutStart, cutEnd] = inside;
    pieces = pieces.flatMap(([start, end]): [number, number][] => {
      const kept: [number, number][] = [];
      if (cutStart > start) kept.push([start, Math.min(end, cutStart)]);
      if (cutEnd < end) kept.push([Math.max(start, cutEnd), end]);
      return kept.filter(([a, b]) => b > a);
    });
  }
  return pieces;
}
