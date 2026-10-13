import { describe, expect, it } from "vitest";
import {
    blinkerCellsAfter,
    cellBoxesOf,
    cellSizeForGrid,
    countLiveNeighbors,
    createEmptyGrid,
    gliderCellsAfter,
    gliderSpeedInCellsPerGeneration,
    isAlive,
    nextGeneration,
    populationOf,
    setAlive,
    stampBlinker,
    stampBlock,
    stampDisk,
    stampGlider,
    wrapCoordinate,
    type LiveCells,
} from "../src/lifeRules.js";

function gridWith(columns: number, rows: number, cells: readonly (readonly [number, number])[]): LiveCells {
    const live = createEmptyGrid({ columns, rows });
    for (const [column, row] of cells) setAlive(live, column, row, true);
    return live;
}

function liveCoordinates(live: LiveCells): string[] {
    const coordinates: string[] = [];
    for (let row = 0; row < live.rows; row++) {
        for (let column = 0; column < live.columns; column++) {
            if (live.cells[row * live.columns + column] !== 0) coordinates.push(`${column},${row}`);
        }
    }
    return coordinates.sort();
}

function blinkerAt(originColumn: number, originRow: number): LiveCells {
    const live = createEmptyGrid({ columns: 9, rows: 9 });
    stampBlinker(live, originColumn, originRow);
    return live;
}

describe("lifeRules", () => {
    describe("neighbour counting", () => {
        it("counts the eight surrounding cells and not the centre", () => {
            const full = gridWith(4, 4, [
                [0, 0], [1, 0], [2, 0], [3, 0],
                [0, 1], [1, 1], [2, 1], [3, 1],
                [0, 2], [1, 2], [2, 2], [3, 2],
                [0, 3], [1, 3], [2, 3], [3, 3],
            ]);
            expect(countLiveNeighbors(full, 1, 1)).toBe(8);
        });

        it("excludes diagonals from the orthogonal-only case", () => {
            const diagonalOnly = gridWith(5, 5, [[0, 0], [4, 0], [0, 4], [4, 4]]);
            expect(countLiveNeighbors(diagonalOnly, 2, 2)).toBe(0);
        });

        it("does not count a cell as its own neighbour on a one-by-one grid", () => {
            // Every offset wraps back onto the only cell, so a naive torus loop counts it 8 times.
            expect(countLiveNeighbors(gridWith(1, 1, [[0, 0]]), 0, 0)).toBe(0);
        });

        it("counts wrapped offset visits on a two-by-two grid, where a neighbour is reached more than once", () => {
            // On a 2x2 torus the three other cells are touched by all eight offsets. This
            // locks in the documented semantics: offsets are visited, not distinct cells.
            // (The one-by-one case above is different: the only offset target is the cell
            // itself, and a cell is never its own neighbour.)
            const full = gridWith(2, 2, [[0, 0], [1, 0], [0, 1], [1, 1]]);
            expect(countLiveNeighbors(full, 0, 0)).toBe(8);
        });
    });

    describe("wrapping coordinates", () => {
        it("wraps a negative coordinate to the far edge, which plain % does not", () => {
            expect(wrapCoordinate(-1, 10)).toBe(9);
            expect(-1 % 10).toBe(-1);
        });

        it("wraps a coordinate past the far edge back to the start", () => {
            expect(wrapCoordinate(10, 10)).toBe(0);
            expect(wrapCoordinate(23, 10)).toBe(3);
        });
    });

    describe("the three rules", () => {
        it("kills a live cell with fewer than two neighbours", () => {
            expect(populationOf(nextGeneration(gridWith(9, 9, [[4, 4]])))).toBe(0);
        });

        it("keeps a live cell with two neighbours alive", () => {
            // The blinker's centre cell has exactly two neighbours and survives.
            expect(isAlive(nextGeneration(blinkerAt(2, 4)), 3, 4)).toBe(true);
        });

        it("kills a live cell with more than three neighbours", () => {
            const crowded = gridWith(9, 9, [
                [3, 3], [4, 3], [5, 3],
                [3, 4], [4, 4], [5, 4],
                [3, 5], [4, 5], [5, 5],
            ]);
            expect(isAlive(nextGeneration(crowded), 4, 4)).toBe(false);
        });

        it("brings a dead cell to life with exactly three neighbours", () => {
            // Both ends of the blinker's row see the other two cells and are reborn vertically.
            const next = nextGeneration(blinkerAt(2, 4));
            expect(isAlive(next, 3, 3)).toBe(true);
            expect(isAlive(next, 3, 5)).toBe(true);
            expect(isAlive(next, 2, 4)).toBe(false);
            expect(isAlive(next, 4, 4)).toBe(false);
        });

        it("does not bring a dead cell with two neighbours to life", () => {
            // The cell directly above the blinker's centre sees only two cells.
            const next = nextGeneration(blinkerAt(2, 4));
            expect(isAlive(next, 3, 3)).toBe(true);
            expect(isAlive(next, 2, 3)).toBe(false);
        });

        it("leaves every other cell dead, so nothing is fabricated", () => {
            expect(populationOf(nextGeneration(blinkerAt(2, 4)))).toBe(3);
        });
    });

    describe("known patterns", () => {
        it("flips a blinker to its other orientation and back after two generations", () => {
            const horizontal = nextGeneration(blinkerAt(2, 4));
            expect(liveCoordinates(horizontal)).toEqual(blinkerCellsAfter(2, 4, 1));
            expect(liveCoordinates(nextGeneration(horizontal))).toEqual(blinkerCellsAfter(2, 4, 2));
        });

        it("leaves a block untouched, because every cell has three neighbours", () => {
            const block = createEmptyGrid({ columns: 9, rows: 9 });
            stampBlock(block, 3, 3);
            expect(liveCoordinates(nextGeneration(block))).toEqual(liveCoordinates(block));
        });

        it("moves a glider one cell diagonally every four generations", () => {
            let travelling = createEmptyGrid({ columns: 20, rows: 20 });
            stampGlider(travelling, 1, 1);
            for (let generation = 0; generation < 4; generation++) travelling = nextGeneration(travelling);
            expect(liveCoordinates(travelling)).toEqual(gliderCellsAfter(1, 1, 4));
        });

        it("agrees with the independently computed glider travel, not with the rules themselves", () => {
            let travelling = createEmptyGrid({ columns: 20, rows: 20 });
            stampGlider(travelling, 1, 1);
            for (let generation = 0; generation < 8; generation++) travelling = nextGeneration(travelling);
            expect(liveCoordinates(travelling)).toEqual(gliderCellsAfter(1, 1, 8));
        });

        it("keeps the glider's population at five cells as it crosses an edge", () => {
            // A glider that clipped the edge would lose cells; a wrapping one never does.
            let travelling = createEmptyGrid({ columns: 20, rows: 20 });
            stampGlider(travelling, 18, 18);
            for (let generation = 0; generation < 24; generation++) {
                expect(populationOf(travelling)).toBe(5);
                travelling = nextGeneration(travelling);
            }
        });

        it("reports the glider's measured speed, one cell per four generations", () => {
            expect(gliderSpeedInCellsPerGeneration()).toBeCloseTo(0.25, 10);
        });
    });

    describe("geometry", () => {
        it("picks the smaller cell so a grid fits whichever axis is tighter", () => {
            expect(cellSizeForGrid({ columns: 10, rows: 10 }, 100, 50)).toBe(5);
            expect(cellSizeForGrid({ columns: 20, rows: 10 }, 100, 50)).toBe(5);
        });

        it("returns one box per live cell only", () => {
            const boxes = cellBoxesOf(blinkerAt(2, 4), 10, 0.7);
            expect(boxes).toHaveLength(3);
            expect(boxes.every((box) => box.size === 7)).toBe(true);
        });

        it("centres each box on its cell so neighbours keep a gap", () => {
            // The gap is what stops a dense lattice reading as one solid blob.
            const cellSize = 10;
            const fillRatio = 0.7;
            const [leftBox, rightBox] = cellBoxesOf(gridWith(5, 5, [[0, 0], [1, 0]]), cellSize, fillRatio);
            const gap = rightBox.column * cellSize - leftBox.column * cellSize - leftBox.size;
            expect(gap).toBeCloseTo(cellSize * (1 - fillRatio), 10);
        });

        it("returns no boxes for an empty grid", () => {
            expect(cellBoxesOf(createEmptyGrid({ columns: 8, rows: 8 }), 10, 0.7)).toHaveLength(0);
        });
    });

    describe("seeding", () => {
        it("stamps a disk that is round, not square", () => {
            const live = createEmptyGrid({ columns: 15, rows: 15 });
            stampDisk(live, 7, 7, 3);
            // The corners of the bounding box fall outside a radius-3 circle.
            expect(isAlive(live, 4, 4)).toBe(false);
            expect(isAlive(live, 7, 7)).toBe(true);
            expect(isAlive(live, 4, 7)).toBe(true);
        });

        it("seeds across an edge instead of growing the grid, because it wraps", () => {
            const live = createEmptyGrid({ columns: 3, rows: 3 });
            const before = live.cells.length;
            stampDisk(live, 0, 0, 2);
            expect(live.cells.length).toBe(before);
            expect(populationOf(live)).toBeGreaterThan(0);
        });
    });
});
