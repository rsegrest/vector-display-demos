// The compact form this demo bundles its meshes in, and reading it into the
// library's TriangleMesh. Topology, welding and fitting come from @vector-display/3d.
import { fromRightHanded, type TriangleMesh } from "@vector-display/3d";

// Positions as whole numbers from -32767 to 32767 (the mesh fits a unit sphere, so
// that is about five decimal places), in the source OBJ files' right-handed axes
// (z toward the viewer), as tools/build-meshes.mjs writes them.
export interface StoredMesh {
  readonly name: string;
  readonly credit: string;
  readonly positions: readonly number[];
  readonly indices: readonly number[];
}

export const STORED_SCALE = 32767;

// Converted to the library's axes (z away from the viewer), so the models are not mirrored.
export function loadStored(stored: StoredMesh): TriangleMesh {
  return fromRightHanded({
    positions: Float32Array.from(stored.positions, (value) => value / STORED_SCALE),
    indices: Uint32Array.from(stored.indices),
  });
}
