import { afterEach, describe, expect, it, vi } from "vitest";
import { DisplayList } from "@vector-display/core";
import { CONNECT_FOUR_COLUMNS, readClientMessage, Room, type BattleshipState, type ConnectFourState, type Delivery } from "@vector-demos/table-games";
import { Practice } from "../src/apps/tableGames/Practice.js";
import { TableClient, type SocketLike } from "../src/apps/tableGames/TableClient.js";
import { NAME_KEY, TableGames, TOKEN_KEY, type TableGamesOptions } from "../src/apps/tableGames/TableGames.js";

// Stands in for the room server: sockets are joined to a Room in this process, as the
// Durable Object joins real ones, so the window is tested against the real rules.
class FakeServer {
  public readonly rooms = new Map<string, Room>();
  public readonly sockets: FakeSocket[] = [];

  public open = (url: string): SocketLike => {
    const socket = new FakeSocket(this, url);
    this.sockets.push(socket);
    return socket;
  };

  public roomFor(url: string): Room {
    const code = url.split("/").at(-1)!;
    if (!this.rooms.has(code)) this.rooms.set(code, Room.empty(code));
    return this.rooms.get(code)!;
  }

  public deliver(url: string, deliveries: Delivery[]): void {
    for (const { to, message } of deliveries) {
      for (const socket of this.sockets) {
        if (socket.url === url && socket.memberId === to && socket.readyState === 1) socket.onmessage?.({ data: JSON.stringify(message) });
      }
    }
  }
}

class FakeSocket implements SocketLike {
  public readyState = 0;
  public memberId: string | null = null;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public readonly sent: unknown[] = [];

  public constructor(
    private readonly server: FakeServer,
    public readonly url: string,
  ) {}

  public accept(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  public send(data: string): void {
    this.sent.push(JSON.parse(data));
    const message = readClientMessage(data);
    if (!message) throw new Error(`bad message ${data}`);
    const room = this.server.roomFor(this.url);
    if (this.memberId === null) {
      if (message.type !== "hello") throw new Error("hello first");
      const joined = room.join(message.token, message.name, 0);
      if (!joined.ok) throw new Error(joined.error);
      this.memberId = joined.memberId;
      this.server.deliver(this.url, joined.deliveries);
    } else {
      this.server.deliver(this.url, room.receive(this.memberId, message, 0, () => 0.3));
    }
  }

  public close(): void {
    this.readyState = 3;
    if (this.memberId) this.server.deliver(this.url, this.server.roomFor(this.url).leave(this.memberId, 0));
    this.onclose?.();
  }
}

function memoryStorage(): Map<string, string> & Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>() as Map<string, string> & Pick<Storage, "getItem" | "setItem">;
  map.getItem = (key) => map.get(key) ?? null;
  map.setItem = (key, value) => void map.set(key, value);
  return map;
}

// Each window draws different bytes, so each gets its own token.
let windowsMade = 0;

function window(server: FakeServer, overrides: Partial<TableGamesOptions> = {}): TableGames {
  let counter = 1000 * ++windowsMade;
  return new TableGames({
    server: "https://rooms.example",
    openSocket: server.open,
    storage: memoryStorage(),
    randomBytes: (count) => Uint8Array.from({ length: count }, () => (counter += 7) % 256),
    pageUrl: "https://site.example/os/",
    roomFromLink: null,
    copyText: async () => {},
    ...overrides,
  });
}

function type(tableGames: TableGames, text: string): void {
  for (const key of text) tableGames.key(key);
}

const WIDTH = 960;
const HEIGHT = 640;

function drawn(tableGames: TableGames): void {
  tableGames.draw(new DisplayList(), { width: WIDTH, height: HEIGHT, seconds: 0 });
}

// Clicks the first point, scanning the window in a grid, where `found` becomes true.
function clickWhere(tableGames: TableGames, found: () => boolean, region = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT }): void {
  for (let y = region.top; y < region.bottom; y += 4) {
    for (let x = region.left; x < region.right; x += 4) {
      drawn(tableGames);
      tableGames.pointer("hover", x, y);
      drawn(tableGames);
      tableGames.pointer("down", x, y);
      if (found()) return;
    }
  }
  throw new Error("nothing there to click");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Practice", () => {
  it("lets each Battleship side place in turn, hiding the other's ships, then fire in turn", () => {
    const practice = new Practice("battleship", () => 0.37);
    expect(practice.actingSeat).toBe(0);
    expect(practice.play({ kind: "autoPlace" })).toBeNull();
    expect(practice.play({ kind: "ready" })).toBeNull();
    expect(practice.actingSeat).toBe(1);
    // Side 2 placing cannot see side 1's ships.
    expect((practice.info.view as BattleshipState).fleets[0].ships.every((ship) => ship.at === null)).toBe(true);
    practice.play({ kind: "autoPlace" });
    practice.play({ kind: "ready" });
    expect(practice.info.turn).toBe(0);
    expect(practice.actingSeat).toBe(0);
  });
});

describe("TableClient", () => {
  it("says hello, keeps what the room sends, and reconnects as the same member after a drop", () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    const client = new TableClient("ABCDEF", "wss://x/rooms/ABCDEF", "token-for-alice-000001", "Alice", server.open);
    expect(client.status).toBe("connecting");
    server.sockets[0].accept();
    expect(client.status).toBe("connected");
    expect(client.you).toBe("m1");
    client.say("  hi there  ");
    expect(client.chat.map((entry) => entry.text)).toEqual(["hi there"]);

    server.sockets[0].close();
    expect(client.status).toBe("reconnecting");
    vi.advanceTimersByTime(1000);
    expect(server.sockets).toHaveLength(2);
    server.sockets[1].accept();
    expect(client.you).toBe("m1");
    // The history arrives again, in full, not doubled.
    expect(client.chat.map((entry) => entry.text)).toEqual(["hi there"]);
    client.close();
  });

  it("stops knocking when the room refuses it", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const client = new TableClient("ABCDEF", "wss://x/rooms/ABCDEF", "token-for-alice-000001", "Alice", (url) => {
      const socket = new FakeSocket(new FakeServer(), url);
      socket.send = () => {
        socket.onmessage?.({ data: JSON.stringify({ type: "error", message: "This room is full" }) });
        socket.close();
      };
      sockets.push(socket);
      return socket;
    });
    sockets[0].accept();
    expect(client.status).toBe("refused");
    expect(client.notice).toBe("This room is full");
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});

describe("Table Games window", () => {
  it("makes a new room from a name, remembering the name and a token", () => {
    const server = new FakeServer();
    const storage = memoryStorage();
    const tableGames = window(server, { storage });
    expect(tableGames.field).toBe("name");
    type(tableGames, "Alice");
    tableGames.key("Enter");
    expect(tableGames.field).toBe("code");
    tableGames.key("Enter");
    expect(tableGames.client?.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(server.sockets[0].url).toBe(`wss://rooms.example/rooms/${tableGames.client!.code}`);
    expect(storage.get(NAME_KEY)).toBe("Alice");
    expect(storage.get(TOKEN_KEY)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("joins straight away from a link when the name is known", () => {
    const server = new FakeServer();
    const storage = memoryStorage();
    storage.setItem(NAME_KEY, "Bob");
    const tableGames = window(server, { storage, roomFromLink: "k7qx2m" });
    expect(tableGames.client?.code).toBe("K7QX2M");
  });

  it("refuses a code of the wrong shape", () => {
    const tableGames = window(new FakeServer());
    type(tableGames, "Alice");
    tableGames.key("Tab");
    type(tableGames, "AB0");
    tableGames.joinOrCreate();
    expect(tableGames.client).toBeNull();
  });

  it("plays Connect 4 between two windows by clicks: invite, accept, drop", () => {
    const server = new FakeServer();
    const alice = window(server);
    type(alice, "Alice");
    alice.key("Enter");
    alice.key("Enter");
    server.sockets[0].accept();
    const code = alice.client!.code;

    const bob = window(server, { roomFromLink: code });
    type(bob, "Bob");
    bob.key("Enter");
    bob.key("Enter");
    server.sockets[1].accept();
    expect(alice.client!.members.map((member) => member.name)).toEqual(["Alice", "Bob"]);

    // Alice presses C4 beside Bob's name in the list; Bob presses YES.
    clickWhere(alice, () => alice.client!.invites.length > 0, { left: WIDTH - 340, top: 60, right: WIDTH, bottom: 110 });
    expect(alice.client!.invites).toEqual([{ from: "m1", to: "m2", game: "connect4" }]);
    clickWhere(bob, () => bob.client!.game !== null, { left: WIDTH - 340, top: 60, right: WIDTH, bottom: 140 });
    expect(bob.client!.game?.game).toBe("connect4");

    // Alice drops a disc by clicking on the board.
    clickWhere(alice, () => (alice.client!.game!.view as ConnectFourState).lastDrop !== null, { left: 0, top: 120, right: WIDTH - 360, bottom: HEIGHT });
    const view = bob.client!.game!.view as ConnectFourState;
    expect(view.board[5].filter((cell) => cell === 0)).toHaveLength(1);
    expect(view.lastDrop?.[1]).toBeLessThan(CONNECT_FOUR_COLUMNS);
    expect(bob.client!.game!.turn).toBe(1);
  });

  it("offers every game when none is on, and starts one from an open invitation anyone can take", () => {
    const server = new FakeServer();
    const alice = window(server);
    type(alice, "Alice");
    alice.key("Enter");
    alice.key("Enter");
    server.sockets[0].accept();
    // Alone in the room, Alice presses "Invite anyone" on the first card (Connect 4).
    clickWhere(alice, () => alice.client!.invites.length > 0, { left: 0, top: 100, right: WIDTH - 360, bottom: 250 });
    expect(alice.client!.invites).toEqual([{ from: "m1", to: null, game: "connect4" }]);

    // Bob arrives later by the link, sees it, and takes it.
    const bob = window(server, { roomFromLink: alice.client!.code });
    type(bob, "Bob");
    bob.key("Enter");
    bob.key("Enter");
    server.sockets[1].accept();
    clickWhere(bob, () => bob.client!.game !== null, { left: WIDTH - 340, top: 60, right: WIDTH, bottom: 160 });
    expect(alice.client!.game?.seats).toEqual(["m1", "m2"]);
  });

  it("practices any game from the lobby, with no server, both sides taking turns", () => {
    const server = new FakeServer();
    const tableGames = window(server);
    // The practice buttons are below the room buttons; the first is Connect 4.
    clickWhere(tableGames, () => tableGames.practice !== null, { left: 0, top: 380, right: WIDTH, bottom: HEIGHT });
    expect(tableGames.practice?.game).toBe("connect4");
    expect(server.sockets).toHaveLength(0);
    const practice = tableGames.practice!;
    clickWhere(tableGames, () => practice.actingSeat === 1, { left: 0, top: 140, right: WIDTH, bottom: HEIGHT });
    expect((practice.info.view as ConnectFourState).board[5].filter((cell) => cell === 0)).toHaveLength(1);
  });

  it("sets its text on the plain text layer, not among the glowing lines", () => {
    const tableGames = window(new FakeServer());
    const lines = new DisplayList();
    tableGames.draw(lines, { width: WIDTH, height: HEIGHT, seconds: 0 });
    const text = new DisplayList();
    tableGames.drawText(text);
    expect(text.segmentCount).toBeGreaterThan(200);
    // The lines left are the boxes and buttons alone.
    expect(lines.segmentCount).toBeLessThan(60);
  });

  it("sends chat typed in the room on Enter", () => {
    const server = new FakeServer();
    const alice = window(server);
    type(alice, "Alice");
    alice.key("Enter");
    alice.key("Enter");
    server.sockets[0].accept();
    type(alice, "hello");
    alice.key("Backspace");
    alice.key("Enter");
    expect(alice.client!.chat.map((entry) => entry.text)).toEqual(["hell"]);
    expect(alice.chatDraft).toBe("");
    drawn(alice);
  });
});
