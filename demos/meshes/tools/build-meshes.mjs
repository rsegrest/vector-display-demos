#!/usr/bin/env node
// Downloads the classic test meshes and writes them in the compact form the demo
// loads (src/data/*.json). Run from the package: npm run build:meshes
//
// Each mesh is welded (so neighbouring triangles share vertices), optionally
// thinned, centred, scaled to a unit sphere and rounded to whole numbers.
//
// Thinning is by vertex clustering: space is cut into a grid of small cubes and
// all the vertices in one cube are merged into their average. It is crude next to
// proper mesh simplification, but it is a dozen lines, keeps the overall shape,
// and the full Stanford bunny (69,451 triangles) is far more than line drawing needs.
// It leaves the surface faceted like a cut gem, which reads as false creases, so a
// thinned mesh is then smoothed: each vertex is moved part-way toward the average
// of its neighbours, a few times over.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = "https://raw.githubusercontent.com/alecjacobson/common-3d-test-models/master/data/";
const OUTPUT = fileURLToPath(new URL("../src/data/", import.meta.url));
const SCALE = 32767;

const MESHES = [
  { file: "teapot", name: "UTAH TEAPOT", credit: "MARTIN NEWELL, UNIVERSITY OF UTAH, 1975" },
  { file: "stanford-bunny", out: "bunny", name: "STANFORD BUNNY", credit: "STANFORD 3D SCANNING REPOSITORY, 1994", gridCells: 35, smoothPasses: 3 },
  { file: "spot", name: "SPOT", credit: "KEENAN CRANE, PUBLIC DOMAIN" },
];

function parseObj(text) {
  const positions = [];
  const indices = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("v ")) {
      const parts = line.trim().split(/\s+/);
      positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (line.startsWith("f ")) {
      const count = positions.length / 3;
      const corners = line.trim().split(/\s+/).slice(1).map((corner) => {
        const index = Number.parseInt(corner, 10);
        return index < 0 ? count + index : index - 1;
      });
      for (let corner = 1; corner + 1 < corners.length; corner++) indices.push(corners[0], corners[corner], corners[corner + 1]);
    }
  }
  return { positions, indices };
}

function bounds(positions) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], positions[offset + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[offset + axis]);
    }
  }
  return { minimum, maximum };
}

// Merges all vertices that fall in the same cell of a grid `cellSize` across into
// their average, and drops triangles that collapse or repeat. With a tiny cell
// this is plain welding.
function cluster({ positions, indices }, cellSize) {
  const cells = new Map();
  const remap = new Array(positions.length / 3);
  const sums = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const key = [0, 1, 2].map((axis) => Math.round(positions[vertex * 3 + axis] / cellSize)).join(",");
    let index = cells.get(key);
    if (index === undefined) {
      index = sums.length;
      sums.push([0, 0, 0, 0]);
      cells.set(key, index);
    }
    const sum = sums[index];
    sum[0] += positions[vertex * 3];
    sum[1] += positions[vertex * 3 + 1];
    sum[2] += positions[vertex * 3 + 2];
    sum[3]++;
    remap[vertex] = index;
  }
  const seen = new Set();
  const kept = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = remap[indices[offset]];
    const b = remap[indices[offset + 1]];
    const c = remap[indices[offset + 2]];
    if (a === b || b === c || c === a) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(a, b, c);
  }
  return { positions: sums.flatMap((sum) => [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]), indices: kept };
}

// Drops vertices no triangle uses, which clustering leaves behind.
function compact({ positions, indices }) {
  const remap = new Map();
  const kept = [];
  const reindexed = indices.map((index) => {
    let next = remap.get(index);
    if (next === undefined) {
      next = kept.length / 3;
      kept.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
      remap.set(index, next);
    }
    return next;
  });
  return { positions: kept, indices: reindexed };
}

// Moves every vertex half-way toward the average of the vertices it shares an edge with.
function smooth({ positions, indices }, passes) {
  const count = positions.length / 3;
  const neighbours = Array.from({ length: count }, () => new Set());
  for (let offset = 0; offset < indices.length; offset += 3) {
    const corners = [indices[offset], indices[offset + 1], indices[offset + 2]];
    for (const from of corners) for (const to of corners) if (from !== to) neighbours[from].add(to);
  }
  let current = positions;
  for (let pass = 0; pass < passes; pass++) {
    const next = current.slice();
    for (let vertex = 0; vertex < count; vertex++) {
      if (neighbours[vertex].size === 0) continue;
      for (let axis = 0; axis < 3; axis++) {
        let total = 0;
        for (const neighbour of neighbours[vertex]) total += current[neighbour * 3 + axis];
        next[vertex * 3 + axis] = (current[vertex * 3 + axis] + total / neighbours[vertex].size) / 2;
      }
    }
    current = next;
  }
  return { positions: current, indices };
}

function normalise({ positions, indices }) {
  const { minimum, maximum } = bounds(positions);
  const centre = [0, 1, 2].map((axis) => (minimum[axis] + maximum[axis]) / 2);
  let radius = 0;
  for (let offset = 0; offset < positions.length; offset += 3) {
    radius = Math.max(radius, Math.hypot(positions[offset] - centre[0], positions[offset + 1] - centre[1], positions[offset + 2] - centre[2]));
  }
  return { positions: positions.map((value, index) => Math.round(((value - centre[index % 3]) / radius) * SCALE)), indices };
}

mkdirSync(OUTPUT, { recursive: true });
for (const entry of MESHES) {
  const response = await fetch(`${SOURCE}${entry.file}.obj`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${entry.file}: the source answered ${response.status}`);
  const raw = parseObj(await response.text());
  const { minimum, maximum } = bounds(raw.positions);
  const size = Math.max(maximum[0] - minimum[0], maximum[1] - minimum[1], maximum[2] - minimum[2]);
  const thinned = compact(cluster(raw, entry.gridCells ? size / entry.gridCells : size * 1e-6));
  const mesh = normalise(entry.smoothPasses ? smooth(thinned, entry.smoothPasses) : thinned);
  const stored = { name: entry.name, credit: entry.credit, positions: mesh.positions, indices: mesh.indices };
  writeFileSync(`${OUTPUT}${entry.out ?? entry.file}.json`, `${JSON.stringify(stored)}\n`);
  console.log(`${entry.name}: ${raw.indices.length / 3} triangles in, ${mesh.indices.length / 3} out, ${mesh.positions.length / 3} vertices`);
}
