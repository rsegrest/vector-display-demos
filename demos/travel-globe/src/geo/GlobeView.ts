export interface GlobeScreen {
  readonly centerX: number;
  readonly centerY: number;
  // Radius of the globe at zoom 1, in world units.
  readonly radius: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  // 1 at the point facing the viewer, 0 on the limb, negative on the far side.
  depth: number;
}

const RADIANS = Math.PI / 180;
export const MIN_ZOOM = 0.8;
export const MAX_ZOOM = 12;

// An orthographic globe: the classic "Earth from far away" view. Points on the far hemisphere get a
// negative depth; GlobeRenderer uses that to hide them and cut lines at the limb. Y is down on screen.
export class GlobeView {
  public centerLng = 0;
  public centerLat = 20;
  public zoom = 1;
  private screen: GlobeScreen = { centerX: 0, centerY: 0, radius: 1 };
  private readonly scratch: ProjectedPoint = { x: 0, y: 0, depth: 0 };
  private sinCenterLat = 0;
  private cosCenterLat = 1;
  private cachedLat = Number.NaN;

  public setScreen(screen: GlobeScreen): void {
    this.screen = screen;
  }

  public get radius(): number {
    return this.screen.radius * this.zoom;
  }

  public get centerX(): number {
    return this.screen.centerX;
  }

  public get centerY(): number {
    return this.screen.centerY;
  }

  // Returns a shared object: read it before the next call.
  public project(lng: number, lat: number, out: ProjectedPoint = this.scratch): ProjectedPoint {
    this.updateTrig();
    const lambda = (lng - this.centerLng) * RADIANS;
    const phi = lat * RADIANS;
    const cosPhi = Math.cos(phi);
    const x = cosPhi * Math.sin(lambda);
    const y0 = Math.sin(phi);
    const z0 = cosPhi * Math.cos(lambda);
    // Tilt about the x axis so centerLat faces the viewer.
    const y = y0 * this.cosCenterLat - z0 * this.sinCenterLat;
    const z = y0 * this.sinCenterLat + z0 * this.cosCenterLat;
    const radius = this.radius;
    out.x = this.screen.centerX + x * radius;
    out.y = this.screen.centerY - y * radius;
    out.depth = z;
    return out;
  }

  public unproject(screenX: number, screenY: number): { lng: number; lat: number } | null {
    this.updateTrig();
    const radius = this.radius;
    const x = (screenX - this.screen.centerX) / radius;
    const y = -(screenY - this.screen.centerY) / radius;
    const rho = x * x + y * y;
    if (rho > 1) return null;
    const z = Math.sqrt(1 - rho);
    // Undo the tilt.
    const y0 = y * this.cosCenterLat + z * this.sinCenterLat;
    const z0 = -y * this.sinCenterLat + z * this.cosCenterLat;
    const lat = Math.asin(Math.max(-1, Math.min(1, y0))) / RADIANS;
    let lng = Math.atan2(x, z0) / RADIANS + this.centerLng;
    lng = ((((lng + 180) % 360) + 360) % 360) - 180;
    return { lng, lat };
  }

  private updateTrig(): void {
    if (this.cachedLat === this.centerLat) return;
    this.cachedLat = this.centerLat;
    this.sinCenterLat = Math.sin(this.centerLat * RADIANS);
    this.cosCenterLat = Math.cos(this.centerLat * RADIANS);
  }
}
