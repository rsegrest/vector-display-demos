import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, DynamicGeometry, getDemoFont, glyphStrokes, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { equatorialVector, localSiderealTime, skyRotation, type Place } from "./sim/astronomy.js";
import { altitudeForHorizonAt, horizonScreenShare, MAXIMUM_FIELD_OF_VIEW, MINIMUM_FIELD_OF_VIEW, Projector, type View } from "./sim/projection.js";
import { SKY, type SkyPoint } from "./sim/sky.js";
import { moonPhaseAt, solarSystemAt, sunsetDuring, type MoonPhase, type SolarBody, type Sunset } from "./sim/solarSystem.js";

export const STAR_MAP_WORLD_HEIGHT = 1000;
// Where the horizon starts on the screen: this share of the way from the middle to the bottom edge,
// so the sky fills almost all of it.
export const STARTING_HORIZON_SHARE = 0.84;
const STARTING_FIELD_OF_VIEW = 90;

// How fast the sky's clock runs, from real time up to an hour a second.
export const TIME_RATES: readonly { readonly name: string; readonly secondsPerSecond: number }[] = [
  { name: "REAL TIME", secondsPerSecond: 1 },
  { name: "1 MIN/S", secondsPerSecond: 60 },
  { name: "10 MIN/S", secondsPerSecond: 600 },
  { name: "1 HOUR/S", secondsPerSecond: 3600 },
];

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const DEGREES = Math.PI / 180;
// Arcs are drawn as straight pieces no longer than this many degrees, so they curve as they should.
const ARC_STEP = 3;

// Star colors by B-V color index, from blue-white to orange-red.
const STAR_COLORS: readonly { readonly upTo: number; readonly color: BeamColor }[] = [
  { upTo: 0, color: { red: 0.7, green: 0.82, blue: 1 } },
  { upTo: 0.4, color: { red: 0.92, green: 0.95, blue: 1 } },
  { upTo: 0.8, color: { red: 1, green: 0.96, blue: 0.82 } },
  { upTo: 1.3, color: { red: 1, green: 0.84, blue: 0.6 } },
  { upTo: Infinity, color: { red: 1, green: 0.68, blue: 0.48 } },
];
// Brightness steps the stars are batched into, brightest first.
const BRIGHTNESS_STEPS = 6;
const LINE_COLOR: BeamColor = { red: 0.35, green: 0.6, blue: 1 };
const MILKY_WAY_COLOR: BeamColor = { red: 0.55, green: 0.55, blue: 0.75 };
const HORIZON_COLOR: BeamColor = { red: 0.4, green: 1, blue: 0.6 };
const GRID_COLOR: BeamColor = { red: 0.3, green: 0.45, blue: 0.55 };
const COMPASS_COLOR: BeamColor = { red: 1, green: 0.8, blue: 0.35 };
const NAME_COLOR: BeamColor = { red: 0.55, green: 0.75, blue: 1 };

const HELP_LINES = [
  "DRAG OR ARROWS LOOK AROUND   WHEEL OR - + ZOOM   , . TIME SPEED   0 NOW",
  "P SUN MOON PLANETS   L LINES   K NAMES   M MILKY WAY   G GRID   B GROUND   H HUD   F FULLSCREEN   ESC MENU",
];
// The Sun's and Moon's real size across, in degrees; drawn no smaller than MINIMUM_DISC_RADIUS.
const SUN_DIAMETER = 0.53;
const MOON_DIAMETER = 0.52;
const MINIMUM_DISC_RADIUS = 9;
// The solar system is worked out again when the sky's clock has moved this many seconds.
const SOLAR_SYSTEM_SECONDS = 30;

interface Star {
  readonly vector: readonly [number, number, number];
  readonly magnitude: number;
  readonly colorIndex: number;
}

interface Batch {
  readonly geometry: DynamicGeometry;
  readonly color: BeamColor;
  intensity: number;
}

// The sky as a headset draws it (Vector OS VR's Picture3d): line ends x, y, z and, per line,
// r, g, b and brightness; spread 1 and drop 0 make it a sphere around the eye.
export interface SkyPicture3d {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly spread: number;
  readonly drop: number;
}

export interface ClockZone {
  // Minutes ahead of UTC.
  readonly offsetMinutes: number;
  // Whether it is this browser's own zone (otherwise an estimate for the place).
  readonly isBrowsers: boolean;
}

// The time in a zone, as the overlay shows it: "OCT 31, 2026, 11:00 PM", with "(APPROX. TIME THERE)"
// when the zone is an estimate for a faraway place.
export function formatClock(time: Date, zone: ClockZone): string {
  const shifted = new Date(time.getTime() + zone.offsetMinutes * 60_000);
  const text = shifted.toLocaleString(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase();
  return zone.isBrowsers ? text : `${text} (APPROX. TIME THERE)`;
}

// Midnight beginning the day `time` falls in, in the zone.
export function startOfDay(time: Date, zone: ClockZone): Date {
  const offset = zone.offsetMinutes * 60_000;
  return new Date(Math.floor((time.getTime() + offset) / 86_400_000) * 86_400_000 - offset);
}

function formatTimeOfDay(time: Date, zone: ClockZone): string {
  const shifted = new Date(time.getTime() + zone.offsetMinutes * 60_000);
  return shifted.toLocaleTimeString(undefined, { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).toUpperCase();
}

export interface StarMapOptions {
  readonly place: Place;
  // Where the place is, in words, for the overlay ("Chicago", "your location").
  readonly placeName: string;
  // The clock: real time unless a test pins it.
  readonly now?: () => Date;
}

function starColorIndex(colorIndex: number): number {
  return STAR_COLORS.findIndex((band) => colorIndex <= band.upTo);
}

// How bright a star of this magnitude is drawn, before zooming in brightens the faint ones.
function starIntensity(magnitude: number): number {
  return Math.max(0.12, 2.2 * 10 ** (-0.17 * (magnitude + 1.4)));
}

function compassName(azimuth: number): string {
  return COMPASS_POINTS[Math.round(azimuth / 45) % 8];
}

// The night sky from a place on Earth at a moment, with the stars as the beam's dots: brighter and
// bluer or redder as the real stars are, constellation stick figures, the Milky Way's outline, the
// horizon with the compass points, and the names of the brightest stars and the constellations. You
// look around by dragging and zoom with the wheel; the clock runs live, or faster to watch the sky turn.
export class StarMapDemo implements Demo {
  public view: View = { azimuth: 180, altitude: altitudeForHorizonAt(STARTING_HORIZON_SHARE, STARTING_FIELD_OF_VIEW), fieldOfView: STARTING_FIELD_OF_VIEW };
  public place: Place;
  public placeName: string;
  public timeRateIndex = 0;
  public showLines = true;
  public showNames = true;
  public showMilkyWay = true;
  public showGrid = false;
  // With the ground on, what is below the horizon is hidden, as it would be outdoors.
  public showGround = true;
  public showSolarSystem = true;

  private readonly hud = new DemoHud();
  private readonly projector = new Projector();
  private readonly now: () => Date;
  private readonly stars: Star[];
  // Every star's place in the horizon frame this frame, and on the screen.
  private readonly horizon: Float64Array;
  private readonly screen: Float64Array;
  private readonly visible: Uint8Array;
  private readonly starBatches: Batch[] = [];
  private readonly lines = new DynamicGeometry(1024);
  private readonly milkyWay = new DynamicGeometry(2048);
  private readonly horizonLine = new DynamicGeometry(256);
  private readonly grid = new DynamicGeometry(1024);
  // Seconds the sky's clock is ahead of (or behind) the real one.
  private timeOffsetSeconds = 0;
  private width = 1778;
  private height = STAR_MAP_WORLD_HEIGHT;
  private rotation: ArrayLike<number> = new Float64Array(9);
  private readonly scratch = new Float64Array(4);
  private readonly bodies = new DynamicGeometry(512);
  private solarSystem: { bodies: SolarBody[]; moon: MoonPhase; time: number; place: Place } | null = null;
  // The bodies' places this frame, for their names on the overlay.
  private readonly bodyLabels: { name: string; x: number; y: number; radius: number; color: BeamColor }[] = [];
  // The modeled day's sunset, worked out once per day and place.
  private sunset: { sunset: Sunset; dayStart: number; place: Place } | null = null;
  // How bright the night sky is drawn: 1 at night, less in twilight and daylight.
  private skyDarkness = 1;

  public constructor(options: StarMapOptions) {
    this.place = options.place;
    this.placeName = options.placeName;
    this.now = options.now ?? (() => new Date());
    this.stars = SKY.stars.map(([rightAscension, declination, magnitude, colorIndex]) => ({
      vector: equatorialVector(rightAscension, declination),
      magnitude,
      colorIndex,
    }));
    this.horizon = new Float64Array(this.stars.length * 3);
    this.screen = new Float64Array(this.stars.length * 2);
    this.visible = new Uint8Array(this.stars.length);
    for (const band of STAR_COLORS) {
      for (let step = 0; step < BRIGHTNESS_STEPS; step++) this.starBatches.push({ geometry: new DynamicGeometry(256), color: band.color, intensity: 0 });
    }
    this.hud.showBanner("STAR MAP");
  }

  // The moment the sky shows.
  public get time(): Date {
    return new Date(this.now().getTime() + this.timeOffsetSeconds * 1000);
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    // Faster than real time, the clock runs ahead by the difference.
    this.timeOffsetSeconds += deltaSeconds * (TIME_RATES[this.timeRateIndex].secondsPerSecond - 1);
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    this.width = frame.width;
    this.height = frame.height;
    this.projector.set(this.view, frame.width, frame.height);
    this.rotation = skyRotation(this.place, localSiderealTime(this.time, this.place.longitude)).matrix;
    this.updateSolarSystem();
    this.placeStars();

    if (this.showMilkyWay) this.drawMilkyWay(displayList);
    if (this.showGrid) this.drawGrid(displayList);
    if (this.showLines) this.drawConstellationLines(displayList);
    this.drawStars(displayList);
    if (this.showSolarSystem) this.drawSolarSystem(displayList);
    this.drawHorizon(displayList);
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const scale = frame.height / 1000;
    this.drawCompass(displayList, scale);
    if (this.showNames) this.drawNames(displayList, scale);
    if (this.showSolarSystem) {
      for (const { name, x, y, radius, color } of this.bodyLabels) {
        displayList.setColor(color);
        // Past the body's edge, up and to the right of it.
        getDemoFont().addText(displayList, { text: name.toUpperCase(), x: x + radius + 6 * scale, y: y - radius - 12 * scale, size: 10 * scale, intensity: 0.75 });
      }
    }
    const zone = this.clockZone();
    const clock = `${formatClock(this.time, zone)}  ${this.sunsetText(zone)}`;
    this.hud.draw(displayList, {
      title: "STAR MAP",
      statusLines: [
        `${this.placeName.toUpperCase()}  ${formatLatitude(this.place.latitude)} ${formatLongitude(this.place.longitude)}  ${clock}  ${TIME_RATES[this.timeRateIndex].name}`,
        `LOOKING ${compassName(this.view.azimuth)} ${Math.round(this.view.azimuth)}°  UP ${Math.round(this.view.altitude)}°  FIELD ${Math.round(this.view.fieldOfView)}°  ${this.skyCondition()}  MOON ${this.solarSystem?.moon.name.toUpperCase() ?? ""}`,
      ],
      helpLines: HELP_LINES,
      width: frame.width,
      height: frame.height,
      scale,
    });
  }

  // --- Actions ---------------------------------------------------------------------------------------

  public noteActivity(): void {
    this.hud.noteActivity();
  }

  public toggleHud(): void {
    this.hud.toggle();
  }

  // Turns the view by these many degrees: right and up positive. Straight up and straight down are as far as it tips.
  public look(rightDegrees: number, upDegrees: number): void {
    this.view = {
      ...this.view,
      azimuth: (((this.view.azimuth + rightDegrees) % 360) + 360) % 360,
      altitude: Math.max(-90, Math.min(90, this.view.altitude + upDegrees)),
    };
  }

  // A drag across the screen of this many screen units turns the sky with it.
  public drag(deltaX: number, deltaY: number): void {
    const perDegree = this.projector.unitsPerDegree || 1;
    this.look(-deltaX / perDegree, deltaY / perDegree);
  }

  // Zooms by a factor: below 1 zooms in (a narrower field of view).
  // While the horizon is on the screen it stays where it is on the screen, so zooming out does not
  // lift it toward the middle; looking higher up, the zoom is about the middle of the screen.
  public zoom(factor: number): void {
    const fieldOfView = Math.max(MINIMUM_FIELD_OF_VIEW, Math.min(MAXIMUM_FIELD_OF_VIEW, this.view.fieldOfView * factor));
    const share = horizonScreenShare(this.view.altitude, this.view.fieldOfView);
    const altitude = share > 0 && share <= 1 ? Math.min(90, altitudeForHorizonAt(share, fieldOfView)) : this.view.altitude;
    this.view = { ...this.view, fieldOfView, altitude };
  }

  public changeTimeRate(delta: number): void {
    this.timeRateIndex = Math.max(0, Math.min(TIME_RATES.length - 1, this.timeRateIndex + delta));
    this.hud.showBanner(TIME_RATES[this.timeRateIndex].name);
  }

  // The time zone the clock is shown in: this browser's, when the place is within an hour of it;
  // otherwise the place's own, estimated from its longitude (15 degrees an hour), since the sky is
  // read by the time there.
  public clockZone(): ClockZone {
    const browserMinutes = -this.time.getTimezoneOffset();
    const placeMinutes = Math.round(this.place.longitude / 15) * 60;
    if (Math.abs(placeMinutes - browserMinutes) <= 60) return { offsetMinutes: browserMinutes, isBrowsers: true };
    return { offsetMinutes: placeMinutes, isBrowsers: false };
  }

  // "SUNSET 6:01 PM" for the day the clock is in, read in the clock's zone.
  public sunsetText(zone: ClockZone): string {
    const dayStart = startOfDay(this.time, zone);
    if (!this.sunset || this.sunset.dayStart !== dayStart.getTime() || this.sunset.place !== this.place) {
      this.sunset = { sunset: sunsetDuring(dayStart, this.place), dayStart: dayStart.getTime(), place: this.place };
    }
    const { sunset } = this.sunset;
    if (sunset.time === null) return sunset.sunStaysUp ? "SUN DOES NOT SET" : "SUN DOES NOT RISE";
    return `SUNSET ${formatTimeOfDay(sunset.time, zone)}`;
  }

  // Shows the sky at this moment; the clock then runs on from it at the current speed.
  public setTime(time: Date): void {
    this.timeOffsetSeconds = (time.getTime() - this.now().getTime()) / 1000;
  }

  public returnToNow(): void {
    this.timeOffsetSeconds = 0;
    this.timeRateIndex = 0;
    this.hud.showBanner("NOW");
  }

  public setPlace(place: Place, placeName: string): void {
    this.place = place;
    this.placeName = placeName;
    this.hud.showBanner(placeName.toUpperCase());
  }

  public toggle(what: "lines" | "names" | "milkyWay" | "grid" | "ground" | "solarSystem"): void {
    if (what === "solarSystem") {
      this.showSolarSystem = !this.showSolarSystem;
      this.hud.showBanner(`SUN, MOON AND PLANETS ${this.showSolarSystem ? "ON" : "OFF"}`);
      return;
    }
    const banners = { lines: "CONSTELLATION LINES", names: "NAMES", milkyWay: "MILKY WAY", grid: "GRID", ground: "GROUND" };
    if (what === "lines") this.showLines = !this.showLines;
    if (what === "names") this.showNames = !this.showNames;
    if (what === "milkyWay") this.showMilkyWay = !this.showMilkyWay;
    if (what === "grid") this.showGrid = !this.showGrid;
    if (what === "ground") this.showGround = !this.showGround;
    const isOn = { lines: this.showLines, names: this.showNames, milkyWay: this.showMilkyWay, grid: this.showGrid, ground: this.showGround }[what];
    this.hud.showBanner(`${banners[what]} ${isOn ? "ON" : "OFF"}`);
  }

  // --- Drawing ---------------------------------------------------------------------------------------

  // Every star turned into the horizon frame and projected; visible[i] says whether it is drawn.
  private placeStars(): void {
    const matrix = this.rotation;
    this.stars.forEach((star, index) => {
      const [x, y, z] = star.vector;
      const east = matrix[0] * x + matrix[1] * y + matrix[2] * z;
      const north = matrix[3] * x + matrix[4] * y + matrix[5] * z;
      const up = matrix[6] * x + matrix[7] * y + matrix[8] * z;
      this.horizon[index * 3] = east;
      this.horizon[index * 3 + 1] = north;
      this.horizon[index * 3 + 2] = up;
      const onScreen = (!this.showGround || up > 0) && this.projector.project(east, north, up, this.screen, index * 2);
      this.visible[index] = onScreen && this.isInsideScreen(this.screen[index * 2], this.screen[index * 2 + 1], 20) ? 1 : 0;
    });
  }

  private isInsideScreen(x: number, y: number, margin: number): boolean {
    return x > -margin && x < this.width + margin && y > -margin && y < this.height + margin;
  }

  private drawStars(displayList: DisplayList): void {
    // Zoomed in, the faint stars are brightened, as a telescope gathers more light.
    const zoomGain = Math.min(2.2, (90 / this.view.fieldOfView) ** 0.35);
    for (const batch of this.starBatches) batch.geometry.clear();
    this.stars.forEach((star, index) => {
      if (!this.visible[index]) return;
      const intensity = Math.min(2.4, starIntensity(star.magnitude) * zoomGain * this.skyDarkness);
      // Batched by color and by brightness in steps.
      const step = Math.min(BRIGHTNESS_STEPS - 1, Math.max(0, Math.floor((1 - intensity / 2.4) * BRIGHTNESS_STEPS)));
      const batch = this.starBatches[starColorIndex(star.colorIndex) * BRIGHTNESS_STEPS + step];
      batch.intensity = 2.4 * (1 - (step + 0.5) / BRIGHTNESS_STEPS);
      const x = this.screen[index * 2];
      const y = this.screen[index * 2 + 1];
      // A dot; the brightest stars get a small ring around it too.
      batch.geometry.addSegment(x, y, x, y);
      if (star.magnitude < 1.5) {
        const radius = (1.5 - star.magnitude) * 1.6 + 1.5;
        batch.geometry.moveTo(x + radius, y);
        for (let side = 1; side < 10; side++) batch.geometry.lineTo(x + radius * Math.cos((side / 10) * 2 * Math.PI), y + radius * Math.sin((side / 10) * 2 * Math.PI));
        batch.geometry.closePath();
      }
    });
    for (const { geometry, color, intensity } of this.starBatches) {
      if (geometry.segmentCount === 0) continue;
      displayList.setColor(color);
      displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity });
    }
  }

  private drawConstellationLines(displayList: DisplayList): void {
    this.lines.clear();
    for (const constellation of SKY.constellations) {
      for (const line of constellation.lines) this.addSkyPath(this.lines, line);
    }
    displayList.setColor(LINE_COLOR);
    displayList.addShape(this.lines, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.35 });
  }

  private drawMilkyWay(displayList: DisplayList): void {
    this.milkyWay.clear();
    for (const ring of SKY.milkyWay) this.addSkyPath(this.milkyWay, [...ring.points, ring.points[0]]);
    displayList.setColor(MILKY_WAY_COLOR);
    displayList.addShape(this.milkyWay, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.16 * this.skyDarkness });
  }

  // A path through points given as right ascension and declination, each piece broken into arcs of
  // ARC_STEP or less so it curves as it should, and lifted where it goes out of sight (behind the
  // viewer, below the ground, far off the screen).
  private addSkyPath(geometry: DynamicGeometry, points: readonly SkyPoint[]): void {
    let isDrawing = false;
    for (const [east, north, up] of this.skyArc(points)) {
      const isVisible =
        (!this.showGround || up > -0.002) && this.projector.project(east, north, up, this.scratch, 0) && this.isInsideScreen(this.scratch[0], this.scratch[1], this.width);
      if (!isVisible) {
        isDrawing = false;
        continue;
      }
      if (isDrawing) geometry.lineTo(this.scratch[0], this.scratch[1]);
      else geometry.moveTo(this.scratch[0], this.scratch[1]);
      isDrawing = true;
    }
  }

  // The points of a path given as right ascension and declination, with arcs of ARC_STEP or less
  // between them, as horizon-frame unit vectors [east, north, up].
  private skyArc(points: readonly SkyPoint[]): [number, number, number][] {
    const along: [number, number, number][] = [this.toHorizon(points[0][0], points[0][1])];
    for (let index = 1; index < points.length; index++) {
      const [fromRa, fromDec] = points[index - 1];
      const [toRa, toDec] = points[index];
      // The shorter way round in right ascension.
      const deltaRa = ((((toRa - fromRa) % 360) + 540) % 360) - 180;
      const steps = Math.max(1, Math.ceil(angularDistance(points[index - 1], points[index]) / ARC_STEP));
      for (let step = 1; step <= steps; step++) along.push(this.toHorizon(fromRa + (deltaRa * step) / steps, fromDec + ((toDec - fromDec) * step) / steps));
    }
    return along;
  }

  // A path through points given as altitude and azimuth (the horizon, the grid).
  private addHorizonPath(geometry: DynamicGeometry, points: readonly (readonly [number, number])[]): void {
    let isDrawing = false;
    for (const [altitude, azimuth] of points) {
      const east = Math.cos(altitude * DEGREES) * Math.sin(azimuth * DEGREES);
      const north = Math.cos(altitude * DEGREES) * Math.cos(azimuth * DEGREES);
      const up = Math.sin(altitude * DEGREES);
      if (!this.projector.project(east, north, up, this.scratch, 0) || !this.isInsideScreen(this.scratch[0], this.scratch[1], this.width)) {
        isDrawing = false;
        continue;
      }
      if (isDrawing) geometry.lineTo(this.scratch[0], this.scratch[1]);
      else geometry.moveTo(this.scratch[0], this.scratch[1]);
      isDrawing = true;
    }
  }

  private drawHorizon(displayList: DisplayList): void {
    this.horizonLine.clear();
    const circle = Array.from({ length: 121 }, (_, index): [number, number] => [0, index * 3]);
    this.addHorizonPath(this.horizonLine, circle);
    // A tick at each compass point, rising from the horizon.
    for (let point = 0; point < 8; point++) this.addHorizonPath(this.horizonLine, [[0, point * 45], [point % 2 === 0 ? 2.5 : 1.2, point * 45]]);
    displayList.setColor(HORIZON_COLOR);
    displayList.addShape(this.horizonLine, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.7 });
  }

  private drawGrid(displayList: DisplayList): void {
    this.grid.clear();
    // Circles of altitude every 15 degrees, and lines of azimuth every 30 from the horizon to near the top.
    for (let altitude = 15; altitude < 90; altitude += 15) {
      this.addHorizonPath(this.grid, Array.from({ length: 121 }, (_, index): [number, number] => [altitude, index * 3]));
    }
    for (let azimuth = 0; azimuth < 360; azimuth += 30) {
      this.addHorizonPath(this.grid, Array.from({ length: 30 }, (_, index): [number, number] => [index * 3, azimuth]));
    }
    displayList.setColor(GRID_COLOR);
    displayList.addShape(this.grid, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.25 });
  }

  // The Sun, Moon and planets, worked out again when the sky's clock or the place has moved on; and
  // from the Sun's height, how dark the sky is (night below 12 degrees under the horizon, daylight above it).
  private updateSolarSystem(): void {
    const time = this.time;
    const cached = this.solarSystem;
    if (!cached || Math.abs(time.getTime() - cached.time) > SOLAR_SYSTEM_SECONDS * 1000 || cached.place !== this.place) {
      this.solarSystem = { bodies: solarSystemAt(time, this.place), moon: moonPhaseAt(time), time: time.getTime(), place: this.place };
    }
    const sun = this.solarSystem!.bodies[0];
    const [, , up] = this.toHorizon(sun.rightAscension, sun.declination);
    const sunAltitude = Math.asin(up) / DEGREES;
    // Faint stars stay faintly visible in daylight, so the map is never blank.
    this.skyDarkness = sunAltitude >= 0 ? 0.25 : sunAltitude <= -12 ? 1 : 0.25 + (0.75 * -sunAltitude) / 12;
  }

  private skyCondition(): string {
    return this.skyDarkness >= 1 ? "NIGHT" : this.skyDarkness <= 0.25 ? "DAYLIGHT" : "TWILIGHT";
  }

  private toHorizon(rightAscension: number, declination: number): [number, number, number] {
    const [x, y, z] = equatorialVector(rightAscension, declination);
    const matrix = this.rotation;
    return [matrix[0] * x + matrix[1] * y + matrix[2] * z, matrix[3] * x + matrix[4] * y + matrix[5] * z, matrix[6] * x + matrix[7] * y + matrix[8] * z];
  }

  private drawSolarSystem(displayList: DisplayList): void {
    this.bodyLabels.length = 0;
    const solarSystem = this.solarSystem;
    if (!solarSystem) return;
    const sunHorizon = this.toHorizon(solarSystem.bodies[0].rightAscension, solarSystem.bodies[0].declination);
    // Drawn faintest first, so the Sun and Moon come last.
    for (const body of [...solarSystem.bodies].reverse()) {
      const [east, north, up] = this.toHorizon(body.rightAscension, body.declination);
      if (this.showGround && up < 0) continue;
      if (!this.projector.project(east, north, up, this.scratch, 0) || !this.isInsideScreen(this.scratch[0], this.scratch[1], 30)) continue;
      const x = this.scratch[0];
      const y = this.scratch[1];
      this.bodies.clear();
      let radius = 4;
      if (body.kind === "sun") {
        radius = Math.max(MINIMUM_DISC_RADIUS, (SUN_DIAMETER / 2) * this.projector.unitsPerDegree);
        this.addCircle(x, y, radius, 24);
        for (let ray = 0; ray < 8; ray++) {
          const angle = (ray / 8) * 2 * Math.PI;
          this.bodies.addSegment(x + Math.cos(angle) * radius * 1.4, y + Math.sin(angle) * radius * 1.4, x + Math.cos(angle) * radius * 1.9, y + Math.sin(angle) * radius * 1.9);
        }
      } else if (body.kind === "moon") {
        radius = this.addMoon(x, y, [east, north, up], sunHorizon, solarSystem.moon);
      } else {
        this.bodies.addSegment(x, y, x, y);
        this.addCircle(x, y, 4, 10);
      }
      displayList.setColor(body.color);
      const brightness = body.kind === "planet" ? Math.min(1.6, Math.max(0.5, 1.2 - 0.18 * body.magnitude)) : 1.3;
      displayList.addShape(this.bodies, { ...SCREEN_SPACE_PLACEMENT, intensity: brightness });
      this.bodyLabels.push({ name: body.kind === "moon" ? `Moon (${solarSystem.moon.name})` : body.name, x, y, radius, color: body.color });
    }
  }

  private addCircle(x: number, y: number, radius: number, sides: number): void {
    this.bodies.moveTo(x + radius, y);
    for (let side = 1; side < sides; side++) this.bodies.lineTo(x + radius * Math.cos((side / sides) * 2 * Math.PI), y + radius * Math.sin((side / sides) * 2 * Math.PI));
    this.bodies.closePath();
  }

  // The Moon as its phase shows it: a faint full outline, and the lit part bright: the half of the
  // disc toward the Sun, closed by the terminator, a half ellipse whose width follows how much is lit.
  // Returns the disc's radius on the screen.
  private addMoon(x: number, y: number, moon: readonly [number, number, number], sun: readonly [number, number, number], phase: MoonPhase): number {
    const radius = Math.max(MINIMUM_DISC_RADIUS, (MOON_DIAMETER / 2) * this.projector.unitsPerDegree);
    this.addCircle(x, y, radius, 24);
    // Toward the Sun on the screen: a point a little way from the Moon along the sky toward the Sun.
    const along = sun[0] * moon[0] + sun[1] * moon[1] + sun[2] * moon[2];
    let towardEast = sun[0] - along * moon[0];
    let towardNorth = sun[1] - along * moon[1];
    let towardUp = sun[2] - along * moon[2];
    const length = Math.hypot(towardEast, towardNorth, towardUp) || 1;
    towardEast = moon[0] + (0.01 * towardEast) / length;
    towardNorth = moon[1] + (0.01 * towardNorth) / length;
    towardUp = moon[2] + (0.01 * towardUp) / length;
    let angle = 0;
    if (this.projector.project(towardEast, towardNorth, towardUp, this.scratch, 2)) angle = Math.atan2(this.scratch[3] - y, this.scratch[2] - x);
    const point = (along: number, across: number): [number, number] => [x + along * Math.cos(angle) - across * Math.sin(angle), y + along * Math.sin(angle) + across * Math.cos(angle)];
    const steps = 16;
    // The lit limb, from one tip round the sunward side to the other.
    for (let step = 0; step <= steps; step++) {
      const t = -Math.PI / 2 + (step / steps) * Math.PI;
      const [px, py] = point(radius * Math.cos(t), radius * Math.sin(t));
      if (step === 0) this.bodies.moveTo(px, py);
      else this.bodies.lineTo(px, py);
    }
    // Back along the terminator: bulging away from the Sun past half lit, toward it before.
    const bulge = -(2 * phase.litShare - 1);
    for (let step = steps - 1; step >= 0; step--) {
      const t = -Math.PI / 2 + (step / steps) * Math.PI;
      const [px, py] = point(bulge * radius * Math.cos(t), radius * Math.sin(t));
      this.bodies.lineTo(px, py);
    }
    // Shading lines across the lit part, so it reads as lit rather than as an outline.
    for (let line = 1; line < 6; line++) {
      const across = radius * (-1 + (2 * line) / 6);
      const t = Math.asin(across / radius);
      const limb = radius * Math.cos(t);
      const [ax, ay] = point(limb, across);
      const [bx, by] = point(bulge * limb, across);
      this.bodies.addSegment(ax, ay, bx, by);
    }
    return radius;
  }

  // The sky in 3D, for a VR headset: everything drawn here as points and lines on a sphere of radius
  // 1 around the viewer's eye, in the headset picture's axes (x right, y up, the eye looking down -z),
  // straight ahead being the direction this view faces. Stars are lines of no length, which the
  // headset draws as dots. Built from the state of the last draw().
  public picture3d(): SkyPicture3d {
    const positions: number[] = [];
    const colors: number[] = [];
    const azimuth = this.view.azimuth * DEGREES;
    const toPicture = ([east, north, up]: readonly [number, number, number]): [number, number, number] => [
      east * Math.cos(azimuth) - north * Math.sin(azimuth),
      up,
      -(east * Math.sin(azimuth) + north * Math.cos(azimuth)),
    ];
    const line = (from: readonly [number, number, number], to: readonly [number, number, number], color: BeamColor, brightness: number): void => {
      positions.push(...toPicture(from), ...toPicture(to));
      colors.push(color.red, color.green, color.blue, brightness);
    };
    const path = (points: readonly (readonly [number, number, number])[], color: BeamColor, brightness: number): void => {
      for (let index = 1; index < points.length; index++) {
        if (this.showGround && (points[index - 1][2] < -0.002 || points[index][2] < -0.002)) continue;
        line(points[index - 1], points[index], color, brightness);
      }
    };

    // In the headset, lines are straight between the catalog's points (its perspective needs no arcs),
    // and each piece's glowing ends overlap: so as few pieces as will do, and beads only at stars.
    const chord = (points: readonly SkyPoint[]): [number, number, number][] => points.map(([ra, dec]) => this.toHorizon(ra, dec));
    if (this.showMilkyWay) {
      for (const ring of SKY.milkyWay) path(chord([...ring.points.filter((_, index) => index % 4 === 0), ring.points[0]]), MILKY_WAY_COLOR, 0.25 * this.skyDarkness);
    }
    if (this.showLines) for (const constellation of SKY.constellations) for (const each of constellation.lines) path(chord(each), LINE_COLOR, 0.45);
    this.stars.forEach((star, index) => {
      const at: [number, number, number] = [this.horizon[index * 3], this.horizon[index * 3 + 1], this.horizon[index * 3 + 2]];
      if (this.showGround && at[2] < 0) return;
      const brightness = Math.min(2.4, starIntensity(star.magnitude) * this.skyDarkness);
      line(at, at, STAR_COLORS[starColorIndex(star.colorIndex)].color, brightness);
    });
    // The horizon, and the compass letters standing on it, facing the viewer.
    const horizon = Array.from({ length: 49 }, (_, step): [number, number, number] => [Math.sin(step * 7.5 * DEGREES), Math.cos(step * 7.5 * DEGREES), 0]);
    path(horizon, HORIZON_COLOR, 0.8);
    COMPASS_POINTS.forEach((name, index) => {
      const pointAzimuth = index * 45 * DEGREES;
      const size = index % 2 === 0 ? 0.006 : 0.004;
      const width = (name.length * 6 - 2) * size;
      const outward = [Math.sin(pointAzimuth), Math.cos(pointAzimuth), 0];
      const rightward = [Math.cos(pointAzimuth), -Math.sin(pointAzimuth), 0];
      for (const stroke of glyphStrokes(name)) {
        const points = stroke.points.map(([x, y]): [number, number, number] => {
          const across = x * size - width / 2;
          const height = y * size + 0.01;
          return [outward[0] + rightward[0] * across, outward[1] + rightward[1] * across, height];
        });
        if (stroke.closed) points.push(points[0]);
        for (let point = 1; point < points.length; point++) line(points[point - 1], points[point], COMPASS_COLOR, 1);
      }
    });
    if (this.showSolarSystem && this.solarSystem) {
      for (const body of this.solarSystem.bodies) {
        const at = this.toHorizon(body.rightAscension, body.declination);
        if (this.showGround && at[2] < 0) continue;
        if (body.kind === "planet") {
          line(at, at, body.color, 1.5);
          continue;
        }
        // The Sun and Moon as rings, a little larger than they are so they show.
        const ring = this.ringAround(at, body.kind === "sun" ? 0.012 : 0.011);
        for (let point = 1; point < ring.length; point++) line(ring[point - 1], ring[point], body.color, 1.3);
      }
    }
    return { positions: Float32Array.from(positions), colors: Float32Array.from(colors), spread: 1, drop: 0 };
  }

  // A small circle on the sphere around a direction, as points.
  private ringAround(center: readonly [number, number, number], radius: number): [number, number, number][] {
    // Two directions across the center: level, and the one perpendicular to both.
    const level = Math.hypot(center[0], center[1]) > 1e-6 ? [center[1], -center[0], 0] : [1, 0, 0];
    const levelLength = Math.hypot(level[0], level[1], level[2]);
    const across = [level[0] / levelLength, level[1] / levelLength, level[2] / levelLength];
    const upward = [center[1] * across[2] - center[2] * across[1], center[2] * across[0] - center[0] * across[2], center[0] * across[1] - center[1] * across[0]];
    return Array.from({ length: 17 }, (_, step) => {
      const angle = (step / 16) * 2 * Math.PI;
      return [0, 1, 2].map((axis) => center[axis] + radius * (Math.cos(angle) * across[axis] + Math.sin(angle) * upward[axis])) as [number, number, number];
    });
  }

  private drawCompass(displayList: DisplayList, scale: number): void {
    const font = getDemoFont();
    displayList.setColor(COMPASS_COLOR);
    COMPASS_POINTS.forEach((name, index) => {
      const azimuth = index * 45;
      const east = Math.sin(azimuth * DEGREES);
      const north = Math.cos(azimuth * DEGREES);
      if (!this.projector.project(east, north, 0, this.scratch, 0) || !this.isInsideScreen(this.scratch[0], this.scratch[1], 0)) return;
      const size = (index % 2 === 0 ? 22 : 14) * scale;
      font.addText(displayList, { text: name, x: this.scratch[0], y: this.scratch[1] + 10 * scale, size, alignment: "center", intensity: 0.9 });
    });
  }

  // The names of the brightest stars and of the constellations: only the major constellations when
  // the view is wide, more of everything as it narrows.
  private drawNames(displayList: DisplayList, scale: number): void {
    const font = getDemoFont();
    const wide = this.view.fieldOfView;
    const starLimit = wide > 100 ? 1 : wide > 60 ? 1.6 : wide > 30 ? 2.5 : 3.5;
    const rankLimit = wide > 100 ? 1 : wide > 50 ? 2 : 3;
    displayList.setColor(NAME_COLOR);
    for (const [index, name] of SKY.starNames) {
      if (!this.visible[index] || this.stars[index].magnitude > starLimit) continue;
      font.addText(displayList, { text: name.toUpperCase(), x: this.screen[index * 2] + 8 * scale, y: this.screen[index * 2 + 1] - 4 * scale, size: 9 * scale, intensity: 0.55 });
    }
    displayList.setColor(LINE_COLOR);
    const matrix = this.rotation;
    for (const constellation of SKY.constellations) {
      if (constellation.rank > rankLimit) continue;
      const [x, y, z] = equatorialVector(constellation.label[0], constellation.label[1]);
      const up = matrix[6] * x + matrix[7] * y + matrix[8] * z;
      if (this.showGround && up < 0) continue;
      const east = matrix[0] * x + matrix[1] * y + matrix[2] * z;
      const north = matrix[3] * x + matrix[4] * y + matrix[5] * z;
      if (!this.projector.project(east, north, up, this.scratch, 0) || !this.isInsideScreen(this.scratch[0], this.scratch[1], 0)) continue;
      font.addText(displayList, { text: constellation.name.toUpperCase(), x: this.scratch[0], y: this.scratch[1], size: 11 * scale, alignment: "center", intensity: 0.45 });
    }
  }
}

function angularDistance(from: SkyPoint, to: SkyPoint): number {
  const [ra1, dec1, ra2, dec2] = [from[0], from[1], to[0], to[1]].map((value) => value * DEGREES);
  const cosine = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / DEGREES;
}

function formatLatitude(latitude: number): string {
  return `${Math.abs(latitude).toFixed(2)}°${latitude >= 0 ? "N" : "S"}`;
}

function formatLongitude(longitude: number): string {
  return `${Math.abs(longitude).toFixed(2)}°${longitude >= 0 ? "E" : "W"}`;
}
