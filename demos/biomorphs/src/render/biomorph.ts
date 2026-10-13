// Dawkins' recursive tree, straight from The Blind Watchmaker. The eight
// direction genes are arranged so the drawing is bilaterally symmetric: mirror
// pairs of directions share a gene, which is why biomorphs look like animals
// rather than random scribbles. The ninth gene is how many times every branch
// forks. This module only turns a genome into lines; the demo decides how they
// reach the beam.

import { Shape } from "@vector-display/core";
import type { Genome } from "../sim/genome.js";

export interface Biomorph {
  readonly shape: Shape;
  readonly segmentCount: number;
  // Bounds of the normalised drawing, both at most 1.
  readonly width: number;
  readonly height: number;
}

export const BIOMORPH_FLOATS_PER_SEGMENT = 4;

// The recursion is capped so a corrupt genome can never run away.
const MAXIMUM_SEGMENTS = 4096;

// Builds the creature in a normalised box: the drawing is centred on the origin,
// its longest side spans [-0.5, 0.5], and y is flipped so the root sits at the
// bottom like a plant. Every biomorph therefore drops into any cell at any size.
export function buildBiomorph(genome: Genome): Biomorph {
  const coordinates = rawSegments(genome);
  return normalise(coordinates);
}

// The untransformed segments, in the algorithm's own coordinates (y grows down).
export function rawSegments(genome: Genome): Float32Array {
  const gene = (index: number) => genome[index] ?? 0;
  // Bilateral symmetry: mirror pairs share a gene.
  const dx = [-gene(1), -gene(0), 0, gene(0), gene(1), gene(2), 0, -gene(2)];
  const dy = [gene(5), gene(4), gene(3), gene(4), gene(5), gene(6), gene(7), gene(6)];
  const coordinates: number[] = [];

  const grow = (x: number, y: number, length: number, direction: number): void => {
    if (coordinates.length / BIOMORPH_FLOATS_PER_SEGMENT >= MAXIMUM_SEGMENTS) return;
    const endX = x + length * dx[direction];
    const endY = y + length * dy[direction];
    coordinates.push(x, y, endX, endY);
    if (length <= 0) return;
    grow(endX, endY, length - 1, (direction + 1) % 8);
    grow(endX, endY, length - 1, (direction + 7) % 8);
  };

  // Start direction 2 is straight "up" in the gene frame; the depth gene sets length.
  grow(0, 0, gene(8), 2);
  return Float32Array.from(coordinates);
}

function normalise(coordinates: Float32Array): Biomorph {
  const segmentCount = coordinates.length / BIOMORPH_FLOATS_PER_SEGMENT;
  if (segmentCount === 0) {
    return { shape: Shape.fromSegmentCoordinates([]), segmentCount: 0, width: 0, height: 0 };
  }
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (let index = 0; index < coordinates.length; index += 2) {
    const x = coordinates[index];
    const y = coordinates[index + 1];
    if (x < minimumX) minimumX = x;
    if (x > maximumX) maximumX = x;
    if (y < minimumY) minimumY = y;
    if (y > maximumY) maximumY = y;
  }
  const extentX = maximumX - minimumX;
  const extentY = maximumY - minimumY;
  const extent = Math.max(extentX, extentY, 1e-6);
  const scale = 1 / extent;
  const centreX = (minimumX + maximumX) / 2;
  const centreY = (minimumY + maximumY) / 2;
  const normalised = new Float32Array(coordinates.length);
  for (let index = 0; index < coordinates.length; index += 2) {
    normalised[index] = (coordinates[index] - centreX) * scale;
    // Flip y so the drawing grows upward in the world's y-down frame.
    normalised[index + 1] = -(coordinates[index + 1] - centreY) * scale;
  }
  return {
    shape: Shape.fromSegmentCoordinates(normalised),
    segmentCount,
    width: extentX * scale,
    height: extentY * scale,
  };
}

// A short label for the HUD: the eight direction genes and the depth.
export function describeGenome(genome: Genome): string {
  return genome.slice(0, 8).join(" ") + "   DEPTH " + (genome[8] ?? 0);
}
