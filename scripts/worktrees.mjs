#!/usr/bin/env node
// Mefi's Studio AI+ - one table of every git worktree of a project: where it is,
// which branch it holds, how far that branch is from the default branch,
// whether anything in it is uncommitted or unpushed, and what to do about it.
//
//   npm run worktrees            a table for the project in the current folder
//   npm run worktrees -- --json  the same rows as JSON (Studio, hooks, other tools)
//
// Worktrees pile up because every session, task run and side investigation makes
// one, and git itself only lists paths. What matters is which of them hold work
// that exists nowhere else, which are on GitHub but not merged, and which are
// finished and safe to remove. This module answers that and nothing more: it
// never merges, removes, prunes, fetches or writes. It reads whatever the last
// fetch left, so run `npm run sync` first for a fresh comparison with GitHub.
//
// It shares `runGit` (bounded, no prompts, no index lock), `changedFiles` (real
// content changes, not line-ending noise) and `scrub` (no credentials in any
// text) with scripts/sync.mjs. Git runs without a shell.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changedFiles, defaultBranch, runGit, scrub } from "./sync.mjs";

const REMOTE = "origin";
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const slash = (value) => String(value).replace(/\\/g, "/");

// `git worktree list --porcelain`: blocks of "key value" lines, one blank line
// between worktrees. A flag key (bare, detached, locked, prunable) has no value,
// or an explanation after it.
export function parseWorktrees(text) {
  const entries = [];
  let entry = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (!raw) { entry = null; continue; }
    const space = raw.indexOf(" ");
    const key = space === -1 ? raw : raw.slice(0, space);
    const value = space === -1 ? "" : raw.slice(space + 1);
    if (key === "worktree") { entry = { path: path.resolve(value), head: "", branch: null, detached: false, bare: false, locked: false, prunable: false }; entries.push(entry); continue; }
    if (!entry) continue;
    if (key === "HEAD") entry.head = value;
    else if (key === "branch") entry.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") entry.detached = true;
    else if (key === "bare") entry.bare = true;
    else if (key === "locked") entry.locked = value || true;
    else if (key === "prunable") entry.prunable = value || true;
  }
  return entries;
}

// primary: the checkout the repository lives in. run: a Studio task run
// (executor-worktrees.cjs makes <project>/.mefi/worktrees/<runId> on
// mefi/<runId>). dev: any other worktree on a branch. detached: on a bare commit.
export function kindOf(entry, index) {
  if (index === 0) return "primary";
  if (String(entry.branch ?? "").startsWith("mefi/") || slash(entry.path).includes("/.mefi/worktrees/")) return "run";
  return entry.detached || !entry.branch ? "detached" : "dev";
}

// One verdict per worktree, worst first. `at risk` means the work exists in this
// folder only: a save or a push away from safe.
export function classify(row) {
  if (row.kind === "primary") return { state: "primary", action: row.dirty ? `${plural(row.dirty, "uncommitted file")} in the main checkout.` : "" };
  if (row.missing) return { state: "missing", action: "The folder is gone. Run `git worktree prune` to forget it." };
  if (row.dirty) return { state: "dirty", action: `${plural(row.dirty, "uncommitted file")}: commit, stash or discard them before anything else.` };
  if (row.ahead && row.pushed === false) {
    return row.kind === "detached"
      ? { state: "unpushed", action: `Detached HEAD with ${plural(row.ahead, "commit")} on no branch: put them on a branch and push it.` }
      : { state: "unpushed", action: `${plural(row.ahead, "commit")} only on this PC: push them (git push ${REMOTE} HEAD:refs/heads/wip/${row.branch ? row.branch.replace(/^wip\//, "") : row.name}) or land them.` };
  }
  if (row.ahead) return { state: "on-github", action: `${plural(row.ahead, "commit")} on GitHub, not merged into ${row.upstreamName}: land it or leave it parked.` };
  return { state: "merged", action: `Merged into ${row.upstreamName} and clean: safe to remove (git worktree remove ${row.path}).` };
}

const ORDER = { primary: 0, dirty: 1, unpushed: 2, "on-github": 3, missing: 4, merged: 5 };

async function inspectOne(entry, index, ctx) {
  const { git, main, upstream, hasUpstream, run } = ctx;
  const row = {
    path: entry.path,
    name: path.basename(entry.path),
    kind: kindOf(entry, index),
    branch: entry.branch,
    detached: entry.detached || !entry.branch,
    head: entry.head.slice(0, 7),
    locked: Boolean(entry.locked),
    missing: Boolean(entry.prunable) || !existsSync(entry.path),
    dirty: 0,
    ahead: 0,
    behind: 0,
    pushed: null,
    upstreamName: hasUpstream ? upstream : main,
    last: null,
  };
  if (entry.bare) return { ...row, ...classify({ ...row, kind: "primary" }) };
  if (!row.missing) row.dirty = await changedFiles(entry.path, { run });
  const ref = entry.branch ?? entry.head;
  if (!row.missing && ref) {
    const against = hasUpstream ? upstream : main;
    const count = async (range) => Number((await git(["rev-list", "--count", range])).stdout) || 0;
    row.ahead = await count(`${against}..${ref}`);
    row.behind = await count(`${ref}..${against}`);
    if (entry.branch) {
      const onGitHub = (await git(["rev-parse", "--verify", "--quiet", `refs/remotes/${REMOTE}/${entry.branch}`])).ok;
      row.pushed = onGitHub ? (await count(`${REMOTE}/${entry.branch}..${entry.branch}`)) === 0 : false;
    } else {
      // On no branch: safe only if some branch on GitHub already holds the commit.
      row.pushed = (await git(["branch", "-r", "--contains", ref])).stdout.trim() !== "";
    }
    const last = (await git(["log", "-1", "--format=%h%x09%cs%x09%s", ref])).stdout.split("\t");
    if (last.length >= 3) row.last = { sha: last[0], date: last[1], subject: scrub(last.slice(2).join("\t")).slice(0, 100) };
  }
  return { ...row, ...classify(row) };
}

// Every worktree of the repository `cwd` belongs to, worst first.
export async function listWorktrees(cwd, { run = runGit } = {}) {
  const git = (args, options) => run(cwd, args, options);
  const top = await git(["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { repo: false, root: path.resolve(cwd) };
  const entries = parseWorktrees((await git(["worktree", "list", "--porcelain"])).stdout);
  const main = await defaultBranch(git);
  const upstream = `${REMOTE}/${main}`;
  const hasUpstream = (await git(["rev-parse", "--verify", "--quiet", `refs/remotes/${upstream}`])).ok;
  const ctx = { git, main, upstream, hasUpstream, run: (dir, args, options) => run(dir, args, options) };
  const rows = [];
  // A few at a time: each worktree costs a status and a few rev-lists.
  for (let start = 0; start < entries.length; start += 4) {
    rows.push(...(await Promise.all(entries.slice(start, start + 4).map((entry, offset) => inspectOne(entry, start + offset, ctx)))));
  }
  rows.sort((a, b) => (ORDER[a.state] - ORDER[b.state]) || a.name.localeCompare(b.name));
  const count = (state) => rows.filter((row) => row.state === state).length;
  const summary = {
    total: rows.length,
    atRisk: count("dirty") + count("unpushed"),
    toLand: count("on-github"),
    safeToRemove: count("merged"),
    missing: count("missing"),
  };
  return { repo: true, root: path.resolve(slash(top.stdout)), main, upstream, hasUpstream, rows, summary, headline: headline(summary, hasUpstream, upstream) };
}

function headline(summary, hasUpstream, upstream) {
  if (summary.total === 1 && !summary.atRisk) return "One checkout, no other worktrees.";
  const parts = [];
  if (summary.atRisk) parts.push(`${summary.atRisk} ${summary.atRisk === 1 ? "holds" : "hold"} work that exists only on this PC`);
  if (summary.toLand) parts.push(`${summary.toLand} ${summary.toLand === 1 ? "is" : "are"} on GitHub but not merged`);
  if (summary.safeToRemove) parts.push(`${summary.safeToRemove} ${summary.safeToRemove === 1 ? "is" : "are"} merged and safe to remove`);
  if (summary.missing) parts.push(`${summary.missing} ${summary.missing === 1 ? "folder is" : "folders are"} gone`);
  const base = `${plural(summary.total, "worktree")}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
  return hasUpstream ? base : `${base} (There is no ${upstream} to compare with, so the local default branch was used.)`;
}

const cut = (text, width) => (text.length > width ? `${text.slice(0, width - 1)}…` : text);

// The table a person reads, as lines.
export function describeWorktrees(result) {
  if (!result.repo) return ["This folder is not a Git repository."];
  const out = [result.headline, ""];
  const table = [["WORKTREE", "BRANCH", "VS " + result.main.toUpperCase(), "DIRTY", "PUSHED", "STATE", "LAST COMMIT"]];
  for (const row of result.rows) {
    table.push([
      row.name + (row.locked ? " (locked)" : ""),
      row.detached ? `(detached ${row.head})` : row.branch,
      row.missing ? "-" : `+${row.ahead}/-${row.behind}`,
      row.missing ? "-" : String(row.dirty),
      row.pushed === null ? "-" : row.pushed ? "yes" : "no",
      row.state,
      row.last ? `${row.last.date} ${row.last.subject}` : "",
    ]);
  }
  const widths = table[0].map((_, column) => Math.min(column === 6 ? 60 : 34, Math.max(...table.map((cells) => cells[column].length))));
  for (const cells of table) out.push(cells.map((cell, column) => cut(cell, widths[column]).padEnd(widths[column])).join("  ").trimEnd());
  const todo = result.rows.filter((row) => row.action);
  if (todo.length) {
    out.push("", "What to do:");
    for (const row of todo) out.push(`  ${row.name}: ${row.action}`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const target = args.find((arg) => !arg.startsWith("--")) ?? process.cwd();
  const result = await listWorktrees(path.resolve(target));
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : describeWorktrees(result).join("\n"));
  process.exitCode = result.repo ? 0 : 2;
}
