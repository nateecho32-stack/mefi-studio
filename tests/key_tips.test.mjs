// Key tips (renderer/key-tips.js): first-run pop-ups that name the key for a
// button. They wait out every sheet, show at most two at once, fade away for
// good on a click or on the key itself, and switch off from one place.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

import { createDom, Element } from "./fixtures/renderer-dom.mjs";

const source = await readFile(new URL("../renderer/key-tips.js", import.meta.url), "utf8");

function load({ storage = new Map(), vibe = true } = {}) {
  const { document, get } = createDom({ ids: ["vibe-compose", "vibe-build", "vibe-dock", "vibe-pulse", "settings-key-tips"] });
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) ?? document.querySelector(`#${id}`);
  document.readyState = "complete";
  for (const id of ["vibe-compose", "vibe-build", "vibe-dock", "vibe-pulse"]) document.body.append(get(id));
  // Laid out on screen: every node answers with a visible box.
  Element.prototype.getBoundingClientRect ??= function () { return { left: 400, top: 300, right: 700, bottom: 360, width: 300, height: 60 }; };
  Element.prototype.getClientRects ??= function () { return this.hidden ? [] : [{}]; };
  const events = {}, registered = [], toasts = [];
  const timers = [];
  const window = {
    innerWidth: 1920, innerHeight: 1080, location: { search: "" },
    addEventListener(name, callback) { (events[name] ||= []).push(callback); },
    MefiNav: { register: (dest) => registered.push(dest), state: { sheet: null, transient: null } },
    MefiVibe: { mode: () => (vibe ? "vibe" : "build"), isActive: () => vibe },
    MefiToast: (text) => toasts.push(text),
  };
  const context = vm.createContext({
    window, document, console,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  vm.runInContext(source, context);
  const tips = window.MefiKeyTips;
  const shown = () => document.body.children.filter((node) => node.className === "key-tip");
  const key = (value, extra = {}) => { for (const callback of events.keydown || []) callback({ key: value, ctrlKey: false, metaKey: false, ...extra }); };
  return { window, document, get, storage, registered, toasts, tips, shown, key };
}

test("a first launch shows two Vibe tips beside their controls, with keycaps", () => {
  const env = load();
  assert.equal(env.storage.get("mefiStudio.keyHint.v1"), "1", "the old one-line key toast stands down");
  env.tips.tick();
  assert.deepEqual([...env.tips.shown()], ["vibe-box", "vibe-dock"]);
  const box = env.shown()[0];
  assert.equal(box.dataset.side, "bottom", "under Build it: never over the button it names, nor the headline");
  const caps = box.querySelectorAll("kbd").map((cap) => cap.textContent);
  assert.deepEqual(caps, ["/", "Enter", "Ctrl", "Enter"]);
  assert.ok(env.registered.some((dest) => dest.id === "keyTipsToggle") && env.registered.some((dest) => dest.id === "keyTipsAgain"), "Search can switch them off and bring them back");
});

test("a tip never pops over the What's new sheet that opens after an update", () => {
  const env = load();
  const sheet = new Element("div");
  sheet.setAttribute("id", "whats-new-sheet");
  sheet.id = "whats-new-sheet";
  sheet.hidden = false;
  env.document.body.append(sheet);
  env.tips.tick();
  assert.deepEqual([...env.tips.shown()], [], "nothing pops over the sheet that says what changed");
  sheet.hidden = true;
  env.tips.tick();
  assert.equal(env.tips.shown().length, 2, "and the tips come once it is closed");
});

test("a tip never pops over the first run's welcome, and comes once it is closed", () => {
  const env = load();
  let open = true;
  env.window.MefiSetupHelper = { isOpen: () => false, welcomeOpen: () => open };
  env.tips.tick();
  assert.deepEqual([...env.tips.shown()], [], "the welcome is a dialog: nothing pops over it");
  open = false;
  env.tips.tick();
  assert.equal(env.tips.shown().length, 2);
});

test("a click fades a tip away for good; pressing its key does too", () => {
  const env = load();
  env.tips.tick();
  for (const fn of env.shown()[0].listeners.click) fn({ stopPropagation() {} });
  assert.deepEqual([...env.tips.seen()], ["vibe-box"]);
  assert.deepEqual(JSON.parse(env.storage.get("mefiStudio.keyTips.seen")), ["vibe-box"]);
  const box = new Element("textarea");
  env.key("t", { target: box });
  assert.ok(!env.tips.seen().includes("vibe-dock"), "a t typed into a box is writing, not the shortcut");
  env.key("t"); // the dock tip names T
  assert.ok(env.tips.seen().includes("vibe-dock"));
  env.tips.tick();
  assert.ok(!env.tips.shown().includes("vibe-box") && !env.tips.shown().includes("vibe-dock"), "seen tips never come back");
  const again = load({ storage: env.storage });
  again.tips.tick();
  assert.ok(!again.tips.shown().includes("vibe-box"), "remembered across launches");
});

test("tips wait out sheets and switch off from Settings, then come back with Show key tips again", () => {
  const env = load();
  env.window.MefiNav.state.sheet = "plans";
  env.tips.tick();
  assert.deepEqual([...env.tips.shown()], [], "nothing pops over an open page");
  env.window.MefiNav.state.sheet = null;
  env.tips.tick();
  assert.equal(env.tips.shown().length, 2);
  env.tips.setEnabled(false);
  assert.equal(env.storage.get("mefiStudio.keyTips"), "off");
  assert.deepEqual([...env.tips.shown()], []);
  assert.equal(env.get("settings-key-tips").checked, false, "the Settings switch follows");
  env.tips.tick();
  assert.deepEqual([...env.tips.shown()], []);
  env.tips.reset();
  assert.equal(env.storage.has("mefiStudio.keyTips"), false);
  env.tips.tick();
  assert.equal(env.tips.shown().length, 2);
  // Build's own tips never show on Vibe's page.
  const build = load({ vibe: false });
  build.tips.tick();
  assert.ok(build.tips.shown().every((id) => !id.startsWith("vibe-")));
});

test("the tips point at controls the 0.5 layout shows, and the Map's empty card starts a task", async () => {
  // The classic task box, Command's dock and the tab row are hidden in every launch: a tip anchored there never shows.
  const targets = [...source.matchAll(/target: "([^"]+)"/g)].map((match) => match[1]).join(", ");
  for (const gone of ["#idle-task-input", "#cmd-dock", ".cmd-dock", "#tabs", ".tools-cluster"]) assert.ok(!targets.includes(gone), `no tip anchors to ${gone}`);
  assert.ok(targets.includes("#map-bar") && targets.includes("#map-zoom"), "the Map's tips sit on its bar and its zoom");
  // "Start the first task" in Build opens a new task as the Map's N does, not the hidden box.
  const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
  const at = idle.indexOf('getElementById("cmd-empty-start")');
  const handler = idle.slice(at, idle.indexOf("});", at));
  assert.ok(at > 0 && handler.includes("mapNewTask();") && !handler.includes("idle-task-input"), handler);
});
