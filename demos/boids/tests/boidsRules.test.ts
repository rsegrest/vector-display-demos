import { describe, expect, it } from "vitest";
import {
    averageNeighborDistance,
    clampSpeed,
    createEmptyFlock,
    createFlock,
    createSeededRandom,
    gatherNeighborhood,
    polarizationOf,
    speedOf,
    stepFlock,
    steeringForBoid,
    wrap,
    wrappedDelta,
    type BoidFlock,
    type FlockingSettings,
} from "../src/boidsRules.js";

const FIELD_WIDTH = 600;
const FIELD_HEIGHT = 400;

const BALANCED_SETTINGS: FlockingSettings = {
    perceptionRadius: 70,
    separationRadius: 18,
    separationWeight: 90,
    alignmentWeight: 60,
    cohesionWeight: 45,
    minimumSpeed: 40,
    maximumSpeed: 110,
};

function runFlock(flock: BoidFlock, steps: number, settings: FlockingSettings, deltaSeconds = 1 / 60): BoidFlock {
    let current = flock;
    for (let step = 0; step < steps; step++) current = stepFlock(current, settings, deltaSeconds);
    return current;
}

/** Two boids at given positions and velocities, for the hand-computed cases. */
function pair(
    first: { x: number; y: number; vx: number; vy: number },
    second: { x: number; y: number; vx: number; vy: number },
): BoidFlock {
    const flock = createEmptyFlock(2, FIELD_WIDTH, FIELD_HEIGHT);
    flock.x[0] = first.x;
    flock.y[0] = first.y;
    flock.vx[0] = first.vx;
    flock.vy[0] = first.vy;
    flock.x[1] = second.x;
    flock.y[1] = second.y;
    flock.vx[1] = second.vx;
    flock.vy[1] = second.vy;
    return flock;
}

describe("boidsRules", () => {
    describe("the seeded generator", () => {
        it("reproduces the same sequence for the same seed", () => {
            const first = createSeededRandom(1234);
            const second = createSeededRandom(1234);
            expect([first(), first(), first()]).toEqual([second(), second(), second()]);
        });

        it("produces a different sequence for a different seed", () => {
            const first = createSeededRandom(1);
            const second = createSeededRandom(2);
            expect(first()).not.toBe(second());
        });

        it("stays within the unit interval", () => {
            const random = createSeededRandom(99);
            for (let index = 0; index < 500; index++) {
                const value = random();
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThan(1);
            }
        });

        it("builds an identical flock from the same seed", () => {
            const first = createFlock(20, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(7));
            const second = createFlock(20, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(7));
            expect(Array.from(first.x)).toEqual(Array.from(second.x));
            expect(Array.from(first.vy)).toEqual(Array.from(second.vy));
        });
    });

    describe("wrapping", () => {
        it("measures the short way round, so boids either side of an edge are close", () => {
            // 598 and 2 are 4 apart across the seam, not 596 apart.
            expect(wrappedDelta(598, 2, FIELD_WIDTH)).toBeCloseTo(4, 6);
            expect(wrappedDelta(2, 598, FIELD_WIDTH)).toBeCloseTo(-4, 6);
        });

        it("measures the direct way when no wrap is involved", () => {
            expect(wrappedDelta(100, 150, FIELD_WIDTH)).toBe(50);
        });

        it("keeps a stepped position inside the field", () => {
            expect(wrap(-5, FIELD_WIDTH)).toBeCloseTo(595, 6);
            expect(wrap(FIELD_WIDTH + 5, FIELD_WIDTH)).toBeCloseTo(5, 6);
            expect(wrap(12, FIELD_WIDTH)).toBe(12);
        });

        it("returns a boid that steps off an edge on the opposite side", () => {
            const settings = { ...BALANCED_SETTINGS, separationWeight: 0, alignmentWeight: 0, cohesionWeight: 0 };
            const single = createEmptyFlock(1, FIELD_WIDTH, FIELD_HEIGHT);
            single.x[0] = FIELD_WIDTH - 1;
            single.y[0] = 200;
            single.vx[0] = 120;
            single.vy[0] = 0;
            const stepped = stepFlock(single, settings, 1 / 60);
            expect(stepped.x[0]).toBeGreaterThanOrEqual(0);
            expect(stepped.x[0]).toBeLessThan(FIELD_WIDTH);
        });
    });

    describe("speed clamping", () => {
        it("raises a speed below the minimum into the band", () => {
            const clamped = clampSpeed(5, 0, 40, 110);
            expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(40, 6);
        });

        it("lowers a speed above the maximum into the band", () => {
            const clamped = clampSpeed(500, 0, 40, 110);
            expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(110, 6);
        });

        it("leaves a speed already inside the band untouched", () => {
            const clamped = clampSpeed(60, 0, 40, 110);
            expect(clamped.x).toBeCloseTo(60, 6);
        });

        it("gives a stopped boid a direction instead of leaving it stuck at zero", () => {
            // Scaling a zero vector keeps it zero, so a stalled boid would never move again.
            const clamped = clampSpeed(0, 0, 40, 110);
            expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(40, 6);
        });
    });

    describe("steering", () => {
        it("steers a boid toward a neighbour's heading", () => {
            // Two boids in sight of each other, pointing opposite ways, aligning only.
            const flock = pair(
                { x: 200, y: 200, vx: 100, vy: 0 },
                { x: 240, y: 200, vx: -100, vy: 0 },
            );
            const settings = { ...BALANCED_SETTINGS, alignmentWeight: 60, cohesionWeight: 0, separationWeight: 0 };
            const steering = steeringForBoid(flock, 0, settings);
            // Boid 0 heads right; the average heading of both is left, so the pull is left.
            expect(steering.x).toBeLessThan(0);
        });

        it("pulls a boid toward the centre of the crowd when cohesion is what is switched on", () => {
            const flock = pair(
                { x: 200, y: 200, vx: 100, vy: 0 },
                { x: 250, y: 200, vx: 100, vy: 0 },
            );
            const settings = { ...BALANCED_SETTINGS, alignmentWeight: 0, cohesionWeight: 45, separationWeight: 0 };
            const steering = steeringForBoid(flock, 0, settings);
            expect(steering.x).toBeGreaterThan(0);
        });

        it("pushes a crowded boid away when separation is what is switched on", () => {
            const flock = pair(
                { x: 200, y: 200, vx: 100, vy: 0 },
                { x: 205, y: 200, vx: 100, vy: 0 },
            );
            const settings = { ...BALANCED_SETTINGS, alignmentWeight: 0, cohesionWeight: 0, separationWeight: 90 };
            const steering = steeringForBoid(flock, 0, settings);
            expect(steering.x).toBeLessThan(0);
        });

        it("produces no steering toward a neighbour beyond the perception radius", () => {
            const flock = pair(
                { x: 100, y: 200, vx: 100, vy: 0 },
                { x: 100 + BALANCED_SETTINGS.perceptionRadius + 10, y: 200, vx: 100, vy: 0 },
            );
            const steering = steeringForBoid(flock, 0, BALANCED_SETTINGS);
            expect(steering.x).toBeCloseTo(0, 10);
            expect(steering.y).toBeCloseTo(0, 10);
        });

        it("sees a neighbour across the seam, because distances wrap", () => {
            const flock = pair(
                { x: 4, y: 200, vx: 100, vy: 0 },
                { x: FIELD_WIDTH - 4, y: 200, vx: 100, vy: 0 },
            );
            const neighborhood = gatherNeighborhood(flock, 0, BALANCED_SETTINGS);
            expect(neighborhood.neighborCount).toBe(1);
        });

        it("counts a boid as its own neighbour never, and its own distance never", () => {
            const single = createEmptyFlock(1, FIELD_WIDTH, FIELD_HEIGHT);
            single.x[0] = 200;
            single.y[0] = 200;
            single.vx[0] = 60;
            const neighborhood = gatherNeighborhood(single, 0, BALANCED_SETTINGS);
            expect(neighborhood.neighborCount).toBe(0);
            expect(neighborhood.crowdCount).toBe(0);
        });
    });

    describe("stepping", () => {
        it("does not modify the flock it was given", () => {
            const flock = createFlock(30, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(5));
            const before = Array.from(flock.x);
            stepFlock(flock, BALANCED_SETTINGS, 1 / 60);
            expect(Array.from(flock.x)).toEqual(before);
        });

        it("keeps every boid inside the field over a long run", () => {
            const stepped = runFlock(createFlock(60, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(11)), 600, BALANCED_SETTINGS);
            for (let index = 0; index < stepped.count; index++) {
                expect(stepped.x[index]).toBeGreaterThanOrEqual(0);
                expect(stepped.x[index]).toBeLessThan(FIELD_WIDTH);
                expect(stepped.y[index]).toBeGreaterThanOrEqual(0);
                expect(stepped.y[index]).toBeLessThan(FIELD_HEIGHT);
            }
        });

        it("keeps every speed inside the configured band", () => {
            const stepped = runFlock(createFlock(60, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(12)), 400, BALANCED_SETTINGS);
            for (let index = 0; index < stepped.count; index++) {
                const speed = speedOf(stepped, index);
                expect(speed).toBeGreaterThanOrEqual(BALANCED_SETTINGS.minimumSpeed - 1e-3);
                expect(speed).toBeLessThanOrEqual(BALANCED_SETTINGS.maximumSpeed + 1e-3);
            }
        });

        it("never produces a NaN, even from a boid with no velocity at all", () => {
            const stalled = createEmptyFlock(2, FIELD_WIDTH, FIELD_HEIGHT);
            stalled.x[0] = 300;
            stalled.y[0] = 200;
            stalled.x[1] = 305;
            stalled.y[1] = 200;
            const stepped = runFlock(stalled, 120, BALANCED_SETTINGS);
            for (let index = 0; index < stepped.count; index++) {
                expect(Number.isFinite(stepped.x[index])).toBe(true);
                expect(Number.isFinite(stepped.y[index])).toBe(true);
                expect(Number.isFinite(stepped.vx[index])).toBe(true);
                expect(Number.isFinite(stepped.vy[index])).toBe(true);
            }
        });
    });

    describe("flocking actually emerges", () => {
        // These are the tests that matter. Everything above proves each force computes
        // what it claims; only these can tell a flock from a swarm of independent boids.
        const ALIGNING_SETTINGS: FlockingSettings = { ...BALANCED_SETTINGS };

        it("raises the flock's alignment far above where it started", () => {
            const seeded = createFlock(120, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(2026));
            const initial = polarizationOf(seeded);
            const settled = polarizationOf(runFlock(seeded, 500, ALIGNING_SETTINGS));
            expect(settled).toBeGreaterThan(initial);
            expect(settled).toBeGreaterThan(0.5);
        });

        it("beats the same run with alignment and cohesion switched off", () => {
            // The control: only separation acts, so there is nothing to make the boids
            // agree and polarization should stay low. If it did not, the test above
            // would be measuring the initial distribution rather than the flocking.
            const noFlocking: FlockingSettings = {
                ...BALANCED_SETTINGS,
                alignmentWeight: 0,
                cohesionWeight: 0,
            };
            const seeded = createFlock(120, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(2026));
            const flocked = polarizationOf(runFlock(seeded, 500, ALIGNING_SETTINGS));
            const unflocked = polarizationOf(runFlock(seeded, 500, noFlocking));
            expect(flocked).toBeGreaterThan(unflocked + 0.2);
        });

        it("holds a spacing instead of collapsing into a single point", () => {
            // Cohesion with no separation would pile every boid onto one spot; that is
            // the classic way a flocking demo looks broken.
            const spacing = averageNeighborDistance(
                runFlock(createFlock(90, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(31)), 600, BALANCED_SETTINGS),
                BALANCED_SETTINGS,
            );
            expect(spacing).toBeGreaterThan(1);
        });

        it("collapses when separation is removed, which is what makes the spacing test meaningful", () => {
            const noSeparation: FlockingSettings = { ...BALANCED_SETTINGS, separationWeight: 0 };
            const spacing = averageNeighborDistance(
                runFlock(createFlock(90, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(31)), 600, noSeparation),
                BALANCED_SETTINGS,
            );
            const withSeparation = averageNeighborDistance(
                runFlock(createFlock(90, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(31)), 600, BALANCED_SETTINGS),
                BALANCED_SETTINGS,
            );
            expect(spacing).toBeLessThan(withSeparation);
        });

        it("keeps the flock a flock for a long run rather than drifting apart again", () => {
            const seeded = createFlock(120, FIELD_WIDTH, FIELD_HEIGHT, createSeededRandom(2026));
            const settled = runFlock(seeded, 500, ALIGNING_SETTINGS);
            const later = runFlock(settled, 900, ALIGNING_SETTINGS);
            expect(polarizationOf(later)).toBeGreaterThan(0.5);
        });
    });
});
