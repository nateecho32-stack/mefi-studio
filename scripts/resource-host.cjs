// Mefi's Studio AI+ — the resource manager's host (Team › Resources,
// docs/resource-manager.md). It runs the Windows helper
// (scripts/resource-helper.cs), keeps what Studio holds on other apps, acts
// for the page and for auto mode, and makes sure nothing it paused stays
// paused once Studio is gone. What to do is decided by
// scripts/resource-rules.cjs; this file only carries it out.
//
// - The helper is built once per version of its source with the C# compiler
//   Windows ships (.NET Framework 4's csc.exe) into this PC's own folder
//   (local-dirs.cjs, never OneDrive), and runs only while something needs it:
//   the page is open, auto mode is acting, or an app is held. It runs
//   detached, so when Studio quits, crashes or is ended its stdin closes and
//   it puts back everything it changed before it exits.
// - Every change is mirrored to <folder>/journal.json. A helper that died
//   without putting things back leaves it behind; the next helper adopts what
//   the snapshot shows is still in effect, and a new Studio puts it all back.
// - Holds are per app: { slow, pause }, each made by "you" or by "auto". Auto
//   mode's go back after building stops; yours stay until you put them back
//   or quit Studio. A paused app you switch to runs again at once, whoever
//   paused it.
// - One thing runs at a time (a tick, a press on the page), so a decision is
//   never made on a picture an action just changed.
//
// When nothing needs it, it has no helper, no timer and takes no snapshot.

"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const rules = require("./resource-rules.cjs");

const CADENCE = Object.freeze({
  watched: 2000,   // the page is open
  paused: 1500,    // an app is paused: switching to it must let it run quickly
  focus: 4000,     // auto mode while agents build, or until its holds go back
  held: 10000,     // holds you made, kept whole as the app starts processes
  waiting: 3000,   // auto mode waiting for agents to build: no helper, no snapshot
  idle: 15000,     // a helper nobody needs, until it is let go
});
const HELPER_IDLE_MS = 2 * 60 * 1000;
const REQUEST_MS = 15000;
const START_MS = 20000;
const COMPILE_MS = 120000;
const LEASE_MS = 60000;
const LEASES = 8;
const LOG_LIMIT = 40;
const STEPS_PER_TICK = 12;
const TARGETS_PER_STEP = 64;
const PREFS_TTL_MS = 10000;
const CLOSE_CHECK_MS = 5000;
// A process Windows refused is not asked again for this long, so a hold kept
// whole does not knock on an administrator's process every tick.
const REFUSED_MS = 10 * 60 * 1000;
// A helper that could not be built or started is not tried again sooner.
const RETRY_START_MS = 60 * 1000;

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const plainMessage = (error) => String(error?.message ?? error ?? "").slice(0, 300);

/**
 * options: spawn, execFile and fs (node:fs/promises) to reach the PC; dir()
 * the folder for the helper and its journal; source the helper's C# file;
 * studioPids() Studio's own root pids; readPrefs()/savePrefs(prefs) for
 * settings.resources; building() -> { active, running, waiting,
 * waitingForMemory }; send(channel, payload) for "resources:update" and
 * "resources:acted"; logLine; now; setTimer/clearTimer; disabled, a sentence
 * when the resource manager is switched off for this launch.
 */
function createResourceHost(options = {}) {
  const {
    platform = process.platform,
    spawn,
    execFile,
    fs,
    env = process.env,
    dir = async () => null,
    source = path.join(__dirname, "resource-helper.cs"),
    studioPids = () => [process.pid],
    readPrefs = async () => ({}),
    savePrefs = async (prefs) => prefs,
    building = () => ({ active: false }),
    send = () => {},
    logLine: rawLog = () => {},
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    disabled = null,
    buildHelper = null,
  } = options;
  const windowsDir = String(env.SystemRoot || env.windir || env.WINDIR || "C:\\Windows");
  // The helper's folder (its program and the journal) is joined for the
  // platform this host was given, not the one Node runs on: the same on
  // Windows, and tests/resource_host drives a Windows PC from any host.
  const paths = platform === "win32" ? path.win32 : path;
  // The home folder never reaches the log or the page: Windows and the
  // compiler name files in full, with the person's account name in them.
  const home = String(env.USERPROFILE || env.HOME || "").replace(/[\\/]+$/, "");
  function scrub(text) {
    let out = String(text ?? "");
    if (home.length < 4) return out;
    const want = home.toLowerCase().replace(/\//g, "\\");
    let at;
    while ((at = out.toLowerCase().replace(/\//g, "\\").indexOf(want)) >= 0) out = `${out.slice(0, at)}~${out.slice(at + home.length)}`;
    return out;
  }
  const logLine = (line) => rawLog(scrub(line));
  const message = (error) => scrub(plainMessage(error));

  const state = {
    prefs: null,
    prefsAt: 0,
    look: null,          // { snapshot, cpu, groups, at }
    previous: null,      // the snapshot CPU shares are measured against
    cpu: null,
    holds: new Map(),    // appKey -> { slow: { by, at } | null, pause: { by, at } | null }
    marks: new Map(),    // appKey -> { usedAt, trimmedAt, closedAt, releasedAt }
    names: new Map(),    // appKey -> name, for words about an app that has gone
    refused: new Map(),  // "pid:create" -> until when Windows' refusal is remembered
    log: [],
    leases: new Map(),
    building: { active: false, since: null, endedAt: null, running: 0, waiting: false, waitingForMemory: false },
    snoozed: false,
    decided: { level: "manual", short: null, suggest: [] },
    timer: null,
    stopped: false,
    error: null,
    journal: "",
    adopt: false,        // a helper died while holding: the next one adopts the journal
    recovered: false,
  };
  const helper = { child: null, pid: 0, buffer: "", pending: new Map(), next: 1, starting: null, lastUsed: 0, stopping: false, exe: null, error: null, failedAt: 0 };

  const supported = () => !disabled && platform === "win32";
  const unsupportedReason = () => disabled || "The resource manager works on Windows for now.";

  // ---- one thing at a time ------------------------------------------------------------
  let chain = Promise.resolve();
  function exclusive(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  }

  // ---- preferences --------------------------------------------------------------------
  async function prefs({ fresh = false } = {}) {
    if (!fresh && state.prefs && now() - state.prefsAt < PREFS_TTL_MS) return state.prefs;
    try { state.prefs = rules.normalizePrefs(await readPrefs()); }
    catch { state.prefs = state.prefs ?? rules.normalizePrefs({}); }
    state.prefsAt = now();
    return state.prefs;
  }

  // ---- the helper ---------------------------------------------------------------------
  async function exists(file) {
    try { await fs.access(file); return true; } catch { return false; }
  }

  async function compiler() {
    for (const flavour of ["Framework64", "Framework"]) {
      const csc = path.win32.join(windowsDir, "Microsoft.NET", flavour, "v4.0.30319", "csc.exe");
      if (await exists(csc)) return csc;
    }
    return null;
  }

  function run(command, args) {
    return new Promise((resolve, reject) => {
      execFile(command, args, { windowsHide: true, timeout: COMPILE_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(new Error(`${message(error)} ${String(stdout ?? "").trim().slice(0, 600)} ${String(stderr ?? "").trim().slice(0, 300)}`.trim()));
        else resolve(stdout);
      });
    });
  }

  // The helper's program for this version of its source: built when missing,
  // older versions removed.
  async function build() {
    if (typeof buildHelper === "function") return buildHelper();
    const text = await fs.readFile(source, "utf8");
    const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
    const folder = await dir();
    if (!folder) throw new Error("Studio has no folder of its own on this PC to keep the helper in.");
    const exe = paths.join(folder, `resource-helper-${hash}.exe`);
    if (await exists(exe)) return exe;
    await fs.mkdir(folder, { recursive: true });
    const csc = await compiler();
    if (!csc) throw new Error("Windows' C# compiler (csc.exe, part of .NET Framework 4) is missing, so Studio cannot build its resource helper on this PC.");
    const temp = paths.join(folder, `resource-helper-${hash}.${process.pid}.tmp.exe`);
    await run(csc, ["/nologo", "/optimize+", "/target:exe", "/platform:anycpu", `/out:${temp}`, source]);
    try {
      await fs.rename(temp, exe);
    } catch (error) {
      // Another Studio built the same version at the same moment.
      await fs.unlink(temp).catch(() => {});
      if (!(await exists(exe))) throw error;
    }
    logLine(`[resources] built the resource helper (${paths.basename(exe)})`);
    for (const name of await fs.readdir(folder).catch(() => [])) {
      if (/^resource-helper-[0-9a-f]{12}\.exe$/.test(name) && name !== paths.basename(exe)) fs.unlink(paths.join(folder, name)).catch(() => {});
    }
    return exe;
  }

  function onLine(line) {
    let reply;
    try { reply = JSON.parse(line); } catch { logLine(`[resources] the helper said something unreadable: ${line.slice(0, 120)}`); return; }
    const waiting = helper.pending.get(reply?.id);
    if (!waiting) return;
    helper.pending.delete(reply.id);
    clearTimer(waiting.timer);
    waiting.resolve(reply);
  }

  function onExit(child, code) {
    if (helper.child !== child) return;
    helper.child = null;
    helper.pid = 0;
    helper.buffer = "";
    for (const waiting of helper.pending.values()) { clearTimer(waiting.timer); waiting.reject(new Error("the resource helper stopped")); }
    helper.pending.clear();
    if (helper.stopping) { helper.stopping = false; return; }
    // Stopped on its own (ended from Task Manager, or a crash): what it held
    // may still be in effect, so the next helper takes it back from the journal.
    logLine(`[resources] the resource helper stopped unexpectedly (${code ?? "no code"})`);
    if (state.journal && state.journal !== "[]") state.adopt = true;
    wake();
  }

  async function startHelper() {
    if (helper.child) return helper;
    if (!supported()) throw new Error(unsupportedReason());
    if (helper.starting) return helper.starting;
    if (helper.failedAt && now() - helper.failedAt < RETRY_START_MS) throw new Error(helper.error || "the resource helper could not start");
    helper.starting = (async () => {
      const exe = await build();
      helper.exe = exe;
      const studio = Number(studioPids()?.[0]) || process.pid;
      const child = spawn(exe, [String(studio)], { detached: true, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const ready = new Promise((resolve, reject) => {
        const timer = setTimer(() => reject(new Error("the resource helper did not start")), START_MS);
        helper.pending.set(0, { resolve: (reply) => { clearTimer(timer); resolve(reply); }, reject: (error) => { clearTimer(timer); reject(error); }, timer });
      });
      helper.child = child;
      helper.next = 1;
      child.stdout?.setEncoding?.("utf8");
      child.stdout?.on("data", (chunk) => {
        helper.buffer += chunk;
        let at;
        while ((at = helper.buffer.indexOf("\n")) >= 0) {
          const line = helper.buffer.slice(0, at).trim();
          helper.buffer = helper.buffer.slice(at + 1);
          if (line) onLine(line);
        }
        if (helper.buffer.length > 8 * 1024 * 1024) helper.buffer = "";
      });
      child.stderr?.on("data", (chunk) => logLine(`[resources] helper: ${String(chunk).trim().slice(0, 300)}`));
      child.stdin?.on?.("error", () => {});
      child.on("exit", (code) => onExit(child, code));
      child.on("error", (error) => {
        const waiting = helper.pending.get(0);
        if (waiting) { helper.pending.delete(0); waiting.reject(error); }
        onExit(child, null);
      });
      child.unref?.();
      const hello = await ready;
      helper.pid = Number(hello?.pid) || child.pid || 0;
      helper.lastUsed = now();
      helper.error = null;
      helper.failedAt = 0;
      if (state.adopt) {
        state.adopt = false;
        await adoptJournal({ putBack: false }).catch((error) => logLine(`[resources] could not take back what the last helper held: ${message(error)}`));
      }
      return helper;
    })().catch((error) => {
      helper.error = message(error);
      helper.failedAt = now();
      if (helper.child) { try { helper.child.kill(); } catch {} helper.child = null; }
      throw error;
    }).finally(() => { helper.starting = null; });
    return helper.starting;
  }

  async function request(op, arg = "") {
    await startHelper();
    const child = helper.child;
    if (!child) throw new Error("the resource helper stopped");
    const id = helper.next++;
    helper.lastUsed = now();
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        helper.pending.delete(id);
        reject(new Error(`the resource helper did not answer (${op})`));
      }, REQUEST_MS);
      helper.pending.set(id, { resolve, reject, timer });
      try { child.stdin.write(`${id} ${op}${arg ? ` ${arg}` : ""}\n`); }
      catch (error) { helper.pending.delete(id); clearTimer(timer); reject(error); }
    });
  }

  // Lets the helper go: it puts back everything it holds, then exits.
  async function stopHelper() {
    const child = helper.child;
    if (!child) return;
    helper.stopping = true;
    const gone = new Promise((resolve) => child.once?.("exit", resolve));
    try { child.stdin.end(`${helper.next++} exit\n`); } catch {}
    const timer = new Promise((resolve) => setTimer(resolve, 3000));
    await Promise.race([gone, timer]);
    if (helper.child === child) { try { child.kill(); } catch {} }
  }

  // ---- the journal --------------------------------------------------------------------
  async function journalPath() {
    const folder = await dir();
    return folder ? paths.join(folder, "journal.json") : null;
  }

  async function writeJournal(ledger) {
    if (!Array.isArray(ledger)) return;
    const entries = ledger.map((row) => ({
      pid: row.pid, create: row.create, name: row.name ?? "",
      slowed: row.slowed === true, paused: row.paused === true,
      oldPriority: row.oldPriority ?? 0, oldMemoryPriority: row.oldMemoryPriority ?? 0,
    }));
    const body = JSON.stringify(entries);
    if (body === state.journal) return;
    state.journal = body;
    const file = await journalPath();
    if (!file) return;
    try {
      await fs.mkdir(paths.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify({ v: 1, at: now(), entries }, null, 2));
      await fs.rename(temp, file);
    } catch (error) {
      logLine(`[resources] the journal could not be written: ${message(error)}`);
    }
  }

  async function readJournal() {
    const file = await journalPath();
    if (!file) return [];
    try {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      return Array.isArray(data?.entries) ? data.entries : [];
    } catch {
      return [];
    }
  }

  // What a helper that is gone left in effect: adopted, and put back when a
  // new Studio starts (its holds died with the old one).
  async function adoptJournal({ putBack }) {
    const entries = await readJournal();
    if (!entries.length) return 0;
    const raw = await request("snap");
    const snapshot = rules.readSnapshot(raw);
    const tokens = rules.adoptions(entries, snapshot);
    let ledger = snapshot?.ledger ?? [];
    if (tokens.length) {
      const reply = await request("adopt", tokens.join(","));
      ledger = Array.isArray(reply?.ledger) ? reply.ledger : ledger;
    }
    if (putBack) {
      const reply = await request("restoreall");
      ledger = Array.isArray(reply?.ledger) ? reply.ledger : [];
      if (tokens.length) record({ text: `Put back ${plural(tokens.length, "process", "processes")} Studio still held from before it last closed.`, by: "studio", ok: true });
    }
    await writeJournal(ledger);
    return tokens.length;
  }

  // ---- looking ------------------------------------------------------------------------
  async function look() {
    const raw = await request("snap");
    const snapshot = rules.readSnapshot(raw);
    if (!snapshot) throw new Error("the resource helper's picture could not be read");
    // CPU shares need a second picture at least a second apart; a closer one keeps the last shares.
    if (!state.previous || snapshot.at - state.previous.at >= 1000) {
      state.cpu = state.previous ? rules.cpuUse(state.previous, snapshot) : { system: null, byProcess: new Map() };
      state.previous = snapshot;
    }
    const settings = await prefs();
    const groups = rules.groupApps({ snapshot, cpu: state.cpu, studioPids: studioPids(), windowsDir, prefs: settings, holds: state.holds });
    for (const app of groups.apps) {
      state.names.set(app.key, app.name);
      if (app.foreground) mark(app.key).usedAt = now();
    }
    // A hold on an app that has closed has nothing left to hold.
    const present = new Set(groups.apps.map((app) => app.key));
    for (const key of [...state.holds.keys()]) {
      if (present.has(key)) continue;
      state.holds.delete(key);
      record({ text: `${nameOf(key)} closed, so Studio holds nothing on it any more.`, by: "studio", ok: true, key });
    }
    state.look = { snapshot, cpu: state.cpu, groups, at: now() };
    await writeJournal(snapshot.ledger);
    return state.look;
  }

  function mark(key) {
    if (!state.marks.has(key)) state.marks.set(key, {});
    return state.marks.get(key);
  }
  const nameOf = (key) => state.names.get(key) ?? key;
  const appOf = (key) => state.look?.groups?.apps?.find((app) => app.key === key) ?? null;

  function record({ text, by = "you", ok = true, key = null, op = null }) {
    const entry = { at: now(), text: String(text).slice(0, 240), by, ok, key, op };
    state.log.unshift(entry);
    if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
    logLine(`[resources] ${by === "auto" ? "auto: " : by === "you" ? "you: " : ""}${entry.text}`);
    if (by === "auto") send("resources:acted", { ...entry, notify: state.prefs?.notify !== false });
    return entry;
  }

  // ---- acting -------------------------------------------------------------------------
  function hold(key, what, by) {
    const current = state.holds.get(key) ?? { slow: null, pause: null };
    current[what] = { by, at: now() };
    state.holds.set(key, current);
  }
  function unhold(key, what) {
    const current = state.holds.get(key);
    if (!current) return;
    if (what === "all") current.slow = current.pause = null;
    else current[what] = null;
    if (!current.slow && !current.pause) state.holds.delete(key);
  }

  // One op on one app's processes; returns the words it recorded (or true when
  // `quiet`), or null when there was nothing to do. A press (`press`) asks
  // every process again; a hold kept whole skips what Windows just refused and
  // says nothing: a browser opening a tab is no news.
  async function perform(app, op, by, reason = "", { press = false, quiet = false } = {}) {
    const at = now();
    for (const [id, until] of state.refused) if (until <= at) state.refused.delete(id);
    // A press of yours asks again; a hold kept whole skips what Windows just refused.
    const targets = app.targets.filter((id) => press || !state.refused.has(id)).slice(0, TARGETS_PER_STEP);
    if (!targets.length) return null;
    const reply = await request(op, targets.join(","));
    const results = Array.isArray(reply?.results) ? reply.results : [];
    for (const row of results) {
      if (row.ok || !["denied", "critical", "system", "studio"].includes(row.error)) continue;
      const id = targets.find((target) => target.startsWith(`${row.pid}:`));
      if (id) state.refused.set(id, at + REFUSED_MS);
    }
    const fresh = results.filter((row) => row.ok && !row.was).length;
    const done = results.filter((row) => row.ok).length;
    const failed = results.length - done;
    const error = results.find((row) => !row.ok)?.error ?? null;
    if (Array.isArray(reply?.ledger)) await writeJournal(reply.ledger);
    // A paused app's memory is handed back at once: frozen, it would only sit there.
    if (op === "pause" && fresh) await request("trim", targets.join(",")).catch(() => null);
    if (op === "slow" || op === "pause") { if (done) hold(app.key, op, by); }
    else if (op === "trim") mark(app.key).trimmedAt = now();
    else if (op === "close") { mark(app.key).closedAt = now(); unhold(app.key, "all"); laterCheckClosed(app.key); }
    else if (op === "end") unhold(app.key, "all");
    if (!fresh && !failed && op !== "close" && op !== "end") return null;
    if (quiet) return fresh > 0 || null;
    const words = op === "close" && done && results.every((row) => !row.ok || row.windows === 0)
      ? `${app.name} has no window to close. End stops it.`
      : rules.actionWords({ op, name: app.name, ok: done, failed, error });
    return record({ text: reason && by === "auto" ? `${words} (${reason})` : words, by, ok: done > 0, key: app.key, op });
  }

  // Lets go of an app: "pause" resumes it, "auto" undoes what auto did, "all" everything.
  async function release(app, what, reason, by) {
    const hold = state.holds.get(app.key) ?? { slow: null, pause: null };
    const ops = [];
    if (what === "all") ops.push("restore");
    else if (what === "pause") ops.push("resume");
    else {
      if (hold.pause?.by === "auto") ops.push("resume");
      if (hold.slow?.by === "auto") ops.push("unslow");
    }
    if (!ops.length && app.paused === "none" && app.slowed === "none") { unhold(app.key, what === "auto" ? "all" : what); return null; }
    let done = 0, failed = 0, error = null;
    for (const op of ops) {
      const targets = app.targets.slice(0, TARGETS_PER_STEP);
      if (!targets.length) continue;
      const reply = await request(op, targets.join(","));
      const results = Array.isArray(reply?.results) ? reply.results : [];
      done += results.filter((row) => row.ok && !row.was).length;
      failed += results.filter((row) => !row.ok).length;
      error = error ?? results.find((row) => !row.ok)?.error ?? null;
      if (Array.isArray(reply?.ledger)) await writeJournal(reply.ledger);
    }
    if (what === "all") unhold(app.key, "all");
    else if (what === "pause") unhold(app.key, "pause");
    else {
      if (hold.pause?.by === "auto") unhold(app.key, "pause");
      if (hold.slow?.by === "auto") unhold(app.key, "slow");
    }
    if (!done && !failed) return null;
    const words = failed && !done
      ? `Could not put ${app.name} back: ${rules.errorWords(error)}`
      : what === "pause" ? `Let ${app.name} run again` : `Put ${app.name} back`;
    return record({ text: reason ? `${words} (${reason}).` : `${words}.`, by, ok: done > 0, key: app.key, op: "restore" });
  }

  // A closed app that is still running probably went to the tray: say so once.
  function laterCheckClosed(key) {
    const timer = setTimer(() => {
      void exclusive(async () => {
        if (!helper.child) return;
        await look().catch(() => null);
        const app = appOf(key);
        if (app && app.count > 0) record({ text: `${app.name} is still running (it may have gone to the tray). End stops it.`, by: "studio", ok: false, key });
        push();
      });
    }, CLOSE_CHECK_MS);
    timer?.unref?.();
  }

  // ---- building -----------------------------------------------------------------------
  function readBuilding() {
    let input = {};
    try { input = building() ?? {}; } catch { input = {}; }
    const active = input.active === true;
    const was = state.building;
    if (active && !was.active) state.building = { ...was, active: true, since: now(), endedAt: null };
    else if (!active && was.active) {
      state.building = { ...was, active: false, endedAt: now() };
      // Restore all holds auto off only until this building stops.
      state.snoozed = false;
    }
    state.building.running = Number(input.running) || 0;
    state.building.waiting = input.waiting === true;
    state.building.waitingForMemory = input.waitingForMemory === true;
    return state.building;
  }

  // ---- the loop -----------------------------------------------------------------------
  const watched = () => {
    const at = now();
    for (const [key, until] of state.leases) if (until <= at) state.leases.delete(key);
    return state.leases.size > 0;
  };
  const autoHeldAny = () => [...state.holds.values()].some((hold) => hold.slow?.by === "auto" || hold.pause?.by === "auto");
  const pausedAny = () => [...state.holds.values()].some((hold) => hold.pause);

  // How soon to look again, or null when nothing needs looking at.
  function cadence(settings) {
    if (state.stopped || !supported()) return null;
    if (watched()) return CADENCE.watched;
    if (pausedAny()) return CADENCE.paused;
    if (settings.mode === "auto" && (state.building.active || autoHeldAny())) return CADENCE.focus;
    if (state.holds.size) return CADENCE.held;
    if (settings.mode === "auto") return CADENCE.waiting;
    if (helper.child) return CADENCE.idle;
    return null;
  }

  function needsLook(settings) {
    return watched() || state.holds.size > 0 || (settings.mode === "auto" && (state.building.active || autoHeldAny()));
  }

  async function tick() {
    const settings = await prefs();
    readBuilding();
    if (!supported()) return;
    if (!needsLook(settings)) {
      if (helper.child && now() - helper.lastUsed > HELPER_IDLE_MS && !state.journal.includes("\"pid\"")) await stopHelper();
      return;
    }
    const seen = await look();
    const decided = rules.plan({
      apps: seen.groups.apps, prefs: settings, building: state.building, memory: seen.snapshot.memory,
      marks: state.marks, snoozed: state.snoozed, now: now(),
    });
    state.decided = decided;
    let changed = false;
    for (const step of decided.release) {
      const app = appOf(step.key);
      if (!app) continue;
      if (step.what === "pause" && step.reason === "you switched to it") mark(step.key).releasedAt = now();
      if (await release(app, step.what, step.reason, step.what === "pause" ? "studio" : "auto")) changed = true;
    }
    for (const step of decided.apply.slice(0, STEPS_PER_TICK)) {
      const app = appOf(step.key);
      if (!app || app.protected) continue;
      if (await perform(app, step.op, step.by, step.by === "auto" ? step.reason : "", { quiet: step.whole === true })) changed = true;
    }
    if (changed) await look();
  }

  async function loop() {
    state.timer = null;
    if (state.stopped) return;
    let next = null;
    try {
      await exclusive(tick);
      state.error = null;
    } catch (error) {
      const text = message(error);
      if (text !== state.error) logLine(`[resources] ${text}`);
      state.error = text;
    }
    push();
    try { next = cadence(await prefs()); } catch { next = null; }
    if (state.error && next !== null) next = Math.max(next, 5000);
    schedule(next);
  }

  function schedule(ms) {
    if (state.timer) { clearTimer(state.timer); state.timer = null; }
    if (ms === null || ms === undefined || state.stopped) return;
    state.timer = setTimer(() => { void loop(); }, ms);
    state.timer?.unref?.();
  }

  function wake() {
    if (state.stopped) return;
    schedule(0);
  }

  // ---- what the page sees ---------------------------------------------------------------
  function view() {
    const settings = state.prefs ?? rules.normalizePrefs({});
    const seen = state.look;
    const memory = seen?.snapshot?.memory ?? null;
    const apps = (seen?.groups?.apps ?? []).map(({ targets, ...app }) => app);
    const held = apps.filter((app) => app.hold.slow || app.hold.pause).length;
    const paused = apps.filter((app) => app.hold.pause).length;
    const decided = settings.mode === "auto" ? state.decided : { level: "manual", short: null, suggest: [] };
    return {
      ok: true,
      supported: supported(),
      reason: supported() ? "" : unsupportedReason(),
      error: state.error || helper.error || null,
      mode: settings.mode,
      level: decided.level,
      headline: rules.headline({ supported: supported(), reason: unsupportedReason(), mode: settings.mode, level: decided.level, held, paused, short: decided.short, building: state.building }),
      machine: memory ? {
        cpu: seen.cpu?.system ?? null,
        totalMB: Math.round(memory.totalMB),
        freeMB: Math.round(memory.freeMB),
        usedPct: memory.totalMB > 0 ? Math.round((1 - memory.freeMB / memory.totalMB) * 100) : null,
        commitPct: memory.commitLimitMB > 0 ? Math.round((1 - memory.commitFreeMB / memory.commitLimitMB) * 100) : null,
      } : null,
      building: { active: state.building.active, running: state.building.running, waiting: state.building.waiting },
      studio: seen?.groups?.studio ?? null,
      windows: seen?.groups?.windows ?? null,
      kept: seen?.groups?.kept ?? null,
      apps,
      short: decided.short ?? null,
      suggest: (decided.suggest ?? []).map((entry) => ({ ...entry, name: nameOf(entry.key) })),
      snoozed: state.snoozed,
      log: state.log.slice(0, 20),
      prefs: settings,
      at: seen?.snapshot?.at ?? null,
    };
  }

  function push() {
    if (watched()) send("resources:update", view());
  }

  // ---- what main.cjs calls --------------------------------------------------------------
  // The page's read: a fresh picture when one can be had.
  async function snapshot() {
    await prefs();
    if (supported()) {
      try {
        await exclusive(async () => { if (!state.look || now() - state.look.at > 1500) await look(); });
        state.error = null;
      } catch (error) {
        state.error = message(error);
      }
    }
    return view();
  }

  // A page on screen renews a lease every 30 s; a pushed picture every 2 s while any lease holds.
  async function watch({ id = "resources", on = true } = {}) {
    const key = String(id).slice(0, 40) || "resources";
    if (on === false) { state.leases.delete(key); return { ok: true, watching: watched() }; }
    if (!state.leases.has(key) && state.leases.size >= LEASES) state.leases.delete(state.leases.keys().next().value);
    state.leases.set(key, now() + LEASE_MS);
    wake();
    return { ok: true, watching: true, leaseMs: LEASE_MS };
  }

  // A press on the page: one op on one app, made by you.
  async function act({ key, op } = {}) {
    if (!supported()) return { ok: false, error: unsupportedReason() };
    if (!rules.OPS.includes(op)) return { ok: false, error: "Studio does not know that action." };
    const appKey = rules.appKeyOf(key);
    if (!appKey) return { ok: false, error: "Studio does not know that app." };
    try {
      const outcome = await exclusive(async () => {
        await look();
        const app = appOf(appKey);
        if (!app) return { ok: false, error: `${nameOf(appKey)} is not running any more.` };
        if (app.protected) return { ok: false, error: app.protected.why };
        let entry;
        if (op === "restore") {
          mark(appKey).releasedAt = now();
          entry = await release(app, "all", "", "you");
          if (!entry) { unhold(appKey, "all"); entry = { text: `${app.name} was not changed.`, ok: true }; }
        } else {
          if (op === "pause" && app.foreground) return { ok: false, error: `${app.name} is the app in front of you; pausing it would freeze it while you use it.` };
          entry = await perform(app, op, "you", "", { press: true });
          if (!entry) entry = { text: op === "slow" ? `${app.name} is already slowed down.` : op === "pause" ? `${app.name} is already paused.` : `Nothing to do for ${app.name}.`, ok: true };
        }
        await look();
        return { ok: entry.ok !== false, text: entry.text, error: entry.ok === false ? entry.text : undefined };
      });
      push();
      wake();
      return outcome;
    } catch (error) {
      return { ok: false, error: `The resource helper could not do that: ${message(error)}` };
    }
  }

  // Focus now (manual mode): what auto mode would do while agents build, once, as your own holds.
  async function focus() {
    if (!supported()) return { ok: false, error: unsupportedReason() };
    try {
      const outcome = await exclusive(async () => {
        const settings = await prefs();
        const seen = await look();
        const decided = rules.plan({
          // Asked for now: what you put back earlier is not held against it.
          apps: seen.groups.apps, prefs: { ...settings, mode: "auto" }, building: { active: true, since: now(), waitingForMemory: false },
          memory: seen.snapshot.memory, marks: state.marks, snoozed: false, now: now(),
        });
        const steps = decided.apply.filter((step) => step.op !== "close").slice(0, STEPS_PER_TICK);
        let count = 0;
        for (const step of steps) {
          const app = appOf(step.key);
          if (app && !app.protected && await perform(app, step.op, "you", "", { press: true })) count += 1;
        }
        await look();
        return { ok: true, text: count ? `Made room: ${plural(count, "change")} to background apps.` : "Nothing heavy is running in the background." };
      });
      push();
      wake();
      return outcome;
    } catch (error) {
      return { ok: false, error: `The resource helper could not do that: ${message(error)}` };
    }
  }

  // Restore all: every app back as it was; auto holds off until the agents finish building.
  async function restoreAll({ quiet = false } = {}) {
    if (!supported()) return { ok: true, restored: 0 };
    if (!helper.child && !state.holds.size) return { ok: true, restored: 0 };
    try {
      const outcome = await exclusive(async () => {
        const reply = await request("restoreall");
        const restored = Number(reply?.restored) || 0;
        await writeJournal(Array.isArray(reply?.ledger) ? reply.ledger : []);
        for (const key of state.holds.keys()) mark(key).releasedAt = now();
        state.holds.clear();
        if (state.building.active && (state.prefs?.mode === "auto")) state.snoozed = true;
        if (!quiet) record({ text: restored ? `Put back ${plural(restored, "process", "processes")} Studio was holding.` : "Nothing was held.", by: "you", ok: true, op: "restore" });
        await look().catch(() => null);
        return { ok: true, restored };
      });
      push();
      wake();
      return outcome;
    } catch (error) {
      return { ok: false, error: `The resource helper could not put everything back: ${message(error)}` };
    }
  }

  async function setPrefs(patch = {}) {
    const current = await prefs({ fresh: true });
    const result = rules.applyPrefsPatch(current, patch);
    if (!result.ok) return result;
    let saved;
    try { saved = rules.normalizePrefs(await savePrefs(result.prefs)); }
    catch (error) { return { ok: false, error: `The setting could not be saved: ${message(error)}` }; }
    state.prefs = saved;
    state.prefsAt = now();
    // Leaving auto mode puts back what auto did; your own holds stay.
    if (current.mode === "auto" && saved.mode === "manual" && autoHeldAny()) {
      await exclusive(async () => {
        const seen = await look();
        for (const app of seen.groups.apps) {
          const hold = state.holds.get(app.key);
          if (hold?.slow?.by === "auto" || hold?.pause?.by === "auto") await release(app, "auto", "auto mode is off", "studio");
        }
      }).catch((error) => logLine(`[resources] ${message(error)}`));
    }
    if (current.mode !== saved.mode) record({ text: saved.mode === "auto" ? "Auto mode is on: Studio makes room while agents build." : "Manual mode: Studio changes nothing until you press a button.", by: "you", ok: true });
    push();
    wake();
    return { ok: true, prefs: saved };
  }

  // Launch: what a previous Studio left held goes back, and auto mode starts watching.
  async function start() {
    if (state.recovered) return;
    state.recovered = true;
    await prefs({ fresh: true });
    if (supported()) {
      const entries = await readJournal();
      if (entries.length) {
        await exclusive(() => adoptJournal({ putBack: true })).catch((error) => logLine(`[resources] could not put back what Studio held before: ${message(error)}`));
      }
    }
    wake();
  }

  // Before quitting: the helper puts everything back and exits (it would on its own once Studio is gone).
  function quit() {
    state.stopped = true;
    if (state.timer) { clearTimer(state.timer); state.timer = null; }
    const child = helper.child;
    if (!child) return;
    helper.stopping = true;
    try { child.stdin.end(`${helper.next++} exit\n`); } catch {}
  }

  // Tests and a disabled build: stop the timers and let the helper go.
  async function stop() {
    state.stopped = true;
    if (state.timer) { clearTimer(state.timer); state.timer = null; }
    await stopHelper();
  }

  // The few words other parts of Studio may read, without waking anything.
  function status() {
    const settings = state.prefs ?? rules.normalizePrefs({});
    return {
      supported: supported(),
      mode: settings.mode,
      level: settings.mode === "auto" ? state.decided.level : "manual",
      short: settings.mode === "auto" ? state.decided.short ?? null : null,
      held: state.holds.size,
      helper: Boolean(helper.child),
    };
  }

  // One pass of the loop now, without waiting for its timer (tests).
  const tickNow = () => loop();

  return { start, snapshot, watch, act, focus, restoreAll, setPrefs, status, quit, stop, view, tickNow };
}

module.exports = { createResourceHost, CADENCE };
