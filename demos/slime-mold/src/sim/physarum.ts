// Physarum polycephalum, the slime mold, in the abstract. Each agent is a tiny
// creature that sniffs the chemical it and its neighbours have left behind, turns
// toward the strongest smell, crawls forward and deposits a little more. No agent
// knows about the network; the network is what the agents do to each other over
// time. Kept apart from the demo so the behaviour can be tested without a canvas.

import type { RandomSource } from "@vector-demos/demo-kit";

export interface PhysarumSettings {
  // Half-angle between the three feelers, in radians.
  readonly sensorAngle: number;
  // How far ahead the feelers reach, in grid cells.
  readonly sensorDistance: number;
  // How far an agent turns when it chooses left or right, in radians.
  readonly turnAngle: number;
  // How far an agent crawls per step, in grid cells.
  readonly moveDistance: number;
  // How much trail an agent leaves per step.
  readonly depositAmount: number;
  // Trail kept from one step to the next, 0..1 (1 keeps everything forever).
  readonly decayFactor: number;
  // How much a cell blends with its neighbours each step, 0..1.
  readonly diffuseAmount: number;
  // Random steering wobble, so perfectly straight runs of uniform trail break up.
  readonly jitter: number;
  // Most agents one grid cell can hold; 0 means no limit. Without a limit every
  // strand is free to merge with its neighbour, and the whole dish drains into a
  // single line. With one, a vein can only carry so much, so the network stays wide.
  readonly cellCapacity: number;
  // Ceiling on the trail in any cell, so a busy junction cannot out-shout the rest.
  readonly trailLimit: number;
}

export const DEFAULT_PHYSARUM_SETTINGS: PhysarumSettings = {
  sensorAngle: 0.45,
  sensorDistance: 11,
  turnAngle: 0.55,
  moveDistance: 1.2,
  depositAmount: 0.09,
  decayFactor: 0.945,
  diffuseAmount: 0.4,
  jitter: 0.12,
  cellCapacity: 1,
  trailLimit: 1,
};

export interface PhysarumOptions {
  readonly columns: number;
  readonly rows: number;
  readonly agentCount: number;
  readonly random: RandomSource;
  readonly settings?: Partial<PhysarumSettings>;
}

export interface FoodSource {
  readonly x: number;
  readonly y: number;
}

// How far a food source can be smelled, in grid cells, and how strongly at its
// centre, as a multiple of the trail limit (so food out-smells the busiest vein).
export const FOOD_REACH = 30;
export const FOOD_STRENGTH = 1.6;
export const MINIMUM_FOOD_SPACING = 10;
export const MAXIMUM_FOOD_SOURCES = 48;

export function wrapCoordinate(value: number, size: number): number {
  const wrapped = ((value % size) + size) % size;
  // A hair below zero wraps to a hair below `size`, which rounds up to `size`
  // itself once stored as a 32-bit float; that is the same place as 0.
  return Math.fround(wrapped) >= size ? 0 : wrapped;
}

// The grid is a torus: an agent that crawls off the right edge comes back on the
// left, and so does the smell it leaves. This is what lets a network close on
// itself instead of piling up against a wall.
export class PhysarumWorld {
  public readonly columns: number;
  public readonly rows: number;
  public settings: PhysarumSettings;
  public trail: Float32Array;
  // A standing smell that never fades: food, 0..1. Agents sense it on top of the trail.
  public readonly food: Float32Array;
  public agentX: Float32Array;
  public agentY: Float32Array;
  public heading: Float32Array;
  public stepCount = 0;
  // Largest trail value seen during the last step, for normalising drawing.
  public maximumTrail = 1;

  private scratchTrail: Float32Array;
  private readonly occupancy: Uint16Array;
  private readonly foodList: FoodSource[] = [];
  private agentCountValue: number;
  private random: RandomSource;

  public constructor(options: PhysarumOptions) {
    this.columns = options.columns;
    this.rows = options.rows;
    this.random = options.random;
    this.settings = { ...DEFAULT_PHYSARUM_SETTINGS, ...options.settings };
    const cellCount = this.columns * this.rows;
    this.trail = new Float32Array(cellCount);
    this.scratchTrail = new Float32Array(cellCount);
    this.food = new Float32Array(cellCount);
    this.occupancy = new Uint16Array(cellCount);
    this.agentCountValue = options.agentCount;
    this.agentX = new Float32Array(options.agentCount);
    this.agentY = new Float32Array(options.agentCount);
    this.heading = new Float32Array(options.agentCount);
    this.scatter();
  }

  public get agentCount(): number {
    return this.agentCountValue;
  }

  public get foodSources(): readonly FoodSource[] {
    return this.foodList;
  }

  // Fresh positions and headings for every agent, and a blank petri dish. The same
  // seed reproduces the same start, so "the network emerged" is a checkable claim.
  // Passing a new random source restarts the dish from that source's seed.
  public scatter(random: RandomSource = this.random): void {
    this.random = random;
    for (let agent = 0; agent < this.agentCountValue; agent++) {
      this.agentX[agent] = this.random() * this.columns;
      this.agentY[agent] = this.random() * this.rows;
      this.heading[agent] = this.random() * Math.PI * 2;
    }
    this.clearTrail();
  }

  public clearTrail(): void {
    this.trail.fill(0);
    this.scratchTrail.fill(0);
    this.maximumTrail = 1;
    this.stepCount = 0;
  }

  public setAgentCount(count: number): void {
    if (count === this.agentCountValue) return;
    const previousCount = this.agentCountValue;
    const grownX = new Float32Array(count);
    const grownY = new Float32Array(count);
    const grownHeading = new Float32Array(count);
    const kept = Math.min(count, previousCount);
    grownX.set(this.agentX.subarray(0, kept));
    grownY.set(this.agentY.subarray(0, kept));
    grownHeading.set(this.heading.subarray(0, kept));
    for (let agent = kept; agent < count; agent++) {
      grownX[agent] = this.random() * this.columns;
      grownY[agent] = this.random() * this.rows;
      grownHeading[agent] = this.random() * Math.PI * 2;
    }
    this.agentX = grownX;
    this.agentY = grownY;
    this.heading = grownHeading;
    this.agentCountValue = count;
  }

  // One tick: the old trail diffuses and fades, then every agent senses it and
  // crawls. Agents smell only the old trail, but they do see each other: a cell that
  // is already full turns the next arrival away, and it tries a new direction.
  public step(): void {
    this.diffuseAndDecay();
    this.countOccupancy();
    const { sensorAngle, turnAngle, moveDistance, depositAmount, jitter, cellCapacity } = this.settings;
    const columns = this.columns;
    const rows = this.rows;
    const occupancy = this.occupancy;

    for (let agent = 0; agent < this.agentCountValue; agent++) {
      const x = this.agentX[agent];
      const y = this.agentY[agent];
      const angle = this.heading[agent];
      const ahead = this.sensorScent(x, y, angle);
      const left = this.sensorScent(x, y, angle + sensorAngle);
      const right = this.sensorScent(x, y, angle - sensorAngle);

      // If both feelers beat straight ahead, pick a side at random; ties (a blank
      // field, or an even ridge) also break at random so agents do not all run
      // parallel. Otherwise steer toward whichever feeler smells strongest.
      let turn = (this.random() - 0.5) * jitter;
      const best = Math.max(ahead, left, right);
      const leftBest = left === best;
      const rightBest = right === best;
      const aheadBest = ahead === best;
      if (aheadBest && !leftBest && !rightBest) {
        // The way ahead already smells best; keep going.
      } else if (leftBest && rightBest) {
        // Both feelers beat straight ahead (or all three tie): pick a side at random.
        turn += this.random() < 0.5 ? turnAngle : -turnAngle;
      } else if (leftBest) {
        turn += turnAngle;
      } else if (rightBest) {
        turn -= turnAngle;
      }
      const nextAngle = angle + turn;
      const nextX = wrapCoordinate(x + Math.cos(nextAngle) * moveDistance, columns);
      const nextY = wrapCoordinate(y + Math.sin(nextAngle) * moveDistance, rows);
      const fromCell = Math.floor(y) * columns + Math.floor(x);
      const toCell = Math.floor(nextY) * columns + Math.floor(nextX);
      if (cellCapacity > 0 && toCell !== fromCell && occupancy[toCell] >= cellCapacity) {
        // Blocked. Stay put, leave nothing, and face somewhere new for the next try.
        this.heading[agent] = this.random() * Math.PI * 2;
        continue;
      }
      occupancy[fromCell]--;
      occupancy[toCell]++;
      this.heading[agent] = nextAngle;
      this.agentX[agent] = nextX;
      this.agentY[agent] = nextY;
      this.deposit(nextX, nextY, depositAmount);
    }

    const previousTrail = this.trail;
    this.trail = this.scratchTrail;
    this.scratchTrail = previousTrail;
    this.stepCount++;
  }

  // Bilinear trail sample at a (possibly wrapped) grid position.
  public trailAt(x: number, y: number): number {
    return sampleField(this.trail, x, y, this.columns, this.rows);
  }

  // What an agent smells at a position: the trail plus any food there.
  public scentAt(x: number, y: number): number {
    const trail = sampleField(this.trail, x, y, this.columns, this.rows);
    const food = sampleField(this.food, x, y, this.columns, this.rows);
    return food === 0 ? trail : trail + food * FOOD_STRENGTH * this.settings.trailLimit;
  }

  // Adds trail in a soft disc (or, with a negative amount, wipes it away).
  public paint(x: number, y: number, radius: number, amount: number): void {
    const centerColumn = Math.floor(x);
    const centerRow = Math.floor(y);
    const integerRadius = Math.ceil(radius);
    for (let rowOffset = -integerRadius; rowOffset <= integerRadius; rowOffset++) {
      for (let columnOffset = -integerRadius; columnOffset <= integerRadius; columnOffset++) {
        const distanceSquared = rowOffset * rowOffset + columnOffset * columnOffset;
        if (distanceSquared > radius * radius) continue;
        const column = wrapCoordinate(centerColumn + columnOffset, this.columns);
        const row = wrapCoordinate(centerRow + rowOffset, this.rows);
        const falloff = 1 - Math.sqrt(distanceSquared) / radius;
        const next = this.trail[row * this.columns + column] + amount * falloff;
        this.trail[row * this.columns + column] = Math.max(0, next);
      }
    }
  }

  // Drops a food source: a smell that stays until it is removed, so the mold grows
  // toward it and keeps a vein there. Sources too close to an existing one, or past
  // the limit, are refused.
  public addFood(x: number, y: number): boolean {
    if (this.foodList.length >= MAXIMUM_FOOD_SOURCES) return false;
    const wrappedX = wrapCoordinate(x, this.columns);
    const wrappedY = wrapCoordinate(y, this.rows);
    for (const source of this.foodList) {
      if (this.torusDistance(source.x, source.y, wrappedX, wrappedY) < MINIMUM_FOOD_SPACING) return false;
    }
    this.foodList.push({ x: wrappedX, y: wrappedY });
    this.rebuildFood();
    return true;
  }

  // Removes every food source within `radius` cells; returns how many went.
  public removeFoodNear(x: number, y: number, radius: number): number {
    const before = this.foodList.length;
    for (let index = before - 1; index >= 0; index--) {
      const source = this.foodList[index];
      if (this.torusDistance(source.x, source.y, wrapCoordinate(x, this.columns), wrapCoordinate(y, this.rows)) <= radius) {
        this.foodList.splice(index, 1);
      }
    }
    if (this.foodList.length !== before) this.rebuildFood();
    return before - this.foodList.length;
  }

  public clearFood(): void {
    this.foodList.length = 0;
    this.food.fill(0);
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private sensorScent(x: number, y: number, angle: number): number {
    return this.scentAt(x + Math.cos(angle) * this.settings.sensorDistance, y + Math.sin(angle) * this.settings.sensorDistance);
  }

  private torusDistance(firstX: number, firstY: number, secondX: number, secondY: number): number {
    let deltaX = Math.abs(firstX - secondX);
    let deltaY = Math.abs(firstY - secondY);
    if (deltaX > this.columns / 2) deltaX = this.columns - deltaX;
    if (deltaY > this.rows / 2) deltaY = this.rows - deltaY;
    return Math.hypot(deltaX, deltaY);
  }

  // Counted afresh each step, so positions edited from outside are respected.
  private countOccupancy(): void {
    this.occupancy.fill(0);
    for (let agent = 0; agent < this.agentCountValue; agent++) {
      this.occupancy[Math.floor(this.agentY[agent]) * this.columns + Math.floor(this.agentX[agent])]++;
    }
  }

  // Each source is a smooth hill, steepest near the middle, so a vein passing
  // within reach is drawn in and then held.
  private rebuildFood(): void {
    this.food.fill(0);
    for (const source of this.foodList) {
      const centerColumn = Math.floor(source.x);
      const centerRow = Math.floor(source.y);
      for (let rowOffset = -FOOD_REACH; rowOffset <= FOOD_REACH; rowOffset++) {
        for (let columnOffset = -FOOD_REACH; columnOffset <= FOOD_REACH; columnOffset++) {
          const distance = Math.hypot(rowOffset, columnOffset);
          if (distance > FOOD_REACH) continue;
          const column = wrapCoordinate(centerColumn + columnOffset, this.columns);
          const row = wrapCoordinate(centerRow + rowOffset, this.rows);
          const cell = row * this.columns + column;
          const closeness = 1 - distance / FOOD_REACH;
          this.food[cell] = Math.max(this.food[cell], closeness * closeness);
        }
      }
    }
  }

  // A nine-point blur with wrap-around, faded by the decay factor. The blur is
  // what turns individual crawling lines into sheets that fuse and branch.
  private diffuseAndDecay(): void {
    const { columns, rows, trail, scratchTrail } = this;
    const { diffuseAmount, decayFactor, trailLimit } = this.settings;
    const keep = 1 - diffuseAmount;
    let maximum = 0;
    for (let row = 0; row < rows; row++) {
      const up = ((row - 1 + rows) % rows) * columns;
      const middle = row * columns;
      const down = ((row + 1) % rows) * columns;
      for (let column = 0; column < columns; column++) {
        const left = (column - 1 + columns) % columns;
        const right = (column + 1) % columns;
        const blurred =
          (trail[middle + column] * 4 +
            trail[middle + left] * 2 +
            trail[middle + right] * 2 +
            trail[up + column] * 2 +
            trail[down + column] * 2 +
            trail[up + left] +
            trail[up + right] +
            trail[down + left] +
            trail[down + right]) /
          16;
        const faded = Math.min(trailLimit, decayFactor * (trail[middle + column] * keep + blurred * diffuseAmount));
        scratchTrail[middle + column] = faded;
        if (faded > maximum) maximum = faded;
      }
    }
    this.maximumTrail = Math.max(1e-3, maximum);
  }

  // Bilinear deposit, so an agent between cells feeds all four of them.
  private deposit(x: number, y: number, amount: number): void {
    const column = Math.floor(x);
    const row = Math.floor(y);
    const fractionX = x - column;
    const fractionY = y - row;
    const right = column + 1 === this.columns ? 0 : column + 1;
    const bottom = row + 1 === this.rows ? 0 : row + 1;
    const { scratchTrail, columns } = this;
    scratchTrail[row * columns + column] += amount * (1 - fractionX) * (1 - fractionY);
    scratchTrail[row * columns + right] += amount * fractionX * (1 - fractionY);
    scratchTrail[bottom * columns + column] += amount * (1 - fractionX) * fractionY;
    scratchTrail[bottom * columns + right] += amount * fractionX * fractionY;
  }
}

function sampleField(field: Float32Array, x: number, y: number, columns: number, rows: number): number {
  const wrappedX = wrapCoordinate(x, columns);
  const wrappedY = wrapCoordinate(y, rows);
  const column = Math.floor(wrappedX);
  const row = Math.floor(wrappedY);
  const fractionX = wrappedX - column;
  const fractionY = wrappedY - row;
  const right = column + 1 === columns ? 0 : column + 1;
  const bottom = row + 1 === rows ? 0 : row + 1;
  const topLeft = field[row * columns + column];
  const topRight = field[row * columns + right];
  const bottomLeft = field[bottom * columns + column];
  const bottomRight = field[bottom * columns + right];
  const topMix = topLeft + (topRight - topLeft) * fractionX;
  const bottomMix = bottomLeft + (bottomRight - bottomLeft) * fractionX;
  return topMix + (bottomMix - topMix) * fractionY;
}
