import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Assistant pushes arrive up to four times a second. While Command is closed
// its HUD (chat log, Ask cards) is hidden, so the pushes must not rebuild it;
// entering Command paints both. Agents' queue event goes out only on a change.

const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const agents = await readFile(new URL("../renderer/agents.js", import.meta.url), "utf8");
const between = (source, from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `markers ${from} … ${to}`);
  return source.slice(start, end);
};

test("the chat log is painted only while Command is open", () => {
  let painted = 0;
  const state = { active: false };
  const context = vm.createContext({ state, renderChatLog: () => { painted += 1; }, console });
  vm.runInContext(`${between(idle, "  function paintChatLog(", "  function applyChatLogOpen(")}\nthis.paintChatLog = paintChatLog;`, context);
  context.paintChatLog();
  assert.equal(painted, 0);
  state.active = true;
  context.paintChatLog();
  assert.equal(painted, 1);
});

test("the Ask cards are left alone while Command is closed", () => {
  const touched = [];
  const askList = new Proxy({}, { get: (_, key) => { touched.push(key); return () => []; } });
  const context = vm.createContext({ state: { active: false }, el: { askList } });
  vm.runInContext(`${between(idle, "  function renderAsks(", "  function askCard(")}\nthis.renderAsks = renderAsks;`, context);
  context.renderAsks({ questions: [{ id: "q1", status: "open", title: "Pick one" }] });
  assert.deepEqual(touched, []);
});

test("entering Command paints the chat log and an open Ask tab", () => {
  const enter = between(idle, "  function enter(force = false", "  function exit(");
  assert.match(enter, /\n\s+paintChatLog\(\);/);
  assert.match(enter, /state\.railTab === "ask"[^\n]*renderAsks\(\)/);
  assert.ok(enter.indexOf("state.active = true") < enter.indexOf("paintChatLog();"), "paints after Command is marked open");
});

test("the queue settings event goes out only when the settings change", () => {
  const events = [];
  const context = vm.createContext({
    window: { dispatchEvent: (event) => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    paintOverview() {},
  });
  const queue = between(agents, "  const queue = {", "  async function refreshQueue(");
  vm.runInContext(`${queue}\nthis.adoptQueue = adoptQueue; this.version = () => queueVersion;`, context);
  const status = { enabled: true, autoBuild: true, parallel: 2, adaptiveParallel: false, mode: "swarm" };
  const full = { status: "idle", prefs: { proactive: true } };
  context.adoptQueue(status, full);
  context.adoptQueue(status, full);
  context.adoptQueue(null, full);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "mefi:queue-settings");
  assert.equal(events[0].detail.parallel, 2);
  assert.equal(context.version(), 3, "every push still invalidates an in-flight read");
  context.adoptQueue({ ...status, parallel: 3 }, full);
  assert.equal(events.length, 2);
  assert.equal(events[1].detail.parallel, 3);
});
