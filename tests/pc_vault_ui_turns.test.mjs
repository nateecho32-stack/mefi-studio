import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/pc-vault.js keeps each action on the thing the owner looked at:
// Save share file writes the item that was previewed, Send and Use act on the
// shelf the list was read from, and changing the shelf clears lists that
// belonged to the old one. A change another PC's clash threw away is named.
// Same tiny DOM and fake bridge as tests/pc_vault_ui.test.mjs.

const source = await readFile(new URL("../renderer/pc-vault.js", import.meta.url), "utf8");
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };
const PHRASE = "I understand this shares my keys";

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.checked = false; this.open = false; this.className = ""; this.text = ""; this.value = ""; this.type = ""; this.id = ""; }
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
  toggle() { this.open = !this.open; this.fire("toggle"); }
  all() { return [this, ...this.children.flatMap((child) => child.all?.() ?? [])]; }
  querySelectorAll(selector) {
    const rows = this.all().slice(1);
    if (selector === "button") return rows.filter((item) => item.tagName === "BUTTON");
    const boxes = rows.filter((item) => item.tagName === "INPUT" && item.type === "checkbox");
    if (selector === "input[type=checkbox]") return boxes;
    if (selector === "input[type=checkbox]:checked") return boxes.filter((item) => item.checked);
    throw new Error(`selector ${selector}`);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  find(id) { return this.all().find((item) => item.id === id) ?? null; }
  buttons(label) { return this.all().filter((item) => item.tagName === "BUTTON" && item.textContent === label); }
}

const linkedStatus = { ok: true, linked: true, repo: "owner/mefi-studio-vault", keyMatches: true, encryption: true, confirmation: PHRASE, pcs: [],
  shelves: [{ id: "brains", label: "Agent brains" }, { id: "insights", label: "How models did, by kind of task" }] };

function environment({ status = linkedStatus, replies = {} } = {}) {
  const calls = [];
  const answer = (name, fallback) => async (...args) => {
    calls.push([name, ...args]);
    const reply = replies[name];
    return typeof reply === "function" ? reply(...args) : reply ?? fallback;
  };
  const api = {
    vaultStatus: async () => { calls.push(["vaultStatus"]); return status; },
    vaultOffer: answer("vaultOffer", { ok: true, items: [] }),
    vaultPublish: answer("vaultPublish", { ok: true, sent: [], stopped: [] }),
    vaultRead: answer("vaultRead", { ok: true, items: [], quarantined: [] }),
    vaultUse: answer("vaultUse", { ok: true, step: "brain" }),
    vaultLibrary: answer("vaultLibrary", { ok: true, items: [] }),
    vaultKeys: answer("vaultKeys", { ok: true, keys: [], setup: [] }),
    sharePreview: answer("sharePreview", { ok: true, title: "Item", reasons: [], preview: "{}" }),
    shareExport: answer("shareExport", { ok: true, file: "x.mefishare" }),
    shareOpen: answer("shareOpen", { ok: false, canceled: true }),
    shareKeep: answer("shareKeep", { ok: true }),
  };
  const window = { mefiStudio: api };
  const context = vm.createContext({ window, document: { createElement: (tag) => new Element(tag) }, Date, Number, Array, Set, Map, Promise, JSON, Object, String });
  vm.runInContext(source, context);
  return { vault: window.MefiPcVault, calls };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("Save share file writes the item that was previewed; a new pick clears the preview", async () => {
  const env = environment({ replies: { vaultOffer: { ok: true, items: [{ id: "b1", title: "Reviewer" }, { id: "b2", title: "Planner" }] } } });
  const box = env.vault.shareSection();
  box.find("pc-share-list").click(); await flush();
  box.find("pc-share-item").value = "b1";
  box.find("pc-share-preview").click(); await flush();
  // The pick moves on before Save is pressed (no change event yet).
  box.find("pc-share-item").value = "b2";
  box.find("pc-share-save").click(); await flush();
  assert.deepEqual(plain(env.calls.find((call) => call[0] === "shareExport")), ["shareExport", "brains", "b1"]);

  box.find("pc-share-item").fire("change");
  assert.equal(box.find("pc-share-out").children.length, 0, "the preview of b1 goes once b2 is picked");
  assert.equal(box.find("pc-share-save"), null);
  box.find("pc-share-item").value = "b2";
  box.find("pc-share-preview").click(); await flush();
  box.find("pc-share-shelf").value = "recipes";
  box.find("pc-share-shelf").fire("change");
  assert.equal(box.find("pc-share-out").children.length, 0, "and a new kind of item clears it too");
  assert.equal(box.find("pc-share-item").hidden, true, "with the old kind's items");
  assert.equal(box.find("pc-share-item").children.length, 0);
});

test("Send and Use act on the shelf their list came from; changing the shelf clears both lists", async () => {
  const env = environment({ replies: {
    vaultOffer: { ok: true, items: [{ id: "b1", title: "Reviewer", ok: true, reasons: [], preview: "{}" }] },
    vaultPublish: (shelf, ids) => ({ ok: true, sent: ids, stopped: [] }),
    vaultRead: { ok: true, items: [{ id: "r1", from: "LAPTOP", at: 1, title: "Ship", usable: true, preview: "{}" }], quarantined: [] },
  } });
  const box = env.vault.section();
  box.toggle(); await flush();
  const shelf = box.find("pc-vault-shelf");
  shelf.value = "brains";
  box.find("pc-vault-offer-open").click(); await flush();
  box.find("pc-vault-read").click(); await flush();
  // The select moves on without a change event before the buttons are pressed.
  shelf.value = "insights";
  box.find("pc-vault-offer").querySelectorAll("input[type=checkbox]")[0].checked = true;
  box.find("pc-vault-send").click(); await flush();
  assert.deepEqual(plain(env.calls.find((call) => call[0] === "vaultPublish")), ["vaultPublish", "brains", ["b1"]]);
  box.find("pc-vault-received").buttons("Use on this PC")[0].click(); await flush();
  assert.deepEqual(plain(env.calls.find((call) => call[0] === "vaultUse")), ["vaultUse", "brains", "r1", "LAPTOP"]);

  shelf.fire("change");
  assert.equal(box.find("pc-vault-offer").children.length, 0);
  assert.equal(box.find("pc-vault-send").hidden, true);
  assert.equal(box.find("pc-vault-received").children.length, 0);
});

test("a change another PC's clash threw away is named in the vault's status", async () => {
  const at = Date.UTC(2026, 8, 28, 12);
  const env = environment({ status: { ...linkedStatus, dropped: { at, changes: ["DESK: brains (1)", "DESK: keys and setup"] } } });
  const box = env.vault.section();
  box.toggle(); await flush();
  const text = box.find("pc-vault-status").textContent;
  assert.match(text, /^Paired with owner\/mefi-studio-vault\. /);
  assert.match(text, /another PC changed the same thing at the same moment, so its version was kept and this PC's was dropped: DESK: brains \(1\); DESK: keys and setup\. Send it again if you still want it\./);
  const calm = environment();
  const quiet = calm.vault.section();
  quiet.toggle(); await flush();
  assert.equal(quiet.find("pc-vault-status").textContent, "Paired with owner/mefi-studio-vault.");
});
