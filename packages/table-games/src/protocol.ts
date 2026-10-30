import { isRecord, type GameId, type Outcome, type Seat } from "./TableGame.js";

// The messages between a Table Games window and its room, sent as JSON over one WebSocket.
//
// A member is known to everyone by a short public id ("m3"). The token that proves who
// they are is the browser's own secret: it is sent once, in hello, so a member who
// reloads or loses the connection comes back as themselves, seat and all.

export const GAME_IDS: readonly GameId[] = ["connect4", "checkers", "battleship"];

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
  | { readonly type: "invite"; readonly to: string; readonly game: GameId }
  | { readonly type: "answer"; readonly from: string; readonly accept: boolean }
  | { readonly type: "move"; readonly move: unknown }
  | { readonly type: "resign" };

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

export interface Invite {
  readonly from: string;
  readonly to: string;
  readonly game: GameId;
}

export interface GameInfo {
  readonly game: GameId;
  // The member in each seat.
  readonly seats: readonly [string, string];
  // The game's state as the receiver may see it.
  readonly view: unknown;
  readonly turn: Seat | null;
  readonly outcome: Outcome | null;
  readonly resignedBy: Seat | null;
}

export type ServerMessage =
  | { readonly type: "welcome"; readonly you: string; readonly room: string }
  | { readonly type: "members"; readonly members: readonly MemberInfo[] }
  // Lines to add to the chat: on joining, the room's history; after that, each new line.
  | { readonly type: "chat"; readonly entries: readonly ChatEntry[] }
  | { readonly type: "invites"; readonly invites: readonly Invite[] }
  | { readonly type: "game"; readonly game: GameInfo | null }
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
    case "invite":
      if (typeof message.to !== "string" || !GAME_IDS.includes(message.game as GameId)) return null;
      return { type: "invite", to: message.to, game: message.game as GameId };
    case "answer":
      if (typeof message.from !== "string" || typeof message.accept !== "boolean") return null;
      return { type: "answer", from: message.from, accept: message.accept };
    case "move":
      return { type: "move", move: message.move };
    case "resign":
      return { type: "resign" };
    default:
      return null;
  }
}
