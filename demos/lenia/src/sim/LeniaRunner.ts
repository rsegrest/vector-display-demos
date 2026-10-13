import { LeniaSession } from "./LeniaSession.js";
import type { PostFrame, ToSimulation } from "./protocol.js";

// Most steps run per tick when catching up, so a slow machine slows the simulation down instead of freezing.
const MAX_STEPS_PER_TICK = 2;

// Steps a LeniaSession at a steady rate and posts a copy of the field after each tick.
// The same code runs inside the worker and, if workers are unavailable, on the main thread.
export class LeniaRunner {
  private session: LeniaSession | null = null;
  private stepsPerSecond = 30;
  private isPaused = false;
  private stepDebt = 0;
  private lastTickTime = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  public constructor(private readonly post: PostFrame) {}

  public handle(message: ToSimulation): void {
    switch (message.type) {
      case "init":
        this.session = new LeniaSession(message.width, message.height);
        this.lastTickTime = performance.now();
        this.schedule();
        break;
      case "load":
        this.session?.loadSpecies(message.speciesIndex, message.seed);
        this.postFrame();
        break;
      case "drop":
        this.session?.dropCreature(message.x, message.y);
        this.postFrame();
        break;
      case "erase":
        this.session?.erase(message.x, message.y, message.radius);
        this.postFrame();
        break;
      case "rate":
        this.stepsPerSecond = message.stepsPerSecond;
        break;
      case "pause":
        this.isPaused = message.isPaused;
        this.stepDebt = 0;
        break;
      case "step":
        this.session?.step();
        this.postFrame();
        break;
    }
  }

  public stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = performance.now();
    const elapsedSeconds = Math.min(0.25, (now - this.lastTickTime) / 1000);
    this.lastTickTime = now;
    if (this.session && !this.isPaused) {
      this.stepDebt = Math.min(MAX_STEPS_PER_TICK, this.stepDebt + elapsedSeconds * this.stepsPerSecond);
      let stepped = false;
      while (this.stepDebt >= 1) {
        this.session.step();
        this.stepDebt -= 1;
        stepped = true;
      }
      if (stepped) this.postFrame();
    }
    this.schedule();
  }

  private schedule(): void {
    const untilNextStep = this.isPaused ? 50 : Math.max(0, ((1 - this.stepDebt) / this.stepsPerSecond) * 1000);
    this.timer = setTimeout(() => this.tick(), untilNextStep);
  }

  private postFrame(): void {
    const session = this.session;
    if (!session) return;
    const cells = Float32Array.from(session.world.cells);
    this.post(
      {
        type: "frame",
        cells,
        stepCount: session.stepCount,
        mass: session.world.mass(),
        seededMass: session.seededMass,
        speciesIndex: session.speciesIndex,
        placedCount: session.placedCount,
      },
      [cells.buffer],
    );
  }
}
