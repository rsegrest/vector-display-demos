// Turns the automaton's on/off cells into ground you could fly over. A live cell
// on its own is a spike; what reads as terrain is how crowded its neighbourhood has
// been lately. So each height blends the cell itself with a weighted count of the
// cells around it in this generation and the two before: busy regions pile up into
// massifs, and the empty triangles the famous rules leave behind become basins.

// How much of the height comes from the cell itself, as opposed to its surroundings.
const OWN_CELL_SHARE = 0.25;
// Weights across the row, centred on the cell.
const LATERAL_WEIGHTS: readonly number[] = [1, 2, 3, 2, 1];
// Weights back through time, newest generation first.
const GENERATION_WEIGHTS: readonly number[] = [3, 2, 1];

export const HEIGHT_GENERATIONS = GENERATION_WEIGHTS.length;

// `recent` holds the latest generations, newest last; only the last few are read,
// and fewer are fine at the very start of a history. Heights are 0..1. The row is a
// ring, like the automaton.
export function terrainHeights(recent: readonly Uint8Array[]): Float32Array {
  const newest = recent[recent.length - 1];
  const width = newest.length;
  const heights = new Float32Array(width);
  const generations = Math.min(GENERATION_WEIGHTS.length, recent.length);
  const reach = (LATERAL_WEIGHTS.length - 1) / 2;
  let totalWeight = 0;
  for (let age = 0; age < generations; age++) {
    for (const weight of LATERAL_WEIGHTS) totalWeight += weight * GENERATION_WEIGHTS[age];
  }

  for (let column = 0; column < width; column++) {
    let crowd = 0;
    for (let age = 0; age < generations; age++) {
      const row = recent[recent.length - 1 - age];
      for (let offset = -reach; offset <= reach; offset++) {
        const neighbour = (((column + offset) % width) + width) % width;
        crowd += row[neighbour] * LATERAL_WEIGHTS[offset + reach] * GENERATION_WEIGHTS[age];
      }
    }
    heights[column] = OWN_CELL_SHARE * newest[column] + (1 - OWN_CELL_SHARE) * (crowd / totalWeight);
  }
  return heights;
}
