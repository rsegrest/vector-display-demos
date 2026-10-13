import { LeniaRunner } from "./sim/LeniaRunner.js";
import type { SimulationFrame, ToSimulation } from "./sim/protocol.js";

// The page's side of the simulation. Holds the two most recent fields and blends between them, so
// contours move smoothly at the display rate even though the simulation steps only ~30 times a second.
export class LeniaClient {
  public latest: SimulationFrame | null = null;
  public readonly isUsingWorker: boolean;
  private previousCells: Float32Array | null = null;
  private readonly previousBuffer: Float32Array;
  private latestArrival = 0;
  private stepIntervalMilliseconds = 33;
  private readonly blended: Float32Array;
  private readonly send: (message: ToSimulation) => void;

  public constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.blended = new Float32Array(width * height);
    this.previousBuffer = new Float32Array(width * height);
    const receive = (frame: SimulationFrame) => this.receive(frame);
    let send: ((message: ToSimulation) => void) | null = null;
    try {
      const worker = new Worker(new URL("./worker/leniaWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<SimulationFrame>) => receive(event.data);
      send = (message) => worker.postMessage(message);
    } catch (error) {
      console.warn("Lenia worker unavailable; simulating on the main thread", error);
    }
    if (send) {
      this.isUsingWorker = true;
    } else {
      const runner = new LeniaRunner((frame) => receive(frame));
      send = (message) => runner.handle(message);
      this.isUsingWorker = false;
    }
    this.send = send;
    this.send({ type: "init", width, height });
  }

  public load(speciesIndex: number, seed: number): void {
    this.previousCells = null;
    this.send({ type: "load", speciesIndex, seed });
  }

  public drop(x: number, y: number): void {
    this.send({ type: "drop", x, y });
  }

  public erase(x: number, y: number, radius: number): void {
    this.send({ type: "erase", x, y, radius });
  }

  public setRate(stepsPerSecond: number): void {
    this.send({ type: "rate", stepsPerSecond });
  }

  public setPaused(isPaused: boolean): void {
    this.send({ type: "pause", isPaused });
  }

  public stepOnce(): void {
    this.send({ type: "step" });
  }

  // The field between the last two steps, by how far we are into the current step interval.
  public blendedField(now: number): Float32Array | null {
    const latest = this.latest;
    if (!latest) return null;
    const previous = this.previousCells;
    if (!previous) return latest.cells;
    const amount = Math.min(1, (now - this.latestArrival) / this.stepIntervalMilliseconds);
    const current = latest.cells;
    const blended = this.blended;
    for (let i = 0; i < blended.length; i++) blended[i] = previous[i] + (current[i] - previous[i]) * amount;
    return blended;
  }

  private receive(frame: SimulationFrame): void {
    const now = performance.now();
    const isNextStep = this.latest !== null && frame.stepCount === this.latest.stepCount + 1;
    if (isNextStep) {
      // Smooth the measured interval so one late frame does not make the motion lurch.
      this.stepIntervalMilliseconds = this.stepIntervalMilliseconds * 0.8 + Math.min(250, now - this.latestArrival) * 0.2;
      // Blend onward from what is on screen right now, so a new step never makes the contours jump.
      this.previousBuffer.set(this.blendedField(now)!);
      this.previousCells = this.previousBuffer;
    } else {
      this.previousCells = null;
    }
    this.latest = frame;
    this.latestArrival = now;
  }
}
