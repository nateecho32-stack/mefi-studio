import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// renderer/pc-vault.js (Friends › Your PCs › Share between my PCs, and Share
// with friends) in a vm with a tiny DOM and a fake bridge: making and pairing
// the vault, the pairing code only on request, stopped items that cannot be
// ticked, received items used by name, the library, keys behind the exact
// typed phrase, and friend shares previewed before saving and reviewed
// before keeping. Then main.cjs's keys handler never hands a value back.

const source = await readFile(new URL("../renderer/pc-vault.js", import.meta.url), "utf8");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
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
  // Only the selectors pc-vault.js uses.
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
  byClass(name) { return this.all().filter((item) => item.className.split(" ").includes(name)); }
}

function environment({ status = { ok: true, linked: false, account: "owner", encryption: true, confirmation: PHRASE }, replies = {}, bridge = true, ui = null } = {}) {
  const calls = [];
  const answer = (name, fallback) => async (...args) => {
    calls.push([name, ...args]);
    const reply = replies[name];
    return typeof reply === "function" ? reply(...args) : reply ?? fallback;
  };
  const api = bridge ? {
    vaultStatus: async () => { calls.push(["vaultStatus"]); return status; },
    vaultCreate: answer("vaultCreate", { ok: true, repo: "owner/mefi-studio-vault", pairingCode: "ABCD-EFGH" }),
    vaultPair: answer("vaultPair", { ok: true, repo: "owner/mefi-studio-vault" }),
    vaultCode: answer("vaultCode", { ok: true, pairingCode: "ABCD-EFGH" }),
    vaultUnpair: answer("vaultUnpair", { ok: true }),
    vaultOffer: answer("vaultOffer", { ok: true, items: [] }),
    vaultPublish: answer("vaultPublish", { ok: true, sent: [], stopped: [] }),
    vaultRead: answer("vaultRead", { ok: true, items: [], quarantined: [] }),
    vaultUse: answer("vaultUse", { ok: true, step: "brain" }),
    vaultLibrary: answer("vaultLibrary", { ok: true, items: [] }),
    vaultLibraryUse: answer("vaultLibraryUse", { ok: true }),
    vaultForget: answer("vaultForget", { ok: true, items: [] }),
    vaultKeys: answer("vaultKeys", { ok: true }),
    sharePreview: answer("sharePreview", { ok: true }),
    shareExport: answer("shareExport", { ok: true, file: "x.mefishare" }),
    shareOpen: answer("shareOpen", { ok: false, canceled: true }),
    shareKeep: answer("shareKeep", { ok: true }),
  } : undefined;
  const window = { mefiStudio: api, ...(ui ? { MefiUi: ui } : {}) };
  const context = vm.createContext({ window, document: { createElement: (tag) => new Element(tag) }, Date, Number, Array, Set, Map, Promise, JSON, Object, String });
  vm.runInContext(source, context);
  return { vault: window.MefiPcVault, calls, setStatus: (next) => { status = next; } };
}
const linkedStatus = { ok: true, linked: true, repo: "owner/mefi-studio-vault", keyMatches: true, encryption: true, confirmation: PHRASE,
  pcs: [{ name: "DESK", self: true, at: Date.UTC(2026, 8, 27, 20), projects: [{ repo: "owner/app", risk: 2, behind: 0 }] }, { name: "LAPTOP", self: false, at: Date.UTC(2026, 8, 27, 19), projects: [] }],
  shelves: [{ id: "brains", label: "Agent brains" }, { id: "insights", label: "How models did, by kind of task" }] };

test("without the desktop bridge both sections say where they work", () => {
  const env = environment({ bridge: false });
  assert.equal(env.vault.section().find("pc-vault-status").textContent, "Sharing between your PCs works in the desktop app.");
  assert.equal(env.vault.shareSection().find("pc-share-status").textContent, "Share files work in the desktop app.");
});

test("not paired: make the vault once and see its code, or pair with one", async () => {
  const env = environment();
  const box = env.vault.section();
  assert.equal(env.calls.length, 0, "nothing is read until the section opens");
  box.toggle(); await flush();
  assert.equal(box.dataset.state, "unlinked");
  assert.match(box.find("pc-vault-status").textContent, /Signed in to GitHub as owner/);
  box.find("pc-vault-create").click(); await flush();
  assert.equal(box.find("pc-vault-codebox").hidden, false);
  assert.equal(box.find("pc-vault-code-text").textContent, "ABCD-EFGH");
  assert.match(box.find("pc-vault-codebox").textContent, /do not send it in a chat/);
  box.find("pc-vault-code-hide").click(); await flush();
  assert.equal(box.find("pc-vault-code-text").textContent, "");
  assert.equal(box.find("pc-vault-codebox").hidden, true);
  box.find("pc-vault-code").value = "ABCD EFGH";
  box.find("pc-vault-pair").click(); await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "vaultPair"), ["vaultPair", "ABCD EFGH"]);
  assert.equal(box.find("pc-vault-code").value, "", "the typed code is not left on screen");
  const signedOut = environment({ status: { ok: true, linked: false, account: null, encryption: true } }).vault.section();
  signedOut.toggle(); await flush();
  assert.match(signedOut.find("pc-vault-status").textContent, /Sign in to GitHub first/);
});

test("paired: every PC's line, stopped items cannot be ticked, and only ticked ones go", async () => {
  const env = environment({ status: linkedStatus, replies: {
    vaultOffer: { ok: true, items: [
      { id: "b1", title: "Reviewer", ok: true, reasons: ["Removed: a folder path on this PC (map.nodes[0].prompt)."], preview: "{}" },
      { id: "b2", title: "Leaky", ok: false, reasons: ["Stopped: an API key or token (map.config)."], preview: "{}" },
      { id: "b3", title: "Planner", ok: true, reasons: [], preview: "{}" },
    ] },
    vaultPublish: (shelf, ids) => ({ ok: true, sent: ids, stopped: [] }),
  } });
  const box = env.vault.section();
  box.toggle(); await flush();
  assert.equal(box.dataset.state, "linked");
  assert.deepEqual(box.find("pc-vault-pcs").children.map((row) => row.textContent.replace(/ · [A-Z][a-z]{2} \d+, [^·]*?(?= · )/, " · WHEN")), ["This PC · WHEN · owner/app: 2 not on GitHub", "LAPTOP · WHEN · in step"]);
  box.find("pc-vault-shelf").value = "brains";
  box.find("pc-vault-offer-open").click(); await flush();
  const ticks = box.find("pc-vault-offer").querySelectorAll("input[type=checkbox]");
  assert.deepEqual(ticks.map((tick) => tick.disabled), [false, true, false]);
  assert.match(box.find("pc-vault-offer").textContent, /Stopped: an API key or token/);
  ticks[0].checked = true; ticks[1].checked = true;
  box.find("pc-vault-send").click(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.find((call) => call[0] === "vaultPublish"))), ["vaultPublish", "brains", ["b1"]]);
  assert.equal(box.find("pc-vault-status").textContent, "Sent 1 item.");
});

test("each PC's line says what its agents are doing, or why they are not", async () => {
  const pcs = [
    { name: "DESK", self: false, at: Date.UTC(2026, 8, 28, 9), projects: [], agents: { project: "Ruins Runner", state: "running", headline: "2 agents working", working: [{ title: "Add the login page", since: 1 }, { title: "Fix the tests", since: 2 }], needsYou: 1, done: 3, failed: 1, recent: ["Tidy the menu"] } },
    { name: "SPARE", self: false, at: Date.UTC(2026, 8, 28, 8), projects: [], agents: { project: null, state: "paused", headline: "Agents paused", working: [], needsYou: 0, done: 0, failed: 0, recent: [] } },
    { name: "OLD", self: false, at: Date.UTC(2026, 8, 27, 8), projects: [] },
  ];
  const env = environment({ status: { ...linkedStatus, pcs } });
  const box = env.vault.section();
  box.toggle(); await flush();
  const rows = box.find("pc-vault-pcs").children;
  assert.deepEqual(rows.map((row) => row.byClass("pc-vault-agents").map((item) => item.textContent)), [
    ["Ruins Runner: Working on Add the login page, Fix the tests · 1 needs you · 3 done, 1 stopped today (last: Tidy the menu)"],
    ["Agents paused"],
    [],
  ], "a PC from before this build still shows its plain line");
});

test("received items are used by name; the ones that cannot be used say why; quarantined ones stay out", async () => {
  const env = environment({ status: linkedStatus, replies: { vaultRead: { ok: true, items: [
    { id: "b1", from: "LAPTOP", at: 1, title: "Reviewer", usable: true, preview: "{}" },
    { id: "b9", from: "LAPTOP", at: 1, title: "Other", usable: false, reason: "This belongs to owner/other. Open that project to use it.", preview: "{}" },
  ], quarantined: [{ id: "bad", from: "LAPTOP", reasons: ["Stopped: tells an agent to ignore its instructions (map.steps[0])."] }, { id: "b7", title: "Night shift", from: "LAPTOP", reasons: [] }] } } });
  const box = env.vault.section();
  box.toggle(); await flush();
  box.find("pc-vault-shelf").value = "brains";
  box.find("pc-vault-read").click(); await flush();
  const received = box.find("pc-vault-received");
  assert.match(received.textContent, /Open that project to use it/);
  assert.match(received.textContent, /Kept out: bad from LAPTOP.*ignore its instructions/);
  assert.match(received.textContent, /Kept out: Night shift from LAPTOP/, "by name when it has one");
  assert.equal(received.buttons("Use on this PC").length, 1);
  received.buttons("Use on this PC")[0].click(); await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "vaultUse"), ["vaultUse", "brains", "b1", "LAPTOP"]);
});

test("keys go only after the exact phrase, under the warning, and only names cross", async () => {
  const env = environment({ status: linkedStatus, replies: { vaultKeys: (action, options) => {
    if (action === "offer") return { ok: true, confirmation: PHRASE, keys: ["openrouter", "zai"], setup: ["lmStudioEndpoint"] };
    if (action === "share") return { ok: true, shared: options.names };
    if (action === "list") return { ok: true, from: "DESK", at: 1, keys: ["openrouter"], setup: [], here: [] };
    return { ok: true, used: options?.names ?? [] };
  } } });
  const box = env.vault.section();
  box.toggle(); await flush();
  const keys = box.find("pc-vault-keys");
  assert.match(keys.textContent, /You are sharing keys and setup information\. They can be stolen/);
  assert.equal(box.find("pc-vault-keys-share").className.split(" ").includes("danger"), true, "Share these keys reads as risky");
  keys.toggle(); await flush();
  const share = box.find("pc-vault-keys-share");
  assert.equal(share.disabled, true, "nothing ticked, nothing typed");
  const [openrouter] = box.find("pc-vault-keys-list").querySelectorAll("input[type=checkbox]");
  openrouter.checked = true; openrouter.fire("change");
  assert.equal(share.disabled, true, "still needs the phrase");
  const phrase = box.find("pc-vault-keys-confirm");
  phrase.value = "i understand this shares my keys"; phrase.fire("input");
  assert.equal(share.disabled, true, "exactly, not nearly");
  phrase.value = PHRASE; phrase.fire("input");
  assert.equal(share.disabled, false);
  share.click(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.find((call) => call[0] === "vaultKeys" && call[1] === "share"))), ["vaultKeys", "share", { names: ["openrouter"], confirmation: PHRASE }]);
  assert.equal(phrase.value, "", "the phrase is asked for again next time");
  box.find("pc-vault-keys-check").click(); await flush();
  box.find("pc-vault-keys-use").click(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.find((call) => call[0] === "vaultKeys" && call[1] === "use"))), ["vaultKeys", "use", { names: ["openrouter"] }]);
});

test("friends get a previewed, scrubbed item saved where the owner chooses; a risky file is kept out", async () => {
  const env = environment({ replies: {
    vaultOffer: { ok: true, items: [{ id: "b1", title: "Reviewer" }] },
    sharePreview: { ok: true, title: "Reviewer", reasons: ["Removed: a folder path with your user name (map.nodes[0].prompt)."], preview: "{\"map\":{\"name\":\"Reviewer\"}}" },
    shareOpen: { ok: false, quarantined: true, title: "Free brain", reasons: ["Stopped: sends data to a paste, webhook or tunnel service (value.map.nodes[1])."] },
  } });
  const box = env.vault.shareSection();
  box.find("pc-share-list").click(); await flush();
  box.find("pc-share-item").value = "b1";
  box.find("pc-share-preview").click(); await flush();
  assert.match(box.find("pc-share-out").textContent, /Your friend gets: Reviewer/);
  assert.match(box.find("pc-share-out").textContent, /"name":"Reviewer"/);
  box.find("pc-share-save").click(); await flush();
  assert.deepEqual(env.calls.find((call) => call[0] === "shareExport"), ["shareExport", "brains", "b1"]);
  box.find("pc-share-open").click(); await flush();
  assert.match(box.find("pc-share-in").textContent, /Kept out: Free brain.*paste, webhook/);
  assert.equal(box.find("pc-share-keep"), null, "nothing to keep");
  assert.match(box.find("pc-share-status").textContent, /Nothing was saved/);
});

test("the page never sets HTML, and main's keys handler never hands a value back", () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/);
  const start = main.indexOf('ipcMain.handle("vault:keys"');
  const block = main.slice(start, main.indexOf('ipcMain.handle("share:preview"', start));
  assert.ok(start > 0 && block.length > 500);
  // No return hands back the received values or the values being shared.
  for (const line of block.split("\n").filter((row) => /\breturn\b/.test(row))) assert.doesNotMatch(line, /got\.values|\bvalues\s*:|[{,]\s*values\s*[,}]|return values\b/, line.trim());
});

test("Keys and setup opened while the vault is still loading waits its turn; a wrong phrase says why; a failed list says so", async () => {
  const env = environment({ status: linkedStatus, replies: { vaultKeys: (action, options) => (action === "offer" ? { ok: true, confirmation: PHRASE, keys: ["zai"], setup: [] } : { ok: true, shared: options?.names ?? [] }) } });
  const box = env.vault.section();
  box.toggle(); // starts reading the vault
  box.find("pc-vault-keys").toggle(); // opened at once, while that read runs
  await flush();
  assert.equal(box.find("pc-vault-keys-list").querySelectorAll("input[type=checkbox]").length, 1, "the list still arrives");
  const phrase = box.find("pc-vault-keys-confirm");
  const [tick] = box.find("pc-vault-keys-list").querySelectorAll("input[type=checkbox]");
  tick.checked = true; tick.fire("change");
  phrase.value = "i understand"; phrase.fire("input");
  assert.equal(box.find("pc-vault-keys-mismatch").hidden, false, "Share stays off, and says why");
  phrase.value = PHRASE; phrase.fire("input");
  assert.equal(box.find("pc-vault-keys-mismatch").hidden, true);
  assert.equal(box.find("pc-vault-keys-share").disabled, false);
  box.find("pc-vault-keys-share").click(); await flush();
  assert.match(box.find("pc-vault-status").textContent, /On your other PC, open Keys and setup and choose Check for shared keys/);
  const failing = environment({ status: linkedStatus, replies: { vaultKeys: { ok: false, error: "Switching projects. Try again in a moment." } } }).vault.section();
  failing.toggle(); await flush();
  failing.find("pc-vault-keys").toggle(); await flush();
  assert.equal(failing.find("pc-vault-status").textContent, "Switching projects. Try again in a moment.");
});

test("removing asks twice, and a refusal or a failed unpair says why", async () => {
  const armed = [];
  const ui = { arm: (button, options) => { armed.push([button.id || button.textContent, options.armed]); button.addEventListener("click", options.run); return button; }, plainError: (error, fallback) => error?.message || (typeof error === "string" ? error : "") || fallback };
  const env = environment({ status: linkedStatus, ui, replies: {
    vaultLibrary: { ok: true, items: [{ shelf: "insights", id: "models", from: "LAPTOP", source: "vault", title: "How 3 models did" }] },
    vaultForget: { ok: false, error: "The library is busy. Try again in a moment." },
    vaultUnpair: { ok: false, error: "GitHub did not answer." },
  } });
  const box = env.vault.section();
  box.toggle(); await flush();
  assert.deepEqual(armed, [["pc-vault-keys-clear", "Remove the keys?"], ["Remove", "Remove it?"]]);
  box.find("pc-vault-library").buttons("Remove")[0].click(); await flush();
  assert.equal(box.find("pc-vault-status").textContent, "The library is busy. Try again in a moment.");
  assert.match(box.find("pc-vault-library").textContent, /How 3 models did/, "a refused remove keeps the row");
  box.find("pc-vault-unpair").click(); await flush();
  assert.equal(box.find("pc-vault-status").textContent, "GitHub did not answer.");
  const canceled = environment({ status: linkedStatus, replies: { vaultUnpair: { ok: false, canceled: true } } }).vault.section();
  canceled.toggle(); await flush();
  const before = canceled.find("pc-vault-status").textContent;
  canceled.find("pc-vault-unpair").click(); await flush();
  assert.equal(canceled.find("pc-vault-status").textContent, before, "Cancel in main's own dialog says nothing");
});
