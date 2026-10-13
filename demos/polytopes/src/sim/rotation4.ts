// Rotation in four dimensions. In 3D we speak of rotating about an axis, but that
// is a coincidence of having three dimensions. A rotation really happens in a
// plane: two axes trade places while everything else holds still. In 3D there are
// three such planes; in 4D there are six, and three of them involve w, the axis we
// cannot see. Turning in one of those is what makes a 4D shape appear to pass
// through itself.

export const AXIS_NAMES = ["X", "Y", "Z", "W"] as const;

export interface RotationPlane {
  readonly name: string;
  readonly first: number;
  readonly second: number;
  // True for the three planes that involve the unseen axis.
  readonly involvesW: boolean;
}

export const ROTATION_PLANES: readonly RotationPlane[] = [
  { name: "XY", first: 0, second: 1, involvesW: false },
  { name: "XZ", first: 0, second: 2, involvesW: false },
  { name: "YZ", first: 1, second: 2, involvesW: false },
  { name: "XW", first: 0, second: 3, involvesW: true },
  { name: "YW", first: 1, second: 3, involvesW: true },
  { name: "ZW", first: 2, second: 3, involvesW: true },
];

// A 4x4 matrix in row-major order.
export type Matrix4 = Float64Array;

export function identity4(): Matrix4 {
  const matrix = new Float64Array(16);
  matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
  return matrix;
}

// Turns the whole orientation by `angle` in the plane of two world axes, in place.
export function rotateInPlane(matrix: Matrix4, first: number, second: number, angle: number): void {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  for (let column = 0; column < 4; column++) {
    const a = matrix[first * 4 + column];
    const b = matrix[second * 4 + column];
    matrix[first * 4 + column] = a * cosine - b * sine;
    matrix[second * 4 + column] = a * sine + b * cosine;
  }
}

// Many small turns let rounding error creep in; this squares the rows up again
// (Gram-Schmidt) so the shape never slowly shears or shrinks.
export function reorthonormalise(matrix: Matrix4): void {
  for (let row = 0; row < 4; row++) {
    for (let earlier = 0; earlier < row; earlier++) {
      let dot = 0;
      for (let column = 0; column < 4; column++) dot += matrix[row * 4 + column] * matrix[earlier * 4 + column];
      for (let column = 0; column < 4; column++) matrix[row * 4 + column] -= dot * matrix[earlier * 4 + column];
    }
    let length = 0;
    for (let column = 0; column < 4; column++) length += matrix[row * 4 + column] * matrix[row * 4 + column];
    length = Math.sqrt(length);
    for (let column = 0; column < 4; column++) matrix[row * 4 + column] /= length;
  }
}

// Applies the orientation to a list of points (x, y, z, w each), writing into `out`.
export function transformPoints(matrix: Matrix4, points: Float64Array, out: Float64Array): void {
  for (let offset = 0; offset < points.length; offset += 4) {
    const x = points[offset];
    const y = points[offset + 1];
    const z = points[offset + 2];
    const w = points[offset + 3];
    out[offset] = matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3] * w;
    out[offset + 1] = matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7] * w;
    out[offset + 2] = matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11] * w;
    out[offset + 3] = matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15] * w;
  }
}

export type Projection = "PERSPECTIVE" | "STEREOGRAPHIC";

// How far along w the eye sits in the perspective view, in radii of the shape.
export const EYE_W = 2.4;
// Stereographic points this close to the pole fly off to infinity; they are dropped.
export const STEREOGRAPHIC_LIMIT_W = 0.78;

// Brings a 4D point down to 3D. Returns false if the point cannot be shown.
//
// PERSPECTIVE is the 4D version of an ordinary camera: things nearer the eye in w
// look bigger. It is how the familiar cube-within-a-cube tesseract arises.
//
// STEREOGRAPHIC projects from the pole of the 3-sphere that every vertex lies on.
// It keeps angles true, so straight edges become circular arcs and the cells look
// like a foam of bubbles.
export function projectTo3(x: number, y: number, z: number, w: number, projection: Projection, out: [number, number, number]): boolean {
  if (projection === "PERSPECTIVE") {
    const scale = EYE_W / (EYE_W - w);
    out[0] = x * scale;
    out[1] = y * scale;
    out[2] = z * scale;
    return true;
  }
  if (w > STEREOGRAPHIC_LIMIT_W) return false;
  const scale = 1 / (1 - w);
  out[0] = x * scale;
  out[1] = y * scale;
  out[2] = z * scale;
  return true;
}
