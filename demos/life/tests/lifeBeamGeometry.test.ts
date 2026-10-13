import { describe, expect, it } from "vitest";
import {
    DEFAULT_BEAM_PALETTE,
    MAXIMUM_TRACKED_AGE,
    advanceAges,
    ageBucketOf,
    beamColorForBucket,
    beamIntensityForBucket,
    cellCenter,
    groupCellsByAgeBucket,
    polylinesForCellBoxes,
} from "../src/lifeBeamGeometry.js";
import { createEmptyGrid, nextGeneration, setAlive, stampBlinker } from "../src/lifeRules.js";

function blinkerGrid() {
    const live = createEmptyGrid({ columns: 9, rows: 9 });
    stampBlinker(live, 2, 4);
    return live;
}

describe("lifeBeamGeometry", () => {
    describe("age buckets", () => {
        it("puts a newborn in the newest bucket", () => {
            expect(ageBucketOf(0, 8)).toBe(0);
        });

        it("puts a cell at the maximum tracked age in the last bucket, not past it", () => {
            expect(ageBucketOf(MAXIMUM_TRACKED_AGE, 8)).toBe(7);
        });

        it("clamps an age beyond the maximum into the last bucket", () => {
            expect(ageBucketOf(MAXIMUM_TRACKED_AGE * 10, 8)).toBe(7);
        });

        it("never returns a bucket index outside the palette", () => {
            for (let age = 0; age <= MAXIMUM_TRACKED_AGE + 5; age++) {
                const bucket = ageBucketOf(age, 4);
                expect(bucket).toBeGreaterThanOrEqual(0);
                expect(bucket).toBeLessThan(4);
            }
        });

        it("puts an older cell in a later bucket than a younger one", () => {
            expect(ageBucketOf(20, 8)).toBeGreaterThan(ageBucketOf(1, 8));
        });
    });

    describe("the colour ramp", () => {
        it("gives the newest bucket the palette's newest colour and the last the oldest", () => {
            expect(beamColorForBucket(0, 8, DEFAULT_BEAM_PALETTE)).toEqual(DEFAULT_BEAM_PALETTE.newest);
            const oldest = beamColorForBucket(7, 8, DEFAULT_BEAM_PALETTE);
            expect(oldest.red).toBeCloseTo(DEFAULT_BEAM_PALETTE.oldest.red, 10);
            expect(oldest.green).toBeCloseTo(DEFAULT_BEAM_PALETTE.oldest.green, 10);
            expect(oldest.blue).toBeCloseTo(DEFAULT_BEAM_PALETTE.oldest.blue, 10);
        });

        it("runs green downward from newest to oldest, so survivors cool toward phosphor green", () => {
            const newest = beamColorForBucket(0, 8, DEFAULT_BEAM_PALETTE);
            const oldest = beamColorForBucket(7, 8, DEFAULT_BEAM_PALETTE);
            expect(oldest.green).toBeLessThan(newest.green);
            expect(oldest.blue).toBeLessThan(newest.blue);
        });

        it("dims with age so a birth is brighter than a survivor", () => {
            expect(beamIntensityForBucket(0, 8, DEFAULT_BEAM_PALETTE)).toBe(1);
            expect(beamIntensityForBucket(7, 8, DEFAULT_BEAM_PALETTE)).toBeCloseTo(
                DEFAULT_BEAM_PALETTE.oldestIntensity,
                10,
            );
            expect(beamIntensityForBucket(3, 8, DEFAULT_BEAM_PALETTE)).toBeLessThan(1);
            expect(beamIntensityForBucket(3, 8, DEFAULT_BEAM_PALETTE)).toBeGreaterThan(
                DEFAULT_BEAM_PALETTE.oldestIntensity,
            );
        });

        it("survives a single-bucket palette without dividing by zero", () => {
            expect(beamColorForBucket(0, 1, DEFAULT_BEAM_PALETTE)).toEqual(DEFAULT_BEAM_PALETTE.newest);
            expect(beamIntensityForBucket(0, 1, DEFAULT_BEAM_PALETTE)).toBe(1);
        });
    });

    describe("grouping by age", () => {
        it("returns one bucket per requested bucket and accounts for every live cell", () => {
            const live = blinkerGrid();
            const ages = new Uint8Array(live.cells.length);
            ages[4 * 9 + 2] = MAXIMUM_TRACKED_AGE;
            const buckets = groupCellsByAgeBucket(live, ages, 10, 0.7, 4);
            expect(buckets).toHaveLength(4);
            expect(buckets.flat()).toHaveLength(3);
        });

        it("separates a newborn from an old survivor", () => {
            const live = blinkerGrid();
            const ages = new Uint8Array(live.cells.length);
            ages[4 * 9 + 2] = MAXIMUM_TRACKED_AGE; // leftmost cell is old
            const buckets = groupCellsByAgeBucket(live, ages, 10, 0.7, 4);
            expect(buckets[3]).toHaveLength(1);
            expect(buckets[0]).toHaveLength(2);
        });
    });

    describe("cell outlines", () => {
        it("emits one closed square per cell", () => {
            const boxes = groupCellsByAgeBucket(blinkerGrid(), new Uint8Array(81), 10, 0.7, 1)[0];
            const polylines = polylinesForCellBoxes(boxes, 10);
            expect(polylines).toHaveLength(3);
            expect(polylines.every((polyline) => polyline.isClosed)).toBe(true);
            expect(polylines.every((polyline) => polyline.points.length === 4)).toBe(true);
        });

        it("centres a cell on its grid slot rather than on its corner", () => {
            expect(cellCenter(0, 0, 10)).toEqual({ x: 5, y: 5 });
            expect(cellCenter(2, 3, 20)).toEqual({ x: 50, y: 70 });
        });

        it("draws each square inside its own slot so neighbours never overlap", () => {
            const boxes = groupCellsByAgeBucket(
                (() => {
                    const live = createEmptyGrid({ columns: 9, rows: 9 });
                    setAlive(live, 2, 4, true);
                    setAlive(live, 3, 4, true);
                    return live;
                })(),
                new Uint8Array(81),
                10,
                0.7,
                1,
            )[0];
            const [left, right] = polylinesForCellBoxes(boxes, 10);
            const leftRightEdge = Math.max(...left.points.map((point) => point.x));
            const rightLeftEdge = Math.min(...right.points.map((point) => point.x));
            expect(rightLeftEdge).toBeGreaterThan(leftRightEdge);
        });
    });

    describe("aging across generations", () => {
        it("resets a cell born this generation to age zero", () => {
            const previous = createEmptyGrid({ columns: 9, rows: 9 });
            const next = createEmptyGrid({ columns: 9, rows: 9 });
            setAlive(next, 1, 1, true);
            const ages = advanceAges(previous, new Uint8Array(81), next);
            expect(ages[1 * 9 + 1]).toBe(0);
        });

        it("increments a cell that survived", () => {
            const previous = createEmptyGrid({ columns: 9, rows: 9 });
            setAlive(previous, 1, 1, true);
            const next = createEmptyGrid({ columns: 9, rows: 9 });
            setAlive(next, 1, 1, true);
            const ages = new Uint8Array(81);
            ages[1 * 9 + 1] = 5;
            expect(advanceAges(previous, ages, next)[1 * 9 + 1]).toBe(6);
        });

        it("stops aging at the maximum so the palette stays bounded", () => {
            const previous = createEmptyGrid({ columns: 9, rows: 9 });
            setAlive(previous, 1, 1, true);
            const next = createEmptyGrid({ columns: 9, rows: 9 });
            setAlive(next, 1, 1, true);
            const ages = new Uint8Array(81);
            ages[1 * 9 + 1] = MAXIMUM_TRACKED_AGE;
            expect(advanceAges(previous, ages, next)[1 * 9 + 1]).toBe(MAXIMUM_TRACKED_AGE);
        });

        it("drops the age of a cell that died, leaving it for the next birth", () => {
            const previous = createEmptyGrid({ columns: 9, rows: 9 });
            setAlive(previous, 1, 1, true);
            const next = createEmptyGrid({ columns: 9, rows: 9 });
            const ages = new Uint8Array(81);
            ages[1 * 9 + 1] = 9;
            expect(advanceAges(previous, ages, next)[1 * 9 + 1]).toBe(0);
        });

        it("ages only the cells that actually survived an oscillator, resetting the reborn ones", () => {
            // A blinker's two end cells die and are reborn every generation, while the
            // centre survives. That is what makes the ends flash white while the centre
            // settles into a steady glow -- the phosphor reading the automaton.
            const previous = blinkerGrid();
            const ages = new Uint8Array(previous.cells.length).fill(3);
            const next = nextGeneration(previous);
            const advanced = advanceAges(previous, ages, next);
            const liveAges = Array.from(next.cells)
                .map((cell, index) => ({ cell, index }))
                .filter(({ cell }) => cell !== 0)
                .map(({ index }) => advanced[index]);
            // Centre cell (index 4*9+3) is older; the two ends are newborn.
            expect(liveAges.sort()).toEqual([0, 0, 4]);
        });
    });
});
