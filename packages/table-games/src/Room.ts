import { battleship } from "./games/battleship.js";
import { checkers } from "./games/checkers.js";
import { connectFour } from "./games/connectFour.js";
import { cleanText, LIMITS, type ChatEntry, type ClientMessage, type GameInfo, type Invite, type MemberInfo, type ServerMessage } from "./protocol.js";
import type { GameId, Seat, TableGame } from "./TableGame.js";

// Each game's state is its own type; the room only stores it and hands it back.
export const TABLE_GAMES: Readonly<Record<GameId, TableGame<any, unknown>>> = {
  connect4: connectFour,
  checkers,
  battleship,
};

interface StoredMember {
  readonly id: string;
  readonly token: string;
  readonly name: string;
  readonly lastSeen: number;
}

interface StoredGame {
  readonly game: GameId;
  readonly seats: readonly [string, string];
  readonly state: unknown;
  readonly resignedBy: Seat | null;
}

// Everything a room keeps between messages: the server stores this after each change, so
// the room carries on after its server has slept, been moved or restarted.
export interface RoomSnapshot {
  readonly code: string;
  readonly nextMemberNumber: number;
  readonly members: readonly StoredMember[];
  readonly chat: readonly ChatEntry[];
  readonly invites: readonly Invite[];
  readonly game: StoredGame | null;
}

// A message for one member: each member's copy can differ (a game shows each player their own ships).
export interface Delivery {
  readonly to: string;
  readonly message: ServerMessage;
}

export type JoinResult = { readonly ok: true; readonly memberId: string; readonly deliveries: Delivery[] } | { readonly ok: false; readonly error: string };

// One room: who is in it, what they have said, the invitations between them and the game being
// played, with the rules for all of it. It knows nothing of sockets or storage; the server passes
// in each message and sends out what comes back, so all of this is tested without either.
export class Room {
  private snapshotData: RoomSnapshot;
  // Connections open for each member (one person may have two tabs). Not stored: the
  // server tells the room who is still connected when it wakes.
  private readonly connections = new Map<string, number>();
  // When each member's recent chat lines were sent, to slow a flood.
  private readonly recentChat = new Map<string, number[]>();

  public constructor(snapshot: RoomSnapshot) {
    this.snapshotData = snapshot;
  }

  public static empty(code: string): Room {
    return new Room({ code, nextMemberNumber: 1, members: [], chat: [], invites: [], game: null });
  }

  public get snapshot(): RoomSnapshot {
    return this.snapshotData;
  }

  public get onlineCount(): number {
    return this.connections.size;
  }

  // A connection that was already open when the room woke: counted, with nothing sent.
  public restoreConnection(memberId: string): void {
    this.connections.set(memberId, (this.connections.get(memberId) ?? 0) + 1);
  }

  // The members whose connections are open, one entry per connection, as the server sees them:
  // replaces the room's own count, which may be out of date after the server slept. Nothing is sent.
  public syncConnections(memberIds: Iterable<string>): void {
    this.connections.clear();
    for (const memberId of memberIds) this.restoreConnection(memberId);
  }

  // Someone has connected and said hello. The same token comes back as the same member.
  public join(token: string, requestedName: string, now: number): JoinResult {
    const name = cleanText(requestedName, LIMITS.nameLength) || "Guest";
    const existing = this.snapshotData.members.find((member) => member.token === token);
    if (!existing && this.connections.size >= LIMITS.onlineMembers) return { ok: false, error: "This room is full" };

    let memberId: string;
    if (existing) {
      memberId = existing.id;
      this.replaceMember({ ...existing, name, lastSeen: now });
    } else {
      memberId = `m${this.snapshotData.nextMemberNumber}`;
      const members = [...this.snapshotData.members, { id: memberId, token, name, lastSeen: now }];
      this.snapshotData = { ...this.snapshotData, nextMemberNumber: this.snapshotData.nextMemberNumber + 1, members };
    }
    this.restoreConnection(memberId);
    this.forgetOldMembers();

    const deliveries: Delivery[] = [
      { to: memberId, message: { type: "welcome", you: memberId, room: this.snapshotData.code } },
      { to: memberId, message: { type: "chat", entries: this.snapshotData.chat } },
      { to: memberId, message: this.invitesMessage() },
      { to: memberId, message: this.gameMessageFor(memberId) },
      ...this.toEveryone(this.membersMessage()),
    ];
    return { ok: true, memberId, deliveries };
  }

  // One of a member's connections has closed.
  public leave(memberId: string, now: number): Delivery[] {
    const open = (this.connections.get(memberId) ?? 0) - 1;
    if (open > 0) this.connections.set(memberId, open);
    else this.connections.delete(memberId);
    return this.departed(memberId, now);
  }

  // After a connection has closed and the count is up to date: if that was the member's last,
  // they are shown as gone.
  public departed(memberId: string, now: number): Delivery[] {
    if (this.connections.has(memberId)) return [];
    const member = this.memberById(memberId);
    if (member) this.replaceMember({ ...member, lastSeen: now });
    // Invitations to or from someone who has gone are no longer worth answering.
    const invites = this.snapshotData.invites.filter((invite) => invite.from !== memberId && invite.to !== memberId);
    const invitesChanged = invites.length !== this.snapshotData.invites.length;
    this.snapshotData = { ...this.snapshotData, invites };
    return [...this.toEveryone(this.membersMessage()), ...(invitesChanged ? this.toEveryone(this.invitesMessage()) : [])];
  }

  public receive(memberId: string, message: ClientMessage, now: number, random: () => number): Delivery[] {
    switch (message.type) {
      case "hello":
        return this.refuse(memberId, "Already joined");
      case "chat":
        return this.chat(memberId, message.text, now);
      case "invite":
        return this.invite(memberId, message.to, message.game);
      case "answer":
        return this.answer(memberId, message.from, message.accept, random);
      case "move":
        return this.move(memberId, message.move, random);
      case "resign":
        return this.resign(memberId);
    }
  }

  private chat(memberId: string, rawText: string, now: number): Delivery[] {
    const text = cleanText(rawText, LIMITS.chatLength);
    if (!text) return [];
    const windowStart = now - LIMITS.chatWindowSeconds * 1000;
    const recent = (this.recentChat.get(memberId) ?? []).filter((at) => at > windowStart);
    if (recent.length >= LIMITS.chatBurst) return this.refuse(memberId, "Slow down a little");
    this.recentChat.set(memberId, [...recent, now]);
    const entry: ChatEntry = { from: memberId, name: this.memberById(memberId)?.name ?? "?", text, at: now };
    this.snapshotData = { ...this.snapshotData, chat: [...this.snapshotData.chat, entry].slice(-LIMITS.chatHistory) };
    return this.toEveryone({ type: "chat", entries: [entry] });
  }

  private invite(memberId: string, to: string | null, game: GameId): Delivery[] {
    if (to === memberId) return this.refuse(memberId, "Invite someone else");
    if (to !== null && !this.connections.has(to)) return this.refuse(memberId, "They are not here");
    if (this.isGameOn()) return this.refuse(memberId, "Wait for the game being played to end");
    // One invitation from each member at a time: a new one replaces the last.
    const invites = [...this.snapshotData.invites.filter((invite) => invite.from !== memberId), { from: memberId, to, game }];
    this.snapshotData = { ...this.snapshotData, invites };
    return this.toEveryone(this.invitesMessage());
  }

  private answer(memberId: string, from: string, accept: boolean, random: () => number): Delivery[] {
    const invite = this.snapshotData.invites.find((candidate) => candidate.from === from && (candidate.to === memberId || (candidate.to === null && from !== memberId)));
    if (!invite) return this.refuse(memberId, "That invitation has gone");
    // An open invitation stays open for the others when one person says no.
    if (invite.to === null && !accept) return [];
    const invites = this.snapshotData.invites.filter((candidate) => candidate !== invite);
    this.snapshotData = { ...this.snapshotData, invites };
    if (!accept) return this.toEveryone(this.invitesMessage());
    if (this.isGameOn()) return [...this.toEveryone(this.invitesMessage()), ...this.refuse(memberId, "Wait for the game being played to end")];

    // The one who invited moves first. Every other invitation lapses: the table is taken.
    const seats: [string, string] = [from, memberId];
    const state = TABLE_GAMES[invite.game].start(random);
    this.snapshotData = { ...this.snapshotData, invites: [], game: { game: invite.game, seats, state, resignedBy: null } };
    return [...this.toEveryone(this.invitesMessage()), ...this.gameToEveryone()];
  }

  private move(memberId: string, move: unknown, random: () => number): Delivery[] {
    const game = this.snapshotData.game;
    const seat = this.seatOf(memberId);
    if (!game || seat === null || this.isOver(game)) return this.refuse(memberId, "You are not playing");
    const result = TABLE_GAMES[game.game].play(game.state, seat, move, random);
    if (!result.ok) return this.refuse(memberId, result.error);
    this.snapshotData = { ...this.snapshotData, game: { ...game, state: result.state } };
    return this.gameToEveryone();
  }

  private resign(memberId: string): Delivery[] {
    const game = this.snapshotData.game;
    const seat = this.seatOf(memberId);
    if (!game || seat === null || this.isOver(game)) return this.refuse(memberId, "You are not playing");
    this.snapshotData = { ...this.snapshotData, game: { ...game, resignedBy: seat } };
    return this.gameToEveryone();
  }

  private isOver(game: StoredGame): boolean {
    return game.resignedBy !== null || TABLE_GAMES[game.game].outcome(game.state) !== null;
  }

  // The room has one table: while a game is on, nobody else can start one.
  private isGameOn(): boolean {
    const game = this.snapshotData.game;
    return game !== null && !this.isOver(game);
  }

  private seatOf(memberId: string): Seat | null {
    const index = this.snapshotData.game?.seats.indexOf(memberId) ?? -1;
    return index === 0 || index === 1 ? index : null;
  }

  private gameMessageFor(memberId: string): ServerMessage {
    const game = this.snapshotData.game;
    if (!game) return { type: "game", game: null };
    const rules = TABLE_GAMES[game.game];
    const info: GameInfo = {
      game: game.game,
      seats: game.seats,
      view: rules.viewFor(game.state, this.seatOf(memberId)),
      turn: game.resignedBy === null ? rules.turn(game.state) : null,
      outcome: game.resignedBy === null ? rules.outcome(game.state) : { kind: "win", winner: game.resignedBy === 0 ? 1 : 0 },
      resignedBy: game.resignedBy,
    };
    return { type: "game", game: info };
  }

  private gameToEveryone(): Delivery[] {
    return [...this.connections.keys()].map((to) => ({ to, message: this.gameMessageFor(to) }));
  }

  private membersMessage(): ServerMessage {
    const members: MemberInfo[] = this.snapshotData.members.map(({ id, name }) => ({ id, name, isOnline: this.connections.has(id) }));
    return { type: "members", members };
  }

  private invitesMessage(): ServerMessage {
    return { type: "invites", invites: this.snapshotData.invites };
  }

  private toEveryone(message: ServerMessage): Delivery[] {
    return [...this.connections.keys()].map((to) => ({ to, message }));
  }

  private refuse(memberId: string, message: string): Delivery[] {
    return [{ to: memberId, message: { type: "error", message } }];
  }

  private memberById(memberId: string): StoredMember | undefined {
    return this.snapshotData.members.find((member) => member.id === memberId);
  }

  private replaceMember(member: StoredMember): void {
    this.snapshotData = { ...this.snapshotData, members: this.snapshotData.members.map((each) => (each.id === member.id ? member : each)) };
  }

  // Past the limit, the members gone longest are forgotten, unless they hold a seat.
  private forgetOldMembers(): void {
    const members = this.snapshotData.members;
    if (members.length <= LIMITS.rememberedMembers) return;
    const keep = (member: StoredMember): boolean => this.connections.has(member.id) || (this.snapshotData.game?.seats.includes(member.id) ?? false);
    const forgettable = members.filter((member) => !keep(member)).sort((a, b) => a.lastSeen - b.lastSeen);
    const forget = new Set(forgettable.slice(0, members.length - LIMITS.rememberedMembers).map((member) => member.id));
    this.snapshotData = { ...this.snapshotData, members: members.filter((member) => !forget.has(member.id)) };
  }
}
