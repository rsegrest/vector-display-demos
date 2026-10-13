// Turns a generation of Life into beam segments. Kept apart from lifeRules.ts so the
// automaton stays about cells and this stays about light.
//
// Why cells fade by age: a CRT does not have a frame buffer the way a canvas does. The
// beam has to DRAW every lit cell, one after another, and the phosphor keeps glowing
// after the beam moves on. So a cell that was born this generation is drawn hot and
// white, and a cell that has survived twenty generations is drawn as a dim ember. When a
// glider travels, you are not seeing two images swap -- you are seeing where the beam
// has been.

import type { BeamColor, Polyline } from "@vector-display/core";
import { cellBoxesOf, type CellBox, type LiveCells } from "./lifeRules.js";

/** Ages at or above this all render as the oldest bucket; keeps the palette finite. */
export const MAXIMUM_TRACKED_AGE = 24;

export interface BeamPalette {
    /** Color of a cell born this generation. */
    readonly newest: BeamColor;
    /** Color a cell settles into once it has survived many generations. */
    readonly oldest: BeamColor;
    /** Dimming applied across the ramp, 1 for none. */
    readonly oldestIntensity: number;
}

/** Hot white core through amber to a deep phosphor green, the way old tubes actually bled. */
export const DEFAULT_BEAM_PALETTE: BeamPalette = {
    newest: { red: 1, green: 1, blue: 1 },
    oldest: { red: 0.15, green: 0.85, blue: 0.35 },
    oldestIntensity: 0.32,
};

export function ageBucketOf(age: number, bucketCount: number): number {
    const clampedAge = Math.min(Math.max(age, 0), MAXIMUM_TRACKED_AGE);
    const bucket = Math.floor((clampedAge / MAXIMUM_TRACKED_AGE) * bucketCount);
    return Math.min(bucket, bucketCount - 1);
}

/** Cells grouped by age bucket, newest first, so each bucket can be drawn as one shape. */
export function groupCellsByAgeBucket(
    live: LiveCells,
    ages: Uint8Array,
    cellSize: number,
    fillRatio: number,
    bucketCount: number,
): CellBox[][] {
    const boxes = cellBoxesOf(live, cellSize, fillRatio);
    const buckets: CellBox[][] = Array.from({ length: bucketCount }, () => []);
    for (const box of boxes) {
        const age = ages[box.row * live.columns + box.column];
        buckets[ageBucketOf(age, bucketCount)].push(box);
    }
    return buckets;
}

/** Center of a cell in world units. */
export function cellCenter(column: number, row: number, cellSize: number): { x: number; y: number } {
    return { x: (column + 0.5) * cellSize, y: (row + 0.5) * cellSize };
}

/** One closed square outline per cell, so the beam traces a wireframe lattice. */
export function polylinesForCellBoxes(boxes: readonly CellBox[], cellSize: number): Polyline[] {
    const polylines: Polyline[] = [];
    for (const box of boxes) {
        const center = cellCenter(box.column, box.row, cellSize);
        const half = box.size / 2;
        polylines.push({
            points: [
                { x: center.x - half, y: center.y - half },
                { x: center.x + half, y: center.y - half },
                { x: center.x + half, y: center.y + half },
                { x: center.x - half, y: center.y + half },
            ],
            isClosed: true,
        });
    }
    return polylines;
}

function mix(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
}

/** Bucket 0 is the newest, so the ramp runs from the palette's newest to its oldest. */
export function beamColorForBucket(bucketIndex: number, bucketCount: number, palette: BeamPalette): BeamColor {
    const amount = bucketCount <= 1 ? 0 : bucketIndex / (bucketCount - 1);
    return {
        red: mix(palette.newest.red, palette.oldest.red, amount),
        green: mix(palette.newest.green, palette.oldest.green, amount),
        blue: mix(palette.newest.blue, palette.oldest.blue, amount),
    };
}

/** Newest cells burn brightest, so a birth is visible as a flash. */
export function beamIntensityForBucket(bucketIndex: number, bucketCount: number, palette: BeamPalette): number {
    const amount = bucketCount <= 1 ? 0 : bucketIndex / (bucketCount - 1);
    return mix(1, palette.oldestIntensity, amount);
}

/** Ages advance for surviving cells and reset to zero for cells born this generation. */
export function advanceAges(previous: LiveCells, ages: Uint8Array, next: LiveCells): Uint8Array {
    const advanced = new Uint8Array(next.cells.length);
    for (let index = 0; index < next.cells.length; index++) {
        if (next.cells[index] === 0) continue;
        const survived = previous.cells[index] !== 0;
        advanced[index] = survived ? Math.min(ages[index] + 1, MAXIMUM_TRACKED_AGE) : 0;
    }
    return advanced;
}
