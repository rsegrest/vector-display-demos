import type { GlobeView } from "@vector-demos/travel-globe/geo";

export interface EarthPoint {
  x: number;
  y: number;
  // Distance toward the viewer from the plane through the Earth's centre, in Earth
  // radii: positive on the near side, negative on the far side.
  depth: number;
  // False if the Earth is in the way.
  visible: boolean;
}

const RADIANS = Math.PI / 180;

// Projects points on and above the globe using a GlobeView's centre, tilt and
// zoom. It gives the same screen positions as the view's own project() for points
// on the surface, but works from unit vectors, so thousands of coastline points
// cost a few multiplications each instead of several sines and cosines, and it
// handles points above the surface: satellites, which the view knows nothing of.
export class EarthProjector {
  public centreX = 0;
  public centreY = 0;
  // Radius of the globe on screen.
  public radius = 1;

  private sinLng = 0;
  private cosLng = 1;
  private sinLat = 0;
  private cosLat = 1;

  // Call once per frame, after moving the view.
  public setView(view: GlobeView): void {
    this.centreX = view.centerX;
    this.centreY = view.centerY;
    this.radius = view.radius;
    this.sinLng = Math.sin(view.centerLng * RADIANS);
    this.cosLng = Math.cos(view.centerLng * RADIANS);
    this.sinLat = Math.sin(view.centerLat * RADIANS);
    this.cosLat = Math.cos(view.centerLat * RADIANS);
  }

  // Projects a unit vector (see unitVector) pushed out to `radiusFactor` Earth radii.
  public projectVector(vx: number, vy: number, vz: number, radiusFactor: number, out: EarthPoint): EarthPoint {
    // Turn the globe so the view's longitude faces the viewer, then tip it to the view's latitude.
    const x = vx * this.cosLng - vz * this.sinLng;
    const turnedZ = vz * this.cosLng + vx * this.sinLng;
    const y = vy * this.cosLat - turnedZ * this.sinLat;
    const z = vy * this.sinLat + turnedZ * this.cosLat;
    out.x = this.centreX + x * radiusFactor * this.radius;
    out.y = this.centreY - y * radiusFactor * this.radius;
    out.depth = z * radiusFactor;
    // On the near side everything shows. On the far side, only what pokes out past the globe's edge.
    out.visible = z >= 0 || (x * x + y * y) * radiusFactor * radiusFactor > 1;
    return out;
  }

  public project(lng: number, lat: number, radiusFactor: number, out: EarthPoint): EarthPoint {
    const phi = lat * RADIANS;
    const lambda = lng * RADIANS;
    const cosPhi = Math.cos(phi);
    return this.projectVector(cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda), radiusFactor, out);
  }
}
