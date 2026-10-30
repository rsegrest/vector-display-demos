import { describe, expect, it } from "vitest";
import {
  chooseMove,
  drawByProbability,
  findAnswers,
  isRoomCode,
  jevChoice,
  readClientMessage,
  Room,
  roomCodeFrom,
  rulesFor,
  simpleChoice,
  type BattleshipView,
  type ConnectFourState,
  type Delivery,
  type ServerMessage,
  type TableInfo,
} from "../src/index.js";

const TOKEN_A = "token-for-alice-000001";
const TOKEN_B = "token-for-bob-00000002";
const TOKEN_C = "token-for-carol-000003";
const random = (): number => 0.42;

function joined(room: Room, token: string, name: string, now = 1000): string {
  const result = room.join(token, name, now);
  if (!result.ok) throw new Error(result.error);
  return result.memberId;
}

function messagesTo(deliveries: Delivery[], memberId: string, type: ServerMessage["type"]): ServerMessage[] {
  return deliveries.filter((delivery) => delivery.to === memberId && delivery.message.type === type).map((delivery) => delivery.message);
}

function tableTo(deliveries: Delivery[], memberId: string): TableInfo | null {
  const [message] = messagesTo(deliveries, memberId, "table");
  if (message?.type !== "table") throw new Error("no table sent");
  return message.table;
}

function errorTo(deliveries: Delivery[], memberId: string): string | undefined {
  const [message] = messagesTo(deliveries, memberId, "error");
  return message?.type === "error" ? message.message : undefined;
}

// A room with Alice and Bob in it, Alice having opened a Connect 4 table and Bob sat down (which starts it).
function connectFourGame(): { room: Room; alice: string; bob: string; carol: string } {
  const room = Room.empty("ABCDEF");
  const alice = joined(room, TOKEN_A, "Alice");
  const bob = joined(room, TOKEN_B, "Bob");
  const carol = joined(room, TOKEN_C, "Carol");
  room.receive(alice, { type: "open", game: "connect4", invite: null }, 1, random);
  room.receive(bob, { type: "sit" }, 1, random);
  return { room, alice, bob, carol };
}

describe("room codes and messages", () => {
  it("makes six-letter codes from the unambiguous alphabet", () => {
    const code = roomCodeFrom([0, 31, 32, 255, 100, 7]);
    expect(code).toBe("A9A9EH");
    expect(isRoomCode(code)).toBe(true);
    expect(isRoomCode("ABCDE0")).toBe(false);
    expect(isRoomCode("abcdef")).toBe(false);
  });

  it("reads only well-formed client messages", () => {
    expect(readClientMessage('{"type":"chat","text":"hi"}')).toEqual({ type: "chat", text: "hi" });
    expect(readClientMessage('{"type":"open","game":"connect4","invite":null}')).toEqual({ type: "open", game: "connect4", invite: null });
    expect(readClientMessage('{"type":"sit"}')).toEqual({ type: "sit" });
    expect(readClientMessage('{"type":"hello","token":"short","name":"x"}')).toBeNull();
    expect(readClientMessage('{"type":"open","game":"go"}')).toBeNull();
    expect(readClientMessage("not json")).toBeNull();
    expect(readClientMessage(`{"type":"chat","text":"${"x".repeat(5000)}"}`)).toBeNull();
  });
});

describe("Room", () => {
  it("welcomes a member with the history and tells everyone who is here", () => {
    const room = Room.empty("ABCDEF", { computerName: "Jev" });
    const alice = joined(room, TOKEN_A, "Alice");
    room.receive(alice, { type: "chat", text: "  hello\u0007   there " }, 2000, random);
    const result = room.join(TOKEN_B, "Bob", 3000);
    if (!result.ok) throw new Error(result.error);
    const bob = result.memberId;
    expect(messagesTo(result.deliveries, bob, "welcome")).toEqual([{ type: "welcome", you: "m2", room: "ABCDEF", computerName: "Jev" }]);
    expect(messagesTo(result.deliveries, bob, "chat")).toEqual([{ type: "chat", entries: [{ from: alice, name: "Alice", text: "hello there", at: 2000 }] }]);
    expect(messagesTo(result.deliveries, alice, "members")[0]).toEqual({
      type: "members",
      members: [
        { id: "m1", name: "Alice", isOnline: true },
        { id: "m2", name: "Bob", isOnline: true },
      ],
    });
  });

  it("keeps a member who comes back with the same token, and never sends tokens", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    expect(room.leave(alice, 5000)).toEqual([]);
    const again = room.join(TOKEN_A, "Alice 2", 6000);
    expect(again.ok && again.memberId).toBe(alice);
    expect(JSON.stringify(again)).not.toContain(TOKEN_A);
  });

  it("limits chat to a few lines at a time and keeps the last fifty", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    for (let line = 0; line < 5; line++) room.receive(alice, { type: "chat", text: `line ${line}` }, 10_000 + line, random);
    expect(room.receive(alice, { type: "chat", text: "too fast" }, 10_010, random)).toEqual([{ to: alice, message: { type: "error", message: "Slow down a little" } }]);
    for (let line = 0; line < 60; line++) room.receive(alice, { type: "chat", text: `later ${line}` }, 20_000 + line * 2000, random);
    expect(room.snapshot.chat).toHaveLength(50);
    expect(room.snapshot.chat.at(-1)?.text).toBe("later 59");
  });

  it("opens a table, starts a two-player game when the second seat is taken, and lets others watch", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    const bob = joined(room, TOKEN_B, "Bob");
    const carol = joined(room, TOKEN_C, "Carol");
    const opened = tableTo(room.receive(alice, { type: "open", game: "connect4", invite: bob }, 1, random), carol);
    expect(opened).toMatchObject({ game: "connect4", host: alice, seats: [alice], invited: bob, isStarted: false });
    const started = tableTo(room.receive(bob, { type: "sit" }, 1, random), carol)!;
    expect(started).toMatchObject({ seats: [alice, bob], names: ["Alice", "Bob"], isStarted: true, toMove: [0], invited: null });
    expect(errorTo(room.receive(carol, { type: "sit" }, 1, random), carol)).toBe("There is no table to sit at");
    expect(errorTo(room.receive(carol, { type: "move", move: { column: 3 } }, 1, random), carol)).toBe("You are not playing");
    expect(errorTo(room.receive(bob, { type: "move", move: { column: 3 } }, 1, random), bob)).toBe("Not your turn");
    expect(tableTo(room.receive(alice, { type: "move", move: { column: 3 } }, 1, random), bob)?.toMove).toEqual([1]);
    expect(errorTo(room.receive(carol, { type: "open", game: "checkers", invite: null }, 1, random), carol)).toBe("The table is in use; wait for that game to end");
  });

  it("lets an invited member say no, and the host get up, which clears the table", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    const bob = joined(room, TOKEN_B, "Bob");
    room.receive(alice, { type: "open", game: "checkers", invite: bob }, 1, random);
    expect(tableTo(room.receive(bob, { type: "stand" }, 1, random), alice)?.invited).toBeNull();
    expect(tableTo(room.receive(alice, { type: "stand" }, 1, random), bob)).toBeNull();
  });

  it("ends a game when a player resigns, the other winning, and anyone may then clear the table", () => {
    const { room, alice, bob, carol } = connectFourGame();
    const resigned = tableTo(room.receive(bob, { type: "resign" }, 1, random), alice)!;
    expect(resigned.outcome).toEqual({ winners: [0], summary: "Bob resigned" });
    expect(resigned.toMove).toEqual([]);
    expect(tableTo(room.receive(carol, { type: "close" }, 1, random), alice)).toBeNull();
  });

  it("seats computer players, which the host adds, and hands their turns to the server", () => {
    const room = Room.empty("ABCDEF", { computerName: "Jev" });
    const alice = joined(room, TOKEN_A, "Alice");
    room.receive(alice, { type: "open", game: "connect4", invite: null }, 1, random);
    const started = tableTo(room.receive(alice, { type: "addComputer", skill: "hard" }, 1, random), alice)!;
    expect(started).toMatchObject({ seats: [alice, "c1"], names: ["Alice", "Jev (Hard)"], isComputer: [false, true], isStarted: true });
    expect(room.computerTurn()).toBeNull();
    room.receive(alice, { type: "move", move: { column: 0 } }, 1, random);
    const turn = room.computerTurn()!;
    expect(turn).toMatchObject({ seat: 1, skill: "hard" });
    const decision = simpleChoice({ game: rulesFor(turn.game), state: turn.state, view: turn.view, seat: turn.seat, random })!;
    const after = tableTo(room.computerMove(turn.seat, decision.choice.move, random), alice)!;
    expect((after.view as ConnectFourState).board.flat().filter((cell) => cell === 1)).toHaveLength(1);
    expect(after.toMove).toEqual([0]);
    // A bad choice is replaced by a legal one rather than holding up the game.
    room.receive(alice, { type: "move", move: { column: 0 } }, 1, random);
    expect(tableTo(room.computerMove(1, { column: 99 }, random), alice)?.toMove).toEqual([0]);
  });

  it("sends each Battleship player their own ships and nobody else's", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    const bob = joined(room, TOKEN_B, "Bob");
    const carol = joined(room, TOKEN_C, "Carol");
    room.receive(alice, { type: "open", game: "battleship", invite: null }, 1, random);
    room.receive(bob, { type: "sit" }, 1, random);
    const placed = room.receive(alice, { type: "move", move: { kind: "autoPlace" } }, 1, random);
    const seenBy = (memberId: string): BattleshipView => tableTo(placed, memberId)!.view as BattleshipView;
    expect(seenBy(alice).fleets[0].ships.every((ship) => ship.at !== null)).toBe(true);
    expect(seenBy(bob).fleets[0].ships.every((ship) => ship.at === null)).toBe(true);
    expect(seenBy(carol).fleets[0].ships.every((ship) => ship.at === null)).toBe(true);
  });

  it("carries on from its snapshot, as after the server has slept", () => {
    const { room, alice, bob } = connectFourGame();
    const woken = new Room(JSON.parse(JSON.stringify(room.snapshot)));
    woken.restoreConnection(alice);
    woken.restoreConnection(bob);
    expect(tableTo(woken.receive(alice, { type: "move", move: { column: 0 } }, 1, random), bob)?.toMove).toEqual([1]);
  });

  it("is full at eight people, but always lets a returning member back in", () => {
    const room = Room.empty("ABCDEF");
    const ids = Array.from({ length: 8 }, (_, index) => joined(room, `token-number-${String(index).padStart(10, "0")}`, `P${index}`));
    expect(room.join("token-number-late-arrival", "Late", 1)).toEqual({ ok: false, error: "This room is full" });
    room.leave(ids[3], 2);
    expect(room.join("token-number-0000000003", "P3", 3).ok).toBe(true);
  });
});

describe("computer players", () => {
  const connectFour = rulesFor("connect4");

  // A position where seat 0 (to move) wins in column 3, and seat 1 would win in column 6 if not blocked.
  function position(): ConnectFourState {
    const board = Array.from({ length: 6 }, () => Array<0 | 1 | null>(7).fill(null));
    board[5][0] = board[5][1] = board[5][2] = 0;
    board[5][6] = board[4][6] = board[3][6] = 1;
    return { board, turn: 0, outcome: null, winningCells: [], lastDrop: null };
  }

  it("take a winning move, and otherwise block the other player's", () => {
    const state = position();
    expect(simpleChoice({ game: connectFour, state, view: state, seat: 0, random })?.choice.move).toEqual({ column: 3 });
    const blocking = { ...position(), board: position().board.map((row) => row.map((cell) => (cell === 0 ? null : cell))) };
    blocking.board[5][0] = 0;
    expect(simpleChoice({ game: connectFour, state: blocking, view: blocking, seat: 0, random })?.choice.move).toEqual({ column: 6 });
  });

  it("ask Jev to choose among the safe moves, and fall back to the simple choice when it fails", async () => {
    const state = connectFour.start(2, random);
    const sent: unknown[] = [];
    const decided = await jevChoice({ game: connectFour, state, view: state, seat: 0, random }, async (body) => {
      sent.push(body);
      return { answers: { next_move: { choice: "column 5 of 7 (from the left)", confidence: 0.8 } } };
    });
    expect(decided).toMatchObject({ by: "jev", choice: { move: { column: 4 } }, confidence: 0.8 });
    const request = sent[0] as { model: string; questions: { next_move: { type: string; criteria: Record<string, string> } } };
    expect(request.model).toBe("~typesafe/jev-latest");
    expect(Object.keys(request.questions.next_move.criteria)).toHaveLength(7);

    const failed = await jevChoice({ game: connectFour, state, view: state, seat: 0, random }, async () => {
      throw new Error("402 Payment Required");
    });
    expect(failed).toMatchObject({ by: "simple", note: "Jev failed: 402 Payment Required" });
    const nonsense = await jevChoice({ game: connectFour, state, view: state, seat: 0, random }, async () => ({ answers: { next_move: { choice: "column 9" } } }));
    expect(nonsense?.by).toBe("simple");
  });

  // An empty board but for these discs (row 5 is the bottom), with seat 0 to move.
  function board(discs: Record<string, 0 | 1>): ConnectFourState {
    const cells = Array.from({ length: 6 }, () => Array<0 | 1 | null>(7).fill(null));
    for (const [at, seat] of Object.entries(discs)) {
      const [row, column] = at.split(",").map(Number);
      cells[row][column] = seat;
    }
    return { board: cells, turn: 0, outcome: null, winningCells: [], lastDrop: null };
  }
  const columnOf = (move: unknown): number => (move as { column: number }).column;

  it("at hard, take a win two moves deep: an open three the other side cannot block twice", async () => {
    const state = board({ "5,2": 0, "5,3": 0, "5,6": 1, "4,6": 1 });
    const decision = await chooseMove({ game: connectFour, state, view: state, seat: 0, random }, "hard", null);
    expect([1, 4]).toContain(columnOf(decision?.choice.move));
  });

  it("at hard, refuse a move that lets the other side make an open three, and block instead", async () => {
    // The other side's two at columns 2-3: a disc at column 4 would make an open three (columns 1
    // and 5 both free). Only columns 1, 4 or 5 stop that.
    const state = board({ "5,2": 1, "5,3": 1, "5,0": 0, "5,6": 0 });
    for (let trial = 0; trial < 10; trial++) {
      const seeded = (() => {
        let value = trial + 1;
        return () => ((value = (value * 16807) % 2147483647) / 2147483647);
      })();
      const decision = await chooseMove({ game: connectFour, state, view: state, seat: 0, random: seeded }, "hard", null);
      expect([1, 4, 5]).toContain(columnOf(decision?.choice.move));
    }
  });

  it("at beginner, play mostly at random, but still take a win at once", async () => {
    const opening = connectFour.start(2, random);
    const columns = new Set<number>();
    let value = 7;
    const seeded = (): number => (value = (value * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 40; trial++) {
      columns.add(columnOf((await chooseMove({ game: connectFour, state: opening, view: opening, seat: 0, random: seeded }, "beginner", null))?.choice.move));
    }
    expect(columns.size).toBeGreaterThan(4);
    const winning = position();
    expect(columnOf((await chooseMove({ game: connectFour, state: winning, view: winning, seat: 0, random: seeded }, "beginner", null))?.choice.move)).toBe(3);
  });

  it("at easy, draw Jev's move by its probabilities rather than always its top pick", async () => {
    const state = connectFour.start(2, random);
    const reply = { answers: { next_move: { choice: "column 4 of 7 (from the left)", probabilities: { "column 4 of 7 (from the left)": 0.5, "column 3 of 7 (from the left)": 0.5 } } } };
    const picks = new Set<number>();
    for (const roll of [0.1, 0.3, 0.6, 0.9]) {
      picks.add(columnOf((await chooseMove({ game: connectFour, state, view: state, seat: 0, random: () => roll }, "easy", async () => reply))?.choice.move));
    }
    expect(picks).toEqual(new Set([2, 3]));
    const choices = connectFour.choices(state, 0);
    expect(drawByProbability(choices, { nonsense: 1 }, random)).toBeNull();
  });

  it("find the answers wherever the proxy puts them", () => {
    expect(findAnswers({ answers: { a: 1 } })).toEqual({ a: 1 });
    expect(findAnswers({ choices: [{ message: { content: JSON.stringify({ answers: { b: 2 } }) } }] })).toEqual({ b: 2 });
    expect(findAnswers({ nothing: true })).toBeNull();
  });
});
