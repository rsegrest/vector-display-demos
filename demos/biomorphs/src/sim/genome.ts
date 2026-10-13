// Dawkins' biomorph genome. Nine integers: genes 1-8 steer eight compass
// directions (with left-right symmetry built in), and gene 9 is the depth of the
// recursive branching. Mutation changes one gene by one step. There is no crossover
// in the Blind Watchmaker, only descent with modification and a human chooser.

import type { RandomSource } from "@vector-demos/demo-kit";

export const GENE_COUNT = 9;
export const MIN_GENE = -9;
export const MAX_GENE = 9;
export const MIN_DEPTH = 1;
export const MAX_DEPTH = 8;
export const CHILD_COUNT = 8;

// A genome is never mutated in place, so a parent can be kept for the history.
export type Genome = readonly number[];

export function clampGene(gene: number, isDepth: boolean): number {
  const low = isDepth ? MIN_DEPTH : MIN_GENE;
  const high = isDepth ? MAX_DEPTH : MAX_GENE;
  return Math.max(low, Math.min(high, gene));
}

// A modest starting creature: genes near the middle of the range and a few levels
// of branching, so the first generation has something to look at.
export function createRandomGenome(random: RandomSource): number[] {
  const genome: number[] = [];
  for (let gene = 0; gene < GENE_COUNT - 1; gene++) {
    genome.push(Math.round((random() * 2 - 1) * 5));
  }
  genome.push(3 + Math.floor(random() * 5));
  return genome;
}

// One random gene takes one step, up or down. A gene pinned against a bound steps
// the other way, so a creature at the edge of the space can still change.
export function mutateGenome(genome: Genome, random: RandomSource): number[] {
  const mutated = genome.slice();
  const gene = Math.min(GENE_COUNT - 1, Math.floor(random() * GENE_COUNT));
  const isDepth = gene === GENE_COUNT - 1;
  let delta = random() < 0.5 ? -1 : 1;
  let value = mutated[gene] + delta;
  const low = isDepth ? MIN_DEPTH : MIN_GENE;
  const high = isDepth ? MAX_DEPTH : MAX_GENE;
  if (value < low || value > high) {
    delta = -delta;
    value = mutated[gene] + delta;
  }
  mutated[gene] = Math.max(low, Math.min(high, value));
  return mutated;
}

export function genomeKey(genome: Genome): string {
  return genome.join(",");
}

// A litter of single-step mutants. Duplicates are skipped where possible so all
// eight children are visibly different breeding options.
export function breedChildren(parent: Genome, random: RandomSource, count = CHILD_COUNT): number[][] {
  const children: number[][] = [];
  const seen = new Set<string>([genomeKey(parent)]);
  const attempts = count * 40;
  for (let attempt = 0; attempt < attempts && children.length < count; attempt++) {
    const child = mutateGenome(parent, random);
    const key = genomeKey(child);
    if (seen.has(key)) continue;
    seen.add(key);
    children.push(child);
  }
  // If the space is exhausted (small ranges), fill the rest with any mutants.
  while (children.length < count) children.push(mutateGenome(parent, random));
  return children;
}
