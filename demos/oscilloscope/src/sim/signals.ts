// Stereo signal sources. Left is the beam's horizontal position and right its
// vertical position, both from -1 to 1, so every source here is at once a waveform
// to listen to and a picture to look at. Sources produce samples in order and keep
// their own phase, so however the output is chopped into blocks the signal is the same.

import { samplePath, type ScopePath } from "./paths.js";

export interface SignalSource {
  // Writes the next `count` samples into the start of `left` and `right`.
  render(left: Float32Array, right: Float32Array, count: number, sampleRate: number): void;
}

// Sources that can be played higher or lower, and whose slow movement can be sped up.
export interface TunableSource extends SignalSource {
  // Pitch of the fundamental, in hertz.
  frequency: number;
  // Multiplier on the source's slow motion (drift, spin).
  motion: number;
}

const TWO_PI = Math.PI * 2;
// Signals stay a little inside full scale, which also keeps the picture off the edge of the screen.
export const AMPLITUDE = 0.85;

export interface LissajousSettings {
  readonly frequency: number;
  // Left and right frequencies, as multiples of the fundamental.
  readonly ratioX: number;
  readonly ratioY: number;
  // How fast the left channel's phase slides against the right, in turns per second.
  // This is what makes the figure appear to rotate.
  readonly drift: number;
}

// Two sine waves, one per channel. Their frequency ratio sets the figure's shape:
// 1:1 is an ellipse, 1:2 a figure of eight, 2:3 a pretzel, and so on.
export class LissajousSource implements TunableSource {
  public frequency: number;
  public motion = 1;
  private phaseX = 0;
  private phaseY = 0;
  private offset = 0;

  public constructor(private readonly settings: LissajousSettings) {
    this.frequency = settings.frequency;
  }

  public render(left: Float32Array, right: Float32Array, count: number, sampleRate: number): void {
    const { ratioX, ratioY, drift } = this.settings;
    const stepX = (this.frequency * ratioX) / sampleRate;
    const stepY = (this.frequency * ratioY) / sampleRate;
    const stepOffset = (drift * this.motion) / sampleRate;
    for (let index = 0; index < count; index++) {
      left[index] = AMPLITUDE * Math.sin(TWO_PI * (this.phaseX + this.offset));
      right[index] = AMPLITUDE * Math.sin(TWO_PI * this.phaseY);
      this.phaseX += stepX;
      this.phaseY += stepY;
      this.offset += stepOffset;
      if (this.phaseX >= 1) this.phaseX -= Math.floor(this.phaseX);
      if (this.phaseY >= 1) this.phaseY -= Math.floor(this.phaseY);
      if (this.offset >= 1) this.offset -= 1;
    }
  }
}

export interface PathSettings {
  readonly frequency: number;
  // Turns per second about the axis pointing at the viewer: the shape spins like a wheel.
  readonly roll: number;
  // Turns per second about the vertical axis: the shape turns like a revolving door.
  readonly yaw: number;
  // A fixed tilt toward the viewer, in radians, so solid shapes are seen from above.
  readonly tilt?: number;
}

// How strongly distance shrinks things: 0 is a flat, parallel projection.
const PERSPECTIVE = 0.28;

// Traces a path once per cycle while turning it slowly. The turning happens sample
// by sample, so a rotating cube is not a sequence of frames but one continuous
// signal, which is why it sounds like a chord that slowly shifts.
export class PathSource implements TunableSource {
  public frequency: number;
  public motion = 1;
  private tour = 0;
  private roll = 0;
  private yaw = 0;
  private hint = 0;
  private readonly point: [number, number, number] = [0, 0, 0];

  public constructor(
    private readonly path: ScopePath,
    private readonly settings: PathSettings,
  ) {
    this.frequency = settings.frequency;
  }

  public render(left: Float32Array, right: Float32Array, count: number, sampleRate: number): void {
    const { path, point } = this;
    const tourStep = this.frequency / sampleRate;
    const rollStep = (this.settings.roll * this.motion) / sampleRate;
    const yawStep = (this.settings.yaw * this.motion) / sampleRate;
    const tilt = this.settings.tilt ?? 0;
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    for (let index = 0; index < count; index++) {
      this.hint = samplePath(path, this.tour, this.hint, point);
      const cosRoll = Math.cos(TWO_PI * this.roll);
      const sinRoll = Math.sin(TWO_PI * this.roll);
      const cosYaw = Math.cos(TWO_PI * this.yaw);
      const sinYaw = Math.sin(TWO_PI * this.yaw);
      // Roll in the picture plane, then yaw about the vertical, then tilt toward the viewer.
      const rolledX = point[0] * cosRoll - point[1] * sinRoll;
      const rolledY = point[0] * sinRoll + point[1] * cosRoll;
      const yawedX = rolledX * cosYaw + point[2] * sinYaw;
      const yawedZ = -rolledX * sinYaw + point[2] * cosYaw;
      const tiltedY = rolledY * cosTilt - yawedZ * sinTilt;
      const tiltedZ = rolledY * sinTilt + yawedZ * cosTilt;
      const scale = AMPLITUDE / (1 + PERSPECTIVE * (1 - tiltedZ));
      left[index] = yawedX * scale;
      right[index] = tiltedY * scale;

      this.tour += tourStep;
      if (this.tour >= 1) {
        this.tour -= Math.floor(this.tour);
        this.hint = 0;
      }
      this.roll += rollStep;
      this.yaw += yawStep;
      if (this.roll >= 1) this.roll -= 1;
      if (this.yaw >= 1) this.yaw -= 1;
    }
  }
}

// Plays recorded stereo audio, looping at the end. Recordings made for the purpose
// ("oscilloscope music") draw pictures; anything else draws its own stereo field.
export class RecordedSource implements SignalSource {
  private position = 0;

  public constructor(
    private readonly leftChannel: Float32Array,
    private readonly rightChannel: Float32Array,
  ) {}

  public get lengthSamples(): number {
    return this.leftChannel.length;
  }

  // The sample that will be produced next.
  public get positionSamples(): number {
    return this.position;
  }

  public rewind(): void {
    this.position = 0;
  }

  public render(left: Float32Array, right: Float32Array, count: number): void {
    const length = this.leftChannel.length;
    for (let index = 0; index < count; index++) {
      if (length === 0) {
        left[index] = right[index] = 0;
        continue;
      }
      left[index] = this.leftChannel[this.position];
      right[index] = this.rightChannel[this.position];
      this.position = this.position + 1 === length ? 0 : this.position + 1;
    }
  }
}
