import { SCREEN_SPACE_PLACEMENT, type BeamColor, type DisplayList } from "@vector-display/core";
import { DemoHud, DynamicGeometry, fontSafeText, type Demo, type DemoFrame } from "@vector-demos/demo-kit";
import { ScopeEngine } from "./sim/ScopeEngine.js";
import { cubePath, heartPath, octahedronPath, spiralPath, starPath, textPath, trianglePath } from "./sim/paths.js";
import { LissajousSource, PathSource, RecordedSource, type TunableSource } from "./sim/signals.js";

export const OSCILLOSCOPE_WORLD_HEIGHT = 1000;
// Used until real audio starts and reports the output device's own rate.
export const DEFAULT_SAMPLE_RATE = 48000;
export const BASE_FREQUENCY = 80;
// Pitch moves in semitones around the base frequency.
export const MIN_SEMITONES = -12;
export const MAX_SEMITONES = 28;
export const MOTIONS: readonly number[] = [0, 0.5, 1, 2, 4];
export const TRAIL_MODES: readonly { readonly name: string; readonly halfLifeMilliseconds: number }[] = [
  { name: "SHORT", halfLifeMilliseconds: 45 },
  { name: "MEDIUM", halfLifeMilliseconds: 110 },
  { name: "LONG", halfLifeMilliseconds: 300 },
  { name: "INK", halfLifeMilliseconds: 900 },
];

export const PHOSPHORS: readonly { readonly name: string; readonly color: BeamColor }[] = [
  { name: "GREEN", color: { red: 0.25, green: 1, blue: 0.45 } },
  { name: "AMBER", color: { red: 1, green: 0.68, blue: 0.2 } },
  { name: "BLUE", color: { red: 0.55, green: 0.8, blue: 1 } },
];

export interface ScopeProgram {
  readonly name: string;
  readonly create: () => TunableSource;
}

const lissajous = (ratioX: number, ratioY: number, drift: number): ScopeProgram => ({
  name: `LISSAJOUS ${ratioX}:${ratioY}`,
  create: () => new LissajousSource({ frequency: BASE_FREQUENCY, ratioX, ratioY, drift }),
});

// Things to look at and listen to: first the classic two-sine figures, then shapes
// traced by the beam and turned slowly as they play.
export const PROGRAMS: readonly ScopeProgram[] = [
  lissajous(1, 1, 0.11),
  lissajous(1, 2, 0.09),
  lissajous(2, 3, 0.07),
  lissajous(3, 4, 0.06),
  lissajous(3, 5, 0.05),
  { name: "STAR", create: () => new PathSource(starPath(), { frequency: BASE_FREQUENCY, roll: 0.1, yaw: 0 }) },
  { name: "TRIANGLE", create: () => new PathSource(trianglePath(), { frequency: BASE_FREQUENCY, roll: 0.04, yaw: 0.13 }) },
  { name: "SPIRAL", create: () => new PathSource(spiralPath(), { frequency: BASE_FREQUENCY, roll: 0.25, yaw: 0 }) },
  { name: "HEART", create: () => new PathSource(heartPath(), { frequency: BASE_FREQUENCY, roll: 0, yaw: 0.12 }) },
  { name: "CUBE", create: () => new PathSource(cubePath(), { frequency: BASE_FREQUENCY, roll: 0.02, yaw: 0.09, tilt: 0.5 }) },
  { name: "OCTAHEDRON", create: () => new PathSource(octahedronPath(), { frequency: BASE_FREQUENCY, roll: 0.03, yaw: 0.1, tilt: 0.45 }) },
  { name: "VECTOR", create: () => new PathSource(textPath("VECTOR"), { frequency: BASE_FREQUENCY, roll: 0, yaw: 0 }) },
];

const AUTO_SECONDS = 12;
// Never draw more than this many samples in one frame, however long the frame took.
const MAX_SAMPLES_PER_FRAME = 4096;
// Share of the screen's shorter side that a full-scale signal reaches from the centre.
const FULL_SCALE_SHARE = 0.46;
// A real beam is dimmer the faster it moves, since it spends less time on each
// spot. Segments are sorted by length (the distance covered in one sample) into
// these brightness steps; each step is twice as fast as the one before.
const SPEED_STEPS: readonly number[] = [1, 0.74, 0.5, 0.32, 0.19, 0.1];
// Distance per sample, in full-scale units, at which the beam starts to dim.
const SLOW_BEAM = 0.012;
const BEAM_INTENSITY = 0.75;
const GRATICULE_DIVISIONS = 8;

const HELP_LINES = [
  "S SOUND ON/OFF   LEFT / RIGHT FIGURE   UP / DOWN PITCH   [ ] MOTION   - + VOLUME   O OPEN AUDIO FILE",
  "A AUTO   T TRAILS   K PHOSPHOR   G GRID   SPACE PAUSE   H HUD   F FULLSCREEN   ESC MENU",
];

export interface OscilloscopeOptions {
  readonly programIndex: number;
}

// An XY oscilloscope. The left channel moves the beam across and the right channel
// moves it up, and that is the entire display: no shape is ever drawn as a shape.
// Before the sound is switched on the same signal runs silently, so the picture
// seen then is the picture heard afterwards.
export class OscilloscopeDemo implements Demo {
  public readonly engine: ScopeEngine;
  public isPaused = false;
  public autoCycle = true;
  public showGraticule = true;
  public trailIndex = 1;
  public phosphorIndex = 0;
  public motionIndex = 2;
  public semitones = 0;
  // Set by the page: whether real audio is playing, and how loud.
  public soundOn = false;
  public volume = 0.18;
  public onTrailChange: (halfLifeMilliseconds: number) => void = () => {};

  private readonly hud = new DemoHud();
  private readonly steps: DynamicGeometry[] = SPEED_STEPS.map(() => new DynamicGeometry(1024));
  private readonly graticule = new DynamicGeometry(128);
  private readonly left = new Float32Array(MAX_SAMPLES_PER_FRAME + 1);
  private readonly right = new Float32Array(MAX_SAMPLES_PER_FRAME + 1);
  private programIndex: number;
  private tunable: TunableSource | null;
  private recording: { readonly name: string; readonly source: RecordedSource } | null = null;
  // Reports the sample being heard, while real audio is running.
  private audioPlayhead: (() => number) | null = null;
  private playheadSample = 0;
  private drawnUntil = 0;
  private lastFrameSeconds: number | null = null;
  // Samples in the most recent frame, redrawn while paused so the picture holds.
  private heldSamples = 0;
  private autoSeconds = 0;
  private segmentCount = 0;

  public constructor(options: OscilloscopeOptions) {
    this.programIndex = options.programIndex % PROGRAMS.length;
    this.tunable = PROGRAMS[this.programIndex].create();
    this.engine = new ScopeEngine(this.tunable, DEFAULT_SAMPLE_RATE);
    this.hud.showBanner(PROGRAMS[this.programIndex].name);
  }

  public get program(): number {
    return this.programIndex;
  }

  public get programName(): string {
    return this.recording ? `FILE ${this.recording.name}` : PROGRAMS[this.programIndex].name;
  }

  public get frequency(): number {
    return BASE_FREQUENCY * 2 ** (this.semitones / 12);
  }

  // The sample at the tip of the beam: the one being heard, if sound is on.
  public get playhead(): number {
    return this.playheadSample;
  }

  public get hasRecording(): boolean {
    return this.recording !== null;
  }

  public update(deltaSeconds: number): void {
    this.hud.update(deltaSeconds);
    if (this.isPaused || !this.autoCycle || this.recording) return;
    this.autoSeconds += deltaSeconds;
    if (this.autoSeconds >= AUTO_SECONDS) this.changeProgram(1);
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    const elapsed = this.lastFrameSeconds === null ? 0 : Math.max(0, frame.seconds - this.lastFrameSeconds);
    this.lastFrameSeconds = frame.seconds;
    if (this.audioPlayhead) this.playheadSample = Math.max(this.playheadSample, this.audioPlayhead());
    else if (!this.isPaused) this.playheadSample += Math.round(elapsed * this.engine.sampleRate);

    // Draw what has played since the last frame. If nothing has (a pause), hold the last picture.
    let count = Math.min(MAX_SAMPLES_PER_FRAME, this.playheadSample - this.drawnUntil);
    if (count > 0) this.heldSamples = count;
    else count = this.heldSamples;
    this.drawnUntil = this.playheadSample;

    const centreX = frame.width / 2;
    const centreY = frame.height / 2;
    const fullScale = Math.min(frame.width, frame.height) * FULL_SCALE_SHARE;
    const color = PHOSPHORS[this.phosphorIndex].color;
    if (this.showGraticule) this.drawGraticule(displayList, centreX, centreY, fullScale, color);

    for (const geometry of this.steps) geometry.clear();
    if (count > 0) {
      const start = Math.max(0, this.playheadSample - count);
      const { left, right } = this;
      // One extra sample before the window, so the trace joins on to the previous frame's.
      const lead = start > 0 ? 1 : 0;
      this.engine.copy(start - lead, count + lead, left, right);
      let lastStep = -1;
      for (let index = 1; index < count + lead; index++) {
        const distance = Math.hypot(left[index] - left[index - 1], right[index] - right[index - 1]);
        const step = distance <= SLOW_BEAM ? 0 : Math.min(SPEED_STEPS.length - 1, Math.floor(Math.log2(distance / SLOW_BEAM)) + 1);
        const geometry = this.steps[step];
        if (step !== lastStep) geometry.moveTo(centreX + left[index - 1] * fullScale, centreY - right[index - 1] * fullScale);
        geometry.lineTo(centreX + left[index] * fullScale, centreY - right[index] * fullScale);
        lastStep = step;
      }
    }

    this.segmentCount = 0;
    this.steps.forEach((geometry, step) => {
      if (geometry.segmentCount === 0) return;
      this.segmentCount += geometry.segmentCount;
      displayList.setColor(color);
      displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: BEAM_INTENSITY * SPEED_STEPS[step] });
    });
  }

  public drawOverlay(displayList: DisplayList, frame: DemoFrame): void {
    const seconds = this.recording ? this.recording.source.positionSamples / this.engine.sampleRate : 0;
    const first = this.recording
      ? `${fontSafeText(this.programName)}  ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
      : `${this.programName}  ${this.frequency.toFixed(1)} HZ  MOTION ${MOTIONS[this.motionIndex]}X`;
    this.hud.draw(displayList, {
      title: "OSCILLOSCOPE",
      statusLines: [
        first,
        `SOUND ${this.soundOn ? `ON  VOLUME ${Math.round(this.volume * 100)}` : "OFF - PRESS S"}  TRAILS ${TRAIL_MODES[this.trailIndex].name}  PHOSPHOR ${PHOSPHORS[this.phosphorIndex].name}  AUTO ${this.autoCycle && !this.recording ? "ON" : "OFF"}`,
        `LEFT = X  RIGHT = Y  ${this.engine.sampleRate} HZ  SEGMENTS ${this.segmentCount}${this.isPaused ? "  PAUSED" : ""}`,
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

  public showBanner(text: string): void {
    this.hud.showBanner(text);
  }

  public togglePause(): void {
    this.isPaused = !this.isPaused;
  }

  // Hands the beam's timing to real audio, or (with null) back to the silent clock.
  public followAudio(playhead: (() => number) | null): void {
    this.audioPlayhead = playhead;
    this.soundOn = playhead !== null;
  }

  // Moves to another figure. This also leaves a loaded recording.
  public changeProgram(delta: number): void {
    const count = PROGRAMS.length;
    this.programIndex = this.recording ? this.programIndex : (((this.programIndex + delta) % count) + count) % count;
    this.recording = null;
    this.autoSeconds = 0;
    this.tunable = PROGRAMS[this.programIndex].create();
    this.applyTuning();
    this.engine.setSource(this.tunable);
    this.hud.showBanner(PROGRAMS[this.programIndex].name);
  }

  public changePitch(semitones: number): void {
    this.semitones = Math.max(MIN_SEMITONES, Math.min(MAX_SEMITONES, this.semitones + semitones));
    this.applyTuning();
    this.hud.showBanner(`${this.frequency.toFixed(1)} HZ`);
  }

  public changeMotion(delta: number): void {
    this.motionIndex = Math.max(0, Math.min(MOTIONS.length - 1, this.motionIndex + delta));
    this.applyTuning();
    this.hud.showBanner(`MOTION ${MOTIONS[this.motionIndex]}X`);
  }

  // Plays recorded stereo audio through the scope in place of the built-in figures.
  public loadRecording(name: string, left: Float32Array, right: Float32Array): void {
    const source = new RecordedSource(left, right);
    this.recording = { name: name.toUpperCase(), source };
    this.tunable = null;
    this.engine.setSource(source);
    this.hud.showBanner(fontSafeText(`FILE ${this.recording.name}`));
  }

  public cycleTrails(): void {
    this.trailIndex = (this.trailIndex + 1) % TRAIL_MODES.length;
    this.onTrailChange(TRAIL_MODES[this.trailIndex].halfLifeMilliseconds);
    this.hud.showBanner(`TRAILS ${TRAIL_MODES[this.trailIndex].name}`);
  }

  public cyclePhosphor(): void {
    this.phosphorIndex = (this.phosphorIndex + 1) % PHOSPHORS.length;
    this.hud.showBanner(`PHOSPHOR ${PHOSPHORS[this.phosphorIndex].name}`);
  }

  public toggleGraticule(): void {
    this.showGraticule = !this.showGraticule;
    this.hud.showBanner(`GRID ${this.showGraticule ? "ON" : "OFF"}`);
  }

  public toggleAuto(): void {
    this.autoCycle = !this.autoCycle;
    this.autoSeconds = 0;
    this.hud.showBanner(`AUTO ${this.autoCycle ? "ON" : "OFF"}`);
  }

  // --- Internals -----------------------------------------------------------------------------------------

  private applyTuning(): void {
    if (!this.tunable) return;
    this.tunable.frequency = this.frequency;
    this.tunable.motion = MOTIONS[this.motionIndex];
  }

  // The scope's face: a square frame at full scale, cross-hairs, and division ticks.
  private drawGraticule(displayList: DisplayList, centreX: number, centreY: number, fullScale: number, color: BeamColor): void {
    const geometry = this.graticule;
    geometry.clear();
    geometry.moveTo(centreX - fullScale, centreY - fullScale);
    geometry.lineTo(centreX + fullScale, centreY - fullScale);
    geometry.lineTo(centreX + fullScale, centreY + fullScale);
    geometry.lineTo(centreX - fullScale, centreY + fullScale);
    geometry.closePath();
    geometry.addSegment(centreX - fullScale, centreY, centreX + fullScale, centreY);
    geometry.addSegment(centreX, centreY - fullScale, centreX, centreY + fullScale);
    const tick = fullScale * 0.025;
    for (let division = 1; division < GRATICULE_DIVISIONS; division++) {
      const offset = -fullScale + (division * 2 * fullScale) / GRATICULE_DIVISIONS;
      if (division === GRATICULE_DIVISIONS / 2) continue;
      geometry.addSegment(centreX + offset, centreY - tick, centreX + offset, centreY + tick);
      geometry.addSegment(centreX - tick, centreY + offset, centreX + tick, centreY + offset);
    }
    displayList.setColor(color);
    displayList.addShape(geometry, { ...SCREEN_SPACE_PLACEMENT, intensity: 0.1 });
  }
}
