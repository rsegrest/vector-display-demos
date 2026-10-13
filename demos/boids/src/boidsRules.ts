// Flocking, the Reynolds way, with no DOM dependency: this module moves the agents,
// an adapter decides how they reach a beam. Three forces compose into the motion --
// separation (do not crowd), alignment (match your neighbours' heading) and cohesion
// (drift toward the crowd). None of them steers the flock; the flock is what happens
// when every boid applies all three at once.
//
// The field is a TORUS, the same rule the Life demo uses: positions wrap, and every
// distance is measured the short way round. Without that, a boid near one edge would
// be blind to a flock leaving the other edge and the display would break into strips.

export interface BoidFlock {
    readonly count: number;
    readonly width: number;
    readonly height: number;
    readonly x: Float32Array;
    readonly y: Float32Array;
    readonly vx: Float32Array;
    readonly vy: Float32Array;
}

export interface FlockingSettings {
    readonly perceptionRadius: number;
    readonly separationRadius: number;
    readonly separationWeight: number;
    readonly alignmentWeight: number;
    readonly cohesionWeight: number;
    readonly minimumSpeed: number;
    readonly maximumSpeed: number;
}

/**
 * mulberry32. A seeded generator so a flock is reproducible: the same seed must give
 * the same motion, or "the flock emerged" is not a claim anybody can check.
 */
export function createSeededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The short way round the field. A plain subtraction would report that two boids
 * sitting either side of an edge are a whole world apart.
 */
export function wrappedDelta(from: number, to: number, size: number): number {
    let delta = to - from;
    const half = size / 2;
    if (delta > half) delta -= size;
    if (delta < -half) delta += size;
    return delta;
}

export function createEmptyFlock(count: number, width: number, height: number): BoidFlock {
    return {
        count,
        width,
        height,
        x: new Float32Array(count),
        y: new Float32Array(count),
        vx: new Float32Array(count),
        vy: new Float32Array(count),
    };
}

/** A flock scattered across the field, each boid already moving somewhere. */
export function createFlock(
    count: number,
    width: number,
    height: number,
    random: () => number,
    speed = 60,
): BoidFlock {
    const flock = createEmptyFlock(count, width, height);
    for (let index = 0; index < count; index++) {
        flock.x[index] = random() * width;
        flock.y[index] = random() * height;
        const heading = random() * Math.PI * 2;
        flock.vx[index] = Math.cos(heading) * speed;
        flock.vy[index] = Math.sin(heading) * speed;
    }
    return flock;
}

export function speedOf(flock: BoidFlock, index: number): number {
    return Math.sqrt(flock.vx[index] * flock.vx[index] + flock.vy[index] * flock.vy[index]);
}

/** Unit vector, with a fallback for a zero-length input so a stopped boid is not a NaN. */
function normalized(x: number, y: number, fallbackX: number, fallbackY: number): { x: number; y: number } {
    const length = Math.sqrt(x * x + y * y);
    if (length < 1e-6) return { x: fallbackX, y: fallbackY };
    return { x: x / length, y: y / length };
}

interface FlockNeighborhood {
    readonly neighborCount: number;
    readonly crowdCount: number;
    readonly alignmentX: number;
    readonly alignmentY: number;
    readonly centerX: number;
    readonly centerY: number;
    readonly separationX: number;
    readonly separationY: number;
}

/**
 * Everything boid `index` can see, in one pass. Steering vectors are averaged here,
 * and the averages are converted to DIRECTIONS by the caller, so a distant crowd and
 * a close one pull equally hard.
 */
export function gatherNeighborhood(flock: BoidFlock, index: number, settings: FlockingSettings): FlockNeighborhood {
    const perceptionSquared = settings.perceptionRadius * settings.perceptionRadius;
    const separationSquared = settings.separationRadius * settings.separationRadius;
    let neighborCount = 0;
    let crowdCount = 0;
    let alignmentX = 0;
    let alignmentY = 0;
    let centerX = 0;
    let centerY = 0;
    let separationX = 0;
    let separationY = 0;

    for (let other = 0; other < flock.count; other++) {
        if (other === index) continue;
        const deltaX = wrappedDelta(flock.x[index], flock.x[other], flock.width);
        const deltaY = wrappedDelta(flock.y[index], flock.y[other], flock.height);
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;
        if (distanceSquared > perceptionSquared) continue;
        neighborCount++;
        alignmentX += flock.vx[other];
        alignmentY += flock.vy[other];
        centerX += deltaX;
        centerY += deltaY;
        if (distanceSquared < separationSquared && distanceSquared > 1e-6) {
            // Closer neighbours push harder, hence the division by distance squared.
            separationX -= deltaX / distanceSquared;
            separationY -= deltaY / distanceSquared;
            crowdCount++;
        }
    }

    return { neighborCount, crowdCount, alignmentX, alignmentY, centerX, centerY, separationX, separationY };
}

/** The steering acceleration for one boid: three normalized pulls, weighted and summed. */
export function steeringForBoid(flock: BoidFlock, index: number, settings: FlockingSettings): { x: number; y: number } {
    const neighborhood = gatherNeighborhood(flock, index, settings);
    const heading = normalized(flock.vx[index], flock.vy[index], 1, 0);
    let steerX = 0;
    let steerY = 0;

    if (neighborhood.neighborCount > 0) {
        const alignment = normalized(neighborhood.alignmentX, neighborhood.alignmentY, heading.x, heading.y);
        steerX += alignment.x * settings.alignmentWeight;
        steerY += alignment.y * settings.alignmentWeight;
        const cohesion = normalized(neighborhood.centerX, neighborhood.centerY, heading.x, heading.y);
        steerX += cohesion.x * settings.cohesionWeight;
        steerY += cohesion.y * settings.cohesionWeight;
    }

    if (neighborhood.crowdCount > 0) {
        const separation = normalized(
            neighborhood.separationX,
            neighborhood.separationY,
            -heading.x,
            -heading.y,
        );
        steerX += separation.x * settings.separationWeight;
        steerY += separation.y * settings.separationWeight;
    }

    return { x: steerX, y: steerY };
}

/** Clamp a boid's speed into the configured band, so none stalls and none bolts. */
export function clampSpeed(
    velocityX: number,
    velocityY: number,
    minimumSpeed: number,
    maximumSpeed: number,
): { x: number; y: number } {
    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    if (speed < 1e-6) {
        // A stopped boid has no direction to scale, so it would stay stopped forever.
        return { x: minimumSpeed, y: 0 };
    }
    const clamped = Math.min(Math.max(speed, minimumSpeed), maximumSpeed);
    const scale = clamped / speed;
    return { x: velocityX * scale, y: velocityY * scale };
}

/** Advances the flock one step. Pure: the input flock is not modified. */
export function stepFlock(flock: BoidFlock, settings: FlockingSettings, deltaSeconds: number): BoidFlock {
    const next = createEmptyFlock(flock.count, flock.width, flock.height);
    for (let index = 0; index < flock.count; index++) {
        const steering = steeringForBoid(flock, index, settings);
        const clamped = clampSpeed(
            flock.vx[index] + steering.x * deltaSeconds,
            flock.vy[index] + steering.y * deltaSeconds,
            settings.minimumSpeed,
            settings.maximumSpeed,
        );
        next.vx[index] = clamped.x;
        next.vy[index] = clamped.y;
        next.x[index] = wrap(flock.x[index] + clamped.x * deltaSeconds, flock.width);
        next.y[index] = wrap(flock.y[index] + clamped.y * deltaSeconds, flock.height);
    }
    return next;
}

export function wrap(value: number, size: number): number {
    return ((value % size) + size) % size;
}

/**
 * How aligned the flock is, 0 (every boid pointing its own way) to 1 (one direction).
 * This is the number that says a flock formed rather than merely many boids moving.
 */
export function polarizationOf(flock: BoidFlock): number {
    let sumX = 0;
    let sumY = 0;
    for (let index = 0; index < flock.count; index++) {
        const speed = speedOf(flock, index);
        if (speed < 1e-6) continue;
        sumX += flock.vx[index] / speed;
        sumY += flock.vy[index] / speed;
    }
    return Math.sqrt(sumX * sumX + sumY * sumY) / flock.count;
}

/** Mean distance from each boid to the centre of its own neighbourhood, a crowding measure. */
export function averageNeighborDistance(flock: BoidFlock, settings: FlockingSettings): number {
    let total = 0;
    let samples = 0;
    for (let index = 0; index < flock.count; index++) {
        const neighborhood = gatherNeighborhood(flock, index, settings);
        if (neighborhood.neighborCount === 0) continue;
        total += Math.sqrt(
            (neighborhood.centerX / neighborhood.neighborCount) ** 2 +
                (neighborhood.centerY / neighborhood.neighborCount) ** 2,
        );
        samples++;
    }
    return samples === 0 ? 0 : total / samples;
}
