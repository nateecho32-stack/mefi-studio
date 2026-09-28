import assert from "node:assert/strict";
import test from "node:test";
import hub from "../scripts/hub-client.cjs";

// The Discord remote in scripts/hub-client.cjs (docs/remote.md) against a
// fake hub: this PC is named to the hub only when the hub carries "remote"
// and the owner turned it on; commands arrive only while it is on; replies
// and alerts keep to the protocol's shapes; and a reconnect names the PC
// again. Nothing here opens a socket.

const T0 = 1_800_000_000_000;
const USER = { id: "123456789012345678", name: "Mefi" };
const PC = { id: "pc-1b2c3d4e-0000-4000-8000-000000000001", name: "DESKTOP-HOME" };
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((done) => setImmediate(done)); };

function harness() {
  let now = T0, seq = 0;
  const timers = new Map(), events = [], sockets = [];
  class FakeSocket {
    constructor(address) { this.url = address; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code = 1000) { this.readyState = 3; this.closedWith = code; }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
    drop(code) { this.readyState = 3; this.onclose?.({ code }); }
  }
  let sessions = 0;
  const fetch = async (href, init) => {
    const path = new URL(href).pathname;
    if (init.method === "POST" && path === "/v1/session") { sessions += 1; return { ok: true, status: 200, json: async () => ({ ok: true, session: `s${sessions}`, expiresAt: now + 15 * 60_000, user: USER }) }; }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const client = hub.createHubClient({
    url: "https://hub.example.test", fetch, WebSocket: FakeSocket, now: () => now,
    getAccessToken: async () => ({ ok: true, token: "discord-access" }),
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    onEvent: (event) => events.push(event),
  });
  const socket = () => sockets.at(-1);
  const sent = (type) => socket().sent.filter((frame) => frame.type === type);
  async function readyUp(features = ["remote"]) {
    await client.connect();
    socket().open();
    socket().receive({ type: "ready", user: USER, protocol: 1, features });
    await settle();
  }
  return { client, events, socket, sent, readyUp, sockets };
}

test("this PC is named to a hub that carries the remote, only once the owner turned it on", async () => {
  const off = harness();
  await off.readyUp(["companion"]);
  assert.equal(off.client.setRemote({ pc: PC, on: true }), true);
  assert.deepEqual(off.sent("remoteHello"), [], "a hub without the remote is never sent one");
  assert.equal(off.client.status().remote, false);

  const h = harness();
  await h.readyUp();
  assert.deepEqual(h.sent("remoteHello"), [], "nothing until the owner turns it on");
  assert.equal(h.client.setRemote({ pc: { id: "has space", name: "x" }, on: true }), false);
  assert.equal(h.client.setRemote({ pc: PC, on: "yes" }), false);
  assert.equal(h.client.setRemote({ pc: PC, on: true }), true);
  assert.deepEqual(h.sent("remoteHello"), [{ type: "remoteHello", pc: PC, on: true }]);
  h.client.setRemote({ pc: PC, on: true });
  assert.equal(h.sent("remoteHello").length, 1, "the same PC twice is one hello");
  assert.equal(h.client.status().remoteOn, true);

  h.socket().receive({ type: "remoteState", pcs: [{ id: PC.id, name: PC.name, since: T0 }, { id: "bad id", name: "x" }] });
  assert.deepEqual(h.client.status().remotePcs, [{ id: PC.id, name: PC.name, since: T0 }]);
  assert.deepEqual(h.events.find((event) => event.type === "remoteState").pcs, [{ id: PC.id, name: PC.name, since: T0 }]);

  h.client.setRemote(null);
  assert.deepEqual(h.sent("remoteHello").at(-1), { type: "remoteHello", pc: PC, on: false }, "turning it off tells the hub");
});

test("commands arrive only while the remote is on, in the protocol's shape", async () => {
  const h = harness();
  await h.readyUp();
  const command = { type: "remote", requestId: "req_1", from: USER.id, command: "say", text: "How is it going?", sentAt: T0 };
  h.socket().receive(command);
  assert.equal(h.events.filter((event) => event.type === "remote").length, 0, "off: nothing is handed on");
  h.client.setRemote({ pc: PC, on: true });
  h.socket().receive(command);
  h.socket().receive({ ...command, command: "format-disk" });
  h.socket().receive({ ...command, from: "not a snowflake" });
  h.socket().receive({ type: "remote", requestId: "req_2", from: USER.id, command: "button", buttonId: "ap-1", pin: "4321", sentAt: T0 });
  h.socket().receive({ type: "remote", requestId: "req_3", from: USER.id, command: "button", buttonId: "ap-1", pin: "12ab", sentAt: T0 });
  const got = h.events.filter((event) => event.type === "remote").map((event) => event.command);
  assert.deepEqual(got, [
    { requestId: "req_1", from: USER.id, command: "say", sentAt: T0, text: "How is it going?" },
    { requestId: "req_2", from: USER.id, command: "button", sentAt: T0, buttonId: "ap-1", pin: "4321" },
    { requestId: "req_3", from: USER.id, command: "button", sentAt: T0, buttonId: "ap-1" },
  ], "unknown commands and bad senders are dropped; a malformed PIN never passes");
});

test("replies and alerts keep to the protocol's shapes and go only while the remote is on", async () => {
  const h = harness();
  await h.readyUp();
  assert.equal(h.client.remoteReply("req_1", "hi"), false, "off: nothing goes");
  h.client.setRemote({ pc: PC, on: true });
  assert.equal(h.client.remoteReply("req_1", "  All good.\u0007 ", [{ id: "needs", label: "What needs me", style: "primary" }, { id: "ap-1", label: "Approve 1", style: "loud", pin: true }], false), true);
  assert.deepEqual(h.sent("remoteReply"), [{ type: "remoteReply", requestId: "req_1", text: "All good.", buttons: [{ id: "needs", label: "What needs me", style: "primary" }, { id: "ap-1", label: "Approve 1", pin: true }], done: false }]);
  assert.equal(h.client.remoteReply("req_1", "x".repeat(5000)), true);
  assert.equal(h.sent("remoteReply").at(-1).text.length, 1900, "long words are cut, not refused");
  assert.equal(h.client.remoteReply("bad id!", "hi"), false);
  assert.equal(h.client.remoteReply("req_1", "   "), false);
  assert.equal(h.client.remoteReply("req_1", "hi", [{ id: "bad id", label: "x" }]), false);
  assert.equal(h.client.remoteReply("req_1", "hi", Array.from({ length: 6 }, (_, index) => ({ id: `b${index}`, label: "b" }))), false, "at most five buttons");

  assert.equal(h.client.remoteNotice("needs:q1", "needs-you", "🙋 Needs you: Which font?"), true);
  assert.deepEqual(h.sent("remoteNotice"), [{ type: "remoteNotice", key: "needs:q1", kind: "needs-you", text: "🙋 Needs you: Which font?" }]);
  assert.equal(h.client.remoteNotice("needs:q1", "party", "x"), false);
  assert.equal(h.client.remoteNotice("has space", "info", "x"), false);
});

test("a reconnect names this PC again; a disconnect forgets it", async () => {
  const h = harness();
  await h.readyUp();
  h.client.setRemote({ pc: PC, on: true });
  h.socket().drop(1006);
  await settle();
  const before = h.sockets.length;
  // The client retries on its own clock; a fresh socket and ready follow.
  await h.client.connect();
  if (h.sockets.length === before) { await new Promise((done) => setTimeout(done, 0)); }
  h.socket().open();
  h.socket().receive({ type: "ready", user: USER, protocol: 1, features: ["remote"] });
  await settle();
  assert.deepEqual(h.sent("remoteHello"), [{ type: "remoteHello", pc: PC, on: true }]);
  await h.client.disconnect();
  assert.equal(h.client.status().remoteOn, false);
  assert.deepEqual(h.client.status().remotePcs, []);
});

test("the shapes on their own", () => {
  assert.equal(hub.remoteText("\u0000\u0001"), null);
  assert.deepEqual(hub.remoteButtons(undefined), []);
  assert.equal(hub.remoteButtons("x"), null);
  assert.equal(hub.remoteCommand({ requestId: "r", from: USER.id, command: "status" }).command, "status");
  assert.equal(hub.remotePcs("x"), null);
});
