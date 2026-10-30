import type { ChatEntry, ClientMessage, MemberInfo, ServerMessage, TableInfo } from "@vector-demos/table-games";
import { LIMITS } from "@vector-demos/table-games";

// The part of a WebSocket the client uses, so tests can stand in for one.
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "refused";

const OPEN = 1;
// Waits between tries to reconnect, in seconds, the last repeated.
const RECONNECT_DELAYS = [1, 2, 4, 8, 15];

// One window's connection to one room: it says hello, keeps the latest of everything the room
// has sent, and reconnects (as the same member, by its token) when the connection drops.
export class TableClient {
  public status: ConnectionStatus = "connecting";
  public you: string | null = null;
  public members: readonly MemberInfo[] = [];
  public chat: ChatEntry[] = [];
  public table: TableInfo | null = null;
  // What the room calls its computer players: "Jev", or "Computer" when the server has no key.
  public computerName = "Computer";
  // The last thing the room refused, shown until the next one or until cleared.
  public notice: string | null = null;
  // Counts every change, so the window knows to redraw what depends on the room.
  public version = 0;

  private socket: SocketLike | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isClosed = false;

  public constructor(
    public readonly code: string,
    private readonly url: string,
    private readonly token: string,
    private readonly name: string,
    private readonly openSocket: SocketFactory,
  ) {
    this.connect();
  }

  public memberName(memberId: string): string {
    return this.members.find((member) => member.id === memberId)?.name ?? "?";
  }

  public send(message: ClientMessage): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
    else this.notice = "Not connected";
  }

  public say(text: string): void {
    const trimmed = text.trim().slice(0, LIMITS.chatLength);
    if (trimmed) this.send({ type: "chat", text: trimmed });
  }

  public close(): void {
    this.isClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  private connect(): void {
    const socket = this.openSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectAttempt = 0;
      socket.send(JSON.stringify({ type: "hello", token: this.token, name: this.name } satisfies ClientMessage));
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") this.receive(JSON.parse(event.data) as ServerMessage);
    };
    socket.onclose = () => {
      if (this.socket !== socket || this.isClosed) return;
      this.socket = null;
      if (this.status === "refused") return;
      this.status = "reconnecting";
      this.version++;
      const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt++, RECONNECT_DELAYS.length - 1)];
      this.reconnectTimer = setTimeout(() => this.connect(), delay * 1000);
    };
  }

  private receive(message: ServerMessage): void {
    this.version++;
    switch (message.type) {
      case "welcome":
        this.status = "connected";
        this.you = message.you;
        this.computerName = message.computerName;
        // The room sends its history next, in full.
        this.chat = [];
        this.notice = null;
        return;
      case "members":
        this.members = message.members;
        return;
      case "chat":
        this.chat = [...this.chat, ...message.entries].slice(-LIMITS.chatHistory);
        return;
      case "table":
        this.table = message.table;
        return;
      case "error":
        this.notice = message.message;
        // Refused before joining (a full room): do not keep knocking.
        if (this.you === null) this.status = "refused";
        return;
    }
  }
}
