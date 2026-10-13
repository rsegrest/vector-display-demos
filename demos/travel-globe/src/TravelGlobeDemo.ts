import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import {
  ClippedPen,
  DemoHud,
  DynamicGeometry,
  HUD_MARGIN,
  HUD_TEXT_COLOR,
  fontSafeText,
  getDemoFont,
  type ClipRect,
  type Demo,
  type DemoFrame,
} from "@vector-demos/demo-kit";
import { GlobeView, MAX_ZOOM, MIN_ZOOM } from "./geo/GlobeView.js";
import { CITIES_FROM_ZOOM, GlobeRenderer, STATUS_COLORS } from "./render/GlobeRenderer.js";
import { PLACE_STATUSES, type Atlas, type GeoFeature, type Place, type PlaceKind } from "./places.js";

export type GlobeMode = "world" | "us";

const GLOBE_RADIUS_FRACTION = 0.42;
const AUTO_ROTATE_DEGREES_PER_SECOND = 5;
const AUTO_ROTATE_AFTER_SECONDS = 6;
const FLY_SECONDS = 1.4;
const TOUR_DWELL_SECONDS = 4.5;
const INERTIA_HALF_LIFE_SECONDS = 0.35;
const MAX_TILT = 80;
const WORLD_VIEW = { lng: -40, lat: 25, zoom: 1 };
// The lower 48, nudged right so the Alaska and Hawaii windows sit over the Pacific.
const US_VIEW = { lng: -100.5, lat: 37.5, zoom: 4 };
const US_COUNTRY_INTENSITY = 0.28;
const DIM_COLOR: BeamColor = { red: 0.5, green: 0.62, blue: 0.78 };
const FRAME_COLOR: BeamColor = { red: 0.35, green: 0.55, blue: 0.85 };

interface InsetSpec {
  readonly label: string;
  readonly lng: number;
  readonly lat: number;
  readonly zoom: number;
  // Window size and position, in world units, measured from the bottom left.
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly bottom: number;
}

const INSETS: readonly InsetSpec[] = [
  { label: "ALASKA", lng: -152, lat: 62, zoom: 1.45, width: 300, height: 220, left: HUD_MARGIN, bottom: 120 },
  { label: "HAWAII", lng: -157.4, lat: 20.4, zoom: 4.6, width: 230, height: 140, left: HUD_MARGIN + 320, bottom: 120 },
];

interface Inset {
  readonly spec: InsetSpec;
  readonly view: GlobeView;
  renderer: GlobeRenderer;
  rect: ClipRect;
}

const HELP = {
  world: [
    "DRAG ROTATE   WHEEL ZOOM   CLICK A PLACE   U UNITED STATES MAP   [ ] PREVIOUS / NEXT COUNTRY   P TOUR",
    "ENTER READ POST   SPACE AUTO ROTATE   H HELP   F FULLSCREEN   ESC CLEAR SELECTION",
  ],
  us: [
    "CLICK A STATE   [ ] PREVIOUS / NEXT STATE   P TOUR   W WORLD GLOBE",
    "ENTER READ POST   H HELP   F FULLSCREEN   ESC CLEAR SELECTION / BACK TO GLOBE",
  ],
} as const;

interface Flight {
  readonly fromLng: number;
  readonly fromLat: number;
  readonly fromZoom: number;
  readonly toLng: number;
  readonly toLat: number;
  readonly toZoom: number;
  seconds: number;
}

// Rick's travel map on a vector globe: countries and US states he has been to are hatched in their
// status colors. World mode spins and flies between countries; US mode freezes on the lower 48 with
// Alaska and Hawaii in inset windows.
export class TravelGlobeDemo implements Demo {
  public readonly view = new GlobeView();
  public autoRotate = true;
  public mode: GlobeMode = "world";
  public selected: GeoFeature | null = null;
  public hovered: GeoFeature | null = null;
  public isTouring = false;
  public onSelectionChange: (selected: GeoFeature | null) => void = () => {};
  public onModeChange: (mode: GlobeMode) => void = () => {};
  public onTourChange: (isTouring: boolean) => void = () => {};
  // While set, a click picks a map location (for placing a city) instead of selecting a place.
  public onPickLocation: ((location: { lng: number; lat: number }) => void) | null = null;
  // The editor panel covers the top right, where the details panel is drawn.
  public showsDetails = true;

  private renderer: GlobeRenderer;
  private readonly hud = new DemoHud();
  private insets: Inset[];
  private readonly frames = new DynamicGeometry(16);
  private readonly framePen = new ClippedPen();
  private seconds = 0;
  private idleSeconds = AUTO_ROTATE_AFTER_SECONDS;
  private tourSeconds = 0;
  private insetVisibility = 0;
  private flight: Flight | null = null;
  private spinLng = 0;
  private spinLat = 0;
  private pointer: { x: number; y: number } | null = null;
  private screen: ClipRect = { left: 0, top: 0, right: 1600, bottom: 1000 };

  public constructor(public atlas: Atlas) {
    this.renderer = new GlobeRenderer(atlas);
    this.view.centerLng = WORLD_VIEW.lng;
    this.view.centerLat = WORLD_VIEW.lat;
    this.insets = INSETS.map((spec) => {
      const view = new GlobeView();
      view.centerLng = spec.lng;
      view.centerLat = spec.lat;
      view.zoom = spec.zoom;
      return { spec, view, renderer: new GlobeRenderer(atlas), rect: { left: 0, top: 0, right: 0, bottom: 0 } };
    });
  }

  public resize(width: number, height: number): void {
    this.screen = { left: 0, top: 0, right: width, bottom: height };
    const radius = height * GLOBE_RADIUS_FRACTION;
    this.view.setScreen({ centerX: width / 2, centerY: height / 2, radius });
    for (const inset of this.insets) {
      const { left, bottom, width: w, height: h } = inset.spec;
      inset.rect = { left, top: height - bottom - h, right: left + w, bottom: height - bottom };
      inset.view.setScreen({ centerX: left + w / 2, centerY: height - bottom - h / 2, radius });
    }
  }

  public update(deltaSeconds: number): void {
    this.idleSeconds += deltaSeconds;
    this.hud.update(deltaSeconds);
    this.seconds += deltaSeconds;
    const showInsets = this.mode === "us" && !this.flight;
    this.insetVisibility = Math.max(0, Math.min(1, this.insetVisibility + (showInsets ? 3 : -6) * deltaSeconds));
    const view = this.view;
    if (this.flight) {
      this.advanceFlight(deltaSeconds);
    } else if (this.spinLng !== 0 || this.spinLat !== 0) {
      // Momentum after a drag, fading out.
      view.centerLng += this.spinLng * deltaSeconds;
      view.centerLat = clampTilt(view.centerLat + this.spinLat * deltaSeconds);
      const decay = Math.pow(0.5, deltaSeconds / INERTIA_HALF_LIFE_SECONDS);
      this.spinLng = Math.abs(this.spinLng * decay) < 0.2 ? 0 : this.spinLng * decay;
      this.spinLat = Math.abs(this.spinLat * decay) < 0.2 ? 0 : this.spinLat * decay;
    } else if (this.mode === "world" && this.autoRotate && !this.selected && !this.isTouring && this.idleSeconds > AUTO_ROTATE_AFTER_SECONDS) {
      view.centerLng += (AUTO_ROTATE_DEGREES_PER_SECOND / Math.sqrt(view.zoom)) * deltaSeconds;
    }
    view.centerLng = wrapLongitude(view.centerLng);
    if (this.isTouring && !this.flight) {
      this.tourSeconds += deltaSeconds;
      if (this.tourSeconds >= TOUR_DWELL_SECONDS) {
        this.tourSeconds = 0;
        this.moveThroughPlaces(1);
      }
    }
  }

  public draw(displayList: DisplayList): void {
    const highlights = { hovered: this.hovered, selected: this.selected, seconds: this.seconds };
    const windows = this.insetVisibility > 0 ? this.insets.map((inset) => inset.rect) : [];
    const countryIntensity = this.mode === "us" ? US_COUNTRY_INTENSITY : 0.9;
    this.renderer.draw(displayList, this.view, highlights, { bounds: this.screen, clip: { outside: windows }, countryIntensity });
    if (this.insetVisibility <= 0) return;
    for (const inset of this.insets) {
      inset.renderer.draw(displayList, inset.view, highlights, { bounds: inset.rect, clip: { inside: inset.rect }, isInset: true, countryIntensity });
    }
    this.drawInsetFrames(displayList);
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    this.drawTitleAndTallies(displayList);
    this.drawCityLabels(displayList);
    this.drawInsetLabels(displayList);
    this.drawDetails(displayList, frame);
    this.drawHoverLabel(displayList);
    this.hud.draw(displayList, { title: "", statusLines: [], helpLines: HELP[this.mode], width: frame.width, height: frame.height });
  }

  // --- Interaction ---------------------------------------------------------------------------------------

  public noteActivity(): void {
    this.idleSeconds = 0;
    this.hud.noteActivity();
  }

  public dragBy(screenDeltaX: number, screenDeltaY: number, deltaSeconds: number): void {
    this.noteActivity();
    if (this.mode === "us") return;
    this.stopTour();
    this.flight = null;
    const degreesPerUnit = 180 / Math.PI / this.view.radius;
    const dLng = -screenDeltaX * degreesPerUnit;
    const dLat = screenDeltaY * degreesPerUnit;
    this.view.centerLng = wrapLongitude(this.view.centerLng + dLng);
    this.view.centerLat = clampTilt(this.view.centerLat + dLat);
    if (deltaSeconds > 0) {
      this.spinLng = dLng / deltaSeconds;
      this.spinLat = dLat / deltaSeconds;
    }
  }

  public stopSpin(): void {
    this.spinLng = 0;
    this.spinLat = 0;
  }

  public zoomBy(factor: number): void {
    this.noteActivity();
    if (this.mode === "us") return;
    this.stopTour();
    this.flight = null;
    this.view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.view.zoom * factor));
  }

  public setPointer(worldX: number, worldY: number): void {
    this.pointer = { x: worldX, y: worldY };
    this.hovered = this.featureAtScreen(worldX, worldY);
  }

  public clearPointer(): void {
    this.pointer = null;
    this.hovered = null;
  }

  // Selects whatever is under the point; clicking the ocean clears the selection.
  // In pick mode the click reports its map location instead.
  public clickAt(worldX: number, worldY: number): void {
    this.noteActivity();
    this.stopTour();
    if (this.onPickLocation) {
      const location = this.locationAtScreen(worldX, worldY);
      if (location) this.onPickLocation(location);
      return;
    }
    this.select(this.featureAtScreen(worldX, worldY), false);
  }

  // Swaps in edited travel data, keeping the view and the selection (by id).
  public replaceAtlas(atlas: Atlas): void {
    this.atlas = atlas;
    this.renderer = new GlobeRenderer(atlas);
    for (const inset of this.insets) inset.renderer = new GlobeRenderer(atlas);
    const selectedId = this.selected?.id;
    this.hovered = null;
    this.selected = selectedId ? ([...atlas.countries, ...atlas.states].find((f) => f.id === selectedId) ?? null) : null;
  }

  // Double-click: select and fly there. On the frozen US map a state just stays selected, but another
  // country switches back to the globe so it can be focused.
  public focusAt(worldX: number, worldY: number): void {
    this.noteActivity();
    this.stopTour();
    const feature = this.featureAtScreen(worldX, worldY);
    if (!feature) return;
    if (this.mode === "us" && feature.kind === "country" && !this.atlas.hasStates(feature)) this.setMode("world");
    this.select(feature, true);
  }

  // In US mode the map is frozen, so selecting only highlights; on the globe it also flies there.
  public select(feature: GeoFeature | null, shouldFly = true): void {
    this.selected = feature;
    this.onSelectionChange(feature);
    if (feature && shouldFly && this.mode === "world") this.flyTo(feature.focus.lng, feature.focus.lat, zoomFor(feature));
  }

  // The places that badges, stepping and the tour go through: countries on the globe, states on the US map.
  public get scopePlaces(): readonly Place[] {
    const kind: PlaceKind = this.mode === "us" ? "state" : "country";
    return this.atlas.places.filter((place) => place.kind === kind);
  }

  public stepPlace(delta: number): void {
    this.noteActivity();
    this.stopTour();
    this.moveThroughPlaces(delta);
  }

  public toggleTour(): void {
    this.noteActivity();
    if (this.isTouring) {
      this.stopTour();
      return;
    }
    this.isTouring = true;
    this.onTourChange(true);
    this.moveThroughPlaces(1);
  }

  public stopTour(): void {
    if (!this.isTouring) return;
    this.isTouring = false;
    this.onTourChange(false);
  }

  public setMode(mode: GlobeMode): void {
    this.noteActivity();
    this.stopTour();
    this.stopSpin();
    const changed = mode !== this.mode;
    this.mode = mode;
    this.selected = null;
    this.onSelectionChange(null);
    const target = mode === "us" ? US_VIEW : WORLD_VIEW;
    this.flyTo(target.lng, target.lat, target.zoom);
    if (changed) this.onModeChange(mode);
  }

  public toggleAutoRotate(): void {
    this.autoRotate = !this.autoRotate;
    this.hud.showBanner(`AUTO ROTATE ${this.autoRotate ? "ON" : "OFF"}`);
  }

  public toggleHelp(): void {
    this.hud.toggle();
  }

  public get selectedPlace(): Place | undefined {
    return this.selected ? this.atlas.placeFor(this.selected) : undefined;
  }

  public flyTo(lng: number, lat: number, zoom: number): void {
    this.stopSpin();
    // Take the short way round.
    const fromLng = this.view.centerLng;
    const toLng = fromLng + wrapLongitude(lng - fromLng);
    this.flight = {
      fromLng,
      fromLat: this.view.centerLat,
      fromZoom: this.view.zoom,
      toLng,
      toLat: clampTilt(lat),
      toZoom: zoom,
      seconds: 0,
    };
  }

  private moveThroughPlaces(delta: number): void {
    const places = this.scopePlaces;
    if (places.length === 0) return;
    const current = this.selected ? places.findIndex((place) => place.id === this.selected!.id) : -1;
    const next = current < 0 ? (delta > 0 ? 0 : places.length - 1) : (current + delta + places.length) % places.length;
    this.tourSeconds = 0;
    this.select(places[next]);
  }

  // Which view a screen point falls in: an inset window if it is showing there, otherwise the main globe.
  private locationAtScreen(x: number, y: number): { lng: number; lat: number } | null {
    let view = this.view;
    if (this.insetVisibility > 0) {
      const inset = this.insets.find(({ rect }) => inRect({ x, y }, rect));
      if (inset) view = inset.view;
    }
    return view.unproject(x, y);
  }

  private featureAtScreen(x: number, y: number): GeoFeature | null {
    const location = this.locationAtScreen(x, y);
    return location ? this.atlas.featureAt(location.lng, location.lat) : null;
  }

  // --- Drawing ---------------------------------------------------------------------------------------------

  private drawInsetFrames(displayList: DisplayList): void {
    this.frames.clear();
    this.framePen.begin(this.frames);
    for (const { rect } of this.insets) {
      this.framePen.moveTo(rect.left, rect.top);
      this.framePen.lineTo(rect.right, rect.top);
      this.framePen.lineTo(rect.right, rect.bottom);
      this.framePen.lineTo(rect.left, rect.bottom);
      this.framePen.closePath();
    }
    displayList.setColor(FRAME_COLOR);
    displayList.addShape(this.frames, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.7 * this.insetVisibility });
  }

  private drawInsetLabels(displayList: DisplayList): void {
    if (this.insetVisibility <= 0) return;
    const font = getDemoFont();
    displayList.setColor(FRAME_COLOR);
    for (const { spec, rect } of this.insets) {
      font.addText(displayList, { text: spec.label, x: rect.left + 8, y: rect.top + 8, size: 13, intensity: this.insetVisibility });
    }
  }

  private drawTitleAndTallies(displayList: DisplayList): void {
    const font = getDemoFont();
    displayList.setColor(HUD_TEXT_COLOR);
    font.addText(displayList, { text: fontSafeText(this.atlas.title), x: HUD_MARGIN, y: HUD_MARGIN, size: 28 });
    if (this.atlas.homeBase) {
      displayList.setColor(DIM_COLOR);
      font.addText(displayList, { text: `HOME BASE: ${fontSafeText(this.atlas.homeBase)}`, x: HUD_MARGIN, y: HUD_MARGIN + 46, size: 14 });
    }
    this.drawTally(displayList, "WORLD:", "country", HUD_MARGIN + 82);
    this.drawTally(displayList, "UNITED STATES:", "state", HUD_MARGIN + 110);
  }

  // "WORLD:  VISITED 26  LIVED 1", each status in its own color; statuses with no places are left out.
  private drawTally(displayList: DisplayList, label: string, kind: PlaceKind, y: number): void {
    const font = getDemoFont();
    const size = 16;
    const tally = this.atlas.tally(kind);
    let x = HUD_MARGIN;
    displayList.setColor(DIM_COLOR);
    font.addText(displayList, { text: label, x, y, size });
    x += font.measureText("UNITED STATES:", size).width + 24;
    for (const status of PLACE_STATUSES) {
      if (tally[status] === 0) continue;
      const text = `${status.toUpperCase()} ${tally[status]}`;
      displayList.setColor(STATUS_COLORS[status]);
      font.addText(displayList, { text, x, y, size });
      x += font.measureText(text, size).width + 22;
    }
  }

  // City names beside their markers, wherever the markers are drawn.
  private drawCityLabels(displayList: DisplayList): void {
    const font = getDemoFont();
    const views: { view: GlobeView; inside?: ClipRect }[] = [{ view: this.view }];
    if (this.insetVisibility > 0) views.push(...this.insets.map((inset) => ({ view: inset.view, inside: inset.rect })));
    for (const place of this.atlas.places) {
      for (const { view, inside } of views) {
        if (view.zoom < CITIES_FROM_ZOOM && place !== this.selected) continue;
        for (const city of place.cities) {
          const point = view.project(city.lng, city.lat);
          if (point.depth < 0.05) continue;
          const isUnderWindow = this.insetVisibility > 0 && this.insets.some(({ rect }) => inRect(point, rect));
          if (inside ? !inRect(point, inside) : isUnderWindow) continue;
          displayList.setColor(STATUS_COLORS[city.kind]);
          font.addText(displayList, { text: fontSafeText(city.name), x: point.x + 9, y: point.y - 5, size: 12, intensity: 0.85 });
        }
      }
    }
  }

  // The selected place, top right: name, status, years, cities, linked post.
  private drawDetails(displayList: DisplayList, frame: DemoFrame): void {
    const feature = this.selected;
    if (!feature || !this.showsDetails) return;
    const font = getDemoFont();
    const place = this.atlas.placeFor(feature);
    const right = frame.width - HUD_MARGIN;
    let y = HUD_MARGIN;
    const line = (text: string, size: number, color: BeamColor, gap = 10) => {
      displayList.setColor(color);
      font.addText(displayList, { text: fontSafeText(text), x: right, y, size, alignment: "right" });
      y += size * 1.5 + gap;
    };
    line(feature.name, 24, HUD_TEXT_COLOR, 6);
    if (!place) {
      line(feature.kind === "state" ? "US STATE  NOT YET VISITED" : "NOT YET VISITED", 16, DIM_COLOR);
      return;
    }
    line(place.status === "seen" ? "SEEN (PASSED THROUGH)" : place.status, 18, STATUS_COLORS[place.status]);
    if (place.years.length) line(`YEARS: ${place.years.join(", ")}`, 15, DIM_COLOR);
    for (const city of place.cities.slice(0, 6)) line(`${city.name}  (${city.kind})`, 15, STATUS_COLORS[city.kind], 4);
    if (place.cities.length > 6) line(`+${place.cities.length - 6} MORE CITIES`, 14, DIM_COLOR);
    if (place.postTitle) line(`"${place.postTitle}"`, 15, HUD_TEXT_COLOR, 4);
    if (place.blogPostSlug) line("ENTER  READ THE POST", 14, STATUS_COLORS.want);
    if (this.atlas.hasStates(place) && this.mode === "world") line("U  OPEN THE STATES MAP", 14, STATUS_COLORS.want);
  }

  private drawHoverLabel(displayList: DisplayList): void {
    const feature = this.hovered;
    if (!feature || !this.pointer || feature === this.selected) return;
    const place = this.atlas.placeFor(feature);
    const font = getDemoFont();
    displayList.setColor(place ? STATUS_COLORS[place.status] : DIM_COLOR);
    font.addText(displayList, {
      text: fontSafeText(place ? `${feature.name}: ${place.status}` : feature.name),
      x: this.pointer.x + 18,
      y: this.pointer.y + 14,
      size: 14,
    });
  }

  private advanceFlight(deltaSeconds: number): void {
    const flight = this.flight!;
    flight.seconds += deltaSeconds;
    const progress = Math.min(1, flight.seconds / FLY_SECONDS);
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    // Pull back a little mid-flight on long trips, like a camera rising to cross the globe.
    const distance = Math.hypot(flight.toLng - flight.fromLng, flight.toLat - flight.fromLat);
    const lift = 1 - Math.min(0.45, distance / 300) * Math.sin(Math.PI * progress);
    this.view.centerLng = flight.fromLng + (flight.toLng - flight.fromLng) * eased;
    this.view.centerLat = flight.fromLat + (flight.toLat - flight.fromLat) * eased;
    this.view.zoom = Math.exp(Math.log(flight.fromZoom) + (Math.log(flight.toZoom) - Math.log(flight.fromZoom)) * eased) * lift;
    if (progress >= 1) this.flight = null;
  }
}

// Bigger places need less zoom; tiny islands get a close look.
export function zoomFor(feature: GeoFeature): number {
  const { minLng, maxLng, minLat, maxLat } = feature.focusBounds;
  const span = Math.max(maxLng - minLng, maxLat - minLat, 0.5);
  return Math.max(1.2, Math.min(MAX_ZOOM * 0.85, 55 / span));
}

function inRect(point: { x: number; y: number }, rect: ClipRect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function clampTilt(lat: number): number {
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, lat));
}
