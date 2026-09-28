// Several logins per coding CLI, host side: main.cjs's block of that name run
// in a vm with its boundaries replaced (settings, the clock, the usage probes,
// the log), and the executor host driving a real Claude Code run that tops out
// on its first login and goes on with the next. The folder helpers run on a
// real temporary folder, because the one thing they must never do is delete
// through the link to the main login's projects/.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { executorHost } from "./fixtures/host_executor.mjs";

const require = createRequire(import.meta.url);
const cliAccounts = require("../scripts/cli-accounts.cjs");
const authStore = require("../scripts/auth-store.cjs");

const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const block = section("// ---- Several logins per coding CLI", "async function chatCompletion(");

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const START = Date.UTC(2026, 8, 28, 13, 20);
// Values made inside the vm have that realm's prototypes; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

// The block with its boundaries: a user-data folder, saved settings, a clock.
async function blockHost({ settings = {}, userData = null, claudeHome = null } = {}) {
  const dir = userData ?? await mkdtemp(path.join(os.tmpdir(), "mefi-logins-"));
  let now = START;
  const logs = [], sent = [], plans = [];
  const env = vm.createContext({
    require, path, cliAccounts, authStore, readFile, mkdir, console,
    os: { homedir: () => dir },
    process: { env: claudeHome ? { CLAUDE_CONFIG_DIR: claudeHome } : {} },
    app: { getPath: () => dir },
    Date: class extends Date { static now() { return now; } },
    logLine: (line) => logs.push(line), send: (channel, payload) => sent.push([channel, payload]),
    readSettings: async () => structuredClone(settings),
    cliPlanState: new Map(),
    cliPlanReading: (key, run, options) => { plans.push({ key, options }); return { result: null, refreshing: false }; },
    probeClaudeUsage: async () => ({ ok: false, error: "not in this suite" }), probeCodexLimits: async () => ({ ok: false, error: "not in this suite" }),
    claudeCliAvailable: async () => true, codexCliAvailable: async () => false,
  });
  vm.runInContext(block, env);
  return { env, dir, logs, sent, plans, advance: (ms) => { now += ms; }, now: () => now, settings };
}

const twoLogins = (home) => ({ cliAccounts: [{ id: "claude-a1b2", provider: "claude", label: "Work", home }] });

test("an assistant call fills the first login and moves to the next when one tops out", async () => {
  const home = path.resolve("/logins/claude-a1b2");
  const host = await blockHost({ settings: twoLogins(home) });
  const calls = [];
  const reply = (byLogin) => async ({ env }) => { calls.push(env); return byLogin(env); };
  const toppedOut = reply((env) => (env.CLAUDE_CONFIG_DIR ? { ok: true, text: "READY" } : { ok: false, error: "claude error: You've hit your limit · resets 3pm (UTC)" }));
  const first = await host.env.cliAccountTurn("claude", toppedOut);
  assert.deepEqual(plain(first), { ok: true, text: "READY" });
  assert.deepEqual(plain(calls.map((env) => env.CLAUDE_CONFIG_DIR ?? "main")), ["main", home], "the same call went on to the next login");
  assert.ok(host.logs.some((line) => /^\[accounts\] Claude Code · Main login topped out until /.test(line)));
  assert.ok(host.logs.includes("[assistant] Claude Code · Main login topped out — asking Work"));
  assert.deepEqual(plain(host.sent.at(-1)), ["accounts:changed", { id: "claude-main" }]);

  // The main login stays aside until its reset; the next call starts on Work.
  calls.length = 0;
  await host.env.cliAccountTurn("claude", toppedOut);
  assert.deepEqual(plain(calls.map((env) => env.CLAUDE_CONFIG_DIR ?? "main")), [home]);
  host.advance(2 * HOUR);
  calls.length = 0;
  await host.env.cliAccountTurn("claude", reply(() => ({ ok: true, text: "READY" })));
  assert.deepEqual(plain(calls.map((env) => env.CLAUDE_CONFIG_DIR ?? "main")), ["main"], "back on the main login once 3pm has passed");
});

test("with every login topped out no CLI is started, and the reply names the first reset", async () => {
  const host = await blockHost({ settings: twoLogins(path.resolve("/logins/claude-a1b2")) });
  let calls = 0;
  const limit = async () => { calls += 1; return { ok: false, error: "claude cli failed (exit 1): 5-hour limit reached ∙ resets 3pm (UTC)" }; };
  const out = await host.env.cliAccountTurn("claude", limit);
  assert.equal(calls, 2);
  assert.equal(out.ok, false);
  assert.match(out.error, /5-hour limit reached/);
  const skipped = await host.env.cliAccountTurn("claude", limit);
  assert.equal(calls, 2, "nothing is spawned while every login is known to be out");
  assert.equal(skipped.toppedOut, true);
  assert.match(skipped.error, /^every Claude Code login is topped out until /);
  const route = await host.env.cliAccountRoute("claude", host.settings);
  assert.equal(route.toppedOut, true);
  assert.match(route.note, /^every Claude Code login is topped out until /);
});

test("a failure that is not a usage limit ends the call on its own login", async () => {
  const host = await blockHost({ settings: twoLogins(path.resolve("/logins/claude-a1b2")) });
  let calls = 0;
  const out = await host.env.cliAccountTurn("claude", async () => { calls += 1; return { ok: false, error: "claude cli failed (exit 1): Not logged in" }; });
  assert.equal(calls, 1);
  assert.equal(out.error, "claude cli failed (exit 1): Not logged in");
  assert.equal(host.logs.length, 0, "no login was set aside");
  let other = 0;
  await host.env.cliAccountTurn("grok", async (login) => { other += 1; assert.deepEqual(plain(login), {}); return { ok: true }; });
  assert.equal(other, 1, "a CLI without logins answers as before");
});

test("a single login reads exactly as before, and a limit with no reset asks its usage reading", async () => {
  const host = await blockHost();
  const route = await host.env.cliAccountRoute("claude", {});
  assert.equal(route.tag, "", "no login is named when there is only one");
  assert.deepEqual(plain(route.env), {});
  assert.equal(route.account.id, "claude-main");
  const hit = host.env.cliAccountLimitHit(route.account, ["npm test", "You've hit your usage limit. Try again later."]);
  assert.equal(hit.known, false);
  assert.equal(hit.until, START + cliAccounts.RECHECK_MS);
  assert.deepEqual(plain(host.plans.map((row) => [row.key, row.options.allow])), [["claude", true]], "the main login's reading is asked for at once");
  assert.equal(host.env.cliAccountLimitHit(route.account, "Error: Rate limit reached for requests"), null, "a rate limit is not a topped-out login");
  const out = await host.env.cliAccountRoute("claude", {});
  assert.match(out.note, /^Claude Code is topped out until /);
});

test("limit marks outlive a restart and drop once their reset passes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-logins-"));
  try {
    const first = await blockHost({ userData: dir });
    await first.env.loadCliAccountMarks();
    first.env.cliAccountLimitHit(cliAccounts.mainAccount("claude"), "Claude AI usage limit reached|" + Math.floor((START + 3 * HOUR) / 1000));
    await vm.runInContext("cliAccountMarksWrite", first.env);
    const saved = JSON.parse(await readFile(path.join(dir, "cli-account-limits.json"), "utf8"));
    assert.equal(saved["claude-main"].until, START + 3 * HOUR);
    const second = await blockHost({ userData: dir });
    const marks = await second.env.loadCliAccountMarks();
    assert.equal(marks["claude-main"].until, START + 3 * HOUR, "a restart keeps the login aside");
    // A limit hit before the file was ever read keeps the file's other marks.
    const early = await blockHost({ userData: dir });
    early.env.cliAccountLimitHit({ id: "claude-a1b2", provider: "claude", label: "Work", main: false, home: path.join(dir, "w") }, "5-hour limit reached ∙ resets 3pm (UTC)");
    await vm.runInContext("cliAccountMarksWrite", early.env);
    const both = JSON.parse(await readFile(path.join(dir, "cli-account-limits.json"), "utf8"));
    assert.deepEqual(Object.keys(both).sort(), ["claude-a1b2", "claude-main"], "the save waited for the read and kept the main login's mark");
    const third = await blockHost({ userData: dir });
    third.advance(4 * HOUR);
    assert.deepEqual(plain(await third.env.loadCliAccountMarks()), {}, "a passed reset is dropped on load");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a usage reading sets a full login aside and lifts the mark once it shows room", async () => {
  const host = await blockHost({ settings: twoLogins(path.resolve("/logins/claude-a1b2")) });
  const [, work] = cliAccounts.accountsFor(host.settings, "claude");
  const limits = (percent) => ({ windows: [{ percent, resetsAt: new Date(START + 2 * HOUR).toISOString() }] });
  host.env.cliAccountReading(work, { ok: true, at: START, limits: limits(100) });
  const route = await host.env.cliAccountRoute("claude", host.settings);
  assert.equal(route.account.id, "claude-main");
  assert.equal((await host.env.cliAccountsView()).providers[0].accounts[1].limited, true);
  host.advance(MINUTE);
  host.env.cliAccountReading(work, { ok: true, at: START - HOUR, limits: limits(20) });
  assert.equal((await host.env.cliAccountsView()).providers[0].accounts[1].limited, true, "a reading older than the mark lifts nothing");
  host.env.cliAccountReading(work, { ok: true, at: START + MINUTE, limits: limits(20) });
  const view = await host.env.cliAccountsView();
  assert.equal(view.providers[0].accounts[1].limited, false);
  assert.ok(host.logs.includes("[accounts] Claude Code · Work has room again"));
  assert.deepEqual(plain(view.providers.map((row) => [row.id, row.installed, row.accounts.length])), [["claude", true, 2], ["codex", false, 1]]);
});

test("a new Claude Code login shares the main login's projects/, and removing it never reaches through that link", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-logins-"));
  try {
    const mainClaude = path.join(dir, "main-claude");
    await mkdir(path.join(mainClaude, "projects", "C--proj", "memory"), { recursive: true });
    await writeFile(path.join(mainClaude, "projects", "C--proj", "memory", "MEMORY.md"), "keep me");
    const host = await blockHost({ userData: dir, claudeHome: mainClaude });
    const home = await host.env.makeCliAccountHome("claude", "claude-a1b2");
    assert.equal(home, path.join(dir, "cli-logins", "claude-a1b2"));
    assert.ok((await lstat(path.join(home, "projects"))).isSymbolicLink(), "projects/ is a link to the main login's");
    assert.equal(await readFile(path.join(home, "projects", "C--proj", "memory", "MEMORY.md"), "utf8"), "keep me");
    await writeFile(path.join(home, ".credentials.json"), "{}");
    assert.deepEqual(plain(await host.env.removeCliAccountHome(home)), { removed: true });
    assert.equal(existsSync(home), false, "the login's folder and sign-in are gone");
    assert.equal(await readFile(path.join(mainClaude, "projects", "C--proj", "memory", "MEMORY.md"), "utf8"), "keep me", "the main login's projects/ survived");
    const outside = await host.env.removeCliAccountHome(mainClaude);
    assert.equal(outside.removed, false, "only folders Studio made are removed");
    assert.ok(existsSync(mainClaude));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a Codex login keeps its own folder, sessions and all", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mefi-logins-"));
  try {
    const host = await blockHost({ userData: dir });
    const home = await host.env.makeCliAccountHome("codex", "codex-a1b2");
    assert.equal(existsSync(path.join(home, "projects")), false);
    assert.deepEqual(plain(await host.env.removeCliAccountHome(home)), { removed: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a coding worker whose login tops out goes straight back to the queue and runs on the next login", async () => {
  const home = path.resolve("/logins/claude-a1b2");
  const savedSettings = { ui: { autopilot: { enabled: true, execute: true, autoBuild: true, mode: "swarm", parallel: 1, adaptiveParallel: false, minutes: 5 } }, ...twoLogins(home) };
  const h = executorHost({ tasks: [{ id: "build", title: "Implement fixture build", prompt: "Implement build and keep its brief.", status: "open", createdAt: 1, files: ["src/build.js"] }], savedSettings });
  Object.assign(h.env, {
    cliAccounts, authStore: { atomicWriteJson: async () => {} }, readFile: async () => { throw new Error("no marks file"); },
    app: { getPath: () => path.resolve("fixture-user-data") }, os: { ...h.env.os, homedir: () => path.resolve("fixture-home") },
    cliPlanState: new Map(), cliPlanReading: () => ({ result: null, refreshing: false }),
    probeClaudeUsage: async () => ({ ok: false }), probeCodexLimits: async () => ({ ok: false }),
    claudeCliAvailable: async () => true, codexCliAvailable: async () => false,
    cliModelArg: (value) => (value ? String(value) : ""),
  });
  vm.runInContext(block, h.env);
  // executorRunEnv's Claude branch, reduced to the login it rides.
  h.env.executorRunEnv = async () => {
    const login = await h.env.cliAccountRoute("claude", await h.env.readSettings());
    if (login.toppedOut) return { error: login.note };
    return { cli: "claude", claude: true, via: `claude cli${login.tag ? ` · ${login.tag}` : ""}`, modelArgs: "", env: login.env, account: login.account, logins: login.logins };
  };
  const envs = [];
  const spawn = h.env.spawn;
  h.env.spawn = (command, args, options) => { if (command === "cmd.exe") envs.push(options?.env ?? {}); return spawn(command, args, options); };

  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1);
  assert.equal(envs[0].CLAUDE_CONFIG_DIR, undefined, "the first run is on the main login");
  await h.finish("build", { code: 1, lines: ["Reading the brief", "You've hit your limit · resets 3pm (UTC)"] }); await h.pump();
  // The freed slot hands the card straight out again, on the other login.
  assert.equal(h.starts.length, 2, "the card ran again at once, with no backoff");
  assert.equal(envs.at(-1).CLAUDE_CONFIG_DIR, home, "on the other login's folder");
  assert.ok(h.logs.includes("[autopilot] claude run via claude cli · Work (task): Implement fixture build"));
  let row = h.board().tasks[0];
  assert.equal(row.runFailures, undefined, "no attempt charged");
  assert.equal(row.providerFailures, undefined, "not a provider outage either");
  const requeue = row.logs.find((line) => /topped out/.test(line.text));
  assert.match(requeue?.text ?? "", /^provider unavailable \(exit 1\) · Claude Code · Main login topped out until .+ · requeued now on Claude Code · Work, no attempt charged$/);

  await h.finish("build"); await h.pump();
  row = h.board().tasks[0];
  assert.equal(row.status, "awaiting_verification");
  assert.equal(row.lastRunError, undefined);
});
