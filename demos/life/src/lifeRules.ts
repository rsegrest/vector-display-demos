// The Game of Life's rules and the beam geometry that draws a generation, with no
// DOM dependency: this module decides where the beam travels, an adapter decides
// how that reaches a canvas. Rendering live cells as wireframe squares rather than
// filled pixels is the point of drawing Life on a CRT -- the display has to *draw*
// every cell and dwell on each one, so successive generations decay into each other
// on the phosphor instead of simply replacing one image with the next.
//
// The grid is a TORUS: coordinates wrap, so a pattern that leaves one edge returns on
// the opposite edge. On a bounded grid a glider eventually dies against a wall and the
// screen goes still; on a torus it travels forever, which is what keeps a display that
// runs for hours alive on its own.

export interface CellGridSize {
    readonly columns: number;
    readonly rows: number;
}

export interface LiveCells {
    readonly columns: number;
    readonly rows: number;
    /** One byte per cell, row-major. Non-zero means alive. */
    readonly cells: Uint8Array;
}

export interface CellBox {
    readonly column: number;
    readonly row: number;
    readonly size: number;
}

/** Cell size in world units chosen so a grid fills the world without touching its edges. */
export function cellSizeForGrid(grid: CellGridSize, worldWidth: number, worldHeight: number): number {
    return Math.min(worldWidth / grid.columns, worldHeight / grid.rows);
}

/**
 * Squares are grown about their own centre so neighbours leave a gap of
 * (1 - fillRatio) of a cell. Cells that touch read as one continuous shape and a
 * dense lattice turns back into blobs; the gap is what keeps the grid legible.
 */
export function cellBoxesOf(live: LiveCells, cellSize: number, fillRatio: number): CellBox[] {
    const drawnSize = cellSize * fillRatio;
    const boxes: CellBox[] = [];
    for (let row = 0; row < live.rows; row++) {
        for (let column = 0; column < live.columns; column++) {
            if (live.cells[row * live.columns + column] === 0) continue;
            boxes.push({ column, row, size: drawnSize });
        }
    }
    return boxes;
}

export function createEmptyGrid(grid: CellGridSize): LiveCells {
    return { columns: grid.columns, rows: grid.rows, cells: new Uint8Array(grid.columns * grid.rows) };
}

// JavaScript's % keeps the sign of the dividend, so -1 % 10 is -1 rather than 9.
export function wrapCoordinate(value: number, limit: number): number {
    return ((value % limit) + limit) % limit;
}

/** Any coordinate is valid: it names a cell somewhere on the torus. */
export function isAlive(live: LiveCells, column: number, row: number): boolean {
    const wrappedColumn = wrapCoordinate(column, live.columns);
    const wrappedRow = wrapCoordinate(row, live.rows);
    return live.cells[wrappedRow * live.columns + wrappedColumn] !== 0;
}

export function setAlive(live: LiveCells, column: number, row: number, alive: boolean): void {
    const wrappedColumn = wrapCoordinate(column, live.columns);
    const wrappedRow = wrapCoordinate(row, live.rows);
    live.cells[wrappedRow * live.columns + wrappedColumn] = alive ? 1 : 0;
}

/** Living neighbours among the eight surrounding cells, wrapping at every edge. */
export function countLiveNeighbors(live: LiveCells, column: number, row: number): number {
    const wrappedColumn = wrapCoordinate(column, live.columns);
    const wrappedRow = wrapCoordinate(row, live.rows);
    let count = 0;
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
            if (columnOffset === 0 && rowOffset === 0) continue;
            const neighborColumn = wrapCoordinate(column + columnOffset, live.columns);
            const neighborRow = wrapCoordinate(row + rowOffset, live.rows);
            // A cell is never its own neighbour. This only bites on tiny grids, where an
            // offset wraps all the way back; real grids are far wider than three cells.
            if (neighborColumn === wrappedColumn && neighborRow === wrappedRow) continue;
            if (live.cells[neighborRow * live.columns + neighborColumn] !== 0) count++;
        }
    }
    return count;
}

/** Conway's rules: a live cell survives on two or three neighbours; a dead cell with exactly three comes to life. */
export function nextGeneration(live: LiveCells): LiveCells {
    const { columns, rows } = live;
    const next = createEmptyGrid(live);
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const liveNeighbors = countLiveNeighbors(live, column, row);
            const alive = live.cells[row * columns + column] !== 0;
            const surviving = alive ? liveNeighbors === 2 || liveNeighbors === 3 : liveNeighbors === 3;
            next.cells[row * columns + column] = surviving ? 1 : 0;
        }
    }
    return next;
}

/** Total live cells, so a caller can detect a still life or an extinction. */
export function populationOf(live: LiveCells): number {
    let population = 0;
    for (let index = 0; index < live.cells.length; index++) {
        if (live.cells[index] !== 0) population++;
    }
    return population;
}

/** Live cells within `radius` of a point, for seeding under a pointer. */
export function stampDisk(live: LiveCells, centerColumn: number, centerRow: number, radius: number): void {
    for (let rowOffset = -radius; rowOffset <= radius; rowOffset++) {
        for (let columnOffset = -radius; columnOffset <= radius; columnOffset++) {
            if (columnOffset * columnOffset + rowOffset * rowOffset > radius * radius) continue;
            setAlive(live, centerColumn + columnOffset, centerRow + rowOffset, true);
        }
    }
}

const GLIDER_PERIOD = 4;

// This orientation travels one cell right and one cell down every four generations.
const GLIDER_OFFSETS: readonly (readonly [number, number])[] = [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
];

/** One glider, the smallest pattern that travels. */
export function stampGlider(live: LiveCells, originColumn: number, originRow: number): void {
    for (const [columnOffset, rowOffset] of GLIDER_OFFSETS) {
        setAlive(live, originColumn + columnOffset, originRow + rowOffset, true);
    }
}

/** Where a glider's cells should be after `generations` steps, for asserting travel. */
export function gliderCellsAfter(originColumn: number, originRow: number, generations: number): string[] {
    const steps = generations / GLIDER_PERIOD;
    return GLIDER_OFFSETS.map(
        ([columnOffset, rowOffset]) => `${originColumn + columnOffset + steps},${originRow + rowOffset + steps}`,
    ).sort();
}

/** A glider moves one cell diagonally every four generations, so this is its true speed. */
export function gliderSpeedInCellsPerGeneration(): number {
    return 1 / GLIDER_PERIOD;
}

/**
 * The blinker, the smallest oscillator: three cells in a row. After one generation it
 * stands vertical, after two it is horizontal again.
 */
export function blinkerCellsAfter(originColumn: number, originRow: number, generations: number): string[] {
    return generations % 2 === 0
        ? [`${originColumn},${originRow}`, `${originColumn + 1},${originRow}`, `${originColumn + 2},${originRow}`]
        : [`${originColumn + 1},${originRow - 1}`, `${originColumn + 1},${originRow}`, `${originColumn + 1},${originRow + 1}`];
}

/** Three cells in a row, horizontally. */
export function stampBlinker(live: LiveCells, originColumn: number, originRow: number): void {
    for (const columnOffset of [0, 1, 2]) setAlive(live, originColumn + columnOffset, originRow, true);
}

/** The four-cell still life, useful as a known-stable pattern in tests. */
export function stampBlock(live: LiveCells, originColumn: number, originRow: number): void {
    for (const [columnOffset, rowOffset] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
    ]) {
        setAlive(live, originColumn + columnOffset, originRow + rowOffset, true);
    }
}
