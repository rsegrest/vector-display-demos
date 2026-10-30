import { DurableObject } from "cloudflare:workers";
import { isRoomCode, readClientMessage, Room, type Delivery, type RoomSnapshot, type ServerMessage } from "@vector-demos/table-games";

// The Table Games room server. Each room is one Durable Object, found by its code, which
// holds the room's WebSockets and its state. All the rules are in @vector-demos/table-games'
// Room; this file only carries messages between it and the sockets, and stores it.
//
// The sockets use the hibernation API: between messages the object may be evicted from
// memory with its sockets kept open, so an idle room costs nothing. Everything needed to
// carry on is therefore in storage (the room) or on the sockets themselves (who each is).

interface Env {
  readonly ROOMS: DurableObjectNamespace<RoomObject>;
  readonly ALLOWED_ORIGINS: string;
}

// What each socket remembers about itself across hibernation.
interface SocketTag {
  readonly code: string;
  // null until the socket's hello has been accepted.
  readonly memberId: string | null;
}

// A room nobody has used for this long is deleted, history and all.
const ROOM_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;
const SNAPSHOT_KEY = "room";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");

    // /rooms/<CODE>: a WebSocket into that room.
    const match = /^\/rooms\/([A-Z0-9]+)$/.exec(url.pathname);
    if (!match || !isRoomCode(match[1])) return new Response("Not found", { status: 404 });
    const origin = request.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").map((each) => each.trim());
    if (!allowed.includes(origin) && !allowed.includes("*")) return new Response("This page may not open rooms", { status: 403 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });

    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class RoomObject extends DurableObject<Env> {
  private room: Room | null = null;

  public override async fetch(request: Request): Promise<Response> {
    const code = new URL(request.url).pathname.split("/")[2];
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code, memberId: null } satisfies SocketTag);
    return new Response(null, { status: 101, webSocket: client });
  }

  public override async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const tag = socket.deserializeAttachment() as SocketTag;
    const room = await this.loadRoom(tag.code, null);
    const message = typeof data === "string" ? readClientMessage(data) : null;
    if (!message) {
      send(socket, { type: "error", message: "That message was not understood" });
      return;
    }

    let deliveries: Delivery[];
    if (tag.memberId === null) {
      if (message.type !== "hello") {
        send(socket, { type: "error", message: "Say hello first" });
        return;
      }
      const joined = room.join(message.token, message.name, Date.now());
      if (!joined.ok) {
        send(socket, { type: "error", message: joined.error });
        socket.close(4000, joined.error);
        return;
      }
      socket.serializeAttachment({ ...tag, memberId: joined.memberId } satisfies SocketTag);
      deliveries = joined.deliveries;
    } else {
      deliveries = room.receive(tag.memberId, message, Date.now(), Math.random);
    }
    await this.save(room);
    this.deliver(deliveries);
  }

  public override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.closed(socket);
  }

  public override async webSocketError(socket: WebSocket): Promise<void> {
    await this.closed(socket);
  }

  // Nobody has used the room for ROOM_LIFETIME_MS: forget it, unless someone is still connected.
  public override async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_LIFETIME_MS);
      return;
    }
    this.room = null;
    await this.ctx.storage.deleteAll();
  }

  private async closed(socket: WebSocket): Promise<void> {
    const tag = socket.deserializeAttachment() as SocketTag;
    if (tag.memberId === null) return;
    const room = await this.loadRoom(tag.code, socket);
    const deliveries = room.departed(tag.memberId, Date.now());
    await this.save(room);
    this.deliver(deliveries);
  }

  // The room, from memory or (after hibernation) from storage, its connection count taken from the
  // sockets that are open now, leaving out `closing`.
  private async loadRoom(code: string, closing: WebSocket | null): Promise<Room> {
    if (!this.room) {
      const snapshot = await this.ctx.storage.get<RoomSnapshot>(SNAPSHOT_KEY);
      this.room = snapshot ? new Room(snapshot) : Room.empty(code);
    }
    this.room.syncConnections(this.memberSockets(closing).map(({ memberId }) => memberId));
    return this.room;
  }

  private memberSockets(leaveOut: WebSocket | null = null): { socket: WebSocket; memberId: string }[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket !== leaveOut && socket.readyState === WebSocket.OPEN)
      .map((socket) => ({ socket, memberId: (socket.deserializeAttachment() as SocketTag).memberId }))
      .filter((each): each is { socket: WebSocket; memberId: string } => each.memberId !== null);
  }

  private async save(room: Room): Promise<void> {
    await this.ctx.storage.put(SNAPSHOT_KEY, room.snapshot);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_LIFETIME_MS);
  }

  private deliver(deliveries: readonly Delivery[]): void {
    const sockets = this.memberSockets();
    for (const { to, message } of deliveries) {
      for (const { socket, memberId } of sockets) {
        if (memberId === to) send(socket, message);
      }
    }
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The socket closed meanwhile; its close event tidies up.
  }
}
