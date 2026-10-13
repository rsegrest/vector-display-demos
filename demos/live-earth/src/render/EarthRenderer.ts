import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DynamicGeometry } from "@vector-demos/demo-kit";
import { GlobeView, createStars, type Star } from "@vector-demos/travel-globe/geo";
import type { Quake } from "../sim/feeds.js";
import { destination, unitVector, type LngLat } from "../sim/sphere.js";
import { EarthProjector, type EarthPoint } from "./EarthProjector.js";

const LIMB_COLOR: BeamColor = { red: 0.3, green: 0.6, blue: 1 };
const GRATICULE_COLOR: BeamColor = { red: 0.2, green: 0.34, blue: 0.6 };
const COAST_COLOR: BeamColor = { red: 0.35, green: 0.85, blue: 0.7 };
const STAR_COLOR: BeamColor = { red: 0.82, green: 0.88, blue: 1 };
const SUN_COLOR: BeamColor = { red: 1, green: 0.85, blue: 0.4 };
const SATELLITE_COLOR: BeamColor = { red: 0.6, green: 0.8, blue: 1 };
const STATION_COLOR: BeamColor = { red: 1, green: 1, blue: 1 };
const TRACK_COLOR: BeamColor = { red: 0.45, green: 0.9, blue: 1 };
const HIGHLIGHT_COLOR: BeamColor = { red: 1, green: 1, blue: 1 };
// Earthquakes by age: the last day, the last three days, the rest of the week.
const QUAKE_COLORS: readonly BeamColor[] = [
  { red: 1, green: 0.32, blue: 0.2 },
  { red: 1, green: 0.58, blue: 0.2 },
  { red: 0.8, green: 0.6, blue: 0.3 },
];
const QUAKE_INTENSITIES: readonly number[] = [1.1, 0.6, 0.3];
const QUAKE_AGE_LIMITS_HOURS: readonly number[] = [24, 72, Infinity];

const STAR_COUNT = 1400;
const STAR_INTENSITIES: readonly number[] = [0.3, 0.6, 1.1];
const STAR_PARALLAX = 0.3;
const LIMB_POINTS = 160;
const GRATICULE_STEP = 30;
const DENSIFY_DEGREES = 3;
const RING_POINTS = 20;
// A new earthquake sends out a ripple this often (seconds) for its first day.
const RIPPLE_SECONDS = 2.6;
const HOUR_MILLISECONDS = 3600000;

export interface SatelliteMarks {
  readonly count: number;
  // For each satellite: where it is now and where it was a moment ago.
  readonly lng: Float32Array;
  readonly lat: Float32Array;
  readonly radius: Float32Array;
  readonly tailLng: Float32Array;
  readonly tailLat: Float32Array;
  readonly tailRadius: Float32Array;
  // 1 if the model could place the satellite.
  readonly valid: Uint8Array;
  // 1 for the space stations, which are drawn larger and brighter.
  readonly isStation: Uint8Array;
}

export interface GroundTrack {
  // Longitude, latitude pairs along the path over the ground, oldest first.
  readonly points: Float32Array;
  readonly count: number;
  // Index of the point for "now": before it is the past, after it the path ahead.
  readonly nowIndex: number;
  // Where the tracked satellite is: on the ground and how far out.
  readonly lng: number;
  readonly lat: number;
  readonly radius: number;
}

export interface EarthScene {
  readonly timeMilliseconds: number;
  // Real seconds, for animation that should not depend on how fast time is being played.
  readonly wallSeconds: number;
  readonly satellites: SatelliteMarks | null;
  readonly track: GroundTrack | null;
  readonly quakes: readonly Quake[];
  readonly subsolar: LngLat;
  readonly showGraticule: boolean;
  readonly showTerminator: boolean;
  // A screen position to ring, for whatever the pointer is over.
  readonly highlight: { readonly x: number; readonly y: number } | null;
}

// Angular radius of an earthquake's ring, in degrees: about 1 for magnitude 4.5, 3.5 for magnitude 7.
export function quakeRingDegrees(magnitude: number): number {
  return Math.max(0.5, 1 + (magnitude - 4.5));
}

// Draws the wireframe Earth and everything on and around it. Lines on the surface
// are cut where they pass over the edge of the globe; things above it are hidden
// only when the globe itself is in the way.
export class EarthRenderer {
  // Screen position and visibility of each satellite and earthquake as last drawn, for picking.
  public satelliteScreen = new Float32Array(0);
  public quakeScreen = new Float32Array(0);

  private readonly projector = new EarthProjector();
  private readonly coastVectors: Float32Array[];
  private readonly stars: readonly Star[] = createStars(STAR_COUNT);
  private readonly skyView = new GlobeView();
  private skyLng = 0;
  private lastViewLng: number | null = null;
  private readonly starGeometries = STAR_INTENSITIES.map(() => new DynamicGeometry(256));
  private readonly limb = new DynamicGeometry(LIMB_POINTS);
  private readonly graticule = new DynamicGeometry(2048);
  private readonly coast = new DynamicGeometry(16384);
  private readonly terminator = new DynamicGeometry(256);
  private readonly sun = new DynamicGeometry(64);
  private readonly satellites = new DynamicGeometry(1024);
  private readonly stations = new DynamicGeometry(256);
  private readonly trackPast = new DynamicGeometry(256);
  private readonly trackAhead = new DynamicGeometry(256);
  private readonly quakeGeometries = QUAKE_COLORS.map(() => new DynamicGeometry(1024));
  private readonly ripples = new DynamicGeometry(512);
  private readonly highlight = new DynamicGeometry(32);
  private readonly point: EarthPoint = { x: 0, y: 0, depth: 0, visible: false };
  private readonly previous: EarthPoint = { x: 0, y: 0, depth: 0, visible: false };
  private readonly tailPoint: EarthPoint = { x: 0, y: 0, depth: 0, visible: false };
  private readonly spot: LngLat = { lng: 0, lat: 0 };
  private penDown = false;
  private hasPrevious = false;
  private segmentTotal = 0;

  // `coastLines` are longitude, latitude pairs, one array per unbroken line.
  public constructor(coastLines: readonly ArrayLike<number>[]) {
    this.coastVectors = coastLines.map((line) => {
      const vectors = new Float32Array((line.length / 2) * 3);
      for (let index = 0; index < line.length / 2; index++) unitVector(line[index * 2], line[index * 2 + 1], vectors, index * 3);
      return vectors;
    });
  }

  public get projection(): EarthProjector {
    return this.projector;
  }

  // Draws the scene and returns the number of segments used.
  public draw(displayList: DisplayList, view: GlobeView, screen: { width: number; height: number }, scene: EarthScene): number {
    this.projector.setView(view);
    this.segmentTotal = 0;
    this.drawStars(displayList, view, screen);
    this.drawLimb(displayList);
    if (scene.showGraticule) this.drawGraticule(displayList);
    this.drawCoast(displayList);
    if (scene.showTerminator) this.drawTerminator(displayList, scene.subsolar);
    this.drawQuakes(displayList, scene);
    if (scene.track) this.drawTrack(displayList, scene.track);
    if (scene.satellites) this.drawSatellites(displayList, scene.satellites);
    if (scene.highlight) this.drawHighlight(displayList, scene.highlight.x, scene.highlight.y);
    return this.segmentTotal;
  }

  // --- Layers --------------------------------------------------------------------------------------------

  // A fixed sky behind the globe, turning with it but more slowly, as distant things do.
  private drawStars(displayList: DisplayList, view: GlobeView, screen: { width: number; height: number }): void {
    for (const geometry of this.starGeometries) geometry.clear();
    const skyRadius = Math.hypot(screen.width, screen.height) * 0.6;
    const globeRadiusSquared = (view.radius + 3) ** 2;
    if (this.lastViewLng !== null) {
      const turned = ((((view.centerLng - this.lastViewLng + 180) % 360) + 360) % 360) - 180;
      this.skyLng += turned * STAR_PARALLAX;
    }
    this.lastViewLng = view.centerLng;
    const sky = this.skyView;
    sky.setScreen({ centerX: view.centerX, centerY: view.centerY, radius: view.radius });
    sky.centerLng = this.skyLng;
    sky.centerLat = view.centerLat * STAR_PARALLAX;
    for (const star of this.stars) {
      const projected = sky.project(star.lng, star.lat);
      if (projected.depth > -0.05) continue;
      // The far half of the sky, seen from inside and spread to cover the screen.
      const x = view.centerX - ((projected.x - view.centerX) / view.radius) * skyRadius;
      const y = view.centerY + ((projected.y - view.centerY) / view.radius) * skyRadius;
      if (x < 0 || x > screen.width || y < 0 || y > screen.height) continue;
      if ((x - view.centerX) ** 2 + (y - view.centerY) ** 2 < globeRadiusSquared) continue;
      this.starGeometries[star.magnitude].addSegment(x, y, x, y);
    }
    this.starGeometries.forEach((geometry, index) => this.add(displayList, geometry, STAR_COLOR, STAR_INTENSITIES[index]));
  }

  private drawLimb(displayList: DisplayList): void {
    const { centreX, centreY, radius } = this.projector;
    this.limb.clear();
    this.limb.moveTo(centreX + radius, centreY);
    for (let index = 1; index < LIMB_POINTS; index++) {
      const angle = (index / LIMB_POINTS) * Math.PI * 2;
      this.limb.lineTo(centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius);
    }
    this.limb.closePath();
    this.add(displayList, this.limb, LIMB_COLOR, 0.8);
  }

  private drawGraticule(displayList: DisplayList): void {
    this.graticule.clear();
    for (let lng = -180; lng < 180; lng += GRATICULE_STEP) {
      this.liftPen();
      for (let lat = -84; lat <= 84; lat += DENSIFY_DEGREES) this.surfaceTo(this.graticule, lng, lat);
    }
    for (let lat = -60; lat <= 60; lat += GRATICULE_STEP) {
      this.liftPen();
      for (let lng = -180; lng <= 180; lng += DENSIFY_DEGREES) this.surfaceTo(this.graticule, lng, lat);
    }
    this.add(displayList, this.graticule, GRATICULE_COLOR, 0.28);
  }

  private drawCoast(displayList: DisplayList): void {
    this.coast.clear();
    for (const vectors of this.coastVectors) {
      this.liftPen();
      for (let offset = 0; offset < vectors.length; offset += 3) {
        this.projector.projectVector(vectors[offset], vectors[offset + 1], vectors[offset + 2], 1, this.point);
        this.surfacePoint(this.coast);
      }
    }
    this.add(displayList, this.coast, COAST_COLOR, 0.5);
  }

  // The line between day and night: every point 90 degrees from where the Sun is
  // overhead. The Sun's own spot gets a small rayed mark.
  private drawTerminator(displayList: DisplayList, subsolar: LngLat): void {
    this.terminator.clear();
    this.liftPen();
    for (let bearing = 0; bearing <= 360; bearing += 3) {
      destination(subsolar.lng, subsolar.lat, bearing, 90, this.spot);
      this.surfaceTo(this.terminator, this.spot.lng, this.spot.lat);
    }
    this.add(displayList, this.terminator, SUN_COLOR, 0.35);

    this.sun.clear();
    const centre = this.projector.project(subsolar.lng, subsolar.lat, 1, this.point);
    if (centre.depth > 0.05) {
      const { x, y } = centre;
      const size = Math.max(7, this.projector.radius * 0.022);
      this.ring(this.sun, x, y, size, 12);
      for (let ray = 0; ray < 8; ray++) {
        const angle = (ray / 8) * Math.PI * 2;
        this.sun.addSegment(x + Math.cos(angle) * size * 1.5, y + Math.sin(angle) * size * 1.5, x + Math.cos(angle) * size * 2.3, y + Math.sin(angle) * size * 2.3);
      }
    }
    this.add(displayList, this.sun, SUN_COLOR, 0.9);
  }

  // A ring on the ground at each epicentre, larger for larger earthquakes and
  // dimmer with age; those of the last day also send out a ripple.
  private drawQuakes(displayList: DisplayList, scene: EarthScene): void {
    for (const geometry of this.quakeGeometries) geometry.clear();
    this.ripples.clear();
    const { quakes } = scene;
    if (this.quakeScreen.length < quakes.length * 3) this.quakeScreen = new Float32Array(quakes.length * 3);
    quakes.forEach((quake, index) => {
      const ageHours = (scene.timeMilliseconds - quake.timeMilliseconds) / HOUR_MILLISECONDS;
      const centre = this.projector.project(quake.lng, quake.lat, 1, this.point);
      const shown = ageHours >= 0 && centre.depth > 0;
      this.quakeScreen[index * 3] = centre.x;
      this.quakeScreen[index * 3 + 1] = centre.y;
      this.quakeScreen[index * 3 + 2] = shown ? 1 : 0;
      if (ageHours < 0 || centre.depth < -0.1) return;
      const band = QUAKE_AGE_LIMITS_HOURS.findIndex((limit) => ageHours < limit);
      const degrees = quakeRingDegrees(quake.magnitude);
      this.surfaceRing(this.quakeGeometries[band], quake.lng, quake.lat, degrees);
      if (band === 0) {
        // Each earthquake ripples out of step with the others.
        const phase = (scene.wallSeconds / RIPPLE_SECONDS + index * 0.37) % 1;
        if (phase < 0.85) this.surfaceRing(this.ripples, quake.lng, quake.lat, degrees * (1 + 2.2 * phase));
      }
    });
    this.quakeGeometries.forEach((geometry, band) => this.add(displayList, geometry, QUAKE_COLORS[band], QUAKE_INTENSITIES[band]));
    this.add(displayList, this.ripples, QUAKE_COLORS[0], 0.45);
  }

  // The tracked satellite's path over the ground, a line down from it to the
  // point beneath it, and a ring there.
  private drawTrack(displayList: DisplayList, track: GroundTrack): void {
    this.trackPast.clear();
    this.trackAhead.clear();
    this.liftPen();
    for (let index = 0; index <= track.nowIndex && index < track.count; index++) {
      this.surfaceTo(this.trackPast, track.points[index * 2], track.points[index * 2 + 1]);
    }
    this.liftPen();
    for (let index = track.nowIndex; index < track.count; index++) {
      this.surfaceTo(this.trackAhead, track.points[index * 2], track.points[index * 2 + 1]);
    }
    const ground = this.projector.project(track.lng, track.lat, 1, this.point);
    if (ground.depth > 0) {
      const groundX = ground.x;
      const groundY = ground.y;
      this.ring(this.trackAhead, groundX, groundY, 9, 12);
      const above = this.projector.project(track.lng, track.lat, track.radius, this.point);
      this.trackAhead.addSegment(groundX, groundY, above.x, above.y);
    }
    this.add(displayList, this.trackPast, TRACK_COLOR, 0.22);
    this.add(displayList, this.trackAhead, TRACK_COLOR, 0.6);
  }

  // Each satellite as a small diamond with a short tail showing which way it is going.
  private drawSatellites(displayList: DisplayList, marks: SatelliteMarks): void {
    this.satellites.clear();
    this.stations.clear();
    if (this.satelliteScreen.length < marks.count * 3) this.satelliteScreen = new Float32Array(marks.count * 3);
    for (let index = 0; index < marks.count; index++) {
      this.satelliteScreen[index * 3 + 2] = 0;
      if (!marks.valid[index]) continue;
      const here = this.projector.project(marks.lng[index], marks.lat[index], marks.radius[index], this.point);
      if (!here.visible) continue;
      const { x, y } = here;
      this.satelliteScreen[index * 3] = x;
      this.satelliteScreen[index * 3 + 1] = y;
      this.satelliteScreen[index * 3 + 2] = 1;
      const isStation = marks.isStation[index] === 1;
      const geometry = isStation ? this.stations : this.satellites;
      const size = isStation ? 7 : 3.5;
      geometry.moveTo(x, y - size);
      geometry.lineTo(x + size, y);
      geometry.lineTo(x, y + size);
      geometry.lineTo(x - size, y);
      geometry.closePath();
      const tail = this.projector.project(marks.tailLng[index], marks.tailLat[index], marks.tailRadius[index], this.tailPoint);
      if (tail.visible) geometry.addSegment(tail.x, tail.y, x, y);
    }
    this.add(displayList, this.satellites, SATELLITE_COLOR, 0.75);
    this.add(displayList, this.stations, STATION_COLOR, 1.2);
  }

  private drawHighlight(displayList: DisplayList, x: number, y: number): void {
    this.highlight.clear();
    this.ring(this.highlight, x, y, 16, 16);
    this.add(displayList, this.highlight, HIGHLIGHT_COLOR, 0.9);
  }

  // --- Pen -----------------------------------------------------------------------------------------------

  private add(displayList: DisplayList, geometry: DynamicGeometry, color: BeamColor, intensity: number): void {
    if (geometry.segmentCount === 0) return;
    this.segmentTotal += geometry.segmentCount;
    displayList.setColor(color);
    displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity });
  }

  private liftPen(): void {
    this.penDown = false;
    this.hasPrevious = false;
  }

  private surfaceTo(geometry: DynamicGeometry, lng: number, lat: number): void {
    this.projector.project(lng, lat, 1, this.point);
    this.surfacePoint(geometry);
  }

  // Continues a line on the surface to this.point, drawing only the part on the
  // near side and ending or starting exactly on the globe's edge where it crosses.
  private surfacePoint(geometry: DynamicGeometry): void {
    const { point, previous } = this;
    const isNear = point.depth >= 0;
    if (!this.hasPrevious) {
      if (isNear) {
        geometry.moveTo(point.x, point.y);
        this.penDown = true;
      }
    } else if (isNear && this.penDown) {
      geometry.lineTo(point.x, point.y);
    } else if (isNear !== previous.depth >= 0) {
      // Where the line passes over the edge: depth runs through zero between the two points.
      const amount = previous.depth / (previous.depth - point.depth);
      let edgeX = previous.x + (point.x - previous.x) * amount - this.projector.centreX;
      let edgeY = previous.y + (point.y - previous.y) * amount - this.projector.centreY;
      const scale = this.projector.radius / Math.max(1e-6, Math.hypot(edgeX, edgeY));
      edgeX = this.projector.centreX + edgeX * scale;
      edgeY = this.projector.centreY + edgeY * scale;
      if (isNear) {
        geometry.moveTo(edgeX, edgeY);
        geometry.lineTo(point.x, point.y);
        this.penDown = true;
      } else {
        geometry.lineTo(edgeX, edgeY);
        this.penDown = false;
      }
    }
    previous.x = point.x;
    previous.y = point.y;
    previous.depth = point.depth;
    this.hasPrevious = true;
  }

  // A circle on the ground, `degrees` of arc in radius.
  private surfaceRing(geometry: DynamicGeometry, lng: number, lat: number, degrees: number): void {
    this.liftPen();
    for (let step = 0; step <= RING_POINTS; step++) {
      destination(lng, lat, (step / RING_POINTS) * 360, degrees, this.spot);
      this.surfaceTo(geometry, this.spot.lng, this.spot.lat);
    }
  }

  // A circle on the screen.
  private ring(geometry: DynamicGeometry, x: number, y: number, radius: number, sides: number): void {
    geometry.moveTo(x + radius, y);
    for (let side = 1; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      geometry.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    geometry.closePath();
  }
}
