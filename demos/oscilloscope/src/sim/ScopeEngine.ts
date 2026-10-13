import type { SignalSource } from "./signals.js";

// A little over a second at 96 kHz; must be a power of two.
const CAPACITY = 131072;
const MASK = CAPACITY - 1;
const BLOCK = 1024;

// The single stream of samples that both the speakers and the screen take from.
//
// Samples are numbered from zero and never renumbered. The engine generates them
// from the current source on demand and remembers the most recent second or so.
// Audio output asks for samples a little ahead of now, to schedule them; the scope
// asks for the ones being heard at this moment. Because both read the same numbered
// stream, what is drawn is exactly what is playing.
export class ScopeEngine {
  public sampleRate: number;

  private readonly left = new Float32Array(CAPACITY);
  private readonly right = new Float32Array(CAPACITY);
  private readonly blockLeft = new Float32Array(BLOCK);
  private readonly blockRight = new Float32Array(BLOCK);
  private generatedCount = 0;

  public constructor(
    private source: SignalSource,
    sampleRate: number,
  ) {
    this.sampleRate = sampleRate;
  }

  // How many samples exist so far; the next one generated will have this number.
  public get generated(): number {
    return this.generatedCount;
  }

  // The oldest sample still remembered.
  public get oldestAvailable(): number {
    return Math.max(0, this.generatedCount - CAPACITY);
  }

  // Takes effect from the next sample generated; samples already made are not changed.
  public setSource(source: SignalSource): void {
    this.source = source;
  }

  // Generates samples until at least `sampleCount` exist.
  public ensure(sampleCount: number): void {
    while (this.generatedCount < sampleCount) {
      const count = Math.min(BLOCK, sampleCount - this.generatedCount);
      this.source.render(this.blockLeft, this.blockRight, count, this.sampleRate);
      for (let index = 0; index < count; index++) {
        const slot = (this.generatedCount + index) & MASK;
        this.left[slot] = this.blockLeft[index];
        this.right[slot] = this.blockRight[index];
      }
      this.generatedCount += count;
    }
  }

  // Copies samples start .. start + count - 1 into `left` and `right`, generating
  // them first if need be. Samples too old to be remembered come back as silence.
  public copy(start: number, count: number, left: Float32Array, right: Float32Array): void {
    this.ensure(start + count);
    const oldest = this.oldestAvailable;
    for (let index = 0; index < count; index++) {
      const sample = start + index;
      if (sample < oldest) {
        left[index] = right[index] = 0;
        continue;
      }
      left[index] = this.left[sample & MASK];
      right[index] = this.right[sample & MASK];
    }
  }
}
