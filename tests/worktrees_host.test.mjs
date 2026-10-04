// Guard tests for the host side of the Worktrees page: the worktrees:* handlers
// in main.cjs ("Worktrees" block) and the bridge in preload.cjs. The handler
// block is sliced out of main.cjs and run with real modules over throwaway
// repositories, so what the page relies on is what runs: a list that joins a
// run's folder to its task, project gating, one writer at a time, the folder a
// run is working in left alone, and no path used that git does not list.
//
// Run: node --test tests/worktrees_host.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { runGit } from "../scripts/sync.mjs";
import * as view from "../scripts/worktrees.mjs";
import * as act from "../scripts/worktree-actions.mjs";

const main = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const START = "  // ---- Worktrees (scripts/worktrees.mjs reads, scripts/worktree-actions.mjs writes)";
const from = main.indexOf(START);
const to = main.indexOf("\n  // ---- Your PCs vault", from);
assert.ok(from >= 0 && to > from, "the Worktrees block is in main.cjs");
const block = main.slice(from, to);

const plain = (value) => JSON.parse(JSON.stringify(value));
async function run(cwd, ...args) {
  const out = await runGit(cwd, args);
  assert.ok(out.ok, `git ${args.join(" ")}: ${out.stderr}`);
  return out.stdout;
}

// A project with a remote, and the host block wired to it.
async function host(t, { open = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-wt-host-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const repo = path.join(root, "repo");
  await run(root, "init", "-q", "-b", "main", repo);
  for (const [key, value] of [["user.name", "Host Fixture"], ["user.email", "host@fixture.invalid"], ["commit.gpgsign", "false"]]) await run(repo, "config", key, value);
  writeFileSync(path.join(repo, "README.md"), "hello\n");
  await run(repo, "add", "README.md");
  await run(repo, "commit", "-q", "-m", "Start");
  writeFileSync(path.join(repo, ".git", "info", "exclude"), ".mefi/\nnode_modules\n");
  const ledger = path.join(root, "executor-log.jsonl");
  const handlers = new Map();
  const opened = [];
  const state = { open, active: "p1", jobs: [] };
  const context = vm.createContext({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    projects: { open: () => state.open, active: () => ({ id: state.active }) },
    projectRoot: () => repo,
    get autopilot() { return { jobs: state.jobs }; },
    worktreeView: () => ({ on: false, forced: false }),
    loadModule: async (rel) => ({ "scripts/worktrees.mjs": view, "scripts/worktree-actions.mjs": act })[rel],
    readFile: (file) => readFile(file, "utf8"),
    projectDataPath: (file) => file,
    EXECUTOR_LOG_PATH: ledger,
    path,
    shell: { openPath: async (folder) => { opened.push(folder); return ""; } },
  });
  vm.runInContext(block, context);
  const call = async (channel, payload) => plain(await handlers.get(channel)({}, payload));
  return { root, repo, ledger, handlers, state, opened, call, at: (name) => path.join(root, name) };
}

async function branchWith(h, name, file = `${name}.txt`) {
  await run(h.repo, "worktree", "add", "-q", "-b", `wip/${name}`, h.at(name));
  for (const [key, value] of [["user.name", "Host Fixture"], ["user.email", "host@fixture.invalid"], ["commit.gpgsign", "false"]]) await run(h.at(name), "config", key, value);
  writeFileSync(path.join(h.at(name), file), `${name}\n`);
  await run(h.at(name), "add", file);
  await run(h.at(name), "commit", "-q", "-m", `Add ${file}`);
  return h.at(name);
}

test("five project-gated channels, in the block between the git link and the vault", () => {
  const channels = [...block.matchAll(/ipcMain\.handle\("(worktrees:[a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(channels, ["worktrees:list", "worktrees:merge", "worktrees:remove", "worktrees:forget", "worktrees:open"]);
  const prefixes = main.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(prefixes, /"worktrees:"/, "worktrees:* acts on the open project, so a project switch waits for it");
  assert.equal((main.match(/ipcMain\.handle\("worktrees:/g) ?? []).length, 5, "and each is registered once");
  assert.doesNotMatch(block, /\b(?:fetch|push|pull)\b\(|"(?:push|fetch|pull)"/, "the host never reaches the network");
});

test("the bridge sends a folder and a few flags, nothing else", () => {
  for (const name of ["worktreesList", "worktreesMerge", "worktreesRemove", "worktreesForget", "worktreesOpen"]) assert.match(preload, new RegExp(`^  ${name}: `, "m"));
  assert.match(preload, /worktreesMerge: \(payload\) => ipcRenderer\.invoke\("worktrees:merge", \{ path: gitText\(payload\?\.path, 1024\), mode: payload\?\.mode === "merge" \? "merge" : "ff", remove: payload\?\.remove === true, anyway: payload\?\.anyway === true, \.\.\.gitProject\(payload\) \}\)/);
  assert.match(preload, /worktreesRemove: \(payload\) => ipcRenderer\.invoke\("worktrees:remove", \{ path: gitText\(payload\?\.path, 1024\), force: payload\?\.force === true, deleteBranch: payload\?\.deleteBranch === true, \.\.\.gitProject\(payload\) \}\)/);
});

test("the list carries every worktree, joins a run's folder to its task and marks the one a run is using", async (t) => {
  const h = await host(t);
  await run(h.repo, "worktree", "add", "-q", "-b", "mefi/run_5_1", path.join(h.repo, ".mefi", "worktrees", "run_5_1"));
  await branchWith(h, "feature");
  writeFileSync(h.ledger, [
    JSON.stringify({ at: 1000, event: "start", runId: "run_5_1", kind: "task", task: "task_9", title: "Fix the sidebar" }),
    JSON.stringify({ at: 2000, event: "start", runId: "run_6_1", kind: "task", task: "task_10", title: "Another" }),
    "not json",
    JSON.stringify({ at: 3000, event: "finish", runId: "run_5_1", ok: true }),
  ].join("\n"));
  h.state.jobs = [{ id: "run_5_1", finished: false, worktree: { path: path.join(h.repo, ".mefi", "worktrees", "run_5_1") } }];
  const list = await h.call("worktrees:list", { projectId: "p1" });
  assert.equal(list.ok, true, list.error);
  assert.equal(list.repo, true);
  assert.equal(list.projectId, "p1");
  assert.equal(list.builders, true, "an agent is running");
  assert.deepEqual(list.enabled, { on: false, forced: false });
  const run5 = list.rows.find((row) => row.name === "run_5_1");
  assert.equal(run5.kind, "run");
  assert.deepEqual(run5.task, { taskId: "task_9", title: "Fix the sidebar", at: 1000 });
  assert.equal(run5.busy, true);
  const feature = list.rows.find((row) => row.name === "feature");
  assert.equal(feature.task, null);
  assert.equal(feature.busy, false);
  assert.equal(list.rows.find((row) => row.kind === "primary").busy, false);
  assert.equal(list.rows.some((row) => row.name === "run_6_1"), false, "a ledger row for a folder that is not listed is not invented into a row");
});

test("no project open, or a different project than the page asked about: nothing runs", async (t) => {
  const closed = await host(t, { open: false });
  assert.deepEqual(await closed.call("worktrees:list", {}), { ok: false, error: "Open a project first." });
  const h = await host(t);
  const wt = await branchWith(h, "moved");
  for (const [channel, extra] of [["worktrees:list", {}], ["worktrees:merge", { path: wt }], ["worktrees:remove", { path: wt, force: true }], ["worktrees:forget", {}], ["worktrees:open", { path: wt }]]) {
    const answer = await h.call(channel, { ...extra, projectId: "some-other-project" });
    assert.equal(answer.ok, false, channel);
    assert.match(answer.error, /project changed/, channel);
  }
  assert.ok(existsSync(wt), "nothing was touched");
  assert.match(await run(h.repo, "branch", "--list", "wip/moved"), /wip\/moved/, "and the branch is still there");
});

test("merge and remove go through the modules, and a run's own folder is left alone", async (t) => {
  const h = await host(t);
  const wt = await branchWith(h, "landing");
  const merged = await h.call("worktrees:merge", { path: wt, remove: true, projectId: "p1" });
  assert.equal(merged.ok, true, merged.error);
  assert.equal(merged.removed.ok, true);
  assert.ok(existsSync(path.join(h.repo, "landing.txt")));
  assert.ok(!existsSync(wt));

  const busy = await branchWith(h, "working");
  h.state.jobs = [{ id: "working", finished: false, worktree: { path: busy } }];
  const refused = await h.call("worktrees:remove", { path: busy, force: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.busy, true);
  assert.ok(existsSync(busy), "still there");
  const askedToMerge = await h.call("worktrees:merge", { path: busy });
  assert.equal(askedToMerge.busy, true);
  h.state.jobs = [];
  assert.equal((await h.call("worktrees:merge", { path: busy })).needsAnyway, undefined);
  assert.equal((await h.call("worktrees:remove", { path: busy, deleteBranch: true })).branchDeleted, true, "it is merged now, so its branch goes with it");
});

test("agents changing files ask for a second yes before a merge; the answer is the caller's", async (t) => {
  const h = await host(t);
  const wt = await branchWith(h, "careful");
  h.state.jobs = [{ id: "someone-else", finished: false }];
  const first = await h.call("worktrees:merge", { path: wt });
  assert.equal(first.needsAnyway, true);
  const second = await h.call("worktrees:merge", { path: wt, anyway: true });
  assert.equal(second.ok, true, second.error);
});

test("a path that git does not list does nothing, however it is spelled", async (t) => {
  const h = await host(t);
  const wt = await branchWith(h, "real");
  for (const target of [path.join(wt, ".."), path.join(wt, "real.txt"), path.join(h.root, "nope"), "", "..", "/", "C:\\Windows"]) {
    for (const channel of ["worktrees:merge", "worktrees:remove", "worktrees:open"]) {
      const answer = await h.call(channel, { path: target, force: true });
      assert.equal(answer.ok, false, `${channel} ${target}`);
    }
  }
  assert.deepEqual(h.opened, []);
  assert.ok(existsSync(wt));
});

test("Open hands the operating system a listed folder, and a bad answer becomes an error", async (t) => {
  const h = await host(t);
  const wt = await branchWith(h, "show");
  const ok = await h.call("worktrees:open", { path: wt });
  assert.equal(ok.ok, true);
  assert.equal(h.opened.length, 1);
  assert.equal(readFileSync(path.join(h.opened[0], "show.txt"), "utf8"), "show\n");
  const bad = await host(t);
  bad.handlers.clear();
  const context = vm.createContext({
    ipcMain: { handle: (channel, fn) => bad.handlers.set(channel, fn) },
    projects: { open: () => true, active: () => ({ id: "p1" }) },
    projectRoot: () => bad.repo,
    autopilot: { jobs: [] },
    worktreeView: () => ({}),
    loadModule: async (rel) => ({ "scripts/worktrees.mjs": view, "scripts/worktree-actions.mjs": act })[rel],
    readFile: (file) => readFile(file, "utf8"), projectDataPath: (file) => file, EXECUTOR_LOG_PATH: bad.ledger, path,
    shell: { openPath: async () => "The file manager could not start" },
  });
  vm.runInContext(block, context);
  const other = await branchWith(bad, "x");
  assert.deepEqual(plain(await bad.handlers.get("worktrees:open")({}, { path: other })), { ok: false, error: "The file manager could not start" });
  assert.equal((await h.call("worktrees:open", { path: h.repo })).ok, true, "the main checkout is a worktree too");
});

test("writes run one at a time", async (t) => {
  const h = await host(t);
  const a = await branchWith(h, "one");
  const b = await branchWith(h, "two");
  // Both asked at once: the second sees the first's merge, so it cannot fast-forward past it.
  const [first, second] = await Promise.all([h.call("worktrees:merge", { path: a }), h.call("worktrees:merge", { path: b })]);
  assert.equal(first.ok, true, first.error);
  assert.equal(second.ok, false, "main moved when the first landed");
  assert.equal(second.needsMergeCommit, true);
  assert.equal((await h.call("worktrees:merge", { path: b, mode: "merge" })).ok, true);
});

test("forgetting folders that are gone", async (t) => {
  const h = await host(t);
  const gone = await branchWith(h, "gone");
  rmSync(gone, { recursive: true, force: true });
  const answer = await h.call("worktrees:forget", {});
  assert.equal(answer.ok, true, answer.error);
  assert.equal(answer.pruned, 1);
  mkdirSync(gone);
});
