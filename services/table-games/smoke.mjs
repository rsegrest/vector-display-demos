// A smoke test of the room server as it runs: start `npm run dev` here first, then `npm run smoke`.
// Two members join a room, chat, start Connect 4 (one opens the table, the other sits down) and
// play it to a win, and one reconnects in the middle and keeps their seat; then one plays a
// computer player, which answers each move. Also checks that other pages are refused.
// Pass a server address to test another one: npm run smoke -- https://vector-table-games.example.workers.dev
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const server = process.argv[2] ?? "http://localhost:8787";
const ORIGIN = "http://localhost:5180";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = Array.from(randomBytes(6), (byte) => ALPHABET[byte % 32]).join("");
const socketUrl = `${server.replace(/^http/, "ws")}/rooms/${code}`;

// A connection that queues what arrives, so a test can wait for the next message of a type.
function connect(token, name) {
  const socket = new WebSocket(socketUrl, { headers: { Origin: ORIGIN } });
  const inbox = [];
  const waiting = [];
  socket.addEventListener("message", (event) => {
    inbox.push(JSON.parse(event.data));
    for (const wake of waiting.splice(0)) wake();
  });
  const client = {
    socket,
    send: (message) => socket.send(JSON.stringify(message)),
    // The next message of this type that passes `test`; those before it are dropped.
    async next(type, test = () => true, seconds = 5) {
      const deadline = Date.now() + seconds * 1000;
      for (;;) {
        const index = inbox.findIndex((message) => message.type === type && test(message));
        if (index >= 0) return inbox.splice(0, index + 1).at(-1);
        if (Date.now() > deadline) throw new Error(`${name}: no ${type} message (had ${inbox.map((m) => m.type).join(", ")})`);
        await new Promise((resolve) => {
          waiting.push(resolve);
          setTimeout(resolve, 100);
        });
      }
    },
  };
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      client.send({ type: "hello", token, name });
      resolve(client);
    });
    socket.addEventListener("error", () => reject(new Error(`${name} could not connect to ${socketUrl}`)));
  });
}

const refused = await fetch(`${server}/rooms/${code}`, { headers: { Origin: "https://elsewhere.example" } });
// npm run dev allows every page, so the request reaches the WebSocket check (426) instead.
if (refused.status === 426) console.log("note: this server allows every page (ALLOWED_ORIGINS is *)");
else assert.equal(refused.status, 403, "a page not on the list is refused");

const aliceToken = `smoke-alice-${randomBytes(8).toString("hex")}`;
const alice = await connect(aliceToken, "Alice");
const aliceId = (await alice.next("welcome")).you;
const bob = await connect(`smoke-bob-${randomBytes(8).toString("hex")}`, "Bob");
const bobId = (await bob.next("welcome")).you;
await alice.next("members", (message) => message.members.length === 2);

alice.send({ type: "chat", text: "Hello, Bob" });
await bob.next("chat", (message) => message.entries.at(-1)?.text === "Hello, Bob");

alice.send({ type: "open", game: "connect4", invite: bobId });
await bob.next("table", (message) => message.table?.invited === bobId);
bob.send({ type: "sit" });
let game = (await alice.next("table", (message) => message.table?.isStarted)).table;
assert.deepEqual(game.seats, [aliceId, bobId]);

// A table whose board has this many discs.
const discsAre = (count) => (message) => message.table?.view?.board.flat().filter((cell) => cell !== null).length === count;

// Alice fills column 0 from the bottom while Bob plays column 1; Alice reconnects after her second disc.
let aliceNow = alice;
for (let turn = 0; turn < 3; turn++) {
  aliceNow.send({ type: "move", move: { column: 0 } });
  await bob.next("table", discsAre(2 * turn + 1));
  bob.send({ type: "move", move: { column: 1 } });
  await aliceNow.next("table", discsAre(2 * turn + 2));
  if (turn === 1) {
    aliceNow.socket.close();
    await bob.next("members", (message) => message.members.find((member) => member.id === aliceId)?.isOnline === false);
    aliceNow = await connect(aliceToken, "Alice");
    assert.equal((await aliceNow.next("welcome")).you, aliceId, "the same token comes back as the same member");
    game = (await aliceNow.next("table")).table;
    assert.deepEqual(game.toMove, [0], "and keeps their seat");
  }
}
aliceNow.send({ type: "move", move: { column: 0 } });
game = (await bob.next("table", discsAre(7))).table;
assert.deepEqual(game.outcome.winners, [0]);

// Against the computer: Alice clears the table, opens another and adds a computer player.
aliceNow.send({ type: "close" });
await aliceNow.next("table", (message) => message.table === null);
aliceNow.send({ type: "open", game: "connect4", invite: null });
await aliceNow.next("table", (message) => message.table?.host === aliceId && !message.table.isStarted);
aliceNow.send({ type: "addComputer" });
game = (await aliceNow.next("table", (message) => message.table?.isStarted)).table;
console.log(`computer player: ${game.names[1]}`);
for (let disc = 1; disc <= 3; disc += 2) {
  aliceNow.send({ type: "move", move: { column: 3 } });
  // The computer's reply arrives by itself, Jev taking a few seconds at most.
  await aliceNow.next("table", discsAre(disc + 1), 20);
}

aliceNow.socket.close();
bob.socket.close();
console.log(`smoke ok: room ${code} at ${server}`);
