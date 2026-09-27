import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/pc-sync.js (Friends › Your PCs) in a vm with a tiny DOM and a fake
// sync bridge: opening the card only looks, the button is the one thing that
// syncs, a sync in flight cannot be doubled, the last answer paints at once
// on reopen, and the browser preview says where syncing works.

const source = await readFile(new URL("../renderer/pc-sync.js", import.meta.url), "utf8");
const hub = await readFile(new URL("../renderer/companion-hub.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.className = ""; this.text = ""; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  click() { for (const listener of this.listeners.click ?? []) listener({ type: "click" }); }
  find(id) { return this.id === id ? this : this.children.map((child) => child.find?.(id)).find(Boolean) ?? null; }
}

function environment(bridge) {
  const window = { mefiStudio: bridge };
  const context = vm.createContext({ window, document: { createElement: (tag) => new Element(tag) }, Date, Number, Array });
  vm.runInContext(source, context);
  return window.MefiPcSync;
}

const answer = (overrides = {}) => ({
  ok: true, checkedAt: Date.UTC(2026, 8, 26, 23, 50), headline: "This PC matches GitHub main.", lines: ["This PC matches GitHub main."], pending: [],
  state: { repo: true, remote: true, device: "DESKTOP-ONE", behind: 0 }, ...overrides,
});

function bridge(replies) {
  const calls = [];
  const waiting = [];
  const reply = (name) => (...args) => {
    calls.push([name, args]);
    return new Promise((resolve, reject) => waiting.push({ name, resolve, reject, value: replies[name] }));
  };
  return { api: { syncStatus: reply("syncStatus"), syncRun: reply("syncRun") }, calls, answer: (index = waiting.length - 1, value) => waiting[index].resolve(value ?? waiting[index].value), fail: (index, error) => waiting[index].reject(error) };
}

test("opening the card looks, then lays out the headline, the details and this PC's name", async () => {
  const fake = bridge({ syncStatus: answer({ headline: "Some work on this PC is not on GitHub yet.", lines: ["Some work on this PC is not on GitHub yet.", "2 uncommitted files in this checkout.", "Branch wip/cli on GitHub: 1 commit not on main."], pending: [{}, {}] }) });
  const card = environment(fake.api).card();
  assert.deepEqual(fake.calls.map(([name]) => name), ["syncStatus"], "opening never pulls or pushes");
  assert.equal(card.find("pc-sync-status").textContent, "Checking GitHub…");
  assert.equal(card.find("pc-sync-status").getAttribute("role"), "status");
  assert.equal(card.find("pc-sync-run").disabled, true);
  fake.answer(0);
  await flush();
  assert.equal(card.dataset.state, "pending");
  assert.equal(card.find("pc-sync-status").textContent, "Some work on this PC is not on GitHub yet.");
  const list = card.children.find((child) => child.className === "pc-sync-list");
  assert.equal(list.hidden, false);
  assert.deepEqual(list.children.map((item) => item.textContent), ["2 uncommitted files in this checkout.", "Branch wip/cli on GitHub: 1 commit not on main."]);
  const meta = card.children.find((child) => child.className === "muted pc-sync-meta");
  assert.equal(meta.hidden, false);
  assert.match(meta.textContent, /^DESKTOP-ONE · checked /);
  assert.equal(card.find("pc-sync-run").disabled, false);
});

test("Sync this PC runs once at a time and reports what it did", async () => {
  const fake = bridge({ syncStatus: answer({ headline: "GitHub has 1 commit this PC has not pulled yet.", state: { repo: true, remote: true, device: "PC", behind: 1 } }), syncRun: answer({ lines: ["This PC matches GitHub main.", "Pulled 1 commit from GitHub."] }) });
  const card = environment(fake.api).card();
  fake.answer(0);
  await flush();
  assert.equal(card.dataset.state, "pending", "commits to pull still count as waiting");
  const run = card.find("pc-sync-run");
  run.click();
  run.click();
  assert.deepEqual(fake.calls.map(([name]) => name), ["syncStatus", "syncRun"]);
  assert.equal(run.disabled, true);
  assert.equal(run.textContent, "Syncing…");
  assert.equal(card.find("pc-sync-status").textContent, "Syncing with GitHub…");
  assert.equal(card.getAttribute("aria-busy"), "true");
  fake.answer(1);
  await flush();
  assert.equal(card.dataset.state, "clean");
  assert.equal(card.find("pc-sync-status").textContent, "This PC matches GitHub main.");
  assert.equal(run.textContent, "Sync this PC");
  assert.equal(card.getAttribute("aria-busy"), null);
});

test("reopening paints the last answer at once while it checks again", async () => {
  const fake = bridge({ syncStatus: answer() });
  const sync = environment(fake.api);
  sync.card();
  fake.answer(0);
  await flush();
  const again = sync.card();
  assert.equal(again.find("pc-sync-status").textContent, "This PC matches GitHub main.");
  assert.equal(again.dataset.state, "clean");
  assert.equal(fake.calls.length, 2, "and still asks");
});

test("problems, a folder with no remote and a rejected call all read plainly", async () => {
  const fake = bridge({ syncStatus: answer({ ok: false, headline: "This project has no origin remote yet. Publish it to GitHub once to link your PCs.", lines: ["This project has no origin remote yet. Publish it to GitHub once to link your PCs."], state: { repo: true, remote: false } }) });
  const card = environment(fake.api).card();
  fake.answer(0);
  await flush();
  assert.equal(card.dataset.state, "problem");
  assert.equal(card.find("pc-sync-run").hidden, true, "nothing to sync until the project is on GitHub");
  const broken = bridge({});
  const other = environment(broken.api).card();
  broken.fail(0, new Error("IPC closed"));
  await flush();
  assert.equal(other.dataset.state, "problem");
  assert.equal(other.find("pc-sync-status").textContent, "Sync could not run: IPC closed");
});

test("the browser preview has no bridge, so the card says where syncing works", () => {
  const card = environment(undefined).card();
  assert.equal(card.dataset.state, "unavailable");
  assert.equal(card.find("pc-sync-status").textContent, "Syncing your PCs works in the desktop app.");
  assert.equal(card.find("pc-sync-run").hidden, true);
});

test("the Friends section mounts the card inside the hub", () => {
  const friends = hub.slice(hub.indexOf('} else if (section === "friends") {'), hub.indexOf("} else {", hub.indexOf('} else if (section === "friends") {')));
  assert.match(friends, /window\.MefiPcSync\?\.card\?\.\(\)/);
  assert.match(friends, /el\.extra\.append\(pcs\)/);
  assert.doesNotMatch(friends, /action\([^)]*MefiPcSync/, "Sync answers in place; it is not a navigate-away action");
});
