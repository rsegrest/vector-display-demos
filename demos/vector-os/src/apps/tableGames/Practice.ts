import { TABLE_GAMES, type BattleshipState, type GameId, type GameInfo, type Seat } from "@vector-demos/table-games";

// A game played on one screen, both sides by whoever is at it, taking turns: for trying a game
// with nobody else in the room, and with no server at all. The same rules the room server runs.
export class Practice {
  private state: unknown;
  private resignedBy: Seat | null = null;

  public constructor(
    public readonly game: GameId,
    private readonly random: () => number = Math.random,
  ) {
    this.state = TABLE_GAMES[game].start(random);
  }

  // The side now at the board: the one to move, or while ships are placed, the first not yet ready.
  public get actingSeat(): Seat {
    const rules = TABLE_GAMES[this.game];
    const turn = rules.turn(this.state);
    if (turn !== null) return turn;
    if (this.game === "battleship" && !rules.outcome(this.state)) return (this.state as BattleshipState).fleets[0].isReady ? 1 : 0;
    return 0;
  }

  // What the board shows: the acting side's view, so Battleship hides the other side's ships
  // (pass the screen over, and the next player looks away while the first places theirs).
  public get info(): GameInfo {
    const rules = TABLE_GAMES[this.game];
    return {
      game: this.game,
      seats: ["practice-0", "practice-1"],
      view: rules.viewFor(this.state, this.actingSeat),
      turn: this.resignedBy === null ? rules.turn(this.state) : null,
      outcome: this.resignedBy === null ? rules.outcome(this.state) : { kind: "win", winner: this.resignedBy === 0 ? 1 : 0 },
      resignedBy: this.resignedBy,
    };
  }

  // A move by the acting side; the reason it was refused, or null.
  public play(move: unknown): string | null {
    if (this.info.outcome) return "The game is over";
    const result = TABLE_GAMES[this.game].play(this.state, this.actingSeat, move, this.random);
    if (!result.ok) return result.error;
    this.state = result.state;
    return null;
  }

  public resign(): void {
    if (!this.info.outcome) this.resignedBy = this.actingSeat;
  }
}
