// Configuration: every setting in one searchable tree (renderer/config-dialog.js).
// It reads the `settings:*` records Settings and Agents register for Search,
// files each under the first category whose words match, and opens the real
// control; its one setting of its own is the interface scale (main.cjs ui:zoom).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/config-dialog.js", import.meta.url), "utf8");
const settle = async () => { for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };

function load({ zoom = true, helper = false } = {}) {
  const ran = [];
  const zoomed = [];
  const record = (id, label, desc = "") => ({ id, label, desc, kind: "action", run: () => ran.push(id) });
  const records = [
    record("settings:agents-model", "Agents › Team & models › Builder model", "Which model writes your code"),
    record("settings:pref-reference", "Settings › Automation › Memory alignment", "Keep agents in line with project memory"),
    record("settings:parallel", "Agents › Run behavior › Parallel builds", "How many workers at once"),
    record("settings:theme", "Settings › Appearance › Colour theme", "The palette"),
    record("settings:updates", "Settings › System › Check for updates", "Release updates"),
    record("settings:diagnostics", "Settings › System › Diagnostics", "Save a report"),
    record("settings:zen", "Settings › Appearance › Zen mode", "Appearance"),
    record("settings:save-key", "Settings › Connections › Save", "Connections"),
    record("settings:agents-model-choice", "Agents › Team & models › Builder model", "Which model writes your code"),
    { id: "tasks", label: "Task board", kind: "overlay" },
    { ...record("settings:hidden", "Settings › General › Hidden"), hidden: () => true },
  ];
  // The setup helper's per-section Search records (renderer/setup-helper.js).
  const opened = [];
  if (helper) {
    records.push(
      record("setup-helper:welcome", "Setup helper › Welcome", "Start here"),
      record("setup-helper:providers", "Setup helper › Connect an AI", "Sign in to a coding CLI or add a key"),
      record("setup-helper:routing", "Setup helper › Routing", "Which provider answers each role"),
      record("setup-helper:permissions", "Setup helper › Permissions", "What Mefi may decide for you"),
      record("setup-helper:system", "Setup helper › Machine & app", "This computer and the app"),
      record("setup-helper:look", "Setup helper › Look", "Theme and nodes"),
      record("setup-helper:finish", "Setup helper › Finish", "You are set"),
      record("setup-helper:mystery", "Setup helper › Mystery", "A section Configuration does not know"),
    );
  }
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("config-")) });
  get("config-overlay").hidden = true;
  // The scale changed from the keyboard (main.cjs stepUiZoom) arrives as a push; timers wait for flush().
  let pushed = null;
  const toasts = [];
  const timers = [];
  const api = zoom ? { uiZoom: async ({ factor }) => { zoomed.push(factor); return { ok: true, factor }; }, uiZoomGet: async () => ({ ok: true, factor: 1.1 }), onUiZoom: (callback) => { pushed = callback; } } : {};
  const window = { mefiStudio: api, MefiNav: { list: () => records }, MefiToast: (text) => toasts.push(text), ...(helper ? { MefiSetupHelper: { open: (id) => opened.push(id) } } : {}) };
  const setTimeout = (run) => { timers.push(run); return timers.length; };
  const clearTimeout = (id) => { if (id) timers[id - 1] = null; };
  vm.runInContext(source, vm.createContext({ window, document, console, requestAnimationFrame: () => 0, setTimeout, clearTimeout }));
  const flush = () => { for (const run of timers.splice(0)) run?.(); };
  const titles = () => get("config-pane").querySelectorAll(".config-item-title").map((node) => node.textContent);
  const categories = () => get("config-tree").querySelectorAll(".config-category").filter((button) => !button.hidden).map((button) => [button.dataset.category, button.children[1].textContent]);
  return { config: window.MefiConfig, get, ran, opened, zoomed, titles, categories, push: (payload) => pushed?.(payload), toasts, flush };
}

test("every settings record is filed once, by the page it lives on and then by its words", () => {
  const { config } = load();
  const filed = Object.fromEntries(config.records().map((row) => [row.id, row.category]));
  assert.deepEqual(filed, {
    "settings:agents-model": "agents",
    "settings:pref-reference": "knowledge",
    "settings:parallel": "exec",
    "settings:theme": "ui",
    "settings:updates": "web",
    "settings:diagnostics": "dev",
    "settings:zen": "ui",
  }, "Appearance's Zen mode is a look, not a Zen key; a lone Save, a second copy of a picker, hidden records and pages are left out");
});

test("the tree counts each category, the pane groups a category's settings by where they live, and picking one opens it", async () => {
  const { config, get, ran, titles, categories } = load();
  await config.open({ category: "dev" });
  assert.equal(get("config-overlay").hidden, false);
  assert.deepEqual(categories(), [["agents", "1"], ["knowledge", "1"], ["exec", "1"], ["web", "1"], ["ui", "2"], ["dev", "1"]], "an empty category (Storage) stays out of the tree");
  assert.equal(get("config-pane").querySelector(".config-group-name").textContent, "Settings › System");
  assert.deepEqual(titles(), ["Diagnostics"]);
  get("config-pane").querySelector(".config-item").click();
  assert.deepEqual(ran, ["settings:diagnostics"], "the real control opens");
  assert.equal(get("config-overlay").hidden, true, "the dialog steps aside first");
});

test("search looks through every category at once; Enter opens the first match", async () => {
  const { config, get, ran, titles, categories } = load();
  await config.open();
  const search = get("config-search");
  search.value = "model";
  for (const fn of search.listeners.input) fn({});
  assert.deepEqual(titles(), ["Builder model"]);
  assert.deepEqual(categories(), [["agents", "1"]], "only categories with a match stay in the tree");
  for (const fn of search.listeners.keydown) fn({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(ran, ["settings:agents-model"]);
});

test("UI & Surfaces carries the interface scale, saved through the host", async () => {
  const { config, get, zoomed } = load();
  await config.open({ category: "ui" });
  await settle();
  const slider = get("config-pane").querySelector("input");
  assert.equal(slider.value, "110", "the saved scale is read back");
  slider.value = "125";
  for (const fn of slider.listeners.change) fn({});
  await settle();
  assert.deepEqual(zoomed, [1.25]);
  const offline = load({ zoom: false });
  await offline.config.open({ category: "ui" });
  assert.equal(offline.get("config-pane").querySelector("input").disabled, true, "no host, no scale");
});

test("the host keeps the scale between 70% and 150% in 5% steps", async () => {
  const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const start = main.indexOf("function zoomFactorOf(value) {");
  const body = main.slice(start, main.indexOf("\n}", start) + 2);
  const zoomFactorOf = vm.runInNewContext(`(${body})`);
  assert.deepEqual([0.5, 0.72, 1, 1.26, 2, "x", null].map(zoomFactorOf), [0.7, 0.7, 1, 1.25, 1.5, 1, 1]);
  assert.match(main, /settings\.ui = \{ \.\.\.\(settings\.ui \?\? \{\}\), zoom: value \}/, "the scale is saved with the other UI settings");
  assert.match(main, /did-finish-load[\s\S]{0,200}zoomFactorOf\(settings\?\.ui\?\.zoom\)/, "and put back when the page loads");
});

test("the setup helper's sections are filed with the settings they configure; its own framing is left out", () => {
  const { config } = load({ helper: true });
  const filed = Object.fromEntries(config.records().filter((row) => row.id.startsWith("setup-helper:")).map((row) => [row.id, row.category]));
  assert.deepEqual(filed, {
    "setup-helper:walkthrough": "agents",
    "setup-helper:providers": "agents",
    "setup-helper:routing": "agents",
    "setup-helper:permissions": "exec",
    "setup-helper:system": "dev",
    "setup-helper:look": "ui",
  }, "Welcome and Finish are the walkthrough's framing, and a section Configuration does not know is not a setting");
  assert.ok(!load().config.records().some((row) => row.id.startsWith("setup-helper:")), "without the helper there is nothing to index");
});

test("Walk me through setup heads Inference & Agents and opens the helper's welcome", async () => {
  const { config, get, opened, ran, titles } = load({ helper: true });
  await config.open({ category: "agents" });
  assert.deepEqual(titles().slice(0, 4), ["Walk me through setup", "Connect an AI", "Routing", "Builder model"]);
  assert.equal(get("config-pane").querySelector(".config-group-name").textContent, "Setup helper");
  get("config-pane").querySelector(".config-item").click();
  assert.deepEqual(opened, ["welcome"]);
  assert.deepEqual(ran, [], "the walkthrough opens the helper itself, not a section record");
  assert.equal(get("config-overlay").hidden, true, "the dialog steps aside first");
});

test("search reaches the helper's sections, and a match opens the helper at that section", async () => {
  const { config, get, ran, titles } = load({ helper: true });
  await config.open();
  const search = get("config-search");
  const type = (text) => { search.value = text; for (const fn of search.listeners.input) fn({}); };
  type("walk");
  assert.deepEqual(titles(), ["Walk me through setup"]);
  type("routing");
  assert.deepEqual(titles(), ["Routing"]);
  for (const fn of search.listeners.keydown) fn({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(ran, ["setup-helper:routing"]);
});

test("Ctrl +, Ctrl - and Ctrl 0 walk the scale's ladder from wherever it stands, and are saved like the slider", async () => {
  const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const slice = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)) + end.length);
  const code = `${slice("function zoomFactorOf(value) {", "\n}")}\n${slice("const ZOOM_STEPS = ", ";")}\n${slice("function zoomStepOf(current, direction) {", "\n}")}\n({ zoomFactorOf, ZOOM_STEPS, zoomStepOf })`;
  const { ZOOM_STEPS, zoomStepOf } = vm.runInNewContext(code);
  // The ladder is inside the slider's range, in order, and holds 100%.
  assert.ok(ZOOM_STEPS.every((step, index) => step >= 0.7 && step <= 1.5 && (index === 0 || step > ZOOM_STEPS[index - 1])));
  assert.ok(ZOOM_STEPS.includes(1));
  const up = (from) => zoomStepOf(from, 1);
  const down = (from) => zoomStepOf(from, -1);
  assert.deepEqual([1, 1.05, 1.3, 1.4].map(up), [1.05, 1.1, 1.4, 1.5], "in: one rung at a time");
  assert.deepEqual([1, 0.95, 0.75, 1.4].map(down), [0.95, 0.9, 0.7, 1.3], "out: one rung at a time");
  assert.equal(up(1.5), 1.5, "the top stays the top");
  assert.equal(down(0.7), 0.7, "and the bottom the bottom");
  assert.equal(up(1.35), 1.4, "a scale the slider left between rungs goes to the next one up");
  assert.equal(down(1.35), 1.3, "or the next one down");
  assert.equal(zoomStepOf(1.25, 0), 1, "Ctrl 0 is 100%");
  assert.equal(up("x"), 1.05, "an unreadable scale counts as 100%");
  // The menu carries all three chords, the hidden = for a keyboard without a plus, and they are saved and announced.
  assert.match(main, /label: "Actual size", accelerator: "CmdOrCtrl\+0", click: \(\) => \{ stepUiZoom\(0\)/);
  assert.match(main, /label: "Zoom in", accelerator: "CmdOrCtrl\+Plus", click: \(\) => \{ stepUiZoom\(1\)/);
  assert.match(main, /label: "Zoom in \(=\)", accelerator: "CmdOrCtrl\+=", visible: false, click: \(\) => \{ stepUiZoom\(1\)/);
  assert.match(main, /label: "Zoom out", accelerator: "CmdOrCtrl\+-", click: \(\) => \{ stepUiZoom\(-1\)/);
  assert.doesNotMatch(main, /role: "zoomIn"|role: "zoomOut"|role: "resetZoom"/, "the unsaved, unclamped roles are gone");
  assert.match(main, /const next = zoomStepOf\(window\.webContents\.getZoomFactor\(\), direction\);[\s\S]{0,200}settings\.ui = \{ \.\.\.\(settings\.ui \?\? \{\}\), zoom: next \}[\s\S]{0,120}send\("ui:zoom-changed", \{ factor: next \}\)/);
});

test("a scale changed from the keyboard moves an open slider and says the result once the presses settle", async () => {
  const { config, get, push, toasts, flush } = load();
  await config.open({ category: "ui" });
  await settle();
  const slider = () => get("config-pane").querySelector("input");
  assert.equal(slider().value, "110");
  push({ factor: 1.15 });
  push({ factor: 1.2 });
  assert.equal(slider().value, "120", "the open slider follows the keys");
  assert.deepEqual(toasts, [], "nothing is said while the keys are still going");
  flush();
  assert.deepEqual(toasts, ["Interface scale 120%"], "one line with where it ended");
  push({ factor: "x" });
  flush();
  assert.equal(toasts.length, 1, "a push with no scale in it says nothing");
});
