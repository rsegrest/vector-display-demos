import { cleanText, LIMITS, type ChatEntry, type ClientMessage, type MemberInfo, type ServerMessage, type TableInfo } from "./protocol.js";
import { hasRules, rulesFor } from "./registry.js";
import type { GameId, Outcome, Seat } from "./TableGame.js";

interface StoredMember {
  readonly id: string;
  readonly token: string;
  readonly name: string;
  readonly lastSeen: number;
}

interface StoredTable {
  readonly game: GameId;
  readonly host: string;
  // A member's id, or a computer player's: "c1", "c2"...
  readonly seats: readonly string[];
  readonly invited: string | null;
  // null until the game starts.
  readonly state: unknown;
  // Set when the host ended a game in progress.
  readonly endedEarly: Outcome | null;
  // Set when a player gave up a two-player game.
  readonly resignedBy: Seat | null;
}

// Everything a room keeps between messages: the server stores this after each change, so
// the room carries on after its server has slept, been moved or restarted.
export interface RoomSnapshot {
  readonly code: string;
  readonly nextMemberNumber: number;
  readonly members: readonly StoredMember[];
  readonly chat: readonly ChatEntry[];
  readonly table: StoredTable | null;
}

// A message for one member: each member's copy can differ (a game shows each player their own cards).
export interface Delivery {
  readonly to: string;
  readonly message: ServerMessage;
}

export type JoinResult = { readonly ok: true; readonly memberId: string; readonly deliveries: Delivery[] } | { readonly ok: false; readonly error: string };

// A computer player whose move it is, with what it needs to choose.
export interface ComputerTurn {
  readonly seat: Seat;
  // How long the computer player waits before moving, in seconds.
  readonly pauseSeconds: number;
  readonly game: GameId;
  // What that seat may see: a computer player sees no more than a person in its seat would.
  readonly view: unknown;
  readonly state: unknown;
}

export interface RoomOptions {
  // What computer players are called: "Jev" when the server can reach it, "Computer" when not.
  readonly computerName?: string;
}

function isComputerId(seatHolder: string): boolean {
  return /^c\d+$/.test(seatHolder);
}

// One room: who is in it, what they have said and its table, with the rules for all of it. It
// knows nothing of sockets, storage or decision models; the server passes in each message and
// sends out what comes back, and asks it whose move a computer player has to make.
export class Room {
  private snapshotData: RoomSnapshot;
  // Connections open for each member (one person may have two tabs). Not stored: the
  // server tells the room who is still connected when it wakes.
  private readonly connections = new Map<string, number>();
  // When each member's recent chat lines were sent, to slow a flood.
  private readonly recentChat = new Map<string, number[]>();
  private readonly computerName: string;

  public constructor(snapshot: RoomSnapshot, options: RoomOptions = {}) {
    this.snapshotData = snapshot;
    this.computerName = options.computerName ?? "Computer";
  }

  public static empty(code: string, options: RoomOptions = {}): Room {
    return new Room({ code, nextMemberNumber: 1, members: [], chat: [], table: null }, options);
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
      { to: memberId, message: { type: "welcome", you: memberId, room: this.snapshotData.code, computerName: this.computerName } },
      { to: memberId, message: { type: "chat", entries: this.snapshotData.chat } },
      { to: memberId, message: this.tableMessageFor(memberId) },
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
  // they are shown as gone. A seat they hold is kept for their return, and an invitation to them lapses.
  public departed(memberId: string, now: number): Delivery[] {
    if (this.connections.has(memberId)) return [];
    const member = this.memberById(memberId);
    if (member) this.replaceMember({ ...member, lastSeen: now });
    const table = this.snapshotData.table;
    if (table?.invited === memberId) this.setTable({ ...table, invited: null });
    return [...this.toEveryone(this.membersMessage()), ...(table?.invited === memberId ? this.tableToEveryone() : [])];
  }

  public receive(memberId: string, message: ClientMessage, now: number, random: () => number): Delivery[] {
    switch (message.type) {
      case "hello":
        return this.refuse(memberId, "Already joined");
      case "chat":
        return this.chat(memberId, message.text, now);
      case "open":
        return this.open(memberId, message.game, message.invite, random);
      case "sit":
        return this.sit(memberId, random);
      case "stand":
        return this.stand(memberId);
      case "addComputer":
        return this.addComputer(memberId, random);
      case "start":
        return this.start(memberId, random);
      case "move":
        return this.move(memberId, message.move, random);
      case "resign":
        return this.resign(memberId);
      case "close":
        return this.close(memberId);
    }
  }

  // The computer player whose move it is now, if any.
  public computerTurn(): ComputerTurn | null {
    const table = this.snapshotData.table;
    if (!table || table.state === null || this.outcomeOf(table)) return null;
    const rules = rulesFor(table.game);
    const seat = rules.toMove(table.state).find((each) => isComputerId(table.seats[each]));
    if (seat === undefined) return null;
    return { seat, game: table.game, view: rules.viewFor(table.state, seat), state: table.state, pauseSeconds: rules.computerPauseSeconds ?? 0.7 };
  }

  // A computer player's chosen move. If the rules refuse it (the table changed meanwhile, or the
  // chooser erred), its first legal move is played instead, so a computer never holds up a game.
  public computerMove(seat: Seat, move: unknown, random: () => number): Delivery[] {
    const turn = this.computerTurn();
    const table = this.snapshotData.table;
    if (!turn || !table || turn.seat !== seat) return [];
    const rules = rulesFor(table.game);
    let result = rules.play(table.state, seat, move, random);
    if (!result.ok) {
      const fallback = rules.choices(table.state, seat)[0];
      if (!fallback) return [];
      result = rules.play(table.state, seat, fallback.move, random);
      if (!result.ok) return [];
    }
    this.setTable({ ...table, state: result.state });
    return this.tableToEveryone();
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

  private open(memberId: string, game: GameId, invite: string | null, random: () => number): Delivery[] {
    const current = this.snapshotData.table;
    if (current && !this.outcomeOf(current)) return this.refuse(memberId, "The table is in use; wait for that game to end");
    if (invite === memberId) return this.refuse(memberId, "Invite someone else");
    if (invite !== null && !this.connections.has(invite)) return this.refuse(memberId, "They are not here");
    if (!hasRules(game)) return this.refuse(memberId, "That game is not here yet");
    this.setTable({ game, host: memberId, seats: [memberId], invited: invite, state: null, endedEarly: null, resignedBy: null });
    return this.startIfFull(random);
  }

  private sit(memberId: string, random: () => number): Delivery[] {
    const table = this.snapshotData.table;
    if (!table || table.state !== null) return this.refuse(memberId, "There is no table to sit at");
    if (table.seats.includes(memberId)) return this.refuse(memberId, "You already have a seat");
    if (table.seats.length >= rulesFor(table.game).maxPlayers) return this.refuse(memberId, "Every seat is taken");
    this.setTable({ ...table, seats: [...table.seats, memberId], invited: table.invited === memberId ? null : table.invited });
    return this.startIfFull(random);
  }

  private stand(memberId: string): Delivery[] {
    const table = this.snapshotData.table;
    if (!table) return [];
    if (table.invited === memberId && !table.seats.includes(memberId)) {
      this.setTable({ ...table, invited: null });
      return this.tableToEveryone();
    }
    if (table.state !== null) return this.refuse(memberId, "The game has started; resign instead");
    if (!table.seats.includes(memberId)) return [];
    if (table.host === memberId) this.setTable(null);
    else this.setTable({ ...table, seats: table.seats.filter((seat) => seat !== memberId) });
    return this.tableToEveryone();
  }

  private addComputer(memberId: string, random: () => number): Delivery[] {
    const table = this.snapshotData.table;
    if (!table || table.state !== null || table.host !== memberId) return this.refuse(memberId, "Only the table's host can add a computer player");
    if (table.seats.length >= rulesFor(table.game).maxPlayers) return this.refuse(memberId, "Every seat is taken");
    const computers = table.seats.filter(isComputerId).length;
    this.setTable({ ...table, seats: [...table.seats, `c${computers + 1}`] });
    return this.startIfFull(random);
  }

  private start(memberId: string, random: () => number): Delivery[] {
    const table = this.snapshotData.table;
    if (!table || table.state !== null || table.host !== memberId) return this.refuse(memberId, "Only the table's host can start");
    const rules = rulesFor(table.game);
    if (table.seats.length < rules.minPlayers) return this.refuse(memberId, `${rules.title} needs at least ${rules.minPlayers} players`);
    return this.begin(table, random);
  }

  // A table whose every seat is taken starts by itself.
  private startIfFull(random: () => number): Delivery[] {
    const table = this.snapshotData.table!;
    if (table.seats.length >= rulesFor(table.game).maxPlayers) return this.begin(table, random);
    return this.tableToEveryone();
  }

  private begin(table: StoredTable, random: () => number): Delivery[] {
    const state = rulesFor(table.game).start(table.seats.length, random);
    this.setTable({ ...table, state, invited: null });
    return this.tableToEveryone();
  }

  private move(memberId: string, move: unknown, random: () => number): Delivery[] {
    const table = this.snapshotData.table;
    const seat = this.seatOf(memberId);
    if (!table || table.state === null || seat === null || this.outcomeOf(table)) return this.refuse(memberId, "You are not playing");
    const result = rulesFor(table.game).play(table.state, seat, move, random);
    if (!result.ok) return this.refuse(memberId, result.error);
    this.setTable({ ...table, state: result.state });
    return this.tableToEveryone();
  }

  private resign(memberId: string): Delivery[] {
    const table = this.snapshotData.table;
    const seat = this.seatOf(memberId);
    if (!table || table.state === null || seat === null || this.outcomeOf(table)) return this.refuse(memberId, "You are not playing");
    const people = table.seats.filter((holder) => !isComputerId(holder));
    if (table.seats.length === 2) {
      this.setTable({ ...table, resignedBy: seat });
    } else if (people.length === 1) {
      // The last person at a table of computers: the game ends.
      this.setTable({ ...table, endedEarly: { winners: [], summary: `${this.nameOf(memberId)} left the table` } });
    } else {
      // A computer player takes over the seat, so the others play on.
      const computers = table.seats.filter(isComputerId).length;
      this.setTable({ ...table, seats: table.seats.map((holder, index) => (index === seat ? `c${computers + 1}` : holder)) });
    }
    return this.tableToEveryone();
  }

  private close(memberId: string): Delivery[] {
    const table = this.snapshotData.table;
    if (!table) return [];
    if (this.outcomeOf(table)) {
      this.setTable(null);
      return this.tableToEveryone();
    }
    if (table.host !== memberId) return this.refuse(memberId, "Only the table's host can end the game");
    if (table.state === null) {
      this.setTable(null);
      return this.tableToEveryone();
    }
    const rules = rulesFor(table.game);
    const endedEarly = rules.finish ? rules.finish(table.state) : { winners: [], summary: "Ended before the finish" };
    this.setTable({ ...table, endedEarly });
    return this.tableToEveryone();
  }

  private outcomeOf(table: StoredTable): Outcome | null {
    if (table.endedEarly) return table.endedEarly;
    if (table.resignedBy !== null) {
      const winner = table.resignedBy === 0 ? 1 : 0;
      return { winners: [winner], summary: `${this.holderName(table, table.resignedBy)} resigned` };
    }
    return table.state === null ? null : rulesFor(table.game).outcome(table.state);
  }

  private seatOf(memberId: string): Seat | null {
    const table = this.snapshotData.table;
    const index = table && table.state !== null ? table.seats.indexOf(memberId) : -1;
    return index >= 0 ? index : null;
  }

  private holderName(table: StoredTable, seat: Seat): string {
    const holder = table.seats[seat];
    if (!isComputerId(holder)) return this.nameOf(holder);
    const computers = table.seats.filter(isComputerId);
    return computers.length === 1 ? this.computerName : `${this.computerName} ${computers.indexOf(holder) + 1}`;
  }

  private tableMessageFor(memberId: string): ServerMessage {
    const table = this.snapshotData.table;
    if (!table) return { type: "table", table: null };
    const rules = rulesFor(table.game);
    const outcome = this.outcomeOf(table);
    const seat = this.seatOf(memberId);
    const info: TableInfo = {
      game: table.game,
      host: table.host,
      seats: table.seats,
      names: table.seats.map((_, index) => this.holderName(table, index)),
      isComputer: table.seats.map(isComputerId),
      invited: table.invited,
      isStarted: table.state !== null,
      view: table.state === null ? null : rules.viewFor(table.state, seat),
      toMove: table.state === null || outcome ? [] : rules.toMove(table.state),
      outcome,
    };
    return { type: "table", table: info };
  }

  private tableToEveryone(): Delivery[] {
    return [...this.connections.keys()].map((to) => ({ to, message: this.tableMessageFor(to) }));
  }

  private setTable(table: StoredTable | null): void {
    this.snapshotData = { ...this.snapshotData, table };
  }

  private membersMessage(): ServerMessage {
    const members: MemberInfo[] = this.snapshotData.members.map(({ id, name }) => ({ id, name, isOnline: this.connections.has(id) }));
    return { type: "members", members };
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

  private nameOf(memberId: string): string {
    return this.memberById(memberId)?.name ?? "?";
  }

  private replaceMember(member: StoredMember): void {
    this.snapshotData = { ...this.snapshotData, members: this.snapshotData.members.map((each) => (each.id === member.id ? member : each)) };
  }

  // Past the limit, the members gone longest are forgotten, unless they hold a seat.
  private forgetOldMembers(): void {
    const members = this.snapshotData.members;
    if (members.length <= LIMITS.rememberedMembers) return;
    const keep = (member: StoredMember): boolean => this.connections.has(member.id) || (this.snapshotData.table?.seats.includes(member.id) ?? false);
    const forgettable = members.filter((member) => !keep(member)).sort((a, b) => a.lastSeen - b.lastSeen);
    const forget = new Set(forgettable.slice(0, members.length - LIMITS.rememberedMembers).map((member) => member.id));
    this.snapshotData = { ...this.snapshotData, members: members.filter((member) => !forget.has(member.id)) };
  }
}
