import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, DynamicGeometry, getDemoFont, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { equatorialVector, localSiderealTime, skyRotation, type Place } from "./sim/astronomy.js";
import { MAXIMUM_FIELD_OF_VIEW, MINIMUM_FIELD_OF_VIEW, Projector, type View } from "./sim/projection.js";
import { SKY, type SkyPoint } from "./sim/sky.js";

export const STAR_MAP_WORLD_HEIGHT = 1000;

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
  "L LINES   K NAMES   M MILKY WAY   G GRID   B GROUND   H HUD   F FULLSCREEN   ESC MENU",
];

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
  public view: View = { azimuth: 180, altitude: 30, fieldOfView: 90 };
  public place: Place;
  public placeName: string;
  public timeRateIndex = 0;
  public showLines = true;
  public showNames = true;
  public showMilkyWay = true;
  public showGrid = false;
  // With the ground on, what is below the horizon is hidden, as it would be outdoors.
  public showGround = true;

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
    this.placeStars();

    if (this.showMilkyWay) this.drawMilkyWay(displayList);
    if (this.showGrid) this.drawGrid(displayList);
    if (this.showLines) this.drawConstellationLines(displayList);
    this.drawStars(displayList);
    this.drawHorizon(displayList);
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const scale = frame.height / 1000;
    this.drawCompass(displayList, scale);
    if (this.showNames) this.drawNames(displayList, scale);
    const time = this.time;
    const clock = time.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).toUpperCase();
    this.hud.draw(displayList, {
      title: "STAR MAP",
      statusLines: [
        `${this.placeName.toUpperCase()}  ${formatLatitude(this.place.latitude)} ${formatLongitude(this.place.longitude)}  ${clock}  ${TIME_RATES[this.timeRateIndex].name}`,
        `LOOKING ${compassName(this.view.azimuth)} ${Math.round(this.view.azimuth)}°  UP ${Math.round(this.view.altitude)}°  FIELD ${Math.round(this.view.fieldOfView)}°`,
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
  public zoom(factor: number): void {
    const fieldOfView = Math.max(MINIMUM_FIELD_OF_VIEW, Math.min(MAXIMUM_FIELD_OF_VIEW, this.view.fieldOfView * factor));
    this.view = { ...this.view, fieldOfView };
  }

  public changeTimeRate(delta: number): void {
    this.timeRateIndex = Math.max(0, Math.min(TIME_RATES.length - 1, this.timeRateIndex + delta));
    this.hud.showBanner(TIME_RATES[this.timeRateIndex].name);
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

  public toggle(what: "lines" | "names" | "milkyWay" | "grid" | "ground"): void {
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
      const intensity = Math.min(2.4, starIntensity(star.magnitude) * zoomGain);
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
    displayList.addShape(this.milkyWay, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.16 });
  }

  // A path through points given as right ascension and declination, each piece broken into arcs of
  // ARC_STEP or less so it curves as it should, and lifted where it goes out of sight (behind the
  // viewer, below the ground, far off the screen).
  private addSkyPath(geometry: DynamicGeometry, points: readonly SkyPoint[]): void {
    const along: SkyPoint[] = [points[0]];
    for (let index = 1; index < points.length; index++) {
      const [fromRa, fromDec] = points[index - 1];
      const [toRa, toDec] = points[index];
      // The shorter way round in right ascension.
      const deltaRa = ((((toRa - fromRa) % 360) + 540) % 360) - 180;
      const steps = Math.max(1, Math.ceil(angularDistance(points[index - 1], points[index]) / ARC_STEP));
      for (let step = 1; step <= steps; step++) along.push([fromRa + (deltaRa * step) / steps, fromDec + ((toDec - fromDec) * step) / steps]);
    }
    const matrix = this.rotation;
    let isDrawing = false;
    for (const [rightAscension, declination] of along) {
      const [x, y, z] = equatorialVector(rightAscension, declination);
      const east = matrix[0] * x + matrix[1] * y + matrix[2] * z;
      const north = matrix[3] * x + matrix[4] * y + matrix[5] * z;
      const up = matrix[6] * x + matrix[7] * y + matrix[8] * z;
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
