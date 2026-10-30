import { rulesFor, simpleChoice, type GameId, type Outcome, type Seat } from "@vector-demos/table-games";

// A computer player in practice waits this long before moving, so its move can be followed.
const COMPUTER_PAUSE_SECONDS = 0.7;

// A game played in this window alone, with no room and no server: every seat either a person at
// this screen (taking turns) or the simple computer player. The same rules the room server runs.
export class Practice {
  private state: unknown;
  private endedEarly: Outcome | null = null;
  private computerWait = 0;
  public readonly names: readonly string[];

  public constructor(
    public readonly game: GameId,
    // For each seat, whether the computer plays it.
    public readonly isComputer: readonly boolean[],
    private readonly random: () => number = Math.random,
  ) {
    this.state = rulesFor(game).start(isComputer.length, random);
    let person = 0;
    let computer = 0;
    const computers = isComputer.filter(Boolean).length;
    this.names = isComputer.map((byComputer) => (byComputer ? (computers === 1 ? "Computer" : `Computer ${++computer}`) : `Player ${++person}`));
  }

  public get toMove(): readonly Seat[] {
    return this.outcome ? [] : rulesFor(this.game).toMove(this.state);
  }

  public get outcome(): Outcome | null {
    return this.endedEarly ?? rulesFor(this.game).outcome(this.state);
  }

  // The seat the screen shows: the first person to move (when several move at once, one after
  // another), or the first person at all. Its view hides what the other seats keep to themselves.
  public get actingSeat(): Seat {
    const people = this.isComputer.flatMap((byComputer, seat) => (byComputer ? [] : [seat]));
    return this.toMove.find((seat) => !this.isComputer[seat]) ?? people[0] ?? 0;
  }

  public get view(): unknown {
    return rulesFor(this.game).viewFor(this.state, this.actingSeat);
  }

  // A move by the acting seat; the reason it was refused, or null.
  public play(move: unknown): string | null {
    if (this.outcome) return "The game is over";
    const result = rulesFor(this.game).play(this.state, this.actingSeat, move, this.random);
    if (!result.ok) return result.error;
    this.state = result.state;
    return null;
  }

  // Lets a computer player move, after a short pause.
  public update(deltaSeconds: number): void {
    const seat = this.toMove.find((each) => this.isComputer[each]);
    if (seat === undefined) {
      this.computerWait = 0;
      return;
    }
    this.computerWait += deltaSeconds;
    if (this.computerWait < (rulesFor(this.game).computerPauseSeconds ?? COMPUTER_PAUSE_SECONDS)) return;
    this.computerWait = 0;
    const rules = rulesFor(this.game);
    const decision = simpleChoice({ game: rules, state: this.state, view: rules.viewFor(this.state, seat), seat, random: this.random });
    if (!decision) return;
    const result = rules.play(this.state, seat, decision.choice.move, this.random);
    if (result.ok) this.state = result.state;
  }

  // Ends the game now: scored by the game's own count if it has one (chips), otherwise undecided.
  public stop(): void {
    if (this.outcome) return;
    const rules = rulesFor(this.game);
    this.endedEarly = rules.finish ? rules.finish(this.state) : { winners: [], summary: "Stopped" };
  }
}
