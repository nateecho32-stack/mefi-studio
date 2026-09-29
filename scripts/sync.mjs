#!/usr/bin/env node
// Mefi's Studio AI+ — keeps one project's checkout in step with its default
// branch on GitHub, so work begun on one PC is waiting on the next. Three
// callers share it:
//   npm run sync                  fetch, fast-forward, run the project's own
//                                 check, push the default branch's local
//                                 commits, then report what GitHub still lacks
//                                 (--rebase puts diverged commits on top of
//                                 GitHub's first; --no-check skips the check;
//                                 --allow-lost-work pushes a merge that left
//                                 another branch's work out on purpose)
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
    // GIT_OPTIONAL_LOCKS=0: a look's `git status` runs inside agents' worktrees
    // too, and must never take index.lock just as an agent adds or commits.
    execFile("git", args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } }, (error, stdout, stderr) => {
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

// Whether GitHub's default branch has moved past this PC's last fetch: one
// small ls-remote and no fetch, so main can ask every minute and look (and
// fetch) only when another PC has pushed.
export async function remoteMoved(cwd, { run = runGit, timeout = 15000 } = {}) {
  const git = (args, options) => run(cwd, args, options);
  const main = await defaultBranch(git);
  const remote = await git(["ls-remote", REMOTE, `refs/heads/${main}`], { timeout });
  if (!remote.ok) return { ok: false, offline: fetchFailure(remote) === "offline" };
  const sha = remote.stdout.split(/\s+/)[0] || "";
  if (!/^[0-9a-f]{40,64}$/.test(sha)) return { ok: true, moved: false, main };
  const local = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/${REMOTE}/${main}`]);
  return { ok: true, moved: !local.ok || local.stdout.trim() !== sha, main };
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

// Files with changes of their own. `git status --porcelain` also lists a file
// whose only difference is one Git would undo, such as line endings under
// core.autocrlf (it looks at size and time); a diff compares content. So a
// non-empty status is recounted from the diffs and untracked files.
export async function changedFiles(cwd, { run = runGit } = {}) {
  const status = lines((await run(cwd, ["status", "--porcelain"])).stdout);
  if (!status.length) return 0;
  const names = new Set();
  for (const args of [["diff", "--name-only", "-z"], ["diff", "--cached", "--name-only", "-z"], ["ls-files", "--others", "--exclude-standard", "--directory", "-z"]]) {
    const result = await run(cwd, args);
    if (!result.ok) return status.length;
    for (const name of result.stdout.split("\0")) if (name) names.add(name);
  }
  return names.size;
}

// The checkout as it stands, with no network and no writes.
// ---- lost work ---------------------------------------------------------------
// On 2026-09-27 a merge of one PC's work with GitHub's (65703a6) kept this PC's
// copy of every file both sides had changed, and the next commit (7ba162c) put
// the rest of the tree back to that copy too. A day of the other side's work,
// twelve commits, left main with no conflict marker and no failing test. The
// shape is checkable: a path that one side of a merge changed, where the tip of
// history holds neither that side's version nor a hand-made mix but exactly the
// OTHER side's copy. A clean merge, a hand-resolved conflict and later edits all
// differ from both sides, so they never match. One rule catches both a merge that
// kept one side and a later commit that reset the tree to a parent.
//
// It only reads history. A finding above LOST_WORK.minLines lines blocks a push
// (--allow-lost-work overrides it) and is listed as pending in the session hook
// and Friends › Your PCs. A deliberate choice is acknowledged in history, where
// every PC sees it: a `Lost-work-ok: <why>` line in the merge's message or in
// any commit after it.
export const LOST_WORK = Object.freeze({
  // Lines of the other side's work a merge may leave out before it counts.
  minLines: 200,
  // How much recent history the read-only report looks through.
  windowCommits: 30,
  // Generated or rotated files whose conflicts are always resolved by
  // regenerating or rotating one side (npm run build-booklet, append-testruns-row).
  exempt: Object.freeze([/^renderer\/booklet\.html$/, /^TESTRUNS\.md$/, /^docs\/archive\/testruns-/]),
  // A binary file has no line count; it weighs about a small text file.
  binaryLines: 20,
});
const ACKNOWLEDGED = /^Lost-work-ok:\s*\S/im;
const SHA = /^[0-9a-f]{40,64}$/;
const nulLines = (text) => String(text ?? "").split("\0").filter(Boolean);
const lostCache = new Map();

// Paths that differ between two commits, or a commit and its merge base.
async function changedPaths(git, from, to) {
  const out = await git(["diff", "--name-only", "--no-renames", "-z", from, to], { timeout: 60000 });
  return out.ok ? new Set(nulLines(out.stdout)) : null;
}

// Lines each path changed from `from` to `to` (text files by numstat; binary by weight).
async function changedLines(git, from, to, binaryLines) {
  const out = await git(["diff", "--numstat", "--no-renames", "-z", from, to], { timeout: 60000 });
  if (!out.ok) return null;
  const lines = new Map();
  for (const entry of nulLines(out.stdout)) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(entry);
    if (match) lines.set(match[3], match[1] === "-" ? binaryLines : Number(match[1]) + Number(match[2]));
  }
  return lines;
}

// `range` is a git revision range of the merges to examine, `tip` the commit
// whose files are compared with each merge's two sides. Returns what was left
// out (findings) and what a Lost-work-ok line already accounts for (acknowledged).
export async function lostWork(cwd, { range, tip = "HEAD", first = false, limit = 0, minLines = LOST_WORK.minLines, exempt = LOST_WORK.exempt, run = runGit } = {}) {
  const git = (args, options) => run(cwd, args, options);
  const findings = [];
  const acknowledged = [];
  if (!range) return { findings, acknowledged };
  const tipSha = (await git(["rev-parse", "--verify", "--quiet", `${tip}^{commit}`])).stdout;
  if (!SHA.test(tipSha)) return { findings, acknowledged };
  const key = `${cwd}|${tipSha}|${range}|${first}|${limit}|${minLines}`;
  if (lostCache.has(key)) return lostCache.get(key);
  const listed = await git(["rev-list", ...(first ? ["--first-parent"] : []), "--parents", ...(limit ? ["-n", String(limit)] : []), range]);
  const merges = listed.ok
    ? listed.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length === 3 && parts.every((part) => SHA.test(part)))
    : [];
  const isExempt = (file) => exempt.some((rule) => (rule instanceof RegExp ? rule.test(file) : rule === file));
  for (const [merge, first1, second] of merges.reverse()) {
    const base = (await git(["merge-base", first1, second])).stdout;
    if (!SHA.test(base)) continue;
    const sides = { [first1]: await changedPaths(git, base, first1), [second]: await changedPaths(git, base, second) };
    const tipVs = { [first1]: await changedPaths(git, tipSha, first1), [second]: await changedPaths(git, tipSha, second) };
    if (!sides[first1] || !sides[second] || !tipVs[first1] || !tipVs[second]) continue;
    // Each side in turn is the one whose work may have been left out.
    for (const [lost, kept] of [[second, first1], [first1, second]]) {
      // Changed by `lost`; not what the tip holds of it; and what the tip
      // holds is exactly `kept`'s copy.
      const gone = [...sides[lost]].filter((file) => tipVs[lost].has(file) && !tipVs[kept].has(file) && !isExempt(file));
      if (!gone.length) continue;
      const weights = await changedLines(git, base, lost, LOST_WORK.binaryLines);
      if (!weights) continue;
      const files = gone.map((file) => ({ path: file, lines: weights.get(file) ?? 0 })).sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
      const lines = files.reduce((sum, file) => sum + file.lines, 0);
      if (lines < minLines) continue;
      const subject = (await git(["log", "-1", "--format=%s", merge])).stdout;
      const finding = { merge, subject: scrub(subject).slice(0, 120), lostFrom: lost, keptFrom: kept, lines, count: files.length, files: files.slice(0, 8) };
      const notes = [(await git(["log", "-1", "--format=%B", merge])).stdout, (await git(["log", "--format=%B", `${merge}..${tipSha}`])).stdout];
      (notes.some((note) => ACKNOWLEDGED.test(note)) ? acknowledged : findings).push(finding);
    }
  }
  const result = { findings, acknowledged };
  lostCache.set(key, result);
  if (lostCache.size > 12) lostCache.delete(lostCache.keys().next().value);
  return result;
}

// One sentence a person can act on: which merge, how much, which files.
export function lostWorkText(item, { blocked = false } = {}) {
  const named = item.files.slice(0, 3).map((file) => file.path);
  const more = item.count - named.length;
  const files = `${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  return `${blocked ? "Nothing was pushed. " : ""}Merge ${item.merge.slice(0, 7)} (${item.subject || "no subject"}) left out ${plural(item.lines, "line")} of ${plural(item.count, "file")} another branch changed (${files}). ` +
    "Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.";
}

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
  const dirty = await changedFiles(cwd, { run });
  const stashes = lines((await git(["stash", "list"])).stdout).length;
  const trees = [];
  for (const line of lines((await git(["worktree", "list", "--porcelain"])).stdout)) {
    if (line.startsWith("worktree ")) trees.push({ path: path.resolve(line.slice(9)), branch: null });
    else if (trees.length && line.startsWith("branch refs/heads/")) trees.at(-1).branch = line.slice(18);
  }
  const worktrees = [];
  for (const tree of trees) {
    if (tree.path === root) continue;
    const changed = await changedFiles(tree.path, { run });
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
    // Every commit already on some GitHub branch (gh-pages included): not this PC's alone.
    if (!Number((await git(["rev-list", "--count", ref, "--not", `--remotes=${REMOTE}`])).stdout)) continue;
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
  const lost = problems.find((item) => item.kind === "lost-work");
  if (lost) return lostWorkText(lost.findings[0], { blocked: true });
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
export async function sync(cwd, { fetch = true, pull = true, push = true, rebase = false, allowLostWork = false, check = null, timeout = 30000, run = runGit, now = () => Date.now() } = {}) {
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
    // Before the project's own check: work another branch made must not be
    // dropped by what is about to be published.
    const lost = allowLostWork ? { findings: [] } : await lostWork(cwd, { range: `${state.upstream}..${state.main}`, tip: state.main, run });
    const gate = lost.findings.length ? null : check ? await check().catch((error) => ({ ok: false, detail: String(error?.message ?? error) })) : { ok: true };
    if (lost.findings.length) problems.push({ kind: "lost-work", findings: lost.findings, detail: lostWorkText(lost.findings[0], { blocked: true }) });
    else if (!gate?.ok) problems.push({ kind: "check-failed", detail: scrub(gate?.detail || "the check failed") });
    else {
      const pushed = await git(["push", REMOTE, `${state.main}:${state.main}`], { timeout });
      if (pushed.ok) actions.push({ kind: "pushed", commits: state.ahead });
      else problems.push({ kind: "push-refused", detail: lastLine(pushed.stderr) });
    }
  }
  if (actions.some((item) => item.kind !== "rebased")) state = await inspect(cwd, { run });
  const waiting = pending(state);
  // Merges in recent history that left another branch's work out are reported
  // whatever the mode (a session hook or the Friends card never blocks on them).
  // One a push was just refused for is already in the headline.
  if (state.repo && state.hasUpstream && !problems.some((item) => item.kind === "fetch-failed")) {
    const refused = new Set(problems.filter((item) => item.kind === "lost-work").flatMap((item) => item.findings.map((finding) => finding.merge)));
    const recent = await lostWork(cwd, { range: state.main, tip: state.main, first: true, limit: LOST_WORK.windowCommits, run });
    for (const item of recent.findings) if (!refused.has(item.merge)) waiting.push({ kind: "lost-work", merge: item.merge, count: item.count, text: lostWorkText(item) });
  }
  const notes = [
    ...actions.map((item) => ({
      pulled: `Pulled ${plural(item.commits, "commit")} from GitHub.`,
      pushed: `Pushed ${plural(item.commits, "commit")} to GitHub.`,
      rebased: `Put ${plural(item.commits, "commit")} from this PC on top of GitHub's.`,
    })[item.kind]),
    // Findings past the first (the headline names it) each get their own line.
    ...problems.filter((item) => item.kind === "lost-work").flatMap((item) => item.findings.slice(1).map((finding) => lostWorkText(finding))),
    ...problems.filter((item) => !["diverged", "rebase-conflict", "fetch-failed", "lost-work"].includes(item.kind)).map((item) => ({
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
  const result = await sync(cwd, { push: !hook, rebase: !hook && process.argv.includes("--rebase"), allowLostWork: !hook && process.argv.includes("--allow-lost-work"), check, timeout: hook ? 15000 : 60000 });
  console.log(describe(result, { hook }));
  process.exitCode = hook || result.ok ? 0 : 1;
}
