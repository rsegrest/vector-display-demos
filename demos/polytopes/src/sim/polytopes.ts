// The six regular polytopes of four dimensions: the 4D cousins of the Platonic
// solids. Each is built from its textbook vertex coordinates, scaled onto the unit
// 3-sphere. Edges are never listed by hand. In a regular polytope every edge has
// the same length and no two vertices are closer than that, so the edges are
// exactly the pairs of vertices at the shortest distance.

export interface Polytope {
  readonly name: string;
  // What the polytope is made of, for the curious.
  readonly cells: string;
  // x, y, z, w for each vertex, all at distance 1 from the origin.
  readonly vertices: Float64Array;
  // Pairs of vertex indices.
  readonly edges: Uint16Array;
  readonly vertexCount: number;
  readonly edgeCount: number;
}

type Point = readonly number[];

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

// Every way of flipping the signs of the non-zero coordinates.
function withAllSigns(point: Point): number[][] {
  let results: number[][] = [[]];
  for (const value of point) {
    const next: number[][] = [];
    for (const partial of results) {
      next.push([...partial, value]);
      if (value !== 0) next.push([...partial, -value]);
    }
    results = next;
  }
  return results;
}

// Every ordering of the coordinates, each tagged with whether it is an even permutation.
function orderings(point: Point): { point: number[]; even: boolean }[] {
  const results: { point: number[]; even: boolean }[] = [];
  const indices = point.map((_value, index) => index);
  const visit = (start: number, even: boolean): void => {
    if (start === indices.length) {
      results.push({ point: indices.map((index) => point[index]), even });
      return;
    }
    for (let swap = start; swap < indices.length; swap++) {
      [indices[start], indices[swap]] = [indices[swap], indices[start]];
      visit(start + 1, swap === start ? even : !even);
      [indices[start], indices[swap]] = [indices[swap], indices[start]];
    }
  };
  visit(0, true);
  return results;
}

function distinct(points: number[][]): number[][] {
  const seen = new Set<string>();
  const results: number[][] = [];
  for (const point of points) {
    const key = point.map((value) => (Math.abs(value) < 1e-9 ? 0 : value).toFixed(6)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(point);
  }
  return results;
}

function allPermutations(point: Point): number[][] {
  return distinct(orderings(point).map((ordering) => ordering.point));
}

function evenPermutations(point: Point): number[][] {
  return distinct(orderings(point).filter((ordering) => ordering.even).map((ordering) => ordering.point));
}

function normalise(points: number[][]): Float64Array {
  const vertices = new Float64Array(points.length * 4);
  points.forEach((point, index) => {
    const length = Math.hypot(point[0], point[1], point[2], point[3]);
    for (let axis = 0; axis < 4; axis++) vertices[index * 4 + axis] = point[axis] / length;
  });
  return vertices;
}

function distanceSquared(vertices: Float64Array, first: number, second: number): number {
  let total = 0;
  for (let axis = 0; axis < 4; axis++) {
    const difference = vertices[first * 4 + axis] - vertices[second * 4 + axis];
    total += difference * difference;
  }
  return total;
}

// The pairs of vertices at the shortest distance from each other.
export function shortestEdges(vertices: Float64Array): Uint16Array {
  const count = vertices.length / 4;
  let shortest = Infinity;
  for (let first = 0; first < count; first++) {
    for (let second = first + 1; second < count; second++) shortest = Math.min(shortest, distanceSquared(vertices, first, second));
  }
  const pairs: number[] = [];
  for (let first = 0; first < count; first++) {
    for (let second = first + 1; second < count; second++) {
      if (distanceSquared(vertices, first, second) < shortest * 1.0001) pairs.push(first, second);
    }
  }
  return Uint16Array.from(pairs);
}

function build(name: string, cells: string, points: number[][]): Polytope {
  const vertices = normalise(points);
  const edges = shortestEdges(vertices);
  return { name, cells, vertices, edges, vertexCount: points.length, edgeCount: edges.length / 2 };
}

function sixHundredCellPoints(): number[][] {
  return [
    ...withAllSigns([0.5, 0.5, 0.5, 0.5]),
    ...allPermutations([1, 0, 0, 0]).flatMap(withAllSigns),
    ...evenPermutations([GOLDEN_RATIO / 2, 0.5, 1 / (2 * GOLDEN_RATIO), 0]).flatMap(withAllSigns),
  ];
}

// The 120-cell is the dual of the 600-cell: it has one vertex in the middle of each
// of the 600-cell's tetrahedral cells. Those cells are the sets of four vertices
// that are all joined to one another.
function oneHundredTwentyCellPoints(): number[][] {
  const dual = build("", "", sixHundredCellPoints());
  const neighbours: Set<number>[] = Array.from({ length: dual.vertexCount }, () => new Set<number>());
  for (let edge = 0; edge < dual.edgeCount; edge++) {
    neighbours[dual.edges[edge * 2]].add(dual.edges[edge * 2 + 1]);
    neighbours[dual.edges[edge * 2 + 1]].add(dual.edges[edge * 2]);
  }
  const points: number[][] = [];
  for (let first = 0; first < dual.vertexCount; first++) {
    for (const second of neighbours[first]) {
      if (second < first) continue;
      for (const third of neighbours[second]) {
        if (third < second || !neighbours[first].has(third)) continue;
        for (const fourth of neighbours[third]) {
          if (fourth < third || !neighbours[first].has(fourth) || !neighbours[second].has(fourth)) continue;
          const centre = [0, 0, 0, 0];
          for (const vertex of [first, second, third, fourth]) {
            for (let axis = 0; axis < 4; axis++) centre[axis] += dual.vertices[vertex * 4 + axis];
          }
          points.push(centre);
        }
      }
    }
  }
  return points;
}

// Built once on first use: the 120-cell takes a moment to derive.
let cached: readonly Polytope[] | null = null;

// The regular polytopes in order of how much there is to look at.
export function regularPolytopes(): readonly Polytope[] {
  if (cached) return cached;
  const inverseRootFive = 1 / Math.sqrt(5);
  cached = [
    build("5-CELL", "5 TETRAHEDRA", [
      [1, 1, 1, -inverseRootFive],
      [1, -1, -1, -inverseRootFive],
      [-1, 1, -1, -inverseRootFive],
      [-1, -1, 1, -inverseRootFive],
      [0, 0, 0, 4 * inverseRootFive],
    ]),
    build("16-CELL", "16 TETRAHEDRA", allPermutations([1, 0, 0, 0]).flatMap(withAllSigns)),
    build("TESSERACT", "8 CUBES", withAllSigns([1, 1, 1, 1])),
    build("24-CELL", "24 OCTAHEDRA", allPermutations([1, 1, 0, 0]).flatMap(withAllSigns)),
    build("600-CELL", "600 TETRAHEDRA", sixHundredCellPoints()),
    build("120-CELL", "120 DODECAHEDRA", oneHundredTwentyCellPoints()),
  ];
  return cached;
}
