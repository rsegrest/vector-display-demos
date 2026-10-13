import { describe, expect, it } from "vitest";
import { createSeededRandom } from "@vector-demos/demo-kit";
import {
  CHILD_COUNT,
  GENE_COUNT,
  MAX_DEPTH,
  MAX_GENE,
  MIN_DEPTH,
  MIN_GENE,
  breedChildren,
  clampGene,
  createRandomGenome,
  genomeKey,
  mutateGenome,
} from "../src/sim/genome.js";

describe("clampGene", () => {
  it("holds direction genes inside the range", () => {
    expect(clampGene(50, false)).toBe(MAX_GENE);
    expect(clampGene(-50, false)).toBe(MIN_GENE);
    expect(clampGene(3, false)).toBe(3);
  });

  it("holds the depth gene inside its own range", () => {
    expect(clampGene(0, true)).toBe(MIN_DEPTH);
    expect(clampGene(99, true)).toBe(MAX_DEPTH);
  });
});

describe("createRandomGenome", () => {
  it("produces nine whole-number genes in range", () => {
    const random = createSeededRandom(42);
    for (let sample = 0; sample < 200; sample++) {
      const genome = createRandomGenome(random);
      expect(genome).toHaveLength(GENE_COUNT);
      genome.slice(0, 8).forEach((gene) => {
        expect(Number.isInteger(gene)).toBe(true);
        expect(gene).toBeGreaterThanOrEqual(MIN_GENE);
        expect(gene).toBeLessThanOrEqual(MAX_GENE);
      });
      expect(genome[8]).toBeGreaterThanOrEqual(MIN_DEPTH);
      expect(genome[8]).toBeLessThanOrEqual(MAX_DEPTH);
    }
  });

  it("is reproducible for a given seed", () => {
    expect(createRandomGenome(createSeededRandom(7))).toEqual(createRandomGenome(createSeededRandom(7)));
  });
});

describe("mutateGenome", () => {
  const base = [0, 1, 2, 3, 4, 5, 6, 7, 6];

  it("changes exactly one gene by exactly one step", () => {
    const random = createSeededRandom(1);
    for (let trial = 0; trial < 500; trial++) {
      const child = mutateGenome(base, random);
      const changed = child.map((gene, index) => gene - base[index]).filter((delta) => delta !== 0);
      expect(changed).toHaveLength(1);
      expect(Math.abs(changed[0])).toBe(1);
    }
  });

  it("never leaves the gene's range, even pressed against a bound", () => {
    const random = createSeededRandom(2);
    const extremes = [MAX_GENE, MAX_GENE, MIN_GENE, MIN_GENE, MAX_GENE, MIN_GENE, MAX_GENE, MIN_GENE, MAX_DEPTH];
    for (let trial = 0; trial < 500; trial++) {
      const child = mutateGenome(extremes, random);
      child.slice(0, 8).forEach((gene) => {
        expect(gene).toBeGreaterThanOrEqual(MIN_GENE);
        expect(gene).toBeLessThanOrEqual(MAX_GENE);
      });
      expect(child[8]).toBeGreaterThanOrEqual(MIN_DEPTH);
      expect(child[8]).toBeLessThanOrEqual(MAX_DEPTH);
    }
  });

  it("does not modify the parent", () => {
    const parent = [...base];
    mutateGenome(parent, createSeededRandom(3));
    expect(parent).toEqual(base);
  });
});

describe("breedChildren", () => {
  const base = [0, 1, 2, 3, 4, 5, 6, 7, 6];

  it("returns eight distinct, single-step mutants", () => {
    const children = breedChildren(base, createSeededRandom(9));
    expect(children).toHaveLength(CHILD_COUNT);
    const keys = new Set(children.map(genomeKey));
    expect(keys.size).toBe(CHILD_COUNT);
    for (const child of children) {
      const changed = child.filter((gene, index) => gene !== base[index]);
      expect(changed).toHaveLength(1);
    }
  });

  it("is reproducible for a given seed", () => {
    expect(breedChildren(base, createSeededRandom(9))).toEqual(breedChildren(base, createSeededRandom(9)));
  });
});
