import { isRecord, type GameId, type Outcome, type Seat } from "./TableGame.js";

// The messages between a Table Games window and its room, sent as JSON over one WebSocket.
//
// A member is known to everyone by a short public id ("m3"). The token that proves who
// they are is the browser's own secret: it is sent once, in hello, so a member who
// reloads or loses the connection comes back as themselves, seat and all.
//
// The room has one table. Someone opens it for a game and takes the first seat (the host);
// others sit down, or the host adds computer players; the host starts the game, or it starts
// by itself once every seat is taken. When it is over, anyone may clear the table.

export const GAME_IDS: readonly GameId[] = [
  "connect4",
  "checkers",
  "battleship",
  "tictactoe",
  "chess",
  "yahtzee",
  "boggle",
  "poker",
  "blackjack",
  "baccarat",
  "craps",
  "roulette",
  "keno",
  "slots",
  "pachinko",
];

export const LIMITS = {
  nameLength: 16,
  chatLength: 200,
  chatHistory: 50,
  // At most this many chat lines in any window of chatWindowSeconds.
  chatBurst: 5,
  chatWindowSeconds: 5,
  // People in a room at once, and members remembered (those who left can come back).
  onlineMembers: 8,
  rememberedMembers: 24,
  messageBytes: 4000,
} as const;

// Room codes are read aloud and typed, so they leave out letters that look like numbers.
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

export function isRoomCode(text: string): boolean {
  return text.length === ROOM_CODE_LENGTH && [...text].every((character) => ROOM_CODE_ALPHABET.includes(character));
}

// A code from random bytes; 32 letters divide 256 evenly, so every letter is equally likely.
export function roomCodeFrom(bytes: ArrayLike<number>): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => ROOM_CODE_ALPHABET[bytes[index] % ROOM_CODE_ALPHABET.length]).join("");
}

export type ClientMessage =
  | { readonly type: "hello"; readonly token: string; readonly name: string }
  | { readonly type: "chat"; readonly text: string }
  // Opens the table for a game, with the sender in the first seat. `invite` names one
  // member to ask in particular; everyone in the room may sit down either way.
  | { readonly type: "open"; readonly game: GameId; readonly invite: string | null }
  | { readonly type: "sit" }
  // Gets up from a table not yet started (the host getting up closes it), or turns down an invitation.
  | { readonly type: "stand" }
  | { readonly type: "addComputer" }
  | { readonly type: "start" }
  | { readonly type: "move"; readonly move: unknown }
  // Gives up: in a two-player game the other player wins; with more, a computer takes the seat.
  | { readonly type: "resign" }
  // Clears a finished table; or, from the host, ends a game in progress (a casino game is
  // played until then, and scored by its chips).
  | { readonly type: "close" };

export interface MemberInfo {
  readonly id: string;
  readonly name: string;
  readonly isOnline: boolean;
}

export interface ChatEntry {
  readonly from: string;
  readonly name: string;
  readonly text: string;
  // Milliseconds since 1970, by the server's clock.
  readonly at: number;
}

export interface TableInfo {
  readonly game: GameId;
  // The member who opened it.
  readonly host: string;
  // Who sits in each seat: a member's id, or a computer player's ("c1").
  readonly seats: readonly string[];
  readonly names: readonly string[];
  readonly isComputer: readonly boolean[];
  // The member asked in particular, until they sit down or say no.
  readonly invited: string | null;
  readonly isStarted: boolean;
  // The game's state as the receiver may see it; null before it starts.
  readonly view: unknown;
  readonly toMove: readonly Seat[];
  readonly outcome: Outcome | null;
}

export type ServerMessage =
  | { readonly type: "welcome"; readonly you: string; readonly room: string; readonly computerName: string }
  | { readonly type: "members"; readonly members: readonly MemberInfo[] }
  // Lines to add to the chat: on joining, the room's history; after that, each new line.
  | { readonly type: "chat"; readonly entries: readonly ChatEntry[] }
  | { readonly type: "table"; readonly table: TableInfo | null }
  | { readonly type: "error"; readonly message: string };

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

// Printable text only, trimmed, with runs of space made one.
export function cleanText(text: string, maximumLength: number): string {
  return text
    .replace(/[\p{C}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

// A message from a client, or null if it is not one: anything may arrive.
export function readClientMessage(raw: string): ClientMessage | null {
  if (raw.length > LIMITS.messageBytes) return null;
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(message)) return null;
  switch (message.type) {
    case "hello":
      if (typeof message.token !== "string" || !TOKEN.test(message.token) || typeof message.name !== "string") return null;
      return { type: "hello", token: message.token, name: message.name };
    case "chat":
      return typeof message.text === "string" ? { type: "chat", text: message.text } : null;
    case "open":
      if (!GAME_IDS.includes(message.game as GameId) || (typeof message.invite !== "string" && message.invite !== null && message.invite !== undefined)) return null;
      return { type: "open", game: message.game as GameId, invite: (message.invite as string | undefined) ?? null };
    case "move":
      return { type: "move", move: message.move };
    case "sit":
    case "stand":
    case "addComputer":
    case "start":
    case "resign":
    case "close":
      return { type: message.type };
    default:
      return null;
  }
}
