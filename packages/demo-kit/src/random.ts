export type RandomSource = () => number;

// Mulberry32: a small, fast seeded generator returning values in [0, 1).
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBetween(random: RandomSource, low: number, high: number): number {
  return low + (high - low) * random();
}

export function createRandomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
