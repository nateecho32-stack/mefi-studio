// Finishing a run after the process died (docs/plans/scratch-tier.md WP0-C):
// when the previous attempt's CLI session matches the route, the next attempt
// resumes it with a short recovery prompt (executorResume.resumable,
// recoveryPrompt); otherwise, or when the resumed process exits without a
// word, today's brief runs as one ordinary attempt. The kill switches keep
// today's behaviour. The host half runs on the real dispatch path
// (spawnNextJob in the executor host fixture, with the "live progress" and
// "Run journal" blocks loaded beside it); no real CLI, file or model request.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { executorHost } from "./fixtures/host_executor.mjs";

const require = createRequire(import.meta.url);
const executorResume = require("../scripts/executor-resume.cjs");
const executorCore = require("../scripts/executor-core.cjs");
const cliStream = require("../scripts/cli-stream.cjs");
const { resumable, resumeEnabled, recoveryPrompt, RECOVERY_MAX } = executorResume;

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const liveBlock = section("// ---- live progress: Claude Code and Codex runs as event streams", "// ---- end of live progress");
const journalBlock = section("// ---- Run journal ----", "// ---- end of the run journal ----");
const filters = section("function cliModelArg(", "// The Claude Code CLI as an assistant route");
const ID = "0f8d6c1e-5b8a-4a51-9a33-9d0c2f3e4b5a";

// ---- the rules ----------------------------------------------------------------------

test("resumable: the same CLI, model, login and folder resume; anything else falls through with a reason", () => {
  const saved = { runId: "run_1_1", cliSession: { cli: "claude", id: ID, model: "haiku", account: "work", cwd: "C:\\Repo\\app" } };
  const route = { cli: "claude", model: "haiku", account: "work", cwd: "c:/repo/app/" };
  assert.deepEqual(resumable(saved, route), { ok: true, cli: "claude", id: ID }, "separators and case never make a folder different");
  assert.equal(resumable(saved, { ...route, model: "sonnet" }).reason, "model changed");
  assert.equal(resumable(saved, { ...route, account: "home" }).reason, "login changed");
  assert.equal(resumable(saved, { ...route, cwd: "C:/other" }).reason, "folder changed");
  assert.match(resumable(saved, { ...route, cli: "codex" }).reason, /the session is claude, the route is codex/);
  assert.equal(resumable(saved, { ...route, cwd: null }).ok, true, "a route without a folder is compared on the rest");
  assert.deepEqual(resumable({ cliSession: { cli: "codex", id: "thread_7", model: "gpt-6", account: null, cwd: null } }, { cli: "codex", model: "gpt-6", account: null }), { ok: true, cli: "codex", id: "thread_7" });
  assert.equal(resumable({ cliSession: { cli: "grok", id: "g1", model: "grok-4" } }, { cli: "grok", model: "grok-4" }).reason, "grok has no resume");
  assert.equal(resumable({ cliSession: { cli: "claude", id: "x && del", model: "haiku" } }, { cli: "claude", model: "haiku" }).reason, "session id not usable");
  assert.deepEqual(resumable({ sessionId: "ses_abc123" }, { cli: "opencode", modelArgs: " --model x" }), { ok: true, cli: "opencode", id: "ses_abc123" }, "an OpenCode run resumes its store session");
  assert.deepEqual(resumable({ sessionId: "ses_abc123" }, {}), { ok: true, cli: "opencode", id: "ses_abc123" });
  assert.equal(resumable({ sessionId: "ses_abc123", cwd: "C:/a" }, { cli: "opencode", cwd: "C:/b" }).reason, "folder changed");
  assert.equal(resumable({ runId: "run_1_1" }, route).reason, "no session to resume");
  assert.equal(resumable(null, route).reason, "no checkpoint");
  assert.equal(resumable({ runId: "run_1_1" }, { cli: "antigravity" }).reason, "antigravity has no resume");
});

test("the recovery prompt is short, budgeted, and says what matters", () => {
  const saved = { runId: "run_1_1", progress: 0.5, todos: [{ content: "Read the brief", status: "completed" }, { content: "Fix the bug", status: "in_progress" }, { content: "Run the tests", status: "pending" }] };
  const prompt = recoveryPrompt(saved, { reason: "the PC went to sleep" });
  assert.ok(prompt.length <= RECOVERY_MAX);
  assert.match(prompt, /^CONTINUE INTERRUPTED WORK IN THIS SAME SESSION\. Your previous run \(run_1_1\) was interrupted \(the PC went to sleep\); this resumes it\./);
  assert.match(prompt, /Last reported progress: 50%/);
  assert.match(prompt, /Done: Read the brief\./);
  assert.match(prompt, /Still open: \[in progress\] Fix the bug; Run the tests\./);
  assert.match(prompt, /workspace is as you left it/);
  assert.match(prompt, /do not repeat commits that are already in `git log`/);
  assert.match(prompt, /MEFI_RESULT: line .* and print MEFI_JOB_DONE on its own line/);
  const many = { runId: "run_1_1", todos: Array.from({ length: 60 }, (_, index) => ({ content: `Step ${index} ${"detail ".repeat(12)}`, status: index < 30 ? "completed" : "pending" })) };
  const long = recoveryPrompt(many, { reason: "x".repeat(500) });
  assert.equal(long.length <= RECOVERY_MAX, true, "the todo list gives way, never the rules");
  assert.match(long, /do not repeat commits/);
  assert.match(long, /print MEFI_JOB_DONE on its own line/);
  assert.equal(recoveryPrompt(null).startsWith("CONTINUE INTERRUPTED WORK IN THIS SAME SESSION. Your previous run was interrupted; this resumes it."), true);
  assert.equal(RECOVERY_MAX, 1200);
});

test("the kill switches: MEFI_STUDIO_NO_SESSION_RESUME=1 or settings.executor.resumeSessions false", () => {
  assert.equal(resumeEnabled(null, {}), true);
  assert.equal(resumeEnabled({ executor: { resumeSessions: false } }, {}), false);
  assert.equal(resumeEnabled({ executor: { resumeSessions: true } }, { MEFI_STUDIO_NO_SESSION_RESUME: "1" }), false);
  assert.equal(resumeEnabled({}, { MEFI_STUDIO_NO_SESSION_RESUME: "0" }), true);
});

test("a resumed attempt is named on the card's log, and an outage never counts against it", () => {
  const run = { id: "run_2_1", startedAt: 1, sawDone: false, spoke: true, handoffs: [], calls: new Set(), issues: [], outputTail: [], outputLog: [], resumedSession: { id: ID, cli: "claude", reason: "the PC went to sleep" } };
  const attempt = { runId: "run_2_1", at: 2 };
  const row = executorCore.settleAttemptRow({ id: "t1", title: "Fix", status: "active", runId: "run_2_1" },
    { ok: false, providerOutage: true, providerSaid: true, code: 1, lastWords: "rate limit reached", attempt, run },
    { now: 10, maxHandoffs: 3, startGrace: 5, clip: (text) => text });
  assert.equal(row.runFailures, undefined, "a provider outage charges nothing");
  assert.equal(row.status, "open");
  assert.deepEqual(row.logs[0], { at: 10, kind: "resumed", text: `resumed session ${ID} after the PC went to sleep` });
  assert.match(row.logs[1].text, /provider unavailable/);
  const fell = executorCore.settleAttemptRow({ id: "t1", title: "Fix", status: "active", runId: "run_2_1" },
    { ok: true, code: 0, attempt, run: { ...run, sawDone: true, resumedSession: { ...run.resumedSession, fellBack: true } } },
    { now: 11, maxHandoffs: 3, startGrace: 5, clip: (text) => text });
  assert.match(fell.logs[0].text, /it said nothing, so one ordinary attempt followed/);
  assert.equal(fell.status, "awaiting_verification");
});

// ---- the host: spawnNextJob resumes, falls back, or keeps today's brief ----

const card = (over = {}) => ({
  id: "rs", title: "Fixture card rs", prompt: "Build rs as its brief says.", status: "open", createdAt: 1, files: ["src/rs.js"],
  runProgress: { version: 1, runId: "run_1_1", pending: true, interruptedAt: 5, startedAt: 1, scope: null, progress: 0.5,
    todos: [{ content: "Read", status: "completed" }, { content: "Fix", status: "in_progress" }], outputTail: ["$ npm test"],
    cliSession: { cli: "claude", id: ID, model: "sonnet", account: null, cwd: null } },
  lastRunError: "exit 137",
  ...over,
});
const opencodeFallback = { cli: "opencode", via: "opencode default", modelArgs: "", env: {} };
function resumeHost({ env = {}, settings = null, task = card(), route = { via: "claude cli", cli: "claude", model: "sonnet", modelArgs: "", env: {}, opencode: opencodeFallback } } = {}) {
  const h = executorHost({ tasks: [task], ...(settings ? { savedSettings: settings } : {}) });
  vm.runInContext(filters, h.env);
  h.env.executorRunEnv = async () => route;
  h.env.cliStream = cliStream;
  // The journal itself stays off here (its own suite): only the session resume runs.
  h.env.process = { ...h.env.process, platform: "win32", env: { MEFI_STUDIO_NO_RUN_ADOPT: "1", ...env } };
  h.env.require = (name) => require(`../${name.replace(/^\.\//, "")}`);
  h.env.optionalHelper = (_name, load) => load();
  h.env.app = { getPath: () => "C:\\fx\\userData" };
  h.env.os = { homedir: () => "C:\\fx\\home" };
  const launches = [];
  const spawn = h.env.spawn;
  h.env.spawn = (command, args, options) => { if (command === "cmd.exe") launches.push({ command, args, options }); return spawn(command, args, options); };
  vm.runInContext(liveBlock, h.env);
  vm.runInContext(journalBlock, h.env);
  return { h, launches };
}

test("the next attempt resumes the saved Claude session with the recovery prompt, and the card's log says so", async () => {
  const { h, launches } = resumeHost();
  assert.equal(await h.env.spawnNextJob(), "spawned");
  const entry = h.autopilot.jobs[0];
  assert.deepEqual({ ...entry.resumedSession }, { id: ID, cli: "claude", reason: "exit 137" });
  assert.equal(entry.liveStream.resume, ID, "the decoder is told which session to expect back");
  assert.match(launches[0].args[3], new RegExp(`--resume ${ID} --dangerously-skip-permissions`));
  assert.doesNotMatch(launches[0].args[3], /--session-id/, "no new session id beside a resume");
  const prompt = h.starts[0].child.prompt;
  assert.match(prompt, /^CONTINUE INTERRUPTED WORK IN THIS SAME SESSION\. Your previous run \(run_1_1\) was interrupted \(exit 137\)/);
  assert.match(prompt, /Still open: \[in progress\] Fix\./);
  assert.ok(prompt.length <= RECOVERY_MAX, "the recovery prompt, not the brief");
  assert.ok(h.records.some((record) => record.event === "resume" && record.kind === "resumed" && record.session === ID), "executor-log names the resumed attempt");
  const stream = (...events) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  entry.child.stdout.emit("data", stream(
    { type: "system", subtype: "init", session_id: ID, model: "claude-sonnet-4-5" },
    { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "Finished.\nMEFI_RESULT: done: fixed; remaining: none\nMEFI_JOB_DONE" }] } },
  ));
  assert.equal(entry.cliSession.resumed, true);
  assert.equal(entry.sawDone, true);
  await h.finish("rs", { lines: [] });
  const row = h.board().tasks.find((item) => item.id === "rs");
  assert.equal(row.status, "awaiting_verification");
  assert.ok(row.logs.some((line) => line.kind === "resumed" && line.text === `resumed session ${ID} after exit 137`));
  assert.equal(row.lastAttempt.cliSession.resumed, true);
});

test("a resumed session that exits without a word runs once more with the full brief, counted once", async () => {
  const { h, launches } = resumeHost();
  assert.equal(await h.env.spawnNextJob(), "spawned");
  const entry = h.autopilot.jobs[0];
  const first = h.starts[0].child;
  first.emit("close", 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(h.starts.length, 2, "one ordinary attempt follows");
  assert.equal(h.autopilot.jobs.length, 1, "on the same claim");
  assert.equal(entry.resumeSession, null);
  assert.equal(entry.resumedSession.fellBack, true);
  assert.doesNotMatch(launches[1].args[3], /--resume/);
  assert.match(launches[1].args[3], /--session-id/, "a fresh session for the full brief");
  assert.match(h.starts[1].child.prompt, /CONTINUE INTERRUPTED WORK\. Previous run: run_1_1\./, "today's brief, with the saved progress quoted");
  assert.ok(h.starts[1].child.prompt.length > RECOVERY_MAX);
  assert.equal(entry.child, h.starts[1].child);
  assert.ok(h.logs.some((line) => /exited 1 before speaking .* retrying "Fixture card rs" with the full brief/.test(line)));
  entry.child.stdout.emit("data", "MEFI_JOB_DONE\n");
  await h.finish("rs", { lines: [] });
  const row = h.board().tasks.find((item) => item.id === "rs");
  assert.equal(row.status, "awaiting_verification");
  assert.equal(h.records.filter((record) => record.event === "finish").length, 1, "one attempt, one finish");
  assert.ok(row.logs.some((line) => line.kind === "resumed" && /it said nothing, so one ordinary attempt followed/.test(line.text)));
});

test("a route that does not match, or the switch off, keeps today's brief", async () => {
  const other = resumeHost({ route: { via: "claude cli", cli: "claude", model: "opus", modelArgs: "", env: {}, opencode: opencodeFallback } });
  assert.equal(await other.h.env.spawnNextJob(), "spawned");
  assert.equal(other.h.autopilot.jobs[0].resumedSession, undefined);
  assert.match(other.launches[0].args[3], /--session-id/);
  assert.match(other.h.starts[0].child.prompt, /CONTINUE INTERRUPTED WORK\. Previous run: run_1_1\./);
  assert.ok(other.h.logs.some((line) => /not resuming the last session of "Fixture card rs": model changed/.test(line)));
  const off = resumeHost({ env: { MEFI_STUDIO_NO_SESSION_RESUME: "1" } });
  assert.equal(await off.h.env.spawnNextJob(), "spawned");
  assert.doesNotMatch(off.launches[0].args[3], /--resume/);
  assert.match(off.h.starts[0].child.prompt, /CONTINUE INTERRUPTED WORK\. Previous run: run_1_1\./);
  const setting = resumeHost({ settings: { executor: { resumeSessions: false }, ui: { autopilot: { enabled: true, execute: true, autoBuild: true, mode: "swarm", parallel: 1, adaptiveParallel: false, minutes: 5 } } } });
  assert.equal(await setting.h.env.spawnNextJob(), "spawned");
  assert.doesNotMatch(setting.launches[0].args[3], /--resume/);
  const fresh = resumeHost({ task: { ...card(), runProgress: undefined } });
  assert.equal(await fresh.h.env.spawnNextJob(), "spawned");
  assert.doesNotMatch(fresh.launches[0].args[3], /--resume/, "nothing to resume on a first attempt");
});
