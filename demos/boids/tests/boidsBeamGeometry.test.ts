import { describe, expect, it } from "vitest";
import {
    BOID_BEAM_COLOR,
    DEFAULT_BOID_BEAM_SETTINGS,
    averageIntensity,
    boidOutline,
    intensityForSpeed,
    placedBoids,
    trailPolylines,
} from "../src/boidsBeamGeometry.js";
import { createEmptyFlock, createSeededRandom, createFlock } from "../src/boidsRules.js";

function flockOfOne(vx: number, vy: number, x = 300, y = 200) {
    const flock = createEmptyFlock(1, 600, 400);
    flock.x[0] = x;
    flock.y[0] = y;
    flock.vx[0] = vx;
    flock.vy[0] = vy;
    return flock;
}

describe("boidsBeamGeometry", () => {
    describe("the arrowhead", () => {
        it("is a closed triangle so the beam traces all three sides", () => {
            const outline = boidOutline(10, 6);
            expect(outline.isClosed).toBe(true);
            expect(outline.points).toHaveLength(3);
        });

        it("points along +x, so the caller only has to rotate it", () => {
            const outline = boidOutline(10, 6);
            const tip = outline.points[0];
            const tail = outline.points.slice(1);
            expect(tip.x).toBeGreaterThan(Math.max(...tail.map((point) => point.x)));
        });

        it("is symmetric about its own axis", () => {
            const outline = boidOutline(10, 6);
            const [, left, right] = outline.points;
            expect(left.x).toBeCloseTo(right.x, 10);
            expect(left.y).toBeCloseTo(-right.y, 10);
        });

        it("scales with the requested length and width", () => {
            const small = boidOutline(8, 4);
            const large = boidOutline(16, 8);
            expect(large.points[0].x - large.points[1].x).toBeCloseTo(2 * (small.points[0].x - small.points[1].x), 10);
        });
    });

    describe("heading", () => {
        it("faces right when moving right", () => {
            expect(placedBoids(flockOfOne(100, 0), DEFAULT_BOID_BEAM_SETTINGS)[0].rotation).toBeCloseTo(0, 10);
        });

        it("faces down the screen when moving down, since world y points down", () => {
            // A positive rotation turns clockwise on screen in a y-down frame.
            expect(placedBoids(flockOfOne(0, 100), DEFAULT_BOID_BEAM_SETTINGS)[0].rotation).toBeCloseTo(Math.PI / 2, 10);
        });

        it("carries each boid's own position through", () => {
            const placed = placedBoids(flockOfOne(0, 100, 123, 45), DEFAULT_BOID_BEAM_SETTINGS);
            expect(placed[0].x).toBe(123);
            expect(placed[0].y).toBe(45);
        });

        it("places exactly one boid per boid, no more", () => {
            const flock = createFlock(40, 600, 400, createSeededRandom(3));
            expect(placedBoids(flock, DEFAULT_BOID_BEAM_SETTINGS)).toHaveLength(40);
        });
    });

    describe("brightness", () => {
        it("draws a boid at the top of the band at full brightness", () => {
            expect(intensityForSpeed(DEFAULT_BOID_BEAM_SETTINGS.speedForFullBrightness, DEFAULT_BOID_BEAM_SETTINGS)).toBe(1);
        });

        it("dims a boid with no speed to the floor", () => {
            expect(intensityForSpeed(0, DEFAULT_BOID_BEAM_SETTINGS)).toBeCloseTo(
                DEFAULT_BOID_BEAM_SETTINGS.minimumIntensity,
                10,
            );
        });

        it("clamps a speed beyond full brightness instead of over-brightening", () => {
            expect(intensityForSpeed(10_000, DEFAULT_BOID_BEAM_SETTINGS)).toBe(1);
        });

        it("brightens monotonically with speed", () => {
            const dim = intensityForSpeed(30, DEFAULT_BOID_BEAM_SETTINGS);
            const mid = intensityForSpeed(60, DEFAULT_BOID_BEAM_SETTINGS);
            const bright = intensityForSpeed(90, DEFAULT_BOID_BEAM_SETTINGS);
            expect(mid).toBeGreaterThan(dim);
            expect(bright).toBeGreaterThan(mid);
        });

        it("is more than decoration: a fast flock is measurably brighter than a slow one", () => {
            const slow = createEmptyFlock(1, 600, 400);
            slow.vx[0] = 40;
            const fast = createEmptyFlock(1, 600, 400);
            fast.vx[0] = 110;
            expect(averageIntensity(fast, DEFAULT_BOID_BEAM_SETTINGS)).toBeGreaterThan(
                averageIntensity(slow, DEFAULT_BOID_BEAM_SETTINGS),
            );
        });

        it("reports zero for an empty flock rather than dividing by zero", () => {
            expect(averageIntensity(createEmptyFlock(0, 600, 400), DEFAULT_BOID_BEAM_SETTINGS)).toBe(0);
        });
    });

    describe("trails", () => {
        it("draws nothing when trails are switched off", () => {
            const flock = createFlock(10, 600, 400, createSeededRandom(4));
            expect(trailPolylines(flock, { ...DEFAULT_BOID_BEAM_SETTINGS, trailLength: 0 })).toHaveLength(0);
        });

        it("draws one open segment per moving boid", () => {
            const flock = createFlock(10, 600, 400, createSeededRandom(4));
            const trails = trailPolylines(flock, { ...DEFAULT_BOID_BEAM_SETTINGS, trailLength: 12 });
            expect(trails).toHaveLength(10);
            expect(trails.every((trail) => !trail.isClosed)).toBe(true);
            expect(trails.every((trail) => trail.points.length === 2)).toBe(true);
        });

        it("puts the tail behind the boid, not in front of it", () => {
            const flock = flockOfOne(100, 0, 300, 200);
            const [trail] = trailPolylines(flock, { ...DEFAULT_BOID_BEAM_SETTINGS, trailLength: 12 });
            expect(trail.points[0].x).toBeCloseTo(288, 6);
            expect(trail.points[1].x).toBeCloseTo(300, 6);
        });

        it("wraps a tail that crosses the edge, rather than stretching it across the field", () => {
            // Heading right from x=2 puts the tail at x=-10, which is x=590 on a torus.
            const flock = flockOfOne(100, 0, 2, 200);
            const [trail] = trailPolylines(flock, { ...DEFAULT_BOID_BEAM_SETTINGS, trailLength: 12 });
            for (const point of trail.points) {
                expect(point.x).toBeGreaterThanOrEqual(0);
                expect(point.x).toBeLessThan(600);
            }
            expect(trail.points[0].x).toBeCloseTo(590, 6);
            expect(trail.points[1].x).toBeCloseTo(2, 6);
        });

        it("skips a stationary boid, which has no direction to trail behind", () => {
            const stopped = createFlock(1, 600, 400, createSeededRandom(4));
            stopped.vx[0] = 0;
            stopped.vy[0] = 0;
            expect(trailPolylines(stopped, { ...DEFAULT_BOID_BEAM_SETTINGS, trailLength: 12 })).toHaveLength(0);
        });
    });

    it("exposes a colour the renderer can use directly", () => {
        expect(BOID_BEAM_COLOR.green).toBeGreaterThan(BOID_BEAM_COLOR.red);
        expect(BOID_BEAM_COLOR.green).toBeGreaterThan(BOID_BEAM_COLOR.blue);
    });
});
