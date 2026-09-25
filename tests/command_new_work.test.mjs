import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const controlSource = source.slice(source.indexOf("  async function assistantControl("), source.indexOf("  function onAssistantEvent("));

function element() {
  return { attrs: {}, setAttribute(name, value) { this.attrs[name] = String(value); } };
}

function environment({ full = { status: "paused" }, assistant = { execute: true }, control } = {}) {
  const el = Object.fromEntries(["chatLogNewWork", "chatPause", "chatLogNewWorkState", "chatNewWorkState"].map((key) => [key, element()]));
  const state = { assistant, newWorkBusy: false, active: false };
  const messages = [], calls = [], events = [];
  let backlogReads = 0;
  const context = vm.createContext({
    el, state,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: {
      dispatchEvent: (event) => events.push(event),
      mefiStudio: control ? { assistantControl: (action) => { calls.push(action); return control(action); } } : {},
      MefiTree: { applyAssistant: (payload) => { full = payload.state; } },
      MefiToast: (...args) => messages.push(args),
    },
    assistantFull: () => full,
    refreshAssistantCache() {}, updateAssistantPill() {}, renderInfo() {}, renderFeed() {}, paintChatLog() {},
    refreshCommandBacklog: async () => { backlogReads += 1; },
  });
  vm.runInContext(`${controlSource}\nthis.api = { changeNewWork, renderNewWorkControl };`, context);
  return { ...context.api, state, el, messages, calls, events, pushFull: (value) => { full = value; }, backlogReads: () => backlogReads };
}

test("New work reflects both service pause and executor preference without dispatching during render", () => {
  const env = environment({ control: async () => { throw new Error("Render must not send an action"); } });
  const inputs = [env.el.chatLogNewWork, env.el.chatPause];
  env.renderNewWorkControl();
  for (const input of inputs) { assert.equal(input.checked, false); assert.equal(input.disabled, false); }
  env.pushFull({ status: "idle" });
  env.renderNewWorkControl();
  for (const input of inputs) assert.equal(input.checked, true);
  env.state.assistant.execute = false;
  env.renderNewWorkControl();
  for (const input of inputs) assert.equal(input.checked, false);
  assert.equal(env.el.chatLogNewWorkState.textContent, "Off");
  assert.deepEqual(env.calls, []);
});

test("New work stays unavailable until both host states load and requires the desktop bridge", async () => {
  for (const values of [{ full: null }, { assistant: null }, { full: {} }, { assistant: {} }]) {
    const env = environment({ ...values, control: async () => ({ ok: true }) });
    env.renderNewWorkControl();
    for (const input of [env.el.chatLogNewWork, env.el.chatPause]) {
      assert.equal(input.checked, false);
      assert.equal(input.disabled, true);
      assert.equal(input.indeterminate, true);
    }
    assert.equal(await env.changeNewWork(true), false);
    assert.deepEqual(env.calls, []);
  }
  const browser = environment();
  browser.renderNewWorkControl();
  assert.equal(browser.el.chatLogNewWork.disabled, true);
  assert.equal(browser.el.chatLogNewWorkState.textContent, "Desktop only");
  assert.equal(await browser.changeNewWork(true), false);
});

test("New work serializes both switches and applies the confirmed service and worker status", async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const env = environment({ assistant: { execute: false, running: [{ taskId: "finishing" }] }, control: () => pending });
  env.el.chatLogNewWork.checked = true;
  const saving = env.changeNewWork(true);
  for (const input of [env.el.chatLogNewWork, env.el.chatPause]) {
    assert.equal(input.checked, false, "the last confirmed value remains visible while saving");
    assert.equal(input.disabled, true);
    assert.equal(input.attrs["aria-busy"], "true");
  }
  assert.equal(env.el.chatLogNewWorkState.textContent, "Saving…");
  assert.equal(await env.changeNewWork(true), false);
  assert.equal(await env.changeNewWork(false), false);
  assert.deepEqual(env.calls, ["start-work"]);
  finish({ ok: true, state: { status: "idle" }, autopilot: { execute: true } });
  assert.equal(await saving, true);
  for (const input of [env.el.chatLogNewWork, env.el.chatPause]) {
    assert.equal(input.checked, true);
    assert.equal(input.disabled, false);
    assert.equal(input.attrs["aria-busy"], "false");
  }
  assert.equal(env.el.chatNewWorkState.textContent, "On");
  assert.equal(env.state.assistant.running[0].taskId, "finishing");
  assert.equal(env.backlogReads(), 1);
});

test("Turning New work off pauses scheduling while retaining the running job and execute preference", async () => {
  const job = { taskId: "already-running" };
  const env = environment({ full: { status: "idle" }, assistant: { execute: true, running: [job] }, control: async () => ({ ok: true, state: { status: "paused" } }) });
  assert.equal(await env.changeNewWork(false), true);
  assert.deepEqual(env.calls, ["pause"]);
  assert.equal(env.el.chatLogNewWork.checked, false);
  assert.equal(env.el.chatPause.checked, false);
  assert.equal(env.state.assistant.execute, true);
  assert.equal(env.state.assistant.running[0], job);
  assert.match(env.messages.at(-1)[0], /current jobs can finish/);
  assert.equal(await env.changeNewWork(false), false, "an unchanged setting sends no second action");
});

test("Rejected or interrupted New work saves restore both switches to the last confirmed state", async () => {
  for (const control of [async () => ({ ok: false, error: "Cannot save" }), async () => { throw new Error("Connection interrupted"); }]) {
    const env = environment({ control });
    env.el.chatLogNewWork.checked = true;
    assert.equal(await env.changeNewWork(true), false);
    for (const input of [env.el.chatLogNewWork, env.el.chatPause]) {
      assert.equal(input.checked, false);
      assert.equal(input.disabled, false);
    }
    assert.equal(env.state.newWorkBusy, false);
    assert.match(env.messages.at(-1)[0], /new work failed/);
    assert.equal(env.backlogReads(), 0);
  }
});

test("A failed save retains a newer pushed state instead of reverting an already confirmed change", async () => {
  let finish;
  const env = environment({ control: () => new Promise((resolve) => { finish = resolve; }) });
  const saving = env.changeNewWork(true);
  env.pushFull({ status: "idle" });
  env.state.assistant = { execute: true };
  finish({ ok: false, error: "Acknowledgement lost" });
  assert.equal(await saving, false);
  assert.equal(env.el.chatLogNewWork.checked, true);
  assert.equal(env.el.chatPause.checked, true);
  assert.equal(env.el.chatNewWorkState.textContent, "On");
});


test("service-only pause pushes publish confirmed Settings snapshots once per change", () => {
  const env = environment({ full: { status: "idle" }, assistant: { enabled: true, execute: true }, control: async () => ({ ok: true }) });
  env.renderNewWorkControl();
  assert.equal(env.events.at(-1).detail.newWork, true);
  const count = env.events.length;
  env.renderNewWorkControl();
  env.renderNewWorkControl();
  assert.equal(env.events.length, count, "unchanged feed paints are quiet");
  env.pushFull({ status: "paused" });
  env.renderNewWorkControl();
  assert.equal(env.events.length, count + 1);
  assert.equal(env.events.at(-1).type, "mefi:queue-settings");
  assert.equal(env.events.at(-1).detail.newWork, false);
  assert.equal(env.events.at(-1).detail.enabled, true, "service pause does not alter the queue preference");
  assert.deepEqual(env.calls, [], "sync never sends host commands");
});
