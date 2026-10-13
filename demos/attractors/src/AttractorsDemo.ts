import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, DynamicGeometry, createSeededRandom, hslToBeamColor, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { OrbitCamera, type ScreenPoint } from "./render/OrbitCamera.js";
import { AttractorSwarm } from "./sim/AttractorSwarm.js";
import { ATTRACTORS, blendedField, calibrate, type CalibratedAttractor } from "./sim/attractors.js";

export const ATTRACTORS_WORLD_HEIGHT = 1000;
export const MIN_PARTICLES = 500;
export const MAX_PARTICLES = 8000;
export const PARTICLE_STEP = 500;
// Common-frame time per second: at 1, a particle crosses the attractor in a couple of seconds.
export const SPEEDS: readonly number[] = [0.25, 0.5, 1, 2];
export const TRAIL_MODES: readonly { readonly name: string; readonly halfLifeMilliseconds: number }[] = [
  { name: "SHORT", halfLifeMilliseconds: 90 },
  { name: "MEDIUM", halfLifeMilliseconds: 260 },
  { name: "LONG", halfLifeMilliseconds: 700 },
  { name: "INK", halfLifeMilliseconds: 2000 },
];

export const CROSSFADE_SECONDS = 6;
const AUTO_SECONDS = 26;
const AUTO_YAW_PER_SECOND = 0.11;
const SUBSTEPS = 2;
// Particles are grouped by flow speed for colour, and by depth for brightness.
const SPEED_BANDS = 6;
const DEPTH_BANDS = 2;
// Flow speed (common frame) that maps to the hottest colour.
const HOT_SPEED = 2.4;

const HELP_LINES = [
  "DRAG ROTATE   WHEEL ZOOM   N / B ATTRACTOR   A AUTO   R SCATTER",
  "[ ] PARTICLES   - + SPEED   T TRAILS   C AUTO CAMERA   SPACE PAUSE   H HUD   F FULLSCREEN   ESC MENU",
];

export interface AttractorsOptions {
  readonly seed: number;
  readonly attractorIndex: number;
  readonly particleCount: number;
}

interface Band {
  readonly geometry: DynamicGeometry;
  readonly color: BeamColor;
  readonly intensity: number;
}

// Strange attractors as flow. Nothing draws the attractor itself: each particle is
// a short stroke along the path it just took, and the phosphor remembers the rest,
// so the shape appears only because thousands of independent particles keep
// retracing it. Slow reaches glow blue, fast ones burn toward orange.
export class AttractorsDemo implements Demo {
  public isPaused = false;
  public autoCycle = true;
  public autoCamera = true;
  public speedIndex = 2;
  public trailIndex = 1;
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly calibrated: CalibratedAttractor[] = ATTRACTORS.map(calibrate);
  private readonly swarm: AttractorSwarm;
  private readonly camera = new OrbitCamera();
  private readonly hud = new DemoHud();
  private readonly bands: Band[] = [];
  private readonly head: ScreenPoint = { x: 0, y: 0, depth: 0 };
  private readonly tail: ScreenPoint = { x: 0, y: 0, depth: 0 };
  private seed: number;
  private fromIndex: number;
  private toIndex: number;
  // 1 when settled on `toIndex`; below 1 while still crossing over from `fromIndex`.
  private crossfade = 1;
  private autoSeconds = 0;
  private cameraSeconds = 0;
  private segmentCount = 0;

  public constructor(options: AttractorsOptions) {
    this.seed = options.seed;
    this.toIndex = this.fromIndex = options.attractorIndex % ATTRACTORS.length;
    this.swarm = new AttractorSwarm(options.particleCount, createSeededRandom(options.seed));
    for (let depth = 0; depth < DEPTH_BANDS; depth++) {
      for (let speed = 0; speed < SPEED_BANDS; speed++) {
        const amount = speed / (SPEED_BANDS - 1);
        this.bands.push({
          geometry: new DynamicGeometry(1024),
          // Deep blue through cyan and pale green to orange.
          color: hslToBeamColor(0.62 - 0.55 * amount, 0.95 - 0.25 * Math.sin(amount * Math.PI), 0.5 + 0.12 * Math.sin(amount * Math.PI)),
          intensity: (0.5 + 0.5 * amount) * (depth === 0 ? 1 : 0.55),
        });
      }
    }
    this.hud.showBanner(ATTRACTORS[this.toIndex].name);
  }

  public get currentSeed(): number {
    return this.seed;
  }

  public get attractorIndex(): number {
    return this.toIndex;
  }

  public get particleCount(): number {
    return this.swarm.count;
  }

  public get crossfadeProgress(): number {
    return this.crossfade;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (this.autoCamera) {
      this.cameraSeconds += deltaSeconds;
      this.camera.yaw += AUTO_YAW_PER_SECOND * deltaSeconds;
      this.camera.pitch = 0.3 + 0.22 * Math.sin(this.cameraSeconds * 0.13);
    }
    if (this.isPaused) return;

    if (this.autoCycle && this.crossfade >= 1) {
      this.autoSeconds += deltaSeconds;
      if (this.autoSeconds >= AUTO_SECONDS) this.changeAttractor(1);
    }
    if (this.crossfade < 1) this.crossfade = Math.min(1, this.crossfade + deltaSeconds / CROSSFADE_SECONDS);

    const eased = this.crossfade * this.crossfade * (3 - 2 * this.crossfade);
    const field = blendedField(this.calibrated[this.fromIndex], this.calibrated[this.toIndex], eased);
    this.swarm.step(field, deltaSeconds * SPEEDS[this.speedIndex], SUBSTEPS);
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const { camera, swarm, head, tail } = this;
    camera.frame(frame.width, frame.height);
    for (const band of this.bands) band.geometry.clear();

    const { positions, previousPositions, speeds } = swarm;
    for (let particle = 0; particle < swarm.count; particle++) {
      const offset = particle * 3;
      camera.project(positions[offset], positions[offset + 1], positions[offset + 2], head);
      camera.project(previousPositions[offset], previousPositions[offset + 1], previousPositions[offset + 2], tail);
      const speedBand = Math.min(SPEED_BANDS - 1, Math.floor((speeds[particle] / HOT_SPEED) * SPEED_BANDS));
      // The camera sits about 4.2 units out, so this splits the cloud front and back.
      const depthBand = head.depth < 4.2 ? 0 : 1;
      this.bands[depthBand * SPEED_BANDS + speedBand].geometry.addSegment(tail.x, tail.y, head.x, head.y);
    }

    this.segmentCount = 0;
    for (const band of this.bands) {
      if (band.geometry.segmentCount === 0) continue;
      this.segmentCount += band.geometry.segmentCount;
      displayList.setColor(band.color);
      displayList.addShape(band.geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: band.intensity });
    }
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const name =
      this.crossfade < 1 ? `${ATTRACTORS[this.fromIndex].name} > ${ATTRACTORS[this.toIndex].name}  ${Math.round(this.crossfade * 100)}%` : ATTRACTORS[this.toIndex].name;
    this.hud.draw(displayList, {
      title: "STRANGE ATTRACTORS",
      statusLines: [
        `${name}  SEED ${this.seed}`,
        `PARTICLES ${this.swarm.count}  SPEED ${SPEEDS[this.speedIndex]}X  TRAILS ${TRAIL_MODES[this.trailIndex].name}  AUTO ${this.autoCycle ? "ON" : "OFF"}`,
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

  // Starts flowing toward the next (or previous) attractor. If a crossing is still
  // under way, the particles carry on from wherever they are.
  public changeAttractor(delta: number): void {
    const count = ATTRACTORS.length;
    // Mid-crossing, the nearer end becomes the place we are leaving from.
    if (this.crossfade >= 0.5) this.fromIndex = this.toIndex;
    this.toIndex = (((this.toIndex + delta) % count) + count) % count;
    this.crossfade = this.fromIndex === this.toIndex ? 1 : 0;
    this.autoSeconds = 0;
    this.hud.showBanner(ATTRACTORS[this.toIndex].name);
  }

  public scatter(): void {
    this.swarm.scatter();
    this.hud.showBanner("SCATTERED");
  }

  public changeParticleCount(delta: number): void {
    const count = Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, this.swarm.count + delta));
    if (count === this.swarm.count) return;
    this.swarm.setCount(count);
    this.hud.showBanner(`PARTICLES ${count}`);
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

  public toggleAutoCamera(): void {
    this.autoCamera = !this.autoCamera;
    this.hud.showBanner(`AUTO CAMERA ${this.autoCamera ? "ON" : "OFF"}`);
  }

  // Dragging takes over from the automatic orbit.
  public rotateBy(deltaYaw: number, deltaPitch: number): void {
    this.autoCamera = false;
    this.camera.rotate(deltaYaw, deltaPitch);
  }

  public zoomBy(factor: number): void {
    this.camera.zoomBy(factor);
  }
}
