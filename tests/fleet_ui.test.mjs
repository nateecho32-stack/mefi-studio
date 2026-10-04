// Live > Fleet (renderer/fleet.js) in a vm with the shared fake DOM, fed by the
// real fleet model (scripts/fleet.cjs), so what it paints is what the host would
// send. Real geometry and pixels are checked by fleet_render (Electron).
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import { createDom, templateIds } from "./fixtures/renderer-dom.mjs";

const require = createRequire(import.meta.url);
const model = require("../scripts/fleet.cjs");
const layoutSource = await readFile(new URL("../renderer/fleet-layout.js", import.meta.url), "utf8");
const source = await readFile(new URL("../renderer/fleet.js", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));
// What the page hands the host or the nav is copied out of the vm's realm, or strict deep equality sees other prototypes.
const plain = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

const T0 = Date.now() - 10 * 60 * 1000;
function world() {
  const state = model.emptyState();
  model.observeTasks(state, [{ id: "task_a", title: "Wire the fleet", status: "active" }, { id: "task_b", title: "Polish the board", status: "active" }], T0);
  const running = [
    { id: "run_1", taskId: "task_a", title: "Wire the fleet", startedAt: T0, phase: "building", currentStep: "Editing main.cjs", progress: 0.42, lastOutputAt: T0 + 60000 },
    { id: "run_2", taskId: "task_b", title: "Polish the board", startedAt: T0 + 1000, phase: "building", progress: 0.1 },
  ];
  model.observeStatus(state, { parallel: 3, loop: { state: "running", on: true, tone: "live", headline: "Agents are running", reason: "", ready: 2, running: 2 }, running }, T0 + 2000);
  model.observeEvent(state, { kind: "agent.out", at: T0 + 1000, runId: "run_1", taskId: "task_a", title: "Wire the fleet", model: "fable-5", text: "opencode" });
  model.observeEvent(state, { kind: "agent.out", at: T0 + 1500, runId: "run_2", taskId: "task_b", title: "Polish the board", model: "sonnet-5", text: "claude" });
  model.observeEvent(state, { kind: "help.ask", at: T0 + 3000, runId: "run_2", taskId: "task_b", text: "Which test owns this?" });
  return { state, running };
}
const context = { projectId: "project_1", projectName: "Mefi Studio", roster: [{ role: "foreman", status: "running", runs: 3 }], team: { executorCli: "opencode", executorModel: "fable-5" } };
const viewOf = (state, rev = 1, at = T0 + 5000) => ({ ...model.snapshot(state, { ...context, at }), rev });
const detailOf = (state) => (id) => model.seatDetail(state, id, { ...context, at: T0 + 5000 });

function load({ state = world().state, detail = true } = {}) {
  const { document, get } = createDom({ ids: templateIds((id) => id.startsWith("fleet-")) });
  get("fleet-overlay").hidden = true;
  const frames = [];
  const timeouts = [];
  const intervals = [];
  const armed = [];
  const listeners = {};
  const calls = { watch: [], snapshot: 0, seat: [], action: [], claim: [], release: [], go: [], toasts: [], tasks: [], loop: [] };
  const holder = { view: viewOf(state), push: null, delay: null };
  const window = {
    mefiStudio: {
      // holder.queue answers the next reads with the view (and the gate) each was given, in order.
      fleetSnapshot: async () => {
        calls.snapshot += 1;
        const next = holder.queue?.shift();
        if (next) { if (next.gate) await next.gate; if (next.error) throw next.error; return next.view; }
        if (holder.delay) await holder.delay;
        return holder.view;
      },
      fleetWatch: async (payload) => { calls.watch.push(plain(payload)); return { ok: true }; },
      fleetSeat: async (id) => { calls.seat.push(id); return detail ? detailOf(state)(id) : { ok: false }; },
      fleetAction: async (payload) => { calls.action.push(plain(payload)); return { ok: true }; },
      onFleetUpdate: (callback) => { holder.push = callback; },
      assistantControl: async (action) => { calls.loop.push(action); return { ok: true }; },
    },
    MefiNav: { claim: (id) => calls.claim.push(id), release: (id) => calls.release.push(id), go: (...args) => calls.go.push(plain(args)) },
    MefiUi: { plainError: (error, fallback) => String(error?.message || "") || fallback, arm: (button, options) => { armed.push({ button, options }); return button; } },
    MefiToast: (text, tone) => calls.toasts.push([text, tone]),
    MefiTasks: { open: (payload) => calls.tasks.push(plain(payload)) },
    addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); },
  };
  const sandbox = vm.createContext({
    window, document, console,
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => {},
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: () => {},
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: () => {},
  });
  vm.runInContext(layoutSource, sandbox);
  vm.runInContext(source, sandbox);
  const flush = async () => { await settle(); await settle(); while (frames.length) frames.shift()(); await settle(); };
  const opened = async (params) => { window.MefiFleet.open(params); await flush(); };
  const $ = (id) => get(`fleet-${id}`);
  return { window, document, get, $, frames, timeouts, intervals, armed, calls, holder, listeners, flush, opened, state, fleet: window.MefiFleet };
}
const rows = (h) => h.$("tree").children.map((row) => row.dataset.key);
const cardOf = (h, id) => h.$("graph").querySelectorAll(".fleet-seat").find((node) => node.dataset.seat === id);

test("opening the page claims it, asks for a snapshot, holds a watch lease and paints the team", async () => {
  const h = load();
  await h.opened();
  assert.deepEqual(h.calls.claim, ["fleet"]);
  assert.equal(h.$("overlay").hidden, false);
  assert.equal(h.calls.snapshot, 1);
  assert.deepEqual(h.calls.watch, [{ id: "fleet-view", on: true }]);
  assert.equal(h.intervals[0].ms, 30000, "the lease is renewed every 30 s");
  assert.deepEqual(rows(h), ["host", "team", "pod:lead", "seat:lead", "seat:foreman", "pod:build", "seat:builder-1", "seat:builder-2", "seat:builder-3", "pod:check", "seat:overseer", "seat:desk"]);
  assert.equal(h.$("status").textContent, "7 seats · 4 working · 0 need attention · 2 ready to take · Agents are running");
  assert.deepEqual(h.$("tabs").children.map((tab) => tab.dataset.tab), ["graph", "table", "recent", "nodes", "health"]);
  assert.equal(h.$("tabs").children.find((tab) => tab.dataset.tab === "graph").getAttribute("aria-selected"), "true");
  assert.equal(h.$("table").hidden, true, "only the open view shows");
  assert.equal(h.$("graph").hidden, false);
  assert.equal(h.$("tree").hidden, false, "the explorer is not one of the views");
  const builder = h.$("tree").children.find((row) => row.dataset.key === "seat:builder-1").children[0];
  assert.equal(builder.children[1].dataset.status, "working");
  assert.equal(builder.children[2].textContent, "builder-1");
  assert.equal(builder.children[3].textContent, "42%");
  assert.equal(builder.children[4].textContent, "g1");
});

test("closing releases the lease and the nav, and later pushes paint nothing", async () => {
  const h = load();
  await h.opened();
  h.fleet.close();
  assert.equal(h.$("overlay").hidden, true);
  assert.deepEqual(h.calls.release, ["fleet"]);
  assert.deepEqual(h.calls.watch.at(-1), { id: "fleet-view", on: false });
  const text = h.$("status").textContent;
  h.holder.push({ ...viewOf(h.state), counts: { seats: 99, working: 0, attention: 0, openRows: 0 } });
  await h.flush();
  assert.equal(h.frames.length, 0);
  assert.equal(h.$("status").textContent, text, "a closed page does not paint");
  h.fleet.close();
  assert.equal(h.calls.release.length, 1, "closing twice does nothing");
});

test("the graph has a card for every seat, a wire for every pair, and selecting a seat dims the rest", async () => {
  const h = load();
  await h.opened();
  const seats = h.$("graph").querySelectorAll(".fleet-seat").map((node) => node.dataset.seat);
  assert.deepEqual(seats.sort(), ["builder-1", "builder-2", "builder-3", "desk", "foreman", "lead", "overseer", "you"].filter((id) => id !== "you" || seats.includes("you")).sort());
  assert.equal(cardOf(h, "builder-1").dataset.status, "working");
  assert.equal(cardOf(h, "builder-2").dataset.status, "waiting", "it asked the desk");
  assert.equal(cardOf(h, "builder-3").dataset.status, "idle");
  assert.equal(cardOf(h, "builder-1").children[2].textContent, "Editing main.cjs");
  assert.match(cardOf(h, "builder-1").children[3].textContent, /opencode · fable-5 · g1/);
  assert.equal(cardOf(h, "builder-1").style.left !== undefined, true);
  const wires = h.$("graph").querySelectorAll(".fleet-wire");
  assert.ok(wires.length >= 3, "dispatch wires from the foreman and the desk question");
  assert.equal(h.$("graph").querySelector(".fleet-stage").dataset.focus, "0");
  h.$("graph").querySelectorAll(".fleet-seat").find((node) => node.dataset.seat === "builder-1").click();
  await h.flush();
  assert.equal(h.$("graph").querySelector(".fleet-stage").dataset.focus, "1");
  assert.equal(cardOf(h, "builder-1").dataset.selected, "true");
  assert.equal(cardOf(h, "builder-2").dataset.selected, "false");
  const touching = wires.filter((wire) => wire.getAttribute("data-touch") === "1").map((wire) => `${wire.getAttribute("data-from")}>${wire.getAttribute("data-to")}`);
  assert.deepEqual(touching, ["foreman>builder-1"]);
  assert.match(h.$("graph").querySelector(".fleet-zoom").textContent, /^\d+%$/);
});

test("selecting a seat fills the inspector from the snapshot, then from the host's detail", async () => {
  const h = load();
  await h.opened();
  assert.equal(h.$("inspector").dataset.mode, "fleet");
  assert.match(h.$("inspector").textContent, /Mefi Studio/);
  assert.match(h.$("inspector").textContent, /Select a seat/);
  h.$("tree").children.find((row) => row.dataset.key === "seat:builder-1").children[0].click();
  await h.flush();
  assert.equal(h.$("inspector").dataset.mode, "seat");
  assert.deepEqual(h.calls.seat, ["builder-1"]);
  const text = h.$("inspector").textContent;
  assert.match(text, /builder-1@mefi-studio/);
  assert.match(text, /Wire the fleet/);
  assert.match(text, /Editing main\.cjs/);
  assert.match(text, /g1/);
  assert.match(text, /Running/, "its first generation is the live one");
  assert.match(text, /to overseer|from foreman/, "the wires it is part of");
  assert.equal(h.$("tree").children.find((row) => row.dataset.key === "seat:builder-1").getAttribute("aria-selected"), "true");
  const away = h.$("inspector").querySelector(".fleet-ins-close");
  assert.equal(away.getAttribute("aria-label"), "Close this seat");
  away.click();
  await h.flush();
  assert.equal(h.fleet.current().selected, null, "the close button steps back to the whole fleet");
  assert.equal(h.$("inspector").dataset.mode, "fleet");
});

test("a push updates the cards, rows and inspector in place: same elements, no rebuild, one paint a frame", async () => {
  const h = load();
  await h.opened();
  h.fleet.select("builder-1");
  await h.flush();
  const card = cardOf(h, "builder-1");
  const row = h.$("tree").children.find((item) => item.dataset.key === "seat:builder-1");
  const inspector = h.$("inspector").children[0];
  const { state, running } = world();
  running[0].progress = 0.8;
  running[0].currentStep = "Running the tests";
  model.observeStatus(state, { parallel: 3, loop: { state: "running", on: true, tone: "live", headline: "Agents are running", reason: "", ready: 1, running: 2 }, running }, T0 + 6000);
  h.holder.push(viewOf(state, 2, T0 + 7000));
  h.holder.push(viewOf(state, 3, T0 + 7100));
  assert.equal(h.frames.length, 1, "two pushes in one frame paint once");
  await h.flush();
  assert.equal(cardOf(h, "builder-1"), card, "the card is the same element");
  assert.equal(card.children[2].textContent, "Running the tests");
  assert.equal(h.$("tree").children.find((item) => item.dataset.key === "seat:builder-1"), row);
  assert.equal(row.children[0].children[3].textContent, "80%");
  assert.equal(h.$("inspector").children[0], inspector, "the inspector is not rebuilt for a moving step");
  assert.match(h.$("inspector").textContent, /Running the tests/);
  assert.match(h.$("status").textContent, /1 ready to take/);
});

test("the table lists a row per seat, sorts on a header, selects on a click and stops a run through the shared two-step button", async () => {
  const h = load();
  await h.opened();
  h.fleet.select(null);
  h.$("tabs").children.find((tab) => tab.dataset.tab === "table").click();
  await h.flush();
  assert.equal(h.$("table").hidden, false);
  assert.equal(h.$("graph").hidden, true);
  const body = () => h.$("table").querySelector("tbody").children;
  const order = () => body().map((row) => row.dataset.key);
  assert.deepEqual(order(), ["builder-2", "builder-1", "desk", "foreman", "builder-3", "lead", "overseer"], "by state: waiting, then working, then idle, each by name");
  h.$("table").querySelectorAll(".fleet-sort").find((button) => button.textContent === "Seat").click();
  await h.flush();
  assert.deepEqual(order(), ["builder-1", "builder-2", "builder-3", "desk", "foreman", "lead", "overseer"]);
  assert.equal(h.$("table").querySelectorAll(".fleet-th").find((cell) => cell.dataset.col === "seat").getAttribute("aria-sort"), "ascending");
  h.$("table").querySelectorAll(".fleet-sort").find((button) => button.textContent === "Seat").click();
  await h.flush();
  assert.equal(order()[0], "overseer", "a second press reverses it");
  const first = body().find((row) => row.dataset.key === "builder-1");
  assert.equal(first.children[2].textContent, "opencode");
  assert.equal(first.children[3].textContent, "fable-5");
  assert.equal(first.children[5].children[1].textContent, "Working");
  assert.equal(first.children[6].textContent, "Editing main.cjs");
  assert.match(h.$("table").querySelector(".fleet-table-foot").textContent, /^7 seats · 4 working/);
  first.click();
  await h.flush();
  assert.equal(h.fleet.current().selected, "builder-1");
  const stop = first.children[8].children[1];
  assert.equal(stop.hidden, false);
  assert.equal(h.armed.length > 0, true, "Stop goes through MefiUi.arm");
  h.armed.find((entry) => entry.button === stop).options.run();
  await h.flush();
  assert.deepEqual(h.calls.action, [{ seatId: "builder-1", action: "stop", runId: "run_1" }], "the run that was on screen goes with the request");
  assert.match(h.calls.toasts.at(-1)[0], /builder-1 was told to stop/);
  assert.equal(body().find((row) => row.dataset.key === "builder-3").children[8].children[1].hidden, true, "an idle seat has nothing to stop");
});

test("recent lists what moved newest first, filters by kind and text, and a row selects its seat", async () => {
  const { state } = world();
  model.observeEvent(state, { kind: "mail", at: T0 + 4000, from: "overseer", to: "foreman", text: "two cards repeat work" });
  const h = load({ state });
  await h.opened({ tab: "recent" });
  const list = () => h.$("recent").querySelector(".fleet-recent-list").children;
  const texts = () => list().map((row) => row.children[2].textContent);
  assert.equal(h.$("recent").hidden, false);
  assert.equal(texts()[0], "overseer to foreman: two cards repeat work", "newest first");
  assert.match(texts().join("\n"), /builder-1 took "Wire the fleet"/);
  assert.match(texts().join("\n"), /builder-2 asked the desk: Which test owns this\?/);
  const chip = (group) => h.$("recent").querySelectorAll(".chip").find((item) => item.dataset.group === group);
  chip("asks").click();
  await h.flush();
  assert.equal(chip("asks").getAttribute("aria-pressed"), "true");
  assert.deepEqual(texts().map((text) => text.split(":")[0]), ["overseer to foreman", "builder-2 asked the desk"]);
  chip("asks").click();
  const search = h.$("recent").querySelector("input");
  search.value = "polish";
  await search.trigger("input");
  await h.flush();
  assert.deepEqual(texts(), ['builder-2 took "Polish the board"']);
  list()[0].click();
  await h.flush();
  assert.equal(h.fleet.current().selected, "builder-2");
  search.value = "zzz";
  await search.trigger("input");
  await h.flush();
  assert.equal(list().length, 0);
  assert.match(h.$("recent").querySelector(".fleet-empty").textContent, /No rows match/);
});

test("the tree tab draws project, pods, seats and their work, selects on a click and opens Command on the selected seat", async () => {
  const h = load();
  await h.opened({ tab: "nodes" });
  const nodes = () => h.$("nodes").querySelectorAll(".fleet-tnode");
  const ids = nodes().map((node) => node.dataset.node);
  assert.deepEqual(ids.slice(0, 3), ["project", "pod:lead", "pod:build"], "by depth, then by row");
  assert.ok(ids.includes("pod:build") && ids.includes("builder-1") && ids.includes("task:builder-1"));
  assert.equal(nodes().find((node) => node.dataset.node === "project").children[1].textContent, "Mefi Studio");
  assert.equal(nodes().find((node) => node.dataset.node === "task:builder-1").children[1].textContent, "Wire the fleet");
  assert.equal(h.$("nodes").querySelectorAll(".fleet-tree-link").length, ids.length - 1, "one link per node but the root");
  assert.equal(nodes().find((node) => node.dataset.node === "builder-1").children[0].dataset.status, "working");
  nodes().find((node) => node.dataset.node === "builder-2").click();
  await h.flush();
  assert.equal(h.fleet.current().selected, "builder-2");
  assert.equal(nodes().find((node) => node.dataset.node === "builder-2").getAttribute("aria-current"), "true");
  h.$("nodes").querySelector(".fleet-tree-command").click();
  assert.deepEqual(h.calls.go, [["command", { selected: "builder:task_b" }]], "Command's builder nodes are keyed by task");
  nodes().find((node) => node.dataset.node === "task:builder-1").click();
  assert.deepEqual(h.calls.tasks, [{ taskId: "task_a" }]);
});

test("health lists what needs a look with the rule behind it, and the loop card offers its one action", async () => {
  const { state, running } = world();
  model.observeStatus(state, { parallel: 3, loop: { state: "paused", on: false, tone: "held", headline: "Agents are paused", reason: "Paused from the tray", action: { id: "start", label: "Start agents" }, ready: 4, running: 2 }, running }, T0 + 6000);
  const h = load({ state });
  h.holder.view = viewOf(state, 1, T0 + 25 * 60 * 1000);
  await h.opened({ tab: "health" });
  const list = h.$("health").querySelector(".fleet-health-list").children;
  const summaries = list.map((item) => item.children[0].children[1].textContent);
  assert.ok(summaries.some((text) => /quiet for/.test(text)), summaries.join(" | "));
  assert.ok(summaries.some((text) => /waited .* for the desk/.test(text)));
  const quiet = list.find((item) => /quiet for/.test(item.children[0].children[1].textContent));
  assert.match(quiet.children[2].textContent, /No output, step or tool change from the worker in that time\. Rule: 10 min without output\./);
  assert.equal(quiet.children[0].children[0].textContent, "Look");
  assert.equal(h.$("tabs").children.find((tab) => tab.dataset.tab === "health").children[1].textContent, String(h.holder.view.counts.attention));
  const card = h.$("health").querySelector(".fleet-health-loop");
  assert.equal(card.hidden, false);
  assert.equal(card.children[0].textContent, "Agents are paused");
  assert.equal(card.children[1].textContent, "Paused from the tray");
  card.querySelector(".fleet-loop-action").click();
  await h.flush();
  assert.deepEqual(h.calls.loop, ["start-work"]);
  assert.match(h.calls.toasts.at(-1)[0], /Agents started/);
  quiet.children[3].click();
  await h.flush();
  assert.equal(h.fleet.current().selected, quiet.fleetSignal.seatId);
  assert.equal(h.fleet.current().tab, "graph", "Look shows the seat in the graph");
});

test("a project switch starts from a fresh snapshot, and a snapshot that a push overtook is dropped", async () => {
  const h = load();
  await h.opened();
  h.fleet.select("builder-1");
  await h.flush();
  const before = h.calls.snapshot;
  const other = { ...viewOf(world().state), projectId: "project_2", project: { name: "Other Game", slug: "other-game" } };
  h.holder.view = other;
  for (const fn of h.listeners["mefi:project-changed"]) fn({});
  assert.equal(h.fleet.current().selected, null);
  await h.flush();
  assert.equal(h.calls.snapshot, before + 1);
  assert.equal(h.fleet.current().projectId, "project_2");
  assert.equal(h.calls.watch.at(-1).on, true, "the lease is taken again for the new project");
  assert.equal(h.$("tree").children[1].children[0].children[2].textContent, "Other Game");
  // A read that is still in flight when a push lands is the older answer.
  let release;
  h.holder.delay = new Promise((resolve) => { release = resolve; });
  h.holder.view = { ...other, project: { name: "Stale", slug: "stale" }, rev: 1 };
  h.fleet.close();
  await h.opened();
  h.holder.push({ ...other, project: { name: "Fresh", slug: "fresh" }, rev: 9 });
  release();
  await h.flush();
  assert.equal(h.$("tree").children[1].children[0].children[2].textContent, "Fresh");
});

test("a hidden window is not painted; coming back reads the team again and renews the lease", async () => {
  const h = load();
  await h.opened();
  h.document.hidden = true;
  h.holder.push({ ...viewOf(h.state), counts: { seats: 42, working: 0, attention: 0, openRows: 0 } });
  await h.flush();
  assert.equal(h.frames.length, 0);
  assert.doesNotMatch(h.$("status").textContent, /^42 seats/);
  h.intervals[0].fn();
  assert.equal(h.calls.watch.filter((call) => call.on).length, 1, "no renewal while hidden");
  const reads = h.calls.snapshot;
  h.document.hidden = false;
  for (const fn of h.get("fleet-overlay").listeners?.visibilitychange ?? []) fn({});
  for (const fn of h.document.body?.listeners?.visibilitychange ?? []) fn({});
  await h.flush();
  assert.equal(h.calls.snapshot, reads + 1);
  assert.equal(h.calls.watch.filter((call) => call.on).length, 2);
  assert.match(h.$("status").textContent, /^7 seats/);
});

test("the explorer is a tree with one tab stop; arrows move, collapse and expand pods", async () => {
  const h = load();
  await h.opened();
  const stops = () => h.$("tree").children.filter((row) => row.children[0].tabIndex === 0).map((row) => row.dataset.key);
  assert.deepEqual(stops(), ["host"]);
  const press = (key, active) => { h.document.activeElement = active; const event = { key, prevented: false, preventDefault() { this.prevented = true; } }; for (const fn of h.$("tree").listeners.keydown) fn(event); return event; };
  const rowOf = (key) => h.$("tree").children.find((row) => row.dataset.key === key);
  const down = press("ArrowDown", rowOf("host").children[0]);
  assert.equal(down.prevented, true);
  assert.equal(rowOf("team").children[0].focused, true);
  press("End", rowOf("team").children[0]);
  assert.equal(rowOf("seat:desk").children[0].focused, true);
  press("ArrowLeft", rowOf("seat:desk").children[0]);
  assert.equal(rowOf("pod:check").children[0].focused, true, "Left on a seat goes to its pod");
  press("ArrowLeft", rowOf("pod:check").children[0]);
  await h.flush();
  assert.equal(rowOf("pod:check").getAttribute("aria-expanded"), "false");
  assert.equal(rowOf("seat:desk"), undefined, "a collapsed pod hides its seats");
  press("ArrowRight", rowOf("pod:check").children[0]);
  assert.equal(rowOf("pod:check").getAttribute("aria-expanded"), "true");
  assert.ok(rowOf("seat:desk"));
});

test("the graph moves with the keyboard, zooms, fits, pans by dragging and clears on an empty click", async () => {
  const h = load();
  await h.opened();
  const viewport = h.$("graph").querySelector(".fleet-viewport");
  const stage = h.$("graph").querySelector(".fleet-stage");
  const event = (extra = {}) => ({ prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, target: viewport, ...extra });
  const send = (name, extra) => { const e = event(extra); for (const fn of viewport.listeners[name] ?? []) fn(e); return e; };
  const camera = () => /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(stage.style.transform).slice(1).map(Number);
  const [x0, y0, k0] = camera();
  assert.ok(k0 > 0.3 && k0 <= 1.25, "the team is fitted on entry");
  assert.equal(send("keydown", { key: "ArrowDown" }).prevented, true);
  await h.flush();
  assert.equal(h.fleet.current().selected, "lead", "the first arrow selects the first seat");
  send("keydown", { key: "ArrowDown" });
  assert.equal(h.fleet.current().selected, "foreman");
  send("keydown", { key: "ArrowRight" });
  assert.equal(h.fleet.current().selected, "builder-2", "right goes to the seat at the closest height");
  send("keydown", { key: "ArrowUp" });
  assert.equal(h.fleet.current().selected, "builder-1");
  await h.flush();
  send("keydown", { key: "+" });
  assert.ok(camera()[2] > k0, "plus zooms in");
  send("keydown", { key: "-" });
  send("keydown", { key: "-" });
  assert.ok(camera()[2] < k0, "minus zooms out");
  send("keydown", { key: "0" });
  assert.deepEqual(camera(), [x0, y0, k0], "zero fits the team again");
  send("wheel", { ctrlKey: true, deltaY: -300, clientX: 200, clientY: 100 });
  assert.ok(camera()[2] > k0, "ctrl and the wheel zoom");
  send("wheel", { deltaX: 0, deltaY: 40 });
  const panned = camera();
  send("keydown", { key: "0" });
  assert.notDeepEqual(panned, camera());
  const at = camera();
  send("pointerdown", { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  send("pointermove", { clientX: 130, clientY: 120 });
  send("pointerup", {});
  const after = camera();
  assert.equal(after[0] - at[0], 30);
  assert.equal(after[1] - at[1], 20);
  assert.equal(h.fleet.current().selected, "builder-1", "a drag does not clear the selection");
  send("pointerdown", { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
  send("pointerup", {});
  assert.equal(h.fleet.current().selected, null, "a plain click on empty space does");
  h.fleet.select("desk");
  const pressed = (extra) => { const e = event(extra); for (const fn of h.listeners.keydown ?? []) fn(e); return e; };
  const menu = h.document.createElement("div");
  assert.equal(pressed({ key: "Escape", target: menu }).prevented, false, "a key aimed at something outside the page (a menu above it) is left alone");
  assert.equal(h.fleet.current().selected, "desk");
  const escape = pressed({ key: "Escape", target: h.document.body });
  assert.equal(escape.prevented, true, "Escape clears the selection even when nothing has the focus");
  assert.equal(h.fleet.current().selected, null);
  assert.equal(pressed({ key: "Escape", target: h.document.body }).prevented, false, "with nothing selected Escape is left to close the page");
});

// ---- what the review of the first version found ------------------------------------------------------
const LOOP = { state: "running", on: true, tone: "live", headline: "Agents are running", reason: "", ready: 2, running: 2 };
const runTimers = async (h) => { for (const timer of h.timeouts.splice(0)) timer.fn(); await h.flush(); };
const keyOn = (h, key, extra = {}) => { const event = { key, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra }; for (const fn of h.listeners.keydown ?? []) fn(event); return event; };
const buttonsOf = (node) => node.querySelectorAll("button");
const ended = () => {
  const built = world();
  model.observeEvent(built.state, { kind: "agent.home", at: T0 + 9000, runId: "run_1", taskId: "task_a", title: "Wire the fleet", ok: true });
  model.observeStatus(built.state, { parallel: 3, loop: LOOP, running: [built.running[1]] }, T0 + 9100);
  return built.state;
};

test("a push that changes nothing about the selected seat neither reads its runs again nor rebuilds its inspector", async () => {
  const h = load();
  await h.opened();
  h.fleet.select("builder-1");
  await h.flush();
  assert.deepEqual(h.calls.seat, ["builder-1"]);
  const inspector = h.$("inspector").children[0];
  for (let rev = 2; rev <= 5; rev += 1) {
    const { state, running } = world();
    running[0].progress = 0.4 + rev / 20;
    running[0].currentStep = `Step ${rev}`;
    model.observeStatus(state, { parallel: 3, loop: LOOP, running }, T0 + 6000 + rev);
    h.holder.push(viewOf(state, rev, T0 + 7000 + rev * 100));
    await h.flush();
    await runTimers(h);
  }
  assert.deepEqual(h.calls.seat, ["builder-1"], "progress and output moving are not a reason to read the runs again");
  assert.equal(h.$("inspector").children[0], inspector, "the same inspector: a Stop armed in it is not destroyed under the pointer");
  assert.match(h.$("inspector").textContent, /Step 5/);
  const state = ended();
  h.holder.push(viewOf(state, 6, T0 + 9200));
  await h.flush();
  await runTimers(h);
  assert.deepEqual(h.calls.seat, ["builder-1", "builder-1"], "the run ending is read once");
  assert.notEqual(h.$("inspector").children[0], inspector, "and the inspector is drawn again for it");
});

test("an idle seat that has worked offers its last task and its orb, from the inspector, the table and the tree", async () => {
  const state = ended();
  const h = load({ state });
  h.holder.view = viewOf(state, 2, T0 + 9200);
  await h.opened({ seatId: "builder-1" });
  assert.equal(h.fleet.current().selected, "builder-1", "the page opened on that seat");
  await runTimers(h);
  assert.deepEqual(h.calls.seat, ["builder-1"], "its runs are read even though nobody clicked it");
  assert.doesNotMatch(h.$("inspector").textContent, /Reading its runs/);
  buttonsOf(h.$("inspector")).find((button) => button.textContent === "Open task").click();
  assert.deepEqual(h.calls.tasks, [{ taskId: "task_a" }]);
  buttonsOf(h.$("inspector")).find((button) => button.textContent === "Open in Command").click();
  assert.deepEqual(h.calls.go.at(-1), ["command", { selected: "builder:task_a" }]);
  h.fleet.select(null);
  h.$("tabs").children.find((tab) => tab.dataset.tab === "table").click();
  await h.flush();
  const row = h.$("table").querySelector("tbody").children.find((item) => item.dataset.key === "builder-1");
  assert.equal(row.children[8].children[0].hidden, false, "the table offers Open for a seat that is between runs");
  assert.equal(row.children[8].children[1].hidden, true, "and no Stop");
  row.children[8].children[0].click();
  assert.deepEqual(h.calls.tasks.at(-1), { taskId: "task_a" });
  h.$("tabs").children.find((tab) => tab.dataset.tab === "nodes").click();
  await h.flush();
  h.$("nodes").querySelectorAll(".fleet-tnode").find((node) => node.dataset.node === "task:builder-1").click();
  assert.deepEqual(h.calls.tasks.at(-1), { taskId: "task_a" }, "the tree's task node opens it too");
});

test("a click on a table row's own Open or Stop is not a click on the row", async () => {
  const h = load();
  await h.opened({ tab: "table" });
  const row = h.$("table").querySelector("tbody").children.find((item) => item.dataset.key === "builder-1");
  await row.click({ target: row.children[8].children[1] });
  await row.click({ target: row.children[8].children[0] });
  assert.equal(h.fleet.current().selected, null, "the drawer would slide over the button being pressed");
  await row.click({ target: row.children[1].children[0] });
  assert.equal(h.fleet.current().selected, "builder-1", "the seat's name and the rest of the row still select it");
  const cells = h.$("table").querySelectorAll(".fleet-th");
  assert.equal(cells.find((cell) => cell.dataset.col === "runtime").getAttribute("aria-sort"), null, "only sortable headers carry aria-sort");
  assert.match(cells.find((cell) => cell.dataset.col === "actions").textContent, /Actions/, "the last column has a name");
});

test("every lease renewal reads the team again, so what the clock decides shows on a fleet that has gone quiet", async () => {
  const h = load();
  await h.opened();
  assert.match(h.$("status").textContent, /^7 seats · 4 working · 0 need attention/);
  const reads = h.calls.snapshot;
  h.holder.view = viewOf(h.state, 1, T0 + 25 * 60 * 1000);
  h.intervals[0].fn();
  await h.flush();
  assert.equal(h.calls.snapshot, reads + 1, "the tick reads, not only renews");
  assert.equal(h.calls.watch.filter((call) => call.on).length, 2);
  assert.match(h.$("status").textContent, /[1-9][0-9]* need attention/, "the quiet run and the waiting ask are found with no push");
});

test("switching project locks the old team at once, and an answer meant for it never lands", async () => {
  const h = load();
  await h.opened();
  h.fleet.select("builder-1");
  await h.flush();
  const old = h.holder.view;
  const fresh = { ...viewOf(world().state, 1), projectId: "project_2", project: { name: "Other Game", slug: "other-game" } };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  h.holder.queue = [{ view: old, gate }, { view: fresh }];
  h.intervals[0].fn();
  for (const fn of h.listeners["mefi:project-changed"]) fn({});
  for (const part of ["side", "panels", "inspector"]) assert.equal(h.$(part).inert, true, `${part} cannot be reached while the new team is read`);
  assert.equal(h.$("body").dataset.loading, "1");
  assert.equal(h.$("status").textContent, "Reading the team…");
  await h.flush();
  assert.equal(h.fleet.current().projectId, "project_2");
  for (const part of ["side", "panels", "inspector"]) assert.equal(h.$(part).inert, false);
  assert.equal(h.$("body").dataset.loading, "0");
  release();
  await h.flush();
  assert.equal(h.fleet.current().projectId, "project_2", "the read that was asked for before the switch is dropped");
  assert.equal(h.$("tree").children[1].children[0].children[2].textContent, "Other Game");
});

test("an error line is replaced by the next good snapshot even when the counts did not change", async () => {
  const h = load();
  await h.opened();
  const good = h.$("status").textContent;
  h.holder.push({ ok: false, error: "The fleet could not be read." });
  assert.equal(h.$("status").textContent, "Last confirmed team. The fleet could not be read.");
  h.holder.push(viewOf(h.state, 2));
  await h.flush();
  assert.equal(h.$("status").textContent, good);
});

const deferred = () => { let release; const gate = new Promise(resolve => { release = resolve; }); return { gate, release }; };
const switchProject = (h, projectId) => { for (const fn of h.listeners["mefi:project-changed"]) fn({ detail: { projectId } }); };
const assertEmptyTeam = (h) => {
  for (const id of ["tree", "graph", "table", "recent", "nodes", "health", "inspector"]) assert.equal(h.$(id).children.length, 0, `${id} holds no previous project's content`);
  for (const id of ["side", "panels", "inspector"]) assert.equal(h.$(id).inert, true, `${id} stays unavailable without a confirmed team`);
  assert.equal(h.$("inspector").dataset.mode, "fleet");
  assert.equal(h.fleet.current().selected, null);
  assert.deepEqual(h.calls.action, [], "read failure starts no agent action");
};

test("a failed new-project read clears the old team for rejected and unsuccessful replies", async t => {
  for (const kind of ["rejected", "unsuccessful"]) await t.test(kind, async () => {
    const h = load(); await h.opened(); h.fleet.select("builder-1"); await h.flush();
    assert.match(h.$("inspector").textContent, /Wire the fleet/);
    const pending = deferred();
    h.holder.queue = [{ gate: pending.gate, ...(kind === "rejected" ? { error: new Error("New project read failed") } : { view: { ok: false, error: "New project read failed" } }) }];
    switchProject(h, "project_2");
    assertEmptyTeam(h);
    pending.release(); await h.flush();
    assertEmptyTeam(h);
    assert.equal(h.fleet.current().projectId, null);
    assert.equal(h.$("body").dataset.readState, "unavailable");
    assert.equal(h.$("status").textContent, "New project read failed");
    h.holder.push(viewOf(h.state, 9)); await h.flush();
    assertEmptyTeam(h);
    assert.equal(h.$("status").textContent, "New project read failed", "a late old-project push cannot recover the new project");
    h.holder.push({ ...viewOf(h.state, 1), projectId: "project_2", project: { name: "Other Game", slug: "other" } }); await h.flush();
    assert.equal(h.fleet.current().projectId, "project_2");
    assert.equal(h.$("body").dataset.readState, "ready");
    assert.match(h.$("tree").textContent, /Other Game/);
    for (const id of ["side", "panels", "inspector"]) assert.equal(h.$(id).inert, false);
  });
});

test("same-project cached facts remain labelled through selection, tabs and hide/show until an equal-revision recovery", async () => {
  const h = load(); await h.opened();
  const card = cardOf(h, "builder-1"), good = h.$("status").textContent;
  h.holder.view = { ok: false, error: "Snapshot temporarily unavailable" };
  h.holder.push(h.holder.view);
  h.fleet.select("builder-1"); await h.flush();
  assert.equal(cardOf(h, "builder-1"), card, "the confirmed snapshot is retained in place");
  assert.equal(h.$("body").dataset.readState, "cached");
  assert.equal(h.$("status").textContent, "Last confirmed team. Snapshot temporarily unavailable");
  h.$("tabs").children.find(tab => tab.dataset.tab === "table").click(); await h.flush();
  assert.match(h.$("status").textContent, /^Last confirmed team\./);
  h.document.hidden = true; h.fleet.select(null); await h.flush();
  h.document.hidden = false;
  for (const fn of h.document.body.listeners.visibilitychange) fn({});
  await h.flush();
  assert.equal(h.$("status").textContent, "Last confirmed team. Snapshot temporarily unavailable");
  h.holder.push(viewOf(h.state, 1)); await h.flush();
  assert.equal(h.$("status").textContent, good, "same revision and unchanged counts still confirm recovery");
  assert.equal(h.$("body").dataset.readState, "ready");
});

test("an older successful read cannot erase the latest requested read's failure", async () => {
  const h = load(); await h.opened(); const old = deferred(), fresh = deferred();
  h.holder.queue = [{ gate: old.gate, view: viewOf(h.state, 20) }, { gate: fresh.gate, view: { ok: false, error: "Latest read failed" } }];
  h.intervals[0].fn(); h.intervals[0].fn();
  fresh.release(); await h.flush();
  old.release(); await h.flush();
  assert.equal(h.$("status").textContent, "Last confirmed team. Latest read failed");
  assert.equal(h.$("body").dataset.readState, "cached");
});

test("an older rejected read cannot overwrite the latest requested read's success", async () => {
  const h = load(); await h.opened(); const old = deferred(), fresh = deferred();
  const next = { ...viewOf(h.state, 3), counts: { seats: 7, working: 2, attention: 0, openRows: 5 } };
  h.holder.queue = [{ gate: old.gate, error: new Error("Old read failed") }, { gate: fresh.gate, view: next }];
  h.intervals[0].fn(); h.intervals[0].fn();
  fresh.release(); await h.flush(); old.release(); await h.flush();
  assert.match(h.$("status").textContent, /2 working.*5 ready to take/);
  assert.doesNotMatch(h.$("status").textContent, /failed|Last confirmed/);
  assert.equal(h.$("body").dataset.readState, "ready");
});

test("push outcomes supersede pending reads without old revisions claiming recovery", async t => {
  for (const kind of ["success", "failure"]) await t.test(kind, async () => {
    const h = load(); await h.opened(); const old = deferred();
    h.holder.queue = [{ gate: old.gate, ...(kind === "success" ? { error: new Error("Older failure") } : { view: viewOf(h.state, 20) }) }];
    h.intervals[0].fn();
    h.holder.push(kind === "success" ? { ...viewOf(h.state, 5), counts: { seats: 8, working: 2, attention: 0, openRows: 1 } } : { ok: false, error: "Newest push failed" });
    await h.flush(); old.release(); await h.flush();
    if (kind === "success") { assert.match(h.$("status").textContent, /^8 seats/); assert.equal(h.$("body").dataset.readState, "ready"); }
    else {
      assert.equal(h.$("status").textContent, "Last confirmed team. Newest push failed");
      h.holder.push(viewOf(h.state, 0)); await h.flush();
      assert.equal(h.$("body").dataset.readState, "cached", "an older revision is not successful recovery");
    }
  });
});

test("late prior-project success and rejection cannot replace the failed new project's state", async t => {
  for (const kind of ["success", "rejection"]) await t.test(kind, async () => {
    const h = load(); await h.opened(); const old = deferred();
    h.holder.queue = [{ gate: old.gate, ...(kind === "success" ? { view: viewOf(h.state, 8) } : { error: new Error("Old project rejected") }) }, { view: { ok: false, error: "New project unavailable" } }];
    h.intervals[0].fn(); switchProject(h, "project_2"); await h.flush();
    old.release(); await h.flush(); assertEmptyTeam(h);
    assert.equal(h.$("status").textContent, "New project unavailable");
  });
});

test("a known scope rejects a foreign snapshot and a project with no selection never borrows a team", async () => {
  const h = load(); h.window.MefiWorkspace = { activeProjectId: () => "project_2" };
  await h.opened(); assertEmptyTeam(h);
  assert.match(h.$("status").textContent, /could not be confirmed/);
  h.holder.push(viewOf(h.state, 9)); await h.flush(); assertEmptyTeam(h);
  h.window.MefiWorkspace.activeProjectId = () => null;
  switchProject(h, null); await h.flush(); assertEmptyTeam(h);
  assert.equal(h.fleet.current().projectId, null);
});

test("no selection accepts the host's empty project_none scope but an open project rejects it", async () => {
  const h = load(); h.window.MefiWorkspace = { activeProjectId: () => null };
  h.holder.view = { ...viewOf(h.state, 1), projectId: "project_none" };
  await h.opened();
  assert.equal(h.$("body").dataset.readState, "ready");
  assert.ok(h.$("graph").children.length > 0);
  assert.equal(h.$("panels").inert, false);
  h.window.MefiWorkspace.activeProjectId = () => "project_2";
  switchProject(h, "project_2"); await h.flush(); assertEmptyTeam(h);
  assert.match(h.$("status").textContent, /could not be confirmed/);
});

test("rows that stay are left attached when others come and go, and a reorder hands the focus back", async () => {
  const h = load();
  await h.opened();
  const tree = h.$("tree");
  const rowOf = (key) => tree.children.find((row) => row.dataset.key === key);
  const blurring = (host, counter) => {
    const original = host.replaceChildren.bind(host);
    host.replaceChildren = (...nodes) => { counter.n += 1; h.document.activeElement = null; return original(...nodes); };
  };
  const rebuilt = { n: 0 };
  blurring(tree, rebuilt);
  const pod = rowOf("pod:check").children[0];
  h.document.activeElement = pod;
  for (const fn of tree.listeners.keydown) fn({ key: "ArrowLeft", preventDefault() {} });
  await h.flush();
  assert.equal(rowOf("seat:desk"), undefined, "the pod collapsed");
  assert.equal(rebuilt.n, 0, "removing rows does not detach the rows that stay, so the focus stays on the pod");
  assert.equal(h.document.activeElement, pod);
  for (const fn of tree.listeners.keydown) fn({ key: "ArrowRight", preventDefault() {} });
  await h.flush();
  assert.ok(rowOf("seat:desk"), "and adding rows does not either");
  assert.equal(rebuilt.n, 0);
  h.fleet.select(null);
  h.$("tabs").children.find((tab) => tab.dataset.tab === "table").click();
  await h.flush();
  const body = h.$("table").querySelector("tbody");
  const reordered = { n: 0 };
  blurring(body, reordered);
  const name = body.children.find((row) => row.dataset.key === "builder-1").children[1].children[0];
  name.focused = false;
  h.document.activeElement = name;
  h.$("table").querySelectorAll(".fleet-sort").find((button) => button.textContent === "Seat").click();
  await h.flush();
  assert.equal(reordered.n, 1, "a new order does need the rows moved");
  assert.equal(name.focused, true, "and the browser's blur is undone: the focus goes back to the row it was on");
});

test("rebuilding the graph gives the focus back to the seat that had it", async () => {
  const h = load();
  await h.opened();
  const before = cardOf(h, "builder-1");
  h.document.activeElement = before;
  before.focused = false;
  const view = viewOf(world().state, 2);
  view.edges = [...view.edges, { from: "builder-3", to: "desk", kind: "mail", count: 1, lastAt: T0 }];
  h.holder.push(view);
  await h.flush();
  const after = cardOf(h, "builder-1");
  assert.notEqual(after, before, "a new wire changed the picture, so the cards were made again");
  assert.equal(after.focused, true, "the keyboard is still on builder-1");
});

test("closing the inspector gives the focus back to the seat, and an armed Stop keeps its own Escape", async () => {
  const h = load();
  await h.opened();
  h.fleet.select("builder-1");
  await h.flush();
  cardOf(h, "builder-1").focused = false;
  h.$("inspector").querySelector(".fleet-ins-close").click();
  await h.flush();
  assert.equal(h.fleet.current().selected, null);
  assert.equal(cardOf(h, "builder-1").focused, true, "the close button hands the keyboard back to the seat's card");
  h.fleet.select("builder-2");
  await h.flush();
  cardOf(h, "builder-2").focused = false;
  const escape = keyOn(h, "Escape", { target: h.document.body });
  assert.equal(escape.prevented, true);
  assert.equal(h.fleet.current().selected, null);
  assert.equal(cardOf(h, "builder-2").focused, true, "so does Escape when the focus was lost with the inspector");
  h.fleet.select("builder-1");
  await h.flush();
  const stop = buttonsOf(h.$("inspector")).find((button) => button.textContent === "Stop this run");
  stop.classList.add("danger-armed");
  const armed = keyOn(h, "Escape", { target: stop });
  assert.equal(armed.prevented, false, "Escape on an armed Stop only disarms it: the seat stays selected");
  assert.equal(h.fleet.current().selected, "builder-1");
});

test("the recent feed has one tab stop and the arrow keys walk its rows", async () => {
  const h = load();
  await h.opened({ tab: "recent" });
  const list = h.$("recent").querySelector(".fleet-recent-list");
  const picks = () => list.children.map((row) => row.children[2]);
  assert.ok(picks().length >= 3);
  assert.match(String(picks()[0].tagName), /button/i, "a row's text is a button, so a keyboard reaches it");
  assert.deepEqual(picks().map((pick) => pick.tabIndex), picks().map((_, index) => (index === 0 ? 0 : -1)));
  h.document.activeElement = picks()[0];
  const down = { key: "ArrowDown", prevented: false, preventDefault() { this.prevented = true; } };
  for (const fn of list.listeners.keydown) fn(down);
  assert.equal(down.prevented, true);
  assert.equal(picks()[1].focused, true);
  assert.equal(picks()[1].tabIndex, 0);
  assert.equal(picks()[0].tabIndex, -1);
  h.document.activeElement = picks()[1];
  for (const fn of list.listeners.keydown) fn({ key: "End", preventDefault() {} });
  assert.equal(picks().at(-1).focused, true);
});

test("an action that names a run is refused for a seat that moved on, so Stop never lands on the wrong run", async () => {
  const h = load();
  await h.opened();
  h.fleet.select("builder-1");
  await h.flush();
  h.window.mefiStudio.fleetAction = async (payload) => { h.calls.action.push(plain(payload)); return { ok: false, error: "That seat has moved on to another run. Look again before stopping it." }; };
  h.armed.find((entry) => entry.button.textContent === "Stop this run").options.run();
  await h.flush();
  assert.deepEqual(h.calls.action.at(-1), { seatId: "builder-1", action: "stop", runId: "run_1" });
  assert.match(h.calls.toasts.at(-1)[0], /moved on to another run/);
  assert.equal(h.calls.toasts.at(-1)[1], "bad");
});

test("the stylesheet opens the drawer only for a selected seat and holds no colour of its own", async () => {
  const css = await readFile(new URL("../renderer/fleet.css", import.meta.url), "utf8");
  assert.match(css, /\.fleet-inspector:not\(\[data-mode="seat"\]\)\s*\{\s*display: none/, "before the first read, or after a failed one, no empty drawer covers the graph");
  assert.doesNotMatch(css, /(?<![a-z])(rgba?|hsla?)\(|#[0-9a-f]{3,8}\b/i, "every colour comes from a theme token");
  for (const rule of [".fleet-ins-text", ".fleet-signal-summary", ".fleet-signal-reason"]) {
    const line = css.split("\n").find((text) => text.startsWith(rule));
    assert.match(line, /overflow-wrap: anywhere/, `${rule} wraps a long word instead of widening the column`);
  }
});
