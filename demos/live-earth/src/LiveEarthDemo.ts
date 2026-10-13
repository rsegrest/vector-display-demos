import type { DisplayList } from "@vector-display/core";
import { DemoHud, HUD_TEXT_COLOR, fontSafeText, getDemoFont, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { GlobeView, MAX_ZOOM, MIN_ZOOM } from "@vector-demos/travel-globe/geo";
import type { DataOrigin, DataSet } from "./data/LiveData.js";
import { EarthRenderer, type GroundTrack, type SatelliteMarks } from "./render/EarthRenderer.js";
import type { Quake, TleEntry } from "./sim/feeds.js";
import { Satellite, createSatellites, radiusFactor, type SatellitePosition } from "./sim/orbits.js";
import { wrapLongitude, type LngLat } from "./sim/sphere.js";
import { subsolarPoint } from "./sim/sun.js";

export const LIVE_EARTH_WORLD_HEIGHT = 1000;

export interface TimeRate {
  readonly name: string;
  // Seconds of simulated time per real second.
  readonly rate: number;
}

export const TIME_RATES: readonly TimeRate[] = [
  { name: "REAL TIME", rate: 1 },
  { name: "1 MIN/S", rate: 60 },
  { name: "10 MIN/S", rate: 600 },
  { name: "1 HOUR/S", rate: 3600 },
];

const WEEK_MILLISECONDS = 7 * 24 * 3600 * 1000;
// Earthquakes stay on the globe for a week after they happen.
const QUAKE_LIFETIME_MILLISECONDS = WEEK_MILLISECONDS;
// Degrees of longitude per second that the globe turns when left alone.
const AUTO_SPIN = 2.4;
// Each satellite's tail reaches back to where it was this long ago.
const TAIL_SECONDS = 50;
// The ground track runs from this long ago to this far ahead, in minutes.
const TRACK_BEHIND_MINUTES = 30;
const TRACK_AHEAD_MINUTES = 95;
const TRACK_STEP_MINUTES = 1;
// The track is worked out afresh once the clock has moved this far.
const TRACK_REFRESH_SECONDS = 20;
// How close (world units) the pointer must be to pick something.
const PICK_RADIUS = 26;
const GLOBE_SHARE = 0.36;

const HELP_LINES = [
  "DRAG ROTATE   WHEEL ZOOM   POINT AT A SATELLITE OR EARTHQUAKE FOR DETAILS   I FOLLOW ISS   - + TIME RATE",
  "0 NOW   W REPLAY THE WEEK   S SATELLITES   Q QUAKES   G GRID   D DAY/NIGHT   A SPIN   SPACE PAUSE   H HUD   F FULLSCREEN   ESC MENU",
];

export type Pick = { readonly kind: "satellite"; readonly index: number } | { readonly kind: "quake"; readonly index: number };

export interface LiveEarthOptions {
  // Longitude, latitude pairs, one array per coastline or border.
  readonly coastLines: readonly ArrayLike<number>[];
  // The real time, in milliseconds; a parameter so tests can hold it still.
  readonly clock?: () => number;
}

// A wireframe Earth showing what is actually up there and what has actually
// happened: real satellites placed from their published orbits, the space
// station's path over the ground, the line between day and night, and the past
// week's larger earthquakes. Time can be run faster than real, and the week can be
// replayed, but nothing shown is invented.
export class LiveEarthDemo implements Demo {
  public readonly view = new GlobeView();
  public isPaused = false;
  public autoSpin = true;
  public followStation = false;
  public showSatellites = true;
  public showQuakes = true;
  public showGraticule = true;
  public showTerminator = true;
  public rateIndex = 1;

  private readonly renderer: EarthRenderer;
  private readonly hud = new DemoHud();
  private readonly clock: () => number;
  private readonly position: SatellitePosition = { lng: 0, lat: 0, altitudeKm: 0 };
  private readonly subsolar: LngLat = { lng: 0, lat: 0 };
  private simulatedTime: number;
  private wallSeconds = 0;
  private satellites: Satellite[] = [];
  private marks: SatelliteMarks | null = null;
  private station: Satellite | null = null;
  private track: GroundTrack | null = null;
  private trackTime = Number.NaN;
  private quakes: Quake[] = [];
  private visibleQuakes: Quake[] = [];
  private satelliteOrigin: { origin: DataOrigin; at: number } | null = null;
  private quakeOrigin: { origin: DataOrigin; at: number } | null = null;
  private pointer: { x: number; y: number } | null = null;
  private picked: Pick | null = null;
  private screenWidth = 1778;
  private screenHeight = LIVE_EARTH_WORLD_HEIGHT;
  private segmentCount = 0;

  public constructor(options: LiveEarthOptions) {
    this.clock = options.clock ?? (() => Date.now());
    this.simulatedTime = this.clock();
    this.renderer = new EarthRenderer(options.coastLines);
    this.view.centerLat = 18;
    this.resize(this.screenWidth, this.screenHeight);
    this.hud.showBanner("LIVE EARTH");
  }

  // The moment being shown, in milliseconds.
  public get time(): number {
    return this.simulatedTime;
  }

  public get satelliteCount(): number {
    return this.satellites.length;
  }

  // Earthquakes on the globe at the moment being shown.
  public get shownQuakes(): readonly Quake[] {
    return this.visibleQuakes;
  }

  public get pickedItem(): Pick | null {
    return this.picked;
  }

  public get stationName(): string | null {
    return this.station?.name ?? null;
  }

  public resize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
    this.view.setScreen({ centerX: width / 2, centerY: height / 2, radius: Math.min(width, height) * GLOBE_SHARE });
  }

  public setSatellites(data: DataSet<TleEntry[]>): void {
    this.satellites = createSatellites(data.items);
    this.satelliteOrigin = { origin: data.origin, at: data.fetchedAtMilliseconds };
    const count = this.satellites.length;
    // The first list is the space stations; everything sharing the ISS's orbit is part of it.
    this.station = this.satellites.find((satellite) => satellite.name.startsWith("ISS")) ?? this.satellites[0] ?? null;
    this.marks = {
      count,
      lng: new Float32Array(count),
      lat: new Float32Array(count),
      radius: new Float32Array(count),
      tailLng: new Float32Array(count),
      tailLat: new Float32Array(count),
      tailRadius: new Float32Array(count),
      valid: new Uint8Array(count),
      isStation: Uint8Array.from(this.satellites, (satellite) => (isStationName(satellite.name) ? 1 : 0)),
    };
    this.trackTime = Number.NaN;
    this.picked = null;
    this.placeSatellites();
  }

  public setQuakes(data: DataSet<Quake[]>): void {
    this.quakes = [...data.items].sort((first, second) => first.timeMilliseconds - second.timeMilliseconds);
    this.quakeOrigin = { origin: data.origin, at: data.fetchedAtMilliseconds };
    this.picked = null;
    this.selectQuakes();
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    this.wallSeconds += deltaSeconds;
    if (!this.isPaused) this.simulatedTime += deltaSeconds * 1000 * TIME_RATES[this.rateIndex].rate;
    this.placeSatellites();
    this.selectQuakes();
    subsolarPoint(this.simulatedTime, this.subsolar);

    if (this.followStation && this.track) {
      // Ease the view round to keep the station in the middle.
      const ease = 1 - Math.exp(-3 * deltaSeconds);
      this.view.centerLng = wrapLongitude(this.view.centerLng + wrapLongitude(this.track.lng - this.view.centerLng) * ease);
      this.view.centerLat += (this.track.lat - this.view.centerLat) * ease;
    } else if (this.autoSpin && !this.isPaused) {
      this.view.centerLng = wrapLongitude(this.view.centerLng + AUTO_SPIN * deltaSeconds);
    }
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    this.segmentCount = this.renderer.draw(
      displayList,
      this.view,
      { width: frame.width, height: frame.height },
      {
        timeMilliseconds: this.simulatedTime,
        wallSeconds: this.wallSeconds,
        satellites: this.showSatellites ? this.marks : null,
        track: this.showSatellites ? this.track : null,
        quakes: this.showQuakes ? this.visibleQuakes : [],
        subsolar: this.subsolar,
        showGraticule: this.showGraticule,
        showTerminator: this.showTerminator,
        highlight: this.pickedScreenPosition(),
      },
    );
    // Picking uses the positions just drawn.
    this.picked = this.pointer ? this.pickAt(this.pointer.x, this.pointer.y) : null;
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    this.drawLabels(displayList);
    this.hud.draw(displayList, {
      title: "LIVE EARTH",
      statusLines: [
        `${formatUtc(this.simulatedTime)} UTC  ${TIME_RATES[this.rateIndex].name}  ${this.describeOffset()}${this.isPaused ? "  PAUSED" : ""}`,
        `SATELLITES ${this.satellites.length} ${this.describeOrigin(this.satelliteOrigin)}   QUAKES ${this.visibleQuakes.length} ${this.describeOrigin(this.quakeOrigin)}`,
        this.describePicked() ?? `SEGMENTS ${this.segmentCount}${this.followStation ? "  FOLLOWING ISS" : ""}`,
      ],
      helpLines: HELP_LINES,
      width: frame.width,
      height: frame.height,
      scale: frame.height / 1000,
    });
  }

  // --- Actions -------------------------------------------------------------------------------------------

  public noteActivity(): void {
    this.hud.noteActivity();
  }

  public toggleHud(): void {
    this.hud.toggle();
  }

  public togglePause(): void {
    this.isPaused = !this.isPaused;
  }

  public changeRate(delta: number): void {
    this.rateIndex = Math.max(0, Math.min(TIME_RATES.length - 1, this.rateIndex + delta));
    this.hud.showBanner(TIME_RATES[this.rateIndex].name);
  }

  // Back to the present moment.
  public goToNow(): void {
    this.simulatedTime = this.clock();
    this.trackTime = Number.NaN;
    this.hud.showBanner("NOW");
  }

  // Winds the clock back a week and plays it forward an hour a second, so the
  // week's earthquakes appear in the order they happened.
  public replayWeek(): void {
    this.simulatedTime = this.clock() - WEEK_MILLISECONDS;
    this.rateIndex = TIME_RATES.length - 1;
    this.trackTime = Number.NaN;
    this.hud.showBanner("REPLAYING THE WEEK");
  }

  public toggleFollow(): void {
    this.followStation = !this.followStation && this.station !== null;
    this.hud.showBanner(this.followStation ? "FOLLOWING ISS" : "FREE VIEW");
  }

  public toggleSpin(): void {
    this.autoSpin = !this.autoSpin;
    this.hud.showBanner(`SPIN ${this.autoSpin ? "ON" : "OFF"}`);
  }

  public toggleSatellites(): void {
    this.showSatellites = !this.showSatellites;
    this.hud.showBanner(`SATELLITES ${this.showSatellites ? "ON" : "OFF"}`);
  }

  public toggleQuakes(): void {
    this.showQuakes = !this.showQuakes;
    this.hud.showBanner(`EARTHQUAKES ${this.showQuakes ? "ON" : "OFF"}`);
  }

  public toggleGraticule(): void {
    this.showGraticule = !this.showGraticule;
    this.hud.showBanner(`GRID ${this.showGraticule ? "ON" : "OFF"}`);
  }

  public toggleTerminator(): void {
    this.showTerminator = !this.showTerminator;
    this.hud.showBanner(`DAY/NIGHT LINE ${this.showTerminator ? "ON" : "OFF"}`);
  }

  // Turns the globe by hand; that also stops it spinning or following by itself.
  public dragBy(deltaX: number, deltaY: number): void {
    this.autoSpin = false;
    this.followStation = false;
    const degreesPerUnit = 90 / this.view.radius;
    this.view.centerLng = wrapLongitude(this.view.centerLng - deltaX * degreesPerUnit);
    this.view.centerLat = Math.max(-85, Math.min(85, this.view.centerLat + deltaY * degreesPerUnit));
  }

  public zoomBy(factor: number): void {
    this.view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM / 2, this.view.zoom * factor));
  }

  // Where the pointer is (world units), or null when it has left; whatever is under it is picked.
  public setPointer(x: number | null, y = 0): void {
    this.pointer = x === null ? null : { x, y };
    if (x === null) this.picked = null;
  }

  // The nearest satellite or earthquake to a screen position, if any is close.
  public pickAt(x: number, y: number): Pick | null {
    let best: Pick | null = null;
    let bestDistance = PICK_RADIUS;
    const consider = (screen: Float32Array, count: number, kind: Pick["kind"]): void => {
      for (let index = 0; index < count; index++) {
        if (!screen[index * 3 + 2]) continue;
        const distance = Math.hypot(screen[index * 3] - x, screen[index * 3 + 1] - y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { kind, index };
        }
      }
    };
    if (this.showQuakes) consider(this.renderer.quakeScreen, this.visibleQuakes.length, "quake");
    if (this.showSatellites && this.marks) consider(this.renderer.satelliteScreen, this.marks.count, "satellite");
    return best;
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private placeSatellites(): void {
    const marks = this.marks;
    if (!marks) return;
    const { position } = this;
    this.satellites.forEach((satellite, index) => {
      const placed = satellite.locate(this.simulatedTime, position);
      marks.valid[index] = placed ? 1 : 0;
      if (!placed) return;
      marks.lng[index] = position.lng;
      marks.lat[index] = position.lat;
      marks.radius[index] = radiusFactor(position.altitudeKm);
      if (satellite.locate(this.simulatedTime - TAIL_SECONDS * 1000, position)) {
        marks.tailLng[index] = position.lng;
        marks.tailLat[index] = position.lat;
        marks.tailRadius[index] = radiusFactor(position.altitudeKm);
      } else {
        marks.tailLng[index] = marks.lng[index];
        marks.tailLat[index] = marks.lat[index];
        marks.tailRadius[index] = marks.radius[index];
      }
    });
    this.updateTrack();
  }

  // The station's path over the ground, redone as the clock moves on; its own
  // position is refreshed every frame.
  private updateTrack(): void {
    const station = this.station;
    if (!station) {
      this.track = null;
      return;
    }
    const { position } = this;
    if (!station.locate(this.simulatedTime, position)) {
      this.track = null;
      return;
    }
    const here = { lng: position.lng, lat: position.lat, radius: radiusFactor(position.altitudeKm) };
    const isStale = !(Math.abs(this.simulatedTime - this.trackTime) < TRACK_REFRESH_SECONDS * 1000);
    if (this.track && !isStale) {
      this.track = { ...this.track, ...here };
      return;
    }
    const steps = Math.floor((TRACK_BEHIND_MINUTES + TRACK_AHEAD_MINUTES) / TRACK_STEP_MINUTES) + 1;
    const points = new Float32Array(steps * 2);
    let count = 0;
    for (let step = 0; step < steps; step++) {
      const minutes = -TRACK_BEHIND_MINUTES + step * TRACK_STEP_MINUTES;
      if (!station.locate(this.simulatedTime + minutes * 60000, position)) continue;
      points[count * 2] = position.lng;
      points[count * 2 + 1] = position.lat;
      count++;
    }
    this.trackTime = this.simulatedTime;
    this.track = { points, count, nowIndex: Math.min(count - 1, Math.round(TRACK_BEHIND_MINUTES / TRACK_STEP_MINUTES)), ...here };
  }

  // The earthquakes that have happened by the moment shown, and not more than a week before it.
  private selectQuakes(): void {
    this.visibleQuakes = this.quakes.filter((quake) => {
      const age = this.simulatedTime - quake.timeMilliseconds;
      return age >= 0 && age <= QUAKE_LIFETIME_MILLISECONDS;
    });
  }

  private pickedScreenPosition(): { x: number; y: number } | null {
    const picked = this.picked;
    if (!picked) return null;
    const screen = picked.kind === "quake" ? this.renderer.quakeScreen : this.renderer.satelliteScreen;
    if (picked.index * 3 + 2 >= screen.length || !screen[picked.index * 3 + 2]) return null;
    return { x: screen[picked.index * 3], y: screen[picked.index * 3 + 1] };
  }

  // Names beside the space stations, drawn crisp above the phosphor.
  private drawLabels(displayList: DisplayList): void {
    const marks = this.marks;
    if (!marks || !this.showSatellites) return;
    const font = getDemoFont();
    const screen = this.renderer.satelliteScreen;
    displayList.setColor(HUD_TEXT_COLOR);
    const labelled = new Set<string>();
    this.satellites.forEach((satellite, index) => {
      const label = stationLabel(satellite.name);
      if (!label || labelled.has(label) || !screen[index * 3 + 2]) return;
      labelled.add(label);
      font.addText(displayList, { text: label, x: screen[index * 3] + 14, y: screen[index * 3 + 1] - 22, size: 15, intensity: 0.9 });
    });
  }

  private describeOrigin(source: { origin: DataOrigin; at: number } | null): string {
    if (!source) return "LOADING";
    if (source.origin === "LIVE") return "LIVE";
    return `${source.origin} ${formatUtc(source.at).slice(0, 10)}`;
  }

  // How far the moment shown is from the present.
  private describeOffset(): string {
    const hours = (this.simulatedTime - this.clock()) / 3600000;
    if (Math.abs(hours) < 1 / 60) return "NOW";
    const size = Math.abs(hours) >= 48 ? `${(Math.abs(hours) / 24).toFixed(1)} DAYS` : `${Math.abs(hours).toFixed(1)} HOURS`;
    return hours < 0 ? `${size} AGO` : `${size} AHEAD`;
  }

  private describePicked(): string | null {
    const picked = this.picked;
    if (!picked) return null;
    if (picked.kind === "quake") {
      const quake = this.visibleQuakes[picked.index];
      if (!quake) return null;
      const hours = (this.simulatedTime - quake.timeMilliseconds) / 3600000;
      const age = hours >= 48 ? `${(hours / 24).toFixed(1)} DAYS AGO` : `${hours.toFixed(1)} HOURS AGO`;
      return fontSafeText(`M${quake.magnitude.toFixed(1)}  ${quake.place.toUpperCase()}  DEPTH ${Math.round(quake.depthKm)} KM  ${age}`);
    }
    const satellite = this.satellites[picked.index];
    const marks = this.marks;
    if (!satellite || !marks) return null;
    const altitude = Math.round((marks.radius[picked.index] - 1) * 6371);
    return fontSafeText(
      `${satellite.name.toUpperCase()}  ALTITUDE ${altitude} KM  ORBIT ${satellite.periodMinutes.toFixed(1)} MIN  OVER ${formatLatitude(marks.lat[picked.index])} ${formatLongitude(marks.lng[picked.index])}`,
    );
  }
}

// The stations worth naming on the globe, by the names their main modules carry in the feed.
function stationLabel(name: string): string | null {
  if (name.startsWith("ISS (ZARYA)")) return "ISS";
  if (name.startsWith("CSS (TIANHE)")) return "TIANGONG";
  return null;
}

function isStationName(name: string): boolean {
  return stationLabel(name) !== null;
}

export function formatUtc(timeMilliseconds: number): string {
  return new Date(timeMilliseconds).toISOString().slice(0, 19).replace("T", " ");
}

function formatLatitude(lat: number): string {
  return `${Math.abs(lat).toFixed(1)}${lat >= 0 ? "N" : "S"}`;
}

function formatLongitude(lng: number): string {
  return `${Math.abs(lng).toFixed(1)}${lng >= 0 ? "E" : "W"}`;
}
