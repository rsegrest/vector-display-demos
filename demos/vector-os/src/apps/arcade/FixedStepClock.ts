// Turns the time that has passed into a whole number of a game's own steps.
//
// The OS updates its programs at its own rate, sixty times a second. The games
// were not built for that: Asteroids steps 62.5 times a second, Lunar Lander
// 41.7, Battlezone and Tempest 246.1, because those are the rates their boards
// ran at, and what they do in a step is what the board did. So each game keeps
// its own count of the steps it is owed, runs the whole ones, and carries the
// fraction to the next update, as the game's own page does on each display frame.
//
// After a stall (a hidden tab, a slow frame) the pages make up only so many
// steps at once and drop the rest, rather than racing to catch up; so does this.
export class FixedStepClock {
  // Owed steps, counted in steps rather than seconds so that rounding cannot pile up.
  private owedSteps = 0;

  public constructor(
    public readonly stepsPerSecond: number,
    public readonly mostStepsAtOnce: number,
  ) {}

  // How many whole steps are due after `seconds` more have passed.
  public advance(seconds: number): number {
    this.owedSteps += Math.max(0, seconds) * this.stepsPerSecond;
    // The tiny allowance keeps 1/60 s × 60 steps a second from coming to 0.99999.
    const steps = Math.floor(this.owedSteps + 1e-9);
    if (steps > this.mostStepsAtOnce) {
      this.owedSteps = 0;
      return this.mostStepsAtOnce;
    }
    this.owedSteps = Math.max(0, this.owedSteps - steps);
    return steps;
  }
}
