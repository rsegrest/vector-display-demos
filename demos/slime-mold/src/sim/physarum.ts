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
};

export interface PhysarumOptions {
  readonly columns: number;
  readonly rows: number;
  readonly agentCount: number;
  readonly random: RandomSource;
  readonly settings?: Partial<PhysarumSettings>;
}

export function wrapCoordinate(value: number, size: number): number {
  return ((value % size) + size) % size;
}

// The grid is a torus: an agent that crawls off the right edge comes back on the
// left, and so does the smell it leaves. This is what lets a network close on
// itself instead of piling up against a wall.
export class PhysarumWorld {
  public readonly columns: number;
  public readonly rows: number;
  public settings: PhysarumSettings;
  public trail: Float32Array;
  public agentX: Float32Array;
  public agentY: Float32Array;
  public heading: Float32Array;
  public stepCount = 0;
  // Largest trail value seen during the last step, for normalising drawing.
  public maximumTrail = 1;

  private scratchTrail: Float32Array;
  private nextX: Float32Array;
  private nextY: Float32Array;
  private nextHeading: Float32Array;
  private agentCountValue: number;
  private readonly random: RandomSource;

  public constructor(options: PhysarumOptions) {
    this.columns = options.columns;
    this.rows = options.rows;
    this.random = options.random;
    this.settings = { ...DEFAULT_PHYSARUM_SETTINGS, ...options.settings };
    const cellCount = this.columns * this.rows;
    this.trail = new Float32Array(cellCount);
    this.scratchTrail = new Float32Array(cellCount);
    this.agentCountValue = options.agentCount;
    this.agentX = new Float32Array(options.agentCount);
    this.agentY = new Float32Array(options.agentCount);
    this.heading = new Float32Array(options.agentCount);
    this.nextX = new Float32Array(options.agentCount);
    this.nextY = new Float32Array(options.agentCount);
    this.nextHeading = new Float32Array(options.agentCount);
    this.scatter();
  }

  public get agentCount(): number {
    return this.agentCountValue;
  }

  // Fresh positions and headings for every agent, and a blank petri dish. The same
  // seed reproduces the same start, so "the network emerged" is a checkable claim.
  public scatter(): void {
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
    this.nextX = new Float32Array(count);
    this.nextY = new Float32Array(count);
    this.nextHeading = new Float32Array(count);
    this.agentCountValue = count;
  }

  // One tick: the old trail diffuses and fades, every agent senses it and crawls,
  // and the new positions are swapped in. Agents read only the old trail, so the
  // order they are visited in cannot matter.
  public step(): void {
    this.diffuseAndDecay();
    const { sensorAngle, turnAngle, moveDistance, depositAmount, jitter } = this.settings;
    const columns = this.columns;
    const rows = this.rows;

    for (let agent = 0; agent < this.agentCountValue; agent++) {
      const x = this.agentX[agent];
      const y = this.agentY[agent];
      const angle = this.heading[agent];
      const ahead = this.sensorTrail(x, y, angle);
      const left = this.sensorTrail(x, y, angle + sensorAngle);
      const right = this.sensorTrail(x, y, angle - sensorAngle);

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
      this.nextHeading[agent] = nextAngle;
      this.nextX[agent] = wrapCoordinate(x + Math.cos(nextAngle) * moveDistance, columns);
      this.nextY[agent] = wrapCoordinate(y + Math.sin(nextAngle) * moveDistance, rows);
      this.deposit(this.nextX[agent], this.nextY[agent], depositAmount);
    }

    const previousX = this.agentX;
    const previousY = this.agentY;
    const previousHeading = this.heading;
    this.agentX = this.nextX;
    this.agentY = this.nextY;
    this.heading = this.nextHeading;
    this.nextX = previousX;
    this.nextY = previousY;
    this.nextHeading = previousHeading;

    const previousTrail = this.trail;
    this.trail = this.scratchTrail;
    this.scratchTrail = previousTrail;
    this.stepCount++;
  }

  // Bilinear trail sample at a (possibly wrapped) grid position.
  public trailAt(x: number, y: number): number {
    const wrappedX = wrapCoordinate(x, this.columns);
    const wrappedY = wrapCoordinate(y, this.rows);
    const column = Math.floor(wrappedX);
    const row = Math.floor(wrappedY);
    const fractionX = wrappedX - column;
    const fractionY = wrappedY - row;
    const left = column;
    const right = wrapCoordinate(column + 1, this.columns);
    const top = row;
    const bottom = wrapCoordinate(row + 1, this.rows);
    const topLeft = this.trail[top * this.columns + left];
    const topRight = this.trail[top * this.columns + right];
    const bottomLeft = this.trail[bottom * this.columns + left];
    const bottomRight = this.trail[bottom * this.columns + right];
    const topMix = topLeft + (topRight - topLeft) * fractionX;
    const bottomMix = bottomLeft + (bottomRight - bottomLeft) * fractionX;
    return topMix + (bottomMix - topMix) * fractionY;
  }

  // Adds trail in a soft disc, used when the pointer drops food or erases.
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

  // --- Internals -----------------------------------------------------------------------------------------

  private sensorTrail(x: number, y: number, angle: number): number {
    return this.trailAt(x + Math.cos(angle) * this.settings.sensorDistance, y + Math.sin(angle) * this.settings.sensorDistance);
  }

  // A nine-point blur with wrap-around, faded by the decay factor. The blur is
  // what turns individual crawling lines into sheets that fuse and branch.
  private diffuseAndDecay(): void {
    const { columns, rows, trail, scratchTrail } = this;
    const { diffuseAmount, decayFactor } = this.settings;
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
        const faded = decayFactor * (trail[middle + column] * keep + blurred * diffuseAmount);
        scratchTrail[middle + column] = faded;
        if (faded > maximum) maximum = faded;
      }
    }
    this.maximumTrail = Math.max(1e-3, maximum);
  }

  // Bilinear deposit, so an agent between cells feeds all four of them.
  private deposit(x: number, y: number, amount: number): void {
    const wrappedX = wrapCoordinate(x, this.columns);
    const wrappedY = wrapCoordinate(y, this.rows);
    const column = Math.floor(wrappedX);
    const row = Math.floor(wrappedY);
    const fractionX = wrappedX - column;
    const fractionY = wrappedY - row;
    const left = column;
    const right = wrapCoordinate(column + 1, this.columns);
    const top = row;
    const bottom = wrapCoordinate(row + 1, this.rows);
    const { scratchTrail, columns } = this;
    scratchTrail[top * columns + left] += amount * (1 - fractionX) * (1 - fractionY);
    scratchTrail[top * columns + right] += amount * fractionX * (1 - fractionY);
    scratchTrail[bottom * columns + left] += amount * (1 - fractionX) * fractionY;
    scratchTrail[bottom * columns + right] += amount * fractionX * fractionY;
  }
}
