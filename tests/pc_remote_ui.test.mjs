import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Friends › Your PCs › Reach this PC from Discord (renderer/pc-sync.js
// remoteSection, main.cjs "Discord remote") in a vm with a tiny DOM and a fake
// bridge: nothing is read until the section opens; the status line says the
// one thing standing in the way; the switch, name, alerts, digest and quiet
// hours each save through remote:set; the PIN goes through remote:pin only,
// is checked before it leaves and is cleared from the field; Remove asks
// twice where MefiUi is there; and pushes repaint an open section.

const source = await readFile(new URL("../renderer/pc-sync.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };

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
  fire(type) { for (const listener of this.listeners[type] ?? []) listener({ type }); }
  click() { this.fire("click"); }
  all() { return [this, ...this.children.flatMap((child) => child.all?.() ?? [])]; }
  find(id) { return this.all().find((item) => item.id === id) ?? null; }
}

const view = (settings = {}, hub = {}, extra = {}) => ({
  ok: true, linked: true,
  settings: { on: false, name: "DESKTOP-HOME", notify: { needsYou: true, failed: true, stuck: true, done: false, digestHour: null }, quiet: null, pinSet: false, locked: false, ...settings },
  hub: { configured: true, state: "ready", error: null, remote: true, on: false, pcs: [], ...hub }, log: [], ...extra,
});

function environment(initial, { ui = null } = {}) {
  const calls = [];
  let current = initial, pushed = null;
  const api = {
    syncStatus: async () => ({ ok: true, headline: "", lines: [], pending: [], risk: 0, state: {} }), syncRun: async () => ({ ok: true }),
    remoteStatus: async () => { calls.push(["remoteStatus"]); return current; },
    remoteSet: async (patch) => { calls.push(["remoteSet", JSON.parse(JSON.stringify(patch))]); current = view({ ...current.settings, ...patch, notify: { ...current.settings.notify, ...(patch.notify ?? {}) }, quiet: "quiet" in patch ? patch.quiet : current.settings.quiet }, patch.on ? { on: true, pcs: [{ id: "pc-1", name: current.settings.name, since: 0 }] } : {}); return current; },
    remotePin: async (payload) => { calls.push(["remotePin", { ...payload }]); current = view({ ...current.settings, pinSet: !payload.clear, locked: false }, current.hub, { message: payload.clear ? "PIN removed: approvals from Discord are off." : "PIN saved. Approve buttons in Discord ask for it." }); return current; },
    onRemoteEvent: (fn) => { pushed = fn; },
  };
  const window = { mefiStudio: api, addEventListener: () => {}, ...(ui ? { MefiUi: ui } : {}) };
  const context = vm.createContext({ window, document: { createElement: (tag) => new Element(tag), getElementById: () => null }, Date, Number, Array, Set, Promise, Object, String, JSON });
  vm.runInContext(source, context);
  const card = window.MefiPcSync.card();
  const box = card.find("pc-remote");
  const open = async () => { box.open = true; box.fire("toggle"); await flush(); };
  return { card, box, calls, open, push: (value) => pushed?.(value), status: () => box.find("pc-remote-status").textContent };
}

test("nothing is read until the section opens, and the status names what stands in the way", async () => {
  const env = environment(view());
  assert.deepEqual(env.calls, [], "closed: no read");
  await env.open();
  assert.deepEqual(env.calls, [["remoteStatus"]]);
  assert.match(env.status(), /^Off\. Turn it on/);
  assert.equal(env.box.find("pc-remote-on").checked, false);
  assert.equal(env.box.find("pc-remote-on").getAttribute("role"), "switch");
  for (const [answer, words] of [
    [view({ on: true }, {}, { linked: false }), /Link Discord first/],
    [view({ on: true }, { configured: false }), /rooms hub's address first/],
    [view({ on: true }, { remote: false }), /does not carry the Discord remote yet/],
    [view({ on: true }, { state: "error", error: "not-member" }), /refused this PC \(not-member\)/],
    [view({ on: true }, { state: "connecting" }), /Connecting/],
    [view({ on: true }, { on: true }), /^On\. DM the Void Engine bot.*answers as DESKTOP-HOME/],
  ]) {
    env.push(answer);
    assert.match(env.status(), words);
  }
});

test("the switch, name, alerts, digest and quiet hours each save through remote:set", async () => {
  const env = environment(view());
  await env.open();
  const on = env.box.find("pc-remote-on");
  on.checked = true;
  on.fire("change");
  await flush();
  assert.deepEqual(env.calls.at(-1), ["remoteSet", { on: true }]);
  assert.equal(env.box.find("pc-remote-pcs").textContent.includes("DESKTOP-HOME"), true, "this PC shows once the hub lists it");
  const name = env.box.find("pc-remote-name");
  name.value = "  Desk  ";
  name.parentElement.children.find((child) => child.tagName === "BUTTON").click();
  await flush();
  assert.deepEqual(env.calls.at(-1), ["remoteSet", { name: "Desk" }]);
  const done = env.box.find("pc-remote-done");
  done.checked = true;
  done.fire("change");
  await flush();
  assert.deepEqual(env.calls.at(-1), ["remoteSet", { notify: { done: true } }]);
  const digest = env.box.find("pc-remote-digest");
  digest.value = "20";
  digest.fire("change");
  await flush();
  assert.deepEqual(env.calls.at(-1), ["remoteSet", { notify: { digestHour: 20 } }]);
  const quiet = env.box.find("pc-remote-quiet");
  quiet.checked = true;
  quiet.fire("change");
  await flush();
  assert.deepEqual(env.calls.at(-1), ["remoteSet", { quiet: { from: "23:00", to: "07:00" } }]);
  assert.equal(env.calls.filter(([name]) => name === "remotePin").length, 0, "no PIN rides a settings save");
});

test("the PIN is checked before it leaves, goes through remote:pin only, and leaves the field empty", async () => {
  const env = environment(view({ on: true }, { on: true }));
  await env.open();
  const field = env.box.find("pc-remote-pin");
  assert.equal(field.type, "password");
  field.value = "12ab";
  env.box.find("pc-remote-pin-save").click();
  await flush();
  assert.match(env.status(), /4 to 12 digits/);
  assert.equal(env.calls.filter(([name]) => name === "remotePin").length, 0);
  field.value = "246810";
  env.box.find("pc-remote-pin-save").click();
  await flush();
  assert.deepEqual(env.calls.at(-1), ["remotePin", { pin: "246810" }]);
  assert.equal(field.value, "", "the PIN does not stay on screen");
  assert.match(env.status(), /PIN saved/);
  assert.equal(env.box.find("pc-remote-pin-save").textContent, "Change PIN");
  assert.equal(env.box.find("pc-remote-pin-clear").hidden, false);
});

test("Remove asks twice where MefiUi arms it, and a lock offers Unlock", async () => {
  const armed = [];
  const env = environment(view({ on: true, pinSet: true }, { on: true }), { ui: { arm: (button, options) => { armed.push(options.armed); button.addEventListener("click", options.run); } } });
  await env.open();
  assert.deepEqual(armed, ["Remove the PIN?"]);
  env.box.find("pc-remote-pin-clear").click();
  await flush();
  assert.deepEqual(env.calls.at(-1), ["remotePin", { clear: true }]);
  env.push(view({ on: true, pinSet: true, locked: true }, { on: true }));
  assert.equal(env.box.find("pc-remote-unlock").hidden, false);
  assert.match(env.box.find("pc-remote-pin-status").textContent, /Locked after five wrong PINs/);
  env.box.find("pc-remote-unlock").click();
  await flush();
  assert.deepEqual(env.calls.at(-1), ["remotePin", { unlock: true }]);
});

test("the log names what was asked, never its words", async () => {
  const env = environment(view({ on: true }, { on: true }, { log: [{ at: Date.UTC(2026, 8, 28, 18, 5), command: "say" }, { at: Date.UTC(2026, 8, 28, 18, 6), command: "button", note: "wrong PIN" }] }));
  await env.open();
  const rows = env.box.find("pc-remote-log").children.map((row) => row.textContent.replace(/^[^·]+· /, ""));
  assert.deepEqual(rows, ["a message to Mefi", "a button · wrong PIN"]);
});
