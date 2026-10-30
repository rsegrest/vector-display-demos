import type { BeamColor, DisplayList } from "@vector-display/core";
import type { Demo, DemoFrame } from "@vector-demos/demo-kit";
import { cleanText, isRoomCode, LIMITS, ROOM_CODE_LENGTH, roomCodeFrom, TABLE_GAMES, type GameId, type GameInfo, type Seat } from "@vector-demos/table-games";
import type { OsApp, PointerKind } from "../OsApp.js";
import { drawBattleship, drawCheckers, drawConnectFour, freshChoices, SEAT_COLORS, type BoardChoices } from "./boards.js";
import { TableClient, type SocketFactory, type SocketLike } from "./TableClient.js";
import { Ui, type Rect } from "./Ui.js";

// Table Games: two-player board games with anyone who has the room's code or link, and a chat.
// Rooms are invitation-only: there is no list of them, so a room is found only by its code.
// The rules run on the room server (services/table-games); this window draws what it is sent
// and sends back what was clicked. The games' rules follow game-clawtroller's.

const TEXT: BeamColor = { red: 0.6, green: 0.85, blue: 1 };
const DIM: BeamColor = { red: 0.4, green: 0.55, blue: 0.75 };
const BRIGHT: BeamColor = { red: 0.9, green: 1, blue: 0.95 };
const WARN: BeamColor = { red: 1, green: 0.55, blue: 0.4 };
const ACCENT: BeamColor = { red: 1, green: 0.8, blue: 0.35 };

const SHORT_NAMES: Readonly<Record<GameId, string>> = { connect4: "C4", checkers: "CHK", battleship: "SHIP" };
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

export class TableGames implements Demo {
  public client: TableClient | null = null;
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
      this.lobbyKey(key);
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
    else this.drawLobby(frame.width, frame.height, frame.seconds);
    this.ui.end();
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
    this.client = new TableClient(code, socketUrl, this.token, name, this.options.openSocket);
  }

  private leaveRoom(): void {
    this.client?.close();
    this.client = null;
    this.codeDraft = "";
    this.field = "code";
  }

  private drawLobby(width: number, height: number, seconds: number): void {
    const ui = this.ui;
    const columnWidth = Math.min(420, width - 2 * PADDING);
    const left = (width - columnWidth) / 2;
    let y = Math.max(PADDING, height / 2 - 150);
    ui.text(BRIGHT, "TABLE GAMES", width / 2, y, 22, "center", 1.2);
    y += 36;
    ui.text(DIM, "PLAY CONNECT 4, CHECKERS OR BATTLESHIP", width / 2, y, 10, "center");
    ui.text(DIM, "WITH ANYONE WHO HAS YOUR ROOM'S CODE", width / 2, y + 16, 10, "center");
    y += 48;

    const cursor = Math.floor(seconds * 2) % 2 === 0 ? "_" : " ";
    const fieldBox = (field: Field, label: string, value: string, top: number): void => {
      const rect = { x: left, y: top + 16, width: columnWidth, height: 30 };
      const isActive = this.field === field;
      ui.text(DIM, label, left, top, 10);
      ui.rect(isActive ? ACCENT : TEXT, isActive ? 0.9 : 0.4, rect);
      ui.text(BRIGHT, value + (isActive ? cursor : ""), left + 10, rect.y + 8, 14);
      ui.region(rect, () => (this.field = field));
    };
    fieldBox("name", "YOUR NAME", this.name, y);
    y += 62;
    fieldBox("code", "ROOM CODE (LEAVE EMPTY FOR A NEW ROOM)", this.codeDraft, y);
    y += 66;

    const buttonWidth = (columnWidth - 12) / 2;
    ui.button(ACCENT, { x: left, y, width: buttonWidth, height: 30 }, "NEW ROOM", () => {
      this.codeDraft = "";
      this.joinOrCreate();
    });
    ui.button(TEXT, { x: left + buttonWidth + 12, y, width: buttonWidth, height: 30 }, "JOIN ROOM", () => {
      if (this.codeDraft === "") this.localNotice = "Type the room code first";
      else this.joinOrCreate();
    });
    y += 46;
    if (this.localNotice) ui.text(WARN, this.localNotice, width / 2, y, 11, "center");
    ui.text(DIM, "TAB SWITCHES FIELDS. ENTER GOES ON.", width / 2, height - PADDING - 10, 9, "center", 0.7);
  }

  // ── The room: the board, the people and the chat ──────────────────────────

  private drawRoom(client: TableClient, width: number, height: number): void {
    const ui = this.ui;
    const sidebarWidth = Math.max(230, Math.min(330, width * 0.34));
    const sidebarLeft = width - sidebarWidth - PADDING;

    // Header: the code, how to invite, and the way out.
    ui.text(BRIGHT, `ROOM ${client.code}`, PADDING, PADDING, 16, "left", 1.1);
    const status = client.status === "connected" ? "" : client.status === "refused" ? "REFUSED" : client.status === "reconnecting" ? "RECONNECTING..." : "CONNECTING...";
    if (status) ui.text(WARN, status, PADDING + ui.textWidth(`ROOM ${client.code}`, 16) + 16, PADDING + 3, 11);
    const leaveRect = { x: width - PADDING - 70, y: PADDING - 4, width: 70, height: 24 };
    ui.button(WARN, leaveRect, "LEAVE", () => this.leaveRoom(), 11);
    const copyRect = { x: leaveRect.x - 120, y: leaveRect.y, width: 112, height: 24 };
    ui.button(TEXT, copyRect, "COPY LINK", () => this.copyLink(client.code), 11);

    const top = PADDING + 34;
    this.drawTable(client, { x: PADDING, y: top, width: sidebarLeft - 2 * PADDING, height: height - top - PADDING });
    this.drawSidebar(client, { x: sidebarLeft, y: top, width: sidebarWidth, height: height - top - PADDING });
  }

  private copyLink(code: string): void {
    const link = `${this.options.pageUrl}?open=table-games&room=${code}`;
    this.options.copyText(link).then(
      () => (this.localNotice = "Link copied"),
      () => (this.localNotice = `Link: ${link}`),
    );
  }

  private drawTable(client: TableClient, area: Rect): void {
    const ui = this.ui;
    const notice = client.notice ?? this.localNotice;
    const info = client.game;
    if (!info) {
      const middle = area.y + area.height / 2 - 30;
      const isAlone = client.members.filter((member) => member.isOnline).length < 2;
      ui.text(TEXT, "NO GAME YET", area.x + area.width / 2, middle, 16, "center");
      const hint = isAlone ? "SHARE THE ROOM CODE OR LINK WITH A FRIEND" : "INVITE SOMEONE FROM THE LIST AT RIGHT";
      ui.text(DIM, hint, area.x + area.width / 2, middle + 28, 10, "center");
      if (notice) ui.text(WARN, notice, area.x + area.width / 2, middle + 52, 11, "center");
      return;
    }

    // A new game (another pair, another game, or a rematch after one ended) starts with fresh choices.
    const gameKey = `${info.game}:${info.seats.join(",")}`;
    if (gameKey !== this.choicesFor || (this.choicesWereOver && !info.outcome)) this.choices = freshChoices();
    this.choicesFor = gameKey;
    this.choicesWereOver = info.outcome !== null;

    const mySeat = seatOf(info, client.you);
    const seatName = (seat: Seat): string => client.memberName(info.seats[seat]);
    const colors = info.game === "battleship" ? [TEXT, TEXT] : SEAT_COLORS[info.game];
    ui.text(colors[0], seatName(0), area.x, area.y, 13);
    const versus = ui.textWidth(seatName(0), 13);
    ui.text(DIM, "VS", area.x + versus + 10, area.y + 2, 10);
    ui.text(colors[1], seatName(1), area.x + versus + 36, area.y, 13);
    ui.text(DIM, TABLE_GAMES[info.game].title, area.x + area.width, area.y + 2, 10, "right");

    ui.text(info.outcome ? ACCENT : BRIGHT, this.statusLine(client, info, mySeat), area.x, area.y + 22, 12);
    const buttonTop = area.y + 18;
    if (mySeat !== null && !info.outcome) {
      ui.button(WARN, { x: area.x + area.width - 80, y: buttonTop, width: 80, height: 22 }, "RESIGN", () => client.send({ type: "resign" }), 10);
    } else if (mySeat !== null && info.outcome) {
      const opponent = info.seats[mySeat === 0 ? 1 : 0];
      if (client.members.find((member) => member.id === opponent)?.isOnline) {
        ui.button(ACCENT, { x: area.x + area.width - 90, y: buttonTop, width: 90, height: 22 }, "REMATCH", () => client.send({ type: "invite", to: opponent, game: info.game }), 10);
      }
    }
    if (notice) ui.text(WARN, notice, area.x, area.y + 40, 10);

    const board = { x: area.x, y: area.y + 58, width: area.width, height: area.height - 58 };
    const send = (move: unknown): void => client.send({ type: "move", move });
    if (info.game === "connect4") drawConnectFour(ui, board, info, mySeat, send);
    else if (info.game === "checkers") drawCheckers(ui, board, info, mySeat, this.choices, send);
    else drawBattleship(ui, board, info, mySeat, this.choices, send);
  }

  private statusLine(client: TableClient, info: GameInfo, mySeat: Seat | null): string {
    const nameOf = (seat: Seat): string => (seat === mySeat ? "YOU" : client.memberName(info.seats[seat]));
    if (info.outcome?.kind === "draw") return "A DRAW";
    if (info.outcome) {
      const winner = info.outcome.winner;
      const resigned = info.resignedBy !== null ? `${nameOf(info.resignedBy)} RESIGNED. ` : "";
      return `${resigned}${winner === mySeat ? "YOU WIN" : `${nameOf(winner)} WINS`}`;
    }
    if (info.turn === null) return mySeat === null ? "PLACING SHIPS" : "PLACE YOUR SHIPS, THEN READY";
    if (info.turn === mySeat) return "YOUR MOVE";
    return `${nameOf(info.turn)}'S MOVE`;
  }

  private drawSidebar(client: TableClient, area: Rect): void {
    const ui = this.ui;
    let y = area.y;
    ui.text(DIM, "PEOPLE", area.x, y, 10);
    y += 18;
    const playing: readonly string[] = client.game && !client.game.outcome ? client.game.seats : [];
    for (const member of client.members) {
      if (!member.isOnline) continue;
      const isYou = member.id === client.you;
      const label = `${member.name}${isYou ? " (YOU)" : ""}${playing.includes(member.id) ? " *" : ""}`;
      ui.text(isYou ? BRIGHT : TEXT, ui.fitted(label, 11, area.width - 130), area.x, y + 4, 11);
      const invitable = !isYou && playing.length === 0 && client.you !== null;
      if (invitable) {
        let x = area.x + area.width;
        for (const game of ["battleship", "checkers", "connect4"] as const) {
          const buttonWidth = ui.textWidth(SHORT_NAMES[game], 9) + 10;
          x -= buttonWidth;
          ui.button(TEXT, { x, y, width: buttonWidth, height: 18 }, SHORT_NAMES[game], () => client.send({ type: "invite", to: member.id, game }), 9);
          x -= 4;
        }
      }
      y += 22;
    }

    // Invitations: those to me can be answered; mine show who I am waiting for.
    for (const invite of client.invites) {
      const title = TABLE_GAMES[invite.game].title;
      if (invite.to === client.you) {
        ui.text(ACCENT, ui.fitted(`${client.memberName(invite.from)}: ${title}?`, 10, area.width - 92), area.x, y + 5, 10);
        ui.button(ACCENT, { x: area.x + area.width - 88, y, width: 42, height: 18 }, "YES", () => client.send({ type: "answer", from: invite.from, accept: true }), 9);
        ui.button(WARN, { x: area.x + area.width - 42, y, width: 42, height: 18 }, "NO", () => client.send({ type: "answer", from: invite.from, accept: false }), 9);
        y += 22;
      } else if (invite.from === client.you) {
        ui.text(DIM, ui.fitted(`INVITED ${client.memberName(invite.to)}: ${title}`, 10, area.width), area.x, y + 5, 10);
        y += 22;
      }
    }

    y += 8;
    ui.pen(DIM, 0.4).addSegment(area.x, y, area.x + area.width, y);
    y += 8;
    this.drawChat(client, { x: area.x, y, width: area.width, height: area.y + area.height - y });
  }

  private drawChat(client: TableClient, area: Rect): void {
    const ui = this.ui;
    const inputTop = area.y + area.height - 22;
    ui.rect(TEXT, 0.4, { x: area.x, y: inputTop, width: area.width, height: 22 });
    const draft = `> ${this.chatDraft}_`;
    // The end of a long draft stays in view.
    let shown = draft;
    while (shown.length > 3 && ui.textWidth(shown, CHAT_SIZE) > area.width - 12) shown = shown.slice(1);
    ui.text(BRIGHT, shown, area.x + 6, inputTop + 6, CHAT_SIZE);

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
      ui.text(color, text, area.x, y + (CHAT_PITCH - CHAT_SIZE), CHAT_SIZE);
      y += CHAT_PITCH;
    }
    if (client.chat.length === 0) ui.text(DIM, "TYPE TO CHAT. ENTER SENDS.", area.x, inputTop - 22, 9);
  }
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
