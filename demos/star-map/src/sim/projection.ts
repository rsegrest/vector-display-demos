// From a direction in the sky to a point on the screen, for a view looking toward some azimuth and
// altitude with some field of view. The projection is stereographic, as in planetarium programs:
// it keeps shapes (a constellation looks like itself near the edge of a wide view too) and reaches
// almost all the way round, where an ordinary camera's perspective stretches badly past 90 degrees.

const DEGREES = Math.PI / 180;

export interface View {
  // The compass direction at the middle of the screen: 0 north, 90 east.
  readonly azimuth: number;
  // How high the middle of the screen looks: 0 the horizon, 90 straight up.
  readonly altitude: number;
  // The angle the screen's height covers.
  readonly fieldOfView: number;
}

export const MINIMUM_FIELD_OF_VIEW = 8;
export const MAXIMUM_FIELD_OF_VIEW = 160;

// Directions further behind the viewer than this (the cosine of the angle from straight ahead) are
// not drawn: the stereographic projection sends them toward infinity.
const BEHIND = -0.6;

export class Projector {
  private readonly forward = new Float64Array(3);
  private readonly right = new Float64Array(3);
  private readonly up = new Float64Array(3);
  private scale = 1;
  private centerX = 0;
  private centerY = 0;

  public set(view: View, screenWidth: number, screenHeight: number): void {
    const azimuth = view.azimuth * DEGREES;
    const altitude = view.altitude * DEGREES;
    // The horizon frame: x east, y north, z up.
    this.forward[0] = Math.cos(altitude) * Math.sin(azimuth);
    this.forward[1] = Math.cos(altitude) * Math.cos(azimuth);
    this.forward[2] = Math.sin(altitude);
    // To the right of the view, level with the horizon.
    this.right[0] = Math.cos(azimuth);
    this.right[1] = -Math.sin(azimuth);
    this.right[2] = 0;
    // up = right x forward
    this.up[0] = this.right[1] * this.forward[2] - this.right[2] * this.forward[1];
    this.up[1] = this.right[2] * this.forward[0] - this.right[0] * this.forward[2];
    this.up[2] = this.right[0] * this.forward[1] - this.right[1] * this.forward[0];
    // Half the field of view reaches half the screen's height. Stereographic distance is 2 tan(angle / 2).
    this.scale = screenHeight / 2 / (2 * Math.tan((view.fieldOfView / 2) * DEGREES * 0.5));
    this.centerX = screenWidth / 2;
    this.centerY = screenHeight / 2;
  }

  // Where a horizon-frame unit vector lands, written to out[offset], out[offset + 1]; false if it is
  // too far behind the viewer to draw.
  public project(east: number, north: number, up: number, out: Float64Array, offset: number): boolean {
    const ahead = east * this.forward[0] + north * this.forward[1] + up * this.forward[2];
    if (ahead < BEHIND) return false;
    const across = east * this.right[0] + north * this.right[1] + up * this.right[2];
    const upward = east * this.up[0] + north * this.up[1] + up * this.up[2];
    const stretch = 2 / (1 + ahead);
    out[offset] = this.centerX + across * stretch * this.scale;
    out[offset + 1] = this.centerY - upward * stretch * this.scale;
    return true;
  }

  // Screen units per degree at the middle of the view: for turning a drag into a turn of the view.
  public get unitsPerDegree(): number {
    return this.scale * DEGREES;
  }
}

// Where the horizon sits on the screen when looking up at `altitude`: the share of the way from the
// middle to the bottom edge (0 the middle, 1 the bottom edge, more than 1 below the screen, negative
// above the middle). In a stereographic view the distance from the middle grows as tan(angle / 2).
export function horizonScreenShare(altitude: number, fieldOfView: number): number {
  return Math.tan((altitude / 2) * DEGREES) / Math.tan((fieldOfView / 4) * DEGREES);
}

// The altitude to look up at for the horizon to sit at `share` of the way from the middle to the bottom edge.
export function altitudeForHorizonAt(share: number, fieldOfView: number): number {
  return (2 * Math.atan(share * Math.tan((fieldOfView / 4) * DEGREES))) / DEGREES;
}
