// The virtual cabinet's room, in metres, in WebXR's "local-floor" space: y up,
// the floor at y = 0, the viewer starting at the origin looking down -z.  Pure
// math, no browser: the page and the tests share it.

/** A 4x4 matrix, column-major, as WebGL and WebXR use them. */
export type Mat4 = Float32Array;

/** The screen: a flat rectangle facing the viewer. */
export interface Screen {
  /** Its centre. */
  readonly centre: readonly [number, number, number];
  readonly width: number;
  readonly height: number;
}

/** A big screen in a dark room: 3.2 m wide, 16:10, its middle at standing eye height, 2.6 m away. */
export function screenFor(aspect: number, width = 3.2, distance = 2.6, centreHeight = 1.5): Screen {
  return { centre: [0, centreHeight, -distance], width, height: width / aspect };
}

/**
 * Where a ray (origin, direction) meets the screen, as a point on its picture
 * (0..1 across, 0..1 down), or null if it misses or points away.
 */
export function rayOnScreen(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  screen: Screen,
): { x: number; y: number } | null {
  // The screen lies in the plane z = centre z, facing +z.
  if (direction[2] >= -1e-6) return null;
  const t = (screen.centre[2] - origin[2]) / direction[2];
  if (t <= 0) return null;
  const hitX = origin[0] + direction[0] * t;
  const hitY = origin[1] + direction[1] * t;
  const x = (hitX - (screen.centre[0] - screen.width / 2)) / screen.width;
  const y = (screen.centre[1] + screen.height / 2 - hitY) / screen.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** The ray a pose matrix points along: its position, and its -z axis. */
export function rayOfPose(matrix: ArrayLike<number>): { origin: [number, number, number]; direction: [number, number, number] } {
  return { origin: [matrix[12], matrix[13], matrix[14]], direction: [-matrix[8], -matrix[9], -matrix[10]] };
}

export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/** The view matrix of an eye at `eye` looking at `target`, y up. */
export function lookAt(eye: readonly [number, number, number], target: readonly [number, number, number]): Mat4 {
  const sub = (a: readonly number[], b: readonly number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  return Float32Array.from([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

/** The controls panel under a screen: 1.6 m x 0.4 m, its top 0.15 m below the screen's bottom, a hair in front. */
export function panelFor(screen: Screen): Screen {
  const top = screen.centre[1] - screen.height / 2 - 0.15;
  return { centre: [screen.centre[0], top - 0.2, screen.centre[2] + 0.01], width: 1.6, height: 0.4 };
}

/**
 * How visible the controls panel is for a gaze (the head's forward ray): 0 until the gaze comes
 * within the bottom `start` of the screen's height, rising to 1 as it reaches the panel's middle.
 */
export function panelOpacity(origin: readonly [number, number, number], direction: readonly [number, number, number], screen: Screen, start = 0.15): number {
  if (direction[2] >= -1e-6) return 0;
  const t = (screen.centre[2] - origin[2]) / direction[2];
  const gazeY = origin[1] + direction[1] * t;
  const fadeFrom = screen.centre[1] - screen.height / 2 + start * screen.height;
  const fullAt = panelFor(screen).centre[1];
  return Math.max(0, Math.min(1, (fadeFrom - gazeY) / (fadeFrom - fullAt)));
}

/** The screen's two triangles: x, y, z, u, v per corner (u right, v down the picture). */
export function screenVertices(screen: Screen): Float32Array {
  const [cx, cy, cz] = screen.centre;
  const l = cx - screen.width / 2;
  const r = cx + screen.width / 2;
  const t = cy + screen.height / 2;
  const b = cy - screen.height / 2;
  return Float32Array.from([l, t, cz, 0, 0, l, b, cz, 0, 1, r, t, cz, 1, 0, r, t, cz, 1, 0, l, b, cz, 0, 1, r, b, cz, 1, 1]);
}

/** The floor's grid lines, x, y, z per end: a dim square of the given half-size, a line a metre. */
export function floorLines(half = 6): Float32Array {
  const out: number[] = [];
  for (let i = -half; i <= half; i += 1) {
    out.push(i, 0, -half, i, 0, half);
    out.push(-half, 0, i, half, 0, i);
  }
  return Float32Array.from(out);
}
