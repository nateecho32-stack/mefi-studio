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

function load({ zoom = true } = {}) {
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
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("config-")) });
  get("config-overlay").hidden = true;
  const api = zoom ? { uiZoom: async ({ factor }) => { zoomed.push(factor); return { ok: true, factor }; }, uiZoomGet: async () => ({ ok: true, factor: 1.1 }) } : {};
  const window = { mefiStudio: api, MefiNav: { list: () => records }, MefiToast() {} };
  vm.runInContext(source, vm.createContext({ window, document, console, requestAnimationFrame: () => 0 }));
  const titles = () => get("config-pane").querySelectorAll(".config-item-title").map((node) => node.textContent);
  const categories = () => get("config-tree").querySelectorAll(".config-category").filter((button) => !button.hidden).map((button) => [button.dataset.category, button.children[1].textContent]);
  return { config: window.MefiConfig, get, ran, zoomed, titles, categories };
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
