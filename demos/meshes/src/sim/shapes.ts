// Meshes made from formulae, alongside the scanned and modelled ones. They load
// instantly and each shows off one kind of edge: the knot is all smooth surface, so
// everything drawn is silhouette; the gear is all flat faces, so nearly everything
// drawn is a crease.

import { normalise, weld, type Mesh } from "./mesh.js";

// A tube following a (p, q) torus knot: p times round the axis while q times through the hole.
export function torusKnot(p = 2, q = 3, steps = 220, sides = 12, tubeRadius = 0.16): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const centre = (step: number): [number, number, number] => {
    const angle = (step / steps) * Math.PI * 2;
    const radius = 1 + 0.45 * Math.cos(q * angle);
    return [radius * Math.cos(p * angle), radius * Math.sin(p * angle), 0.45 * Math.sin(q * angle)];
  };
  for (let step = 0; step < steps; step++) {
    const here = centre(step);
    const ahead = centre(step + 0.01);
    // A frame round the curve: along it, and two directions across it.
    const tangent = normalised([ahead[0] - here[0], ahead[1] - here[1], ahead[2] - here[2]]);
    const outward = normalised(cross(tangent, [0, 0, 1]));
    const across = cross(outward, tangent);
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      const cosine = Math.cos(angle) * tubeRadius;
      const sine = Math.sin(angle) * tubeRadius;
      positions.push(here[0] + outward[0] * cosine + across[0] * sine, here[1] + outward[1] * cosine + across[1] * sine, here[2] + outward[2] * cosine + across[2] * sine);
    }
  }
  for (let step = 0; step < steps; step++) {
    const next = (step + 1) % steps;
    for (let side = 0; side < sides; side++) {
      const nextSide = (side + 1) % sides;
      const a = step * sides + side;
      const b = next * sides + side;
      const c = next * sides + nextSide;
      const d = step * sides + nextSide;
      indices.push(a, b, c, a, c, d);
    }
  }
  return normalise({ positions: Float32Array.from(positions), indices: Uint32Array.from(indices) });
}

// A spur gear with a hole through it: a toothed outline and a round one, pulled
// out into a slab. Every face is flat, so its edges are creases or nothing.
export function gear(teeth = 14, thickness = 0.5): Mesh {
  const outline: [number, number][] = [];
  const hole: [number, number][] = [];
  // Each tooth: root, rise, flat top, fall.
  const perTooth = 4;
  const count = teeth * perTooth;
  for (let index = 0; index < count; index++) {
    const tooth = Math.floor(index / perTooth);
    const part = index % perTooth;
    const fraction = [0, 0.3, 0.5, 0.8][part];
    const angle = ((tooth + fraction) / teeth) * Math.PI * 2;
    const radius = part === 1 || part === 2 ? 1 : 0.78;
    outline.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    const holeAngle = (index / count) * Math.PI * 2;
    hole.push([Math.cos(holeAngle) * 0.3, Math.sin(holeAngle) * 0.3]);
  }
  const positions: number[] = [];
  const indices: number[] = [];
  // Four rings of vertices: outline and hole, on the front and on the back.
  for (const z of [thickness / 2, -thickness / 2]) {
    for (const [x, y] of outline) positions.push(x, y, z);
    for (const [x, y] of hole) positions.push(x, y, z);
  }
  const outer = (index: number, back: boolean): number => (back ? 2 * count : 0) + (index % count);
  const inner = (index: number, back: boolean): number => (back ? 2 * count : 0) + count + (index % count);
  for (let index = 0; index < count; index++) {
    const next = index + 1;
    // The front and back faces: a band between the outline and the hole.
    indices.push(outer(index, false), outer(next, false), inner(next, false), outer(index, false), inner(next, false), inner(index, false));
    indices.push(outer(index, true), inner(next, true), outer(next, true), outer(index, true), inner(index, true), inner(next, true));
    // The rim, and the wall of the hole.
    indices.push(outer(index, false), outer(index, true), outer(next, true), outer(index, false), outer(next, true), outer(next, false));
    indices.push(inner(index, false), inner(next, true), inner(index, true), inner(index, false), inner(next, false), inner(next, true));
  }
  return normalise(weld({ positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }));
}

// A cube made of twelve triangles, for tests: every real edge is a right angle,
// and each face has one diagonal across which the surface is flat.
export function cube(): Mesh {
  const positions = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalised(vector: readonly number[]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
