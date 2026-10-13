export interface ScreenPoint {
  x: number;
  y: number;
  // Distance in front of the camera; larger is farther away.
  depth: number;
}

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 4;
const MAX_PITCH = 1.45;
// Camera distance from the origin, in the scene's own units.
const CAMERA_DISTANCE = 4.2;

// A camera circling the origin, looking at it. The scene's z axis is "up", which
// is how the classic attractor pictures are usually drawn.
export class OrbitCamera {
  public yaw = 0.6;
  public pitch = 0.3;
  public zoom = 1;

  private centreX = 0;
  private centreY = 0;
  private unit = 1;
  private sinYaw = 0;
  private cosYaw = 1;
  private sinPitch = 0;
  private cosPitch = 1;

  // Call once per frame before projecting: fixes the screen size and the angles.
  public frame(screenWidth: number, screenHeight: number): void {
    this.centreX = screenWidth / 2;
    this.centreY = screenHeight / 2;
    this.unit = Math.min(screenWidth, screenHeight) * 0.47 * this.zoom * CAMERA_DISTANCE;
    this.sinYaw = Math.sin(this.yaw);
    this.cosYaw = Math.cos(this.yaw);
    this.sinPitch = Math.sin(this.pitch);
    this.cosPitch = Math.cos(this.pitch);
  }

  public rotate(deltaYaw: number, deltaPitch: number): void {
    this.yaw += deltaYaw;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + deltaPitch));
  }

  public zoomBy(factor: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
  }

  // Perspective projection of a scene point. A point at the origin lands in the
  // middle of the screen, and a unit sphere there spans most of the shorter side at zoom 1.
  public project(x: number, y: number, z: number, out: ScreenPoint): void {
    // Turn about the vertical (z) axis, then tip the view up or down.
    const turnedX = x * this.cosYaw - y * this.sinYaw;
    const turnedY = x * this.sinYaw + y * this.cosYaw;
    const tippedY = turnedY * this.cosPitch - z * this.sinPitch;
    const tippedZ = turnedY * this.sinPitch + z * this.cosPitch;
    const depth = Math.max(0.2, CAMERA_DISTANCE + tippedY);
    const scale = this.unit / depth;
    out.x = this.centreX + turnedX * scale;
    out.y = this.centreY - tippedZ * scale;
    out.depth = depth;
  }
}
