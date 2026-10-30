import { describe, expect, it } from "vitest";
import { readClientMessage, Room, roomCodeFrom, isRoomCode, type BattleshipView, type Delivery, type ServerMessage } from "../src/index.js";

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

function gameTo(deliveries: Delivery[], memberId: string) {
  const [message] = messagesTo(deliveries, memberId, "game");
  if (message?.type !== "game" || !message.game) throw new Error("no game sent");
  return message.game;
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
    expect(readClientMessage('{"type":"hello","token":"short","name":"x"}')).toBeNull();
    expect(readClientMessage('{"type":"invite","to":"m2","game":"chess"}')).toBeNull();
    expect(readClientMessage("not json")).toBeNull();
    expect(readClientMessage(`{"type":"chat","text":"${"x".repeat(5000)}"}`)).toBeNull();
  });
});

describe("Room", () => {
  it("welcomes a member with the history and tells everyone who is here", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    room.receive(alice, { type: "chat", text: "  hello\u0007   there " }, 2000, random);
    const result = room.join(TOKEN_B, "Bob", 3000);
    if (!result.ok) throw new Error(result.error);
    const bob = result.memberId;
    expect(bob).toBe("m2");
    expect(messagesTo(result.deliveries, bob, "welcome")).toEqual([{ type: "welcome", you: "m2", room: "ABCDEF" }]);
    expect(messagesTo(result.deliveries, bob, "chat")).toEqual([{ type: "chat", entries: [{ from: alice, name: "Alice", text: "hello there", at: 2000 }] }]);
    const members = messagesTo(result.deliveries, alice, "members")[0];
    expect(members).toEqual({ type: "members", members: [{ id: "m1", name: "Alice", isOnline: true }, { id: "m2", name: "Bob", isOnline: true }] });
  });

  it("keeps a member who comes back with the same token, and never sends tokens", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    const leaving = room.leave(alice, 5000);
    expect(leaving).toEqual([]);
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

  it("starts a game when an invitation is accepted, the inviter moving first, with others watching", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    const bob = joined(room, TOKEN_B, "Bob");
    const carol = joined(room, TOKEN_C, "Carol");
    expect(room.receive(alice, { type: "invite", to: alice, game: "connect4" }, 1, random)[0].message.type).toBe("error");
    const invited = room.receive(alice, { type: "invite", to: bob, game: "connect4" }, 1, random);
    expect(messagesTo(invited, carol, "invites")).toEqual([{ type: "invites", invites: [{ from: alice, to: bob, game: "connect4" }] }]);
    expect(room.receive(carol, { type: "answer", from: alice, accept: true }, 1, random)[0].message).toEqual({ type: "error", message: "That invitation has gone" });

    const started = room.receive(bob, { type: "answer", from: alice, accept: true }, 1, random);
    const game = gameTo(started, carol);
    expect(game.seats).toEqual([alice, bob]);
    expect(game.turn).toBe(0);
    expect(room.snapshot.invites).toEqual([]);

    expect(room.receive(carol, { type: "move", move: { column: 3 } }, 1, random)[0].message).toEqual({ type: "error", message: "You are not playing" });
    expect(room.receive(bob, { type: "move", move: { column: 3 } }, 1, random)[0].message).toEqual({ type: "error", message: "Not your turn" });
    const moved = room.receive(alice, { type: "move", move: { column: 3 } }, 1, random);
    expect(gameTo(moved, bob).turn).toBe(1);
    expect(room.receive(alice, { type: "invite", to: carol, game: "checkers" }, 1, random)[0].message.type).toBe("error");
  });

  it("has one table: nobody can start another game while one is on", () => {
    const room = Room.empty("ABCDEF");
    const [alice, bob, carol, dave] = [TOKEN_A, TOKEN_B, TOKEN_C, "token-for-dave-0000004"].map((token, index) => joined(room, token, `P${index}`));
    room.receive(carol, { type: "invite", to: dave, game: "checkers" }, 1, random);
    room.receive(alice, { type: "invite", to: bob, game: "connect4" }, 1, random);
    room.receive(bob, { type: "answer", from: alice, accept: true }, 1, random);
    // Carol's invitation lapsed when the game began.
    expect(room.snapshot.invites).toEqual([]);
    const answered = room.receive(dave, { type: "answer", from: carol, accept: true }, 1, random);
    expect(messagesTo(answered, dave, "error")).toEqual([{ type: "error", message: "That invitation has gone" }]);
    expect(room.snapshot.game?.seats).toEqual([alice, bob]);
    expect(room.receive(carol, { type: "invite", to: dave, game: "checkers" }, 1, random)[0].message.type).toBe("error");
  });

  it("ends a game when a player resigns, the other winning", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    const bob = joined(room, TOKEN_B, "Bob");
    room.receive(alice, { type: "invite", to: bob, game: "checkers" }, 1, random);
    room.receive(bob, { type: "answer", from: alice, accept: true }, 1, random);
    const resigned = gameTo(room.receive(bob, { type: "resign" }, 1, random), alice);
    expect(resigned.outcome).toEqual({ kind: "win", winner: 0 });
    expect(resigned.turn).toBeNull();
    // Once it is over, a new game can be arranged.
    expect(room.receive(bob, { type: "invite", to: alice, game: "connect4" }, 1, random)[0].message.type).toBe("invites");
  });

  it("sends each Battleship player their own ships and nobody else's", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    const bob = joined(room, TOKEN_B, "Bob");
    const carol = joined(room, TOKEN_C, "Carol");
    room.receive(alice, { type: "invite", to: bob, game: "battleship" }, 1, random);
    room.receive(bob, { type: "answer", from: alice, accept: true }, 1, random);
    const placed = room.receive(alice, { type: "move", move: { kind: "autoPlace" } }, 1, random);
    const seenBy = (memberId: string): BattleshipView => gameTo(placed, memberId).view as BattleshipView;
    expect(seenBy(alice).fleets[0].ships.every((ship) => ship.at !== null)).toBe(true);
    expect(seenBy(bob).fleets[0].ships.every((ship) => ship.at === null)).toBe(true);
    expect(seenBy(carol).fleets[0].ships.every((ship) => ship.at === null)).toBe(true);
  });

  it("carries on from its snapshot, as after the server has slept", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    const bob = joined(room, TOKEN_B, "Bob");
    room.receive(alice, { type: "invite", to: bob, game: "connect4" }, 1, random);
    room.receive(bob, { type: "answer", from: alice, accept: true }, 1, random);

    const woken = new Room(JSON.parse(JSON.stringify(room.snapshot)));
    woken.restoreConnection(alice);
    woken.restoreConnection(bob);
    const moved = woken.receive(alice, { type: "move", move: { column: 0 } }, 1, random);
    expect(gameTo(moved, bob).turn).toBe(1);
  });

  it("is full at eight people, but always lets a returning member back in", () => {
    const room = Room.empty("ABCDEF");
    const ids = Array.from({ length: 8 }, (_, index) => joined(room, `token-number-${String(index).padStart(10, "0")}`, `P${index}`));
    expect(room.join("token-number-late-arrival", "Late", 1)).toEqual({ ok: false, error: "This room is full" });
    room.leave(ids[3], 2);
    expect(room.join("token-number-0000000003", "P3", 3).ok).toBe(true);
  });

  it("drops invitations to or from someone who leaves", () => {
    const room = Room.empty("ABCDEF");
    const alice = joined(room, TOKEN_A, "Alice");
    const bob = joined(room, TOKEN_B, "Bob");
    room.receive(alice, { type: "invite", to: bob, game: "connect4" }, 1, random);
    const left = room.leave(alice, 2);
    expect(messagesTo(left, bob, "invites")).toEqual([{ type: "invites", invites: [] }]);
  });
});
