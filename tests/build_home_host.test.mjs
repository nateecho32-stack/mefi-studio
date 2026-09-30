// Build's Home, the host's half: main.cjs's work:stats, work:where and
// work:worktrees handlers, and the three preload calls that reach them. The
// handler block is sliced out of main.cjs between its own two comments and run
// in a vm against stand-in collaborators (the ledgers, the board, the git look,
// the settings file); the pure module and the usage merge are the real ones.
// Nothing reads the network, a repository or the wall clock.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const worktrees = require("../scripts/executor-worktrees.cjs");
const workStats = require("../scripts/work-stats.cjs");
const { mergeLedgers } = require("../scripts/usage-tracker.cjs");

const START = "  // Build's Home (renderer/builder.js). The greeting card counts tasks, runs,";
const END = "  // The account read is separate from the ledger: it can be unavailable while";
const from = main.indexOf(START);
assert.ok(from > 0, "main.cjs holds Build's Home handlers under their comment");
const handlers = main.slice(from, main.indexOf(END, from));
assert.ok(handlers.includes('ipcMain.handle("work:stats"') && handlers.includes('ipcMain.handle("work:where"') && handlers.includes('ipcMain.handle("work:worktrees"'), "and all three are inside it");

const clean = (value) => JSON.parse(JSON.stringify(value));
const DAY = 86400000;
// A fixed "now": nothing in this file reads the clock.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const ago = (days) => NOW - days * DAY;
const line = (row) => `${JSON.stringify(row)}\n`;

async function host({ ledger = "", ledgerError = null, observations = [], store = { ok: true, rows: [] }, tasks = [], settings = {}, look = { top: null }, lookError = null, settingsError = null, project = { id: "p1", path: "/work/snake" } } = {}) {
  const found = new Map();
  const calls = { ledger: 0, tasks: 0, reach: [], look: [] };
  const clock = { now: NOW };
  const state = { settings: structuredClone(settings), project };
  const context = vm.createContext({
    ipcMain: { handle: (channel, fn) => found.set(channel, fn) },
    projects: { current: () => state.project },
    projectDataPath: (file) => file,
    EXECUTOR_LOG_PATH: "executor-log.jsonl",
    TASKS_PATH: "tasks.json",
    readFile: async () => { calls.ledger += 1; if (ledgerError) throw ledgerError; return ledger; },
    getEyes: async () => ({ readJson: async () => { calls.tasks += 1; return tasks; } }),
    modelPerformanceStore: () => ({ read: async () => ({ observations }) }),
    codingSessionUsage: async (_now, days) => { calls.reach.push(days); return store; },
    USAGE_LEDGER_DAYS: 35,
    mergeLedgers, workStats, executorWorktrees: worktrees,
    outsideWorkLook: async (dir) => { calls.look.push(dir); if (lookError) throw lookError; return look; },
    updateSettings: async (mutate) => { const next = structuredClone(state.settings); mutate(next); state.settings = structuredClone(next); return structuredClone(next); },
    readSettings: async () => { if (settingsError) throw settingsError; return structuredClone(state.settings); },
    process,
    Date: class extends Date { constructor(...args) { if (args.length) super(...args); else super(clock.now); } static now() { return clock.now; } },
  });
  vm.runInContext(handlers, context);
  await new Promise((resolve) => setImmediate(resolve));
  const call = (channel, payload) => found.get(channel)({}, payload);
  return { state, calls, clock, call, channels: [...found.keys()] };
}

test.afterEach(() => { worktrees.prefer(false); });

test("main registers the three Build's Home channels, and the preload reaches them", async () => {
  const h = await host();
  assert.deepEqual(h.channels, ["work:stats", "work:where", "work:worktrees"]);
  const api = vm.runInNewContext(`({ ${["workStats", "workWhere", "workWorktrees"].map((name) => preload.match(new RegExp(`^  ${name}: .*$`, "m"))[0]).join("\n")} })`, {
    ipcRenderer: { invoke: (channel, payload) => ({ channel, payload }) },
  });
  assert.deepEqual(clean(api.workStats()), { channel: "work:stats", payload: { range: "all" } });
  assert.deepEqual(clean(api.workStats({ range: "30d" })), { channel: "work:stats", payload: { range: "30d" } });
  assert.deepEqual(clean(api.workStats({ range: "7d", projectId: "elsewhere" })), { channel: "work:stats", payload: { range: "7d" } }, "only the range crosses");
  for (const range of ["1y", "ALL", "", null, 30, {}]) assert.equal(api.workStats({ range }).payload.range, "all", `${JSON.stringify(range)} asks for All`);
  assert.deepEqual(clean(api.workWhere()), { channel: "work:where", payload: {} });
  assert.deepEqual(clean(api.workWorktrees(true)), { channel: "work:worktrees", payload: { on: true } });
  for (const not of [false, "true", 1, "yes", null, undefined]) assert.equal(api.workWorktrees(not).payload.on, false, `${JSON.stringify(not)} is not a yes`);
});

test("work:stats counts this project's ledgers over the range asked, and reads coding turns as far back as the heatmap", async () => {
  const ledger = [
    line({ at: ago(2), event: "start", runId: "r1", kind: "task", task: "t1", via: "claude cli · main · heavy tier (opus)" }), line({ at: ago(2) + 60000, event: "finish", runId: "r1", ok: true, seconds: 60 }),
    line({ at: ago(3), event: "start", runId: "r2", kind: "task", task: "t2", via: "opencode-go/glm-5.1 · fast tier" }), line({ at: ago(3) + 60000, event: "finish", runId: "r2", ok: false, seconds: 60 }),
    line({ at: ago(20), event: "start", runId: "r3", kind: "task", task: "t3", via: "codex cli · main" }),
  ].join("");
  // OpenCode's store rows, in the reader's own shape (scripts/usage-tracker.cjs normalizeStoreUsage).
  const store = { ok: true, rows: [{ id: "m1", at: ago(2), provider: "anthropic", model: "claude-opus-4-1", tokens: { total: 1200 } }, { id: "m2", at: ago(20), provider: "openai", model: "codex", tokens: { total: 300 } }] };
  const tasks = [{ id: "t1", createdAt: ago(3), status: "done", doneAt: ago(2), verification: { state: "verified" } }, { id: "t9", createdAt: ago(25), status: "open" }];
  const h = await host({ ledger, store, tasks, observations: [{ role: "worker", runId: "r1", model: "anthropic/claude-opus-4-1", outcome: "win" }] });
  const all = await h.call("work:stats", { range: "all" });
  assert.equal(all.ok, true);
  assert.equal(all.projectId, "p1");
  assert.equal(all.range, "all");
  assert.deepEqual(clean(all.totals), { tasks: 2, runs: 3, succeeded: 1, verified: 1, tokens: 1500, activeDays: all.totals.activeDays });
  assert.deepEqual(clean(all.models.map((model) => [model.name, model.runs, model.wins, model.tokens])), [["claude-opus-4-1", 1, 1, 1200], ["Codex", 1, 0, 300], ["glm-5.1", 1, 0, null]], "models are named from the Studio ledger's worker row first, then the route label, and carry the tokens the store recorded for them");
  assert.deepEqual(clean(all.store), { ok: true, error: null });
  assert.deepEqual(h.calls.reach, [154], "the coding-turn read reaches back the heatmap's 22 weeks (the tracker's own window is 35 days)");
  const week = await h.call("work:stats", { range: "7d" });
  assert.equal(week.range, "7d");
  assert.deepEqual(clean([week.totals.runs, week.totals.tokens, week.totals.tasks]), [2, 1200, 1], "seven days holds two runs, one token row and the task made three days ago");
  const month = await h.call("work:stats", { range: "30d" });
  assert.equal(month.totals.runs, 3);
  // A range the renderer never sends reads as All.
  assert.equal((await h.call("work:stats", { range: "1y" })).range, "all");
  assert.equal((await h.call("work:stats")).range, "all", "and so does no range at all");
});

test("work:stats keeps each range a minute per project, then asks the ledgers again", async () => {
  const h = await host({ ledger: line({ at: ago(1), event: "start", runId: "r1", via: "claude cli · main" }) });
  const first = await h.call("work:stats", { range: "all" });
  const again = await h.call("work:stats", { range: "all" });
  assert.equal(again, first, "the same answer, not a second read");
  assert.equal(h.calls.ledger, 1);
  assert.equal(h.calls.tasks, 1);
  await h.call("work:stats", { range: "7d" });
  assert.equal(h.calls.ledger, 2, "another range is its own read");
  h.clock.now += 59000;
  assert.equal(await h.call("work:stats", { range: "all" }), first, "still fresh at 59 seconds");
  h.state.project = { id: "p2", path: "/work/other" };
  const other = await h.call("work:stats", { range: "all" });
  assert.notEqual(other, first, "another project is not served this one's numbers");
  assert.equal(other.projectId, "p2");
  h.state.project = { id: "p1", path: "/work/snake" };
  h.clock.now += 2000;
  const stale = await h.call("work:stats", { range: "all" });
  assert.notEqual(stale, first, "past a minute it reads again");
  assert.ok(h.calls.ledger >= 4);
});

test("work:stats survives a missing ledger, reports an unreadable store beside the stats, and says plainly when it cannot read", async () => {
  const missing = await host({ ledgerError: Object.assign(new Error("no such file"), { code: "ENOENT" }) });
  const none = await missing.call("work:stats", { range: "all" });
  assert.equal(none.ok, true, "a project that never ran anything has no ledger, and that is not an error");
  assert.deepEqual(clean(none.totals), { tasks: 0, runs: 0, succeeded: 0, verified: 0, tokens: null, activeDays: 0 });
  assert.equal(none.peakHour, null);

  const blind = await host({ ledger: line({ at: ago(1), event: "start", runId: "r1", via: "claude cli · main" }), store: { ok: false, rows: [], error: "The OpenCode store could not be read." } });
  const partial = await blind.call("work:stats", { range: "all" });
  assert.equal(partial.ok, true, "the Studio ledger still stands");
  assert.equal(partial.totals.runs, 1);
  assert.equal(partial.totals.tokens, null, "and no tokens are guessed for the store that could not be read");
  assert.deepEqual(clean(partial.store), { ok: false, error: "The OpenCode store could not be read." });

  const denied = await host({ ledgerError: Object.assign(new Error(`EACCES: permission denied, open '${"x".repeat(400)}'`), { code: "EACCES" }) });
  const failed = await denied.call("work:stats", { range: "all" });
  assert.equal(failed.ok, false);
  assert.ok(failed.error.startsWith("The work stats could not be read: EACCES"));
  assert.equal(failed.error.length, "The work stats could not be read: ".length + 160, "the message is cut to 160 characters");
  assert.equal(denied.calls.ledger, 1);
  await denied.call("work:stats", { range: "all" });
  assert.equal(denied.calls.ledger, 2, "a failure is never cached");
});

test("work:where reports the folder's branch and uncommitted count, or that it is no repository, and whether runs get worktrees", async () => {
  const plain = await host({ look: { top: null } });
  assert.deepEqual(clean(await plain.call("work:where")), { ok: true, projectId: "p1", repo: false, branch: null, dirty: 0, worktrees: { on: false, forced: false } });
  assert.deepEqual(plain.calls.look, ["/work/snake"], "it looks at the open folder");

  const repo = await host({ look: { top: "/work/snake", look: { branch: "land/builder", head: "2687d04abcdef0123" }, statuses: [{}, {}, {}] } });
  assert.deepEqual(clean(await repo.call("work:where")), { ok: true, projectId: "p1", repo: true, branch: "land/builder", head: "2687d04", dirty: 3, worktrees: { on: false, forced: false } });
  const detached = await host({ look: { top: "/work/snake", look: { branch: null, head: null }, statuses: [] } });
  const seen = await detached.call("work:where");
  assert.deepEqual([seen.branch, seen.head, seen.dirty], [null, null, 0], "a repository with no commits has neither a branch nor a head");

  const broken = await host({ lookError: new Error(`git said no ${"y".repeat(300)}`) });
  const bad = await broken.call("work:where");
  assert.equal(bad.ok, false);
  assert.equal(bad.error.length, 160, "an error is cut to 160 characters");

  worktrees.prefer(true);
  assert.equal((await repo.call("work:where")).worktrees.on, true, "the chip reads what a run will do");
  assert.equal((await repo.call("work:where")).worktrees.forced, false);
});

test("the Worktree chip's choice is saved as settings.executor.worktreeRuns and handed to the executor at once", async () => {
  const h = await host({ settings: { executor: { cli: "codex", tier: "heavy" }, theme: "dark" } });
  assert.equal(worktrees.enabled({}), false, "off by default");
  const on = await h.call("work:worktrees", { on: true });
  assert.deepEqual(clean(on), { ok: true, worktrees: { on: true, forced: false } });
  assert.deepEqual(clean(h.state.settings), { executor: { cli: "codex", tier: "heavy", worktreeRuns: true }, theme: "dark" }, "the other executor settings and everything else stay");
  assert.equal(worktrees.enabled({}), true, "the next run gets its own worktree, with no restart");
  const off = await h.call("work:worktrees", { on: false });
  assert.deepEqual(clean(off), { ok: true, worktrees: { on: false, forced: false } });
  assert.equal(h.state.settings.executor.worktreeRuns, false);
  assert.equal(worktrees.enabled({}), false, "turning the chip off is the kill switch");
  // Only a real yes turns it on.
  for (const loose of ["true", "yes", 1, {}, null, undefined]) {
    await h.call("work:worktrees", { on: loose });
    assert.equal(h.state.settings.executor.worktreeRuns, false, `${JSON.stringify(loose)} is not a yes`);
    assert.equal(worktrees.enabled({}), false);
  }
  assert.equal((await h.call("work:worktrees", {})).worktrees.on, false, "no payload is off");
  // From nothing saved at all.
  const fresh = await host({ settings: {} });
  await fresh.call("work:worktrees", { on: true });
  assert.deepEqual(clean(fresh.state.settings), { executor: { worktreeRuns: true } });
});

test("the environment switch forces worktrees on and the chip says so; the saved choice is handed over at launch", async () => {
  const before = process.env.MEFI_STUDIO_WORKTREE_RUNS;
  try {
    process.env.MEFI_STUDIO_WORKTREE_RUNS = "1";
    const forced = await host();
    assert.deepEqual(clean((await forced.call("work:where")).worktrees), { on: true, forced: true });
    assert.deepEqual(clean((await forced.call("work:worktrees", { on: false })).worktrees), { on: true, forced: true }, "the chip cannot turn off what the environment forces");
    assert.equal(forced.state.settings.executor.worktreeRuns, false, "but the choice itself is still saved");
  } finally {
    if (before === undefined) delete process.env.MEFI_STUDIO_WORKTREE_RUNS; else process.env.MEFI_STUDIO_WORKTREE_RUNS = before;
  }
  delete process.env.MEFI_STUDIO_WORKTREE_RUNS;
  try {
    // At launch main reads the settings and hands the saved choice over, so a run started before the chip is ever touched follows it.
    worktrees.prefer(false);
    await host({ settings: { executor: { worktreeRuns: true } } });
    assert.equal(worktrees.enabled({}), true, "a saved yes is in force from the first run");
    worktrees.prefer(false);
    for (const settings of [{}, { executor: {} }, { executor: { worktreeRuns: false } }, { executor: { worktreeRuns: "true" } }, { executor: { worktreeRuns: 1 } }]) {
      await host({ settings });
      assert.equal(worktrees.enabled({}), false, `${JSON.stringify(settings)} leaves it off`);
    }
    await host({ settingsError: new Error("settings are unreadable") });
    assert.equal(worktrees.enabled({}), false, "a settings file that cannot be read leaves it off and does not stop the launch");
  } finally {
    if (before !== undefined) process.env.MEFI_STUDIO_WORKTREE_RUNS = before;
  }
});
