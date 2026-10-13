// Turns a flock into beam segments. Kept apart from boidsRules.ts so the motion stays
// about boids and this stays about light.
//
// A boid is a small arrowhead pointed along its heading, not a dot. On a vector display
// the direction is the whole point -- a flock is readable only because you can see which
// way the shapes face -- and a triangle gives the beam three strokes with a natural
// dwell at each vertex.

import type { BeamColor, Polyline } from "@vector-display/core";
import { speedOf, wrap, type BoidFlock } from "./boidsRules.js";

/** How bright a boid is drawn, relative to the slowest and fastest in the band. */
export interface BoidBeamSettings {
    readonly speedForFullBrightness: number;
    readonly minimumIntensity: number;
    readonly length: number;
    readonly width: number;
    /** Length of the tail drawn behind each boid, in world units; 0 draws none. */
    readonly trailLength: number;
}

export const DEFAULT_BOID_BEAM_SETTINGS: BoidBeamSettings = {
    speedForFullBrightness: 110,
    minimumIntensity: 0.35,
    length: 9,
    width: 5,
    trailLength: 0,
};

export const BOID_BEAM_COLOR: BeamColor = { red: 0.55, green: 1, blue: 0.8 };

/**
 * The arrowhead, in a local frame pointing along +x, so the caller rotates it by the
 * boid's heading. Closed, so the beam traces all three sides.
 */
export function boidOutline(length: number, width: number): Polyline {
    const halfWidth = width / 2;
    return {
        points: [
            { x: length * 0.5, y: 0 },
            { x: -length * 0.5, y: -halfWidth },
            { x: -length * 0.5, y: halfWidth },
        ],
        isClosed: true,
    };
}

export interface PlacedBoid {
    readonly x: number;
    readonly y: number;
    readonly rotation: number;
    readonly intensity: number;
}

/** One placement per boid: where it is, which way it faces, and how bright. */
export function placedBoids(flock: BoidFlock, settings: BoidBeamSettings): PlacedBoid[] {
    const placements: PlacedBoid[] = [];
    for (let index = 0; index < flock.count; index++) {
        const speed = speedOf(flock, index);
        placements.push({
            x: flock.x[index],
            y: flock.y[index],
            // World coordinates are y-down, so a heading of (1,0) faces right and a
            // positive rotation turns clockwise on screen; atan2 of the velocity in
            // this frame is already that angle.
            rotation: Math.atan2(flock.vy[index], flock.vx[index]),
            intensity: intensityForSpeed(speed, settings),
        });
    }
    return placements;
}

/** Slow boids are dim and fast ones are bright, so acceleration is visible as a flash. */
export function intensityForSpeed(speed: number, settings: BoidBeamSettings): number {
    const clamped = Math.min(Math.max(speed, 0), settings.speedForFullBrightness);
    const amount = clamped / settings.speedForFullBrightness;
    return settings.minimumIntensity + (1 - settings.minimumIntensity) * amount;
}

/**
 * A short tail behind each boid, in world units, drawn as one open segment. The phosphor
 * already leaves a trail; this adds direction of travel at a glance.
 */
export function trailPolylines(flock: BoidFlock, settings: BoidBeamSettings): Polyline[] {
    if (settings.trailLength <= 0) return [];
    const polylines: Polyline[] = [];
    for (let index = 0; index < flock.count; index++) {
        const speed = speedOf(flock, index);
        if (speed < 1e-6) continue;
        const unitX = flock.vx[index] / speed;
        const unitY = flock.vy[index] / speed;
        const tailX = flock.x[index] - unitX * settings.trailLength;
        const tailY = flock.y[index] - unitY * settings.trailLength;
        polylines.push({
            points: [
                // The tail wraps just like the boid does, so a trail does not stretch
                // across the whole field when its boid crosses an edge.
                { x: wrap(tailX, flock.width), y: wrap(tailY, flock.height) },
                { x: flock.x[index], y: flock.y[index] },
            ],
            isClosed: false,
        });
    }
    return polylines;
}

/** Mean intensity across the flock, so a test can assert brightness tracks speed. */
export function averageIntensity(flock: BoidFlock, settings: BoidBeamSettings): number {
    if (flock.count === 0) return 0;
    let total = 0;
    for (let index = 0; index < flock.count; index++) {
        total += intensityForSpeed(speedOf(flock, index), settings);
    }
    return total / flock.count;
}
