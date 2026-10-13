// Triangle meshes and what can be worked out from their shape alone: which
// triangles share each edge, and how sharply the surface bends there.

export interface Mesh {
  // x, y, z for each vertex.
  readonly positions: Float32Array;
  // Three vertex indices for each triangle, anticlockwise seen from outside.
  readonly indices: Uint32Array;
}

export interface MeshTopology {
  readonly mesh: Mesh;
  readonly vertexCount: number;
  readonly faceCount: number;
  // Unit normal of each triangle.
  readonly faceNormals: Float32Array;
  readonly edgeCount: number;
  // The two vertices of each edge.
  readonly edgeVertices: Uint32Array;
  // The triangles on either side of each edge; the second is -1 on an open border.
  readonly edgeFaces: Int32Array;
  // Cosine of the angle between the two triangles' normals: 1 where the surface
  // is flat across the edge, 0 at a right-angled corner. 1 for border edges.
  readonly edgeCosine: Float32Array;
  // True if no edge is an open border: the surface encloses a volume with no holes.
  readonly isClosed: boolean;
}

// Reads a Wavefront OBJ file: vertex positions and faces. Faces with more than
// three corners are split into a fan of triangles; normals and texture
// coordinates are ignored.
export function parseObj(text: string): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("v ")) {
      const parts = line.trim().split(/\s+/);
      positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (line.startsWith("f ")) {
      const vertexCount = positions.length / 3;
      const corners = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((corner) => {
          const index = Number.parseInt(corner, 10);
          // OBJ counts from 1; negative numbers count back from the latest vertex.
          return index < 0 ? vertexCount + index : index - 1;
        });
      for (let corner = 1; corner + 1 < corners.length; corner++) indices.push(corners[0], corners[corner], corners[corner + 1]);
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

// Merges vertices that sit at the same place (within `tolerance`) and drops
// triangles that collapse to nothing as a result. Files often repeat a vertex for
// each triangle that uses it, which hides the fact that the triangles are neighbours.
export function weld(mesh: Mesh, tolerance = 1e-5): Mesh {
  const { positions, indices } = mesh;
  const lookup = new Map<string, number>();
  const remap = new Uint32Array(positions.length / 3);
  const welded: number[] = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const key = `${Math.round(positions[vertex * 3] / tolerance)},${Math.round(positions[vertex * 3 + 1] / tolerance)},${Math.round(positions[vertex * 3 + 2] / tolerance)}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = welded.length / 3;
      welded.push(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
      lookup.set(key, index);
    }
    remap[vertex] = index;
  }
  const kept: number[] = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = remap[indices[offset]];
    const b = remap[indices[offset + 1]];
    const c = remap[indices[offset + 2]];
    if (a !== b && b !== c && c !== a) kept.push(a, b, c);
  }
  return { positions: Float32Array.from(welded), indices: Uint32Array.from(kept) };
}

// Moves the mesh to the origin and scales it to fit a sphere of radius 1.
export function normalise(mesh: Mesh): Mesh {
  const { positions } = mesh;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], positions[offset + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[offset + axis]);
    }
  }
  const centre = [0, 1, 2].map((axis) => (minimum[axis] + maximum[axis]) / 2);
  let radius = 1e-9;
  for (let offset = 0; offset < positions.length; offset += 3) {
    radius = Math.max(radius, Math.hypot(positions[offset] - centre[0], positions[offset + 1] - centre[1], positions[offset + 2] - centre[2]));
  }
  const scaled = new Float32Array(positions.length);
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis++) scaled[offset + axis] = (positions[offset + axis] - centre[axis]) / radius;
  }
  return { positions: scaled, indices: mesh.indices };
}

// Works out the mesh's edges, the triangles on each side of them, and how sharp each is.
export function buildTopology(mesh: Mesh): MeshTopology {
  const { positions, indices } = mesh;
  const vertexCount = positions.length / 3;
  const faceCount = indices.length / 3;
  const faceNormals = new Float32Array(faceCount * 3);
  for (let face = 0; face < faceCount; face++) {
    const a = indices[face * 3] * 3;
    const b = indices[face * 3 + 1] * 3;
    const c = indices[face * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    faceNormals[face * 3] = nx / length;
    faceNormals[face * 3 + 1] = ny / length;
    faceNormals[face * 3 + 2] = nz / length;
  }

  // Each edge is found from both of its triangles; the first to arrive records it.
  const edgeOf = new Map<number, number>();
  const edgeVertices: number[] = [];
  const edgeFaces: number[] = [];
  for (let face = 0; face < faceCount; face++) {
    for (let corner = 0; corner < 3; corner++) {
      const from = indices[face * 3 + corner];
      const to = indices[face * 3 + ((corner + 1) % 3)];
      const key = Math.min(from, to) * vertexCount + Math.max(from, to);
      const existing = edgeOf.get(key);
      if (existing === undefined) {
        edgeOf.set(key, edgeVertices.length / 2);
        edgeVertices.push(from, to);
        edgeFaces.push(face, -1);
      } else if (edgeFaces[existing * 2 + 1] === -1) {
        edgeFaces[existing * 2 + 1] = face;
      }
      // A third triangle on one edge (a non-manifold mesh) is left out of the pairing.
    }
  }

  const edgeCount = edgeVertices.length / 2;
  const edgeCosine = new Float32Array(edgeCount).fill(1);
  for (let edge = 0; edge < edgeCount; edge++) {
    const first = edgeFaces[edge * 2] * 3;
    const second = edgeFaces[edge * 2 + 1] * 3;
    if (second < 0) continue;
    edgeCosine[edge] = faceNormals[first] * faceNormals[second] + faceNormals[first + 1] * faceNormals[second + 1] + faceNormals[first + 2] * faceNormals[second + 2];
  }
  return {
    mesh,
    vertexCount,
    faceCount,
    faceNormals,
    edgeCount,
    edgeVertices: Uint32Array.from(edgeVertices),
    edgeFaces: Int32Array.from(edgeFaces),
    edgeCosine,
    isClosed: !edgeFaces.includes(-1),
  };
}

// The compact form meshes are stored in: positions as whole numbers from -32767
// to 32767 (the mesh fits a unit sphere, so that is about five decimal places).
export interface StoredMesh {
  readonly name: string;
  readonly credit: string;
  readonly positions: readonly number[];
  readonly indices: readonly number[];
}

export const STORED_SCALE = 32767;

export function loadStored(stored: StoredMesh): Mesh {
  return { positions: Float32Array.from(stored.positions, (value) => value / STORED_SCALE), indices: Uint32Array.from(stored.indices) };
}
