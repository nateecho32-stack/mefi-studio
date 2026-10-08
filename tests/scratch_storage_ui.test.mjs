// renderer/scratch.js (Settings › System › Storage) in a vm with a small DOM
// and a fake bridge: the card never opens a store at launch (no read until it
// unfolds, and then with open: false), it paints the host's answer, each
// control saves one plain value through scratchSet, a forced launch disables
// the controls and says why, Compact now compacts and re-reads, and a push
// repaints. Then the wiring: the template's ids, the build inventory and the
// settings category.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const read = async (file) => (await readFile(new URL(`../${file}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const source = await read("renderer/scratch.js");
const template = await read("renderer/booklet.template.html");
const builder = await read("scripts/build-booklet.mjs");
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

class Node {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; this.checked = false; this.value = ""; this.text = ""; this.open = false; this.id = ""; }
  set textContent(value) { this.text = String(value); }
  get textContent() { return this.text; }
  get options() { return this.children.filter((child) => child.tagName === "OPTION"); }
  append(...children) { for (const child of children) this.children.push(child); }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  dispatch(type) { for (const listener of this.listeners[type] ?? []) listener({ type, target: this }); }
}
function page() {
  const nodes = new Map();
  const make = (id, tag = "div") => { const node = new Node(tag); node.id = id; nodes.set(id, node); return node; };
  make("settings-storage", "details");
  make("scratch-enabled", "input");
  make("scratch-agent-tools", "input");
  const cap = make("scratch-cap", "select");
  for (const value of ["256", "512", "1024", "2048", "4096"]) { const option = new Node("option"); option.value = value; cap.append(option); }
  make("scratch-history", "select");
  make("scratch-compact", "button");
  make("scratch-status", "span");
  make("scratch-local-dir", "code");
  make("scratch-note", "p");
  return nodes;
}
const view = (extra = {}) => ({
  ok: true, projectId: "p1", enabled: true, host: "js", dir: null, localDir: "C:\\Users\\Ann\\AppData\\Local\\MefiStudio", stats: null,
  prefs: { enabled: true, capMB: 512, historyBodies: "auto", agentTools: true, saved: {}, forced: null, refused: null },
  line: "Scratch: not open yet", ...extra,
});
function environment({ state = view(), answers = {} } = {}) {
  const nodes = page();
  const calls = [];
  const toasts = [];
  let listener = null;
  let current = state;
  const api = {
    scratchStats: async (options) => { calls.push(["stats", JSON.parse(JSON.stringify(options))]); return current; },
    // Like the host: the answer carries every saved choice, not only the one just set.
    scratchSet: async (patch) => {
      calls.push(["set", JSON.parse(JSON.stringify(patch))]);
      if (answers.set) return answers.set;
      current = { ...current, prefs: { ...current.prefs, ...patch } };
      return { ok: true, prefs: current.prefs, line: current.line };
    },
    scratchCompact: async () => { calls.push(["compact"]); return answers.compact ?? { ok: true, removed: 2, line: "Scratch: 1 MB of 512 MB, 4 keys, 50% hits, compacted just now" }; },
    onScratchState: (fn) => { listener = fn; },
  };
  const context = vm.createContext({
    window: { mefiStudio: api, MefiToast: (text, kind) => toasts.push({ text, kind }) },
    document: { readyState: "complete", getElementById: (id) => nodes.get(id) ?? null, createElement: (tag) => new Node(tag), addEventListener() {} },
    Number, String, Boolean, Promise, JSON, Object, Array,
  });
  vm.runInContext(source, context);
  return { nodes, calls, toasts, $: (id) => nodes.get(id), push: (next) => listener?.(next), set: (next) => { current = next; }, scratch: context.window.MefiScratch };
}

test("the card reads nothing at launch; unfolding it asks without opening a store, and the answer is painted", async () => {
  const env = environment();
  await flush();
  assert.deepEqual(env.calls, [], "a launch stays as light as before");
  env.$("settings-storage").open = true;
  env.$("settings-storage").dispatch("toggle");
  await flush();
  assert.deepEqual(env.calls, [["stats", { open: false }]]);
  assert.equal(env.$("scratch-enabled").checked, true);
  assert.equal(env.$("scratch-agent-tools").checked, true);
  assert.equal(env.$("scratch-cap").value, "512");
  assert.equal(env.$("scratch-history").value, "auto");
  assert.equal(env.$("scratch-status").textContent, "Scratch: not open yet");
  assert.equal(env.$("scratch-local-dir").textContent, "C:\\Users\\Ann\\AppData\\Local\\MefiStudio");
  assert.equal(env.$("scratch-note").hidden, true);
  assert.equal(env.$("scratch-compact").disabled, false);
});

test("each control saves one plain value; an odd cap from the host gets its own option", async () => {
  const env = environment({ state: view({ prefs: { enabled: true, capMB: 768, historyBodies: true, agentTools: false, saved: {}, forced: null, refused: null } }) });
  env.$("settings-storage").open = true;
  env.$("settings-storage").dispatch("toggle");
  await flush();
  assert.deepEqual(env.$("scratch-cap").options.map((option) => option.value), ["256", "512", "1024", "2048", "4096", "768"]);
  assert.equal(env.$("scratch-cap").value, "768");
  assert.equal(env.$("scratch-history").value, "on");
  assert.equal(env.$("scratch-agent-tools").checked, false);
  env.$("scratch-cap").value = "1024";
  env.$("scratch-cap").dispatch("change");
  env.$("scratch-history").value = "off";
  env.$("scratch-history").dispatch("change");
  env.$("scratch-enabled").checked = false;
  env.$("scratch-enabled").dispatch("change");
  env.$("scratch-agent-tools").checked = true;
  env.$("scratch-agent-tools").dispatch("change");
  await flush();
  assert.deepEqual(env.calls.filter((call) => call[0] === "set").map((call) => call[1]), [{ capMB: 1024 }, { historyBodies: false }, { enabled: false }, { agentTools: true }]);
  assert.equal(env.$("scratch-cap").value, "1024", "the answer is painted back");
  assert.equal(env.$("scratch-agent-tools").disabled, true, "no tools while the store is off");
  const refused = environment({ answers: { set: { ok: false, error: "The cap is a whole number of MB from 64 to 65536." } } });
  refused.$("scratch-cap").value = "1024";
  refused.$("scratch-cap").dispatch("change");
  await flush();
  assert.deepEqual(refused.toasts, [{ text: "The cap is a whole number of MB from 64 to 65536.", kind: "bad" }]);
});

test("a launch with MEFI_STUDIO_NO_SCRATCH=1 disables the controls and says why; a refused MEFI_SCRATCH_DIR is explained", async () => {
  const env = environment({ state: view({ enabled: false, prefs: { enabled: false, capMB: 512, historyBodies: false, agentTools: false, saved: { enabled: true }, forced: "MEFI_STUDIO_NO_SCRATCH", refused: null }, line: "Scratch: off for this launch (MEFI_STUDIO_NO_SCRATCH=1)" }) });
  env.$("settings-storage").open = true;
  env.$("settings-storage").dispatch("toggle");
  await flush();
  for (const id of ["scratch-enabled", "scratch-agent-tools", "scratch-cap", "scratch-history", "scratch-compact"]) assert.equal(env.$(id).disabled, true, id);
  assert.equal(env.$("scratch-note").hidden, false);
  assert.equal(env.$("scratch-note").textContent, "Turned off for this launch by MEFI_STUDIO_NO_SCRATCH.");
  assert.equal(env.$("scratch-status").textContent, "Scratch: off for this launch (MEFI_STUDIO_NO_SCRATCH=1)");
  const moved = environment({ state: view({ prefs: { enabled: true, capMB: 512, historyBodies: "auto", agentTools: true, saved: {}, forced: null, refused: { dir: "C:\\Users\\Ann\\OneDrive\\scratch", reason: "onedrive" } } }) });
  moved.push(moved.scratch ? view({ prefs: { enabled: true, capMB: 512, historyBodies: "auto", agentTools: true, saved: {}, forced: null, refused: { dir: "x", reason: "onedrive" } } }) : null);
  assert.equal(moved.$("scratch-note").textContent, "MEFI_SCRATCH_DIR is inside OneDrive, so Studio keeps the store in its own folder.");
});

test("Compact now compacts, says what it dropped and re-reads with the store open; a push repaints", async () => {
  const env = environment();
  env.$("scratch-compact").dispatch("click");
  await flush();
  assert.deepEqual(env.calls, [["compact"], ["stats", { open: true }]]);
  assert.deepEqual(env.toasts, [{ text: "Compacted: 2 unused blobs dropped.", kind: "good" }]);
  env.push(view({ line: "Scratch: 61 MB of 512 MB, 1,204 keys, 94% hits, compacted 2 h ago" }));
  assert.equal(env.$("scratch-status").textContent, "Scratch: 61 MB of 512 MB, 1,204 keys, 94% hits, compacted 2 h ago");
  const failed = environment({ answers: { compact: { ok: false, error: "Scratch is off, so there is nothing to compact." } } });
  failed.$("scratch-compact").dispatch("click");
  await flush();
  assert.deepEqual(failed.toasts, [{ text: "Scratch is off, so there is nothing to compact.", kind: "bad" }]);
});

test("every element the card asks for is in the template under System, and the build bundles the file after resources.js", () => {
  const asked = new Set([...source.matchAll(/\$\("([a-z-]+)"\)/g)].map((match) => match[1]));
  const start = template.indexOf('<details class="settings-optional settings-card" id="settings-storage"');
  const end = template.indexOf('<details class="settings-optional settings-card" id="settings-styler"');
  const system = template.indexOf('id="settings-category-system"');
  assert.ok(system > 0 && start > system && end > start, "the Storage card sits in the System category");
  const markup = template.slice(start, end);
  for (const id of asked) assert.ok(id === "settings-storage" || markup.includes(`id="${id}"`), `the template has #${id}`);
  assert.match(markup, /<option value="512" selected>512 MB<\/option>/);
  assert.match(markup, /<option value="auto" selected>Auto \(when every PC is ready\)<\/option>/);
  assert.match(builder, /"resources\.js",\n {4}"scratch\.js",/);
});
