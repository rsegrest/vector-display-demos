import type { BeamColor, DisplayList } from "@vector-display/core";
import type { Demo, DemoFrame } from "@vector-demos/demo-kit";
import { cleanText, GAME_IDS, isRoomCode, LIMITS, ROOM_CODE_LENGTH, roomCodeFrom, TABLE_GAMES, type GameId, type GameInfo, type Invite, type Seat } from "@vector-demos/table-games";
import type { OsApp, PointerKind } from "../OsApp.js";
import { drawBattleship, drawCheckers, drawConnectFour, freshChoices, SEAT_COLORS, type BoardChoices } from "./boards.js";
import { Practice } from "./Practice.js";
import { TableClient, type SocketFactory, type SocketLike } from "./TableClient.js";
import { Ui, type Rect } from "./Ui.js";

// Table Games: two-player board games with anyone who has the room's code or link, and a chat.
// Rooms are invitation-only: there is no list of them, so a room is found only by its code.
// The rules run on the room server (services/table-games); this window draws what it is sent
// and sends back what was clicked. Practice games run the same rules here, both sides on one
// screen. The games' rules follow game-clawtroller's.

const TEXT: BeamColor = { red: 0.6, green: 0.85, blue: 1 };
const DIM: BeamColor = { red: 0.45, green: 0.6, blue: 0.8 };
const BRIGHT: BeamColor = { red: 0.9, green: 1, blue: 0.95 };
const WARN: BeamColor = { red: 1, green: 0.55, blue: 0.4 };
const ACCENT: BeamColor = { red: 1, green: 0.8, blue: 0.35 };

const SHORT_NAMES: Readonly<Record<GameId, string>> = { connect4: "C4", checkers: "Checkers", battleship: "Ships" };
const DESCRIPTIONS: Readonly<Record<GameId, string>> = {
  connect4: "Drop discs in turn; four in a row wins.",
  checkers: "Jump to capture, and you must when you can.",
  battleship: "Hide five ships, then hunt down the other fleet.",
};
const PADDING = 12;
const CHAT_SIZE = 11;
const CHAT_PITCH = 18;

// Where this browser keeps its member token and the name last used.
export const TOKEN_KEY = "vector-os.table-games.token";
export const NAME_KEY = "vector-os.table-games.name";

export interface TableGamesOptions {
  // The room server, as http(s)://host[:port]; rooms are at /rooms/<CODE>.
  readonly server: string;
  readonly openSocket: SocketFactory;
  readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
  readonly randomBytes: (count: number) => Uint8Array;
  // The page to link to: a room's link is this with ?open=table-games&room=<CODE>.
  readonly pageUrl: string;
  // A room code from the page's address, to join straight away.
  readonly roomFromLink: string | null;
  readonly copyText: (text: string) => Promise<void>;
}

type Field = "name" | "code";

// A game on the board, from the room or practice, as the board and its buttons need it.
interface Table {
  readonly info: GameInfo;
  // The side this window plays: null to watch. In practice, whichever side is to move.
  readonly mySeat: Seat | null;
  readonly names: readonly [string, string];
  readonly isPractice: boolean;
  send(move: unknown): void;
  resign(): void;
  // Another game against the same player, if there is one to offer it to.
  readonly rematch: (() => void) | null;
}

export class TableGames implements Demo {
  public client: TableClient | null = null;
  public practice: Practice | null = null;
  public name: string;
  public codeDraft: string;
  public chatDraft = "";
  public field: Field;
  private readonly token: string;
  private readonly ui = new Ui();
  private choices: BoardChoices = freshChoices();
  // The game the board choices belong to, so a new game starts with fresh ones.
  private choicesFor: string | null = null;
  private choicesWereOver = false;
  private localNotice: string | null = null;
  // Open invitations this window has said no to: they stay open for the others.
  private readonly declined = new Set<string>();

  public constructor(private readonly options: TableGamesOptions) {
    this.token = readOrMakeToken(options);
    this.name = options.storage?.getItem(NAME_KEY) ?? "";
    this.codeDraft = options.roomFromLink && isRoomCode(options.roomFromLink.toUpperCase()) ? options.roomFromLink.toUpperCase() : "";
    this.field = this.name ? "code" : "name";
    // From a link, with a name already known, go straight in.
    if (this.codeDraft && this.name) this.enter(this.codeDraft);
  }

  public update(): void {}

  public key(key: string): void {
    if (!this.client) {
      if (!this.practice) this.lobbyKey(key);
      return;
    }
    if (key === "Enter") {
      this.client.say(this.chatDraft);
      this.chatDraft = "";
    } else if (key === "Backspace") {
      this.chatDraft = this.chatDraft.slice(0, -1);
    } else if (key.length === 1 && this.chatDraft.length < LIMITS.chatLength) {
      this.chatDraft += key;
    }
  }

  public pointer(kind: PointerKind, x: number, y: number): void {
    this.ui.pointerX = x;
    this.ui.pointerY = y;
    if (kind === "down") {
      this.localNotice = null;
      if (this.client) this.client.notice = null;
      this.ui.press(x, y);
    }
  }

  public dispose(): void {
    this.client?.close();
  }

  public draw(displayList: DisplayList, frame: DemoFrame): void {
    this.ui.begin(displayList);
    if (this.client) this.drawRoom(this.client, frame.width, frame.height);
    else if (this.practice) this.drawPracticeAlone(this.practice, frame.width, frame.height);
    else this.drawLobby(frame.width, frame.height, frame.seconds);
    this.ui.end();
  }

  public drawText(displayList: DisplayList): void {
    this.ui.drawText(displayList);
  }

  public startPractice(game: GameId): void {
    this.practice = new Practice(game);
  }

  // ── The lobby: a name, and a room to make or join ─────────────────────────

  private lobbyKey(key: string): void {
    if (key === "Tab") {
      this.field = this.field === "name" ? "code" : "name";
    } else if (key === "Enter") {
      if (this.field === "name" && cleanText(this.name, LIMITS.nameLength)) this.field = "code";
      else this.joinOrCreate();
    } else if (key === "Backspace") {
      if (this.field === "name") this.name = this.name.slice(0, -1);
      else this.codeDraft = this.codeDraft.slice(0, -1);
    } else if (key.length === 1) {
      if (this.field === "name" && this.name.length < LIMITS.nameLength) this.name += key;
      if (this.field === "code" && this.codeDraft.length < ROOM_CODE_LENGTH && /[a-z0-9]/i.test(key)) this.codeDraft += key.toUpperCase();
    }
  }

  public joinOrCreate(): void {
    if (!cleanText(this.name, LIMITS.nameLength)) {
      this.localNotice = "Type your name first";
      this.field = "name";
      return;
    }
    if (this.codeDraft === "") {
      this.enter(roomCodeFrom(this.options.randomBytes(ROOM_CODE_LENGTH)));
    } else if (isRoomCode(this.codeDraft)) {
      this.enter(this.codeDraft);
    } else {
      this.localNotice = `A room code is ${ROOM_CODE_LENGTH} letters and numbers`;
    }
  }

  private enter(code: string): void {
    const name = cleanText(this.name, LIMITS.nameLength);
    this.options.storage?.setItem(NAME_KEY, name);
    const socketUrl = `${this.options.server.replace(/^http/, "ws").replace(/\/$/, "")}/rooms/${code}`;
    this.practice = null;
    this.client = new TableClient(code, socketUrl, this.token, name, this.options.openSocket);
  }

  private leaveRoom(): void {
    this.client?.close();
    this.client = null;
    this.practice = null;
    this.codeDraft = "";
    this.field = "code";
  }

  private drawLobby(width: number, height: number, seconds: number): void {
    const ui = this.ui;
    const columnWidth = Math.min(440, width - 2 * PADDING);
    const left = (width - columnWidth) / 2;
    let y = Math.max(PADDING, height / 2 - 200);
    ui.text(BRIGHT, "Table Games", width / 2, y, 24, "center", 1.1);
    y += 38;
    ui.text(DIM, "Connect 4, Checkers and Battleship, with anyone who has your room's code", width / 2, y, 11, "center");
    y += 30;

    const cursor = Math.floor(seconds * 2) % 2 === 0 ? "_" : " ";
    const fieldBox = (field: Field, label: string, value: string, top: number): void => {
      const rect = { x: left, y: top + 18, width: columnWidth, height: 32 };
      const isActive = this.field === field;
      ui.text(DIM, label, left, top, 11);
      ui.rect(isActive ? ACCENT : TEXT, isActive ? 0.9 : 0.4, rect);
      ui.text(BRIGHT, value + (isActive ? cursor : ""), left + 10, rect.y + 9, 14);
      ui.region(rect, () => (this.field = field));
    };
    fieldBox("name", "Your name", this.name, y);
    y += 64;
    fieldBox("code", "Room code (leave it empty to start a new room)", this.codeDraft, y);
    y += 68;

    const buttonWidth = (columnWidth - 12) / 2;
    ui.button(ACCENT, { x: left, y, width: buttonWidth, height: 32 }, "New room", () => {
      this.codeDraft = "";
      this.joinOrCreate();
    }, 13);
    ui.button(TEXT, { x: left + buttonWidth + 12, y, width: buttonWidth, height: 32 }, "Join room", () => {
      if (this.codeDraft === "") this.localNotice = "Type the room code first";
      else this.joinOrCreate();
    }, 13);
    y += 44;
    if (this.localNotice) ui.text(WARN, this.localNotice, width / 2, y, 11, "center");
    y += 30;

    // Practice needs neither a room nor anyone else.
    ui.text(DIM, "Or practice on this screen, playing both sides:", left, y, 11);
    y += 20;
    const practiceWidth = (columnWidth - 2 * 10) / 3;
    GAME_IDS.forEach((game, index) => {
      ui.button(TEXT, { x: left + index * (practiceWidth + 10), y, width: practiceWidth, height: 30 }, TABLE_GAMES[game].title, () => this.startPractice(game), 12);
    });
    ui.text(DIM, "Tab moves between the boxes; Enter goes on.", width / 2, height - PADDING - 12, 10, "center", 0.8);
  }

  // Practice from the lobby, filling the window; its Stop button comes back here.
  private drawPracticeAlone(practice: Practice, width: number, height: number): void {
    this.drawTable(this.practiceTable(practice), { x: PADDING, y: PADDING, width: width - 2 * PADDING, height: height - 2 * PADDING }, this.localNotice);
  }

  // ── The room: the board, the people and the chat ──────────────────────────

  private drawRoom(client: TableClient, width: number, height: number): void {
    const ui = this.ui;
    const sidebarWidth = Math.max(240, Math.min(340, width * 0.34));
    const sidebarLeft = width - sidebarWidth - PADDING;

    // Header: the code, how to invite, and the way out.
    const title = `Room ${client.code}`;
    ui.text(BRIGHT, title, PADDING, PADDING, 17, "left", 1.05);
    const status = client.status === "connected" ? "" : client.status === "refused" ? "Refused" : client.status === "reconnecting" ? "Reconnecting..." : "Connecting...";
    if (status) ui.text(WARN, status, PADDING + ui.textWidth(title, 17) + 16, PADDING + 4, 12);
    const leaveRect = { x: width - PADDING - 76, y: PADDING - 4, width: 76, height: 26 };
    ui.button(WARN, leaveRect, "Leave", () => this.leaveRoom(), 12);
    const copyRect = { x: leaveRect.x - 120, y: leaveRect.y, width: 112, height: 26 };
    ui.button(TEXT, copyRect, "Copy link", () => this.copyLink(client.code), 12);

    const top = PADDING + 36;
    const tableArea = { x: PADDING, y: top, width: sidebarLeft - 2 * PADDING, height: height - top - PADDING };
    const notice = client.notice ?? this.localNotice;
    if (this.practice) {
      this.drawTable(this.practiceTable(this.practice), tableArea, notice);
    } else if (client.game) {
      this.drawTable(this.roomTable(client, client.game), tableArea, notice);
    } else {
      this.drawGameCards(client, tableArea, notice);
    }
    this.drawSidebar(client, { x: sidebarLeft, y: top, width: sidebarWidth, height: height - top - PADDING });
  }

  private copyLink(code: string): void {
    const link = `${this.options.pageUrl}?open=table-games&room=${code}`;
    this.options.copyText(link).then(
      () => (this.localNotice = "Link copied: send it to a friend"),
      () => (this.localNotice = `Link: ${link}`),
    );
  }

  // With no game on: what can be played, each with a way to start it.
  private drawGameCards(client: TableClient, area: Rect, notice: string | null): void {
    const ui = this.ui;
    const others = client.members.filter((member) => member.isOnline && member.id !== client.you);
    const hint = others.length === 0 ? ["Nobody else is here yet: copy the link and send it to a", "friend. An open invitation waits for them. Or practice."] : ["Anyone here can accept an open invitation, or", "invite one person with the buttons beside their name."];
    ui.text(TEXT, "Choose a game", area.x, area.y, 15);
    hint.forEach((line, index) => ui.text(DIM, ui.fitted(line, 11, area.width), area.x, area.y + 24 + index * 16, 11));
    if (notice) ui.text(WARN, notice, area.x, area.y + 60, 11);

    const cardsTop = area.y + 80;
    const gap = 12;
    const cardHeight = Math.min(110, (area.height - 80 - 2 * gap) / 3);
    GAME_IDS.forEach((game, index) => {
      const card = { x: area.x, y: cardsTop + index * (cardHeight + gap), width: area.width, height: cardHeight };
      ui.rect(TEXT, 0.35, card);
      ui.text(BRIGHT, TABLE_GAMES[game].title, card.x + 14, card.y + 12, 15);
      ui.text(DIM, DESCRIPTIONS[game], card.x + 14, card.y + 36, 11);
      const myOpen = client.invites.find((invite) => invite.from === client.you && invite.to === null && invite.game === game);
      const buttonTop = card.y + card.height - 38;
      if (myOpen) {
        ui.text(ACCENT, "Invitation open: waiting for someone to accept...", card.x + 14, buttonTop + 8, 11);
      } else {
        ui.button(ACCENT, { x: card.x + 14, y: buttonTop, width: 150, height: 28 }, "Invite anyone", () => client.send({ type: "invite", to: null, game }), 12);
      }
      ui.button(TEXT, { x: card.x + card.width - 14 - 120, y: buttonTop, width: 120, height: 28 }, "Practice", () => this.startPractice(game), 12);
    });
  }

  private roomTable(client: TableClient, info: GameInfo): Table {
    const mySeat = seatOf(info, client.you);
    const opponent = mySeat === null ? null : info.seats[mySeat === 0 ? 1 : 0];
    const canRematch = opponent !== null && client.members.some((member) => member.id === opponent && member.isOnline);
    return {
      info,
      mySeat,
      names: [client.memberName(info.seats[0]), client.memberName(info.seats[1])],
      isPractice: false,
      send: (move) => client.send({ type: "move", move }),
      resign: () => client.send({ type: "resign" }),
      rematch: canRematch ? () => client.send({ type: "invite", to: opponent, game: info.game }) : null,
    };
  }

  private practiceTable(practice: Practice): Table {
    return {
      info: practice.info,
      mySeat: practice.actingSeat,
      names: ["Player 1", "Player 2"],
      isPractice: true,
      send: (move) => (this.localNotice = practice.play(move)),
      resign: () => (this.practice = null),
      rematch: () => (this.practice = new Practice(practice.game)),
    };
  }

  private drawTable(table: Table, area: Rect, notice: string | null): void {
    const ui = this.ui;
    const { info, mySeat } = table;

    // A new game (another pair, another game, or a rematch after one ended) starts with fresh choices.
    const gameKey = `${table.isPractice}:${info.game}:${info.seats.join(",")}`;
    if (gameKey !== this.choicesFor || (this.choicesWereOver && !info.outcome)) this.choices = freshChoices();
    this.choicesFor = gameKey;
    this.choicesWereOver = info.outcome !== null;

    const colors = info.game === "battleship" ? [TEXT, TEXT] : SEAT_COLORS[info.game];
    const title = `${TABLE_GAMES[info.game].title}${table.isPractice ? " (practice)" : ""}`;
    ui.text(DIM, title, area.x, area.y, 11);
    const nameTop = area.y + 18;
    ui.text(colors[0], table.names[0], area.x, nameTop, 14);
    const versus = ui.textWidth(table.names[0], 14);
    ui.text(DIM, "vs", area.x + versus + 10, nameTop + 3, 11);
    ui.text(colors[1], table.names[1], area.x + versus + 34, nameTop, 14);
    ui.text(info.outcome ? ACCENT : BRIGHT, this.statusLine(table), area.x, nameTop + 22, 13);

    const buttonTop = area.y + 4;
    if (!info.outcome && (mySeat !== null || table.isPractice)) {
      ui.button(WARN, { x: area.x + area.width - 90, y: buttonTop, width: 90, height: 26 }, table.isPractice ? "Stop" : "Resign", () => table.resign(), 12);
    } else if (info.outcome && table.rematch) {
      ui.button(ACCENT, { x: area.x + area.width - 110, y: buttonTop, width: 110, height: 26 }, table.isPractice ? "Play again" : "Rematch", table.rematch, 12);
      if (table.isPractice) ui.button(WARN, { x: area.x + area.width - 200, y: buttonTop, width: 80, height: 26 }, "Done", () => table.resign(), 12);
    }
    if (notice) ui.text(WARN, notice, area.x, nameTop + 42, 11);

    const boardTop = nameTop + 62;
    const board = { x: area.x, y: boardTop, width: area.width, height: area.y + area.height - boardTop };
    if (info.game === "connect4") drawConnectFour(ui, board, info, mySeat, table.send);
    else if (info.game === "checkers") drawCheckers(ui, board, info, mySeat, this.choices, table.send);
    else drawBattleship(ui, board, info, mySeat, this.choices, table.send);
  }

  private statusLine(table: Table): string {
    const { info, mySeat, names, isPractice } = table;
    const nameOf = (seat: Seat): string => (seat === mySeat && !isPractice ? "You" : names[seat]);
    if (info.outcome?.kind === "draw") return "A draw";
    if (info.outcome) {
      const winner = info.outcome.winner;
      const resigned = info.resignedBy !== null ? `${nameOf(info.resignedBy)} resigned. ` : "";
      return `${resigned}${winner === mySeat && !isPractice ? "You win!" : `${nameOf(winner)} wins`}`;
    }
    if (info.turn === null) {
      if (isPractice) return `${names[mySeat!]}: place your ships, then press Ready (the other player looks away)`;
      return mySeat === null ? "Placing ships" : "Place your ships, then press Ready";
    }
    if (isPractice) return `${names[info.turn]} to move`;
    if (info.turn === mySeat) return "Your move";
    return `${nameOf(info.turn)} to move`;
  }

  private drawSidebar(client: TableClient, area: Rect): void {
    const ui = this.ui;
    let y = area.y;
    ui.text(DIM, "People here", area.x, y, 11);
    y += 20;
    const playing: readonly string[] = client.game && !client.game.outcome ? client.game.seats : [];
    for (const member of client.members) {
      if (!member.isOnline) continue;
      const isYou = member.id === client.you;
      const label = `${member.name}${isYou ? " (you)" : ""}${playing.includes(member.id) ? " - playing" : ""}`;
      ui.text(isYou ? BRIGHT : TEXT, ui.fitted(label, 12, area.width - 150), area.x, y + 4, 12);
      const invitable = !isYou && playing.length === 0 && client.you !== null;
      if (invitable) {
        let x = area.x + area.width;
        for (const game of [...GAME_IDS].reverse()) {
          const buttonWidth = ui.textWidth(SHORT_NAMES[game], 10) + 12;
          x -= buttonWidth;
          ui.button(TEXT, { x, y, width: buttonWidth, height: 20 }, SHORT_NAMES[game], () => client.send({ type: "invite", to: member.id, game }), 10);
          x -= 4;
        }
      }
      y += 24;
    }

    // Invitations: those to me (or open to anyone) can be answered; mine show who I am waiting for.
    for (const invite of client.invites) {
      const title = TABLE_GAMES[invite.game].title;
      if (invite.from !== client.you && (invite.to === client.you || (invite.to === null && !this.declined.has(inviteKey(invite))))) {
        ui.text(ACCENT, ui.fitted(`${client.memberName(invite.from)}: ${title}?`, 11, area.width - 96), area.x, y + 5, 11);
        ui.button(ACCENT, { x: area.x + area.width - 92, y, width: 44, height: 20 }, "Yes", () => client.send({ type: "answer", from: invite.from, accept: true }), 10);
        ui.button(WARN, { x: area.x + area.width - 44, y, width: 44, height: 20 }, "No", () => {
          if (invite.to === null) this.declined.add(inviteKey(invite));
          else client.send({ type: "answer", from: invite.from, accept: false });
        }, 10);
        y += 24;
      } else if (invite.from === client.you) {
        const whom = invite.to === null ? "anyone" : client.memberName(invite.to);
        ui.text(DIM, ui.fitted(`You invited ${whom}: ${title}`, 11, area.width), area.x, y + 5, 11);
        y += 24;
      }
    }

    y += 8;
    ui.pen(DIM, 0.4).addSegment(area.x, y, area.x + area.width, y);
    y += 10;
    this.drawChat(client, { x: area.x, y, width: area.width, height: area.y + area.height - y });
  }

  private drawChat(client: TableClient, area: Rect): void {
    const ui = this.ui;
    const inputTop = area.y + area.height - 24;
    ui.rect(TEXT, 0.4, { x: area.x, y: inputTop, width: area.width, height: 24 });
    const draft = `> ${this.chatDraft}_`;
    // The end of a long draft stays in view.
    let shown = draft;
    while (shown.length > 3 && ui.textWidth(shown, CHAT_SIZE) > area.width - 12) shown = shown.slice(1);
    ui.text(BRIGHT, shown, area.x + 6, inputTop + 7, CHAT_SIZE);

    // The newest lines just above the input, older ones above them, as many as fit.
    const lines: { text: string; color: BeamColor }[] = [];
    for (const entry of client.chat) {
      const color = entry.from === client.you ? BRIGHT : TEXT;
      for (const line of wrap(ui, `${entry.name}: ${entry.text}`, area.width)) lines.push({ text: line, color });
    }
    const fit = Math.max(0, Math.floor((inputTop - 6 - area.y) / CHAT_PITCH));
    const visible = lines.slice(-fit);
    let y = inputTop - 6 - visible.length * CHAT_PITCH;
    for (const { text, color } of visible) {
      ui.text(color, text, area.x, y + (CHAT_PITCH - CHAT_SIZE) / 2, CHAT_SIZE);
      y += CHAT_PITCH;
    }
    if (client.chat.length === 0) ui.text(DIM, "Type to chat; Enter sends.", area.x, inputTop - 22, 10);
  }
}

function inviteKey(invite: Invite): string {
  return `${invite.from}:${invite.game}`;
}

function seatOf(info: GameInfo, memberId: string | null): Seat | null {
  if (memberId === info.seats[0]) return 0;
  if (memberId === info.seats[1]) return 1;
  return null;
}

// Words laid into lines no wider than `width`; a word too long for a line is broken.
function wrap(ui: Ui, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (ui.textWidth(candidate, CHAT_SIZE) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (ui.textWidth(line, CHAT_SIZE) > width && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && ui.textWidth(line.slice(0, cut), CHAT_SIZE) > width) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
}

function readOrMakeToken(options: TableGamesOptions): string {
  const stored = options.storage?.getItem(TOKEN_KEY);
  if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) return stored;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const token = Array.from(options.randomBytes(32), (byte) => alphabet[byte % 64]).join("");
  options.storage?.setItem(TOKEN_KEY, token);
  return token;
}

// The room server: VITE_TABLE_GAMES_SERVER when the site was built with one, otherwise a
// server on this machine (npm run dev in services/table-games) at port 8787.
function defaultServer(page: Location | undefined): string {
  const configured = import.meta.env.VITE_TABLE_GAMES_SERVER as string | undefined;
  if (configured) return configured;
  return page ? `${page.protocol}//${page.hostname}:8787` : "http://localhost:8787";
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return {
      getItem: (key) => {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key, value) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          // Private windows may refuse; the token then lasts as long as the window.
        }
      },
    };
  } catch {
    return null;
  }
}

export function createTableGames(): OsApp {
  // Outside a browser (the tests), there is no page.
  const page = typeof location === "undefined" ? undefined : location;
  const tableGames = new TableGames({
    server: defaultServer(page),
    openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    storage: browserStorage(),
    randomBytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
    pageUrl: page ? `${page.origin}${page.pathname}` : "",
    roomFromLink: page ? new URLSearchParams(page.search).get("room") : null,
    copyText: (text) => navigator.clipboard.writeText(text),
  });
  return {
    demo: tableGames,
    worldHeight: null,
    onKey: (key) => tableGames.key(key),
    onPointer: (kind, x, y) => tableGames.pointer(kind, x, y),
    dispose: () => tableGames.dispose(),
  };
}
