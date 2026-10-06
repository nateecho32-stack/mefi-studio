"use strict";

// My PCs' handoffs (docs/my-pcs.md "Handoffs"): work a PC parked for the
// others, as a branch on the project's own GitHub repository. git is passed
// in as `git(args, { cwd, env, input }) -> { code, stdout, stderr }`, so
// tests use a real repository and nothing here touches the network itself.
// - park: a commit made from a temporary index (HEAD plus the given files as
//   they are on disk), pushed to mefi/handoff/<pc>-<date>-<time>. The PC's own
//   working tree, index and HEAD are never touched.
// - list / read: `git ls-remote` for the branches, the commit message's
//   `Mefi-Handoff:` line for what each holds.
// - pickUp: delete the branch with a lease on its exact commit (two PCs
//   cannot both take it), then apply its changes to the working tree only. If
//   they do not apply, the branch is pushed back as it was.
// Guarded by tests/pc_handoff.test.mjs.
const path = require("node:path");

const PREFIX = "mefi/handoff/";
const TRAILER = "Mefi-Handoff:";
const LIMITS = Object.freeze({ tasks: 4, titleChars: 90, promptChars: 4000, noteChars: 600, files: 400, branches: 50 });
const BRANCH = /^mefi\/handoff\/[a-z0-9][a-z0-9-]{0,80}$/;
const SHA = /^[0-9a-f]{40}$/;
const WHY = Object.freeze(["battery", "you"]);

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const line = (value, max) => String(value ?? "").replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const slug = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "pc";
const pad = (value) => String(value).padStart(2, "0");

// mefi/handoff/<pc>-<yyyymmdd>-<hhmm>, made unique against `taken`.
function branchName(pcName, now, taken = []) {
  const at = new Date(now);
  const base = `${PREFIX}${slug(pcName)}-${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n += 1) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${now % 100000}`;
}

// What the branch holds, as the trailer's JSON. Bounded and cleaned.
function cleanMeta(raw) {
  if (!object(raw) || raw.v !== 1) return null;
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).filter(object).slice(0, LIMITS.tasks).map((task) => ({
    id: line(task.id, 80), title: line(task.title, LIMITS.titleChars), prompt: String(task.prompt ?? "").slice(0, LIMITS.promptChars),
    note: line(task.note, LIMITS.noteChars),
  })).filter((task) => task.title);
  if (!tasks.length) return null;
  return {
    v: 1, pc: line(raw.pc, 64), pcName: line(raw.pcName, 40) || "PC", why: WHY.includes(raw.why) ? raw.why : "you",
    level: Number.isFinite(raw.level) ? Math.round(raw.level) : null, at: Number.isFinite(raw.at) ? raw.at : 0,
    base: SHA.test(String(raw.base ?? "")) ? raw.base : null, project: line(raw.project, 60), tasks,
    files: (Array.isArray(raw.files) ? raw.files : []).filter((file) => typeof file === "string").slice(0, LIMITS.files),
  };
}

// The commit message: words first, then one line of JSON Studio reads back.
function message(meta) {
  const clean = cleanMeta(meta);
  if (!clean) throw new Error("A handoff needs at least one task.");
  const when = new Date(clean.at).toISOString().slice(0, 16).replace("T", " ");
  const head = clean.tasks.length === 1 ? `Handoff: ${clean.tasks[0].title}` : `Handoff: ${clean.tasks.length} tasks from ${clean.pcName}`;
  const why = clean.why === "battery" ? `at ${clean.level ?? "?"}% battery` : "by the owner";
  const body = clean.tasks.map((task) => `- ${task.title}${task.note ? `\n  ${task.note}` : ""}`).join("\n");
  return `${head.slice(0, 100)}\n\nParked by ${clean.pcName} ${why}, ${when} UTC, so another PC can carry on.\n\n${body}\n\n${TRAILER} ${JSON.stringify(clean)}\n`;
}

function parseMessage(textValue) {
  const found = String(textValue ?? "").split(/\r?\n/).reverse().find((row) => row.startsWith(TRAILER));
  if (!found) return null;
  try { return cleanMeta(JSON.parse(found.slice(TRAILER.length).trim())); } catch { return null; }
}

const fail = (result, fallback) => line(result?.stderr || result?.stdout || fallback, 240) || fallback;

// Park `files` (paths relative to `root`) as one handoff. `indexFile` is a
// scratch path for the temporary index. -> { ok, branch, sha } or { ok: false, error, empty? }.
async function park({ git, root, files, meta, branch, indexFile, remote = "origin" }) {
  if (!BRANCH.test(String(branch ?? ""))) return { ok: false, error: "Not a handoff branch name." };
  const list = [...new Set((Array.isArray(files) ? files : []).map((file) => String(file).replace(/\\/g, "/")).filter((file) => file && !file.startsWith("/") && !/^[A-Za-z]:/.test(file) && !file.split("/").includes("..")))].slice(0, LIMITS.files);
  if (!list.length) return { ok: false, empty: true, error: "Nothing changed to hand off." };
  const head = await git(["rev-parse", "--verify", "HEAD"], { cwd: root });
  const base = String(head.stdout ?? "").trim();
  if (head.code !== 0 || !SHA.test(base)) return { ok: false, error: "This project has no commit to build a handoff on." };
  const env = { GIT_INDEX_FILE: indexFile };
  const read = await git(["read-tree", base], { cwd: root, env });
  if (read.code !== 0) return { ok: false, error: fail(read, "git could not start the handoff.") };
  // --add --remove reads each file from disk: changed, new and deleted alike.
  const add = await git(["update-index", "--add", "--remove", "--", ...list], { cwd: root, env });
  if (add.code !== 0) return { ok: false, error: fail(add, "git could not read the changed files.") };
  const tree = String((await git(["write-tree"], { cwd: root, env })).stdout ?? "").trim();
  const baseTree = String((await git(["rev-parse", `${base}^{tree}`], { cwd: root })).stdout ?? "").trim();
  if (!SHA.test(tree)) return { ok: false, error: "git could not write the handoff." };
  if (tree === baseTree) return { ok: false, empty: true, error: "Nothing changed to hand off." };
  const commit = await git(["commit-tree", tree, "-p", base, "-F", "-"], { cwd: root, input: message({ ...meta, base, files: list }) });
  const sha = String(commit.stdout ?? "").trim();
  if (commit.code !== 0 || !SHA.test(sha)) return { ok: false, error: fail(commit, "git could not commit the handoff.") };
  const push = await git(["push", remote, `${sha}:refs/heads/${branch}`], { cwd: root });
  if (push.code !== 0) return { ok: false, sha, error: fail(push, "The handoff could not be pushed to GitHub.") };
  return { ok: true, branch, sha, files: list.length };
}

// The handoff branches on GitHub. -> { ok, branches: [{ branch, sha }] } or { ok: false, error }.
async function list({ git, root, remote = "origin" }) {
  const result = await git(["ls-remote", remote, `refs/heads/${PREFIX}*`], { cwd: root });
  if (result.code !== 0) return { ok: false, error: fail(result, "GitHub could not be asked for handoffs.") };
  const branches = [];
  for (const row of String(result.stdout ?? "").split(/\r?\n/)) {
    const [sha, ref] = row.trim().split(/\s+/);
    const branch = String(ref ?? "").replace(/^refs\/heads\//, "");
    if (SHA.test(String(sha)) && BRANCH.test(branch)) branches.push({ branch, sha });
    if (branches.length >= LIMITS.branches) break;
  }
  return { ok: true, branches };
}

// What one handoff holds (fetches its commit). -> { ok, meta } or { ok: false, error }.
async function read({ git, root, branch, sha, remote = "origin" }) {
  if (!BRANCH.test(String(branch)) || !SHA.test(String(sha))) return { ok: false, error: "Not a handoff." };
  const have = await git(["cat-file", "-e", `${sha}^{commit}`], { cwd: root });
  if (have.code !== 0) {
    const fetched = await git(["fetch", "--no-tags", remote, `refs/heads/${branch}`], { cwd: root });
    if (fetched.code !== 0) return { ok: false, error: fail(fetched, "The handoff could not be fetched.") };
  }
  const shown = await git(["log", "-1", "--format=%B", sha], { cwd: root });
  if (shown.code !== 0) return { ok: false, error: "The handoff's commit could not be read." };
  const meta = parseMessage(shown.stdout);
  return meta ? { ok: true, meta } : { ok: false, error: "This branch is not a Studio handoff." };
}

const diffArgs = (meta, sha) => ["diff", "--binary", "--full-index", meta.base ?? `${sha}^`, sha];

// Whether the handoff's changes apply to this working tree as it is now.
async function applies({ git, root, meta, sha }) {
  const diff = await git(diffArgs(meta, sha), { cwd: root });
  if (diff.code !== 0) return { ok: false, error: "The handoff's changes could not be read." };
  if (!String(diff.stdout ?? "").trim()) return { ok: true, empty: true, patch: "" };
  const check = await git(["apply", "--check", "--whitespace=nowarn", "-"], { cwd: root, input: diff.stdout });
  return check.code === 0 ? { ok: true, patch: diff.stdout } : { ok: false, error: `Its changes do not apply here: ${fail(check, "they clash with this PC's files")}` };
}

// Take one handoff: claim it on GitHub, then apply it to the working tree.
// -> { ok, meta } or { ok: false, error, restored? }.
async function pickUp({ git, root, branch, sha, remote = "origin" }) {
  const got = await read({ git, root, branch, sha, remote });
  if (!got.ok) return got;
  const check = await applies({ git, root, meta: got.meta, sha });
  if (!check.ok) return check;
  const claim = await git(["push", `--force-with-lease=refs/heads/${branch}:${sha}`, remote, `:refs/heads/${branch}`], { cwd: root });
  if (claim.code !== 0) return { ok: false, error: "Another PC took this handoff first." };
  if (check.empty) return { ok: true, meta: got.meta };
  const applied = await git(["apply", "--whitespace=nowarn", "-"], { cwd: root, input: check.patch });
  if (applied.code === 0) return { ok: true, meta: got.meta };
  const back = await git(["push", remote, `${sha}:refs/heads/${branch}`], { cwd: root });
  return { ok: false, restored: back.code === 0, error: `Its changes did not apply here${back.code === 0 ? "; the handoff is back on GitHub" : ""}.` };
}

// Drop one handoff (the owner confirmed). Only the exact commit is deleted.
async function drop({ git, root, branch, sha, remote = "origin" }) {
  if (!BRANCH.test(String(branch)) || !SHA.test(String(sha))) return { ok: false, error: "Not a handoff." };
  const result = await git(["push", `--force-with-lease=refs/heads/${branch}:${sha}`, remote, `:refs/heads/${branch}`], { cwd: root });
  return result.code === 0 ? { ok: true } : { ok: false, error: "It changed or is already gone." };
}

// A scratch index path beside git's own files.
const indexPath = (gitDir, now) => path.join(gitDir, `mefi-handoff-${now}.idx`);

module.exports = { PREFIX, TRAILER, LIMITS, BRANCH, branchName, cleanMeta, message, parseMessage, park, list, read, applies, pickUp, drop, indexPath };
