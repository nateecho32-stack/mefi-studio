#!/usr/bin/env node
// Mefi's Studio AI+ — keeps one project's checkout in step with its default
// branch on GitHub, so work begun on one PC is waiting on the next. Three
// callers share it:
//   npm run sync                  fetch, fast-forward, run the project's own
//                                 check, push the default branch's local
//                                 commits, then report what GitHub still lacks
//                                 (--rebase puts diverged commits on top of
//                                 GitHub's first; --no-check skips the check)
//   node scripts/sync.mjs --hook  the Claude Code SessionStart hook in
//                                 .claude/settings.json: fetch and
//                                 fast-forward only, never push, never fail
//   main.cjs "Multi-PC sync"      sync:status (fetch and look), sync:run, the
//                                 background look behind the Friends badge and
//                                 the question Studio asks before it closes
//
// It acts only on the default branch (origin/HEAD, else main or master) while
// that branch is checked out, and only in safe directions: a fast-forward
// (Git refuses one that would overwrite uncommitted edits), a push GitHub
// accepts without force, and, when asked and nothing is uncommitted, a rebase
// of this PC's commits onto GitHub's that is abandoned on the first conflict.
// A push waits for the caller's check (the project's `npm run check`) and
// never happens when it fails. It never merges, stashes, switches branches or
// discards anything. What needs a person or a Claude session comes back as
// `pending` items, and every caller's wording comes from `headline` and
// `lines` here. Git runs without a shell or a terminal prompt, and remote URLs
// lose any user:password part before an error reaches a caller.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REMOTE = "origin";
const CHECK_TIMEOUT_MS = 10 * 60 * 1000;
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const firstLine = (text) => scrub(String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "");
const lastLine = (text) => scrub(String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "");
export const scrub = (text) => String(text ?? "").replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1");
// Pending kinds that exist only on this PC: losing the PC loses them.
const LOCAL_ONLY = new Set(["uncommitted", "unpushed", "stash", "worktree", "local-branch"]);

export function runGit(cwd, args, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
      resolve({ ok: !error, timedOut: Boolean(error?.killed), stdout: String(stdout ?? "").trim(), stderr: scrub(String(stderr ?? "").trim() || error?.message || "") });
    });
  });
}

// A fetch that failed because the network did is a state (offline): the last
// answer still stands. Anything else (a lapsed sign-in, a renamed or missing
// repository, a bad address) means GitHub may hold work this PC cannot see,
// so it is a failure the caller has to show.
const NETWORK_FAILURE = /could not resolve (host|proxy)|failed to connect|connection (timed out|refused|reset)|operation timed out|network is unreachable|no route to host|temporary failure in name resolution|recv failure|early eof|ssl_(error|connect)|getaddrinfo|enotfound|etimedout|econnreset|econnrefused/i;
export const fetchFailure = (result) => (result?.timedOut || NETWORK_FAILURE.test(String(result?.stderr ?? "")) ? "offline" : "fetch-failed");

const lines = (text) => (text ? text.split(/\r?\n/).filter(Boolean) : []);

async function defaultBranch(git) {
  const head = await git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${REMOTE}/HEAD`]);
  if (head.ok && head.stdout.startsWith(`${REMOTE}/`)) return head.stdout.slice(REMOTE.length + 1);
  for (const name of ["main", "master"]) if ((await git(["rev-parse", "--verify", "--quiet", `refs/remotes/${REMOTE}/${name}`])).ok) return name;
  return "main";
}

// The project's own gate before a push: its package.json "check" script, run
// the way `npm run check` runs it, or null when the project has none.
export async function projectCheck(cwd, { run = null, timeout = CHECK_TIMEOUT_MS } = {}) {
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")); } catch { return null; }
  if (typeof manifest?.scripts?.check !== "string" || !manifest.scripts.check.trim()) return null;
  return async () => {
    const result = await (run ?? ((dir) => new Promise((resolve) => {
      const [command, args] = process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", "npm run check"]] : ["npm", ["run", "check"]];
      execFile(command, args, { cwd: dir, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ ok: !error, output: `${stdout ?? ""}\n${stderr ?? ""}`, timedOut: Boolean(error?.killed) });
      });
    })))(cwd);
    if (result.ok) return { ok: true };
    const failing = lines(scrub(result.output)).map((line) => line.trim()).filter((line) => /fail|error|✖|not ok/i.test(line)).slice(-3);
    return { ok: false, detail: result.timedOut ? "npm run check did not finish in 10 minutes" : failing.join(" · ") || "npm run check failed" };
  };
}

// The checkout as it stands, with no network and no writes.
export async function inspect(cwd, { run = runGit } = {}) {
  const git = (args, options) => run(cwd, args, options);
  const top = await git(["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { repo: false, root: path.resolve(cwd), device: os.hostname() };
  const root = path.resolve(top.stdout);
  const remote = (await git(["remote", "get-url", REMOTE])).ok;
  const main = await defaultBranch(git);
  const upstream = `${REMOTE}/${main}`;
  const hasUpstream = remote && (await git(["rev-parse", "--verify", "--quiet", `refs/remotes/${upstream}`])).ok;
  const hasMain = (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${main}`])).ok;
  const [ahead, behind] = hasUpstream && hasMain ? (await git(["rev-list", "--left-right", "--count", `${main}...${upstream}`])).stdout.split(/\s+/).map(Number) : [0, 0];
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout || "HEAD";
  const dirty = lines((await git(["status", "--porcelain"])).stdout).length;
  const stashes = lines((await git(["stash", "list"])).stdout).length;
  const trees = [];
  for (const line of lines((await git(["worktree", "list", "--porcelain"])).stdout)) {
    if (line.startsWith("worktree ")) trees.push({ path: path.resolve(line.slice(9)), branch: null });
    else if (trees.length && line.startsWith("branch refs/heads/")) trees.at(-1).branch = line.slice(18);
  }
  const worktrees = [];
  for (const tree of trees) {
    if (tree.path === root) continue;
    const changed = lines((await run(tree.path, ["status", "--porcelain"])).stdout).length;
    if (changed) worktrees.push({ ...tree, dirty: changed });
  }
  const missing = async (ref) => (hasUpstream ? Number((await git(["rev-list", "--count", `${upstream}..${ref}`])).stdout) || 0 : 0);
  const refs = async (pattern) => lines((await git(["for-each-ref", "--format=%(refname:short)", pattern])).stdout);
  const remoteBranches = [];
  for (const ref of await refs(`refs/remotes/${REMOTE}`)) {
    // gh-pages holds a published site's separate history and never merges.
    if ([REMOTE, `${REMOTE}/HEAD`, upstream, `${REMOTE}/gh-pages`].includes(ref)) continue;
    const commits = await missing(ref);
    if (commits) remoteBranches.push({ name: ref.slice(REMOTE.length + 1), commits });
  }
  const localBranches = [];
  for (const ref of await refs("refs/heads")) {
    if (ref === main) continue;
    const commits = await missing(ref);
    if (!commits) continue;
    // A branch already on GitHub at the same commit is listed once, as GitHub's.
    const published = remoteBranches.find((item) => item.name === ref);
    if (published && !Number((await git(["rev-list", "--count", `${REMOTE}/${ref}..${ref}`])).stdout)) continue;
    localBranches.push({ name: ref, commits });
  }
  return { repo: true, root, device: os.hostname(), remote, main, upstream, hasUpstream, branch, ahead: ahead || 0, behind: behind || 0, dirty, stashes, worktrees, localBranches, remoteBranches };
}

// Everything that is not on GitHub's default branch yet, one item each.
export function pending(state) {
  if (!state?.repo) return [];
  const items = [];
  if (state.branch !== state.main) items.push({ kind: "branch", text: `This checkout is on ${state.branch === "HEAD" ? "a detached HEAD" : `branch ${state.branch}`}, not ${state.main}.` });
  if (state.dirty) items.push({ kind: "uncommitted", count: state.dirty, text: `${plural(state.dirty, "uncommitted file")} in this checkout.` });
  if (state.ahead) items.push({ kind: "unpushed", count: state.ahead, text: `${plural(state.ahead, "commit")} on ${state.main} not pushed yet.` });
  if (state.stashes) items.push({ kind: "stash", count: state.stashes, text: `${plural(state.stashes, "stash", "stashes")} saved on this PC.` });
  for (const tree of state.worktrees) items.push({ kind: "worktree", path: tree.path, count: tree.dirty, text: `Worktree ${path.basename(tree.path)} (${tree.branch || "detached"}): ${plural(tree.dirty, "uncommitted file")}.` });
  for (const item of state.localBranches) items.push({ kind: "local-branch", name: item.name, count: item.commits, text: `Branch ${item.name} on this PC: ${plural(item.commits, "commit")} not on ${state.main}.` });
  for (const item of state.remoteBranches) items.push({ kind: "github-branch", name: item.name, count: item.commits, text: `Branch ${item.name} on GitHub: ${plural(item.commits, "commit")} not on ${state.main}.` });
  return items;
}

// The items only this PC holds: the Friends badge counts them and Studio asks
// about them before it closes. Commits waiting on GitHub are not at risk.
export function atRisk(items) {
  return (Array.isArray(items) ? items : []).filter((item) => LOCAL_ONLY.has(item?.kind));
}

function headline(state, problems, waiting) {
  if (!state.repo) return "This project folder is not a Git repository, so there is nothing to sync.";
  if (!state.remote) return `This project has no ${REMOTE} remote yet. Publish it to GitHub once to link your PCs.`;
  const unchecked = problems.find((item) => item.kind === "fetch-failed");
  if (unchecked) return `Couldn't check GitHub (${unchecked.detail}). Sign in to GitHub again or check this project's GitHub address; nothing was changed.`;
  if (!state.hasUpstream) return `GitHub has no ${state.upstream} yet. Push ${state.main} once to link your PCs.`;
  const conflict = problems.find((item) => item.kind === "rebase-conflict");
  if (conflict) return `Your commits and GitHub's both change ${conflict.files.length ? conflict.files.slice(0, 3).join(", ") : "the same lines"}. Nothing was changed; merge them by hand or ask Mefi.`;
  if (problems.some((item) => item.kind === "check-failed")) return "The project's check failed, so nothing was pushed. Fix it, then sync again.";
  if (problems.some((item) => item.kind === "diverged")) {
    return state.dirty
      ? `${state.main} changed on this PC and on GitHub. Commit or set aside the uncommitted files, then put this PC's commits on top of GitHub's.`
      : `${state.main} changed on this PC and on GitHub. Put this PC's commits on top of GitHub's, then sync.`;
  }
  const offline = problems.some((item) => item.kind === "offline");
  if (state.behind && !state.ahead) return `GitHub has ${plural(state.behind, "commit")} this PC has not pulled yet.`;
  if (waiting.length) return offline ? "GitHub could not be reached. Some work on this PC is not on GitHub yet." : "Some work on this PC is not on GitHub yet.";
  return offline ? "GitHub could not be reached. As of the last check, this PC matched GitHub." : `This PC matches GitHub ${state.main}.`;
}

// fetch: refresh GitHub's branches. pull: fast-forward the default branch.
// push: publish the default branch's local commits once `check` (an async
// () => { ok, detail }) passes. rebase: when both sides moved and nothing is
// uncommitted, put this PC's commits on top of GitHub's first. Nothing throws.
export async function sync(cwd, { fetch = true, pull = true, push = true, rebase = false, check = null, timeout = 30000, run = runGit, now = () => Date.now() } = {}) {
  const actions = [];
  const problems = [];
  const git = (args, options) => run(cwd, args, options);
  let state = await inspect(cwd, { run });
  if (state.repo && state.remote && fetch) {
    const fetched = await git(["fetch", REMOTE, "--prune"], { timeout });
    if (fetched.ok) state = await inspect(cwd, { run });
    else problems.push({ kind: fetchFailure(fetched), detail: firstLine(fetched.stderr) || "git fetch failed" });
  }
  const online = state.hasUpstream && !problems.length;
  const onMain = state.branch === state.main;
  if (online && onMain && state.ahead && state.behind && rebase && !state.dirty) {
    // --no-autostash: a rebase.autoStash setting must never move live edits.
    const rebased = await git(["rebase", "--quiet", "--no-autostash", state.upstream], { timeout: 120000 });
    if (rebased.ok) {
      actions.push({ kind: "rebased", commits: state.ahead });
      state = await inspect(cwd, { run });
    } else {
      const files = lines((await git(["diff", "--name-only", "--diff-filter=U"])).stdout).slice(0, 20);
      await git(["rebase", "--abort"]);
      state = await inspect(cwd, { run });
      problems.push({ kind: "rebase-conflict", files, detail: firstLine(rebased.stderr) });
    }
  }
  if (online && onMain && state.ahead && state.behind) {
    if (!problems.length) problems.push({ kind: "diverged", ahead: state.ahead, behind: state.behind, detail: `${plural(state.ahead, "local commit")} and ${plural(state.behind, "commit")} on GitHub.` });
  } else if (online && onMain && pull && state.behind) {
    // --no-autostash: with merge.autoStash set, Git would stash live edits,
    // fast-forward and pop them back as conflicts. Without it Git refuses a
    // fast-forward that touches an edited file, and the edit stays put.
    const merged = await git(["merge", "--ff-only", "--quiet", "--no-autostash", state.upstream]);
    if (merged.ok) actions.push({ kind: "pulled", commits: state.behind });
    else problems.push({ kind: "pull-refused", detail: firstLine(merged.stderr) });
  } else if (online && onMain && push && state.ahead && !problems.length) {
    const gate = check ? await check().catch((error) => ({ ok: false, detail: String(error?.message ?? error) })) : { ok: true };
    if (!gate?.ok) problems.push({ kind: "check-failed", detail: scrub(gate?.detail || "the check failed") });
    else {
      const pushed = await git(["push", REMOTE, `${state.main}:${state.main}`], { timeout });
      if (pushed.ok) actions.push({ kind: "pushed", commits: state.ahead });
      else problems.push({ kind: "push-refused", detail: lastLine(pushed.stderr) });
    }
  }
  if (actions.some((item) => item.kind !== "rebased")) state = await inspect(cwd, { run });
  const waiting = pending(state);
  const notes = [
    ...actions.map((item) => ({
      pulled: `Pulled ${plural(item.commits, "commit")} from GitHub.`,
      pushed: `Pushed ${plural(item.commits, "commit")} to GitHub.`,
      rebased: `Put ${plural(item.commits, "commit")} from this PC on top of GitHub's.`,
    })[item.kind]),
    ...problems.filter((item) => !["diverged", "rebase-conflict", "fetch-failed"].includes(item.kind)).map((item) => ({
      offline: `Could not reach GitHub: ${item.detail}`,
      "pull-refused": `Could not fast-forward ${state.main} (uncommitted edits in the way?): ${item.detail}`,
      "push-refused": `GitHub refused the push: ${item.detail}`,
      "check-failed": `npm run check: ${item.detail}`,
    })[item.kind]),
  ];
  const summary = headline(state, problems, waiting);
  return {
    ok: state.repo && state.remote && !problems.some((item) => item.kind !== "offline"),
    checkedAt: now(),
    state,
    actions,
    problems,
    pending: waiting,
    risk: atRisk(waiting).length,
    // The card offers the rebase only when it can run: both sides moved and
    // nothing uncommitted would be caught in it.
    canRebase: Boolean(state.repo && onMain && state.ahead && state.behind && !state.dirty && !problems.some((item) => ["offline", "fetch-failed"].includes(item.kind))),
    headline: summary,
    lines: [summary, ...notes, ...waiting.map((item) => item.text)],
  };
}

export function describe(result, { hook = false } = {}) {
  const out = [hook ? "Multi-PC sync (scripts/sync.mjs, at session start):" : "Multi-PC sync:", ...result.lines.map((line, index) => (index ? `  - ${line}` : line))];
  if (result.pending.length) out.push("Before moving to another PC: commit, merge into the default branch and run `npm run sync`.");
  return out.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hook = process.argv.includes("--hook");
  const cwd = process.cwd();
  const check = hook || process.argv.includes("--no-check") ? null : await projectCheck(cwd);
  const result = await sync(cwd, { push: !hook, rebase: !hook && process.argv.includes("--rebase"), check, timeout: hook ? 15000 : 60000 });
  console.log(describe(result, { hook }));
  process.exitCode = hook || result.ok ? 0 : 1;
}
