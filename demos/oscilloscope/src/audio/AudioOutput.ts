import type { ScopeEngine } from "../sim/ScopeEngine.js";

// Samples are handed to the browser in blocks this long...
const BLOCK_SAMPLES = 2048;
// ...scheduled this far ahead of the moment they are heard...
const LOOKAHEAD_SECONDS = 0.18;
// ...by a timer that wakes this often.
const TIMER_MILLISECONDS = 40;
const START_DELAY_SECONDS = 0.06;

// Plays the engine's samples through Web Audio.
//
// Blocks of samples are scheduled back to back on the audio clock, a little ahead
// of time, which gives gapless playback without a custom audio thread. The output
// also knows which numbered sample is being heard at any instant, which is what the
// scope needs in order to draw the sound that is actually playing.
export class AudioOutput {
  public readonly context: AudioContext;

  private readonly gain: GainNode;
  private timer: number | null = null;
  // Sample `anchorSample` is heard at audio time `anchorTime`.
  private anchorSample = 0;
  private anchorTime = 0;
  // The next sample to schedule.
  private nextSample = 0;
  private volumeValue = 0.18;
  private muted = false;

  public constructor(private readonly engine: ScopeEngine) {
    this.context = new AudioContext({ latencyHint: "interactive" });
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volumeValue;
    this.gain.connect(this.context.destination);
    engine.sampleRate = this.context.sampleRate;
  }

  public get isRunning(): boolean {
    return this.timer !== null && this.context.state === "running";
  }

  public get volume(): number {
    return this.volumeValue;
  }

  public get isMuted(): boolean {
    return this.muted;
  }

  // Begins playback with sample `fromSample`, so the picture carries straight on
  // from the silent preview. Must be called from a key press or click.
  public async start(fromSample: number): Promise<void> {
    await this.context.resume();
    if (this.timer !== null) return;
    this.anchor(fromSample);
    this.pump();
    this.timer = window.setInterval(() => this.pump(), TIMER_MILLISECONDS);
  }

  public async stop(): Promise<void> {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    await this.context.suspend();
  }

  // The sample being heard right now.
  public playheadSample(): number {
    return Math.max(0, Math.floor(this.anchorSample + (this.context.currentTime - this.anchorTime) * this.context.sampleRate));
  }

  public setVolume(volume: number): void {
    this.volumeValue = Math.max(0, Math.min(1, volume));
    this.applyGain();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  // Turns recorded audio (any format the browser can read) into two channels at the output's sample rate.
  public async decode(data: ArrayBuffer): Promise<{ left: Float32Array; right: Float32Array }> {
    const buffer = await this.context.decodeAudioData(data);
    const left = buffer.getChannelData(0);
    // A mono recording drives both channels alike, which draws as a diagonal line.
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    return { left, right };
  }

  private applyGain(): void {
    this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volumeValue, this.context.currentTime, 0.02);
  }

  private anchor(sample: number): void {
    this.anchorSample = sample;
    this.anchorTime = this.context.currentTime + START_DELAY_SECONDS;
    this.nextSample = sample;
  }

  private pump(): void {
    const { context, engine } = this;
    if (context.state !== "running") return;
    const sampleRate = context.sampleRate;
    let nextTime = this.anchorTime + (this.nextSample - this.anchorSample) / sampleRate;
    // The timer was held up (a background tab, say) and the schedule has run dry.
    // Carry on from the next unplayed sample rather than playing a backlog late.
    if (nextTime < context.currentTime) {
      this.anchor(this.nextSample);
      nextTime = this.anchorTime;
    }
    while (nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
      const buffer = context.createBuffer(2, BLOCK_SAMPLES, sampleRate);
      engine.copy(this.nextSample, BLOCK_SAMPLES, buffer.getChannelData(0), buffer.getChannelData(1));
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(this.gain);
      node.start(nextTime);
      this.nextSample += BLOCK_SAMPLES;
      nextTime += BLOCK_SAMPLES / sampleRate;
    }
  }
}
