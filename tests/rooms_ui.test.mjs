import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/rooms.js (Friends › Rooms) in a vm with a tiny DOM and a fake hub
// bridge: it explains itself until the hub is configured, linked and
// connected; lists rooms with the one action each needs; asks to join,
// decides, answers invites and makes rooms through hub:room only; shows chat
// as text with @names; follows live frames; and puts invites and requests on
// the Friends badge. Then main.cjs's HUB_ROOM_METHODS gate.

const source = await readFile(new URL("../renderer/rooms.js", import.meta.url), "utf8");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const ME = { id: "123456789012345678", name: "Mefi" };
const FRIEND = { id: "223456789012345678", name: "Aksana" };

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.className = ""; this.text = ""; this.value = ""; this.checked = false; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  click() { for (const listener of this.listeners.click ?? []) listener({ type: "click" }); }
  key(key, extra = {}) { let stopped = false; for (const listener of this.listeners.keydown ?? []) listener({ type: "keydown", key, ...extra, preventDefault() { stopped = true; } }); return stopped; }
  all() { return [this, ...this.children.flatMap((child) => child.all?.() ?? [])]; }
  find(id) { return this.all().find((item) => item.id === id) ?? null; }
  buttons(label) { return this.all().filter((item) => item.tagName === "BUTTON" && item.textContent === label); }
  byClass(name) { return this.all().filter((item) => item.className.split(" ").includes(name)); }
}

const room = (overrides = {}) => ({ id: "room_mine", name: "Lo-fi corner", kind: "hangout", policy: "request", listed: true, status: "active", you: "owner", ownerId: ME.id, memberCount: 3, maxMembers: 25, ...overrides });
const message = (overrides = {}) => ({ id: "423456789012345678", author: { id: FRIEND.id, name: "Aksana", viaStudio: true }, text: "hey <@123456789012345678>", createdAt: Date.UTC(2026, 8, 27, 20), editedAt: null, mentions: [{ id: ME.id, name: "Mefi" }], attachments: [], ...overrides });

function environment({ status = { configured: true, linked: true, state: "ready", user: ME }, rooms = [], requests = [], invites = [], replies = {}, bridge = true, extra = {} } = {}) {
  const calls = [];
  let hubEvent = null;
  let hearing = 0;
  const api = bridge ? {
    hubStatus: async () => ({ ok: true, status }),
    hubConnect: async () => { calls.push(["connect"]); status = { ...status, state: "ready" }; return { ok: true, status }; },
    hubRooms: async () => ({ ok: true, rooms }),
    hubSubscribe: (id, on, holder) => { calls.push(["subscribe", id, on, holder]); },
    onHubEvent: (fn) => { hearing += 1; hubEvent = fn; },
    hubRoom: async (method, ...args) => {
      calls.push([method, ...args]);
      if (method === "requests") return { ok: true, requests };
      if (method === "invites") return { ok: true, invites };
      const reply = replies[method];
      return typeof reply === "function" ? reply(...args) : reply ?? { ok: true };
    },
    ...extra,
  } : undefined;
  const window = { mefiStudio: api, confirm: () => true };
  // Timers do nothing here: the Online list's 30-second refresh never fires in a test.
  const context = vm.createContext({ window, document: { createElement: (tag) => new Element(tag) }, Date, Number, Array, Set, Map, Promise, JSON, Object, String, setTimeout: () => 0, clearTimeout: () => {} });
  vm.runInContext(source, context);
  return { rooms: window.MefiRooms, window, calls, push: (event) => hubEvent(event), setStatus: (next) => { status = next; }, hearing: () => hearing, setLists: (next) => { requests = next.requests ?? requests; invites = next.invites ?? invites; } };
}

test("the panel explains itself until the hub is configured, linked and connected", async () => {
  const none = environment({ bridge: false }).rooms.panel();
  assert.equal(none.find("rooms-status").textContent, "Rooms work in the desktop app.");
  const unset = environment({ status: { configured: false } }).rooms.panel();
  await flush();
  assert.equal(unset.dataset.state, "not-configured");
  assert.match(unset.find("rooms-status").textContent, /no address for: add one in Settings › General › Community › Connection details/);
  const unlinked = environment({ status: { configured: true, linked: false } }).rooms.panel();
  await flush();
  assert.equal(unlinked.find("rooms-status").textContent, "Link your Discord account to use rooms. Discord asks once in your browser.");
  assert.equal(unlinked.find("rooms-link").textContent, "Sign in with Discord");
  // Linked but not connected: opening Rooms is the ask, so it connects by itself, once.
  const off = environment({ status: { configured: true, linked: true, state: "off" }, rooms: [room()] });
  const panel = off.rooms.panel();
  await flush();
  assert.deepEqual(off.calls[0], ["connect"]);
  assert.equal(panel.dataset.state, "ready");
  assert.equal(panel.byClass("rooms-row").length, 1);
  // A connection that failed waits for Connect instead of retrying on its own.
  const failed = environment({ status: { configured: true, linked: true, state: "offline", error: "network" }, rooms: [room()] });
  const again = failed.rooms.panel();
  await flush();
  assert.equal(failed.calls.length, 0);
  again.find("rooms-connect").click();
  await flush();
  assert.deepEqual(failed.calls[0], ["connect"]);
});

test("Link Discord links right there, then connects; not in the server offers Join and a re-check", async () => {
  let status = { configured: true, linked: false, state: "off" };
  const env = environment({ status, rooms: [room()] });
  let linkAnswer = { ok: false, error: "not-member" };
  env.window.MefiCommunity = {
    link: async () => { env.calls.push(["link"]); if (linkAnswer.ok) env.setStatus({ ...status, linked: true }); return linkAnswer; },
    join: async () => { env.calls.push(["join"]); return { ok: true }; },
    check: async () => { env.calls.push(["check"]); return { ok: true }; },
  };
  const panel = env.rooms.panel();
  await flush();
  panel.find("rooms-link").click();
  await flush();
  assert.equal(panel.dataset.state, "not-member");
  assert.match(panel.find("rooms-status").textContent, /isn't in the Void Engine server yet/);
  panel.find("rooms-join").click();
  await flush();
  env.setStatus({ ...status, linked: true });
  panel.find("rooms-recheck").click();
  await flush();
  assert.deepEqual(env.calls.map(([method]) => method).filter((method) => ["link", "join", "check", "connect"].includes(method)), ["link", "join", "check", "connect"]);
  assert.equal(panel.dataset.state, "ready");
});

test("each room offers the one action it needs, and invites and requests reach the badge", async () => {
  const env = environment({
    rooms: [room(), room({ id: "room_open", name: "Open jam", you: "none", ownerId: FRIEND.id }), room({ id: "room_inv", name: "Invite club", you: "invited", policy: "invite" }), room({ id: "room_req", name: "Asked", you: "requested", ownerId: FRIEND.id }), room({ id: "room_shut", status: "closed" })],
    requests: [{ id: "req_them", roomId: "room_mine", requester: FRIEND, note: "can I join?", status: "pending", createdAt: 1 }, { id: "req_me", roomId: "room_req", requester: ME, note: "", status: "pending", createdAt: 1 }],
    invites: [{ id: "inv_1", roomId: "room_inv", roomName: "Invite club", invitedBy: FRIEND, status: "pending", expiresAt: 9e12 }],
  });
  let notified = 0;
  env.rooms.subscribe(() => { notified += 1; });
  const panel = env.rooms.panel();
  await flush();
  const rows = panel.byClass("rooms-row").map((row) => [row.dataset.room, row.byClass("rooms-button").map((item) => item.textContent)]);
  assert.deepEqual(rows, [["room_mine", ["Open"]], ["room_open", ["Ask to join"]], ["room_inv", ["Join", "Decline"]], ["room_req", ["Cancel"]]], "a closed room is not listed");
  assert.equal(env.rooms.pending(), 2, "one invite to answer and one request to decide");
  assert.ok(notified >= 1);
  assert.equal(panel.find("rooms-tab-requests").textContent, "Requests (1)");
  assert.equal(panel.find("rooms-tab-invites").textContent, "Invites (1)");
});

test("asking to join, deciding, answering invites and making a room go through hub:room", async () => {
  const env = environment({
    rooms: [room({ id: "room_open", name: "Open jam", you: "none", ownerId: FRIEND.id })],
    requests: [{ id: "req_them", roomId: "room_open", requester: FRIEND, note: "hi", status: "pending", createdAt: 1 }],
    invites: [{ id: "inv_1", roomId: "room_x", roomName: "X", invitedBy: FRIEND, status: "pending", expiresAt: 9e12 }],
    replies: {
      requestJoin: { ok: true, request: {} },
      createRoom: (fields) => (fields.name === "Nope" ? { ok: false, error: "forbidden", reason: "listed-rank" } : { ok: true, room: { name: fields.name } }),
    },
  });
  const panel = env.rooms.panel();
  await flush();
  panel.buttons("Ask to join")[0].click();
  const note = panel.byClass("rooms-note")[0];
  note.value = "love this music";
  panel.buttons("Send request")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "requestJoin"), ["requestJoin", "room_open", "love this music"]);
  assert.equal(panel.find("rooms-status").textContent, "Asked to join Open jam. The owner will decide.");
  panel.find("rooms-tab-requests").click();
  assert.match(panel.byClass("rooms-quote")[0].textContent, /^hi$/);
  panel.buttons("Let them in")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "decide"), ["decide", "req_them", "approve"]);
  panel.find("rooms-tab-invites").click();
  panel.buttons("Join")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "acceptInvite"), ["acceptInvite", "inv_1"]);
  panel.find("rooms-tab-rooms").click();
  assert.equal(panel.find("rooms-create-name"), null, "the form waits behind New room");
  panel.find("rooms-new").click();
  assert.equal(panel.find("rooms-create-listed").checked, false, "a new room starts private: listing opens at Flame rank");
  panel.find("rooms-create-name").value = "  Night owls  ";
  panel.find("rooms-create-kind").value = "cowork";
  panel.find("rooms-create-policy").value = "invite";
  panel.find("rooms-create-listed").checked = false;
  panel.find("rooms-create").click();
  await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.find((call) => call[0] === "createRoom"))), ["createRoom", { name: "Night owls", kind: "cowork", policy: "invite", listed: false }]);
  assert.equal(panel.find("rooms-status").textContent, "Night owls is ready. Open it, then share its invite code.");
  assert.equal(panel.find("rooms-create-name"), null, "the form closes once the room is made");
  panel.find("rooms-new").click();
  panel.find("rooms-create-name").value = "Nope";
  panel.find("rooms-create").click();
  await flush();
  assert.equal(panel.find("rooms-status").textContent, "Showing a room in the list opens at Flame rank (200 credits, earned when friends play and star what you share). Leave \"Show it in the room list\" off to make a private room and invite people with its code.", "the relay's reason in plain words");
});

test("a room shows chat as text with @names, follows live frames, and sends or says why not", async () => {
  const env = environment({
    rooms: [room()],
    replies: {
      messages: { ok: true, messages: [message(), message({ id: "523456789012345678", author: { id: ME.id, name: "Mefi", viaStudio: true }, text: "<img src=x onerror=alert(1)>" })], hasMore: true },
      sendMessage: (_id, text) => (text === "fail" ? { ok: false, reason: "rate-limited" } : { ok: true, messageId: "623456789012345678" }),
    },
  });
  const panel = env.rooms.panel();
  await flush();
  panel.buttons("Open")[0].click();
  await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "subscribe"), ["subscribe", "room_mine", true, "rooms"], "Rooms holds the room as its own");
  assert.equal(panel.dataset.view, "room");
  const texts = () => panel.byClass("rooms-message-text").map((item) => item.textContent);
  assert.deepEqual(texts(), ["hey @Mefi", "<img src=x onerror=alert(1)>"], "mentions read as names; markup stays text");
  assert.equal(panel.buttons("Load earlier").length, 1);
  assert.deepEqual(panel.byClass("rooms-message").map((item) => item.byClass("rooms-button").map((b) => b.textContent)), [["⋯"], ["⋯"]], "a message's actions wait in its small menu");
  panel.byClass("rooms-message")[0].buttons("⋯")[0].click();
  panel.byClass("rooms-message")[1].buttons("⋯")[0].click();
  assert.deepEqual(panel.byClass("rooms-message").map((item) => item.byClass("rooms-button").map((b) => b.textContent)), [["⋯", "Report"], ["⋯", "Delete"]]);
  assert.equal(panel.find("rooms-status").textContent, "", "the room's name is in its header only, not the status line too");
  env.push({ type: "message", roomId: "room_mine", message: message({ id: "723456789012345678", text: "new one" }) });
  env.push({ type: "message", roomId: "room_other", message: message({ id: "823456789012345678", text: "elsewhere" }) });
  env.push({ type: "messageDelete", roomId: "room_mine", messageId: "423456789012345678" });
  assert.deepEqual(texts(), ["<img src=x onerror=alert(1)>", "new one"]);
  const box = panel.find("rooms-compose");
  box.value = "fail";
  panel.find("rooms-send").click();
  await flush();
  assert.equal(panel.find("rooms-status").textContent, "Not sent: Slow down a moment, then try again.");
  assert.equal(box.value, "fail", "a message that did not go stays in the box");
  box.value = "hello friends";
  panel.find("rooms-send").click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "sendMessage").at(-1), ["sendMessage", "room_mine", "hello friends"]);
  assert.equal(box.value, "");
  panel.find("rooms-back").click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "subscribe").at(-1), ["subscribe", "room_mine", false, "rooms"]);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/, "rooms.js never builds markup from strings");
});

test("one header, a chat that reads as names, faces of who is here, and one composer where Enter sends", async () => {
  const env = environment({
    rooms: [room()],
    replies: {
      messages: { ok: true, messages: [message(), message({ id: "523456789012345678", text: "ask <@999999999999999999> and <@223456789012345678>", mentions: [] })], hasMore: false },
      sendMessage: { ok: true, messageId: "623456789012345678" },
    },
  });
  const panel = env.rooms.panel();
  await flush();
  panel.buttons("Open")[0].click();
  await flush();
  assert.equal(panel.byClass("rooms-room-name").length, 1, "the room's name once");
  assert.deepEqual(panel.byClass("rooms-message-text").map((item) => item.textContent), ["hey @Mefi", "ask @someone and @Aksana"], "a mention nobody named reads @someone; a known author by name");
  assert.equal(panel.find("rooms-earlier").hidden, true, "no earlier page: no link");
  assert.match(panel.byClass("rooms-here")[0].textContent, /Just you here/);
  env.push({ type: "presence", roomId: "room_mine", inStudio: [ME.id, FRIEND.id] });
  const here = panel.byClass("rooms-here")[0];
  assert.deepEqual(here.byClass("rooms-here-chip").map((chip) => [chip.textContent, chip.title]), [["A", "Aksana"]]);
  assert.match(here.textContent, /1 here/);
  assert.equal(panel.find("rooms-room-panel"), null, "the room's options wait behind ⋯");
  const box = panel.find("rooms-compose");
  box.value = "line one";
  assert.equal(box.key("Enter", { shiftKey: true }), false, "Shift+Enter is a new line");
  assert.equal(env.calls.some((call) => call[0] === "sendMessage"), false);
  assert.equal(box.key("Enter"), true, "Enter sends");
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "sendMessage").at(-1), ["sendMessage", "room_mine", "line one"]);
  assert.equal(box.value, "");
  assert.equal(panel.find("rooms-send").parentElement.className, "rooms-composer", "Send sits inside the composer");
});

test("a room opened while another one's messages load shows its own, and a late page is dropped", async () => {
  const gates = new Map();
  const env = environment({
    rooms: [room({ id: "room_a", name: "A" }), room({ id: "room_b", name: "B", you: "member" })],
    replies: { messages: (roomId) => new Promise((resolve) => gates.set(roomId, resolve)) },
  });
  const panel = env.rooms.panel();
  await flush();
  const openRow = (id) => panel.all().find((item) => item.dataset?.room === id).buttons("Open")[0].click();
  const texts = () => panel.byClass("rooms-message-text").map((item) => item.textContent);
  openRow("room_a");
  await flush();
  panel.find("rooms-back").click();
  await flush();
  openRow("room_b");
  await flush();
  gates.get("room_b")({ ok: true, messages: [message({ id: "923456789012345678", text: "in B" })], hasMore: true });
  await flush();
  assert.deepEqual(texts(), ["in B"]);
  gates.get("room_a")({ ok: true, messages: [message({ text: "in A" })], hasMore: false });
  await flush();
  assert.deepEqual(texts(), ["in B"], "A's page arrived after B opened and is dropped");
  assert.equal(panel.find("rooms-status").textContent, "");
  panel.buttons("Load earlier")[0].click();
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "messages").at(-1), ["messages", "room_b", "923456789012345678"], "Load earlier pages the room on screen");
  assert.deepEqual(env.calls.filter((call) => call[0] === "subscribe"), [["subscribe", "room_a", true, "rooms"], ["subscribe", "room_a", false, "rooms"], ["subscribe", "room_b", true, "rooms"]]);
});

test("closing Friends lets go of the open room, and the next panel takes over the one hub listener", async () => {
  const env = environment({ rooms: [room()], replies: { messages: { ok: true, messages: [message()], hasMore: false } } });
  const first = env.rooms.panel();
  await flush();
  first.buttons("Open")[0].click();
  await flush();
  first.dispose();
  first.dispose();
  assert.deepEqual(env.calls.filter((call) => call[0] === "subscribe"), [["subscribe", "room_mine", true, "rooms"], ["subscribe", "room_mine", false, "rooms"]], "released once, however often it closes");
  env.push({ type: "message", roomId: "room_mine", message: message({ id: "723456789012345678", text: "after close" }) });
  assert.equal(first.byClass("rooms-message-text").some((item) => item.textContent === "after close"), false, "a closed panel hears nothing");
  const second = env.rooms.panel();
  const third = env.rooms.panel();
  await flush();
  assert.equal(env.hearing(), 1, "one listener however many times Friends opens");
  env.push({ type: "joinRequest", request: {} });
  await flush();
  assert.equal(third.dataset.view, "rooms");
  assert.equal(second.dataset.view, "rooms");
});

test("hub frames keep what the owner is typing, and the owner's controls", async () => {
  const env = environment({ rooms: [room()], replies: { messages: { ok: true, messages: [message()], hasMore: false } } });
  const panel = env.rooms.panel();
  await flush();
  panel.find("rooms-new").click();
  panel.find("rooms-create-name").value = "Half a na";
  env.push({ type: "invite", invite: {} });
  await flush();
  assert.equal(panel.find("rooms-create-name").value, "Half a na", "a list refresh keeps the room name being typed");
  panel.buttons("Open")[0].click();
  await flush();
  panel.find("rooms-room-menu").click();
  const box = panel.find("rooms-compose");
  box.value = "a draft";
  panel.byClass("rooms-message")[0].buttons("⋯")[0].click();
  panel.buttons("Report")[0].click();
  panel.byClass("rooms-note").find((item) => item.dataset.draft?.startsWith("report:")).value = "spam";
  env.push({ type: "room", room: room({ memberCount: 4, you: "none" }) });
  assert.equal(panel.find("rooms-compose"), box, "a member count change repaints nothing");
  env.push({ type: "room", room: room({ status: "locked", you: "none" }) });
  assert.notEqual(panel.find("rooms-compose"), box);
  assert.equal(panel.find("rooms-compose").value, "a draft", "a repaint gives the draft back");
  assert.equal(panel.buttons("Unlock").length, 1, "a room frame without `you` keeps the owner's controls");
  env.push({ type: "message", roomId: "room_mine", message: message({ id: "723456789012345678", text: "new one" }) });
  assert.equal(panel.byClass("rooms-note").find((item) => item.dataset.draft?.startsWith("report:")).value, "spam", "a new message keeps a report reason being typed");
  env.push({ type: "membership", roomId: "room_mine", userId: ME.id, state: "removed" });
  await flush();
  assert.equal(panel.dataset.view, "rooms");
  assert.equal(panel.find("rooms-status").textContent, "You were removed from that room. You can ask again after 30 days.");
});

test("with Friends closed, invites and requests still reach the badge", async () => {
  const env = environment({ rooms: [room()] });
  let notified = 0;
  env.rooms.subscribe(() => { notified += 1; });
  assert.equal(env.rooms.pending(), 0);
  env.setLists({ invites: [{ id: "inv_1", roomId: "room_x", roomName: "X", invitedBy: FRIEND, status: "pending", expiresAt: 9e12 }], requests: [{ id: "req_1", roomId: "room_mine", requester: FRIEND, note: "", status: "pending", createdAt: 1 }] });
  env.push({ type: "invite", invite: {} });
  await flush();
  assert.equal(env.rooms.pending(), 2);
  assert.ok(notified >= 1);
  const panel = env.rooms.panel();
  await flush();
  panel.dispose();
  env.setLists({ invites: [], requests: [] });
  env.push({ type: "joinRequest", request: {} });
  await flush();
  assert.equal(env.rooms.pending(), 0, "after Friends closes the badge keeps following");
});

test("the hub's own codes read as sentences, and closing, leaving and deleting ask twice", async () => {
  for (const [code, words] of [["auth", /^Not connected\. Your Discord sign-in has run out/], ["version", /^Not connected\. The room service needs a newer Studio/], ["socket-closed", /^Not connected to the room service\. Try Connect again\.$/]]) {
    const panel = environment({ status: { configured: true, linked: true, state: "error", error: code } }).rooms.panel();
    await flush();
    assert.match(panel.find("rooms-status").textContent, words, code);
  }
  const env = environment({ rooms: [room({ you: "member", ownerId: FRIEND.id })], replies: { messages: { ok: true, messages: [message({ author: { id: ME.id, name: "Mefi", viaStudio: true } })], hasMore: false } } });
  // The shared two-step control (studio-ui.js): the first press only asks.
  env.window.MefiUi = { arm: (button, { run, armed }) => { let asked = false; button.addEventListener("click", (event) => { if (!asked) { asked = true; button.textContent = armed; return; } run(event); }); return button; } };
  const panel = env.rooms.panel();
  await flush();
  panel.buttons("Open")[0].click();
  await flush();
  panel.byClass("rooms-message")[0].buttons("⋯")[0].click();
  panel.buttons("Delete")[0].click();
  await flush();
  assert.equal(env.calls.some((call) => call[0] === "deleteMessage"), false, "the first press asks");
  panel.buttons("Delete it?")[0].click();
  await flush();
  assert.ok(env.calls.some((call) => call[0] === "deleteMessage"));
  panel.find("rooms-room-menu").click();
  panel.buttons("Leave room")[0].click();
  await flush();
  assert.equal(env.calls.some((call) => call[0] === "leave"), false);
  panel.buttons("Leave it?")[0].click();
  await flush();
  assert.ok(env.calls.some((call) => call[0] === "leave"));
});

test("main passes only the listed room methods, with no more arguments than each takes", async () => {
  const from = main.indexOf("const HUB_ROOM_METHODS");
  const to = main.indexOf("// ---- end of the rooms hub", from);
  assert.ok(from > 0 && to > from);
  const seen = [];
  const client = new Proxy({}, { get: (_target, method) => (...args) => { seen.push([method, ...args]); return { ok: true }; } });
  const context = vm.createContext({ Object, Array, Promise, hubCall: async (work) => work(client) });
  vm.runInContext(`${main.slice(from, to)}\nthis.hubRoom = hubRoom;`, context);
  assert.deepEqual({ ...(await context.hubRoom("constructor", [])) }, { ok: false, error: "bad-request" });
  assert.deepEqual({ ...(await context.hubRoom("toString", [])) }, { ok: false, error: "bad-request" });
  assert.deepEqual({ ...(await context.hubRoom("requests", ["extra"])) }, { ok: false, error: "bad-request" });
  await context.hubRoom("createRoom", [{ name: "x", kind: "hangout" }]);
  await context.hubRoom("sendMessage", ["room_a", () => "not data"]);
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), [["createRoom", { name: "x", kind: "hangout" }], ["sendMessage", "room_a", null]]);
  assert.match(main, /ipcMain\.handle\("hub:room", async \(_event, payload\) => hubRoom\(String\(payload\?\.method \?\? ""\), Array\.isArray\(payload\?\.args\) \? payload\.args : \[\]\)\);/);
});

test("every room says moderators can read it; a cowork room offers to carry the open project's file claims", async () => {
  const links = [];
  let view = { ok: true, repo: "owner/app", roomId: null, leases: [] };
  const env = environment({
    rooms: [room({ id: "room_work", name: "Build crew", kind: "cowork" }), room()],
    replies: { messages: { ok: true, messages: [], hasMore: false } },
    extra: {
      coworkStatus: async () => view,
      coworkLink: async (roomId) => { links.push(roomId); view = { ...view, roomId, leases: roomId ? [{ title: "Refactor", paths: ["src/app.js", "src/b.js", "src/c.js", "src/d.js"], exclusive: true, here: false }, { title: "Fix login", paths: ["lib/u.js"], exclusive: true, here: true }] : [] }; return view; },
    },
  });
  const panel = env.rooms.panel();
  await flush();
  panel.all().find((item) => item.dataset?.room === "room_work")?.children.flatMap((child) => child.all?.() ?? [child]).find((item) => item.tagName === "BUTTON")?.click();
  await flush();
  assert.equal(panel.find("rooms-privacy").textContent, "Void Engine moderators can read every room.");
  assert.equal(panel.find("rooms-cowork"), null, "agents working together waits in the room's menu");
  panel.find("rooms-room-menu").click();
  await flush();
  const box = panel.find("rooms-cowork");
  assert.ok(box, "a cowork room shows its part in the open project");
  assert.match(box.textContent, /Let owner\/app's agents claim the files they edit here/);
  panel.find("rooms-cowork-link").click();
  await flush();
  assert.deepEqual(links, ["room_work"]);
  assert.match(box.textContent, /owner\/app's agents claim the files they edit here/);
  assert.deepEqual(panel.find("rooms-claims").children.map((row) => row.textContent), ["Another PC · Refactor · src/app.js, src/b.js, src/c.js +1 more", "This PC · Fix login · lib/u.js"]);
  env.push({ type: "claims", roomId: "room_work", leases: [] });
  await flush();
  panel.find("rooms-cowork-link").click();
  await flush();
  assert.deepEqual(links, ["room_work", null], "and can stop");
});

test("connecting made simple: the Lobby opens by itself, a code joins, a room shows its invite, Online invites in one press", async () => {
  const lobby = room({ id: "lobby", name: "Lobby", you: "member", ownerId: null, memberCount: 3, maxMembers: 1000 });
  const mine = room({ id: "room_mine", name: "Lo-fi corner", you: "owner" });
  const env = environment({
    status: { configured: true, linked: true, state: "ready", user: ME, lobby: true, joinCodes: true, online: true },
    rooms: [lobby, mine],
    replies: {
      messages: { ok: true, messages: [], hasMore: false },
      joinCode: (code) => (code.includes("BAD") ? { ok: false, error: "not-found", reason: "code" } : { ok: true, room: room({ id: "room_joined", name: "Friday jam", you: "member" }) }),
      roomCode: { ok: true, code: "7K3Q-M2XR", link: "https://mefi-relay.mefi-studio.workers.dev/join/7K3QM2XR" },
      online: { ok: true, people: [{ id: FRIEND.id, name: "Aksana", rank: "ember", specialRanks: [] }], visible: true },
      invite: { ok: true, invite: { id: "inv_1" } },
    },
  });
  const panel = env.rooms.panel();
  await flush();
  assert.equal(panel.dataset.view, "room", "Friends opens straight into the Lobby");
  assert.match(panel.find("rooms-privacy").textContent, /Everyone signed in from the Void Engine server is here/);
  assert.equal(panel.find("rooms-room-menu"), null, "the Lobby has no options to hide");
  assert.equal(panel.buttons("Leave room").length, 0, "nobody leaves the Lobby");
  assert.equal(panel.find("rooms-invite"), null, "the Lobby needs no invite");

  panel.find("rooms-back").click();
  await flush();
  panel.find("rooms-join-code").value = "BAD-CODE";
  panel.find("rooms-join").click();
  await flush();
  assert.equal(panel.find("rooms-status").textContent, "That code didn't match a room. Check it and try again.");
  panel.find("rooms-join-code").value = "7k3q m2xr";
  panel.find("rooms-join").click();
  await flush();
  assert.deepEqual(env.calls.find(([method, code]) => method === "joinCode" && code !== "BAD-CODE"), ["joinCode", "7k3q m2xr"]);
  assert.equal(panel.dataset.view, "room", "a joined room opens");

  panel.find("rooms-back").click();
  await flush();
  panel.all().find((item) => item.dataset?.room === "room_mine")?.children.flatMap((child) => child.all?.() ?? [child]).find((item) => item.tagName === "BUTTON")?.click();
  await flush();
  panel.find("rooms-room-menu").click();
  assert.equal(panel.byClass("rooms-code")[0].textContent, "7K3Q-M2XR");
  panel.find("rooms-copy-invite").click();
  await flush();
  assert.equal(panel.find("rooms-status").textContent, "Your code is 7K3Q-M2XR.", "without a clipboard the code is shown");

  panel.find("rooms-back").click();
  await flush();
  panel.find("rooms-tab-online").click();
  await flush();
  assert.equal(panel.find("rooms-tab-online").textContent, "Online (1)");
  assert.equal(panel.find("rooms-online-visible").checked, true);
  panel.buttons("Invite to Lo-fi corner")[0].click();
  await flush();
  assert.deepEqual(env.calls.find(([method]) => method === "invite"), ["invite", "room_mine", FRIEND.id]);
  assert.match(panel.find("rooms-status").textContent, /^Invited Aksana to Lo-fi corner/);
});
