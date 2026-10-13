// Dawkins' recursive tree, straight from The Blind Watchmaker. The eight
// direction genes are arranged so the drawing is bilaterally symmetric: mirror
// pairs of directions share a gene, which is why biomorphs look like animals
// rather than random scribbles. The ninth gene is how many times every branch
// forks. This module only turns genes into lines; the demo decides how they
// reach the beam.
//
// The genes are whole numbers, but nothing here needs them to be. Every branch is
// a smooth function of the genes, so a creature part-way between a parent and its
// child is just the tree grown from part-way genes. That is what lets one creature
// flow into another on screen instead of being swapped for it.

import type { DynamicGeometry } from "@vector-demos/demo-kit";
import { MAX_DEPTH, type Genome } from "../sim/genome.js";

export const BIOMORPH_FLOATS_PER_SEGMENT = 4;
export const MAXIMUM_LEVELS = MAX_DEPTH;

// A tree with this many fork levels draws one trunk and then doubles at each level.
export function segmentCountFor(levels: number): number {
  return 2 ** (levels + 1) - 1;
}

// Room for the largest creature; reuse one of these rather than allocating per frame.
export function createSegmentBuffer(): Float32Array {
  return new Float32Array(segmentCountFor(MAXIMUM_LEVELS) * BIOMORPH_FLOATS_PER_SEGMENT);
}

// Grows the tree into `out`, in the algorithm's own coordinates (y grows down), and
// returns the number of segments written, always segmentCountFor(levels).
//
// `levels` is how many times the tree forks. The depth gene sets the branch
// lengths: a branch at fork level k has length depth - k, and none below zero. With
// a whole-number depth and levels equal to it, this is exactly Dawkins' tree. With a
// depth between two whole numbers, the outermost twigs are part-grown, which is how
// a creature gains or loses a level of branching smoothly.
export function growSegments(genes: ArrayLike<number>, levels: number, out: Float32Array): number {
  const gene = (index: number): number => genes[index] ?? 0;
  // Bilateral symmetry: mirror pairs share a gene.
  const dx = [-gene(1), -gene(0), 0, gene(0), gene(1), gene(2), 0, -gene(2)];
  const dy = [gene(5), gene(4), gene(3), gene(4), gene(5), gene(6), gene(7), gene(6)];
  const depth = gene(8);
  let written = 0;

  const grow = (x: number, y: number, level: number, direction: number): void => {
    const length = Math.max(0, depth - level);
    const endX = x + length * dx[direction];
    const endY = y + length * dy[direction];
    const offset = written * BIOMORPH_FLOATS_PER_SEGMENT;
    out[offset] = x;
    out[offset + 1] = y;
    out[offset + 2] = endX;
    out[offset + 3] = endY;
    written++;
    if (level >= levels) return;
    grow(endX, endY, level + 1, (direction + 1) % 8);
    grow(endX, endY, level + 1, (direction + 7) % 8);
  };

  // Start direction 2 is straight "up" in the gene frame.
  grow(0, 0, 0, 2);
  return written;
}

// The untransformed segments of a whole-number genome.
export function rawSegments(genome: Genome): Float32Array {
  const levels = Math.max(0, Math.min(MAXIMUM_LEVELS, Math.round(genome[8] ?? 0)));
  const out = new Float32Array(segmentCountFor(levels) * BIOMORPH_FLOATS_PER_SEGMENT);
  growSegments(genome, levels, out);
  return out;
}

// The genes part-way from one creature to another; amount 0 is `from`, 1 is `to`.
export function blendGenomes(from: Genome, to: Genome, amount: number): number[] {
  return from.map((gene, index) => gene + ((to[index] ?? gene) - gene) * amount);
}

// Fork levels needed to draw every stage of a blend between two creatures.
export function levelsForBlend(from: Genome, to: Genome): number {
  return Math.max(0, Math.min(MAXIMUM_LEVELS, Math.ceil(Math.max(from[8] ?? 0, to[8] ?? 0))));
}

// Adds a grown tree to `geometry`, centred on (centreX, centreY) with its longest
// side spanning `size`, and flipped so the root sits at the bottom like a plant.
// Every biomorph therefore drops into any cell at any size.
export function addBiomorph(
  geometry: DynamicGeometry,
  segments: Float32Array,
  segmentCount: number,
  centreX: number,
  centreY: number,
  size: number,
): void {
  if (segmentCount === 0) return;
  const floatCount = segmentCount * BIOMORPH_FLOATS_PER_SEGMENT;
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (let index = 0; index < floatCount; index += 2) {
    const x = segments[index];
    const y = segments[index + 1];
    if (x < minimumX) minimumX = x;
    if (x > maximumX) maximumX = x;
    if (y < minimumY) minimumY = y;
    if (y > maximumY) maximumY = y;
  }
  const scale = size / Math.max(maximumX - minimumX, maximumY - minimumY, 1e-6);
  const middleX = (minimumX + maximumX) / 2;
  const middleY = (minimumY + maximumY) / 2;
  for (let index = 0; index < floatCount; index += BIOMORPH_FLOATS_PER_SEGMENT) {
    geometry.addSegment(
      centreX + (segments[index] - middleX) * scale,
      centreY - (segments[index + 1] - middleY) * scale,
      centreX + (segments[index + 2] - middleX) * scale,
      centreY - (segments[index + 3] - middleY) * scale,
    );
  }
}

// A short label for the HUD: the eight direction genes and the depth.
export function describeGenome(genome: Genome): string {
  return genome.slice(0, 8).join(" ") + "   DEPTH " + (genome[8] ?? 0);
}
