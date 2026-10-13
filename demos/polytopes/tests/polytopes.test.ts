import { describe, expect, it } from "vitest";
import { regularPolytopes } from "../src/sim/polytopes.js";
import {
  EYE_W,
  ROTATION_PLANES,
  STEREOGRAPHIC_LIMIT_W,
  identity4,
  projectTo3,
  reorthonormalise,
  rotateInPlane,
  transformPoints,
} from "../src/sim/rotation4.js";

// name, vertices, edges, edges meeting at each vertex.
const EXPECTED: readonly (readonly [string, number, number, number])[] = [
  ["5-CELL", 5, 10, 4],
  ["16-CELL", 8, 24, 6],
  ["TESSERACT", 16, 32, 4],
  ["24-CELL", 24, 96, 8],
  ["600-CELL", 120, 720, 12],
  ["120-CELL", 600, 1200, 4],
];

describe("regularPolytopes", () => {
  const polytopes = regularPolytopes();

  it("lists all six, simplest first", () => {
    expect(polytopes.map((polytope) => polytope.name)).toEqual(EXPECTED.map((entry) => entry[0]));
  });

  it.each(EXPECTED)("%s has %i vertices and %i edges, %i at every vertex", (name, vertexCount, edgeCount, degree) => {
    const polytope = polytopes.find((candidate) => candidate.name === name)!;
    expect(polytope.vertexCount).toBe(vertexCount);
    expect(polytope.edgeCount).toBe(edgeCount);
    const degrees = new Array<number>(vertexCount).fill(0);
    for (const vertex of polytope.edges) degrees[vertex]++;
    expect(new Set(degrees)).toEqual(new Set([degree]));
  });

  it.each(EXPECTED)("%s sits on the unit 3-sphere with every edge the same length", (name) => {
    const polytope = polytopes.find((candidate) => candidate.name === name)!;
    for (let vertex = 0; vertex < polytope.vertexCount; vertex++) {
      const offset = vertex * 4;
      expect(Math.hypot(polytope.vertices[offset], polytope.vertices[offset + 1], polytope.vertices[offset + 2], polytope.vertices[offset + 3])).toBeCloseTo(1, 9);
    }
    const lengths: number[] = [];
    for (let edge = 0; edge < polytope.edgeCount; edge++) {
      const a = polytope.edges[edge * 2] * 4;
      const b = polytope.edges[edge * 2 + 1] * 4;
      lengths.push(Math.hypot(...[0, 1, 2, 3].map((axis) => polytope.vertices[a + axis] - polytope.vertices[b + axis])));
    }
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(1e-9);
  });

  it("gives the 600-cell its golden edge length", () => {
    const polytope = polytopes[4];
    const a = polytope.edges[0] * 4;
    const b = polytope.edges[1] * 4;
    const length = Math.hypot(...[0, 1, 2, 3].map((axis) => polytope.vertices[a + axis] - polytope.vertices[b + axis]));
    expect(length).toBeCloseTo(2 / (1 + Math.sqrt(5)), 9);
  });

  it("returns the same list each time", () => {
    expect(regularPolytopes()).toBe(polytopes);
  });
});

describe("rotation in four dimensions", () => {
  it("has six planes, three of them involving w", () => {
    expect(ROTATION_PLANES).toHaveLength(6);
    expect(ROTATION_PLANES.filter((plane) => plane.involvesW)).toHaveLength(3);
  });

  it("turns one axis into the other and leaves the rest alone", () => {
    const matrix = identity4();
    rotateInPlane(matrix, 0, 3, Math.PI / 2);
    const out = new Float64Array(8);
    transformPoints(matrix, Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0]), out);
    // x has turned into w; y is untouched.
    expect(Array.from(out.subarray(0, 4)).map((value) => Math.round(value * 1e9) / 1e9)).toEqual([0, 0, 0, 1]);
    expect(Array.from(out.subarray(4, 8))).toEqual([0, 1, 0, 0]);
  });

  it("keeps every length through thousands of small turns", () => {
    const matrix = identity4();
    for (let step = 0; step < 5000; step++) {
      ROTATION_PLANES.forEach((plane, index) => rotateInPlane(matrix, plane.first, plane.second, 0.003 * (index + 1)));
      if (step % 100 === 0) reorthonormalise(matrix);
    }
    reorthonormalise(matrix);
    const points = regularPolytopes()[3].vertices;
    const out = new Float64Array(points.length);
    transformPoints(matrix, points, out);
    for (let offset = 0; offset < out.length; offset += 4) {
      expect(Math.hypot(out[offset], out[offset + 1], out[offset + 2], out[offset + 3])).toBeCloseTo(1, 9);
    }
  });

  it("repairs a slightly sheared matrix", () => {
    const matrix = identity4();
    matrix[1] = 0.01;
    matrix[0] = 1.02;
    reorthonormalise(matrix);
    for (let row = 0; row < 4; row++) {
      for (let other = 0; other < 4; other++) {
        let dot = 0;
        for (let column = 0; column < 4; column++) dot += matrix[row * 4 + column] * matrix[other * 4 + column];
        expect(dot).toBeCloseTo(row === other ? 1 : 0, 9);
      }
    }
  });
});

describe("projectTo3", () => {
  const out: [number, number, number] = [0, 0, 0];

  it("leaves points at w = 0 where they are in both projections", () => {
    expect(projectTo3(0.3, -0.4, 0.5, 0, "PERSPECTIVE", out)).toBe(true);
    expect(out).toEqual([0.3, -0.4, 0.5]);
    expect(projectTo3(0.3, -0.4, 0.5, 0, "STEREOGRAPHIC", out)).toBe(true);
    expect(out).toEqual([0.3, -0.4, 0.5]);
  });

  it("makes things nearer the eye in w look bigger", () => {
    projectTo3(0.5, 0, 0, 0.5, "PERSPECTIVE", out);
    const near = out[0];
    projectTo3(0.5, 0, 0, -0.5, "PERSPECTIVE", out);
    expect(near).toBeGreaterThan(out[0]);
    expect(near).toBeCloseTo((0.5 * EYE_W) / (EYE_W - 0.5), 9);
  });

  it("sends the far pole to the centre and refuses points at the near pole", () => {
    expect(projectTo3(0, 0, 0, -1, "STEREOGRAPHIC", out)).toBe(true);
    expect(out).toEqual([0, 0, 0]);
    expect(projectTo3(0.1, 0, 0, STEREOGRAPHIC_LIMIT_W + 0.01, "STEREOGRAPHIC", out)).toBe(false);
  });

  it("maps the 3-sphere's equator onto the unit sphere stereographically", () => {
    projectTo3(0.6, 0.8, 0, 0, "STEREOGRAPHIC", out);
    expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 9);
  });
});
