// Guard tests for scripts/git-host.cjs, the host layer between the Electron
// bridge and git-link.cjs / git-actions.cjs: the project a call is bound to,
// the one-writer queue, which push goes through sync and which through
// pushBranch, the chip model after every action, the 6 s success state, the
// launch list's glance and the scrubbing of every error. The contract cases run
// on fakes (actions, syncProject, context, pcSetup); the last test runs the
// REAL git-actions and git-link on a throwaway repository with a local bare
// repository standing in for GitHub, and sync.mjs's real sync() behind the
// fake syncProject. Nothing here reaches the network, a real GitHub account or
// the live tree.
//
// Run: node --test tests/git_host.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createGitHost, OUTCOME_MS } = require("../scripts/git-host.cjs");
const { createGitActions } = require("../scripts/git-actions.cjs");
const link = require("../scripts/git-link.cjs");

// Built at run time so this file never holds a token-shaped line of its own.
const TOKEN = `ghp_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6"}`;
const ROOT = path.resolve("fake-projects", "app");
const OTHER = path.resolve("fake-projects", "other");
const NO_PROJECT = { ok: false, error: "Open a project first." };
const CHANGED = { ok: false, error: "The selected project changed. Try again in its intended project." };

const tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };

// What git-actions.glance answers for a checkout.
const synced = { isRepo: true, unborn: false, branch: "main", detached: false, dirty: 0, ahead: 0, behind: 0, upstream: "origin/main", remote: "octo/app", main: "main", onDefault: true, available: true };
const glanceOf = (over = {}) => ({ ...synced, ...over });
const onFeature = (over = {}) => glanceOf({ branch: "feat", onDefault: false, upstream: "origin/feat", ahead: 1, ...over });

// A scripts/sync.mjs result for the open project.
const syncResult = (t, over = {}) => ({
  ok: true, checkedAt: t.now,
  state: { repo: true, root: t.root, remote: true, main: "main", upstream: "origin/main", hasUpstream: true, branch: "main", ahead: 0, behind: 0, dirty: 0 },
  actions: [], problems: [], pending: [], risk: 0, headline: "This PC matches GitHub main.", ...over,
});

const PROJECTS = [
  { id: "p1", name: "App", path: ROOT },
  { id: "p2", name: "Other", path: OTHER },
  { id: "p3", name: "Gone", path: path.resolve("fake-projects", "gone") },
  { id: "p4", name: "Slow", path: path.resolve("fake-projects", "slow") },
];

// The host on fakes. `t` is the world the fakes read at call time (change it mid-test);
// `over` replaces any fake action or the sync; `calls`, `syncCalls`, `checks` and `sent` record.
function rig(over = {}) {
  const t = { root: ROOT, projectId: "p1", builders: false, now: 1_000_000, glance: glanceOf({ ahead: 2 }), missing: new Set([PROJECTS[2].path]), ...over.world };
  const calls = [];
  const syncCalls = [];
  const checks = [];
  const sent = [];
  const gate = async () => ({ ok: true });
  const fake = (name, fallback) => async (...args) => { calls.push([name, ...args]); return (over[name] ?? fallback)(...args); };
  const actions = {
    glance: fake("glance", async () => (typeof t.glance === "function" ? t.glance() : t.glance)),
    glanceMany: fake("glanceMany", async (list) => list.map((item) => ({ id: item.id, glance: t.glance }))),
    preview: fake("preview", async () => ({ ok: true, files: [], message: "Save 1 file", branch: "main", identity: { ok: true }, refusal: null, builders: false })),
    save: fake("save", async () => ({ ok: true, sha: "abc1234", files: 2, branch: "main" })),
    pushBranch: fake("pushBranch", async () => ({ ok: true, branch: "feat", commits: 3, upstream: "origin/feat" })),
    owners: fake("owners", async () => ({ ok: true, account: "octo", orgs: ["acme"] })),
    publishPreview: fake("publishPreview", async () => ({ ok: true, repo: "octo/app", valid: true, taken: false, needsSignIn: false, ghInstalled: true, account: "octo" })),
    publish: fake("publish", async () => ({ ok: true, repo: "octo/app", url: "https://github.com/octo/app", visibility: "private", branch: "main", steps: [{ id: "create", label: "Create the repository", ok: true }] })),
    link: fake("link", async () => ({ ok: true, repo: "octo/other", empty: false, related: true, upstream: true })),
    account: fake("account", async () => ({ ok: true, account: "octo", ghInstalled: true, gitInstalled: true })),
  };
  const pcSetup = {
    isListed: (repo) => repo === "octo/other",
    repos: async () => ({ ok: true, repos: [{ repo: "octo/other", private: true, description: "", updatedAt: "" }] }),
    status: async () => ({ ok: true }),
  };
  const host = createGitHost({
    actions, link: over.linkModule ?? link,
    context: () => ({ root: t.root, projectId: t.projectId, builders: t.builders }),
    listProjects: over.listProjects ?? (() => PROJECTS),
    syncProject: async (...args) => { syncCalls.push(args); return (over.sync ?? (async () => syncResult(t)))(...args); },
    projectCheck: over.projectCheck ?? (async (root) => { checks.push(root); return gate; }),
    pcSetup,
    send: (channel, payload) => sent.push([channel, payload]),
    exists: over.exists ?? ((folder) => !t.missing.has(folder)),
    now: () => t.now,
    later: over.later,
  });
  const models = () => sent.filter(([channel]) => channel === "git:state").map(([, model]) => model);
  return { host, t, calls, syncCalls, checks, sent, models, gate, pcSetup, called: (name) => calls.filter(([id]) => id === name) };
}

// ---- which project ---------------------------------------------------------------------
test("with no open project every project-bound call says so and does nothing", async () => {
  const r = rig({ world: { root: null } });
  for (const name of ["state", "check", "pull", "push", "rebase", "savePreview", "save", "publishPreview", "publish", "link"]) {
    assert.deepEqual(await r.host[name]({}), NO_PROJECT, name);
  }
  assert.deepEqual(await r.host.state(), NO_PROJECT);
  assert.deepEqual(r.calls, [], "no action was asked");
  assert.deepEqual(r.syncCalls, []);
  assert.deepEqual(r.sent, []);
  // The app-wide ones need no project.
  assert.equal((await r.host.linkRepos()).ok, true);
  assert.equal((await r.host.account()).ok, true);
  assert.equal((await r.host.owners()).ok, true);
});

test("a call for another project id is refused before anything runs", async () => {
  const r = rig();
  for (const name of ["state", "check", "pull", "push", "rebase", "savePreview", "save", "publishPreview", "publish", "link"]) {
    assert.deepEqual(await r.host[name]({ projectId: "p2" }), CHANGED, name);
  }
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.syncCalls, []);
  // The matching id, or none, is accepted.
  assert.equal((await r.host.state({ projectId: "p1" })).ok, true);
  assert.equal((await r.host.state({})).ok, true);
  assert.equal((await r.host.state()).ok, true);
});

test("a writer uses the project it was asked for, even when another opens meanwhile", async () => {
  const hold = deferred();
  const r = rig({ world: { glance: onFeature() }, pushBranch: async () => { await hold.promise; return { ok: true, commits: 1 }; } });
  const first = r.host.push({ projectId: "p1" });
  await tick();
  const queued = r.host.save({ projectId: "p1", paths: ["a.txt"] });
  // The owner switches projects while the first waits and the second is queued behind it.
  r.t.root = OTHER;
  r.t.projectId = "p2";
  hold.release();
  const [pushed, saved] = await Promise.all([first, queued]);
  assert.equal(pushed.ok, true);
  assert.equal(saved.ok, true);
  assert.equal(r.called("pushBranch")[0][1], ROOT);
  assert.equal(r.called("save")[0][1], ROOT);
  assert.deepEqual(r.checks, [ROOT], "the project's own check was asked for the same folder");
  assert.equal(r.called("save").length, 1);
});

// ---- state, check ------------------------------------------------------------------------
test("state is the local glance through describe, and the last model is kept", async () => {
  const r = rig();
  assert.equal(r.host.model(), null);
  const { ok, model } = await r.host.state();
  assert.equal(ok, true);
  assert.equal(model.id, "ahead");
  assert.equal(model.label, "2 to push");
  assert.deepEqual(model.counts, { ahead: 2, behind: 0, dirty: 0 });
  assert.equal(model.checkedAt, null);
  assert.equal(r.host.model(), model);
  assert.deepEqual(r.calls.map(([name]) => name), ["glance"], "local only");
  assert.deepEqual(r.syncCalls, []);
  assert.deepEqual(r.sent, [], "a plain read is not an event");
});

test("check fetches and looks through syncProject(false), and the model shows the look", async () => {
  const r = rig({ sync: async () => syncResult(r.t, { problems: [{ kind: "offline", detail: "Could not resolve host: github.com" }] }) });
  const hold = deferred();
  r.t.glance = async () => { await hold.promise; return glanceOf({ ahead: 2 }); };
  const running = r.host.check();
  await tick();
  hold.release();
  const result = await running;
  assert.deepEqual(r.syncCalls, [[false]]);
  assert.equal(result.ok, true, "offline is a state the chip shows, not an error");
  assert.equal(result.model.id, "offline");
  assert.equal(result.model.checkedAt, r.t.now);
  assert.deepEqual(r.models().map((model) => model.busy), ["checking", null]);
});

test("check reports a sync that could not run", async () => {
  const r = rig({ sync: async () => ({ ok: false, headline: "Sync could not run: boom", lines: [], pending: [], actions: [], problems: [{ kind: "error" }], risk: 0 }) });
  const result = await r.host.check();
  assert.equal(result.ok, false);
  assert.match(result.error, /Sync could not run: boom/);
  assert.equal(result.model.id, "error");
  const thrown = rig({ sync: async () => { throw new Error(`fatal: unable to access 'https://bob:${TOKEN}@github.com/x.git'`); } });
  const second = await thrown.host.check();
  assert.equal(second.ok, false);
  assert.doesNotMatch(JSON.stringify(second), new RegExp(`${TOKEN}|bob`));
});

// ---- pull ---------------------------------------------------------------------------------
test("pull asks first while agents are building, and goes ahead with anyway", async () => {
  const r = rig({ world: { builders: true, glance: glanceOf({ behind: 3 }) }, sync: async () => syncResult(r.t, { actions: [{ kind: "pulled", commits: 3 }] }) });
  const asked = await r.host.pull();
  assert.equal(asked.ok, false);
  assert.equal(asked.needsConfirm, "builders");
  assert.equal(asked.error, "Agents are still changing files in this project. Pull now anyway?");
  assert.equal(asked.model.id, "agents-working");
  assert.deepEqual(r.syncCalls, [], "nothing was pulled");
  const pulled = await r.host.pull({ anyway: true });
  assert.equal(pulled.ok, true);
  assert.deepEqual(r.syncCalls, [[false, { pullOnly: true }]]);
  assert.equal(pulled.model.id, "success");
  assert.equal(pulled.model.sentence, "Pulled 3 commits from GitHub.");
  assert.deepEqual(r.models().map((model) => model.busy).slice(-2), ["pulling", null]);
});

test("pull without builders just pulls, and a refused pull says why", async () => {
  const r = rig({ world: { glance: glanceOf({ behind: 1, dirty: 2 }) }, sync: async () => syncResult(r.t, { ok: false, headline: "Could not fast-forward main (uncommitted edits in the way?): x", problems: [{ kind: "pull-refused", detail: "x" }] }) });
  const result = await r.host.pull();
  assert.equal(result.needsConfirm, undefined);
  assert.equal(result.ok, false);
  assert.match(result.error, /Could not fast-forward main/);
  assert.equal(result.model.id, "pull-refused");
  assert.deepEqual(r.syncCalls, [[false, { pullOnly: true }]]);
});

test("rebase is syncProject(true, { rebase: true })", async () => {
  const r = rig({ world: { glance: glanceOf({ ahead: 1, behind: 1 }) }, sync: async () => syncResult(r.t, { actions: [{ kind: "rebased", commits: 1 }] }) });
  const result = await r.host.rebase();
  assert.deepEqual(r.syncCalls, [[true, { rebase: true }]]);
  assert.equal(result.ok, true);
  assert.equal(result.model.id, "success");
  assert.equal(result.model.sentence, "Put 1 commit from this PC on top of GitHub's.");
});

// ---- push ---------------------------------------------------------------------------------
test("push on the default branch with an upstream goes through syncProject(true)", async () => {
  const r = rig({ sync: async () => syncResult(r.t, { actions: [{ kind: "pushed", commits: 2 }] }) });
  const result = await r.host.push();
  assert.deepEqual(r.syncCalls, [[true]]);
  assert.deepEqual(r.called("pushBranch"), []);
  assert.deepEqual(r.checks, [], "sync runs the project's check itself");
  assert.equal(result.ok, true);
  assert.equal(result.model.id, "success");
  assert.equal(result.model.sentence, "Pushed 2 commits to GitHub.");
  assert.equal(result.model.primary.id, "open-github");
});

test("push on another branch goes through pushBranch with the project's check", async () => {
  const r = rig({ world: { glance: onFeature() } });
  const result = await r.host.push();
  assert.deepEqual(r.syncCalls, []);
  const [call] = r.called("pushBranch");
  assert.equal(call[1], ROOT);
  assert.deepEqual(Object.keys(call[2]), ["check"]);
  assert.equal(call[2].check, r.gate, "the function projectCheck returned, not a copy");
  assert.deepEqual(r.checks, [ROOT]);
  assert.equal(result.ok, true);
  assert.equal(result.model.sentence, "Pushed 3 commits to GitHub.");
});

test("a first push of the default branch goes through pushBranch too", async () => {
  const r = rig({ world: { glance: glanceOf({ upstream: null }) } });
  const result = await r.host.push();
  assert.deepEqual(r.syncCalls, []);
  assert.equal(r.called("pushBranch").length, 1);
  assert.equal(result.ok, true);
});

test("push with no repository or a missing folder says so instead of running", async () => {
  const none = rig({ world: { glance: { isRepo: false, available: true } } });
  const a = await none.host.push();
  assert.equal(a.ok, false);
  assert.equal(a.error, link.STATES["not-repo"].sentence);
  assert.deepEqual(none.called("pushBranch"), []);
  assert.deepEqual(none.syncCalls, []);
  const gone = rig({ world: { glance: { isRepo: false, available: false } } });
  assert.equal((await gone.host.push()).error, link.STATES["folder-missing"].sentence);
});

test("a refused push becomes the chip's refusal and stays until the next action", async () => {
  const refusal = link.classifyPush("! [rejected]        feat -> feat (fetch first)\nerror: failed to push some refs\nhint: Updates were rejected because the remote contains work", { branch: "feat" });
  let answer = { ok: false, kind: refusal.kind, error: refusal.text, fix: refusal.fix, refusal };
  const r = rig({ world: { glance: onFeature() }, pushBranch: async () => answer });
  const result = await r.host.push();
  assert.equal(result.ok, false);
  assert.equal(result.error, "GitHub has newer work. Pull first.");
  assert.equal(result.refusal.kind, "non-fast-forward");
  assert.equal(result.model.id, "push-refused");
  assert.deepEqual(result.model.primary, { id: "pull", label: "Pull, then push", confirm: false });
  assert.equal((await r.host.state()).model.id, "push-refused", "still standing on a later read");
  // The next push starts clean.
  answer = { ok: true, commits: 1 };
  const again = await r.host.push();
  assert.equal(again.ok, true);
  assert.equal(again.model.id, "success");
});

test("a failed project check on a branch push reads like sync's check-failed", async () => {
  const r = rig({ world: { glance: onFeature() }, pushBranch: async () => ({ ok: false, kind: "check-failed", error: "The project's check failed, so nothing was pushed. Fix it, then sync again.", detail: "3 tests failed", fix: "ask-mefi-fix" }) });
  const result = await r.host.push();
  assert.equal(result.ok, false);
  assert.equal(result.model.id, "check-failed");
  assert.match(result.model.details.join("\n"), /3 tests failed/);
  assert.equal(result.refusal, undefined, "a failed check is not a refusal from GitHub");
});

test("a refusal sync recorded is classified for the caller", async () => {
  const r = rig({ sync: async () => syncResult(r.t, { ok: false, headline: "GitHub refused the push: rejected", problems: [{ kind: "push-refused", detail: "rejected", stderr: "! [rejected] main -> main (non-fast-forward)" }] }) });
  const result = await r.host.push();
  assert.equal(result.ok, false);
  assert.equal(result.error, "GitHub refused the push: rejected");
  assert.equal(result.refusal.kind, "non-fast-forward");
  assert.equal(result.model.id, "push-refused");
});

test("nothing is forced", async () => {
  const r = rig({ world: { glance: onFeature() } });
  await r.host.push({ force: true, forceWithLease: true, args: ["--force"], remote: "https://evil.example/x.git" });
  const [call] = r.called("pushBranch");
  assert.deepEqual(call[2], { check: r.gate });
});

// ---- one writer at a time --------------------------------------------------------------------
test("writers never overlap, run in the order asked and wait instead of failing", async () => {
  let active = 0;
  let peak = 0;
  const order = [];
  const hold = async (name) => { active += 1; peak = Math.max(peak, active); order.push(`start ${name}`); await tick(20); order.push(`end ${name}`); active -= 1; };
  const r = rig({
    world: { glance: onFeature() },
    pushBranch: async () => { await hold("push"); return { ok: true, commits: 1 }; },
    save: async () => { await hold("save"); return { ok: true, sha: "abc1234", files: 1 }; },
    sync: async () => { await hold("pull"); return syncResult(r.t); },
    publish: async () => { await hold("publish"); return { ok: true, repo: "octo/app", visibility: "private", steps: [] }; },
    link: async () => { await hold("link"); return { ok: true, repo: "octo/other" }; },
  });
  const results = await Promise.all([r.host.push(), r.host.save({ paths: ["a.txt"] }), r.host.pull(), r.host.publish({ owner: "octo", name: "app" }), r.host.rebase(), r.host.link({ repo: "octo/other" })]);
  assert.equal(peak, 1);
  assert.deepEqual(order, ["push", "save", "pull", "publish", "pull", "link"].flatMap((name) => [`start ${name}`, `end ${name}`]));
  assert.deepEqual(results.map((result) => result.ok), [true, true, true, true, true, true]);
});

test("while a writer runs the model carries what it is doing, and one that throws frees the queue", async () => {
  const hold = deferred();
  let boom = false;
  const r = rig({
    world: { glance: onFeature() },
    pushBranch: async () => { if (boom) throw new Error(`push blew up ${TOKEN}`); await hold.promise; return { ok: true, commits: 1 }; },
  });
  const running = r.host.push();
  await tick();
  const mid = await r.host.state();
  assert.equal(mid.model.busy, "pushing");
  assert.equal(mid.model.id, "pushing");
  assert.equal(r.models()[0].busy, "pushing", "sent as soon as it started");
  hold.release();
  const result = await running;
  assert.equal(result.model.busy, null);
  assert.equal(r.models().at(-1).busy, null, "and again when it ended");

  boom = true;
  const broken = await r.host.push();
  assert.equal(broken.ok, false);
  assert.match(broken.error, /push blew up/);
  assert.doesNotMatch(JSON.stringify(broken), new RegExp(TOKEN));
  assert.equal(broken.model.busy, null);
  boom = false;
  hold.release();
  assert.equal((await r.host.push()).ok, true, "the queue is not stuck");
});

// ---- save ----------------------------------------------------------------------------------------
test("savePreview passes the builders flag and the signed-in identity through", async () => {
  const r = rig({ world: { builders: true }, preview: async () => ({ ok: true, files: [{ path: "a.txt", status: "new", bytes: 3, include: true }], message: `Save 1 file ${TOKEN}`, branch: "main", identity: { ok: true, name: "n", email: "e" }, refusal: null, builders: true }) });
  const first = await r.host.savePreview();
  assert.deepEqual(r.called("preview")[0].slice(1), [ROOT, { builders: true, identity: null }]);
  assert.equal(first.files[0].path, "a.txt");
  assert.doesNotMatch(first.message, new RegExp(TOKEN));
  await r.host.account();
  await r.host.savePreview({});
  assert.deepEqual(r.called("preview")[1][2].identity, { name: "octo", email: "octo@users.noreply.github.com" });
});

test("save commits only what the caller listed, then says so", async () => {
  const r = rig({ world: { glance: glanceOf({ dirty: 2 }) } });
  const result = await r.host.save({ paths: ["a.txt", 7, "", { x: 1 }, "b/c.txt"], message: "Fix it", push: false, ignoreBuilders: 1, force: true, root: OTHER });
  const [call] = r.called("save");
  assert.equal(call[1], ROOT);
  assert.deepEqual(call[2], { paths: ["a.txt", "b/c.txt"], message: "Fix it", builders: false, ignoreBuilders: false, identity: null });
  assert.deepEqual(r.called("pushBranch"), []);
  assert.deepEqual(r.syncCalls, []);
  assert.equal(result.ok, true);
  assert.equal(result.sha, "abc1234");
  assert.equal(result.files, 2);
  assert.equal(result.pushed, undefined);
  assert.equal(result.model.id, "success");
  assert.equal(result.model.sentence, "Saved 2 files on this PC.");
  assert.equal(result.model.primary, null);
  assert.deepEqual(r.models().map((model) => model.busy), ["saving", null]);
});

test("save with builders running passes them on, and the refusal is only an error", async () => {
  const r = rig({ world: { builders: true }, save: async () => ({ ok: false, kind: "builders", error: "Agents are still changing files in this project. Wait for them, or save anyway." }) });
  const result = await r.host.save({ paths: ["a.txt"] });
  assert.deepEqual(r.called("save")[0][2].builders, true);
  assert.equal(result.ok, false);
  assert.equal(result.kind, "builders");
  assert.equal(result.refusal, undefined);
  assert.notEqual(result.model.id, "blocked-secret");
  await r.host.save({ paths: ["a.txt"], ignoreBuilders: true });
  assert.equal(r.called("save")[1][2].ignoreBuilders, true);
});

test("a blocked file is the chip's blocked state until the next action", async () => {
  const refusal = { kind: "secret", text: "Stopped: a private key in .env.", fix: "leave-out", state: "blocked-secret", detail: "Stopped: a private key in .env.", file: ".env", label: "private key" };
  let answer = { ok: false, kind: "blocked", error: "Stopped: a private key in .env.", blocked: { path: ".env", kind: "secret", text: "a private key", label: "private key" }, refusal };
  const r = rig({ save: async () => answer });
  const result = await r.host.save({ paths: [".env"] });
  assert.equal(result.ok, false);
  assert.equal(result.blocked.path, ".env");
  assert.equal(result.refusal.kind, "secret");
  assert.equal(result.model.id, "blocked-secret");
  answer = { ok: true, sha: "def5678", files: 1 };
  assert.notEqual((await r.host.save({ paths: ["a.txt"] })).model.id, "blocked-secret");
});

test("save then push chains through the push path and the success state expires after six seconds", async () => {
  const r = rig({
    world: { glance: glanceOf({ dirty: 2 }) },
    sync: async () => { r.t.glance = glanceOf(); return syncResult(r.t, { actions: [{ kind: "pushed", commits: 1 }] }); },
  });
  const result = await r.host.save({ paths: ["a.txt", "b.txt"], message: "Two", push: true });
  assert.deepEqual(r.syncCalls, [[true]]);
  assert.deepEqual(r.calls.map(([name]) => name).filter((name) => ["save", "pushBranch"].includes(name)), ["save"]);
  assert.equal(result.ok, true);
  assert.equal(result.pushed, true);
  assert.equal(result.sha, "abc1234");
  assert.equal(result.files, 2);
  assert.equal(result.model.id, "success");
  assert.equal(result.model.sentence, "Pushed 1 commit to GitHub.");
  assert.deepEqual(r.models().map((model) => model.busy), ["saving", "pushing", null]);

  r.t.now += OUTCOME_MS - 1;
  assert.equal((await r.host.state()).model.id, "success", "still there just before six seconds");
  r.t.now += 1;
  const later = await r.host.state();
  assert.equal(later.model.id, "in-sync", "gone at six seconds");
});

test("a save that lands but whose push fails keeps the sha and says the push did not go", async () => {
  const r = rig({
    world: { glance: onFeature({ dirty: 1 }) },
    pushBranch: async () => ({ ok: false, kind: "offline", error: "GitHub could not be reached. Nothing was pushed.", refusal: link.classifyPush("fatal: unable to access: Could not resolve host: github.com") }),
  });
  const result = await r.host.save({ paths: ["a.txt"], push: true });
  // The save landed, so the answer is ok and says `pushed: false` (the dialog closes on it with a
  // "Saved N files on this PC, but nothing was pushed" toast); ok:false would leave it open on
  // files that are already committed, and a second press fails as "not one of the changed files".
  assert.equal(result.ok, true);
  assert.equal(result.pushed, false);
  assert.equal(result.sha, "abc1234");
  assert.equal(result.files, 2);
  assert.equal(result.error, "GitHub could not be reached. Nothing was pushed.");
  assert.equal(result.refusal.kind, "offline");
  assert.equal(result.model.id, "offline");
});

// ---- account, owners ---------------------------------------------------------------------------------
test("the account is never guessed: unasked is not signed out, and the name is all that leaves", async () => {
  const r = rig({ world: { glance: glanceOf({ ahead: 2 }) } });
  assert.equal((await r.host.state()).model.id, "ahead", "never asked is not signed out");
  const out = rig({ account: async () => ({ ok: true, account: null, ghInstalled: true, gitInstalled: true }) });
  const asked = await out.host.account();
  assert.deepEqual(asked, { ok: true, account: null, ghInstalled: true, gitInstalled: true });
  assert.equal(out.host.model().id, "signed-out", "the chip follows the answer");
  assert.equal((await out.host.state()).model.id, "signed-out");

  const named = await r.host.account();
  assert.deepEqual(named, { ok: true, account: "octo", ghInstalled: true, gitInstalled: true });
  assert.equal((await r.host.state()).model.id, "ahead");

  const none = rig({ account: async () => ({ ok: true, account: null, ghInstalled: false, gitInstalled: true, token: TOKEN }) });
  const missing = await none.host.account();
  assert.deepEqual(missing, { ok: true, account: null, ghInstalled: false, gitInstalled: true });
  assert.equal(none.host.model().primary.id, "install-gh");
});

test("owners answers with the account and its organizations and refreshes what the chip knows", async () => {
  const r = rig();
  const ok = await r.host.owners();
  assert.deepEqual(ok, { ok: true, account: "octo", orgs: ["acme"] });
  assert.equal(r.host.model().id, "ahead");
  const out = rig({ owners: async () => ({ ok: false, kind: "not-signed-in", error: "Sign in to GitHub first.", fix: "sign-in" }) });
  const failed = await out.host.owners();
  assert.equal(failed.ok, false);
  assert.equal(failed.kind, "not-signed-in");
  assert.equal(out.host.model().id, "signed-out");
});

// ---- publish, link -----------------------------------------------------------------------------------------
test("publishPreview passes only the name, owner and choices", async () => {
  const r = rig();
  const result = await r.host.publishPreview({ owner: "octo", name: "app", license: "mit", gitignore: false, root: OTHER, url: "https://evil.example", command: "rm -rf" });
  assert.deepEqual(r.called("publishPreview")[0].slice(1), [ROOT, { owner: "octo", name: "app", gitignore: false, license: "mit" }]);
  assert.equal(result.repo, "octo/app");
  await r.host.publishPreview({ owner: "octo", name: "app" });
  assert.deepEqual(r.called("publishPreview")[1][2], { owner: "octo", name: "app", gitignore: true, license: "none" });
});

test("publish creates the repository, records the outcome and passes only its own fields", async () => {
  const r = rig({ world: { glance: glanceOf({ remote: null, upstream: null, ahead: 0 }) } });
  const result = await r.host.publish({ owner: "octo", name: "app", visibility: "public", description: "A thing", gitignore: false, license: "mit", confirmPublic: "octo/app", path: OTHER, url: "https://evil.example" });
  const [call] = r.called("publish");
  assert.equal(call[1], ROOT);
  assert.deepEqual(call[2], { owner: "octo", name: "app", visibility: "public", description: "A thing", gitignore: false, license: "mit", confirmPublic: "octo/app", identity: null });
  assert.equal(result.ok, true);
  assert.equal(result.repo, "octo/app");
  assert.equal(result.url, "https://github.com/octo/app");
  assert.equal(result.steps.length, 1);
  assert.equal(result.model.id, "success");
  assert.equal(result.model.sentence, "Published octo/app.");
  assert.deepEqual(r.models().map((model) => model.busy), ["publishing", null]);
  await r.host.publish({ owner: "octo", name: "app", visibility: "internal" });
  assert.equal(r.called("publish")[1][2].visibility, "private", "anything but public is private");
});

test("a publish that fails says why, keeps its steps and flips the chip to sign in", async () => {
  const r = rig({ publish: async () => ({ ok: false, kind: "not-signed-in", error: "Sign in to GitHub first.", fix: "sign-in", steps: [] }) });
  const result = await r.host.publish({ owner: "octo", name: "app" });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "not-signed-in");
  assert.equal(result.error, "Sign in to GitHub first.");
  assert.deepEqual(result.steps, []);
  assert.equal(result.model.id, "signed-out");
});

test("link lists repositories from pcSetup and links only through the allow-list", async () => {
  const r = rig();
  assert.deepEqual(await r.host.linkRepos(), await r.pcSetup.repos());
  const result = await r.host.link({ repo: "octo/other", path: OTHER, url: "https://evil.example/x.git" });
  const [call] = r.called("link");
  assert.equal(call[1], ROOT);
  assert.deepEqual(Object.keys(call[2]), ["repo", "isListed"]);
  assert.equal(call[2].repo, "octo/other");
  assert.equal(call[2].isListed, r.pcSetup.isListed);
  assert.equal(result.ok, true);
  assert.equal(result.model.id, "ahead");
  const refused = rig({ link: async () => ({ ok: false, kind: "not-listed", error: "Choose a repository from your list." }) });
  const no = await refused.host.link({ repo: "octo/not-mine" });
  assert.deepEqual([no.ok, no.kind, no.error], [false, "not-listed", "Choose a repository from your list."]);
  assert.ok(no.model);
  const broken = rig();
  broken.pcSetup.repos = async () => { throw new Error(`boom ${TOKEN}`); };
  const listed = await broken.host.linkRepos();
  assert.equal(listed.ok, false, "a listing that throws is an answer, not an exception");
  assert.doesNotMatch(JSON.stringify(listed), new RegExp(TOKEN));
});

// ---- the launch list ------------------------------------------------------------------------------------------
test("glance gives each project a chip: missing folders, unknown ones and the requested ids", async () => {
  const glances = { p1: glanceOf({ ahead: 2 }), p2: { isRepo: false, unborn: false, branch: null, detached: false, dirty: 0, ahead: 0, behind: 0, upstream: null, remote: null, main: "main", onDefault: true, available: true }, p4: null };
  const r = rig({ glanceMany: async (list) => list.map((item) => ({ id: item.id, glance: glances[item.id] ?? null })) });
  const all = await r.host.glance();
  assert.equal(all.ok, true);
  assert.deepEqual(all.items.map((item) => item.id), ["p1", "p2", "p3", "p4"]);
  const [p1, p2, p3, p4] = all.items;
  assert.deepEqual(p1, { id: "p1", available: true, chip: link.chip(link.describe({ glance: glances.p1 })), branch: "main", repo: "octo/app", ahead: 2, behind: 0, dirty: 0 });
  assert.equal(p1.chip.id, "ahead");
  assert.equal(p2.chip.id, "not-repo");
  assert.deepEqual(p3, { id: "p3", available: false, chip: link.chip(link.describe({ glance: { isRepo: false, available: false } })), branch: null, repo: null, ahead: 0, behind: 0, dirty: 0 });
  assert.equal(p3.chip.id, "folder-missing");
  assert.deepEqual(p4, { id: "p4", available: true, chip: null, branch: null, repo: null, ahead: 0, behind: 0, dirty: 0 });
  // Only the folders that exist are looked at, by path from the project list.
  assert.deepEqual(r.called("glanceMany")[0][1], [{ id: "p1", root: PROJECTS[0].path }, { id: "p2", root: PROJECTS[1].path }, { id: "p4", root: PROJECTS[3].path }]);
  const some = await r.host.glance(["p2", "nope", 7]);
  assert.deepEqual(some.items.map((item) => item.id), ["p2"]);
});

test("glance never throws whatever the collaborators do", async () => {
  const boom = () => { throw new Error(`boom ${TOKEN}`); };
  const cases = [
    rig({ listProjects: boom }),
    rig({ exists: boom }),
    rig({ glanceMany: async () => { throw new Error("nope"); } }),
    rig({ glanceMany: async () => "not a list" }),
    rig({ listProjects: () => "not a list" }),
    rig({ listProjects: () => [null, { id: "x" }, { id: "y", path: 3 }, { id: "p1", path: ROOT }] }),
  ];
  for (const r of cases) {
    const result = await r.host.glance();
    assert.equal(typeof result.ok, "boolean");
    assert.ok(Array.isArray(result.items));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
  }
  const unreadable = await cases[2].host.glance();
  assert.deepEqual(unreadable.items.map((item) => item.chip), [null, null, link.chip(link.describe({ glance: { isRepo: false, available: false } })), null]);
});

// ---- events ---------------------------------------------------------------------------------------------------------
test("a sync event for the open project is kept and redrawn, one for another is ignored", async () => {
  const r = rig();
  const problem = syncResult(r.t, { ok: false, problems: [{ kind: "check-failed", detail: "lint failed" }] });
  await r.host.onSyncEvent({ ...problem, state: { ...problem.state, root: ROOT + path.sep } });
  assert.equal(r.models().length, 1);
  assert.equal(r.models()[0].id, "check-failed");
  assert.equal(r.models()[0].checkedAt, r.t.now);
  assert.equal(r.sent[0][0], "git:state");
  assert.equal((await r.host.state()).model.id, "check-failed", "kept for later reads");
  assert.equal(r.host.model().id, "check-failed");

  await r.host.onSyncEvent({ ...problem, state: { ...problem.state, root: OTHER } });
  await r.host.onSyncEvent(null);
  await r.host.onSyncEvent({ problems: [] });
  assert.equal(r.models().length, 1, "nothing else was sent");
});

test("a project change drops what was learned and sends a fresh model", async () => {
  const r = rig();
  await r.host.onSyncEvent(syncResult(r.t, { ok: false, problems: [{ kind: "check-failed", detail: "lint failed" }] }));
  assert.equal(r.host.model().id, "check-failed");
  await r.host.onProjectChanged();
  assert.equal(r.host.model().id, "ahead");
  assert.equal(r.models().at(-1).id, "ahead");
  assert.equal(r.models().at(-1).checkedAt, null);
  // With no project open there is nothing to draw.
  r.t.root = null;
  const before = r.sent.length;
  await r.host.onProjectChanged();
  assert.equal(r.host.model(), null);
  assert.equal(r.sent.length, before);
});

test("an answer that arrives after the project changed is not sent", async () => {
  const hold = deferred();
  const r = rig({ world: { glance: onFeature() }, pushBranch: async () => { await hold.promise; return { ok: true, commits: 1 }; } });
  const running = r.host.push();
  await tick();
  r.t.root = OTHER;
  r.t.projectId = "p2";
  await r.host.onProjectChanged();
  const sentBefore = r.sent.length;
  hold.release();
  const result = await running;
  assert.equal(result.ok, true, "the caller still gets its answer");
  assert.equal(r.sent.length, sentBefore, "the old project's model is not drawn over the new one");
});

// ---- scrubbing ------------------------------------------------------------------------------------------------------------
test("every error that leaves passes through scrub", async () => {
  const dirty = `fatal: unable to access 'https://bob:${TOKEN}@github.com/octo/app.git/': token ${TOKEN}`;
  const r = rig({
    world: { glance: onFeature() },
    pushBranch: async () => ({ ok: false, kind: "git", error: dirty }),
    save: async () => { throw new Error(dirty); },
    publish: async () => ({ ok: false, kind: "git", error: dirty, steps: [{ id: "push", label: dirty, ok: false }] }),
    link: async () => ({ ok: false, kind: "git", error: dirty }),
    owners: async () => ({ ok: false, kind: "git", error: dirty }),
    sync: async () => { throw new Error(dirty); },
  });
  const results = [await r.host.push(), await r.host.save({ paths: ["a"] }), await r.host.publish({ owner: "o", name: "n" }), await r.host.link({ repo: "octo/other" }), await r.host.owners(), await r.host.pull(), await r.host.check(), await r.host.rebase()];
  for (const result of results) {
    assert.doesNotMatch(JSON.stringify(result), new RegExp(`${TOKEN}|bob`), JSON.stringify(result).slice(0, 200));
    assert.equal(result.ok, false);
  }
  for (const model of r.models()) assert.doesNotMatch(JSON.stringify(model), new RegExp(TOKEN));
});

// ---- review fixes (S2): adversarial cases ------------------------------------------------------------------------------
test("a sync-backed writer queued behind another never runs against a project opened meanwhile", async () => {
  const hold = deferred();
  const r = rig({ link: async () => { await hold.promise; return { ok: true, repo: "octo/other" }; } });
  const first = r.host.link({ projectId: "p1", repo: "octo/other" });
  await tick();
  const rebase = r.host.rebase({ projectId: "p1" });
  const pull = r.host.pull({ projectId: "p1" });
  const push = r.host.push({ projectId: "p1" });
  r.t.root = OTHER;
  r.t.projectId = "p2";
  hold.release();
  const results = await Promise.all([first, rebase, pull, push]);
  assert.deepEqual(r.syncCalls, [], "syncProject takes no folder: it would have synced the newly opened project");
  for (const result of results.slice(1)) {
    assert.equal(result.ok, false);
    assert.equal(result.error, CHANGED.error);
  }
});

test("save then push stops the push when the owner opened another project during the save", async () => {
  const hold = deferred();
  const r = rig({ save: async () => { await hold.promise; return { ok: true, sha: "abc1234", files: 1 }; } });
  const saving = r.host.save({ projectId: "p1", paths: ["a.txt"], push: true });
  await tick();
  r.t.root = OTHER;
  r.t.projectId = "p2";
  hold.release();
  const result = await saving;
  assert.equal(r.called("save")[0][1], ROOT, "the save went to the project it was asked for");
  assert.deepEqual(r.syncCalls, [], "the push did not sync the other project");
  assert.equal(result.ok, true, "the save landed, so the dialog closes on it (pushed:false says the rest)");
  assert.equal(result.pushed, false);
  assert.equal(result.sha, "abc1234", "the save is still reported");
  assert.equal(result.error, CHANGED.error);
});

test("a chip model that cannot be described frees the queue and the checking flag", async () => {
  let broken = true;
  const flaky = { ...link, describe: (input) => { if (broken) throw new Error("describe blew up"); return link.describe(input); } };
  const r = rig({ linkModule: flaky, world: { glance: onFeature() } });
  const pushed = await r.host.push();
  assert.equal(pushed.ok, false);
  const checked = await r.host.check();
  assert.equal(checked.ok, false);
  broken = false;
  const mid = await r.host.state();
  assert.equal(mid.model.busy, null, "neither the writer's busy flag nor the check's is left standing");
  assert.notEqual(mid.model.id, "pushing");
  assert.notEqual(mid.model.id, "checking");
  const again = await r.host.push();
  assert.equal(again.ok, true, "the queue still runs");
});

test("pull asks again about agents that started while it waited its turn", async () => {
  const hold = deferred();
  const r = rig({ world: { glance: onFeature() }, pushBranch: async () => { await hold.promise; return { ok: true, commits: 1 }; } });
  const first = r.host.push();
  await tick();
  const pulling = r.host.pull({ projectId: "p1" });
  r.t.builders = true;
  hold.release();
  await first;
  const answer = await pulling;
  assert.equal(answer.ok, false);
  assert.equal(answer.needsConfirm, "builders");
  assert.deepEqual(r.syncCalls, [], "nothing was pulled under the agents");
  // The owner's yes still goes through.
  r.t.builders = true;
  assert.equal((await r.host.pull({ anyway: true })).ok, true);
  assert.deepEqual(r.syncCalls, [[false, { pullOnly: true }]]);
});

test("a project check that cannot be read holds the push instead of skipping the check", async () => {
  const r = rig({ world: { glance: onFeature() }, projectCheck: async () => { throw new Error(`no check for you ${TOKEN}`); } });
  const result = await r.host.push();
  assert.equal(result.ok, false);
  assert.match(result.error, /nothing was pushed/i);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
  assert.deepEqual(r.called("pushBranch"), [], "pushBranch never ran without its gate");
  assert.equal(result.model.id, "check-failed");
  // Through save-and-push as well.
  const saved = await r.host.save({ paths: ["a.txt"], push: true });
  assert.equal(saved.ok, true, "the save landed; only the push was held");
  assert.equal(saved.pushed, false);
  assert.match(saved.error, /nothing was pushed/i);
  assert.deepEqual(r.called("pushBranch"), []);
});

test("the chip model that leaves is scrubbed, including branch names", async () => {
  const r = rig({ world: { glance: onFeature({ branch: TOKEN }) } });
  const state = await r.host.state();
  assert.doesNotMatch(JSON.stringify(state), new RegExp(TOKEN));
  await r.host.check();
  await r.host.push();
  for (const model of r.models()) assert.doesNotMatch(JSON.stringify(model), new RegExp(TOKEN));
  assert.doesNotMatch(JSON.stringify(r.host.model()), new RegExp(TOKEN));
});

test("a success stamped in the future (the clock stepped back) does not linger", async () => {
  const r = rig({ sync: async () => syncResult(r.t, { actions: [{ kind: "pushed", commits: 2 }] }) });
  assert.equal((await r.host.push()).model.id, "success");
  r.t.now -= 60_000;
  assert.notEqual((await r.host.state()).model.id, "success");
});

test("a thrown value with no string form still becomes an error, not a rejection", async () => {
  const r = rig({ world: { glance: onFeature() }, pushBranch: async () => { throw Object.create(null); }, owners: async () => { throw Symbol("odd"); } });
  const result = await r.host.push();
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.ok(result.error.length > 0, "and it says something");
  assert.equal(result.model?.busy, null, "it came through the writer, with a fresh chip, not only the outer catch");
  const owners = await r.host.owners();
  assert.equal(owners.ok, false);
  assert.equal(typeof owners.error, "string");
  assert.ok(owners.error.length > 0);
  assert.equal((await r.host.push()).ok, false, "and the queue is not stuck");
});

test("a sync event naming the repository around the project folder is kept, a sibling's is not", async () => {
  const r = rig();
  const around = syncResult(r.t, { ok: false, problems: [{ kind: "offline", detail: "no network" }] });
  around.state.root = path.dirname(ROOT);
  await r.host.onSyncEvent(around);
  assert.equal((await r.host.state()).model.id, "offline");
  const r2 = rig();
  const sibling = syncResult(r2.t, { ok: false, problems: [{ kind: "offline", detail: "no network" }] });
  sibling.state.root = OTHER;
  await r2.host.onSyncEvent(sibling);
  assert.notEqual((await r2.host.state()).model.id, "offline");
});

test("glance on a hostile or huge project list stays bounded and never throws", async () => {
  const many = Array.from({ length: 1500 }, (_, index) => ({ id: `q${index}`, name: "x", path: path.resolve("fake-projects", `q${index}`) }));
  const hostile = [null, 7, "x", { id: 1, path: ROOT }, { id: "__proto__", path: ROOT }, { id: "constructor", path: `${ROOT}\0x` }, { id: "ok", path: "" }];
  const r = rig({ listProjects: () => [...hostile, ...many] });
  const all = await r.host.glance();
  assert.equal(all.ok, true);
  assert.ok(all.items.length <= 500, `${all.items.length} items`);
  assert.equal(r.called("glanceMany")[0][1].length <= 500, true);
  const wanted = await r.host.glance(["q3", "q1400", 5, null]);
  assert.equal(wanted.ok, true);
  assert.deepEqual(wanted.items.map((item) => item.id), ["q3", "q1400"]);
  const worse = rig({ listProjects: () => { throw new Error("no list"); } });
  assert.deepEqual(await worse.host.glance(), { ok: true, items: [] });
});

// ---- the bridge contract: what renderer/git-sync.js and vibe-panels.js read ---------------------------
test("the Publish dialog reads the name's own complaint as issue, beside the folder's publishIssue", async () => {
  const nameIssue = "Use letters, numbers, dots, dashes and underscores.";
  const r = rig({ publishPreview: async () => ({ ok: true, repo: "octo/a b", valid: false, sanitized: "a-b", taken: false, nameIssue, suggestions: [], publishIssue: null, ghInstalled: true, account: "octo" }) });
  const res = await r.host.publishPreview({ owner: "octo", name: "a b" });
  assert.equal(res.issue, nameIssue);
  assert.equal(res.nameIssue, nameIssue, "the actions spelling stays too");
  assert.equal(res.publishIssue, null);
  const fine = await rig().host.publishPreview({ owner: "octo", name: "app" });
  assert.equal("issue" in fine, false, "no complaint, no issue");
  const own = rig({ publishPreview: async () => ({ ok: true, valid: false, nameIssue: "x", issue: "already said" }) });
  assert.equal((await own.host.publishPreview({ owner: "octo", name: "x" })).issue, "already said", "an issue actions set itself is kept");
});

test("the REAL publishPreview's invalid-name answer reaches the dialog as issue (git only, gh absent, no network)", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "gh-issue-"));
  try {
    writeFileSync(path.join(folder, "a.txt"), "hello\n");
    // git runs for real in the throwaway folder; gh, PowerShell and anything else are simply not installed.
    const onlyGit = (command, args, options, callback) => {
      if (command === "git") return execFile(command, args, options, callback);
      callback(Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" }), "", "");
      return { kill() {} };
    };
    const actions = createGitActions({ execFile: onlyGit, env: () => process.env });
    const host = createGitHost({
      actions, link, context: () => ({ root: folder, projectId: "p1", builders: false }), listProjects: () => [], syncProject: async () => null,
      projectCheck: async () => null, pcSetup: { isListed: () => false, repos: async () => ({ ok: false }) }, send: () => {}, exists: (item) => existsSync(item), now: () => Date.now(),
    });
    const res = await host.publishPreview({ owner: "octo", name: "bad name" });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.valid, false);
    assert.equal(res.sanitized, "bad-name", "the dialog offers the name GitHub takes");
    assert.equal(res.issue, "Use letters, numbers, dots, dashes and underscores.");
    assert.equal(res.needsSignIn, true, "gh is not installed here");
    assert.equal(res.ghInstalled, false);
    assert.ok(Array.isArray(res.files) && res.files.some((file) => file.path === "a.txt"));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("the success state is pushed out again when it ends, because the renderer only redraws what it is sent", async () => {
  const timers = [];
  const r = rig({
    later: (ms, run) => timers.push({ ms, run }),
    world: { glance: glanceOf({ ahead: 1 }) },
    sync: async () => { r.t.glance = glanceOf(); return syncResult(r.t, { actions: [{ kind: "pushed", commits: 1 }] }); },
  });
  const done = await r.host.push();
  assert.equal(done.model.id, "success");
  assert.equal(timers.length, 1, "one expiry is scheduled for the finished action");
  assert.ok(timers[0].ms > OUTCOME_MS && timers[0].ms < OUTCOME_MS + 2000, `a little after six seconds, not ${timers[0].ms}`);
  const before = r.models().length;
  r.t.now += OUTCOME_MS + 250;
  await timers[0].run();
  assert.equal(r.models().length, before + 1, "one more model went out on git:state");
  assert.equal(r.models().at(-1).id, "in-sync");
  assert.equal(r.host.model().id, "in-sync");
  // Nothing to expire, nothing scheduled: a failed action has no success state.
  const failing = rig({ later: (ms, run) => timers.push({ ms, run }), sync: async () => ({ ok: false, headline: "No.", problems: [{ kind: "error" }], actions: [] }) });
  const count = timers.length;
  await failing.host.push();
  assert.equal(timers.length, count);
});

test("an expiry does nothing for an outcome another action replaced, or for a project that has gone", async () => {
  const timers = [];
  const r = rig({
    later: (ms, run) => timers.push({ ms, run }),
    world: { glance: glanceOf({ ahead: 1 }) },
    sync: async () => syncResult(r.t, { actions: [{ kind: "pushed", commits: 1 }] }),
  });
  await r.host.push();
  r.t.now += 100;
  await r.host.push();
  assert.equal(timers.length, 2);
  r.t.now += OUTCOME_MS + 250;
  let seen = r.models().length;
  await timers[0].run();
  assert.equal(r.models().length, seen, "the first push's timer finds a newer outcome and stays quiet");
  await r.host.onProjectChanged();
  seen = r.models().length;
  await timers[1].run();
  assert.equal(r.models().length, seen, "a project change ended everything the old project was showing");
  // A throwing timer facility never costs the action its answer.
  const broken = rig({ later: () => { throw new Error("no timers"); }, sync: async () => syncResult(broken.t, { actions: [{ kind: "pushed", commits: 1 }] }) });
  assert.equal((await broken.host.push()).ok, true);
});

test("main.cjs stamps every opening for the launch list and hands the host its expiry timer", () => {
  const source = require("node:fs").readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // Any way a folder becomes the open project (picked, added, made, cloned) goes through adoptProject.
  assert.match(source, /gitHostHooks\.onProjectChanged\(\);\n\s+\/\/[^\n]*\n\s+if \(typeof stampProjectOpened === "function" && next && !next\.placeholder\) void stampProjectOpened\(next\.id\);/);
  // A launch that reopened the folder on its own (resume, started with Windows) never asks the launch screen.
  assert.match(source, /if \(startupResumed\) \{\n\s+startupChosen = true;\n\s+\/\/[^\n]*\n\s+if \(typeof stampProjectOpened === "function"\) void stampProjectOpened\(startupResumed\.projectId\);/);
  // The chip's "Done" ends by an unref'd timer main.cjs hands over, and the factory declares it.
  assert.match(source, /later: \(ms, run\) => \{ const timer = setTimeout\(run, ms\); timer\.unref\?\.\(\); \},/);
  assert.match(require("node:fs").readFileSync(new URL("../scripts/git-host.cjs", import.meta.url), "utf8"), /function createGitHost\(\{[^}]*\blater\b/);
});

test("the REAL preview and save carry every field the Save dialog reads, and sign as the GitHub account when git has no identity", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "gh-save-"));
  const bare = mkdtempSync(path.join(tmpdir(), "gh-home-"));
  try {
    // A git with no name, no email and no config of its own; gh answers only "who am I".
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(GIT_AUTHOR|GIT_COMMITTER|EMAIL$)/i.test(name)));
    Object.assign(env, { GIT_CONFIG_GLOBAL: path.join(bare, "none"), GIT_CONFIG_SYSTEM: path.join(bare, "none"), GIT_CONFIG_NOSYSTEM: "1", HOME: bare, USERPROFILE: bare });
    const seat = ["-c", "user.name=Seed", "-c", "user.email=seed@example.com"];
    const git = (...args) => execFileSync("git", args, { cwd: folder, env, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    writeFileSync(path.join(folder, "a.txt"), "one\n");
    git("add", "a.txt");
    git(...seat, "commit", "-q", "-m", "seed");
    appendFileSync(path.join(folder, "a.txt"), "two\n");
    writeFileSync(path.join(folder, "b.txt"), "new\n");
    writeFileSync(path.join(folder, ".env"), "TOKEN=1\n");
    const stub = (command, args, options, callback) => {
      if (command === "git") return execFile(command, args, options, callback);
      if (command === "gh" && args[0] === "auth") callback(null, "github.com\n  Logged in to github.com account octo (keyring)\n", "");
      else callback(Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" }), "", "");
      return { kill() {} };
    };
    const host = createGitHost({
      actions: createGitActions({ execFile: stub, env: () => env }), link, context: () => ({ root: folder, projectId: "p1", builders: false }), listProjects: () => [],
      syncProject: async () => null, projectCheck: async () => null, pcSetup: { isListed: () => false, repos: async () => ({ ok: false }) }, send: () => {}, exists: (item) => existsSync(item), now: () => Date.now(),
    });
    const preview = await host.savePreview({});
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(preview.branch, "main");
    assert.equal(preview.refusal, null);
    assert.equal(preview.builders, false);
    assert.match(preview.message, /^Studio save: 2 files?$/);
    const rows = Object.fromEntries(preview.files.map((file) => [file.path, file]));
    assert.deepEqual(Object.keys(rows).sort(), [".env", "a.txt", "b.txt"]);
    assert.deepEqual([rows["a.txt"].status, rows["b.txt"].status], ["changed", "new"]);
    assert.equal(rows["a.txt"].include, true);
    assert.ok(Number.isFinite(rows["a.txt"].bytes));
    assert.equal(rows[".env"].include, false, "a private file is not ticked");
    assert.equal(typeof rows[".env"].blocked.text, "string", "and says why in words");
    assert.equal(preview.identity.ok, true);
    assert.equal(preview.identity.fromAccount, true, "git has no name here: the dialog says the GitHub account signs");
    assert.equal(preview.identity.name, "octo");

    const stopped = await host.save({ paths: ["a.txt", ".env"], message: "with a secret" });
    assert.equal(stopped.ok, false);
    assert.equal(stopped.kind, "blocked");
    assert.equal(stopped.blocked.path, ".env");
    assert.equal(stopped.model.id, "blocked-secret", "the chip states the stop");

    const saved = await host.save({ paths: ["a.txt", "b.txt"], message: "Two files", push: false });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.files, 2);
    assert.match(saved.sha, /^[0-9a-f]{40}$/);
    assert.equal(saved.model.id, "success");
    assert.equal(saved.model.sentence, "Saved 2 files on this PC.");
    assert.equal(git("log", "-1", "--format=%an|%s"), "octo|Two files");
    assert.equal(git("status", "--porcelain").trim(), "?? .env", "only what was ticked was committed");
  } finally { rmSync(folder, { recursive: true, force: true }); rmSync(bare, { recursive: true, force: true }); }
});
