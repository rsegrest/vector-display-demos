import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, DynamicGeometry, createSeededRandom, hslToBeamColor, type Demo, type DemoFrame, type RandomSource } from "@vector-demos/demo-kit";
import { regularPolytopes, type Polytope } from "./sim/polytopes.js";
import {
  ROTATION_PLANES,
  identity4,
  projectTo3,
  reorthonormalise,
  rotateInPlane,
  transformPoints,
  type Matrix4,
  type Projection,
} from "./sim/rotation4.js";

export const POLYTOPES_WORLD_HEIGHT = 1000;
export const SPEEDS: readonly number[] = [0.25, 0.5, 1, 2];
export const TRAIL_MODES: readonly { readonly name: string; readonly halfLifeMilliseconds: number }[] = [
  { name: "SHORT", halfLifeMilliseconds: 50 },
  { name: "MEDIUM", halfLifeMilliseconds: 160 },
  { name: "LONG", halfLifeMilliseconds: 450 },
  { name: "INK", halfLifeMilliseconds: 1400 },
];
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 4;

// Radians per second in each of the six planes, in the order of ROTATION_PLANES.
const DEFAULT_RATES: readonly number[] = [0.13, 0.09, 0.05, 0.21, 0.16, 0.11];
const AUTO_SECONDS = 22;
const FADE_SECONDS = 0.35;
// Edges are grouped by how far along the unseen axis they sit, for colour and brightness.
const W_BANDS = 7;
const REORTHONORMALISE_EVERY = 120;

interface ViewSettings {
  // Distance of the ordinary 3D camera from the origin.
  readonly cameraDistance: number;
  // Share of the screen's shorter side that one unit covers at the origin.
  readonly unitShare: number;
}

const VIEWS: Readonly<Record<Projection, ViewSettings>> = {
  PERSPECTIVE: { cameraDistance: 6, unitShare: 0.25 },
  STEREOGRAPHIC: { cameraDistance: 14, unitShare: 0.15 },
};

const HELP_LINES = [
  "DRAG ROTATE IN 3D   SHIFT+DRAG ROTATE THROUGH W   WHEEL ZOOM   N / B POLYTOPE   P PROJECTION",
  "W 4D ROTATION   R NEW SPIN   A AUTO   - + SPEED   T TRAILS   SPACE PAUSE   H HUD   F FULLSCREEN   ESC MENU",
];

export interface PolytopesOptions {
  readonly seed: number;
  readonly polytopeIndex: number;
  readonly projection: Projection;
}

interface Band {
  readonly geometry: DynamicGeometry;
  readonly color: BeamColor;
  // How far along w this band sits, 0 (far) to 1 (near).
  readonly amount: number;
}

// The regular polytopes of four dimensions, turning. Each is rotated in 4D, brought
// down to 3D, then drawn in perspective like any wireframe. Colour is the fourth
// coordinate: edges far away along w are deep blue, edges near are hot, so when a
// rotation through w carries part of the shape "past" another, you can see which
// part is which.
export class PolytopesDemo implements Demo {
  public isPaused = false;
  public autoCycle = true;
  public rotateThroughW = true;
  public speedIndex = 2;
  public trailIndex = 1;
  public zoom = 1;
  public projection: Projection;
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly polytopes = regularPolytopes();
  private readonly hud = new DemoHud();
  private readonly bands: Band[] = [];
  private readonly orientation: Matrix4 = identity4();
  private readonly turned: Float64Array;
  private readonly point: [number, number, number] = [0, 0, 0];
  private random: RandomSource;
  private seed: number;
  private rates: number[] = [...DEFAULT_RATES];
  private polytopeIndex: number;
  // The polytope to switch to once the current one has faded out.
  private pendingIndex: number | null = null;
  private fade = 0;
  private autoSeconds = 0;
  private updateCount = 0;
  private segmentCount = 0;

  public constructor(options: PolytopesOptions) {
    this.seed = options.seed;
    this.random = createSeededRandom(options.seed);
    this.polytopeIndex = options.polytopeIndex % this.polytopes.length;
    this.projection = options.projection;
    this.turned = new Float64Array(Math.max(...this.polytopes.map((polytope) => polytope.vertices.length)));
    for (let band = 0; band < W_BANDS; band++) {
      const amount = band / (W_BANDS - 1);
      this.bands.push({
        geometry: new DynamicGeometry(1024),
        // Deep blue far along w, through violet and pink, to amber near.
        color: hslToBeamColor(0.62 + 0.46 * amount, 0.9, 0.5 + 0.1 * amount),
        amount,
      });
    }
    // Start somewhere other than face-on, where several edges hide behind each other.
    rotateInPlane(this.orientation, 0, 2, 0.5);
    rotateInPlane(this.orientation, 1, 2, 0.35);
    rotateInPlane(this.orientation, 0, 3, 0.4);
    this.hud.showBanner(this.current.name);
  }

  public get currentSeed(): number {
    return this.seed;
  }

  public get index(): number {
    return this.pendingIndex ?? this.polytopeIndex;
  }

  public get current(): Polytope {
    return this.polytopes[this.polytopeIndex];
  }

  // 1 when fully shown; dips to 0 and back while switching polytope.
  public get visibility(): number {
    return this.fade;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    this.updateFade(deltaSeconds);
    if (this.isPaused) return;

    if (this.autoCycle) {
      this.autoSeconds += deltaSeconds;
      if (this.autoSeconds >= AUTO_SECONDS) {
        // Each time round the list, look at them the other way.
        if (this.index === this.polytopes.length - 1) this.toggleProjection();
        this.changePolytope(1);
      }
    }
    const turn = deltaSeconds * SPEEDS[this.speedIndex];
    ROTATION_PLANES.forEach((plane, index) => {
      if (plane.involvesW && !this.rotateThroughW) return;
      rotateInPlane(this.orientation, plane.first, plane.second, this.rates[index] * turn);
    });
    if (++this.updateCount % REORTHONORMALISE_EVERY === 0) reorthonormalise(this.orientation);
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const polytope = this.current;
    const { turned } = this;
    transformPoints(this.orientation, polytope.vertices, turned);
    for (const band of this.bands) band.geometry.clear();

    const view = VIEWS[this.projection];
    const centreX = frame.width / 2;
    const centreY = frame.height / 2;
    const unit = Math.min(frame.width, frame.height) * view.unitShare * this.zoom * view.cameraDistance;
    // Straight edges curve under the stereographic projection, so they are drawn in pieces.
    const pieces = this.projection === "PERSPECTIVE" ? 1 : polytope.edgeCount > 200 ? 8 : 14;

    for (let edge = 0; edge < polytope.edgeCount; edge++) {
      const a = polytope.edges[edge * 2] * 4;
      const b = polytope.edges[edge * 2 + 1] * 4;
      const middleW = (turned[a + 3] + turned[b + 3]) / 2;
      const band = this.bands[Math.max(0, Math.min(W_BANDS - 1, Math.floor(((middleW + 1) / 2) * W_BANDS)))];
      let drawing = false;
      for (let piece = 0; piece <= pieces; piece++) {
        const amount = piece / pieces;
        let x = turned[a] + (turned[b] - turned[a]) * amount;
        let y = turned[a + 1] + (turned[b + 1] - turned[a + 1]) * amount;
        let z = turned[a + 2] + (turned[b + 2] - turned[a + 2]) * amount;
        let w = turned[a + 3] + (turned[b + 3] - turned[a + 3]) * amount;
        if (pieces > 1) {
          // Back out onto the 3-sphere, so the pieces follow the great-circle arc.
          const length = Math.hypot(x, y, z, w);
          x /= length;
          y /= length;
          z /= length;
          w /= length;
        }
        if (!projectTo3(x, y, z, w, this.projection, this.point)) {
          drawing = false;
          continue;
        }
        const depth = view.cameraDistance - this.point[2];
        if (depth < 0.5) {
          drawing = false;
          continue;
        }
        const screenX = centreX + (this.point[0] * unit) / depth;
        const screenY = centreY - (this.point[1] * unit) / depth;
        if (drawing) band.geometry.lineTo(screenX, screenY);
        else band.geometry.moveTo(screenX, screenY);
        drawing = true;
      }
    }

    // Busier polytopes are drawn dimmer, so hundreds of overlapping edges do not wash out.
    const density = Math.max(0.4, Math.min(1, Math.sqrt(96 / polytope.edgeCount)));
    this.segmentCount = 0;
    for (const band of this.bands) {
      if (band.geometry.segmentCount === 0) continue;
      this.segmentCount += band.geometry.segmentCount;
      displayList.setColor(band.color);
      // In perspective the near edges are the big bright ones. Stereographically the
      // near edges are flung outward into huge arcs, so there the far, central ones lead.
      const emphasis = this.projection === "PERSPECTIVE" ? 0.3 + 0.9 * band.amount * band.amount : 1.1 - 0.85 * band.amount;
      displayList.addShape(band.geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: emphasis * density * this.fade });
    }
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const polytope = this.current;
    const spin = ROTATION_PLANES.filter((plane) => this.rotateThroughW || !plane.involvesW)
      .map((plane) => plane.name)
      .join(" ");
    this.hud.draw(displayList, {
      title: "4D POLYTOPES",
      statusLines: [
        `${polytope.name}  ${polytope.cells}  ${polytope.vertexCount} VERTICES  ${polytope.edgeCount} EDGES`,
        `${this.projection}  SPIN ${spin}  SPEED ${SPEEDS[this.speedIndex]}X  TRAILS ${TRAIL_MODES[this.trailIndex].name}  AUTO ${this.autoCycle ? "ON" : "OFF"}`,
        `SEGMENTS ${this.segmentCount}${this.isPaused ? "  PAUSED" : ""}`,
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

  // Fades the current polytope out, then the next (or previous) one in.
  public changePolytope(delta: number): void {
    const count = this.polytopes.length;
    this.pendingIndex = (((this.index + delta) % count) + count) % count;
    this.autoSeconds = 0;
    this.hud.showBanner(this.polytopes[this.pendingIndex].name);
  }

  public toggleProjection(): void {
    this.projection = this.projection === "PERSPECTIVE" ? "STEREOGRAPHIC" : "PERSPECTIVE";
    this.hud.showBanner(this.projection);
  }

  // With this off the shape turns only in the three planes we can see, and looks
  // like an ordinary rigid object. Turn it back on to see what w adds.
  public toggleRotateThroughW(): void {
    this.rotateThroughW = !this.rotateThroughW;
    this.hud.showBanner(`4D ROTATION ${this.rotateThroughW ? "ON" : "OFF"}`);
  }

  // A fresh set of turning rates, some planes faster, some slower, some reversed.
  public newSpin(): void {
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.random = createSeededRandom(this.seed);
    this.rates = ROTATION_PLANES.map(() => (0.04 + 0.22 * this.random()) * (this.random() < 0.5 ? -1 : 1));
    this.hud.showBanner("NEW SPIN");
  }

  public changeSpeed(delta: number): void {
    this.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIndex + delta));
    this.hud.showBanner(`SPEED ${SPEEDS[this.speedIndex]}X`);
  }

  public cycleTrails(): void {
    this.trailIndex = (this.trailIndex + 1) % TRAIL_MODES.length;
    this.onTrailChange(TRAIL_MODES[this.trailIndex].halfLifeMilliseconds);
    this.hud.showBanner(`TRAILS ${TRAIL_MODES[this.trailIndex].name}`);
  }

  public toggleAuto(): void {
    this.autoCycle = !this.autoCycle;
    this.autoSeconds = 0;
    this.hud.showBanner(`AUTO ${this.autoCycle ? "ON" : "OFF"}`);
  }

  // Turns the shape by hand. Plain dragging turns it like a solid object; with
  // `throughW` the same motion turns it in the planes that involve the unseen axis.
  public dragBy(horizontal: number, vertical: number, throughW: boolean): void {
    rotateInPlane(this.orientation, 0, throughW ? 3 : 2, horizontal);
    rotateInPlane(this.orientation, 1, throughW ? 3 : 2, -vertical);
  }

  public zoomBy(factor: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private updateFade(deltaSeconds: number): void {
    const step = deltaSeconds / FADE_SECONDS;
    if (this.pendingIndex !== null) {
      this.fade = Math.max(0, this.fade - step);
      if (this.fade === 0) {
        this.polytopeIndex = this.pendingIndex;
        this.pendingIndex = null;
      }
    } else {
      this.fade = Math.min(1, this.fade + step);
    }
  }
}
