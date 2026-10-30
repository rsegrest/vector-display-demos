import type { BeamColor, DisplayList } from "@vector-display/core";
import type { Demo, DemoFrame } from "@vector-demos/demo-kit";
import {
  AVAILABLE_GAMES,
  cleanText,
  isRoomCode,
  LIMITS,
  ROOM_CODE_LENGTH,
  roomCodeFrom,
  rulesFor,
  type GameFamily,
  type GameId,
  type Outcome,
  type Seat,
  type TableInfo,
} from "@vector-demos/table-games";
import type { OsApp, PointerKind } from "../OsApp.js";
import { BOARD_COLORS, type BoardContext } from "./boards/BoardContext.js";
import { BOARDS } from "./boards/index.js";
import { Practice } from "./Practice.js";
import { TableClient, type SocketFactory, type SocketLike } from "./TableClient.js";
import { Ui, type Rect } from "./Ui.js";

// Table Games: board, card, dice and casino games with anyone who has the room's code or link,
// or against computer players, with a chat beside the table. Rooms are invitation-only: there
// is no list of them, so a room is found only by its code. The rules run on the room server
// (services/table-games); this window draws what it is sent and sends back what was clicked.
// Practice games run the same rules here, with no server. The rules follow game-clawtroller's.

const TEXT: BeamColor = BOARD_COLORS.text;
const DIM: BeamColor = BOARD_COLORS.dim;
const BRIGHT: BeamColor = BOARD_COLORS.bright;
const WARN: BeamColor = BOARD_COLORS.warn;
const ACCENT: BeamColor = BOARD_COLORS.accent;

const FAMILY_TITLES: Readonly<Record<GameFamily, string>> = {
  board: "Board games",
  "dice and words": "Dice and words",
  cards: "Cards",
  casino: "Casino",
};
const FAMILY_ORDER: readonly GameFamily[] = ["board", "dice and words", "cards", "casino"];
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

// A game on the table, from the room or from practice, as the header and the board need it.
interface Game {
  readonly game: GameId;
  readonly view: unknown;
  readonly mySeat: Seat | null;
  readonly toMove: readonly Seat[];
  readonly names: readonly string[];
  readonly outcome: Outcome | null;
  readonly isPractice: boolean;
  send(move: unknown): void;
}

export class TableGames implements Demo {
  public client: TableClient | null = null;
  public practice: Practice | null = null;
  public name: string;
  public codeDraft: string;
  public chatDraft = "";
  public field: Field;
  // The game picked in the list, whose card shows how to play it.
  public pickedGame: GameId = AVAILABLE_GAMES[0];
  // Playing with no room: the game list stands in for the lobby.
  public isChoosingOffline = false;
  private readonly token: string;
  private readonly ui = new Ui();
  // The board's own state; emptied when a new game starts.
  private boardLocal: Record<string, unknown> = {};
  private boardLocalFor = "";
  private localNotice: string | null = null;
  private seconds = 0;
  // "Play the computer" in a room opens a table for this game, then adds a computer player to it.
  private computerWanted: GameId | null = null;

  public constructor(private readonly options: TableGamesOptions) {
    this.token = readOrMakeToken(options);
    this.name = options.storage?.getItem(NAME_KEY) ?? "";
    this.codeDraft = options.roomFromLink && isRoomCode(options.roomFromLink.toUpperCase()) ? options.roomFromLink.toUpperCase() : "";
    this.field = this.name ? "code" : "name";
    // From a link, with a name already known, go straight in.
    if (this.codeDraft && this.name) this.enter(this.codeDraft);
  }

  public update(deltaSeconds: number): void {
    this.seconds += deltaSeconds;
    this.practice?.update(deltaSeconds);
  }

  public key(key: string): void {
    if (!this.client) {
      if (!this.practice && !this.isChoosingOffline) this.lobbyKey(key);
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
    const whole = { x: PADDING, y: PADDING, width: frame.width - 2 * PADDING, height: frame.height - 2 * PADDING };
    if (this.client) this.drawRoom(this.client, frame.width, frame.height);
    else if (this.practice) this.drawPractice(this.practice, whole);
    else if (this.isChoosingOffline) this.drawOfflinePicker(whole);
    else this.drawLobby(frame.width, frame.height, frame.seconds);
    this.ui.end();
  }

  public drawText(displayList: DisplayList): void {
    this.ui.drawText(displayList);
  }

  // Presses the button with this label, as drawn in the last frame. Returns whether there was one.
  public pressButton(label: string): boolean {
    const rect = this.ui.buttonRect(label);
    if (!rect) return false;
    this.pointer("down", rect.x + rect.width / 2, rect.y + rect.height / 2);
    return true;
  }

  // Practice on this screen: `computers` of the seats played by the simple computer player.
  public startPractice(game: GameId, withComputer: boolean): void {
    const rules = rulesFor(game);
    const seats = Math.max(rules.minPlayers, Math.min(2, rules.maxPlayers));
    this.practice = new Practice(game, Array.from({ length: seats }, (_, seat) => withComputer && seat > 0));
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
    this.isChoosingOffline = false;
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
    ui.text(DIM, `${AVAILABLE_GAMES.length} board, card, dice and casino games, with anyone who has your room's code`, width / 2, y, 11, "center");
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

    // Playing here needs neither a room nor anyone else.
    ui.text(DIM, "Or play here, with no room: practice both sides, or play the computer", left, y, 11);
    y += 20;
    ui.button(TEXT, { x: left, y, width: columnWidth, height: 30 }, "Choose a game to play here", () => (this.isChoosingOffline = true), 12);
    ui.text(DIM, "Tab moves between the boxes; Enter goes on.", width / 2, height - PADDING - 12, 10, "center", 0.8);
  }

  private drawOfflinePicker(area: Rect): void {
    this.ui.text(BRIGHT, "Play here", area.x, area.y, 17, "left", 1.05);
    this.ui.button(WARN, { x: area.x + area.width - 80, y: area.y - 4, width: 80, height: 26 }, "Back", () => (this.isChoosingOffline = false), 12);
    this.drawGamePicker({ x: area.x, y: area.y + 36, width: area.width, height: area.height - 36 }, null);
  }

  // The games, grouped by kind, and the picked one's card with the ways to play it. In a room,
  // its table can be opened; with no room, it can be practiced here.
  private drawGamePicker(area: Rect, client: TableClient | null): void {
    const ui = this.ui;
    const listWidth = Math.min(300, area.width * 0.5);
    let y = area.y;
    for (const family of FAMILY_ORDER) {
      const games = AVAILABLE_GAMES.filter((game) => rulesFor(game).family === family);
      if (games.length === 0) continue;
      ui.text(DIM, FAMILY_TITLES[family], area.x, y, 10);
      y += 16;
      let x = area.x;
      for (const game of games) {
        const title = rulesFor(game).title;
        const width = ui.textWidth(title, 11) + 14;
        if (x + width > area.x + listWidth) {
          x = area.x;
          y += 26;
        }
        const rect = { x, y, width, height: 22 };
        ui.button(game === this.pickedGame ? ACCENT : TEXT, rect, title, () => (this.pickedGame = game), 11);
        if (game === this.pickedGame) ui.rect(ACCENT, 0.8, rect, 3);
        x += width + 6;
      }
      y += 34;
    }

    const rules = rulesFor(this.pickedGame);
    const card = { x: area.x + listWidth + 16, y: area.y, width: area.width - listWidth - 16, height: Math.min(area.height, 200) };
    ui.rect(TEXT, 0.35, card);
    ui.text(BRIGHT, rules.title, card.x + 14, card.y + 14, 16);
    ui.text(DIM, ui.fitted(rules.description, 11, card.width - 28), card.x + 14, card.y + 40, 11);
    const players = rules.minPlayers === rules.maxPlayers ? `${rules.minPlayers} players` : `${rules.minPlayers} to ${rules.maxPlayers} players`;
    ui.text(DIM, players, card.x + 14, card.y + 58, 10);
    const buttonWidth = card.width - 28;
    let buttonTop = card.y + 82;
    const add = (label: string, color: BeamColor, action: () => void): void => {
      ui.button(color, { x: card.x + 14, y: buttonTop, width: buttonWidth, height: 26 }, label, action, 12);
      buttonTop += 34;
    };
    if (client) {
      add("Open a table: anyone here may sit down", ACCENT, () => client.send({ type: "open", game: this.pickedGame, invite: null }));
      add(`Play ${client.computerName}`, TEXT, () => {
        client.send({ type: "open", game: this.pickedGame, invite: null });
        this.computerWanted = this.pickedGame;
      });
      add("Practice here, playing every side", TEXT, () => this.startPractice(this.pickedGame, false));
    } else {
      add(rules.maxPlayers > 1 ? "Play the computer" : "Play", ACCENT, () => this.startPractice(this.pickedGame, rules.maxPlayers > 1));
      if (rules.maxPlayers > 1) add("Practice here, playing every side", TEXT, () => this.startPractice(this.pickedGame, false));
    }
  }

  // ── The room: the table, the people and the chat ──────────────────────────

  private drawRoom(client: TableClient, width: number, height: number): void {
    const ui = this.ui;
    const sidebarWidth = Math.max(220, Math.min(320, width * 0.3));
    const sidebarLeft = width - sidebarWidth - PADDING;

    // Header: the code, how to invite, and the way out.
    const title = `Room ${client.code}`;
    ui.text(BRIGHT, title, PADDING, PADDING, 17, "left", 1.05);
    const status = client.status === "connected" ? "" : client.status === "refused" ? "Refused" : client.status === "reconnecting" ? "Reconnecting..." : "Connecting...";
    if (status) ui.text(WARN, status, PADDING + ui.textWidth(title, 17) + 16, PADDING + 4, 12);
    const leaveRect = { x: width - PADDING - 76, y: PADDING - 4, width: 76, height: 26 };
    ui.button(WARN, leaveRect, "Leave", () => this.leaveRoom(), 12);
    ui.button(TEXT, { x: leaveRect.x - 120, y: leaveRect.y, width: 112, height: 26 }, "Copy link", () => this.copyLink(client.code), 12);

    const top = PADDING + 36;
    const tableArea = { x: PADDING, y: top, width: sidebarLeft - 2 * PADDING, height: height - top - PADDING };
    const notice = client.notice ?? this.localNotice;
    const table = client.table;
    // "Play the computer" opened a table: add the computer player now it is there.
    if (this.computerWanted && table && !table.isStarted && table.host === client.you && table.game === this.computerWanted) {
      this.computerWanted = null;
      client.send({ type: "addComputer" });
    }
    if (this.practice) {
      this.drawPractice(this.practice, tableArea);
    } else if (!table) {
      ui.text(TEXT, "Choose a game", tableArea.x, tableArea.y, 15);
      if (notice) ui.text(WARN, notice, tableArea.x + 140, tableArea.y + 3, 11);
      this.drawGamePicker({ x: tableArea.x, y: tableArea.y + 30, width: tableArea.width, height: tableArea.height - 30 }, client);
    } else if (!table.isStarted) {
      this.drawGathering(client, table, tableArea, notice);
    } else {
      this.drawRoomGame(client, table, tableArea, notice);
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

  // A table opened and waiting for players: who sits where, and the ways to fill it and start.
  private drawGathering(client: TableClient, table: TableInfo, area: Rect, notice: string | null): void {
    const ui = this.ui;
    const rules = rulesFor(table.game);
    const isHost = table.host === client.you;
    const isSeated = table.seats.includes(client.you ?? "");
    const isFull = table.seats.length >= rules.maxPlayers;
    ui.text(BRIGHT, `${rules.title}: a table is open`, area.x, area.y, 15);
    const players = rules.minPlayers === rules.maxPlayers ? `${rules.minPlayers} players` : `${rules.minPlayers} to ${rules.maxPlayers} players`;
    ui.text(DIM, `${players}. ${isHost ? "Start when everyone is seated" : `${table.names[0]} starts it`}${rules.minPlayers === rules.maxPlayers ? ", or it starts when the seats are full." : "."}`, area.x, area.y + 24, 11);
    if (notice) ui.text(WARN, notice, area.x, area.y + 42, 11);

    let y = area.y + 66;
    for (let seat = 0; seat < rules.maxPlayers; seat++) {
      const name = table.names[seat];
      const color = BOARD_COLORS.seats[seat % BOARD_COLORS.seats.length];
      ui.text(name ? color : DIM, `Seat ${seat + 1}: ${name ?? "empty"}${seat === 0 ? " (host)" : ""}`, area.x + 4, y, 12);
      y += 22;
    }
    y += 10;
    let x = area.x;
    const add = (label: string, color: BeamColor, action: () => void): void => {
      const width = ui.textWidth(label, 12) + 22;
      ui.button(color, { x, y, width, height: 28 }, label, action, 12);
      x += width + 10;
    };
    if (!isSeated && !isFull) add(table.invited === client.you ? "Accept: sit down" : "Sit down", ACCENT, () => client.send({ type: "sit" }));
    if (!isSeated && table.invited === client.you) add("No thanks", WARN, () => client.send({ type: "stand" }));
    if (isHost && !isFull) add(`Add ${client.computerName}`, TEXT, () => client.send({ type: "addComputer" }));
    if (isHost && table.seats.length >= rules.minPlayers) add("Start", ACCENT, () => client.send({ type: "start" }));
    if (isSeated) add(isHost ? "Close the table" : "Get up", WARN, () => client.send({ type: "stand" }));
  }

  private drawRoomGame(client: TableClient, table: TableInfo, area: Rect, notice: string | null): void {
    const mySeat = table.seats.indexOf(client.you ?? "");
    const game: Game = {
      game: table.game,
      view: table.view,
      mySeat: mySeat >= 0 ? mySeat : null,
      toMove: table.toMove,
      names: table.names,
      outcome: table.outcome,
      isPractice: false,
      send: (move) => client.send({ type: "move", move }),
    };
    const isHost = table.host === client.you;
    const rules = rulesFor(table.game);
    const buttons: { label: string; color: BeamColor; action: () => void }[] = [];
    if (!table.outcome && mySeat >= 0) buttons.push({ label: table.seats.length === 2 ? "Resign" : "Leave the game", color: WARN, action: () => client.send({ type: "resign" }) });
    if (!table.outcome && isHost && rules.finish) buttons.push({ label: "End the game", color: WARN, action: () => client.send({ type: "close" }) });
    if (table.outcome) buttons.push({ label: "Clear the table", color: ACCENT, action: () => client.send({ type: "close" }) });
    this.drawGame(game, area, notice, buttons);
  }

  // ── Practice: a game played in this window alone ──────────────────────────

  private drawPractice(practice: Practice, area: Rect): void {
    const game: Game = {
      game: practice.game,
      view: practice.view,
      mySeat: practice.actingSeat,
      toMove: practice.toMove,
      names: practice.names,
      outcome: practice.outcome,
      isPractice: true,
      send: (move) => (this.localNotice = practice.play(move)),
    };
    const buttons = practice.outcome
      ? [
          { label: "Play again", color: ACCENT, action: () => (this.practice = new Practice(practice.game, practice.isComputer)) },
          { label: "Done", color: WARN, action: () => (this.practice = null) },
        ]
      : [{ label: "Stop", color: WARN, action: () => practice.stop() }];
    this.drawGame(game, area, this.localNotice, buttons);
  }

  // A game in progress or finished: its title, the players, what is happening, the buttons, and
  // below them the game's own board.
  private drawGame(game: Game, area: Rect, notice: string | null, buttons: readonly { label: string; color: BeamColor; action: () => void }[]): void {
    const ui = this.ui;
    const rules = rulesFor(game.game);
    const startedKey = `${game.isPractice}:${game.game}:${game.names.join(",")}:${game.outcome === null}`;
    // A new game starts its board afresh (a finished one keeps its board as it was).
    if (startedKey !== this.boardLocalFor && game.outcome === null) this.boardLocal = {};
    this.boardLocalFor = startedKey;

    ui.text(DIM, `${rules.title}${game.isPractice ? " (here, on this screen)" : ""}`, area.x, area.y, 11);
    let x = area.x;
    game.names.forEach((name, seat) => {
      const color = BOARD_COLORS.seats[seat % BOARD_COLORS.seats.length];
      const label = `${name}${seat === game.mySeat && !game.isPractice ? " (you)" : ""}`;
      ui.text(color, label, x, area.y + 18, 13, "left", game.toMove.includes(seat) ? 1.25 : 0.8);
      x += ui.textWidth(label, 13) + 18;
    });
    ui.text(game.outcome ? ACCENT : BRIGHT, statusLine(game), area.x, area.y + 38, 12);
    if (notice) ui.text(WARN, notice, area.x, area.y + 56, 10);

    let buttonX = area.x + area.width;
    for (const { label, color, action } of buttons) {
      const width = ui.textWidth(label, 11) + 18;
      buttonX -= width;
      ui.button(color, { x: buttonX, y: area.y - 2, width, height: 24 }, label, action, 11);
      buttonX -= 8;
    }

    const boardTop = area.y + 74;
    const context: BoardContext = {
      ui,
      area: { x: area.x, y: boardTop, width: area.width, height: area.y + area.height - boardTop },
      view: game.view,
      mySeat: game.mySeat,
      toMove: game.toMove,
      names: game.names,
      outcome: game.outcome,
      send: game.send,
      local: this.boardLocal,
      seconds: this.seconds,
    };
    BOARDS[game.game]?.(context);
  }

  private drawSidebar(client: TableClient, area: Rect): void {
    const ui = this.ui;
    let y = area.y;
    ui.text(DIM, "People here", area.x, y, 11);
    y += 20;
    const seated = client.table?.seats ?? [];
    for (const member of client.members) {
      if (!member.isOnline) continue;
      const isYou = member.id === client.you;
      const label = `${member.name}${isYou ? " (you)" : ""}${seated.includes(member.id) ? " - at the table" : ""}`;
      ui.text(isYou ? BRIGHT : TEXT, ui.fitted(label, 12, area.width), area.x, y + 4, 12);
      y += 22;
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
    // The end of a long draft stays in view.
    let shown = `> ${this.chatDraft}_`;
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
    if (client.chat.length === 0) ui.text(DIM, "Type to chat with everyone here; Enter sends.", area.x, inputTop - 22, 10);
  }
}

// What is happening, in a line: who won, or whose move it is.
function statusLine(game: Game): string {
  const nameOf = (seat: Seat): string => (seat === game.mySeat && !game.isPractice ? "You" : game.names[seat]);
  const { outcome } = game;
  if (outcome) {
    const summary = outcome.summary ? ` (${outcome.summary})` : "";
    if (outcome.winners.length === 0) return `No winner${summary}`;
    if (outcome.winners.length === 1) return `${nameOf(outcome.winners[0])} ${outcome.winners[0] === game.mySeat && !game.isPractice ? "win!" : "wins"}${summary}`;
    return `${outcome.winners.map(nameOf).join(" and ")} tie${summary}`;
  }
  if (game.mySeat !== null && game.toMove.includes(game.mySeat)) return game.isPractice ? `${game.names[game.mySeat]} to move` : "Your move";
  if (game.toMove.length === 0) return "";
  return `Waiting for ${game.toMove.map(nameOf).join(", ")}`;
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
