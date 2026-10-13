import type { DisplayList } from "@vector-display/core";
import { DemoHud, createSeededRandom, type Demo, type DemoFrame, type RandomSource } from "@vector-demos/demo-kit";
import { ParticleWorld } from "./sim/ParticleWorld.js";
import { RULE_PRESETS, blendRules, mutateRules, type Rules } from "./sim/rules.js";
import { Camera } from "./render/Camera.js";
import { ParticleRenderer } from "./render/ParticleRenderer.js";
import { RulesMatrixView } from "./render/RulesMatrixView.js";

export interface ParticleLifeOptions {
  readonly seed: number;
  readonly speciesCount: number;
  readonly particleCount: number;
  readonly presetIndex: number;
}

export interface TrailMode {
  readonly name: string;
  readonly halfLifeMilliseconds: number;
}

export const TRAIL_MODES: readonly TrailMode[] = [
  { name: "SHORT", halfLifeMilliseconds: 40 },
  { name: "MEDIUM", halfLifeMilliseconds: 110 },
  { name: "LONG", halfLifeMilliseconds: 350 },
  { name: "INK", halfLifeMilliseconds: 1400 },
];

export const MIN_SPECIES = 2;
export const MAX_SPECIES = 10;
export const MIN_PARTICLES = 500;
export const MAX_PARTICLES = 9000;

const RULE_TRANSITION_SECONDS = 5;
const EVOLVE_INTERVAL_SECONDS = 22;
// Every few evolutions, jump to a fresh rule set instead of nudging the current one.
const EVOLUTIONS_PER_NEW_SPECIES = 4;
const AUTO_CAMERA_PERIOD_SECONDS = 70;

const HELP_LINES = [
  "DRAG ATTRACT   SHIFT+DRAG REPEL   WHEEL ZOOM   ARROWS PAN",
  "R NEW RULES  M MUTATE  P PRESET  E EVOLVE  [ ] SPECIES  - + PARTICLES",
  "T TRAILS  C CAMERA  0 RESET VIEW  SPACE PAUSE  . STEP  H HUD  F FULLSCREEN  ESC MENU",
];

// Ties the simulation, camera and drawing together, and runs the hands-off "evolve" mode.
export class ParticleLifeDemo implements Demo {
  public autoEvolve = true;
  public autoCamera = true;
  public isPaused = false;
  public trailModeIndex = 1;
  public onTrailModeChange: (mode: TrailMode) => void = () => {};

  private readonly world: ParticleWorld;
  private readonly camera = new Camera();
  private readonly particleRenderer = new ParticleRenderer();
  private readonly hud = new DemoHud();
  private readonly rulesView = new RulesMatrixView();
  private random: RandomSource;
  private seed: number;
  private presetIndex: number;
  private targetRules: Rules;
  private transitionFrom: Float32Array | null = null;
  private transitionSeconds = 0;
  private evolveTimer = 0;
  private evolutionCount = 0;
  private cameraSeconds = 0;
  private autoZoomBase = 1;

  public constructor(options: ParticleLifeOptions, width: number, height: number) {
    this.seed = options.seed;
    this.random = createSeededRandom(options.seed);
    this.presetIndex = options.presetIndex;
    this.targetRules = RULE_PRESETS[this.presetIndex].create(this.random, options.speciesCount);
    this.world = new ParticleWorld({
      width,
      height,
      particleCount: options.particleCount,
      rules: this.targetRules,
      random: this.random,
      interactionRadius: interactionRadiusFor(options.particleCount, width, height),
    });
    this.camera.setView({ worldWidth: width, worldHeight: height });
    this.showBanner(`${RULE_PRESETS[this.presetIndex].name}  SEED ${this.seed}`);
  }

  public get currentSeed(): number {
    return this.seed;
  }

  public get speciesCount(): number {
    return this.world.speciesCount;
  }

  public get particleCount(): number {
    return this.world.particleCount;
  }

  public get preset(): number {
    return this.presetIndex;
  }

  public resize(width: number, height: number): void {
    this.world.resize(width, height);
    this.world.settings.interactionRadius = interactionRadiusFor(this.world.particleCount, width, height);
    this.camera.setView({ worldWidth: width, worldHeight: height });
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    this.updateCamera(deltaSeconds);
    if (this.isPaused) return;

    if (this.autoEvolve) {
      this.evolveTimer += deltaSeconds;
      if (this.evolveTimer >= EVOLVE_INTERVAL_SECONDS) this.evolve();
    }
    if (this.transitionFrom) {
      this.transitionSeconds += deltaSeconds;
      const progress = Math.min(1, this.transitionSeconds / RULE_TRANSITION_SECONDS);
      const eased = progress * progress * (3 - 2 * progress);
      blendRules(this.transitionFrom, this.targetRules.attraction, eased, this.world.attraction);
      if (progress >= 1) this.transitionFrom = null;
    }
    this.world.step(deltaSeconds);
  }

  public draw(displayList: DisplayList): void {
    this.particleRenderer.draw(displayList, this.world, this.camera);
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    this.hud.draw(displayList, {
      title: "PARTICLE LIFE",
      statusLines: [
        `${RULE_PRESETS[this.presetIndex].name}  SEED ${this.seed}`,
        `SPECIES ${this.world.speciesCount}  PARTICLES ${this.world.particleCount}`,
        `EVOLVE ${this.autoEvolve ? "ON" : "OFF"}  TRAILS ${TRAIL_MODES[this.trailModeIndex].name}  ZOOM ${this.camera.zoom.toFixed(1)}${this.isPaused ? "  PAUSED" : ""}`,
      ],
      helpLines: HELP_LINES,
      width: frame.width,
      height: frame.height,
    });
    const visibility = this.hud.visibility;
    if (visibility > 0.01) {
      this.rulesView.draw(displayList, this.world.attraction, this.particleRenderer.speciesColors, frame.width, visibility);
    }
  }

  // --- Actions -------------------------------------------------------------------------------------------

  public noteActivity(): void {
    this.hud.noteActivity();
  }

  public toggleHud(): void {
    this.hud.toggle();
  }

  public newRules(): void {
    this.seed = Math.floor(Math.random() * 0x7fffffff);
    this.random = createSeededRandom(this.seed);
    this.transitionTo(RULE_PRESETS[this.presetIndex].create(this.random, this.world.speciesCount));
    this.world.scatter();
    this.evolveTimer = 0;
    this.showBanner(`${RULE_PRESETS[this.presetIndex].name}  SEED ${this.seed}`);
  }

  public nextPreset(): void {
    this.presetIndex = (this.presetIndex + 1) % RULE_PRESETS.length;
    this.transitionTo(RULE_PRESETS[this.presetIndex].create(this.random, this.world.speciesCount));
    this.evolveTimer = 0;
    this.showBanner(`PRESET ${RULE_PRESETS[this.presetIndex].name}`);
  }

  public mutate(): void {
    this.transitionTo(mutateRules(this.targetRules, this.random, 0.35));
    this.evolveTimer = 0;
    this.showBanner("MUTATING");
  }

  public changeSpecies(delta: number): void {
    const count = Math.max(MIN_SPECIES, Math.min(MAX_SPECIES, this.world.speciesCount + delta));
    if (count === this.world.speciesCount) return;
    // A new species count cannot blend with the old matrix, so it switches at once.
    this.targetRules = RULE_PRESETS[this.presetIndex].create(this.random, count);
    this.transitionFrom = null;
    this.world.setRules(this.targetRules);
    this.showBanner(`SPECIES ${count}`);
  }

  public changeParticleCount(delta: number): void {
    const count = Math.max(MIN_PARTICLES, Math.min(MAX_PARTICLES, this.world.particleCount + delta));
    if (count === this.world.particleCount) return;
    this.world.setParticleCount(count);
    this.world.settings.interactionRadius = interactionRadiusFor(count, this.world.width, this.world.height);
    this.showBanner(`PARTICLES ${count}`);
  }

  public toggleEvolve(): void {
    this.autoEvolve = !this.autoEvolve;
    this.evolveTimer = 0;
    this.showBanner(`EVOLVE ${this.autoEvolve ? "ON" : "OFF"}`);
  }

  public cycleTrails(): void {
    this.trailModeIndex = (this.trailModeIndex + 1) % TRAIL_MODES.length;
    this.onTrailModeChange(TRAIL_MODES[this.trailModeIndex]);
    this.showBanner(`TRAILS ${TRAIL_MODES[this.trailModeIndex].name}`);
  }

  public toggleAutoCamera(): void {
    this.autoCamera = !this.autoCamera;
    this.autoZoomBase = this.camera.zoom;
    this.cameraSeconds = 0;
    this.showBanner(`AUTO CAMERA ${this.autoCamera ? "ON" : "OFF"}`);
  }

  public resetView(): void {
    this.camera.zoom = 1;
    this.autoZoomBase = 1;
    this.cameraSeconds = 0;
  }

  public togglePause(): void {
    this.isPaused = !this.isPaused;
  }

  public panBy(screenDeltaX: number, screenDeltaY: number): void {
    this.stopAutoCamera();
    this.camera.pan(screenDeltaX, screenDeltaY);
  }

  public zoomAt(factor: number, screenX: number, screenY: number): void {
    this.stopAutoCamera();
    this.camera.zoomAbout(factor, screenX, screenY);
  }

  // strength 1 pulls, -1 pushes, 0 releases.
  public setPointer(screenX: number, screenY: number, strength: number): void {
    if (strength === 0) {
      this.world.setAttractor(null);
      return;
    }
    const point = this.camera.toWorld(screenX, screenY);
    this.world.setAttractor({ x: point.x, y: point.y, strength, radius: 180 / this.camera.zoom });
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private transitionTo(rules: Rules): void {
    if (rules.speciesCount !== this.world.speciesCount) {
      this.world.setRules(rules);
      this.transitionFrom = null;
    } else {
      this.transitionFrom = Float32Array.from(this.world.attraction);
      this.transitionSeconds = 0;
    }
    this.targetRules = rules;
  }

  private evolve(): void {
    this.evolveTimer = 0;
    this.evolutionCount++;
    if (this.evolutionCount % EVOLUTIONS_PER_NEW_SPECIES === 0) {
      this.presetIndex = Math.floor(this.random() * RULE_PRESETS.length);
      this.transitionTo(RULE_PRESETS[this.presetIndex].create(this.random, this.world.speciesCount));
      this.showBanner(`NEW RULES  ${RULE_PRESETS[this.presetIndex].name}`);
    } else {
      this.transitionTo(mutateRules(this.targetRules, this.random, 0.3));
      this.showBanner("EVOLVING");
    }
  }

  private stopAutoCamera(): void {
    if (this.autoCamera) {
      this.autoCamera = false;
      this.autoZoomBase = this.camera.zoom;
    }
  }

  // A slow drift across the torus with a gentle breathing zoom.
  private updateCamera(deltaSeconds: number): void {
    if (!this.autoCamera) return;
    this.cameraSeconds += deltaSeconds;
    const phase = (this.cameraSeconds / AUTO_CAMERA_PERIOD_SECONDS) * Math.PI * 2;
    this.camera.zoom = Math.max(1, this.autoZoomBase + 0.35 * (1 - Math.cos(phase)));
    const heading = phase * 0.37;
    const speed = 10 * deltaSeconds * this.camera.zoom;
    this.camera.pan(Math.cos(heading) * speed, Math.sin(heading) * speed);
  }

  private showBanner(text: string): void {
    this.hud.showBanner(text);
  }
}

// Shrinks the interaction radius as particles are added, so neighbor counts (and the cost per step) stay steady.
export function interactionRadiusFor(particleCount: number, width: number, height: number): number {
  const referenceArea = 1778 * 1000;
  const areaScale = Math.sqrt((width * height) / referenceArea);
  return Math.max(28, Math.min(90, 60 * Math.sqrt(3000 / particleCount) * areaScale));
}
