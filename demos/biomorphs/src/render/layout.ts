// Where the breeding grid goes. A 3x3 block: the parent in the middle and eight
// mutant children around it. Kept pure so the click hit-testing and the drawing
// always agree.

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BiomorphLayout {
  readonly parent: Rect;
  // Eight children, reading clockwise from the top left.
  readonly children: readonly Rect[];
  readonly cellSize: number;
}

// The eight cells around the centre, clockwise from the top left.
const CHILD_CELLS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
];

export function layoutBiomorphs(width: number, height: number, topInset: number, bottomInset: number): BiomorphLayout {
  const availableWidth = width * 0.94;
  const availableHeight = Math.max(120, height - topInset - bottomInset);
  const cellSize = Math.min(availableWidth / 3, availableHeight / 3);
  const originX = (width - cellSize * 3) / 2;
  const originY = topInset + (availableHeight - cellSize * 3) / 2;
  const cell = (column: number, row: number): Rect => ({
    x: originX + column * cellSize,
    y: originY + row * cellSize,
    width: cellSize,
    height: cellSize,
  });
  return {
    parent: cell(1, 1),
    children: CHILD_CELLS.map(([column, row]) => cell(column, row)),
    cellSize,
  };
}

export function centreOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

// Which cell a world point falls in: -1 for the parent, 0..7 for a child, or null
// for empty space between cells.
export function childIndexAt(layout: BiomorphLayout, x: number, y: number): number | null {
  if (contains(layout.parent, x, y)) return -1;
  for (let index = 0; index < layout.children.length; index++) {
    if (contains(layout.children[index], x, y)) return index;
  }
  return null;
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}
