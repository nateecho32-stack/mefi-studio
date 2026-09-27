#!/usr/bin/env node
// Mefi's Studio AI+ — keeps one project's checkout in step with its default
// branch on GitHub, so work begun on one PC is waiting on the next. Three
// callers share it:
//   npm run sync                  fetch, fast-forward, push the default
//                                 branch's local commits, then report what
//                                 GitHub still lacks
//   node scripts/sync.mjs --hook  the Claude Code SessionStart hook in
//                                 .claude/settings.json: fetch and
//                                 fast-forward only, never push, never fail
//   main.cjs "Multi-PC sync"      sync:status (fetch and look) and sync:run
//                                 behind Friends › Your PCs
//
// It acts only on the default branch (origin/HEAD, else main or master) while
// that branch is checked out, and only in the two safe directions: a
// fast-forward (Git refuses one that would overwrite uncommitted edits) or a
// push GitHub accepts without force. It never merges diverged histories,
// rebases, stashes, switches branches or discards anything. What needs a
// person or a Claude session comes back as `pending` items, and every
// caller's wording comes from `headline` and `lines` here. Git runs without a
// shell or a terminal prompt, and remote URLs lose any user:password part
// before an error reaches a caller.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REMOTE = "origin";
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const firstLine = (text) => scrub(String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "");
const lastLine = (text) => scrub(String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "");
export const scrub = (text) => String(text ?? "").replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1");

export function runGit(cwd, args, { timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout ?? "").trim(), stderr: scrub(String(stderr ?? "").trim() || error?.message || "") });
    });
  });
}

const lines = (text) => (text ? text.split(/\r?\n/).filter(Boolean) : []);

async function defaultBranch(git) {
  const head = await git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${REMOTE}/HEAD`]);
  if (head.ok && head.stdout.startsWith(`${REMOTE}/`)) return head.stdout.slice(REMOTE.length + 1);
  for (const name of ["main", "master"]) if ((await git(["rev-parse", "--verify", "--quiet", `refs/remotes/${REMOTE}/${name}`])).ok) return name;
  return "main";
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

function headline(state, problems, waiting) {
  if (!state.repo) return "This project folder is not a Git repository, so there is nothing to sync.";
  if (!state.remote) return `This project has no ${REMOTE} remote yet. Publish it to GitHub once to link your PCs.`;
  if (!state.hasUpstream) return `GitHub has no ${state.upstream} yet. Push ${state.main} once to link your PCs.`;
  if (problems.some((item) => item.kind === "diverged")) return `${state.main} changed on this PC and on GitHub. Rebase this PC's commits onto GitHub's, retest, then sync.`;
  const offline = problems.some((item) => item.kind === "offline");
  if (state.behind && !state.ahead) return `GitHub has ${plural(state.behind, "commit")} this PC has not pulled yet.`;
  if (waiting.length) return offline ? "GitHub could not be reached. Some work on this PC is not on GitHub yet." : "Some work on this PC is not on GitHub yet.";
  return offline ? "GitHub could not be reached. As of the last check, this PC matched GitHub." : `This PC matches GitHub ${state.main}.`;
}

// fetch: refresh GitHub's branches. pull: fast-forward the default branch.
// push: publish the default branch's local commits. Nothing throws.
export async function sync(cwd, { fetch = true, pull = true, push = true, timeout = 30000, run = runGit, now = () => Date.now() } = {}) {
  const actions = [];
  const problems = [];
  let state = await inspect(cwd, { run });
  if (state.repo && state.remote && fetch) {
    const fetched = await run(cwd, ["fetch", REMOTE, "--prune"], { timeout });
    if (fetched.ok) state = await inspect(cwd, { run });
    else problems.push({ kind: "offline", detail: firstLine(fetched.stderr) });
  }
  const online = state.hasUpstream && !problems.length;
  if (online && state.branch === state.main && state.ahead && state.behind) {
    problems.push({ kind: "diverged", ahead: state.ahead, behind: state.behind, detail: `${plural(state.ahead, "local commit")} and ${plural(state.behind, "commit")} on GitHub.` });
  } else if (online && state.branch === state.main && pull && state.behind) {
    const merged = await run(cwd, ["merge", "--ff-only", "--quiet", state.upstream]);
    if (merged.ok) actions.push({ kind: "pulled", commits: state.behind });
    else problems.push({ kind: "pull-refused", detail: firstLine(merged.stderr) });
  } else if (online && state.branch === state.main && push && state.ahead) {
    const pushed = await run(cwd, ["push", REMOTE, `${state.main}:${state.main}`], { timeout });
    if (pushed.ok) actions.push({ kind: "pushed", commits: state.ahead });
    else problems.push({ kind: "push-refused", detail: lastLine(pushed.stderr) });
  }
  if (actions.length) state = await inspect(cwd, { run });
  const waiting = pending(state);
  const notes = [
    ...actions.map((item) => (item.kind === "pulled" ? `Pulled ${plural(item.commits, "commit")} from GitHub.` : `Pushed ${plural(item.commits, "commit")} to GitHub.`)),
    ...problems.filter((item) => item.kind !== "diverged").map((item) => ({
      offline: `Could not reach GitHub: ${item.detail}`,
      "pull-refused": `Could not fast-forward ${state.main} (uncommitted edits in the way?): ${item.detail}`,
      "push-refused": `GitHub refused the push: ${item.detail}`,
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
  const result = await sync(process.cwd(), { push: !hook, timeout: hook ? 15000 : 60000 });
  console.log(describe(result, { hook }));
  process.exitCode = hook || result.ok ? 0 : 1;
}
