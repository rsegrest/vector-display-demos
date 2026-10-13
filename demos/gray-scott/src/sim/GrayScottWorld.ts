// The Gray-Scott model: two chemicals on a grid. U is fed in everywhere at a steady
// rate. V feeds on U: wherever one U meets two V, the U becomes a third V. And V is
// steadily removed. Both spread out, U twice as fast as V. That is the whole model,
// and depending on just two numbers, the feed rate and the kill rate, it grows spots
// that divide like cells, mazes, coral, restless turbulence, or nothing at all.
//
// Constants follow Karl Sims' well-known formulation: diffusion rates 1 and 0.5, a
// time step of 1, and a 3x3 Laplacian weighted 0.2 for edge neighbours and 0.05 for
// corners. The grid is a torus.

import type { RandomSource } from "@vector-demos/demo-kit";

export const DIFFUSION_U = 1;
export const DIFFUSION_V = 0.5;
const EDGE_WEIGHT = 0.2;
const CORNER_WEIGHT = 0.05;

export interface ReactionRates {
  readonly feed: number;
  readonly kill: number;
}

export class GrayScottWorld {
  public readonly columns: number;
  public readonly rows: number;
  public u: Float32Array;
  public v: Float32Array;
  // Feed and kill rate for every cell. Usually uniform, but a map of rates across
  // the grid shows every regime of the model side by side.
  public readonly feed: Float32Array;
  public readonly kill: Float32Array;
  public stepCount = 0;

  private nextU: Float32Array;
  private nextV: Float32Array;
  private readonly left: Int32Array;
  private readonly right: Int32Array;

  public constructor(columns: number, rows: number, rates: ReactionRates) {
    this.columns = columns;
    this.rows = rows;
    const cellCount = columns * rows;
    this.u = new Float32Array(cellCount).fill(1);
    this.v = new Float32Array(cellCount);
    this.nextU = new Float32Array(cellCount);
    this.nextV = new Float32Array(cellCount);
    this.feed = new Float32Array(cellCount);
    this.kill = new Float32Array(cellCount);
    this.left = new Int32Array(columns);
    this.right = new Int32Array(columns);
    for (let column = 0; column < columns; column++) {
      this.left[column] = (column - 1 + columns) % columns;
      this.right[column] = (column + 1) % columns;
    }
    this.setRates(rates);
  }

  // The same rates everywhere.
  public setRates(rates: ReactionRates): void {
    this.feed.fill(rates.feed);
    this.kill.fill(rates.kill);
  }

  // Rates that vary across the grid: kill rate from left to right, feed rate from
  // bottom to top. This is the classic map of the model's parameter space.
  public setRateMap(low: ReactionRates, high: ReactionRates): void {
    for (let row = 0; row < this.rows; row++) {
      const feed = high.feed + ((low.feed - high.feed) * row) / Math.max(1, this.rows - 1);
      for (let column = 0; column < this.columns; column++) {
        const cell = row * this.columns + column;
        this.feed[cell] = feed;
        this.kill[cell] = low.kill + ((high.kill - low.kill) * column) / Math.max(1, this.columns - 1);
      }
    }
  }

  // U everywhere and no V: the resting state, in which nothing ever happens.
  public clear(): void {
    this.u.fill(1);
    this.v.fill(0);
    this.stepCount = 0;
  }

  // Clears the dish and drops `count` patches of V at random, which is all the
  // model needs to get going.
  public seed(random: RandomSource, count: number, radius: number): void {
    this.clear();
    for (let patch = 0; patch < count; patch++) {
      this.paint(random() * this.columns, random() * this.rows, radius * (0.6 + 0.8 * random()), true);
    }
  }

  // Adds a disc of V (or, with `add` false, wipes a disc back to the resting state).
  public paint(x: number, y: number, radius: number, add: boolean): void {
    const reach = Math.ceil(radius);
    const centreColumn = Math.floor(x);
    const centreRow = Math.floor(y);
    for (let rowOffset = -reach; rowOffset <= reach; rowOffset++) {
      for (let columnOffset = -reach; columnOffset <= reach; columnOffset++) {
        if (rowOffset * rowOffset + columnOffset * columnOffset > radius * radius) continue;
        const column = (((centreColumn + columnOffset) % this.columns) + this.columns) % this.columns;
        const row = (((centreRow + rowOffset) % this.rows) + this.rows) % this.rows;
        const cell = row * this.columns + column;
        this.u[cell] = add ? 0.5 : 1;
        this.v[cell] = add ? 0.25 : 0;
      }
    }
  }

  // Total V in the dish. Zero means the reaction has died out.
  public totalV(): number {
    let total = 0;
    for (let cell = 0; cell < this.v.length; cell++) total += this.v[cell];
    return total;
  }

  public step(): void {
    const { columns, rows, u, v, nextU, nextV, feed, kill, left, right } = this;
    for (let row = 0; row < rows; row++) {
      const middle = row * columns;
      const up = (row === 0 ? rows - 1 : row - 1) * columns;
      const down = (row === rows - 1 ? 0 : row + 1) * columns;
      for (let column = 0; column < columns; column++) {
        const west = left[column];
        const east = right[column];
        const cell = middle + column;
        const uHere = u[cell];
        const vHere = v[cell];
        const laplacianU =
          EDGE_WEIGHT * (u[middle + west] + u[middle + east] + u[up + column] + u[down + column]) +
          CORNER_WEIGHT * (u[up + west] + u[up + east] + u[down + west] + u[down + east]) -
          uHere;
        const laplacianV =
          EDGE_WEIGHT * (v[middle + west] + v[middle + east] + v[up + column] + v[down + column]) +
          CORNER_WEIGHT * (v[up + west] + v[up + east] + v[down + west] + v[down + east]) -
          vHere;
        const reaction = uHere * vHere * vHere;
        const cellFeed = feed[cell];
        nextU[cell] = uHere + DIFFUSION_U * laplacianU - reaction + cellFeed * (1 - uHere);
        nextV[cell] = vHere + DIFFUSION_V * laplacianV + reaction - (cellFeed + kill[cell]) * vHere;
      }
    }
    this.u = nextU;
    this.v = nextV;
    this.nextU = u;
    this.nextV = v;
    this.stepCount++;
  }
}
