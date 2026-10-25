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

/** The eye height the room is laid out for: its screens and its 3D pictures face an eye here. */
export const ROOM_EYE_HEIGHT = 1.6;

/**
 * Where the room stands in the headset's space, from the head's pose at the moment of
 * recentring: the room's eye (0, ROOM_EYE_HEIGHT, 0) on the head, its -z along the head's
 * facing (turned about the vertical only).  Returns the room-to-headset matrix and its inverse.
 */
export function anchorAt(head: ArrayLike<number>): { toWorld: Mat4; toRoom: Mat4 } {
  const forwardX = -head[8];
  const forwardZ = -head[10];
  const yaw = Math.atan2(-forwardX, -forwardZ);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const tx = head[12];
  const ty = head[13] - ROOM_EYE_HEIGHT;
  const tz = head[14];
  // Turn about y by yaw, then move: column-major.
  const toWorld = Float32Array.from([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, tx, ty, tz, 1]);
  // The inverse of a turn and a move: turn back, and move by the turned-back offset.
  const toRoom = Float32Array.from([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, -(c * tx - s * tz), -ty, -(s * tx + c * tz), 1]);
  return { toWorld, toRoom };
}

/** A point and a direction moved by a rigid matrix. */
export function transformRay(
  matrix: ArrayLike<number>,
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
): { origin: [number, number, number]; direction: [number, number, number] } {
  const point = (v: readonly number[], w: number): [number, number, number] => [
    matrix[0] * v[0] + matrix[4] * v[1] + matrix[8] * v[2] + matrix[12] * w,
    matrix[1] * v[0] + matrix[5] * v[1] + matrix[9] * v[2] + matrix[13] * w,
    matrix[2] * v[0] + matrix[6] * v[1] + matrix[10] * v[2] + matrix[14] * w,
  ];
  return { origin: point(origin, 1), direction: point(direction, 0) };
}

/**
 * Where a game's 3D picture stands in the room: its eye (the picture's origin) where the viewer's
 * eye is, lowered by its drop, its distance 1 PICTURE_RIM_DISTANCE metres ahead, and its width and
 * height squeezed by its spread, depth kept.  The defaults are Tempest's: its eye sits so close to
 * the rim that the picture spans 150 degrees (squeezed to a quarter, about 90), and the owner's
 * tries on the Quest (2026-10-18) put the well best 0.3 m below the eye.  A game whose picture is
 * right as it is (Battlezone's) says spread 1, drop 0.
 */
export const PICTURE_RIM_DISTANCE = 1.5;
export const DEFAULT_PICTURE_SPREAD = 0.25;
export const DEFAULT_PICTURE_DROP = 0.3;

/** The 3D picture's model matrix (the picture's space to the room's) for its spread and drop. */
export function pictureModel(spread: number, drop: number): Mat4 {
  const across = PICTURE_RIM_DISTANCE * spread;
  return Float32Array.from([across, 0, 0, 0, 0, across, 0, 0, 0, 0, PICTURE_RIM_DISTANCE, 0, 0, ROOM_EYE_HEIGHT - drop, 0, 1]);
}

/**
 * Where the flat picture lies on a 3D picture's distance-1 plane, in the 3D picture's own units
 * (x right, y up): its left and right edges' x, its top and bottom edges' y.
 */
export interface FlatFrame {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where a ray (origin, direction, in the room) meets a 3D picture's distance-1 plane, placed with
 * its spread and drop (pictureModel), as a point on the flat picture (0..1 across, 0..1 down, as
 * a mouse over the flat picture gives), clamped to its edges.  `hit` is where the ray meets the
 * plane in the room, `aim` the clamped point there (where a marker goes).  Null if the ray points
 * away from the plane.
 */
export function rayOnPicture3d(
  origin: readonly [number, number, number],
  direction: readonly [number, number, number],
  frame: FlatFrame,
  spread = DEFAULT_PICTURE_SPREAD,
  drop = DEFAULT_PICTURE_DROP,
): { x: number; y: number; hit: [number, number, number]; aim: [number, number, number] } | null {
  // The distance-1 plane is z = -PICTURE_RIM_DISTANCE in the room, facing +z.
  if (direction[2] >= -1e-6) return null;
  const t = (-PICTURE_RIM_DISTANCE - origin[2]) / direction[2];
  if (t <= 0) return null;
  const z = -PICTURE_RIM_DISTANCE;
  const hit: [number, number, number] = [origin[0] + direction[0] * t, origin[1] + direction[1] * t, z];
  // Back into the picture's own units, then across its flat frame.
  const across = PICTURE_RIM_DISTANCE * spread;
  const eyeY = ROOM_EYE_HEIGHT - drop;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const x = clamp((hit[0] / across - frame.left) / (frame.right - frame.left));
  const y = clamp((frame.top - (hit[1] - eyeY) / across) / (frame.top - frame.bottom));
  const aim: [number, number, number] = [(frame.left + x * (frame.right - frame.left)) * across, eyeY + (frame.top - y * (frame.top - frame.bottom)) * across, z];
  return { x, y, hit, aim };
}
