// Multi-PC sync and the worktree table and actions, JavaScript
// (scripts/sync.mjs, worktrees.mjs, worktree-actions.mjs) against Rust
// (crates/mefi-core repo, docs/rust-migration.md stage 2). Mutating calls
// cannot run twice on one repository, so two identical setups are built
// (fixed authors and dates, so every commit id matches) and the same calls
// run through JavaScript on one and Rust on the other; answers are compared
// with each setup's folder masked.
//
// Needs the mefi-core binary (npm run host:core); skips without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as sync from "../scripts/sync.mjs";
import * as worktrees from "../scripts/worktrees.mjs";
import * as actions from "../scripts/worktree-actions.mjs";
import { coreBinary } from "../scripts/rust-host.mjs";

const binary = coreBinary();
const skip = existsSync(binary) ? false : `mefi-core is not built (${binary}); run npm run host:core`;
const MODULES = { sync, worktrees, "worktree-actions": actions };

function setup(base) {
  let tick = 0;
  const env = () => {
    tick += 1;
    const date = `2026-01-01T00:${String(Math.floor(tick / 60)).padStart(2, "0")}:${String(tick % 60).padStart(2, "0")}Z`;
    return { ...process.env, GIT_AUTHOR_NAME: "Parity", GIT_AUTHOR_EMAIL: "parity@example.invalid", GIT_COMMITTER_NAME: "Parity", GIT_COMMITTER_EMAIL: "parity@example.invalid", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: env(), encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file, text) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const remote = path.join(base, "remote.git");
  const work = path.join(base, "work");
  const other = path.join(base, "other");
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(base, "clone", "-q", remote, work);
  git(work, "config", "core.autocrlf", "false");
  git(work, "symbolic-ref", "HEAD", "refs/heads/main");
  // Task runs live under .mefi/worktrees inside the checkout, which projects exclude.
  write(path.join(work, ".git", "info", "exclude"), ".mefi/\n");
  write(path.join(work, "a.txt"), "one\n");
  write(path.join(work, "f.txt"), "base\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "first");
  git(work, "push", "-q", "origin", "main");
  git(base, "clone", "-q", remote, other);
  git(other, "config", "core.autocrlf", "false");
  return { git, write, remote, work, other };
}

const CONST = (value) => ({ $mefi: "const", value });
// sync's `check` is awaited with .catch, so its stand-in answers a promise.
const ASYNC = (value) => ({ $mefi: "const", value, async: true });
const asJs = (value) => {
  if (value && typeof value === "object" && value.$mefi === "const") return value.async ? async () => value.value : () => value.value;
  if (Array.isArray(value)) return value.map(asJs);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asJs(item)]));
  return value;
};

function mask(value, base) {
  const forms = [...new Set([base, base.replace(/\\/g, "/"), path.resolve(base)].flatMap((form) => [form, form.toLowerCase()]))].sort((a, b) => b.length - a.length);
  const text = JSON.stringify(value, (key, item) => (key === "checkedAt" ? "<time>" : item));
  let out = text;
  for (const form of forms) out = out.split(JSON.stringify(form).slice(1, -1)).join("<base>").split(form).join("<base>");
  return JSON.parse(out.replace(/refs\/mefi\/rescue\/([A-Za-z0-9._-]+)-\d{8}T\d{6}/g, "refs/mefi/rescue/$1-<stamp>"));
}

async function runJs(steps, base) {
  const out = [];
  for (const step of steps) {
    if (step.do) { step.do(base); out.push({ ok: true, value: "done" }); continue; }
    const [module, name] = step.fn.split(".");
    try {
      out.push({ ok: true, value: JSON.parse(JSON.stringify(await MODULES[module][name](...asJs(step.args(base))) ?? null)) });
    } catch (error) {
      out.push({ ok: false, error: String(error?.message ?? error) });
    }
  }
  return out;
}

function runRust(steps, base) {
  // Steps that change the repositories between calls split the batch.
  const out = [];
  let batch = [];
  const flush = () => {
    if (!batch.length) return;
    const result = spawnSync(binary, ["repo-batch"], { input: JSON.stringify(batch), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    out.push(...JSON.parse(result.stdout));
    batch = [];
  };
  for (const step of steps) {
    if (step.do) { flush(); step.do(base); out.push({ ok: true, value: "done" }); continue; }
    batch.push({ function: step.fn, args: step.args(base) });
  }
  flush();
  return out;
}

function compare(steps, js, rust, jsBase, rustBase) {
  assert.equal(rust.length, js.length);
  steps.forEach((step, index) => {
    const label = `step ${index} ${step.fn ?? "(change)"}`;
    assert.equal(rust[index].ok, js[index].ok, `${label}: ${js[index].error ?? ""} / ${rust[index].error ?? ""}`);
    if (js[index].ok) assert.deepEqual(mask(rust[index].value, rustBase), mask(js[index].value, jsBase), label);
  });
}

async function parity(t, prefix, build, steps) {
  const jsBase = mkdtempSync(path.join(tmpdir(), `${prefix}-js-`));
  const rustBase = mkdtempSync(path.join(tmpdir(), `${prefix}-rs-`));
  t.after(() => {
    for (const dir of [jsBase, rustBase]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const jsRepo = build(jsBase);
  const rustRepo = build(rustBase);
  const resolved = steps({ js: jsRepo, rust: rustRepo });
  const js = await runJs(resolved.map((step) => ({ ...step, args: () => step.args(jsRepo), do: step.do && (() => step.do(jsRepo)) })), jsBase);
  const rust = runRust(resolved.map((step) => ({ ...step, args: () => step.args(rustRepo), do: step.do && (() => step.do(rustRepo)) })), rustBase);
  compare(resolved, js, rust, jsBase, rustBase);
}

test("sync answers the same: clean, behind, ahead with a check, diverged, rebase", { skip, timeout: 240000 }, async (t) => {
  await parity(t, "mefi-parity-sync", (base) => setup(base), () => [
    { fn: "sync.inspect", args: (r) => [r.work] },
    { fn: "sync.sync", args: (r) => [r.work, { push: false }] },
    { fn: "sync.inspect", args: (r) => [path.join(r.work, "..", "not-a-repo-folder")] },
    { do: (r) => { r.write(path.join(r.other, "b.txt"), "from the other pc\n"); r.git(r.other, "add", "."); r.git(r.other, "commit", "-q", "-m", "other pc"); r.git(r.other, "push", "-q", "origin", "HEAD:main"); } },
    { fn: "sync.remoteMoved", args: (r) => [r.work] },
    { fn: "sync.sync", args: (r) => [r.work, { push: false }] },
    { do: (r) => { r.write(path.join(r.work, "c.txt"), "local work\n"); r.git(r.work, "add", "."); r.git(r.work, "commit", "-q", "-m", "local"); r.write(path.join(r.work, "dirty.txt"), "uncommitted\n"); r.git(r.work, "branch", "local-only"); } },
    { fn: "sync.changedFiles", args: (r) => [r.work] },
    { fn: "sync.sync", args: (r) => [r.work, { check: ASYNC({ ok: false, detail: "lint: 3 errors" }) }] },
    { fn: "sync.sync", args: (r) => [r.work, { check: ASYNC({ ok: true }) }] },
    { do: (r) => { r.write(path.join(r.other, "d.txt"), "more from the other pc\n"); r.git(r.other, "add", "."); r.git(r.other, "commit", "-q", "-m", "other again"); r.git(r.other, "pull", "-q", "--rebase", "origin", "main"); r.git(r.other, "push", "-q", "origin", "HEAD:main"); r.write(path.join(r.work, "e.txt"), "ahead again\n"); r.git(r.work, "add", "e.txt"); r.git(r.work, "commit", "-q", "-m", "ahead"); } },
    { fn: "sync.sync", args: (r) => [r.work, { check: ASYNC({ ok: true }) }] },
    { fn: "sync.sync", args: (r) => [r.work, { rebase: true, check: ASYNC({ ok: true }) }] },
    { do: (r) => { r.git(r.work, "stash", "push", "-q", "-u", "-m", "parity"); } },
    { fn: "sync.sync", args: (r) => [r.work, { rebase: true, check: ASYNC({ ok: true }) }] },
    { fn: "sync.inspect", args: (r) => [r.work] },
  ]);
});

test("lost work: a merge that kept only one side is found, weighed and acknowledged", { skip, timeout: 240000 }, async (t) => {
  const build = (base) => {
    const r = setup(base);
    r.git(r.work, "checkout", "-q", "-b", "side");
    r.write(path.join(r.work, "f.txt"), Array.from({ length: 260 }, (_, i) => `line ${i}`).join("\n") + "\n");
    r.write(path.join(r.work, "TESTRUNS.md"), "exempt\n");
    r.git(r.work, "add", ".");
    r.git(r.work, "commit", "-q", "-m", "side work");
    r.git(r.work, "checkout", "-q", "main");
    r.write(path.join(r.work, "g.txt"), "main work\n");
    r.git(r.work, "add", ".");
    r.git(r.work, "commit", "-q", "-m", "main work");
    r.git(r.work, "merge", "-q", "-s", "ours", "side", "-m", "merge keeping main");
    return r;
  };
  await parity(t, "mefi-parity-lost", build, () => [
    { fn: "sync.lostWork", args: (r) => [r.work, { range: "main", tip: "main", first: true, limit: 30 }] },
    { fn: "sync.lostWork", args: (r) => [r.work, { range: "main", tip: "main", first: true, limit: 30, minLines: 1000 }] },
    { fn: "sync.lostWork", args: (r) => [r.work, { range: "origin/main..main", tip: "main" }] },
    { fn: "sync.sync", args: (r) => [r.work, { check: ASYNC({ ok: true }) }] },
    { do: (r) => { r.write(path.join(r.work, "h.txt"), "ack\n"); r.git(r.work, "add", "."); r.git(r.work, "commit", "-q", "-m", "note\n\nLost-work-ok: the side branch was abandoned"); } },
    { fn: "sync.lostWork", args: (r) => [r.work, { range: "main", tip: "main", first: true, limit: 30 }] },
    { fn: "sync.sync", args: (r) => [r.work, { check: ASYNC({ ok: true }) }] },
  ]);
});

test("the worktree table and its actions answer the same", { skip, timeout: 240000 }, async (t) => {
  const build = (base) => {
    const r = setup(base);
    const dev = path.join(base, "wt-dev");
    const run = path.join(r.work, ".mefi", "worktrees", "run_parity_1");
    const merged = path.join(base, "wt-merged");
    const detached = path.join(base, "wt-detached");
    r.git(r.work, "worktree", "add", "-q", "-b", "feature", dev);
    r.write(path.join(dev, "feature.txt"), "feature\n");
    r.git(dev, "add", ".");
    r.git(dev, "commit", "-q", "-m", "feature work");
    r.git(r.work, "worktree", "add", "-q", "-b", "mefi/run_parity_1", run);
    r.write(path.join(run, "run.txt"), "uncommitted run output\n");
    r.git(r.work, "worktree", "add", "-q", "-b", "done", merged);
    r.git(r.work, "worktree", "add", "-q", "--detach", detached);
    r.write(path.join(detached, "loose.txt"), "loose\n");
    r.git(detached, "add", ".");
    r.git(detached, "commit", "-q", "-m", "loose commit");
    r.dev = dev; r.run = run; r.merged = merged; r.detached = detached;
    return r;
  };
  await parity(t, "mefi-parity-wt", build, () => [
    { fn: "worktrees.listWorktrees", args: (r) => [r.work] },
    { fn: "worktrees.inspectWorktree", args: (r) => [r.work, r.dev] },
    { fn: "worktrees.inspectWorktree", args: (r) => [r.work, path.join(r.work, "nowhere")] },
    { fn: "worktrees.listWorktrees", args: (r) => [path.join(r.work, "..")] },
    { fn: "worktree-actions.worktreeFolder", args: (r) => [r.work, r.dev] },
    { fn: "worktree-actions.mergeWorktree", args: (r) => [r.work, r.work] },
    { fn: "worktree-actions.mergeWorktree", args: (r) => [r.work, r.dev, { inUse: CONST(true) }] },
    { fn: "worktree-actions.mergeWorktree", args: (r) => [r.work, r.run] },
    { fn: "worktree-actions.mergeWorktree", args: (r) => [r.work, r.detached] },
    { fn: "worktree-actions.mergeWorktree", args: (r) => [r.work, r.merged] },
    { fn: "worktree-actions.mergeWorktree", args: (r) => [r.work, r.dev, { builders: true }] },
    { fn: "worktree-actions.mergeWorktree", args: (r) => [r.work, r.dev, { builders: true, anyway: true, remove: true, inUse: CONST(false) }] },
    { fn: "worktree-actions.removeWorktree", args: (r) => [r.work, r.run] },
    { fn: "worktree-actions.removeWorktree", args: (r) => [r.work, r.run, { force: true }] },
    { fn: "worktree-actions.removeWorktree", args: (r) => [r.work, r.detached] },
    { fn: "worktree-actions.removeWorktree", args: (r) => [r.work, r.work] },
    { do: (r) => rmSync(r.merged, { recursive: true, force: true }) },
    { fn: "worktrees.listWorktrees", args: (r) => [r.work] },
    { fn: "worktree-actions.worktreeFolder", args: (r) => [r.work, r.merged] },
    { fn: "worktree-actions.pruneWorktrees", args: (r) => [r.work] },
    { fn: "worktrees.listWorktrees", args: (r) => [r.work] },
  ]);
});
