// Elementary cellular automata: one row of cells, each generation computed from
// the three cells above it. Rule 30, 90 and 110 are the famous ones. The world is a
// ring, so the pattern never hits a wall. Everything here is pure and tiny: the demo
// stacks generations into terrain, this module only makes them.

import type { RandomSource } from "@vector-demos/demo-kit";

export interface RulePreset {
  readonly rule: number;
  readonly name: string;
}

// A spread of rules that look distinct as terrain: chaotic cliffs, nested
// triangles, Sierpinski forests and the Turing-complete rule 110.
export const RULE_PRESETS: readonly RulePreset[] = [
  { rule: 30, name: "RULE 30" },
  { rule: 90, name: "RULE 90" },
  { rule: 110, name: "RULE 110" },
  { rule: 150, name: "RULE 150" },
  { rule: 22, name: "RULE 22" },
  { rule: 45, name: "RULE 45" },
  { rule: 60, name: "RULE 60" },
  { rule: 105, name: "RULE 105" },
  { rule: 184, name: "RULE 184" },
  { rule: 73, name: "RULE 73" },
];

// The rule number's binary digits name the outcome for the eight possible
// three-cell neighbourhoods, from 111 (the most significant bit) down to 000.
export function cellFromNeighborhood(left: number, centre: number, right: number, rule: number): number {
  const index = (left << 2) | (centre << 1) | right;
  return (rule >> index) & 1;
}

// One generation. The row is a ring: the neighbours of the first cell include the last.
export function nextRow(row: Uint8Array, rule: number): Uint8Array {
  const width = row.length;
  const next = new Uint8Array(width);
  for (let column = 0; column < width; column++) {
    const left = row[(column - 1 + width) % width];
    const right = row[(column + 1) % width];
    next[column] = cellFromNeighborhood(left, row[column], right, rule);
  }
  return next;
}

export function createEmptyRow(width: number): Uint8Array {
  return new Uint8Array(width);
}

// A single seed cell in the middle, the classic way to see a rule's signature.
export function createSingleCellRow(width: number): Uint8Array {
  const row = new Uint8Array(width);
  row[Math.floor(width / 2)] = 1;
  return row;
}

export function createRandomRow(width: number, density: number, random: RandomSource): Uint8Array {
  const row = new Uint8Array(width);
  for (let column = 0; column < width; column++) row[column] = random() < density ? 1 : 0;
  return row;
}

export function populationOf(row: Uint8Array): number {
  let population = 0;
  for (const cell of row) population += cell;
  return population;
}

// Fills a history of `rowCount` generations, oldest first, ready to be drawn as
// receding terrain. The first row is left to the caller.
export function growHistory(seedRow: Uint8Array, rule: number, rowCount: number): Uint8Array[] {
  const history: Uint8Array[] = [seedRow];
  for (let step = 1; step < rowCount; step++) history.push(nextRow(history[step - 1], rule));
  return history;
}
