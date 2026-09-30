// The host wiring of attempt review: main.cjs's "Attempt review" block run over real throwaway
// git repositories and stand-ins for the preview window, the checks and the board, and the
// hooks in spawnNextJob (the start picture before the worker, the end picture at its finish,
// the merge-back that waits for them, a cancelled claim) run against the executor host fixture.
// What it pins: a run is recorded from start to end and never failed or held long by it; each
// of the three kill switches (setting and environment variable) stops its part and only its
// part; Accept records the owner's word on the card and nothing else; a whole-attempt Revert
// reopens the task through the status path, refuses first when the task cannot reopen, and
// nothing changes while a builder works in the folder; project gating; and the files a
// running builder reads its preview logs from.
//
// Run: node --test tests/attempt_review_host.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { executorHost } from "./fixtures/host_executor.mjs";

const require = createRequire(import.meta.url);
const { createAttemptSnapshots } = require("../scripts/attempt-snapshots-host.cjs");
const { createAttemptEvidence } = require("../scripts/attempt-evidence-host.cjs");
const { createAdvisoryChecks } = require("../scripts/advisory-checks-host.cjs");
const configs = require("../scripts/agent-tool-configs.cjs");
const backlog = require("../scripts/backlog.cjs");

const main = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const START = "// ---- Attempt review: before and after pictures, changed files, advisory checks and shots ----";
const END = "// ---- end of attempt review ----";
const from = main.indexOf(START);
const to = main.indexOf(END, from);
assert.ok(from >= 0 && to > from, "the Attempt review block is in main.cjs");
const block = main.slice(from, to + END.length);

const TASK = "task_0123456789abcdef";
const plain = (value) => JSON.parse(JSON.stringify(value));
const cleanup = (t, dir) => t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fakePng() {
  const header = Buffer.alloc(13); header.writeUInt32BE(1280, 0); header.writeUInt32BE(800, 4); header[8] = 8; header[9] = 2;
  const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8); return out; };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc(16, 7))), chunk("IEND", Buffer.alloc(0))]);
}
// A fake process for the checks: every command finishes at once with `script`'s answer.
const fakeSpawn = (script = () => ({ code: 0, out: "" })) => {
  const calls = [];
  return { calls, spawn: (command, args, options) => {
    calls.push({ command, args: [...args], options });
    const child = new EventEmitter();
    child.pid = 1; child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} }); child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    setImmediate(() => { const plan = script({ command, args }); if (plan.out) child.stdout.emit("data", plan.out); child.emit("close", plan.code, null); });
    return child;
  } };
};

// A project (a git repository), the block sliced out of main.cjs, and stand-ins for the rest of the host.
function review(t, { startCap = 25000, shotWait = 8000, endCap = 360000, settings = {}, tasks = null, scripts = {}, reopen = null, files = { "a.txt": "one\n", "b.txt": "two\n", "package.json": JSON.stringify({ scripts: { lint: "eslint ." } }) } } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "mefi-review-host-"));
  cleanup(t, base);
  const home = path.join(base, "home");
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, ".gitconfig"), "");
  const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  const root = path.join(base, "project");
  mkdirSync(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main", ".");
  for (const [key, value] of [["user.name", "Person"], ["user.email", "person@example.invalid"], ["commit.gpgsign", "false"]]) git("config", key, value);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(root, name), body);
  git("add", "-A"); git("commit", "-q", "-m", "First");
  const dataDir = path.join(base, "data", "projects", "p1");
  mkdirSync(dataDir, { recursive: true });
  const project = Object.freeze({ id: "p1", name: "Fixture", path: root });
  const board = tasks ?? [{ id: TASK, title: "Fix the thing", status: "done", prompt: "x" }];
  const state = { settings: structuredClone(settings), sent: [], logs: [], actions: [], handlers: new Map(), captures: [], jobs: [] };
  const preview = { status: { phase: "ready", url: "http://127.0.0.1:5173/" }, lines: ["vite ready", "compiled"] };
  const fake = fakeSpawn(scripts.check);
  const source = block.replace("const REVIEW_START_CAP_MS = 25000;", `const REVIEW_START_CAP_MS = ${startCap};`).replace("const REVIEW_SHOT_WAIT_MS = 8000;", `const REVIEW_SHOT_WAIT_MS = ${shotWait};`).replace("const REVIEW_END_CAP_MS = 6 * 60 * 1000;", `const REVIEW_END_CAP_MS = ${endCap};`);
  const context = vm.createContext({
    require: createRequire(new URL("../main.cjs", import.meta.url)), path, process, Buffer, console, setTimeout, clearTimeout, Promise, Date, JSON, Map, Set, Math, Number, String, Object, Array, Boolean, Error, RegExp, structuredClone,
    window: { isDestroyed: () => false },
    ipcMain: { handle: (channel, fn) => state.handlers.set(channel, fn) },
    projects: { run: (_project, fn) => fn(), current: () => project, active: () => project, open: () => project },
    projectRoot: () => root,
    projectDataPath: (file) => path.join(dataDir, path.basename(String(file))),
    TASKS_PATH: "tasks.json",
    logLine: (line) => state.logs.push(line), send: (channel, payload) => state.sent.push([channel, plain(payload)]),
    readSettings: async () => structuredClone(state.settings),
    updateSettings: async (mutate) => { mutate(state.settings); return state.settings; },
    autopilot: { jobs: state.jobs },
    getEyes: async () => ({ readJson: async () => structuredClone(board) }),
    mutateBoard: async (mutator) => { const patch = mutator({ tasks: board, requests: [], ideas: [] }) ?? {}; return patch.ok === false ? patch : { ...patch, ok: true, tasks: board }; },
    taskAction: async (payload) => {
      state.actions.push(plain(payload));
      if (reopen?.error) return { ok: false, error: reopen.error };
      const task = board.find((row) => row.id === payload.taskId);
      if (task && payload.action === "status" && payload.status === "open") task.status = "open";
      return { ok: true, task };
    },
    taskView: (task) => ({ ...task }),
    taskProjectError: (id) => (id && id !== project.id ? "The selected project changed. Reload the task before continuing." : null),
    backlog, agentToolConfigs: configs,
    projectPreviewManager: { status: async () => preview.status, tail: () => ({ lines: preview.lines }) }, projectPreviewQuit: false,
  });
  context.__snaps = createAttemptSnapshots({ env: () => env, disabled: () => vm.runInContext("!reviewPrefs().snapshots", context) });
  context.__evidence = createAttemptEvidence({ root: () => dataDir, capture: async (url, options) => { state.captures.push({ url, options }); return { ok: true, png: fakePng() }; }, now: () => Date.now() });
  context.__advisory = createAdvisoryChecks({ spawn: fake.spawn, platform: "linux", disabled: () => vm.runInContext("!reviewPrefs().advisory", context) });
  vm.runInContext(source, context);
  vm.runInContext("reviewHosts.snapshots = __snaps; reviewHosts.evidence = __evidence; reviewHosts.advisory = __advisory;", context);
  vm.runInContext("registerAttemptReviewIpc();", context);
  const evaluate = (code) => vm.runInContext(code, context);
  const call = async (channel, payload = {}) => plain(await state.handlers.get(channel)({}, { projectId: "p1", ...payload }));
  const refs = () => git("for-each-ref", "--format=%(refname)", "refs/mefi").split("\n").filter(Boolean).sort();
  const write = (name, body) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), body); };
  const entryFor = (id = "run_1_1", more = {}) => ({ id, project, projectId: project.id, projectPath: root, taskId: TASK, worktree: null, ...more });
  const job = { kind: "task", ref: { id: TASK } };
  const review = evaluate("attemptReview");
  const start = (entry) => { entry.attemptStart = review.begin(entry, job); return entry.attemptStart; };
  return { base, root, git, refs, write, project, board, state, preview, fake, context, evaluate, call, entryFor, job, review, start, dataDir, env, read: (name) => readFileSync(path.join(root, name), "utf8") };
}
const withEnv = async (name, value, run) => {
  const previous = process.env[name];
  process.env[name] = value;
  try { return await run(); } finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
};
const evidenceFiles = (h, n = 1) => { const dir = path.join(h.dataDir, "attempt-evidence", TASK, String(n)); return existsSync(dir) ? readFileSync(path.join(dir, "meta.json"), "utf8") && [...["before.png", "after.png", "checks.json", "meta.json"].filter((name) => existsSync(path.join(dir, name)))] : []; };

// ---- the wiring in main.cjs -------------------------------------------------------------------
test("eight project-gated channels, registered beside the other tasks:* ones, and the marked block is self-contained", () => {
  const channels = [...block.matchAll(/ipcMain\.handle\("([a-z:-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(channels, ["tasks:changes", "tasks:diff", "tasks:accept", "tasks:revert", "tasks:checks", "tasks:check-run", "tasks:evidence", "review:prefs"]);
  const prefixes = main.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(prefixes, /"tasks:"|"review:"/, "they act on the open project, so a project switch waits for them");
  assert.equal((main.match(/registerAttemptReviewIpc\(\);/g) ?? []).length, 1);
  assert.ok(main.indexOf('ipcMain.handle("tasks:action"') < main.indexOf("registerAttemptReviewIpc();") && main.indexOf("registerAttemptReviewIpc();") < main.indexOf('ipcMain.handle("tasks:save"'), "beside the tasks:* channels");
  assert.equal(main.split(START).length, 2, "one block, not two");
  assert.doesNotMatch(block, /"(?:push|fetch|pull)"|shell:\s*true/, "the block never reaches the network or a shell");
});

test("the executor reaches the block only through guarded hooks, in the order that makes the pictures honest", () => {
  const spawn = main.slice(main.indexOf("async function spawnNextJob("), main.indexOf("// A task run's saved context, as a small read-only file."));
  const at = (text, from = 0) => { const index = spawn.indexOf(text, from); assert.ok(index >= 0, text); return index; };
  const guarded = at('const reviewing = typeof attemptReview === "object" && attemptReview !== null ? attemptReview : null;');
  assert.ok(guarded < at("const cancelClaim"), "the guard exists before any gate can release a claim: vm-sliced hosts do not carry the block");
  assert.match(spawn, /const reviewHook = \(name, \.\.\.args\) => \{ try \{ return reviewing \? reviewing\[name\]\(\.\.\.args\) : null; \} catch \{ return null; \} \};/, "one door: a hook that throws is dropped here");
  const begun = at('entry.attemptStart = Promise.resolve(reviewHook("begin", entry, job)).catch(() => null);');
  assert.ok(at("worktreeManager.prepare({") < begun, "the picture is of the run's own checkout, so it starts after the checkout exists");
  assert.ok(begun < at("const settleEntryWorktree"), "…and is begun while the prompt is built");
  const waited = at("await entry.attemptStart;");
  assert.ok(begun < waited && waited < at("const finish = async") && waited < at("child = spawnAttempt(runRoute, cliRoute);"), "the worker is created only after the start picture is done or given up on, above the slices other suites take of finish()");
  assert.match(spawn, /await entry\.attemptStart;\s*if \(entry\.finished \|\| projectSwitching \|\| !launchAllowed\(entry\)\) \{[\s\S]*?await worktreeManager\.discard\(entry\.worktree\)[\s\S]*?await cancelClaim\("paused while the start picture was taken"\);\s*return "lost";/, "the gates are read again after the wait: a stop or pause that landed meanwhile cancels the claim");
  const ended = at('Promise.resolve(reviewHook("end", entry, { ok, userStop })).catch(() => {});');
  assert.ok(at("const ok = errorMessage == null") < ended && ended < at("const lastWords = executorCore.lastWords"), "the end picture begins as soon as the verdict is known, and is not awaited");
  assert.match(spawn, /Promise\.resolve\(reviewHook\("beforeMerge", entry\)\)\.catch\(\(\) => null\)\s*\.then\(\(\) => worktreeManager\.settle\(entry\.worktree\)\)/, "a worktree run's merge waits for the end picture, and a failure there never holds the merge");
  assert.match(spawn, /reviewHook\("afterMerge", entry, result\);/);
  assert.match(spawn, /\.finally\(\(\) => \{ reviewHook\("mergeDone", entry\); \}\)/);
  assert.match(spawn, /if \(entry\?\.attemptStart\) reviewHook\("discard", entry\);/, "a cancelled claim leaves no empty attempt");
  assert.match(spawn, /\.\.\.\(typeof reviewToolOptions === "function" \? reviewToolOptions\(entry\) : \{\}\)/, "a builder's tool folder carries run_check's switch and the preview log");
  assert.match(main, /onChange: \(state\) => \{ send\("project-preview:changed", state\); if \(typeof reviewMirrorPreviewLogs === "function"\) reviewMirrorPreviewLogs\(state\); \}/);
});

// ---- a run, start to end ---------------------------------------------------------------------
test("a run is recorded start to end: two pictures, two shots, the advisory checks, and the page is told each time", async (t) => {
  const h = review(t, { scripts: { check: () => ({ code: 0, out: "" }) } });
  const entry = h.entryFor();
  const answered = await h.start(entry);
  assert.equal(answered.n, 1);
  assert.deepEqual(h.refs(), [`refs/mefi/attempts/${TASK}/1/before`], "the start picture exists before the worker can start");
  assert.equal(h.state.captures.length, 1, "and so does the start shot");
  assert.equal(h.state.captures[0].url, "http://127.0.0.1:5173/");
  h.write("a.txt", "one\nthe worker's edit\n"); h.write("new.js", "x\n");
  const finished = await h.review.end(entry, { ok: true, userStop: false });
  assert.equal(finished.ended, true);
  assert.deepEqual(h.refs(), [`refs/mefi/attempts/${TASK}/1/after`, `refs/mefi/attempts/${TASK}/1/before`]);
  assert.equal(h.state.captures.length, 2, "the end shot");
  assert.deepEqual(evidenceFiles(h).sort(), ["after.png", "before.png", "checks.json", "meta.json"]);
  const saved = JSON.parse(readFileSync(path.join(h.dataDir, "attempt-evidence", TASK, "1", "checks.json"), "utf8"));
  assert.deepEqual(saved.results.map((row) => [row.id, row.status]), [["lint", "ok"]]);
  assert.equal(saved.runId, "run_1_1");
  assert.deepEqual(h.state.sent.filter(([channel]) => channel === "review:changed").map(([, payload]) => payload.what), ["started", "shot", "ended", "shot", "checks"]);
  assert.ok(h.state.sent.every(([, payload]) => payload.taskId === TASK && payload.attempt === 1 && payload.projectId === "p1"));
  assert.deepEqual(h.state.logs, [], "a clean run logs nothing");
  const again = h.entryFor("run_2_1");
  assert.equal((await h.start(again)).n, 2, "the next attempt is the next number");
});

test("checks look at a run that changed something and never at one the owner stopped; a run that changed nothing is not checked", async (t) => {
  const h = review(t);
  const quiet = h.entryFor("run_1_1");
  await h.start(quiet);
  await h.review.end(quiet, { ok: true });
  assert.equal(h.fake.calls.length, 0, "nothing changed, so nothing to check");
  const stopped = h.entryFor("run_2_1");
  await h.start(stopped);
  h.write("a.txt", "one\nedited\n");
  await h.review.end(stopped, { ok: false, userStop: true });
  assert.equal(h.fake.calls.length, 0, "a stop by the owner is not a run to check");
  assert.ok(existsSync(path.join(h.dataDir, "attempt-evidence", TASK, "2", "after.png")), "but its end shot is still taken");
  const failed = h.entryFor("run_3_1");
  await h.start(failed);
  h.write("a.txt", "one\nedited again\n");
  await h.review.end(failed, { ok: false, userStop: false });
  assert.equal(h.fake.calls.length, 1, "a failed run that changed files is checked: the person reads its result");
});

test("the run waits for the start picture but never longer than its cap, and nothing that goes wrong reaches the run", async (t) => {
  const h = review(t, { startCap: 80, endCap: 80 });
  h.evaluate("reviewHosts.snapshots = { begin: () => new Promise(() => {}), end: async () => ({ ok: true }), drop: async () => ({}) }");
  const entry = h.entryFor();
  const started = Date.now();
  assert.equal(await h.start(entry), null, "the worker starts without it");
  assert.ok(Date.now() - started < 2000, `the wait was bounded (${Date.now() - started} ms)`);
  assert.equal(await h.review.end(entry, { ok: true }), null, "and the end answers at its own cap, without throwing");
  assert.equal(h.state.logs.some((line) => /[\\/]Users[\\/]|\/home\/|\/tmp\//.test(line)), false, "no path of the person's in a log line");
  // A host that throws is a log line, not an error.
  const broken = review(t);
  broken.evaluate("reviewHosts.snapshots = { begin: async () => { throw Object.assign(new Error('boom /home/person/secret'), { code: 'EBOOM' }); }, end: async () => ({}), drop: async () => ({}) }");
  const answer = await broken.start(broken.entryFor());
  assert.equal(answer.n, 1, "with no picture the attempt still has its number (from the evidence folders)");
  assert.equal(answer.snapshots, false);
  assert.match(broken.state.logs.join("\n"), /\[review\] the start picture was not taken \(EBOOM\) run run_1_1/);
  assert.doesNotMatch(broken.state.logs.join("\n"), /secret|person/, "the message, which named a path, is never logged");
  const nothing = review(t);
  nothing.evaluate("reviewHosts.evidence = { numbers: async () => { throw new Error('disk gone'); } }");
  assert.equal(await nothing.start(nothing.entryFor()), null);
  assert.match(nothing.state.logs.join("\n"), /\[review\] the start of an attempt was not recorded \(Error\) run run_1_1$/m, "one line: what, the kind of failure and the run");
  assert.doesNotMatch(nothing.state.logs.join("\n"), /disk gone/, "a message is never logged, only its kind");
});

test("a shot that is slow is given up on, and the run does not wait for it; a late picture is never kept", async (t) => {
  const h = review(t, { shotWait: 60 });
  let release;
  h.context.__evidence = createAttemptEvidence({ root: () => h.dataDir, capture: () => new Promise((resolve) => { release = () => resolve({ ok: true, png: fakePng() }); }), now: () => Date.now() });
  h.evaluate("reviewHosts.evidence = __evidence");
  const entry = h.entryFor();
  const started = Date.now();
  await h.start(entry);
  assert.ok(Date.now() - started < 3000, "the run was not held for the picture");
  release();
  await delay(80);
  assert.equal(existsSync(path.join(h.dataDir, "attempt-evidence", TASK, "1", "before.png")), false);
  assert.match(readFileSync(path.join(h.dataDir, "attempt-evidence", TASK, "1", "meta.json"), "utf8"), /"state":"skipped".*"reason":"failed"/);
});

test("with no git and no preview an attempt has a number and nothing else, and the page is told why", async (t) => {
  const h = review(t);
  h.preview.status = { phase: "stopped", url: null };
  rmSync(path.join(h.root, ".git"), { recursive: true });
  const entry = h.entryFor();
  const answer = await h.start(entry);
  assert.deepEqual([answer.n, answer.snapshots], [1, false]);
  assert.equal(h.state.captures.length, 0);
  assert.match(readFileSync(path.join(h.dataDir, "attempt-evidence", TASK, "1", "meta.json"), "utf8"), /"reason":"no-preview"/);
  const changes = await h.call("tasks:changes", { taskId: TASK });
  assert.deepEqual([changes.ok, changes.available, changes.reason], [true, false, "not-a-repo"]);
  assert.match(changes.note, /not a Git repository/);
  const evidence = await h.call("tasks:evidence", { taskId: TASK });
  assert.equal(evidence.notes.before, "The preview was not running when this task started.");
  assert.deepEqual(evidence.shots, []);
  assert.equal(evidence.enabled, true);
});

// ---- the switches ------------------------------------------------------------------------------------
test("each of the three has a setting and an environment variable, and switching one off leaves the other two running", async (t) => {
  for (const [setting, variable, what] of [["snapshots", "MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS", "pictures"], ["shots", "MEFI_STUDIO_NO_EVIDENCE_SHOTS", "shots"], ["advisory", "MEFI_STUDIO_NO_ADVISORY_CHECKS", "checks"]]) {
    for (const via of ["setting", "environment"]) {
      const h = review(t, { settings: via === "setting" ? { review: { [setting]: false } } : {} });
      const run = async () => {
        const entry = h.entryFor();
        await h.start(entry);
        h.write("a.txt", `one\n${setting} ${via}\n`);
        await h.review.end(entry, { ok: true });
        return {
          refs: h.refs().length, shots: h.state.captures.length, checks: h.fake.calls.length,
        };
      };
      const seen = via === "setting" ? await run() : await withEnv(variable, "1", run);
      const expected = { refs: setting === "snapshots" ? 0 : 2, shots: setting === "shots" ? 0 : 2, checks: setting === "advisory" ? 0 : 1 };
      assert.deepEqual(seen, expected, `${what} off by ${via}: only they stop`);
    }
  }
  const off = review(t, { settings: { review: { snapshots: false } } });
  assert.deepEqual(await off.call("tasks:changes", { taskId: TASK }), { ok: true, available: false, reason: "off", forced: false, note: "Before-and-after snapshots are switched off on this PC.", taskId: TASK });
  assert.equal((await off.call("tasks:diff", { taskId: TASK, path: "a.txt" })).reason, "off");
  assert.equal((await off.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "attempt" })).reason, "off");
  await withEnv("MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS", "1", async () => {
    assert.equal((await off.call("tasks:changes", { taskId: TASK })).forced, true, "the environment's switch says it is forced");
  });
  const nothing = review(t, { settings: { review: { snapshots: false, shots: false, advisory: false } } });
  assert.equal(await nothing.start(nothing.entryFor()), null, "with all three off the run is not touched at all");
  assert.deepEqual([nothing.refs(), nothing.state.captures.length, existsSync(path.join(nothing.dataDir, "attempt-evidence"))], [[], 0, false]);
});

test("review:prefs reads and sets the four choices, refuses anything else, and shows what the environment forces", async (t) => {
  const h = review(t);
  const first = await h.call("review:prefs");
  assert.deepEqual(first.prefs, { snapshots: true, advisory: true, advisoryBuild: false, shots: true }, "the defaults: everything on but the build");
  const set = await h.call("review:prefs", { shots: false, advisoryBuild: true, stray: "x", snapshots: true });
  assert.deepEqual(set.prefs, { snapshots: true, advisory: true, advisoryBuild: true, shots: false });
  assert.deepEqual(plain(h.state.settings.review), { shots: false, advisoryBuild: true, snapshots: true }, "only the known keys are saved");
  assert.equal((await h.call("review:prefs", { shots: "no" })).ok, false);
  assert.equal((await h.call("review:prefs", { stray: true })).ok, false);
  await withEnv("MEFI_STUDIO_NO_EVIDENCE_SHOTS", "1", async () => {
    const forced = await h.call("review:prefs");
    assert.deepEqual([forced.prefs.shots, forced.forced.shots, forced.saved.shots], [false, true, false]);
  });
  await withEnv("MEFI_STUDIO_NO_ADVISORY_CHECKS", "1", async () => {
    assert.deepEqual([(await h.call("review:prefs")).prefs.advisory, (await h.call("review:prefs")).prefs.advisoryBuild], [false, false], "no advisory, no build");
  });
});

// ---- runs that share a folder or use their own -----------------------------------------------------------
test("runs working in the same folder say so in each other's pictures; runs in their own worktrees do not", async (t) => {
  const h = review(t);
  const a = h.entryFor("run_1_1");
  const b = h.entryFor("run_2_1", { taskId: "task_other" });
  h.state.jobs.push(a);
  h.state.jobs.push(b);
  await h.review.begin(a, job0(a));
  await h.review.begin(b, { kind: "task", ref: { id: "task_other" } });
  await h.review.end(a, { ok: true });
  await h.review.end(b, { ok: true });
  const message = (id, n, phase) => h.git("cat-file", "commit", `refs/mefi/attempts/${id}/${n}/${phase}`);
  assert.match(message(TASK, 1, "after"), /^Mefi-Overlap: run_2_1$/m, "the first run knows a second one was here");
  assert.match(message("task_other", 1, "before"), /^Mefi-Overlap: run_1_1$/m);
  const c = h.entryFor("run_3_1", { worktree: { path: path.join(h.root, ".mefi", "worktrees", "run_3_1") } });
  h.state.jobs.push(c);
  assert.deepEqual([...(c.attemptOverlap ?? [])], []);
  function job0(entry) { return { kind: "task", ref: { id: entry.taskId } }; }
});

test("a merge-back in progress keeps the project's folder busy, and a merged worktree run gets its end shot afterwards", async (t) => {
  const h = review(t);
  const entry = h.entryFor("run_1_1", { worktree: { path: path.join(h.root, ".mefi", "worktrees", "run_1_1"), root: h.root, branch: "mefi/run_1_1" } });
  mkdirSync(entry.worktree.path, { recursive: true });
  h.evaluate("reviewHosts.snapshots = { begin: async () => ({ ok: true, n: 1 }), end: async () => ({ ok: true, changed: true }), drop: async () => ({}) }");
  await h.review.begin(entry, h.job);
  assert.equal(h.state.captures.length, 1, "the start shot");
  const ended = h.review.end(entry, { ok: true });
  assert.equal(h.state.captures.length, 1, "a worktree run's end shot waits for its merge: the preview shows the project's folder");
  const gate = h.review.beforeMerge(entry);
  assert.equal(h.evaluate(`reviewBusy(${JSON.stringify(h.root)})`), true, "the project's folder is busy while it merges");
  await gate; await ended;
  h.review.afterMerge(entry, { merged: true });
  await delay(60);
  assert.equal(h.state.captures.length, 2, "merged: the preview shows it now");
  h.review.mergeDone(entry);
  assert.equal(h.evaluate(`reviewBusy(${JSON.stringify(h.root)})`), false);
  h.review.mergeDone(entry);
  assert.equal(h.evaluate(`reviewBusy(${JSON.stringify(h.root)})`), false, "a second release is harmless");
  // Not merged: the work is not where the preview looks.
  const kept = h.entryFor("run_2_1", { worktree: { path: path.join(h.root, ".mefi", "worktrees", "run_2_1"), root: h.root, branch: "mefi/run_2_1" } });
  h.evaluate("reviewHosts.snapshots = { begin: async () => ({ ok: true, n: 2 }), end: async () => ({ ok: true, changed: true }), drop: async () => ({}) }");
  await h.review.begin(kept, h.job);
  await h.review.end(kept, { ok: true });
  h.review.afterMerge(kept, { merged: false, reason: "conflict" });
  await delay(60);
  assert.equal(h.state.captures.length, 3, "no shot for work that is not in the folder");
  assert.match(readFileSync(path.join(h.dataDir, "attempt-evidence", TASK, "2", "meta.json"), "utf8"), /"after":\{"state":"skipped","reason":"not-merged"/);
});

test("a claim cancelled before its worker started drops the start picture it made, and an ended attempt keeps its own", async (t) => {
  const h = review(t);
  const cancelled = h.entryFor("run_1_1");
  await h.start(cancelled);
  assert.equal(h.refs().length, 1);
  assert.ok(existsSync(path.join(h.dataDir, "attempt-evidence", TASK, "1", "before.png")), "the start shot is there before the claim goes");
  h.review.discard(cancelled);
  await delay(300);
  assert.deepEqual(h.refs(), [], "no empty attempt is left to be the one the page shows");
  assert.equal(existsSync(path.join(h.dataDir, "attempt-evidence", TASK, "1")), false, "nor a start shot with nothing after it");
  assert.equal(h.state.sent.some(([channel, payload]) => channel === "review:changed" && payload.what === "dropped"), true, "and the page is told");
  const ran = h.entryFor("run_2_1");
  await h.start(ran);
  await h.review.end(ran, { ok: true });
  h.review.discard(ran);
  await delay(300);
  assert.equal(h.refs().length, 2, "an attempt that ended is not discarded");
  assert.ok(existsSync(path.join(h.dataDir, "attempt-evidence", TASK, "1", "after.png")) || existsSync(path.join(h.dataDir, "attempt-evidence", TASK, "2", "after.png")), "nor its shots");
});

// ---- what the page asks ---------------------------------------------------------------------------------
async function finished(h, { id = "run_1_1", change = (x) => x.write("a.txt", "one\nchanged\n"), ok = true } = {}) {
  const entry = h.entryFor(id);
  await h.start(entry);
  change(h);
  await h.review.end(entry, { ok });
  return entry;
}

test("tasks:changes carries the files, the attempts, what can be done and whether the owner accepted; diff reads one file", async (t) => {
  const h = review(t);
  await finished(h, { change: (x) => { x.write("a.txt", "one\nchanged\n"); x.write("new.js", "new\n"); } });
  const list = await h.call("tasks:changes", { taskId: TASK });
  assert.equal(list.ok, true);
  assert.deepEqual(list.files.map((file) => [file.path, file.status, file.state]), [["a.txt", "modified", "can-revert"], ["new.js", "added", "can-revert"]]);
  assert.deepEqual(list.totals, { files: 2, additions: 2, deletions: 0, binary: 0 });
  assert.deepEqual([list.state, list.attempt, list.canAccept, list.canRevert, list.waiting, list.running, list.accepted], ["ended", 1, true, true, false, false, false]);
  assert.deepEqual(list.attempts.map((row) => [row.n, row.accepted, row.running]), [[1, false, false]]);
  const diff = await h.call("tasks:diff", { taskId: TASK, attempt: 1, path: "a.txt" });
  assert.deepEqual(diff.lines.map((line) => line.k), ["h", " ", "+"]);
  assert.equal((await h.call("tasks:diff", { taskId: TASK, attempt: 1, path: "b.txt" })).ok, false);
  assert.equal((await h.call("tasks:changes", {})).ok, false, "a call with no task is refused");
  // A builder working in this folder: the list stays, what can be done waits.
  h.state.jobs.push({ id: "run_9_9", taskId: "task_other", finished: false, projectPath: h.root, worktree: null });
  const busy = await h.call("tasks:changes", { taskId: TASK });
  assert.deepEqual([busy.waiting, busy.canAccept, busy.canRevert, busy.files.length], [true, false, false, 2]);
  h.state.jobs.length = 0;
  // The task itself is running a new attempt.
  h.state.jobs.push({ id: "run_2_1", taskId: TASK, finished: false, projectPath: h.root, worktree: null });
  const live = await h.call("tasks:changes", { taskId: TASK });
  assert.equal(live.waiting, true);
});

test("Accept records the owner's word on the card and changes no other field; it waits for a running task and can be undone", async (t) => {
  const h = review(t);
  await finished(h);
  const before = structuredClone(h.board[0]);
  const accepted = await h.call("tasks:accept", { taskId: TASK, attempt: 1 });
  assert.deepEqual([accepted.ok, accepted.accepted, accepted.attempt], [true, true, 1]);
  const { acceptedAttempts, ...rest } = h.board[0];
  assert.deepEqual(rest, before, "not one other field moved, and the status did not change");
  assert.deepEqual(plain(acceptedAttempts).map(({ n, runId, by }) => [n, runId, by]), [[1, "run_1_1", "owner"]]);
  assert.equal((await h.call("tasks:changes", { taskId: TASK })).accepted, true);
  assert.deepEqual((await h.call("tasks:accept", { taskId: TASK, attempt: 1 })).ok, true);
  assert.equal(h.board[0].acceptedAttempts.length, 1, "accepting twice is one record");
  const undone = await h.call("tasks:accept", { taskId: TASK, attempt: 1, accepted: false });
  assert.deepEqual([undone.ok, undone.accepted, "acceptedAttempts" in h.board[0]], [true, false, false]);
  assert.equal((await h.call("tasks:accept", { taskId: TASK, attempt: 7 })).ok, false, "an attempt with no record cannot be accepted");
  assert.equal((await h.call("tasks:accept", { taskId: TASK })).ok, false);
  h.state.jobs.push({ id: "run_2_1", taskId: TASK, finished: false, projectPath: h.root, worktree: null });
  const waiting = await h.call("tasks:accept", { taskId: TASK, attempt: 1 });
  assert.deepEqual([waiting.ok, waiting.busy], [false, true]);
  assert.match(waiting.error, /waits until the task is paused or finished/);
});

test("Revert file puts back one file; Revert attempt puts back all, reopens the task through the status path and drops its Accept", async (t) => {
  const h = review(t);
  await finished(h, { change: (x) => { x.write("a.txt", "one\nchanged\n"); x.write("b.txt", "two\nchanged\n"); x.write("new.js", "new\n"); } });
  await h.call("tasks:accept", { taskId: TASK, attempt: 1 });
  const file = await h.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "file", path: "a.txt" });
  assert.deepEqual([file.ok, file.reverted, file.scope, file.reopened], [true, 1, "file", false]);
  assert.equal(h.read("a.txt"), "one\n");
  assert.equal(h.read("b.txt"), "two\nchanged\n");
  assert.deepEqual(h.state.actions, [], "a file's revert does not touch the task");
  assert.equal(h.board[0].acceptedAttempts.length, 1);
  assert.equal(h.board[0].status, "done");
  const whole = await h.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "attempt" });
  assert.equal(whole.ok, true, whole.error);
  assert.deepEqual([whole.reopened, whole.scope], [true, "attempt"]);
  assert.deepEqual(h.state.actions, [{ taskId: TASK, projectId: "p1", action: "status", status: "open" }], "the ordinary status path reopens it");
  assert.equal(h.board[0].status, "open");
  assert.equal("acceptedAttempts" in h.board[0], false, "the Accept for that attempt goes");
  assert.match(h.board[0].logs.at(-1).text, /^Attempt 1 reverted by you: \d+ files put back\. The task was reopened\.$/);
  assert.equal(h.read("b.txt"), "two\n");
  assert.equal(existsSync(path.join(h.root, "new.js")), false);
  assert.equal(h.git("status", "--porcelain").trim(), "");
  // Undo: the files come back, the task stays as it is.
  const undone = await h.call("tasks:revert", { taskId: TASK, attempt: 1, undo: whole.receipt });
  assert.deepEqual([undone.ok, undone.undo], [true, true]);
  assert.equal(h.read("b.txt"), "two\nchanged\n");
  assert.equal(h.state.actions.length, 1, "undo does not reopen or close anything");
  assert.equal((await h.call("tasks:revert", { taskId: TASK, attempt: 1 })).ok, false, "neither a file nor the attempt: nothing to do");
  assert.equal((await h.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "file" })).ok, false, "a file revert names its file");
});

test("a whole-attempt Revert refuses before touching a file when the task cannot reopen, and while anything works in the folder", async (t) => {
  for (const [patch, pattern] of [
    [{ status: "awaiting_verification" }, /being checked/],
    [{ status: "verifying" }, /being checked/],
    [{ status: "active", runId: "run_7_7" }, /has a worker/],
    [{ absorbedInto: "task_group" }, /belongs to a group/],
    [{ dependsOn: ["task_prerequisite"], status: "open" }, /Waiting for Prerequisite to finish successfully/],
  ]) {
    const extra = patch.dependsOn ? [{ id: "task_prerequisite", title: "Prerequisite", status: "open", prompt: "y" }] : [];
    const h = review(t, { tasks: [{ id: TASK, title: "Fix", status: "done", prompt: "x", ...patch }, ...extra] });
    await finished(h);
    const refused = await h.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "attempt" });
    assert.equal(refused.ok, false, JSON.stringify(patch));
    assert.equal(refused.blocked, true);
    assert.match(refused.error, pattern, JSON.stringify(patch));
    assert.equal(h.read("a.txt"), "one\nchanged\n", "no file was put back");
    assert.deepEqual(h.state.actions, []);
    if (!patch.dependsOn) {
      const one = await h.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "file", path: "a.txt" });
      assert.equal(one.ok, true, "one file can still go back: it never reopens anything");
    }
  }
  const h = review(t);
  await finished(h);
  h.state.jobs.push({ id: "run_9_9", taskId: TASK, finished: false, projectPath: h.root, worktree: null });
  const running = await h.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "file", path: "a.txt" });
  assert.deepEqual([running.ok, running.busy], [false, true]);
  h.state.jobs.length = 0;
  h.state.jobs.push({ id: "run_9_9", taskId: "task_other", finished: false, projectPath: h.root, worktree: null });
  const shared = await h.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "file", path: "a.txt" });
  assert.deepEqual([shared.ok, shared.busy], [false, true], "another task's builder in the same folder holds it too");
  assert.equal(h.read("a.txt"), "one\nchanged\n");
  h.state.jobs.length = 0;
  h.state.jobs.push({ id: "run_9_9", taskId: "task_other", finished: false, projectPath: h.root, worktree: { path: path.join(h.root, ".mefi", "worktrees", "run_9_9") } });
  assert.equal((await h.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "file", path: "a.txt" })).ok, true, "a builder in its own worktree is not in this folder");
  const edited = review(t);
  await finished(edited);
  edited.write("a.txt", "one\nchanged\nand edited since\n");
  const refusedFile = await edited.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "attempt" });
  assert.equal(refusedFile.ok, false);
  assert.match(refusedFile.error, /^Nothing was reverted\. 1 file has changed since the attempt ended: a\.txt\./);
  assert.deepEqual(edited.state.actions, [], "a refused revert does not reopen the task");
  const partial = await edited.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "attempt", partial: true });
  assert.equal(partial.ok, false, "nothing safe to put back: still refused");
});

test("a reopen that fails after the files are back says so, and the files stay back", async (t) => {
  const h = review(t, { reopen: { error: "Let verification finish, or confirm the completed work explicitly." } });
  await finished(h);
  const result = await h.call("tasks:revert", { taskId: TASK, attempt: 1, scope: "attempt" });
  assert.equal(result.ok, true);
  assert.deepEqual([result.reopened, result.reopenError], [false, "Let verification finish, or confirm the completed work explicitly."]);
  assert.equal(h.read("a.txt"), "one\n");
  assert.match(h.board[0].logs.at(-1).text, /put back\.$/);
});

test("every call is for the project the page asked about, and a project with nothing open answers plainly", async (t) => {
  const h = review(t);
  await finished(h);
  for (const channel of ["tasks:changes", "tasks:diff", "tasks:accept", "tasks:revert", "tasks:checks", "tasks:check-run", "tasks:evidence"]) {
    const answer = await h.call(channel, { taskId: TASK, attempt: 1, path: "a.txt", scope: "attempt", id: "lint", projectId: "some-other-project" });
    assert.deepEqual([answer.ok, /project changed/.test(answer.error)], [false, true], channel);
  }
  assert.equal(h.read("a.txt"), "one\nchanged\n", "nothing was touched");
  const closed = review(t);
  closed.evaluate("projects.open = () => null");
  assert.deepEqual(await closed.call("tasks:changes", { taskId: TASK }), { ok: false, error: "Open a project first." });
  const odd = await h.state.handlers.get("tasks:changes")({}, "not an object");
  assert.equal(odd.ok, false, "a payload that is not an object is refused, not thrown");
});

test("tasks:checks lists what the project has, then what an attempt's checks said; one can be run now", async (t) => {
  const h = review(t, { files: { "package.json": JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc --noEmit", build: "vite build" } }), "a.txt": "one\n" }, scripts: { check: ({ args }) => ({ code: args[1] === "lint" ? 1 : 0, out: args[1] === "lint" ? "✖ 3 problems (3 errors, 0 warnings)" : "" }) } });
  const nothingYet = await h.call("tasks:checks", { taskId: TASK });
  assert.equal(nothingYet.available, true);
  assert.deepEqual(nothingYet.results.map((row) => [row.id, row.status]), [["typecheck", "skipped"], ["lint", "skipped"], ["build", "skipped"]], "what the project has, not yet run");
  assert.deepEqual(nothingYet.detected.map((row) => [row.id, row.auto, row.writes]), [["typecheck", true, false], ["lint", true, false], ["build", false, true]]);
  assert.match(nothingYet.results[2].detail, /Run it now/);
  await finished(h);
  const ran = await h.call("tasks:checks", { taskId: TASK });
  assert.deepEqual(ran.results.map((row) => [row.id, row.status, row.detail]), [["typecheck", "ok", "0 errors"], ["lint", "bad", "3 errors"], ["build", "skipped", "Not run on its own, because a build writes files. Run it now."]], "the build did not run on its own: it says so");
  assert.equal(h.fake.calls.some((call) => call.args.includes("build")), false, "and no build process was started");
  assert.equal(ran.attempt, 1);
  assert.ok(ran.at > 0);
  assert.equal(ran.build, false);
  const build = await h.call("tasks:check-run", { taskId: TASK, id: "build" });
  assert.deepEqual([build.ok, build.result.id, build.result.status], [true, "build", "ok"]);
  assert.deepEqual(build.results.map((row) => row.id), ["typecheck", "lint", "build"]);
  assert.deepEqual((await h.call("tasks:checks", { taskId: TASK })).results.map((row) => row.id), ["typecheck", "lint", "build"], "kept with the attempt");
  assert.equal((await h.call("tasks:check-run", { taskId: TASK, id: "nope" })).ok, false);
  assert.equal((await h.call("tasks:check-run", { taskId: TASK, id: "../x" })).ok, false);
  h.state.jobs.push({ id: "run_9_9", taskId: "task_other", finished: false, projectPath: h.root, worktree: null });
  const refusedBuild = await h.call("tasks:check-run", { taskId: TASK, id: "build" });
  assert.deepEqual([refusedBuild.ok, refusedBuild.busy], [false, true], "a build writes files: not while a builder works here");
  assert.equal((await h.call("tasks:check-run", { taskId: TASK, id: "lint" })).ok, true, "a lint reads only");
  await withEnv("MEFI_STUDIO_NO_ADVISORY_CHECKS", "1", async () => {
    assert.deepEqual(await h.call("tasks:checks", { taskId: TASK }), { ok: true, available: false, reason: "off", forced: true, taskId: TASK });
    assert.equal((await h.call("tasks:check-run", { taskId: TASK, id: "lint" })).reason, "off");
  });
});

test("tasks:evidence returns each picture as a data URL, the words for a side with none, and the privacy line", async (t) => {
  const h = review(t);
  await finished(h);
  const read = await h.call("tasks:evidence", { taskId: TASK, attempt: 1 });
  assert.deepEqual(read.shots.map((shot) => [shot.phase, shot.width, shot.height]), [["before", 1280, 800], ["after", 1280, 800]]);
  assert.ok(read.shots.every((shot) => /^data:image\/png;base64,/.test(shot.dataUrl)));
  assert.equal(read.privacy, "Screenshots stay on this PC. They can show secrets, so they are never added to a problem report.");
  assert.deepEqual([read.enabled, read.forced, read.runId], [true, false, "run_1_1"]);
  assert.equal((await h.call("tasks:evidence", { taskId: TASK })).attempt, 1, "with no attempt named, the newest");
  assert.deepEqual((await h.call("tasks:evidence", { taskId: TASK, attempt: 5 })).shots, []);
  await withEnv("MEFI_STUDIO_NO_EVIDENCE_SHOTS", "1", async () => {
    const off = await h.call("tasks:evidence", { taskId: TASK });
    assert.deepEqual([off.enabled, off.forced], [false, true]);
  });
});

// ---- the files a builder reads its preview logs from ---------------------------------------------------------
test("a running builder's preview.log is replaced whole after a pause when the preview prints, for its own project only", async (t) => {
  const h = review(t);
  const dir = mkdtempSync(path.join(tmpdir(), "mefi-tools-fixture-"));
  cleanup(t, dir);
  const script = path.join(h.base, "tools.cjs");
  writeFileSync(script, "");
  const files = await configs.prepare({ root: h.root, settings: {}, script, dir, ...h.evaluate("reviewToolOptions({ project: { id: 'p1', path: " + JSON.stringify(h.root) + " } })") });
  t.after(() => configs.remove(files));
  assert.equal(readFileSync(files.logs, "utf8"), "vite ready\ncompiled\n", "the file starts with what Studio has captured");
  assert.deepEqual(plain(h.evaluate("reviewToolOptions({ project: { id: 'p1' } }).review")), { advisory: true });
  const job = { id: "run_1_1", projectId: "p1", project: h.project, finished: false, toolConfigs: files };
  const other = { id: "run_2_1", projectId: "p2", project: { id: "p2", path: h.root }, finished: false, toolConfigs: { ...files, logs: path.join(dir, "other.log"), folder: files.folder } };
  h.state.jobs.push(job, other);
  h.preview.lines = ["vite ready", "compiled", "page reloaded"];
  h.evaluate("reviewMirrorPreviewLogs({ projectId: 'p1' })");
  h.evaluate("reviewMirrorPreviewLogs({ projectId: 'p1' })");
  assert.equal(readFileSync(files.logs, "utf8"), "vite ready\ncompiled\n", "not at once: a burst of output is one write");
  await delay(900);
  assert.equal(readFileSync(files.logs, "utf8"), "vite ready\ncompiled\npage reloaded\n");
  assert.equal(existsSync(path.join(dir, "other.log")), false, "another project's run is not written to");
  const stamp = readFileSync(files.logs, "utf8");
  h.evaluate("reviewMirrorPreviewLogs({ projectId: 'p1' })");
  await delay(900);
  assert.equal(job.toolConfigs.logsSent, stamp, "unchanged output is not written again");
  job.finished = true;
  h.preview.lines = ["later"];
  h.evaluate("reviewMirrorPreviewLogs({ projectId: 'p1' })");
  await delay(900);
  assert.equal(readFileSync(files.logs, "utf8"), stamp, "a run that has ended is not written to");
  h.evaluate("reviewMirrorPreviewLogs(null)");
  h.preview.lines = [];
  assert.equal(h.evaluate("reviewLogsText({ id: 'p1', path: '/x' })"), "", "nothing captured is an empty file, which project_logs reports honestly");
  await withEnv("MEFI_STUDIO_NO_ADVISORY_CHECKS", "1", async () => {
    await h.call("review:prefs");
    assert.deepEqual(plain(h.evaluate("reviewToolOptions({ project: null }).review")), { advisory: false }, "a run that starts with the switch on gets no tools");
  });
});

// ---- the executor's hooks ---------------------------------------------------------------------------------------
const task = (id, extra = {}) => ({ id, title: `Implement hook fixture ${id}`, prompt: `Implement ${id} within its own module.`, status: "open", createdAt: 1, files: [`src/${id}.js`], ...extra });

test("the worker starts only after the start picture is done, and the end picture begins when the run ends", async () => {
  const h = executorHost({ tasks: [task("first")] });
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  h.env.attemptReview = {
    begin: (entry, job) => { calls.push(["begin", entry.id, job.ref.id, h.starts.length]); return gate.then(() => ({ n: 1 })); },
    end: (entry, info) => { calls.push(["end", entry.id, info.ok, info.userStop]); return Promise.resolve(null); },
    beforeMerge: () => Promise.resolve(), afterMerge() {}, mergeDone() {}, discard() {},
  };
  h.wake();
  const pumping = h.pump();
  for (let turn = 0; turn < 60; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, "begun while the claim is made");
  assert.equal(h.starts.length, 0, "and the worker is held until it answers");
  release();
  await pumping;
  assert.equal(h.starts.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ["begin", h.autopilot.jobs[0].id, "first"]);
  await h.finish("first");
  assert.deepEqual(calls[1], ["end", calls[0][1], true, false]);
  assert.equal(calls.length, 2);
});

test("a start picture that fails, or an end picture that throws, never fails the run", async () => {
  const h = executorHost({ tasks: [task("first"), task("second", { createdAt: 2 })], parallel: 2 });
  h.env.attemptReview = {
    begin: (entry) => (entry.taskId === "first" ? Promise.reject(new Error("no picture")) : Promise.resolve(null)),
    end: () => Promise.reject(new Error("no end picture")), beforeMerge: () => Promise.resolve(), afterMerge() {}, mergeDone() {}, discard() {},
  };
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 2, "both workers started");
  const done = await h.finish("first");
  assert.equal(done.entry.finished, true);
  assert.equal(h.board().tasks.find((row) => row.id === "first").status, "awaiting_verification", "the run settled as it always does");
  await h.finish("second", { code: 1, lines: ["it broke"] });
  assert.equal(h.autopilot.jobs.length, 0);
});

test("a run the owner stopped, or one that failed, tells the end hook which", async () => {
  const h = executorHost({ tasks: [task("first"), task("second", { createdAt: 2 })], parallel: 2 });
  const ends = [];
  h.env.attemptReview = { begin: () => Promise.resolve({ n: 1 }), end: (entry, info) => { ends.push([entry.taskId, info.ok, info.userStop]); return Promise.resolve(null); }, beforeMerge: () => Promise.resolve(), afterMerge() {}, mergeDone() {}, discard() {} };
  h.wake(); await h.pump();
  h.autopilot.jobs.find((job) => job.taskId === "first").stopUser = true;
  await h.finish("first", { code: 1, lines: [] });
  await h.finish("second", { code: 1, lines: ["no sentinel"] });
  assert.deepEqual(ends.sort(), [["first", false, true], ["second", false, false]]);
});

test("a stop or a pause that lands while the start picture is taken cancels the claim, and no worker is created", async () => {
  for (const landing of ["stop", "pause"]) {
    const h = executorHost({ tasks: [task("first")] });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const discarded = [];
    h.env.attemptReview = {
      begin: () => gate.then(() => ({ n: 1 })), end: () => Promise.resolve(null), beforeMerge: () => Promise.resolve(), afterMerge() {}, mergeDone() {},
      discard: (entry) => discarded.push(entry.taskId),
    };
    h.wake();
    const pumping = h.pump();
    for (let turn = 0; turn < 60; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    const entry = h.autopilot.jobs[0];
    assert.ok(entry && h.starts.length === 0, `${landing}: the claim is made and the worker waits`);
    if (landing === "stop") await entry.reap(1, "stopped by you");
    else h.state.status = "paused";
    release();
    await pumping;
    for (let turn = 0; turn < 30; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    // A stopped card is open again, so the foreman may claim it anew: what matters is that THIS claim never got a worker.
    assert.equal(h.starts.some((start) => start.runId === entry.id), false, `${landing}: no worker for a claim that was released while it waited`);
    assert.equal(entry.child, null, `${landing}: and no child on the entry`);
    assert.equal(entry.finished, true, `${landing}: the claim is released`);
    assert.ok(discarded.length >= 1 && discarded.every((id) => id === "first"), `${landing}: its start picture is dropped`);
    if (landing === "pause") {
      assert.equal(h.starts.length, 0, "pause: nothing starts while paused");
      assert.equal(h.board().tasks[0].status, "open", "pause: the card is back in the queue");
    }
  }
});

test("a worktree run's merge-back waits for the end picture, and the hooks bracket it", async () => {
  const h = executorHost({ tasks: [task("first")] });
  const order = [];
  let releaseEnd;
  // The harness's process double expects the project's own folder; this run's checkout is its own.
  const spawnAt = h.env.spawn;
  h.env.spawn = (command, args, options) => spawnAt(command, args, command === "cmd.exe" ? { ...options, cwd: h.env.projectRoot() } : options);
  h.env.executorWorktrees = {
    enabled: () => true,
    prepare: async ({ root, runId }) => ({ root, path: `${root}/.mefi/worktrees/${runId}`, branch: `mefi/${runId}`, runId }),
    discard: async () => ({ discarded: true }),
    settle: async (worktree) => { order.push("settle"); return { merged: true, worktree: worktree.branch }; },
  };
  h.env.attemptReview = {
    begin: () => Promise.resolve({ n: 1 }), end: () => Promise.resolve(null), discard() {},
    beforeMerge: () => { order.push("beforeMerge"); return new Promise((resolve) => { releaseEnd = resolve; }); },
    afterMerge: (entry, result) => order.push(["afterMerge", result.merged]), mergeDone: () => order.push("mergeDone"),
  };
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  await h.finish("first");
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["beforeMerge"], "the merge waits for the end picture, the checks and the shot");
  releaseEnd();
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["beforeMerge", "settle", ["afterMerge", true], "mergeDone"]);
});

test("a claim released before the worker started is discarded, and a host without the block runs exactly as before", async () => {
  const h = executorHost({ tasks: [task("unreadable")] });
  const discarded = [];
  h.env.attemptReview = { begin: () => Promise.resolve(null), end: () => Promise.resolve(null), beforeMerge: () => Promise.resolve(), afterMerge() {}, mergeDone() {}, discard: (entry) => discarded.push(entry.taskId) };
  h.env.taskContext = { ...h.env.taskContext, buildTaskHandoff: () => { throw new Error("fixture brief is unreadable"); } };
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 0);
  assert.deepEqual(discarded, ["unreadable"], "the prompt could not be built: the claim went back, and so did its picture");
  const plain = executorHost({ tasks: [task("first")] });
  plain.wake(); await plain.pump();
  assert.equal(plain.starts.length, 1, "no attemptReview at all: a vm-sliced host is inert here");
  await plain.finish("first");
  assert.equal(plain.autopilot.jobs.length, 0);
});
