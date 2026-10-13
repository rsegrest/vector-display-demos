import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@vector-demos/demo-kit";
import {
  cellFromNeighborhood,
  createEmptyRow,
  createRandomRow,
  createSingleCellRow,
  growHistory,
  nextRow,
  populationOf,
} from "../src/sim/elementaryCA.js";

describe("cellFromNeighborhood", () => {
  it("reads the rule number's bits, 111 down to 000", () => {
    // Rule 30 is 00011110: dead for 111, 110, 101, 000; alive for 100, 011, 010, 001.
    expect(cellFromNeighborhood(1, 1, 1, 30)).toBe(0);
    expect(cellFromNeighborhood(1, 0, 0, 30)).toBe(1);
    expect(cellFromNeighborhood(0, 1, 0, 30)).toBe(1);
    expect(cellFromNeighborhood(0, 0, 1, 30)).toBe(1);
    expect(cellFromNeighborhood(0, 0, 0, 30)).toBe(0);
  });

  it("gives rule 90 the XOR of the outer cells", () => {
    for (const [left, centre, right] of [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 1],
      [1, 1, 1],
    ]) {
      expect(cellFromNeighborhood(left, centre, right, 90)).toBe(left ^ right);
    }
  });
});

describe("nextRow", () => {
  it("kills everything under rule 0 and fills everything under rule 255", () => {
    const row = createRandomRow(40, 0.5, createSeededRandom(1));
    expect(populationOf(nextRow(row, 0))).toBe(0);
    expect(populationOf(nextRow(row, 255))).toBe(40);
  });

  it("turns a single cell into two under rule 90", () => {
    const width = 9;
    const next = nextRow(createSingleCellRow(width), 90);
    expect(next[4]).toBe(0);
    expect(next[3]).toBe(1);
    expect(next[5]).toBe(1);
    expect(populationOf(next)).toBe(2);
  });

  it("turns a single cell into three under rule 30", () => {
    const next = nextRow(createSingleCellRow(9), 30);
    expect(populationOf(next)).toBe(3);
    expect(next[3]).toBe(1);
    expect(next[4]).toBe(1);
    expect(next[5]).toBe(1);
  });

  it("wraps around the ends of the ring", () => {
    const width = 6;
    const row = createEmptyRow(width);
    row[0] = 1;
    // Rule 90: the cell at the right end sees the left end as its right neighbour.
    const next = nextRow(row, 90);
    expect(next[width - 1]).toBe(1);
    expect(next[1]).toBe(1);
  });

  it("does not modify the row it was given", () => {
    const row = createRandomRow(30, 0.5, createSeededRandom(2));
    const before = Array.from(row);
    nextRow(row, 110);
    expect(Array.from(row)).toEqual(before);
  });
});

describe("createSingleCellRow", () => {
  it("puts exactly one live cell in the middle", () => {
    const row = createSingleCellRow(10);
    expect(populationOf(row)).toBe(1);
    expect(row[5]).toBe(1);
  });
});

describe("createRandomRow", () => {
  it("is reproducible and roughly follows the density", () => {
    const first = createRandomRow(1000, 0.3, createSeededRandom(7));
    const second = createRandomRow(1000, 0.3, createSeededRandom(7));
    expect(Array.from(first)).toEqual(Array.from(second));
    expect(populationOf(first)).toBeGreaterThan(250);
    expect(populationOf(first)).toBeLessThan(350);
  });
});

describe("growHistory", () => {
  it("returns the requested number of generations, each the next of the last", () => {
    const history = growHistory(createSingleCellRow(16), 30, 20);
    expect(history).toHaveLength(20);
    for (let index = 1; index < history.length; index++) {
      expect(Array.from(history[index])).toEqual(Array.from(nextRow(history[index - 1], 30)));
    }
  });
});
