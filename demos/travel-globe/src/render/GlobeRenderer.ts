import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList, type ShapePlacement } from "@vector-display/core";
import { ClippedPen, DynamicGeometry, type ClipRect, type PenClip } from "@vector-demos/demo-kit";
import { GlobeView, type ProjectedPoint } from "../geo/GlobeView.js";
import { OceanField, TILE_DEGREES } from "../geo/ocean.js";
import { createStars, type Star } from "../geo/stars.js";
import { angledHatchSegments, hatchSegments, ringsBounds, type AngledHatchLine, type Bounds } from "../geo/shapes.js";
import { PLACE_STATUSES, type Atlas, type GeoFeature, type Place, type PlaceStatus } from "../places.js";

// The travel map's own palette: cyan visited, purple seen, green planned, amber want, pink lived.
export const STATUS_COLORS: Record<PlaceStatus, BeamColor> = {
  visited: { red: 0.25, green: 0.85, blue: 1 },
  seen: { red: 0.72, green: 0.5, blue: 1 },
  planned: { red: 0.35, green: 1, blue: 0.55 },
  want: { red: 1, green: 0.72, blue: 0.25 },
  lived: { red: 1, green: 0.42, blue: 0.75 },
};

const LIMB_COLOR: BeamColor = { red: 0.3, green: 0.55, blue: 0.95 };
const GRATICULE_COLOR: BeamColor = { red: 0.22, green: 0.35, blue: 0.6 };
const COUNTRY_LINE_COLOR: BeamColor = { red: 0.42, green: 0.55, blue: 0.75 };
const STATE_LINE_COLOR: BeamColor = { red: 0.35, green: 0.48, blue: 0.68 };
const HIGHLIGHT_COLOR: BeamColor = { red: 0.95, green: 0.97, blue: 1 };
const WAVE_COLOR: BeamColor = { red: 0.14, green: 0.3, blue: 0.82 };
// Unvisited land: brown, tan, dark green, olive, sienna. Neighbors never share a tone (see build-geo.mjs).
const LAND_TONES: readonly BeamColor[] = [
  { red: 0.52, green: 0.33, blue: 0.16 },
  { red: 0.62, green: 0.53, blue: 0.32 },
  { red: 0.16, green: 0.42, blue: 0.22 },
  { red: 0.42, green: 0.45, blue: 0.17 },
  { red: 0.56, green: 0.26, blue: 0.14 },
];
const LAND_INTENSITY = 0.1;
const WAVE_INTENSITY = 0.7;
const WAVE_HALF_WIDTH = 6;
const WAVE_HEIGHT = 2;
const CROSS_ANGLES = [Math.PI / 4, -Math.PI / 4];
const STAR_COUNT = 2200;
const STAR_COLORS: readonly BeamColor[] = [
  { red: 0.82, green: 0.88, blue: 1 },
  { red: 1, green: 0.85, blue: 0.62 },
];
const STAR_INTENSITIES = [0.35, 0.7, 1.25];
// The sky turns with the globe but more slowly, like a distant background; at full speed the
// stars move several times faster than the surface and smear into phosphor streaks.
const STAR_PARALLAX = 0.3;
// Visited-place hatching drifts slowly downward: one line spacing per HATCH_DRIFT_SECONDS, in
// HATCH_PHASES steps so each step's geometry can be cached while the view holds still.
const HATCH_DRIFT_SECONDS = 4;
const HATCH_PHASES = 16;

const GRATICULE_STEP = 30;
const DENSIFY_DEGREES = 2;
const LIMB_POINTS = 160;
const TINY_MARKER_RADIUS = 11;
const CITY_MARKER_SIZE = 5;
export const CITIES_FROM_ZOOM = 2.2;

// Hatch spacing in degrees for each zoom bucket, so the fill stays about as dense on screen when zoomed in.
const HATCH_LEVELS: readonly { readonly fromZoom: number; readonly spacing: number }[] = [
  { fromZoom: 0, spacing: 0.9 },
  { fromZoom: 2.5, spacing: 0.4 },
  { fromZoom: 6, spacing: 0.15 },
];

export interface GlobeHighlights {
  readonly hovered: GeoFeature | null;
  readonly selected: GeoFeature | null;
  readonly seconds: number;
}

// Cross-hatch spacing for unvisited land, coarser than the visited-place hatching.
const LAND_LEVELS: readonly { readonly fromZoom: number; readonly spacing: number }[] = [
  { fromZoom: 0, spacing: 2.4 },
  { fromZoom: 2.5, spacing: 1 },
  { fromZoom: 6, spacing: 0.4 },
];

export interface GlobeDrawOptions {
  // The screen area this view fills, for skipping work that would land off screen.
  readonly bounds: ClipRect;
  // Clip to an inset window, or cut windows out of the main view.
  readonly clip?: PenClip;
  // Inset maps hide the globe outline and graticule, which would only clutter a small window.
  readonly isInset?: boolean;
  // Brightness of country hatching; the US map turns it down so the states stand out.
  readonly countryIntensity?: number;
}

type HatchCache = Map<string, readonly { lat: number; lngStart: number; lngEnd: number }[]>;

interface HatchSlot {
  key: string;
  readonly states: Map<PlaceStatus, DynamicGeometry>;
  readonly countries: Map<PlaceStatus, DynamicGeometry>;
}

function statusMap(create: () => DynamicGeometry): Map<PlaceStatus, DynamicGeometry> {
  return new Map(PLACE_STATUSES.map((status) => [status, create()]));
}

// Draws the travel globe. Every line goes through GlobeView, which hides the far side; lines are cut
// cleanly at the horizon and at any clip rectangles, and connected lines are drawn as paths so the
// beam joins them without beads.
export class GlobeRenderer {
  private readonly limb = new DynamicGeometry(LIMB_POINTS);
  private readonly graticule = new DynamicGeometry(2048);
  private readonly countryLines = new DynamicGeometry(16384);
  private readonly stateLines = new DynamicGeometry(1024);
  private readonly highlight = new DynamicGeometry(1024);
  private readonly markerGeometries = statusMap(() => new DynamicGeometry(256));
  // One slot per animation phase: the hatching drawn at that phase and the view it was drawn for.
  private readonly hatchSlots: HatchSlot[] = [];
  private readonly hatchCache: HatchCache = new Map();
  private readonly landCaches: Map<string, readonly AngledHatchLine[]>[] = LAND_LEVELS.map(() => new Map());
  private readonly landGeometries = LAND_TONES.map(() => new DynamicGeometry(4096));
  private readonly waves = new DynamicGeometry(4096);
  private readonly ocean: OceanField;
  private readonly unvisitedLand: readonly GeoFeature[];
  private readonly stars: readonly Star[] = createStars(STAR_COUNT);
  private readonly skyView = new GlobeView();
  private skyLng = 0;
  private lastViewLng: number | null = null;
  // Indexed by color (0 cool, 1 warm) × 3 + magnitude.
  private readonly starGeometries = STAR_COLORS.flatMap(() => STAR_INTENSITIES.map(() => new DynamicGeometry(256)));
  private readonly countryLineBounds: readonly Bounds[];
  private readonly stateLineBounds: readonly Bounds[];
  private viewBounds: ClipRect = { left: 0, top: 0, right: 0, bottom: 0 };
  // The static layers drawn last frame, replayed while the view, clip and selection stay the same.
  private cachedKey = "";
  private readonly cachedLayers: { geometry: DynamicGeometry; color: BeamColor; intensity: number }[] = [];
  private isRecording = false;
  private readonly pen = new ClippedPen();
  private readonly previous: ProjectedPoint = { x: 0, y: 0, depth: 0 };
  private readonly current: ProjectedPoint = { x: 0, y: 0, depth: 0 };
  private isPenDown = false;
  private clip: PenClip = {};

  public constructor(private readonly atlas: Atlas) {
    this.ocean = new OceanField((lng, lat) => atlas.featureAt(lng, lat) !== null);
    // Countries and states not in the travel data; the US itself is drawn state by state.
    this.unvisitedLand = [...atlas.countries, ...atlas.states].filter((f) => !atlas.placeFor(f) && !atlas.hasStates(f));
    this.countryLineBounds = atlas.geo.countryLines.map((line) => ringsBounds([line]));
    this.stateLineBounds = atlas.geo.stateLines.map((line) => ringsBounds([line]));
  }

  // Use one renderer per view: each keeps its own geometry, so a still view can be replayed.
  public draw(displayList: DisplayList, view: GlobeView, highlights: GlobeHighlights, options: GlobeDrawOptions): void {
    this.clip = options.clip ?? {};
    this.viewBounds = options.bounds;
    const key = JSON.stringify([view.centerLng, view.centerLat, view.zoom, options, highlights.selected?.id ?? null]);
    if (key === this.cachedKey) {
      for (const layer of this.cachedLayers) this.add(displayList, layer.geometry, layer.color, layer.intensity);
    } else {
      this.cachedKey = key;
      this.cachedLayers.length = 0;
      this.isRecording = true;
      if (!options.isInset) this.drawStars(displayList, view, options.bounds);
      this.drawWaves(displayList, view, options.bounds);
      this.drawLand(displayList, view);
      if (!options.isInset) {
        this.drawLimb(displayList, view);
        this.drawGraticule(displayList, view);
      }
      this.drawBaseMap(displayList, view);
      this.drawPlaceMarkers(displayList, view, highlights);
      this.isRecording = false;
    }
    this.drawPlaceHatching(displayList, view, highlights, key, options.countryIntensity ?? 0.9);
    this.drawHighlights(displayList, view, highlights);
  }

  private drawLimb(displayList: DisplayList, view: GlobeView): void {
    this.begin(this.limb);
    for (let i = 0; i < LIMB_POINTS; i++) {
      const angle = (i / LIMB_POINTS) * Math.PI * 2;
      const x = view.centerX + Math.cos(angle) * view.radius;
      const y = view.centerY + Math.sin(angle) * view.radius;
      if (i === 0) this.pen.moveTo(x, y);
      else this.pen.lineTo(x, y);
    }
    this.pen.closePath();
    this.add(displayList, this.limb, LIMB_COLOR, 0.75);
  }

  private drawGraticule(displayList: DisplayList, view: GlobeView): void {
    this.begin(this.graticule);
    for (let lng = -180; lng < 180; lng += GRATICULE_STEP) {
      this.beginPath();
      for (let lat = -80; lat <= 80; lat += DENSIFY_DEGREES) this.pathTo(view, lng, lat);
    }
    for (let lat = -60; lat <= 60; lat += GRATICULE_STEP) {
      this.beginPath();
      for (let lng = -180; lng <= 180; lng += DENSIFY_DEGREES) this.pathTo(view, lng, lat);
    }
    this.add(displayList, this.graticule, GRATICULE_COLOR, 0.3);
  }

  private drawBaseMap(displayList: DisplayList, view: GlobeView): void {
    for (const [geometry, lines, bounds, color, intensity] of [
      [this.countryLines, this.atlas.geo.countryLines, this.countryLineBounds, COUNTRY_LINE_COLOR, 0.6],
      [this.stateLines, this.atlas.geo.stateLines, this.stateLineBounds, STATE_LINE_COLOR, 0.35],
    ] as const) {
      this.begin(geometry);
      lines.forEach((line, index) => {
        if (!this.isOffView(view, bounds[index])) this.tracePolyline(view, line);
      });
      this.add(displayList, geometry, color, intensity);
    }
  }

  // Stars on a sky sphere turning with the globe. Only the far half of the sky (behind the Earth) is
  // drawn, spread over a fixed radius that covers the screen, so zooming does not scale it; stars
  // that would sit on the Earth's disk are hidden behind it.
  private drawStars(displayList: DisplayList, view: GlobeView, bounds: ClipRect): void {
    for (const geometry of this.starGeometries) geometry.clear();
    const skyRadius = Math.hypot(bounds.right - bounds.left, bounds.bottom - bounds.top) * 0.6;
    const globeRadiusSquared = (view.radius + 3) ** 2;
    // Follow the globe's longitude continuously (no jump at ±180°), scaled down for parallax.
    if (this.lastViewLng !== null) this.skyLng += wrapDegrees(view.centerLng - this.lastViewLng) * STAR_PARALLAX;
    this.lastViewLng = view.centerLng;
    const sky = this.skyView;
    sky.setScreen({ centerX: view.centerX, centerY: view.centerY, radius: view.radius });
    sky.centerLng = this.skyLng;
    sky.centerLat = view.centerLat * STAR_PARALLAX;
    for (const star of this.stars) {
      const point = sky.project(star.lng, star.lat);
      if (point.depth > -0.05) continue;
      // Unit-sphere coordinates, mirrored: the far sky is seen from inside, behind the globe.
      const x = view.centerX - ((point.x - view.centerX) / view.radius) * skyRadius;
      const y = view.centerY + ((point.y - view.centerY) / view.radius) * skyRadius;
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;
      if ((x - view.centerX) ** 2 + (y - view.centerY) ** 2 < globeRadiusSquared) continue;
      this.starGeometries[(star.isWarm ? 1 : 0) * STAR_INTENSITIES.length + star.magnitude].addSegment(x, y, x, y);
    }
    this.starGeometries.forEach((geometry, index) => {
      const color = STAR_COLORS[Math.floor(index / STAR_INTENSITIES.length)];
      this.add(displayList, geometry, color, STAR_INTENSITIES[index % STAR_INTENSITIES.length]);
    });
  }

  // Little waves scattered over open water, in 10° tiles; only tiles facing the viewer and on screen are visited.
  private drawWaves(displayList: DisplayList, view: GlobeView, bounds: ClipRect): void {
    this.begin(this.waves);
    const level = this.ocean.levelFor(view.zoom);
    const tileMargin = ((TILE_DEGREES * Math.PI) / 180) * view.radius;
    for (let tileLat = -80; tileLat < 80; tileLat += TILE_DEGREES) {
      for (let tileLng = -180; tileLng < 180; tileLng += TILE_DEGREES) {
        const center = view.project(tileLng + TILE_DEGREES / 2, tileLat + TILE_DEGREES / 2);
        if (center.depth < -0.2) continue;
        if (!isNear(center, bounds, tileMargin)) continue;
        const points = this.ocean.tile(tileLng, tileLat, level);
        for (let i = 0; i < points.length; i += 2) {
          const point = view.project(points[i], points[i + 1]);
          if (point.depth < 0.12 || !isNear(point, bounds, WAVE_HALF_WIDTH)) continue;
          // Narrower toward the limb, where the globe is foreshortened.
          const halfWidth = WAVE_HALF_WIDTH * (0.45 + 0.55 * point.depth);
          const { x, y } = point;
          this.pen.moveTo(x - halfWidth, y);
          this.pen.lineTo(x - halfWidth / 2, y - WAVE_HEIGHT);
          this.pen.lineTo(x, y);
          this.pen.lineTo(x + halfWidth / 2, y + WAVE_HEIGHT);
          this.pen.lineTo(x + halfWidth, y);
        }
      }
    }
    this.add(displayList, this.waves, WAVE_COLOR, WAVE_INTENSITY);
  }

  // Unvisited land gets a faint X cross-hatch in its earth tone, so land and water are easy to tell apart.
  private drawLand(displayList: DisplayList, view: GlobeView): void {
    for (const geometry of this.landGeometries) geometry.clear();
    const level = this.landLevel(view.zoom);
    for (const feature of this.unvisitedLand) {
      if (this.isOffView(view, feature.bounds)) continue;
      this.begin(this.landGeometries[feature.tone % LAND_TONES.length], false);
      for (const line of this.landHatchFor(feature, level)) {
        this.beginPath();
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(line.lng1 - line.lng0), Math.abs(line.lat1 - line.lat0)) / DENSIFY_DEGREES));
        for (let step = 0; step <= steps; step++) {
          const t = step / steps;
          this.pathTo(view, line.lng0 + (line.lng1 - line.lng0) * t, line.lat0 + (line.lat1 - line.lat0) * t);
        }
      }
    }
    this.landGeometries.forEach((geometry, tone) => this.add(displayList, geometry, LAND_TONES[tone], LAND_INTENSITY));
  }

  // Whether a lng/lat box is certainly not on screen: every sample of it is behind the globe, or every
  // visible sample lies past the same edge of the view. Boxes wider than a hemisphere are always drawn.
  private isOffView(view: GlobeView, box: Bounds): boolean {
    const { minLng, maxLng, minLat, maxLat } = box;
    if (maxLng - minLng > 150 || maxLat - minLat > 120) return false;
    const margin = 8;
    const { left, right, top, bottom } = this.viewBounds;
    let visible = 0;
    let allLeft = true;
    let allRight = true;
    let allAbove = true;
    let allBelow = true;
    for (let i = 0; i <= 2; i++) {
      for (let j = 0; j <= 2; j++) {
        const point = view.project(minLng + ((maxLng - minLng) * i) / 2, minLat + ((maxLat - minLat) * j) / 2);
        if (point.depth < -0.05) continue;
        visible++;
        allLeft &&= point.x < left - margin;
        allRight &&= point.x > right + margin;
        allAbove &&= point.y < top - margin;
        allBelow &&= point.y > bottom + margin;
      }
    }
    // A box up to ~150° across with no sample facing the viewer has nothing visible.
    if (visible === 0) return true;
    return allLeft || allRight || allAbove || allBelow;
  }

  private landLevel(zoom: number): number {
    let level = 0;
    while (level + 1 < LAND_LEVELS.length && zoom >= LAND_LEVELS[level + 1].fromZoom) level++;
    return level;
  }

  private landHatchFor(feature: GeoFeature, level: number): readonly AngledHatchLine[] {
    const cache = this.landCaches[level];
    let lines = cache.get(feature.id);
    if (!lines) {
      lines = CROSS_ANGLES.flatMap((angle) => angledHatchSegments(feature.rings, LAND_LEVELS[level].spacing, angle));
      cache.set(feature.id, lines);
    }
    return lines;
  }

  // Each visited place is hatched with parallels in its status color; tiny places also get a ring.
  // Ring markers for tiny places and diamonds for cities. These hold still, so they are cached with the view.
  private drawPlaceMarkers(displayList: DisplayList, view: GlobeView, highlights: GlobeHighlights): void {
    for (const geometry of this.markerGeometries.values()) geometry.clear();
    for (const place of this.atlas.places) {
      if (this.isOffView(view, place.bounds) && place !== highlights.selected) continue;
      if (place.isTiny) {
        this.begin(this.markerGeometries.get(place.status)!, false);
        this.ringMarker(view, place, TINY_MARKER_RADIUS);
      }
      if (view.zoom >= CITIES_FROM_ZOOM || place === highlights.selected) {
        for (const city of place.cities) {
          this.begin(this.markerGeometries.get(city.kind)!, false);
          this.cityMarker(view, city.lng, city.lat);
        }
      }
    }
    for (const [status, geometry] of this.markerGeometries) this.add(displayList, geometry, STATUS_COLORS[status], 0.9);
  }

  // Each visited place is hatched with parallels in its status color, drifting slowly downward.
  // The phase's geometry is reused while the view (viewKey) is unchanged.
  private drawPlaceHatching(
    displayList: DisplayList,
    view: GlobeView,
    highlights: GlobeHighlights,
    viewKey: string,
    countryIntensity: number,
  ): void {
    const drift = (highlights.seconds / HATCH_DRIFT_SECONDS) % 1;
    const phaseIndex = Math.floor(drift * HATCH_PHASES) % HATCH_PHASES;
    const slot = (this.hatchSlots[phaseIndex] ??= {
      key: "",
      states: statusMap(() => new DynamicGeometry(256)),
      countries: statusMap(() => new DynamicGeometry(256)),
    });
    if (slot.key !== viewKey) {
      slot.key = viewKey;
      for (const geometry of [...slot.states.values(), ...slot.countries.values()]) geometry.clear();
      // Falling latitude moves the lines down the screen.
      const phase = (HATCH_PHASES - phaseIndex) % HATCH_PHASES;
      const level = this.hatchLevel(view.zoom);
      for (const place of this.atlas.places) {
        // A country mapped state by state (the US) is filled by its states instead, so it is not hatched twice.
        if (this.atlas.hasStates(place)) continue;
        if (this.isOffView(view, place.bounds) && place !== highlights.selected) continue;
        const geometries = place.kind === "country" ? slot.countries : slot.states;
        this.begin(geometries.get(place.status)!, false);
        for (const line of this.hatchFor(place, level, phase)) {
          this.beginPath();
          const steps = Math.max(1, Math.ceil((line.lngEnd - line.lngStart) / DENSIFY_DEGREES));
          for (let step = 0; step <= steps; step++) {
            this.pathTo(view, line.lngStart + ((line.lngEnd - line.lngStart) * step) / steps, line.lat);
          }
        }
      }
    }
    for (const [status, geometry] of slot.countries) this.add(displayList, geometry, STATUS_COLORS[status], countryIntensity);
    for (const [status, geometry] of slot.states) this.add(displayList, geometry, STATUS_COLORS[status], 0.9);
  }

  // The hovered region is outlined faintly; the selected one pulses brightly.
  private drawHighlights(displayList: DisplayList, view: GlobeView, highlights: GlobeHighlights): void {
    const { hovered, selected } = highlights;
    if (hovered && hovered !== selected) this.outline(displayList, view, hovered, 0.45);
    if (selected) this.outline(displayList, view, selected, 0.9 + 0.35 * Math.sin(highlights.seconds * 4));
  }

  private outline(displayList: DisplayList, view: GlobeView, feature: GeoFeature, intensity: number): void {
    this.begin(this.highlight);
    for (const ring of feature.rings) this.tracePolyline(view, ring);
    if (feature.isTiny) this.ringMarker(view, feature, TINY_MARKER_RADIUS + 5);
    // addShape copies the segments, so the geometry can be reused for the next outline.
    this.add(displayList, this.highlight, HIGHLIGHT_COLOR, intensity);
  }

  private ringMarker(view: GlobeView, feature: GeoFeature, radius: number): void {
    const center = view.project(feature.focus.lng, feature.focus.lat);
    if (center.depth < 0.05) return;
    const { x, y } = center;
    this.pen.moveTo(x + radius, y);
    for (let i = 1; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      this.pen.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    this.pen.closePath();
  }

  private cityMarker(view: GlobeView, lng: number, lat: number): void {
    const point = view.project(lng, lat);
    if (point.depth < 0.05) return;
    const { x, y } = point;
    const size = CITY_MARKER_SIZE;
    this.pen.moveTo(x, y - size);
    this.pen.lineTo(x + size, y);
    this.pen.lineTo(x, y + size);
    this.pen.lineTo(x - size, y);
    this.pen.closePath();
  }

  private hatchLevel(zoom: number): number {
    let level = 0;
    while (level + 1 < HATCH_LEVELS.length && zoom >= HATCH_LEVELS[level + 1].fromZoom) level++;
    return level;
  }

  private hatchFor(place: Place, level: number, phase: number) {
    const key = `${place.id}:${level}:${phase}`;
    let lines = this.hatchCache.get(key);
    if (!lines) {
      lines = hatchSegments(place.rings, HATCH_LEVELS[level].spacing, phase / HATCH_PHASES);
      this.hatchCache.set(key, lines);
    }
    return lines;
  }

  // A flat [lng, lat, ...] polyline, projected once per point and cut at the horizon.
  private tracePolyline(view: GlobeView, points: ArrayLike<number>): void {
    this.beginPath();
    for (let i = 0; i < points.length; i += 2) this.pathTo(view, points[i], points[i + 1]);
  }

  // Points the pen at a geometry; clearing is optional so several places can share a status geometry.
  private begin(geometry: DynamicGeometry, shouldClear = true): void {
    if (shouldClear) geometry.clear();
    this.pen.begin(geometry, this.clip);
  }

  private beginPath(): void {
    this.isPenDown = false;
    this.previous.depth = Number.NaN;
  }

  // Extends the current path to a point, starting a new path where it comes back over the horizon.
  private pathTo(view: GlobeView, lng: number, lat: number): void {
    const current = view.project(lng, lat, this.current);
    const previous = this.previous;
    const pen = this.pen;
    if (!Number.isNaN(previous.depth)) {
      if (previous.depth >= 0 && current.depth >= 0) {
        if (!this.isPenDown) pen.moveTo(previous.x, previous.y);
        pen.lineTo(current.x, current.y);
        this.isPenDown = true;
      } else if (previous.depth >= 0 || current.depth >= 0) {
        const t = previous.depth / (previous.depth - current.depth);
        const limb = this.limbPoint(view, previous.x + (current.x - previous.x) * t, previous.y + (current.y - previous.y) * t);
        if (previous.depth >= 0) {
          if (!this.isPenDown) pen.moveTo(previous.x, previous.y);
          pen.lineTo(limb.x, limb.y);
          this.isPenDown = false;
        } else {
          pen.moveTo(limb.x, limb.y);
          pen.lineTo(current.x, current.y);
          this.isPenDown = true;
        }
      } else {
        this.isPenDown = false;
      }
    }
    previous.x = current.x;
    previous.y = current.y;
    previous.depth = current.depth;
  }

  private limbPoint(view: GlobeView, x: number, y: number): { x: number; y: number } {
    const dx = x - view.centerX;
    const dy = y - view.centerY;
    const length = Math.hypot(dx, dy) || 1;
    return { x: view.centerX + (dx / length) * view.radius, y: view.centerY + (dy / length) * view.radius };
  }

  private add(displayList: DisplayList, geometry: DynamicGeometry, color: BeamColor, intensity: number): void {
    if (geometry.segmentCount === 0) return;
    if (this.isRecording) this.cachedLayers.push({ geometry, color, intensity });
    displayList.setColor(color);
    const placement: ShapePlacement = { ...SCREEN_SPACE_PLACEMENT, intensity };
    displayList.addShape(geometry, placement);
  }
}

function isNear(point: { x: number; y: number }, bounds: ClipRect, margin: number): boolean {
  return point.x >= bounds.left - margin && point.x <= bounds.right + margin && point.y >= bounds.top - margin && point.y <= bounds.bottom + margin;
}

function wrapDegrees(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}
