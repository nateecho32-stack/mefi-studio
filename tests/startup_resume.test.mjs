// Session continuity: the app comes back to the folder it was working in when
// it did not leave on purpose, and asks which folder to open when it did.
//
// The host half runs main.cjs's own section against a real temp userData
// folder, so the record it writes is the record the next launch reads. The
// renderer half runs the launch screen and the boot gate against stubs: a
// resumed launch never shows the picker and says what it came back to.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `section exists: ${start}`);
  return source.slice(from, to);
};

const MINUTE = 60000;

// ---- host ------------------------------------------------------------------

// Each host gets its own userData folder, so the record a test writes is the
// record it reads back — the real file, through the real fs calls.
const tempRoots = [];
after(() => { for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true }); });

function sessionHost({ smoke = false, project = { id: "project_a", name: "Alpha", path: "C:/projects/alpha" }, assistantLoop = false, state = null } = {}) {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "mefi-session-"));
  tempRoots.push(root);
  const lines = [];
  const timers = [];
  const context = vm.createContext({
    console, Date, JSON, Number, process,
    path: nodePath, app: { getPath: () => root },
    readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync,
    mkdirSync: fs.mkdirSync, rmSync: fs.rmSync,
    SMOKE: smoke, CAPTURE: false, CLI_MODE: false,
    pool: { queue: [], running: new Map() },
    autopilot: { jobs: [], history: [], held: false },
    assistantState: state,
    assistantLoop,
    projects: { open: () => project },
    logLine: (text) => lines.push(text),
    setInterval: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearInterval: (timer) => { if (timer) timer.cleared = true; },
  });
  vm.runInContext(section(main, "// ---- session continuity", "// ---- launch hold"), context, { filename: "main.cjs:session" });
  return {
    env: context, lines, timers, root,
    file: nodePath.join(root, "session.json"),
    read: () => JSON.parse(fs.readFileSync(nodePath.join(root, "session.json"), "utf8")),
    exists: () => fs.existsSync(nodePath.join(root, "session.json")),
    // What the previous process left behind, written as that process would.
    seed(record) { fs.writeFileSync(nodePath.join(root, "session.json"), JSON.stringify(record, null, 2)); },
  };
}

test("a launch that follows work still in progress reopens that folder instead of asking", () => {
  const host = sessionHost();
  const now = Date.now();
  host.seed({ projectId: "project_a", projectPath: "C:/projects/alpha", activityAt: now - 2 * MINUTE, agents: true });
  assert.deepEqual(plain(host.env.startupResume(now)), {
    projectId: "project_a", name: "Alpha", path: "C:/projects/alpha", activityAt: now - 2 * MINUTE, agents: true,
  });
});

test("a deliberate quit is the one thing that always sends the next launch back to the folder question", () => {
  const host = sessionHost({ assistantLoop: true });
  const now = Date.now();
  // Work is going and the agents are on: without a marker this would resume.
  host.env.pool.queue.push({ id: 1 });
  assert.equal(host.env.sessionBeat(now), true);
  assert.equal(host.read().activityAt, now);
  assert.equal(host.env.startupResume(now).agents, true);

  assert.equal(host.env.endSession("quit"), true, "the marker is forced through even though the beat just wrote this same work");
  const saved = host.read();
  assert.equal(saved.exit, "quit");
  assert.ok(saved.exitAt >= now);
  assert.equal(host.env.startupResume(Date.now()), null, "quitting means the next launch asks which folder to open");
});

test("closing to the tray ends the sitting too, and reopening the window starts a new one", () => {
  const host = sessionHost({ assistantLoop: true });
  const now = Date.now();
  host.env.pool.queue.push({ id: 1 });
  assert.equal(host.env.sessionBeat(now), true);

  // Background mode: the close parks the app, the agents work on.
  assert.equal(host.env.endSession("closed"), true);
  assert.equal(host.read().exit, "closed");
  assert.equal(host.env.startupResume(now), null, "a closed window is the user saying they are done");
  assert.equal(host.env.sessionBeat(now + MINUTE), false, "background work does not quietly undo that");
  assert.equal(host.read().exit, "closed");

  host.env.startSessionBeat();
  assert.equal(host.env.sessionBeat(now + 2 * MINUTE), true, "the window is back, so the sitting counts again");
  assert.equal(host.read().exit, undefined);
  assert.equal(host.env.startupResume(now + 2 * MINUTE)?.agents, true);
});

test("only work inside the window resumes, and only in the folder that is still open", () => {
  const now = Date.now();
  const fresh = { projectId: "project_a", activityAt: now - 9 * MINUTE, agents: true };
  const resume = (record, options) => {
    const host = sessionHost(options);
    if (record) host.seed(record);
    return { host, answer: host.env.startupResume(now) };
  };

  const edge = resume(fresh);
  assert.equal(edge.answer?.name, "Alpha", "nine minutes ago is still what you were working on, in the folder that is open");

  assert.equal(resume({ ...fresh, activityAt: now - 11 * MINUTE }).answer, null, "eleven minutes ago is a new sitting");
  assert.equal(resume({ ...fresh, activityAt: 0 }).answer, null, "an app that sat open without working has nothing to come back to");
  assert.equal(resume({ ...fresh, activityAt: now + MINUTE }).answer, null, "a record from the future is a clock change, not work");
  assert.equal(resume({ ...fresh, projectId: "project_b" }).answer, null, "a record for another folder never reopens this one");
  assert.equal(resume(fresh, { project: null }).answer, null, "with no folder open there is nothing to resume");

  const missing = resume(null);
  assert.equal(missing.answer, null, "a first launch has no record at all");
  assert.equal(missing.host.exists(), false, "reading never creates the record");

  const torn = resume(null);
  fs.writeFileSync(torn.host.file, "{ half-written");
  assert.equal(torn.host.env.startupResume(now), null, "a torn record is a question, not a crash");
});

test("agents that were never started are not started by the resume", () => {
  const host = sessionHost();
  const now = Date.now();
  host.seed({ projectId: "project_a", activityAt: now - MINUTE, agents: false });
  assert.equal(host.env.startupResume(now).agents, false);
});

test("the beat records work, not uptime, and rewrites nothing while the studio is idle", () => {
  const host = sessionHost({ assistantLoop: true, state: { work: [], messages: [], startedAt: 0 } });
  const now = Date.now();
  assert.equal(host.env.sessionBeat(now), false, "an open studio doing nothing writes no record");
  assert.equal(host.exists(), false);

  host.env.autopilot.jobs.push({ id: "build", startedAt: now - 1000, finished: false });
  assert.equal(host.env.sessionBeat(now), true);
  assert.equal(host.read().activityAt, now, "a live build job is work happening right now");
  assert.equal(host.read().agents, true);
  assert.equal(host.env.sessionBeat(now), false, "the same work is not written twice");

  // Work that ended between two beats still counts, with its own timestamp.
  host.env.autopilot.jobs[0].finished = true;
  host.env.autopilot.jobs[0].finishedAt = now - 500;
  assert.equal(host.env.sessionBeat(now + 1000), true);
  assert.equal(host.read().activityAt, now - 500);

  host.env.autopilot.jobs.length = 0;
  host.env.assistantState.messages.push({ role: "assistant", at: now + 2000 });
  assert.equal(host.env.sessionBeat(now + 3000), false, "what the assistant says back is not the user working");
  host.env.assistantState.messages.push({ role: "user", at: now + 2500 });
  assert.equal(host.env.sessionBeat(now + 3000), true);
  assert.equal(host.read().activityAt, now + 2500);

  // Starting the agents is itself the moment work began.
  host.env.assistantState.startedAt = now + 4000;
  assert.equal(host.env.sessionBeat(now + 5000), true);
  assert.equal(host.read().activityAt, now + 4000);
  host.env.assistantLoop = false;
  assert.equal(host.env.sessionBeat(now + 6000), true, "with the loop stopped that start belongs to a past session");
  assert.equal(host.read().activityAt, now + 2500);
});

test("with no folder open the beat keeps its silence, so a quit marker is never cleared by an empty session", () => {
  const host = sessionHost({ project: null });
  host.seed({ projectId: "project_a", activityAt: Date.now(), agents: true, exit: "quit" });
  host.env.pool.running.set(1, {});
  assert.equal(host.env.sessionBeat(), false);
  assert.equal(host.read().exit, "quit");
});

test("the beat runs on its own timer and the quit path stops it", () => {
  const host = sessionHost();
  host.env.startSessionBeat();
  host.env.startSessionBeat();
  assert.equal(host.timers.length, 1, "one timer, however often the start is called");
  assert.equal(host.timers[0].ms, 30000);
  host.env.endSession("quit");
  assert.equal(host.timers[0].cleared, true, "nothing beats after the record is final");
});

test("a diagnostic launch neither records a session nor resumes one", () => {
  const host = sessionHost({ smoke: true, assistantLoop: true });
  host.seed({ projectId: "project_a", activityAt: Date.now(), agents: true });
  host.env.pool.queue.push({ id: 1 });
  assert.equal(host.env.startupResume(), null);
  assert.equal(host.env.sessionBeat(), false);
  assert.equal(host.env.endSession("quit"), false);
  host.env.startSessionBeat();
  assert.equal(host.timers.length, 0);
  assert.equal(host.read().exit, undefined, "the smoke leaves the user's own record untouched");
});

test("an unwritable record is reported and never throws through the quit path", () => {
  const host = sessionHost();
  host.env.writeFileSync = () => { throw new Error("disk is full"); };
  assert.equal(host.env.endSession("quit"), false);
  assert.match(host.lines.join("\n"), /could not record the open project: disk is full/);
});

// ---- the launch ------------------------------------------------------------

function launchHost(resume) {
  const context = vm.createContext({
    console,
    SMOKE: false, CAPTURE: false, CLI_MODE: false,
    Date, Math,
    autopilot: { held: null }, startupChosen: false, startupResumed: null,
    startupResume: () => resume,
    logLine() {}, createWindow() {},
    startSessionBeat() { context.beats = (context.beats ?? 0) + 1; },
  });
  vm.runInContext(section(main, "  startupResumed = startupResume();", "  createWindow();"), context, { filename: "main.cjs:launch" });
  return context;
}

test("a resumed session whose agents were running launches unheld, and one without them keeps the hold", () => {
  const working = launchHost({ projectId: "project_a", name: "Alpha", activityAt: Date.now() - MINUTE, agents: true });
  assert.equal(working.startupChosen, true, "the folder question is already answered");
  assert.equal(working.autopilot.held, false, "the agents that were running come back with the folder");
  assert.equal(working.beats, 1);

  const quiet = launchHost({ projectId: "project_a", name: "Alpha", activityAt: Date.now() - MINUTE, agents: false });
  assert.equal(quiet.startupChosen, true);
  assert.equal(quiet.autopilot.held, true, "agents that were not running stay held, as on any other launch");

  const asking = launchHost(null);
  assert.equal(asking.startupChosen, false, "without a resume the launch screen asks as it always did");
  assert.equal(asking.autopilot.held, true);
  assert.equal(asking.startupResumed, null);
});

// ---- renderer --------------------------------------------------------------

const startupSource = await readFile(new URL("../renderer/startup.js", import.meta.url), "utf8");
const bootSource = await readFile(new URL("../renderer/boot.js", import.meta.url), "utf8");

class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this.hidden = false; this.disabled = false; this.className = ""; this.title = ""; this.ownText = "";
    this.classList = { toggle: () => {}, contains: () => false, add: () => {}, remove: () => {} };
  }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.ownText = ""; this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  async click() { if (this.disabled) return; if (typeof this.onclick === "function") await this.onclick(); for (const fn of this.listeners.click ?? []) await fn({ target: this }); }
  focus() { this.focused = true; }
  matches(selector) { return selector === "button" && this.tagName === "button"; }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function screenHost(stateAnswer) {
  const elements = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element(id.includes("open") || id.includes("add") ? "button" : "div")); return elements.get(id); };
  const calls = [];
  const bridge = {
    startupState: async () => stateAnswer,
    startupChoose: async (id) => { calls.push(["choose", id]); return { ok: true, chosen: true, projects: stateAnswer.projects, activeId: id ?? stateAnswer.activeId ?? null }; },
    startupBegin: async () => { calls.push(["begin"]); return { ok: true }; },
    projectsAdd: async () => { calls.push(["add"]); return { ok: true }; },
  };
  const context = vm.createContext({
    window: { mefiStudio: bridge }, console,
    document: { getElementById: (id) => get(id), createElement: (tag) => new Element(tag) },
  });
  vm.runInContext(startupSource, context, { filename: "startup.js" });
  return { startup: context.window.MefiStartup, calls, get };
}

test("the launch screen asks nothing when the host has already reopened the last folder", async () => {
  const resumed = { projectId: "project_a", name: "Alpha", path: "C:/projects/alpha", activityAt: Date.now(), agents: true };
  const host = screenHost({ ok: true, interactive: true, chosen: true, resumed, projects: [{ id: "project_a", name: "Alpha", path: "C:/projects/alpha" }], activeId: "project_a" });
  const choice = await host.startup.choose();
  assert.deepEqual(plain(choice), { projectId: "project_a", startAgents: false, changed: false, resumed });
  assert.deepEqual(host.calls, [], "nothing is chosen or started from here: the host already did both");
  assert.equal(host.get("boot-choose").hidden, false, "the gate hides the screen; the choice never renders one");
});

test("a launch with no resume still asks, and a bare reload still skips", async () => {
  const projects = [{ id: "project_a", name: "Alpha", path: "C:/projects/alpha" }];
  const asking = screenHost({ ok: true, interactive: true, chosen: false, projects, activeId: "project_a" });
  const pending = asking.startup.choose();
  for (let count = 0; count < 30; count += 1) await Promise.resolve();
  assert.equal(asking.get("boot-projects").querySelectorAll("button").length, 1, "the screen is up and waiting");
  await asking.get("boot-open").click();
  assert.deepEqual(plain(await pending), { projectId: "project_a", startAgents: false, changed: false });

  const reloaded = screenHost({ ok: true, interactive: true, chosen: true, projects, activeId: "project_a" });
  assert.equal(await reloaded.startup.choose(), null, "a renderer reload after the choice skips the screen as before");
});

function bootHost() {
  const elements = Object.fromEntries(
    ["layer", "title", "detail", "progress", "progress-heading", "count", "steps", "actions", "retry", "continue", "choose"]
      .map((name) => ["boot-" + name, new Element()])
  );
  let now = 0, nextId = 0;
  const timers = new Map(), frames = new Map();
  const document = {
    readyState: "complete", hidden: false, activeElement: null,
    body: { children: [] }, documentElement: new Element(),
    getElementById: (id) => elements[id], createElement: () => new Element("li"),
    addEventListener() {},
  };
  const context = vm.createContext({
    window: { mefiStudio: {}, MefiNav: { noMotion: () => true }, addEventListener() {}, removeEventListener() {} },
    document, performance: { now: () => now }, console,
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setInterval: () => 0, clearInterval() {},
  });
  vm.runInContext(bootSource, context, { filename: "boot.js" });
  return {
    boot: context.window.MefiBoot, elements,
    async advance(ms) {
      const target = now + ms;
      for (let count = 0; count < 40; count += 1) await Promise.resolve();
      while (now < target) {
        now = Math.min(now + 16, target);
        for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
        const callbacks = [...frames.values()]; frames.clear();
        for (const frame of callbacks) frame(now);
        for (let count = 0; count < 40; count += 1) await Promise.resolve();
      }
    },
  };
}

test("the gate says which folder it came back to instead of asking, and says nothing extra otherwise", async () => {
  for (const resumed of [{ name: "Alpha" }, null]) {
    const host = bootHost();
    let release;
    const step = { id: "workspace", label: "Your projects and work", load: () => new Promise((resolve) => { release = resolve; }) };
    void host.boot.run([step], () => {}, { choose: async () => (resumed ? { projectId: "project_a", startAgents: false, changed: false, resumed } : null) });
    await host.advance(1);
    assert.equal(host.elements["boot-title"].textContent, resumed ? "Picking up where you left off" : "Opening your studio");
    assert.equal(
      host.elements["boot-detail"].textContent,
      resumed ? "Reopened Alpha · Your projects and work…" : "Your projects and work…"
    );
    release(true);
    await host.advance(400);
    assert.equal(host.elements["boot-title"].textContent, "Your studio is ready", "the resume note never outstays the load");
    assert.equal(host.elements["boot-detail"].textContent, "Everything is in place.");
  }
});
