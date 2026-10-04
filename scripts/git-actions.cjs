// Mefi's Studio AI+ — the GitHub link's host actions: everything that reads or
// changes a project's Git state for the chip in Vibe home and the section bars,
// the launch list's rows, the Save-and-push dialog and the Publish dialog.
// scripts/git-link.cjs decides what each state is called and what a failure
// means; this module does the looking and the doing.
//
//   glance / glanceMany   the local look behind a chip or a launch row: one
//                         `git status` and one `git remote get-url` per project
//                         (a third only to learn the default branch of a
//                         checkout that is not on main or master), at most
//                         three projects at once, 1.5 s each, no network
//   preview / save        the files a save would take (secrets and keys stopped,
//                         big files flagged) and the save itself: only the paths
//                         the owner checked and the preview still lists, one
//                         path-limited commit, never `git add -A`, never
//                         --no-verify, a busy index retried before giving up
//   pushBranch            the current branch to origin with -u, after the
//                         project's own check, never forced
//   publish / link        a new private repository for the folder (public only
//                         when the owner typed owner/name, and safe to run
//                         again after a half-finished try), or a listed
//                         repository whose history the folder shares
//   owners, nameCheck,
//   publishPreview,
//   account, identity     what the Publish dialog and the sign-in row ask
//
// Git and gh run without a shell, from argv arrays, with prompts off and
// Studio's own credentials withheld; every message that leaves is scrubbed of
// logins and tokens. Nothing here forces, rebases, merges, stashes or deletes.
// All IO is injected, like scripts/pc-setup.cjs; the defaults are the real
// ones so a caller that passes nothing still works. Guarded by
// tests/git_actions.test.mjs.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { withholdCredentials } = require("./platform.cjs");
const { maskCredentials } = require("./redaction.cjs");
const { RULES: SHARE_RULES } = require("./share-review.cjs");
const { signedInAccount, filesystemQuery, filesystemOf, githubRemote } = require("./pc-setup.cjs");
const rules = require("./git-link.cjs");

const MIB = 1024 * 1024;
const WARN_BYTES = 50 * MIB;
const REFUSE_BYTES = 100 * MIB;
// Text files up to this size are read for keys; a bigger one is a data file.
const SCAN_BYTES = MIB;
// More changed files than this cannot be reviewed in a dialog, so nothing is saved blind.
const MAX_FILES = 5000;
const SHOWN_FILES = 500;
const GLANCE_CAP_MS = 1500;
const GLANCE_CONCURRENCY = 3;
// Waits before each try at a git write that finds the index busy (a peer session committing).
const LOCK_DELAYS = Object.freeze([0, 250, 1500]);
const LOCKED = /index\.lock|Unable to create '[^']*\.lock'|another git process seems to be running/i;
// Past this many characters the paths go to git on stdin (Windows caps a command line near 32,000).
const ARGV_LIMIT = 8000;
// exFAT and FAT cannot keep separate worktrees (pc-setup.cjs keeps the same list privately).
const WEAK_FILESYSTEMS = new Set(["EXFAT", "FAT", "FAT32"]);
// The variables that point git at a repository other than the folder it runs in (git's own "local repo" set).
const REDIRECTS = new Set(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"]);
// After node's own timeout has killed a command, how long its answer may still be missing
// (a hook or helper it started can keep the pipes open) before it is given up on and killed hard.
const KILL_GRACE_MS = 5000;
// The project's own check may take a while, but never forever: the folder's queue waits behind it.
const CHECK_CAP_MS = 15 * 60 * 1000;
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const REPO =/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
// Files that are not text whatever their size, so being too big to read for keys is nothing to warn about.
const BINARY_NAME = /\.(?:png|jpe?g|gif|webp|bmp|ico|icns|tiff?|psd|mp[34]|m4[av]|wav|ogg|oga|ogv|flac|aac|mov|avi|mkv|webm|zip|gz|tgz|7z|rar|bz2|xz|tar|pdf|woff2?|ttf|otf|eot|exe|dll|so|dylib|bin|dat|wasm|node|pak|asar|blend|fbx|glb|db|sqlite3?|pyc|class|jar)$/i;
// Shapes share-review.cjs has no rule for: a payment key, a package-registry token, a chat bot's token or
// webhook (this owner's projects include bots), a cloud secret key. Each is a stop, like the API keys it lists.
const EXTRA_SCAN_RULES = Object.freeze([
  { id: "api-key", label: "an API key or token", re: /\b(?:[sr]k_live_[0-9A-Za-z]{16,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|pypi-[A-Za-z0-9_-]{50,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/ },
  { id: "bot-token", label: "a chat bot token or webhook", re: /\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b|\b(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks)\/[A-Za-z0-9\/_-]{20,}/ },
  { id: "cloud-secret", label: "a cloud secret key", re: /\baws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9\/+=]{30,}/i },
]);
// share-review's rules for what leaves this PC: keys and logins stop a save,
// an assigned-looking value only warns (source code is full of them).
const SCAN_RULES = [...SHARE_RULES.filter((rule) => ["private-key", "api-key", "jwt", "url-credential", "assigned-secret"].includes(rule.id)), ...EXTRA_SCAN_RULES];

// What Studio says in the moments git-link.cjs has no state row for; `proposed` ones are new copy.
const SAY = Object.freeze({
  gitMissing: "Git is not installed.",
  timeout: "Git took too long to answer. Try again.", // proposed
  notRepo: "This project folder is not a Git repository, so there is nothing to save.", // proposed
  nothing: "Nothing to save.", // proposed
  builders: "Agents are still changing files in this project. Wait for them, or save anyway.", // proposed
  locked: "Another session is committing; try again.",
  identity: "Git does not know who you are on this PC. Sign in to GitHub, or set your name and email in Git.", // proposed
  weakDrive: "This drive cannot keep a Git project reliably. Move the project to an NTFS drive first.",
  noRemote: "This project is only on this PC. Publish it to GitHub once to link your PCs.",
  noCommits: "No commits yet. Save a first commit, then publish.",
  signedOut: "Sign in to GitHub first.",
  notListed: "Choose a repository from your list.",
});

// Why a save is refused whole, by kind (all proposed).
const REFUSALS = Object.freeze({
  nested: "This folder is inside another Git project, so Studio leaves saving to that project.",
  merge: "A merge is in progress in this project. Finish or abort it, then save.",
  rebase: "A rebase is in progress in this project. Finish or abort it, then save.",
  "cherry-pick": "A cherry-pick is in progress in this project. Finish or abort it, then save.",
  revert: "A revert is in progress in this project. Finish or abort it, then save.",
  unmerged: "Some files are in conflict. Resolve them, then save.",
  detached: "This checkout is not on a branch. Start a branch here, then save.",
  "too-many": `More than ${MAX_FILES} files changed. Ignore generated folders in a .gitignore, or save fewer at a time.`,
});

// ---- pure helpers -------------------------------------------------------------
const mb = (bytes) => Math.ceil(bytes / MIB);
const fold = (value) => String(value ?? "").toLowerCase();

async function mapLimit(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// `git status --porcelain=v2 --branch` headers, and how many entries follow.
function parseHeaders(text) {
  const head = { oid: null, branch: null, upstream: null, ab: null, entries: 0 };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line) continue;
    if (!line.startsWith("# ")) { head.entries += 1; continue; }
    const [, key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "branch.oid") head.oid = value;
    else if (key === "branch.head") head.branch = value;
    else if (key === "branch.upstream") head.upstream = value;
    else if (key === "branch.ab") {
      const found = /^\+(\d+) -(\d+)$/.exec(value);
      if (found) head.ab = { ahead: Number(found[1]), behind: Number(found[2]) };
    }
  }
  return head;
}

// The same output with -z: headers, then one entry per changed path. A rename
// carries its old path in the next NUL-terminated token.
function parseStatusZ(text) {
  const tokens = String(text ?? "").split("\0");
  const head = { oid: null, branch: null, upstream: null };
  const entries = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token.startsWith("# ")) {
      const [, key, ...rest] = token.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") head.oid = value;
      else if (key === "branch.head") head.branch = value;
      else if (key === "branch.upstream") head.upstream = value;
      continue;
    }
    let found = null;
    if (token[0] === "1" && (found = /^1 (\S{2}) (?:\S+ ){6}([\s\S]+)$/.exec(token))) entries.push({ kind: "1", xy: found[1], path: found[2] });
    else if (token[0] === "2" && (found = /^2 (\S{2}) (?:\S+ ){7}([\s\S]+)$/.exec(token))) { entries.push({ kind: "2", xy: found[1], path: found[2], from: tokens[index + 1] ?? "" }); index += 1; }
    else if (token[0] === "u" && (found = /^u (\S{2}) (?:\S+ ){8}([\s\S]+)$/.exec(token))) entries.push({ kind: "u", xy: found[1], path: found[2] });
    else if (token[0] === "?") entries.push({ kind: "?", xy: "??", path: token.slice(2) });
  }
  return { head, entries };
}

// A path's state from git's two-letter code (index, then working tree).
function statusOf(xy) {
  if (xy.includes("D")) return "deleted";
  if (xy.includes("A") || xy === "??") return "new";
  return "changed";
}

// git quotes a name with a quote, a backslash or a control character in it.
function unquote(value) {
  const inner = value.slice(1, -1);
  const bytes = [];
  const named = { t: 9, n: 10, r: 13, '"': 34, "\\": 92 };
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    const octal = char === "\\" ? /^[0-7]{3}/.exec(inner.slice(index + 1)) : null;
    if (octal) { bytes.push(parseInt(octal[0], 8)); index += 3; }
    else if (char === "\\" && named[inner[index + 1]] !== undefined) { bytes.push(named[inner[index + 1]]); index += 1; }
    else bytes.push(...Buffer.from(char, "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
}

// The lines a diff adds, by file: `git diff HEAD -U0` read hunk by hunk, so a
// line whose text starts with "++" is never taken for a file header.
function addedLines(diff) {
  const added = new Map();
  let file = null;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of String(diff ?? "").split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (line[0] === "-") oldLeft -= 1;
      else if (line[0] === "+") { newLeft -= 1; if (file) added.get(file).push(line.slice(1)); }
      continue;
    }
    if (line.startsWith("+++ ")) {
      let name = line.slice(4).replace(/\t.*$/, "");
      if (name.startsWith('"')) name = unquote(name);
      file = name === "/dev/null" ? null : name.replace(/^b\//, "");
      if (file && !added.has(file)) added.set(file, []);
    } else if (line.startsWith("@@")) {
      const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
      if (hunk) { oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]); newLeft = hunk[2] === undefined ? 1 : Number(hunk[2]); }
    }
  }
  return new Map([...added].map(([name, lines]) => [name, lines.join("\n")]));
}

// NULs, and what UTF-16 text becomes when it is read as UTF-8: the replacement character and the byte order mark.
const NUL_LIKE = new RegExp(`[${String.fromCharCode(0, 0xfffd, 0xfeff)}]`, "g");

// The link rule tries every word start in a run of scheme characters, so a megabyte of "a.a.a." costs
// minutes (80 KB costs 4 s). A scheme is never long: keep the last 40 characters of any long run.
const capRuns = (text) => text.replace(/[a-z0-9+.-]{80,}/gi, (run) => run.slice(-40));

// The first rule a text trips: a stop (a key, a token, a login in a link) or a warning (a value that looks assigned).
function scanText(text) {
  let maybe = null;
  let capped = null;
  for (const rule of SCAN_RULES) {
    if (!(rule.id === "url-credential" ? rule.re.test(capped ??= capRuns(text)) : rule.re.test(text))) continue;
    if (rule.id === "assigned-secret") maybe = maybe ?? rule;
    else return { stop: rule, maybe: null };
  }
  return { stop: null, maybe };
}

// What a row says about a path: a name Studio never commits, a stop by content, a size.
const stopped = (kind, rule, label, text) => ({ kind, rule, label, text });
function flagName(file) {
  const hit = rules.pathBlocked(file.path);
  if (!hit) return;
  if (hit.kind === "secret" && file.status !== "deleted") file.blocked = stopped("secret", hit.rule, hit.label, `Stopped: ${hit.label} in ${file.path}.`);
  // A generated folder is kept out of what is new; a tracked file in one is the owner's to change.
  else if (hit.kind === "generated" && file.status === "new") file.blocked = stopped("generated", hit.rule, hit.label, `${file.path} is ${hit.label}; Studio leaves it out.`);
}
function flagSize(file) {
  if (!file.bytes || file.status === "deleted" || file.blocked) return;
  if (file.bytes > REFUSE_BYTES) file.blocked = { ...stopped("too-large", null, `${mb(file.bytes)} MB`, `${file.path} is ${mb(file.bytes)} MB; GitHub refuses files over 100 MB.`), mb: mb(file.bytes) };
  else if (file.bytes > WARN_BYTES) file.warn = { kind: "large", label: `${mb(file.bytes)} MB`, text: `${file.path} is ${mb(file.bytes)} MB. GitHub warns about files over 50 MB.`, mb: mb(file.bytes) };
}
function flagText(file, text) {
  if (typeof text !== "string" || !text) return;
  let body = text;
  if (text.includes("\0")) {
    // UTF-16 text (what PowerShell's > writes) reads as letters with a NUL between them: look at the letters.
    // Anything else with NULs is a binary file, which has no lines to read.
    if (((text.match(/\0/g) ?? []).length * 4) < text.length) return;
    body = text.replace(NUL_LIKE, "");
  }
  const found = scanText(body);
  if (found.stop) file.blocked = stopped("secret", found.stop.id, found.stop.label, `Stopped: ${found.stop.label} in ${file.path}.`);
  else if (found.maybe && !file.warn) file.warn = { kind: "maybe-secret", label: found.maybe.label, text: `${found.maybe.label} may be in ${file.path}. Look before saving.` }; // proposed
}

// What a failed save or push says as a chip state's `refusal` (git-link.cjs's describe reads its shape).
function blockedRefusal(file) {
  const { blocked } = file;
  if (blocked.kind === "too-large") return { kind: "too-large", text: blocked.text, fix: "leave-out-ignore", state: "too-large", detail: blocked.text, file: file.path, mb: blocked.mb };
  return { kind: "secret", text: blocked.text, fix: "leave-out", state: "blocked-secret", detail: blocked.text, file: file.path, label: blocked.label };
}

// .gitignore lines as a matcher (name globs, folder-only patterns, "!" to bring one back), for a
// folder that is not a repository yet and has no git to ask.
function ignoreMatcher(text) {
  const parsed = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes("/");
    line = line.replace(/^\//, "");
    const body = line.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    parsed.push({ negate, dirOnly, re: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`) });
  }
  return (relPath, isDir) => {
    let ignored = false;
    for (const rule of parsed) if ((!rule.dirOnly || isDir) && rule.re.test(relPath)) ignored = !rule.negate;
    return ignored;
  };
}
const ignoreLines = (text) => String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));

// Paths for a git command: on the command line while short, else NUL-separated on stdin.
function pathspec(list) {
  const total = list.reduce((sum, item) => sum + item.length + 3, 0);
  if (total <= ARGV_LIMIT) return { args: ["--", ...list], input: null };
  return { args: ["--pathspec-from-file=-", "--pathspec-file-nul"], input: `${list.join("\0")}\0` };
}

// ---- the factory ---------------------------------------------------------------
function createGitActions({
  execFile = require("node:child_process").execFile,
  exists = fs.existsSync,
  readText = (file) => fs.promises.readFile(file, "utf8").catch(() => null),
  // "wx": a file that appeared since the look (or a link left at the name) is never written over.
  writeText = (file, text) => fs.promises.writeFile(file, text, { encoding: "utf8", flag: "wx" }),
  mkdir = (dir, options) => fs.promises.mkdir(dir, options),
  readdir = (dir, options) => fs.promises.readdir(dir, options),
  stat = (file) => fs.promises.stat(file),
  // What a path is itself, without following a link; and where a link leads (the canonical spelling).
  lstat = (file) => fs.promises.lstat(file),
  realpath = (file) => new Promise((resolve, reject) => fs.realpath.native(file, (error, found) => (error ? reject(error) : resolve(found)))),
  realpathSync = (file) => fs.realpathSync.native(file),
  // Folders a project can never be: the user's profile and every folder above it, and a drive root.
  homes = () => [require("node:os").homedir()],
  killGraceMs = KILL_GRACE_MS,
  checkCapMs = CHECK_CAP_MS,
  env = () => process.env,
  now = () => Date.now(),
  platform = process.platform,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  // The repositories link may take: a function (repo) => bool, or the list itself. link's own option wins.
  isListed = null,
  glanceCapMs = GLANCE_CAP_MS,
} = {}) {
  // The folder rules of the PC being asked about, not of whatever runs this module.
  const paths = platform === "win32" ? path.win32 : path.posix;
  const envOf = () => (typeof env === "function" ? env() : env) ?? process.env;
  const inRoot = (root, relPath) => paths.join(root, ...String(relPath).split("/"));

  // A login in a link goes, whole: up to the last "@" of the address, so a password with an "@" in it leaves no
  // tail. Anchored on "://" (a pattern that starts from the scheme re-reads every long word: 80 KB took seconds).
  const clean = (value) => maskCredentials(rules.scrub(String(value ?? "").replace(/(:\/\/)[^\s/]*@/g, "$1")));
  const fail = (kind, error, extra = {}) => ({ ok: false, kind, error: clean(error), ...extra, ...(typeof extra.detail === "string" ? { detail: clean(extra.detail) } : {}) });
  // The line worth showing from a failed command: not git's closing hints, no "fatal:" lead.
  const lastLine = (value) => clean(String(value ?? "").split(/\r?\n/).map((line) => line.replace(/^(?:remote|error|fatal):\s*/i, "").trim()).filter((line) => line && !/^hint:/i.test(line)).at(-1) ?? "");
  // A refusal object with every string scrubbed (classifyPush already scrubs; this adds the credential shapes).
  const cleanObject = (value) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? clean(item) : item]));

  // ---- running git and gh ------------------------------------------------------
  // No shell, prompts off, Studio's own keys withheld. A read never takes the
  // index lock (a look runs inside agents' checkouts too).
  function run(command, args, { cwd, timeout = 20000, reads = false, input = null, maxBuffer = 4 * MIB } = {}) {
    return new Promise((resolve) => {
      // The folder asked about is the repository asked about: a GIT_DIR or index left in the
      // environment (by a hook that started Studio, say) must not point git somewhere else.
      const set = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1", LC_ALL: "C", ...(reads ? { GIT_OPTIONAL_LOCKS: "0" } : {}) };
      // Windows names are not case-sensitive: an inherited "Git_Terminal_Prompt=1" must not sit beside ours.
      const inherited = Object.fromEntries(Object.entries(envOf()).filter(([name]) => !REDIRECTS.has(name.toUpperCase()) && !(name.toUpperCase() in set)));
      const options = withholdCredentials({ cwd, timeout, maxBuffer, windowsHide: true, env: { ...inherited, ...set } });
      let settled = false;
      let watchdog = null;
      let child = null;
      const finish = (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        const overflow = error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        resolve({
          ok: !error, code: error ? (error.code ?? 1) : 0, stdout: String(stdout ?? ""),
          stderr: clean(String(stderr ?? "").trim() || error?.message || ""),
          timedOut: Boolean(error?.killed) && !overflow, missing: error?.code === "ENOENT" || /\bENOENT\b/.test(String(error?.message ?? "")), overflow,
        });
      };
      // Node's timeout ends the command itself, but a hook or credential helper it started can hold the
      // pipes open and the answer never comes, and the folder's queue waits behind it: end the whole tree.
      if (Number.isFinite(timeout) && timeout > 0) {
        watchdog = setTimeout(() => {
          try { child?.kill?.("SIGKILL"); } catch { /* already gone */ }
          if (process.platform === "win32" && Number.isInteger(child?.pid)) {
            try { require("node:child_process").execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {}); } catch { /* best effort */ }
          }
          finish(Object.assign(new Error(`${command} did not stop after ${Math.round(timeout / 1000)} s`), { killed: true, code: "ETIMEDOUT" }), "", "");
        }, timeout + killGraceMs);
        watchdog.unref?.();
      }
      try { child = execFile(command, args, options, finish); } catch (error) { finish(error, "", ""); return; }
      if (input !== null) { child?.stdin?.on?.("error", () => {}); child?.stdin?.end?.(input); }
    });
  }
  const gitRead = (cwd, args, options = {}) => run("git", args, { cwd, reads: true, ...options });
  const gitWrite = (cwd, args, options = {}) => run("git", args, { cwd, ...options });
  // A write that finds the index busy tries again after 250 ms and 1.5 s; the last answer says so.
  async function gitLocked(cwd, args, options = {}) {
    let last = null;
    for (const delay of LOCK_DELAYS) {
      if (delay) await sleep(delay);
      last = await gitWrite(cwd, args, options);
      if (last.ok || !LOCKED.test(last.stderr)) return last;
    }
    return { ...last, locked: true };
  }

  const gitFailure = (result, what) => {
    if (result.missing) return fail("git-missing", SAY.gitMissing);
    if (result.timedOut) return fail("timeout", SAY.timeout);
    const line = lastLine(result.stderr);
    return fail("git", `${what}${line ? `: ${line}` : "."}`);
  };
  const ghFailure = (result, options) => {
    const cls = rules.classifyGh(result.stderr || (result.missing ? "spawn gh ENOENT" : ""), options);
    return fail(cls.kind, cls.text, { fix: cls.fix, detail: cls.detail });
  };
  const pushFailure = (result, branch) => {
    if (result.missing) return fail("git-missing", SAY.gitMissing);
    const cls = rules.classifyPush(result.stderr, { timedOut: result.timedOut, branch });
    return fail(cls.kind, cls.text, { fix: cls.fix, refusal: cleanObject(cls) });
  };

  // One writer at a time per folder within this process (the host's sync queue covers the rest).
  const queues = new Map();
  // The key is the folder's canonical spelling, so a junction, a short path or another case for the
  // same folder shares one queue (a folder that is not there is keyed by its own spelling).
  const queueKey = (root) => {
    const given = paths.resolve(String(root));
    let real = given;
    try { real = String(realpathSync(given) || given); } catch { real = given; }
    return fold(paths.resolve(real));
  };
  function serial(root, task) {
    const key = queueKey(root);
    const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
    const tail = next.then(() => {}, () => {});
    queues.set(key, tail);
    tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
    return next;
  }
  // Every public method answers, never throws.
  const guard = (task) => async (...args) => {
    try { return await task(...args); } catch (error) { return fail("error", `Something went wrong: ${error?.message ?? error}`); } // proposed
  };

  const folderMissing = () => fail("folder-missing", rules.STATES["folder-missing"].sentence);
  // Whether a folder is a drive root, the user's profile, or a folder that holds it: not a project to start Git in.
  const canon = (folder) => {
    const given = paths.resolve(String(folder));
    let real = given;
    try { real = String(realpathSync(given) || given); } catch { real = given; }
    return [...new Set([fold(given), fold(paths.resolve(real))])];
  };
  function tooBroad(root) {
    const own = canon(root);
    if (own.some((item) => paths.dirname(item) === item)) return true;
    let homeList = [];
    try { homeList = [...(homes() ?? []), envOf().USERPROFILE, envOf().HOME]; } catch { homeList = []; }
    for (const home of homeList.filter((item) => typeof item === "string" && item)) {
      for (const inner of canon(home)) {
        for (const outer of own) if (inner === outer || inner.startsWith(outer.endsWith(paths.sep) ? outer : `${outer}${paths.sep}`)) return true;
      }
    }
    return false;
  }
  const TOO_BROAD = "This folder is your whole user folder or a whole drive, which is too much for one project. Choose the project's own folder.";
  const listedNow = async (repo, given) => {
    const source = given ?? isListed;
    if (typeof source === "function") return Boolean(await source(repo));
    if (source instanceof Set) return source.has(repo);
    return Array.isArray(source) && source.includes(repo);
  };

  // ---- the local look ------------------------------------------------------------
  // What `git status` says about a folder, no network: repository or not, the
  // branch (an unborn one by name, not as a detached HEAD), where it stands
  // against its upstream, and origin's address.
  async function readGlance(root, { budgetMs = 0 } = {}) {
    const started = now();
    const left = () => (budgetMs ? Math.max(100, budgetMs - (now() - started)) : 20000);
    const [status, remote] = await Promise.all([
      gitRead(root, ["status", "--porcelain=v2", "--branch"], { timeout: left() }),
      gitRead(root, ["remote", "get-url", "origin"], { timeout: left() }),
    ]);
    if (!status.ok) {
      if (status.missing) return { ok: false, kind: "git-missing" };
      if (/not a git repository/i.test(status.stderr)) return { ok: true, isRepo: false };
      return { ok: false, kind: status.timedOut ? "timeout" : "git", error: lastLine(status.stderr) };
    }
    const head = parseHeaders(status.stdout);
    const unborn = head.oid === "(initial)";
    const detached = head.branch === "(detached)";
    return {
      ok: true, isRepo: true, unborn, detached, hasCommits: !unborn,
      branch: detached || !head.branch ? null : head.branch,
      // A branch whose upstream is gone has no ahead/behind line: it counts as not pushed.
      upstream: head.ab && head.upstream ? head.upstream : null,
      ahead: head.ab?.ahead ?? 0, behind: head.ab?.behind ?? 0, dirty: head.entries,
      url: remote.ok ? remote.stdout.trim() : "", left,
    };
  }

  const NOT_A_REPO = Object.freeze({ isRepo: false, unborn: false, branch: null, detached: false, dirty: 0, ahead: 0, behind: 0, upstream: null, remote: null, main: null, onDefault: true });

  /**
   * The glance shape git-link.cjs's describe reads, or null when nothing could
   * be read (git missing, slow, or refusing the folder): unknown is never a guess.
   */
  async function glance(root, { budgetMs = 0 } = {}) {
    if (typeof root !== "string" || !root) return null;
    if (!(await exists(root))) return { ...NOT_A_REPO, available: false };
    const read = await readGlance(root, { budgetMs });
    if (!read.ok) return null;
    if (!read.isRepo) return { ...NOT_A_REPO, available: true };
    // The default branch: main or master when on one, else what origin/HEAD names (one more spawn), else main.
    let main = read.branch === "main" || read.branch === "master" ? read.branch : null;
    if (!main && read.url) {
      const head = await gitRead(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { timeout: read.left() });
      main = head.ok ? /^origin\/(.+)$/.exec(head.stdout.trim())?.[1] ?? null : null;
    }
    main = main ?? "main";
    const remote = read.url ? githubRemote(read.url) ?? "other" : null;
    return {
      isRepo: true, unborn: read.unborn, branch: read.branch, detached: read.detached, dirty: read.dirty, ahead: read.ahead, behind: read.behind,
      upstream: read.upstream, remote, main, onDefault: read.unborn ? true : !read.detached && read.branch === main, available: true,
    };
  }

  // Several projects for the launch list: [{ id, root }] in, [{ id, glance }] out in the same
  // order, three at a time, each given glanceCapMs (an unfinished one is null). Never throws.
  async function glanceMany(list) {
    const items = (Array.isArray(list) ? list : []).slice(0, 200);
    const capped = (root) => new Promise((resolve) => {
      if (typeof root !== "string" || !root) { resolve(null); return; }
      const timer = setTimeout(() => resolve(null), glanceCapMs);
      timer.unref?.();
      glance(root, { budgetMs: glanceCapMs }).then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
    });
    return mapLimit(items, GLANCE_CONCURRENCY, async (item) => ({ id: item?.id ?? null, glance: await capped(item?.root ?? item?.path) }));
  }

  // ---- who commits -----------------------------------------------------------------
  async function account() {
    const [version, auth] = await Promise.all([
      run("git", ["--version"], { timeout: 10000 }),
      run("gh", ["auth", "status", "--hostname", "github.com"], { timeout: 20000 }),
    ]);
    const ghInstalled = !auth.missing;
    // gh writes the status to stdout (older versions to stderr); only the account name leaves.
    return { ok: true, account: ghInstalled ? signedInAccount(`${auth.stdout}\n${auth.stderr}`) : null, ghInstalled, gitInstalled: !version.missing };
  }

  // The signed-in account's own identity, for a PC where git has none: the login and GitHub's
  // no-reply address for the account (with its number, which needs GitHub to answer).
  async function identity() {
    const who = await account();
    if (!who.ghInstalled) return fail("gh-missing", "GitHub CLI is not installed on this PC.", { fix: "install-gh" });
    if (!who.account) return fail("not-signed-in", SAY.signedOut, { fix: "sign-in" });
    const numbered = await run("gh", ["api", "user", "--jq", '.login + " " + (.id | tostring)'], { timeout: 15000 });
    const found = numbered.ok ? /^([A-Za-z0-9-]{1,39}) (\d{1,12})\s*$/.exec(numbered.stdout.trim()) : null;
    return { ok: true, name: who.account, email: found ? `${found[2]}+${found[1]}@users.noreply.github.com` : `${who.account}@users.noreply.github.com` };
  }

  const cleanIdent = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

  // Git's own name and address if it has them; else the one passed in ({ name, email } from the
  // account); else one made from the signed-in login. `fromAccount` says a save will set it for that commit only.
  async function identityOf(root, supplied) {
    const own = await gitRead(root, ["var", "GIT_AUTHOR_IDENT"], { timeout: 10000 });
    const found = own.ok ? /^(.*) <([^<>]*)> \d+ [+-]\d{4}\s*$/.exec(own.stdout.trim()) : null;
    if (found && found[1] && found[2]) return { ok: true, name: clean(found[1]), email: clean(found[2]), fromAccount: false };
    const name = cleanIdent(supplied?.name);
    const email = cleanIdent(supplied?.email);
    if (name && email) return { ok: true, name, email, fromAccount: true };
    const who = await account();
    if (who.account) return { ok: true, name: who.account, email: `${who.account}@users.noreply.github.com`, fromAccount: true };
    return { ok: false, fromAccount: false };
  }

  // ---- what a save would take -------------------------------------------------------
  async function detectStacks(root) {
    let names = [];
    try { names = (await readdir(root)).map((item) => (typeof item === "string" ? item : item.name)); } catch { names = []; }
    const has = (name) => names.includes(name);
    const stacks = [];
    if (has("package.json")) stacks.push("node");
    if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) stacks.push("python");
    if (has("main.lua") || has("conf.lua")) stacks.push("love");
    return stacks;
  }

  // Sizes and the by-content stops for rows. Changed files are read from the lines their diff adds
  // (`added`, or null when the diff could not be read: then the whole file), new ones whole.
  async function assess(root, files, { added = null, hasHead = true } = {}) {
    for (const file of files) flagName(file);
    await markLinks(root, files);
    await mapLimit(files.filter((file) => file.status !== "deleted" && file.bytes === undefined && file.blocked?.kind !== "outside"), 16, async (file) => {
      const info = await Promise.resolve(stat(inRoot(root, file.path))).catch(() => null);
      file.bytes = info && (typeof info.isFile !== "function" || info.isFile()) ? Number(info.size) || 0 : 0;
    });
    for (const file of files) flagSize(file);
    await mapLimit(files.filter((file) => file.status !== "deleted" && !file.blocked), 16, async (file) => {
      // A changed file is read from the lines its diff adds, at any size (they are in hand). A file that is
      // missing from the diff (a binary one, or a name the diff spelled differently) is read whole.
      const fromDiff = file.status === "changed" && hasHead && added ? added.get(file.path) : undefined;
      if (typeof fromDiff === "string") { flagText(file, fromDiff); return; }
      if ((file.bytes ?? 0) > SCAN_BYTES) {
        // Too big to read for keys. Say so, unless it is plainly a picture, a sound, an archive or a program.
        if (!file.warn && !BINARY_NAME.test(file.path)) file.warn = { kind: "unscanned", label: "not checked for keys", text: `${file.path} is over 1 MB, so Studio did not look inside it for keys. Look before saving.` }; // proposed
        return;
      }
      flagText(file, await readText(inRoot(root, file.path)));
    });
  }

  // A path that goes through a link (a symlink, or a junction on Windows, which git follows like a folder)
  // to somewhere outside the project would put another folder's files in this project's commit.
  async function markLinks(root, files) {
    const live = files.filter((file) => file.status !== "deleted" && !file.blocked && !file.path.endsWith("/"));
    if (!live.length) return;
    const base = await Promise.resolve(realpath(root)).catch(() => null);
    if (!base) return;
    const seen = new Map();
    const leadsOut = (rel) => {
      if (!seen.has(rel)) {
        seen.set(rel, (async () => {
          const at = inRoot(root, rel);
          const info = await Promise.resolve(lstat(at)).catch(() => null);
          if (!info || typeof info.isSymbolicLink !== "function" || !info.isSymbolicLink()) return false;
          const target = await Promise.resolve(realpath(at)).catch(() => null);
          if (!target) return false; // a link to nothing carries no files
          const back = paths.relative(base, target);
          return back === ".." || back.startsWith(`..${paths.sep}`) || paths.isAbsolute(back);
        })());
      }
      return seen.get(rel);
    };
    await mapLimit(live, 16, async (file) => {
      const parts = file.path.split("/").filter(Boolean);
      for (let index = 1; index <= parts.length; index += 1) {
        if (await leadsOut(parts.slice(0, index).join("/"))) {
          file.blocked = stopped("outside", null, "a link to another folder", `${file.path} is reached through a link to somewhere outside this project; Studio leaves it out.`); // proposed
          return;
        }
      }
    });
  }

  // What is different in a folder, ready to show: every changed, new and deleted path
  // (an untracked folder opened up to its files, generated folders left as one row), what
  // each one weighs and whether it may be committed, and why the whole save is refused, if it is.
  async function changes(root) {
    if (!(await exists(root))) return folderMissing();
    const status = await gitRead(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"], { timeout: 30000, maxBuffer: 32 * MIB });
    if (!status.ok) {
      if (/not a git repository/i.test(status.stderr)) return { ok: true, isRepo: false, files: [], refusal: { kind: "not-repo", text: SAY.notRepo }, branch: null, unborn: false, detached: false };
      return gitFailure(status, "Could not read this project's changes");
    }
    const { head, entries } = parseStatusZ(status.stdout);
    const unborn = head.oid === "(initial)";
    const detached = head.branch === "(detached)";
    const branch = detached ? null : head.branch;

    // Where git keeps a merge, rebase or cherry-pick in progress, and whether this is a repository of its own.
    const probe = await gitRead(root, ["rev-parse", "--show-prefix", "--git-path", "MERGE_HEAD", "--git-path", "rebase-merge", "--git-path", "rebase-apply", "--git-path", "CHERRY_PICK_HEAD", "--git-path", "REVERT_HEAD"], { timeout: 10000 });
    let refusalKind = null;
    if (probe.ok) {
      const [prefix, merge, rebaseMerge, rebaseApply, pick, revert] = probe.stdout.split(/\r?\n/);
      const there = async (item) => Boolean(item) && Boolean(await exists(paths.resolve(root, item)));
      if ((prefix ?? "").trim()) refusalKind = "nested";
      else if (await there(merge)) refusalKind = "merge";
      else if (await there(rebaseMerge) || await there(rebaseApply)) refusalKind = "rebase";
      else if (await there(pick)) refusalKind = "cherry-pick";
      else if (await there(revert)) refusalKind = "revert";
    }
    if (!refusalKind && entries.some((entry) => entry.kind === "u")) refusalKind = "unmerged";
    if (!refusalKind && detached) refusalKind = "detached";

    const files = [];
    const folders = [];
    const add = (relPath, state, extra = {}) => files.push({ path: relPath, status: state, untracked: false, ...extra });
    for (const entry of entries) {
      if (entry.kind === "?") {
        if (entry.path.endsWith("/")) folders.push(entry.path);
        else add(entry.path, "new", { untracked: true });
      } else if (entry.kind === "2") {
        add(entry.path, statusOf(entry.xy));
        // A rename leaves the old path behind as a deletion; a copy keeps it.
        if (entry.xy[0] === "R" && entry.from) add(entry.from, "deleted");
      } else add(entry.path, statusOf(entry.xy), entry.kind === "u" ? { unmerged: true } : {});
    }
    // Untracked folders: a generated or secret one stays one row; the rest open up to their files.
    const openable = [];
    for (const folder of folders) {
      const hit = rules.pathBlocked(folder);
      if (hit) add(folder, "new", { untracked: true, bytes: 0, blocked: hit.kind === "secret" ? stopped("secret", hit.rule, hit.label, `Stopped: ${hit.label} in ${folder}.`) : stopped("generated", hit.rule, hit.label, `${folder} is ${hit.label}; Studio leaves it out.`) });
      else openable.push(folder);
    }
    const opened = await mapLimit(openable, 4, (folder) => gitRead(root, ["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", folder], { timeout: 60000, maxBuffer: 32 * MIB }));
    for (const listing of opened) {
      if (!listing.ok) return gitFailure(listing, "Could not list the new files");
      for (const name of listing.stdout.split("\0").filter(Boolean)) {
        // A folder that is a Git project of its own shows up as one entry with a slash.
        if (name.endsWith("/")) add(name, "new", { untracked: true, bytes: 0, blocked: stopped("nested", null, "a Git project inside this one", `${name} is a Git project of its own; Studio leaves it out.`) }); // proposed
        else add(name, "new", { untracked: true });
      }
      if (files.length > MAX_FILES) break;
    }
    let refusal = refusalKind ? { kind: refusalKind, text: REFUSALS[refusalKind] } : null;
    let truncated = false;
    if (files.length > MAX_FILES) { files.length = MAX_FILES; truncated = true; refusal = refusal ?? { kind: "too-many", text: REFUSALS["too-many"] }; }

    // The lines each changed file adds, in one diff (a repository with no commit has nothing to compare).
    let added = null;
    const compared = files.filter((file) => file.status === "changed" && !file.untracked);
    if (compared.length && !unborn) {
      // The prefixes are fixed: a diff.noprefix or diff.mnemonicPrefix setting would rename every file in the diff and no line would be read.
      const diff = await gitRead(root, ["-c", "core.quotepath=false", "diff", "HEAD", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "--diff-filter=d"], { timeout: 60000, maxBuffer: 64 * MIB });
      added = diff.ok ? addedLines(diff.stdout) : null;
    }
    await assess(root, files, { added, hasHead: !unborn });
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { ok: true, isRepo: true, unborn, detached, branch, upstream: head.upstream, files, refusal, truncated };
  }

  const shown = (file) => ({
    path: file.path, status: file.status, bytes: file.bytes ?? 0, include: !file.blocked, untracked: file.untracked,
    ...(file.blocked ? { blocked: file.blocked } : {}), ...(file.warn ? { warn: file.warn } : {}),
  });

  /**
   * What a save would take: { ok, files:[{ path, status: changed|new|deleted, bytes, include,
   * blocked?, warn? }], message, branch, identity, refusal, builders }. `builders` is whether
   * agents are working in the project (the host knows); `identity` an { name, email } to commit
   * as when git has none.
   */
  async function preview(root, { builders = false, identity: supplied = null } = {}) {
    const view = await changes(root);
    if (!view.ok) return view;
    const who = view.isRepo ? await identityOf(root, supplied) : { ok: false, fromAccount: false };
    const rows = view.files.map(shown);
    return {
      ok: true, files: rows, message: rules.saveMessage(rows.filter((row) => row.include).length),
      branch: view.branch, unborn: view.unborn, detached: view.detached, identity: who, refusal: view.refusal, builders: Boolean(builders),
    };
  }

  // ---- saving -------------------------------------------------------------------------
  // The one commit: only paths the preview lists and does not block, made known to git with
  // intent-to-add (a peer's bare commit skips those), then a path-limited commit. The index is
  // shared with agents, so nothing else in it is touched.
  // Take new files back out of the index (intent-to-add only ever put their names there).
  async function unadd(root, names) {
    const undo = pathspec(names);
    await gitWrite(root, ["--literal-pathspecs", "reset", "-q", ...undo.args], { input: undo.input, timeout: 60000 });
  }

  async function commitPaths(root, { paths: wanted, message, builders = false, ignoreBuilders = false, identity: supplied = null, view: given = null }) {
    const list = [...new Set((Array.isArray(wanted) ? wanted : []).filter((item) => typeof item === "string" && item))];
    if (!list.length) return fail("nothing", SAY.nothing);
    const view = given ?? await changes(root);
    if (!view.ok) return view;
    if (!view.isRepo) return fail("not-repo", SAY.notRepo);
    if (view.refusal) return fail(view.refusal.kind, view.refusal.text, { refusal: view.refusal });
    if (builders && !ignoreBuilders) return fail("builders", SAY.builders);
    const byPath = new Map(view.files.map((file) => [file.path, file]));
    const chosen = [];
    for (const item of list) {
      const file = byPath.get(item);
      if (!file) return fail("not-in-preview", `${item} is not one of the changed files.`); // proposed
      if (file.blocked) return fail("blocked", file.blocked.text, { blocked: { path: file.path, ...file.blocked }, refusal: blockedRefusal(file) });
      chosen.push(file);
    }
    const who = await identityOf(root, supplied);
    if (!who.ok) return fail("identity", SAY.identity);
    // A NUL cannot go on a command line, and a message that ends the save half-way leaves files added.
    const text = String(message ?? "").replace(/\0/g, "").trim().slice(0, 5000) || rules.saveMessage(chosen.length);
    const names = chosen.map((file) => file.path);
    const fresh = chosen.filter((file) => file.untracked).map((file) => file.path);
    // The identity only for this commit, and only when git has none.
    const lead = ["--literal-pathspecs", ...(who.fromAccount ? ["-c", `user.name=${who.name}`, "-c", `user.email=${who.email}`] : [])];

    if (fresh.length) {
      const spec = pathspec(fresh);
      // Judged by the exit code: git says "LF will be replaced by CRLF" on stderr and still succeeds.
      const known = await gitLocked(root, ["--literal-pathspecs", "add", "-N", ...spec.args], { input: spec.input, timeout: 60000 });
      if (!known.ok) {
        // Some of them may be known already: leave no half-added files behind.
        await unadd(root, fresh);
        return known.locked ? fail("locked", SAY.locked) : gitFailure(known, "Could not add the new files");
      }
    }
    const spec = pathspec(names);
    // Five minutes: the project's own pre-commit hook runs here, and Studio never skips it.
    const made = await gitLocked(root, [...lead, "commit", "-m", text, ...spec.args], { input: spec.input, timeout: 5 * 60 * 1000 });
    if (!made.ok) {
      // Leave no half-added files behind.
      if (fresh.length) await unadd(root, fresh);
      if (made.locked) return fail("locked", SAY.locked);
      if (/nothing (?:added )?to commit|no changes added to commit/i.test(`${made.stdout}\n${made.stderr}`)) return fail("nothing", SAY.nothing);
      return gitFailure(made, "Could not save");
    }
    const sha = (await gitRead(root, ["rev-parse", "HEAD"], { timeout: 10000 })).stdout.trim();
    return { ok: true, sha, short: sha.slice(0, 7), files: chosen.length, branch: view.branch };
  }

  // ---- pushing ------------------------------------------------------------------------
  // The current branch to origin with -u, after the project's own check (`check` is
  // async () => ({ ok, detail }), sync.mjs's projectCheck). Never forced, never skipping a hook.
  async function pushBranchNow(root, { check = null } = {}) {
    if (!(await exists(root))) return folderMissing();
    const head = await gitRead(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { timeout: 10000 });
    if (!head.ok) {
      if (head.missing || head.timedOut) return gitFailure(head, "Could not read the branch");
      return fail("detached", REFUSALS.detached.replace("save", "push"), { refusal: { kind: "detached", text: REFUSALS.detached.replace("save", "push") } });
    }
    const branch = head.stdout.trim();
    // HEAD can be pointed at "refs/heads/-f" by hand: as a word after `push` that would be a flag.
    if (!branch || branch.startsWith("-")) return fail("branch-name", "This branch has a name Studio will not push. Rename it, then sync again.", { branch }); // proposed
    if (!(await gitRead(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { timeout: 10000 })).ok) return fail("no-commits", SAY.noCommits);
    if (!(await gitRead(root, ["remote", "get-url", "origin"], { timeout: 10000 })).ok) return fail("no-remote", SAY.noRemote);
    const unpushed = await gitRead(root, ["rev-list", "--count", "HEAD", "--not", "--remotes=origin"], { timeout: 30000 });
    const commits = Number(unpushed.stdout.trim()) || 0;
    if (typeof check === "function") {
      // The check may hang; the folder's queue would wait behind it for good.
      let timer = null;
      const gate = await Promise.race([
        Promise.resolve().then(check).catch((error) => ({ ok: false, detail: String(error?.message ?? error) })),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, detail: "the check took too long" }), checkCapMs); timer.unref?.(); }),
      ]);
      clearTimeout(timer);
      if (!gate?.ok) return fail("check-failed", "The project's check failed, so nothing was pushed. Fix it, then sync again.", { detail: clean(gate?.detail || "the check failed"), fix: "ask-mefi-fix" });
    }
    const pushed = await gitWrite(root, ["push", "-u", "origin", branch], { timeout: 10 * 60 * 1000 });
    if (!pushed.ok) return { ...pushFailure(pushed, branch), branch };
    return { ok: true, branch, commits, upstream: `origin/${branch}` };
  }

  // ---- owners, names, publishing ----------------------------------------------------------
  async function owners() {
    const who = await account();
    if (!who.ghInstalled) return fail("gh-missing", "GitHub CLI is not installed on this PC.", { fix: "install-gh" });
    if (!who.account) return fail("not-signed-in", SAY.signedOut, { fix: "sign-in" });
    const listed = await run("gh", ["api", "user/orgs", "--paginate", "--jq", ".[].login"], { timeout: 30000 });
    const orgs = listed.ok ? listed.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => OWNER.test(line)) : [];
    return { ok: true, account: who.account, orgs, ...(listed.ok ? {} : { orgsError: lastLine(listed.stderr) }) };
  }

  // Whether owner/name is a name GitHub takes, the name a folder suggests, and whether the
  // repository already exists (taken; null when GitHub could not be asked).
  async function nameCheck(owner, name) {
    const valid = rules.validRepo(owner, name);
    const sanitized = rules.repoName(name);
    const issue = rules.repoIssue(owner, name);
    if (!valid) return { ok: true, valid, sanitized, taken: false, issue, suggestions: [] };
    const repo = `${owner}/${name}`;
    const seen = await run("gh", ["repo", "view", repo, "--json", "nameWithOwner"], { timeout: 20000 });
    if (seen.ok) return { ok: true, valid, sanitized, taken: true, issue: null, suggestions: rules.nameSuggestions(name) };
    const cls = rules.classifyGh(seen.stderr || (seen.missing ? "spawn gh ENOENT" : ""), { repo });
    if (cls.kind === "not-found") return { ok: true, valid, sanitized, taken: false, issue: null, suggestions: [] };
    return { ok: true, valid, sanitized, taken: null, issue: null, suggestions: [], checked: false, kind: cls.kind, error: clean(cls.text) };
  }

  // Which drive a folder sits on, and whether it can keep a Git project (exFAT and FAT cannot).
  async function driveOf(root) {
    const query = platform === "win32" ? filesystemQuery(root) : null;
    if (!query) return { filesystem: null, weak: false };
    const answer = await run(query.command, query.args, { timeout: query.timeout });
    const filesystem = filesystemOf(answer.stdout);
    return { filesystem, weak: WEAK_FILESYSTEMS.has(String(filesystem ?? "").toUpperCase()) };
  }

  // The facts a publish plan needs, from git alone.
  async function look(root) {
    const read = await readGlance(root);
    if (!read.ok) return read.kind === "git-missing" ? fail("git-missing", SAY.gitMissing) : fail(read.kind, read.kind === "timeout" ? SAY.timeout : `Could not read this project's Git state: ${read.error || "git did not answer"}`);
    const facts = {
      ok: true, isRepo: read.isRepo, unborn: Boolean(read.unborn), hasCommits: Boolean(read.isRepo && !read.unborn), branch: read.branch ?? null,
      detached: Boolean(read.detached), upstream: read.upstream ?? null, url: read.url ?? "", hasRemote: Boolean(read.url), nested: false,
    };
    if (read.isRepo) {
      const prefix = await gitRead(root, ["rev-parse", "--show-prefix"], { timeout: 10000 });
      facts.nested = prefix.ok && prefix.stdout.trim() !== "";
    }
    return facts;
  }

  // Whether origin already points at owner/name (its address as git resolves it, or as configured).
  async function originIs(root, repo) {
    const shown = await gitRead(root, ["remote", "get-url", "origin"], { timeout: 10000 });
    const raw = await gitRead(root, ["config", "--get", "remote.origin.url"], { timeout: 10000 });
    return [shown, raw].some((answer) => answer.ok && fold(githubRemote(answer.stdout.trim())) === fold(repo));
  }

  // The files a first publish would put in the repository, and how they look: what is tracked
  // already, or what would be added once the starting .gitignore is in (git's own listing for a
  // repository, a folder walk for a folder with no git yet).
  async function publishFiles(root, facts, { gitignore, stacks }) {
    const ignorePath = paths.join(root, ".gitignore");
    const existing = await exists(ignorePath) ? await readText(ignorePath) : null;
    const listed = [];
    let truncated = false;
    if (facts.hasCommits) {
      const tree = await gitRead(root, ["ls-tree", "-r", "-l", "-z", "HEAD"], { timeout: 60000, maxBuffer: 64 * MIB });
      for (const entry of tree.ok ? tree.stdout.split("\0").filter(Boolean) : []) {
        const found = /^\d+ (\w+) \w+ +(\d+|-)\t([\s\S]+)$/.exec(entry);
        if (found && found[1] === "blob") listed.push({ path: found[3], status: "tracked", bytes: Number(found[2]) || 0, tracked: true });
      }
    } else if (facts.isRepo) {
      const patterns = existing === null && gitignore ? ignoreLines(rules.gitignoreFor(stacks)).flatMap((line) => ["-x", line]) : [];
      const all = await gitRead(root, ["--literal-pathspecs", "ls-files", "-z", "--cached", "--others", "--exclude-standard", ...patterns], { timeout: 60000, maxBuffer: 64 * MIB });
      for (const name of all.ok ? all.stdout.split("\0").filter((item) => item && !item.endsWith("/")) : []) listed.push({ path: name, status: "new", untracked: true });
    } else {
      const ignored = ignoreMatcher(existing ?? (gitignore ? rules.gitignoreFor(stacks) : ""));
      const queue = [""];
      while (queue.length && listed.length <= MAX_FILES) {
        const rel = queue.shift();
        let items = [];
        try { items = await readdir(rel ? inRoot(root, rel) : root, { withFileTypes: true }); } catch { items = []; }
        for (const item of items) {
          const name = typeof item === "string" ? item : item.name;
          if (name === ".git") continue;
          const childRel = rel ? `${rel}/${name}` : name;
          const info = typeof item === "string" ? await Promise.resolve(stat(inRoot(root, childRel))).catch(() => null) : item;
          if (!info || info.isSymbolicLink?.()) continue;
          if (info.isDirectory()) {
            // Generated folders are never walked (node_modules can hold a hundred thousand files).
            if (rules.pathBlocked(`${childRel}/`)?.kind === "generated" || ignored(childRel, true)) continue;
            queue.push(childRel);
          } else if (!ignored(childRel, false)) listed.push({ path: childRel, status: "new", untracked: true });
        }
      }
    }
    if (listed.length > MAX_FILES) { listed.length = MAX_FILES; truncated = true; }
    const tracked = listed.filter((file) => file.tracked);
    const fresh = listed.filter((file) => !file.tracked);
    // A tracked file is judged by name and size only: its history is already written.
    for (const file of tracked) { flagName(file); flagSize(file); }
    await assess(root, fresh, { added: null, hasHead: false });
    // Generated files never go in; they are not listed.
    const files = listed.filter((file) => file.blocked?.kind !== "generated");
    return { files, truncated };
  }

  /**
   * What the Publish dialog shows before anything is made: the name's validity and whether it
   * is taken, the files that would go in (the stops and warnings inline), whether the folder
   * syncs with OneDrive or sits on a drive that cannot keep Git, and what publishing would
   * still do (rename the branch, save a first commit, sign in).
   */
  async function publishPreview(root, { owner, name, gitignore = true, license = "none" } = {}) {
    if (!(await exists(root))) return folderMissing();
    const repo = `${owner}/${name}`;
    const facts = await look(root);
    if (!facts.ok) return facts;
    const stacks = await detectStacks(root);
    const [who, checked, drive, inventory] = await Promise.all([
      account(), nameCheck(owner, name), driveOf(root), publishFiles(root, facts, { gitignore: gitignore !== false, stacks }),
    ]);
    const rows = inventory.files.map((file) => ({ path: file.path, bytes: file.bytes ?? 0, ...(file.blocked ? { blocked: file.blocked } : {}), ...(file.warn ? { warn: file.warn } : {}) }));
    rows.sort((a, b) => (Boolean(b.blocked) - Boolean(a.blocked)) || (Boolean(b.warn) - Boolean(a.warn)) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    let issue = null;
    if (tooBroad(root)) issue = { kind: "too-broad", text: TOO_BROAD }; // proposed
    else if (facts.nested) issue = { kind: "nested", text: REFUSALS.nested.replace("saving", "publishing") };
    else if (drive.weak) issue = { kind: "weak-drive", text: SAY.weakDrive };
    else if (facts.hasRemote && !(await originIs(root, repo))) issue = { kind: "has-remote", text: "This project already has a GitHub address. Studio never replaces it." };
    else if (facts.isRepo && facts.detached && facts.hasCommits) issue = { kind: "detached", text: "This checkout is not on a branch. Start a branch here, then publish." };
    else if (facts.hasCommits && facts.branch && facts.branch !== "main" && facts.upstream) issue = { kind: "has-upstream", text: `This branch already follows ${clean(facts.upstream)}. Studio does not rename it.` }; // proposed
    return {
      ok: true, repo, valid: checked.valid, sanitized: checked.sanitized, taken: checked.taken, nameIssue: checked.issue ?? null, suggestions: checked.suggestions ?? [],
      files: rows.slice(0, SHOWN_FILES), total: rows.length, truncated: inventory.truncated,
      warn: rows.filter((row) => row.warn).map((row) => ({ path: row.path, ...row.warn })),
      blocked: rows.filter((row) => row.blocked).map((row) => ({ path: row.path, ...row.blocked })),
      oneDrive: rules.oneDrive(root, envOf()), weakDrive: drive.weak, filesystem: drive.filesystem,
      renameBranch: Boolean(facts.isRepo && facts.branch && facts.branch !== "main" && !facts.detached && (facts.unborn || !facts.upstream)),
      needsSignIn: !(who.ghInstalled && who.account), ghInstalled: who.ghInstalled, account: who.account,
      needsFirstCommit: !facts.hasCommits, isRepo: facts.isRepo, branch: facts.branch,
      remote: facts.url ? githubRemote(facts.url) ?? "other" : null, publishIssue: issue,
    };
  }

  // A repository GitHub already has under this name: is it the account's own, empty (or not)
  // and of the visibility asked for? Fails with the reason, or answers { ok, empty }.
  async function existingRepo(root, repo, visibility, login, { needEmpty }) {
    const view = await run("gh", ["repo", "view", repo, "--json", "nameWithOwner,owner,isEmpty,isPrivate"], { cwd: root, timeout: 20000 });
    if (!view.ok) return needEmpty ? ghFailure(view, { repo }) : { ok: true, unknown: true };
    let data = null;
    try { data = JSON.parse(view.stdout); } catch { data = null; }
    if (!data) return needEmpty ? fail("unknown", "GitHub's answer could not be read.") : { ok: true, unknown: true };
    const own = fold(data.owner?.login) === fold(login);
    if (needEmpty && (!own || data.isEmpty !== true)) return fail("name-taken", `${repo} already exists. Link to it, or pick another name.`, { fix: "link" });
    if (Boolean(data.isPrivate) !== (visibility === "private")) return fail("visibility-mismatch", `${repo} is ${data.isPrivate ? "private" : "public"} on GitHub, not ${visibility}. Studio will not push into it.`); // proposed
    return { ok: true, empty: data.isEmpty === true };
  }

  /**
   * Publish the folder as a new repository, step by step (git-link.cjs's publishPlan, in its
   * order, stopping at the first failure): start Git if needed, name the branch main, write
   * .gitignore and LICENSE before anything is added, save a first commit through the same guarded
   * path as a save, make the repository, upload, fetch and set the upstream. Private unless
   * `confirmPublic` is exactly "owner/name". Running it again after a failure picks up from what
   * is already true: a half-made repository that is the account's own, empty and of the same
   * visibility is linked, and an origin already pointing at the target is kept, never replaced.
   * Answers { ok, repo, url, steps:[{ id, label, stage, ok }], left?, error?, kind?, fix? }.
   */
  async function publishNow(root, options = {}) {
    const { owner, name, visibility = "private", description = "", gitignore = true, license = "none", confirmPublic = "", identity: supplied = null, onProgress = null } = options;
    if (!(await exists(root))) return folderMissing();
    if (tooBroad(root)) return fail("too-broad", TOO_BROAD, { steps: [] }); // proposed
    const facts = await look(root);
    if (!facts.ok) return facts;
    const repo = `${owner}/${name}`;
    if (facts.nested) return fail("nested", REFUSALS.nested.replace("saving", "publishing"), { steps: [] });
    // The name goes to gh as a word: one that is not a GitHub name (a leading dash, say) is refused before anything runs.
    if (!rules.validRepo(owner, name)) return fail("name", rules.repoIssue(owner, name) ?? "That is not a GitHub name.", { steps: [] });
    // An origin that already points at the target is a retry; any other is left alone.
    const resuming = facts.hasRemote && rules.validRepo(owner, name) && await originIs(root, repo);
    const plan = rules.publishPlan({
      owner, name, visibility, description, gitignore: gitignore !== false, license, holder: String(owner ?? ""), year: new Date(now()).getFullYear(),
      stacks: await detectStacks(root), confirmPublic, isRepo: facts.isRepo, unborn: facts.unborn, hasCommits: facts.hasCommits,
      branch: facts.branch, detached: facts.detached, hasRemote: facts.hasRemote && !resuming,
    });
    if (!plan.ok) return fail(plan.kind, plan.error, { steps: [] });
    if (facts.hasCommits && facts.branch !== "main" && facts.upstream) return fail("has-upstream", `This branch already follows ${clean(facts.upstream)}. Studio does not rename it.`, { steps: [] }); // proposed
    if ((await driveOf(root)).weak) return fail("weak-drive", SAY.weakDrive, { steps: [] });
    const who = await account();
    if (!who.ghInstalled) return fail("gh-missing", "GitHub CLI is not installed on this PC.", { fix: "install-gh", steps: [] });
    if (!who.account) return fail("not-signed-in", SAY.signedOut, { fix: "sign-in", steps: [] });
    if (resuming) {
      const same = await existingRepo(root, repo, plan.visibility, who.account, { needEmpty: false });
      if (!same.ok) return { ...same, steps: [] };
    }

    const written = [];
    const left = [];
    const done = [];
    const stepsToRun = plan.steps.filter((step) => !(resuming && step.id === "create"));
    // The dialog's listener is not this run's business: a throw there must not stop a publish half-way.
    const tell = (event) => { try { onProgress?.(event); } catch { /* the listener's own problem */ } };
    const oneStep = async (step) => {
      if (step.kind === "git") {
        let argv = step.argv;
        if (step.id === "init" && facts.isRepo) {
          // Naming the branch main never takes the name from a branch that already has it.
          if ((await gitRead(root, ["show-ref", "--verify", "--quiet", "refs/heads/main"], { timeout: 10000 })).ok) return fail("branch-exists", "This project already has a different branch called main. Studio will not replace it. Rename one of them, then publish."); // proposed
          if (argv[0] === "branch" && argv[1] === "-M") argv = ["branch", "-m", "main"];
        }
        const result = await gitWrite(root, argv, { timeout: step.timeoutMs });
        if (result.ok) return { ok: true };
        if (step.id === "push") return pushFailure(result, "main");
        if (step.id === "fetch") return ghFailure(result, { repo });
        return gitFailure(result, `${step.label} did not finish`);
      }
      if (step.kind === "write") {
        const target = paths.join(root, step.path);
        // A link left at the name counts as a file there (writing would go through it to wherever it points).
        const present = async () => Boolean(await exists(target)) || Boolean(await Promise.resolve(lstat(target)).catch(() => null));
        if (step.skipIfExists && await present()) return { ok: true };
        await mkdir(paths.dirname(target), { recursive: true });
        try { await writeText(target, step.text); } catch (error) {
          if (step.skipIfExists && error?.code === "EEXIST") return { ok: true };
          return fail("write", `Could not write ${step.path}: ${error?.message ?? error}`); // proposed
        }
        written.push(step.path);
        return { ok: true };
      }
      if (step.kind === "save") {
        const view = await changes(root);
        if (!view.ok) return view;
        let chosen;
        if (step.paths === "written") {
          // What this run wrote, and any of them a earlier try left new and unsaved (never the owner's own edits).
          const candidates = new Set([...written, ...view.files.filter((file) => file.status === "new" && [".gitignore", "LICENSE"].includes(file.path)).map((file) => file.path)]);
          chosen = view.files.filter((file) => candidates.has(file.path) && !file.blocked);
          if (!chosen.length) return { ok: true };
        } else {
          chosen = view.files.filter((file) => !file.blocked);
          left.push(...view.files.filter((file) => file.blocked && file.blocked.kind !== "generated").map((file) => ({ path: file.path, why: file.blocked.text })));
          if (!chosen.length) return fail("nothing", "There is nothing to save yet. Add a file, then publish."); // proposed
        }
        const saved = await commitPaths(root, { paths: chosen.map((file) => file.path), message: step.message, identity: supplied, view });
        return saved.ok ? { ok: true, sha: saved.sha } : saved;
      }
      // gh repo create: a name that is taken by the account's own empty repository is a retry, not a failure.
      const made = await run("gh", step.argv, { cwd: root, timeout: step.timeoutMs });
      if (made.ok) return { ok: true };
      if (made.timedOut) return fail("timeout", `Making ${repo} took too long. Try again; Studio picks up where it stopped.`); // proposed
      const cls = rules.classifyGh(made.stderr || (made.missing ? "spawn gh ENOENT" : ""), { repo, action: "create" });
      if (cls.kind !== "name-taken") return fail(cls.kind, cls.text, { fix: cls.fix, detail: cls.detail });
      const same = await existingRepo(root, repo, plan.visibility, who.account, { needEmpty: true });
      if (!same.ok) return same.kind === "name-taken" ? fail("name-taken", cls.text, { fix: "link" }) : same;
      if (!(await gitRead(root, ["remote", "get-url", "origin"], { timeout: 10000 })).ok) {
        const added = await gitWrite(root, ["remote", "add", "origin", `https://github.com/${repo}.git`], { timeout: 20000 });
        if (!added.ok) return gitFailure(added, "Could not link this folder to the repository");
      } else if (!(await originIs(root, repo))) {
        // An origin that came from somewhere else since the look is not this repository: the push would go there.
        return fail("has-remote", "This project already has a GitHub address. Studio never replaces it.");
      }
      return { ok: true };
    };
    for (const step of stepsToRun) {
      tell({ id: step.id, label: step.label, stage: step.stage, state: "start" });
      const outcome = await oneStep(step);
      done.push({ id: step.id, label: step.label, stage: step.stage, ok: outcome.ok });
      tell({ id: step.id, label: step.label, stage: step.stage, state: outcome.ok ? "done" : "failed" });
      if (!outcome.ok) return { ...outcome, repo, steps: done, ...(left.length ? { left } : {}) };
    }
    return { ok: true, repo, url: `https://github.com/${repo}`, visibility: plan.visibility, branch: "main", steps: done, ...(left.length ? { left } : {}) };
  }

  // ---- linking to a repository that already exists ------------------------------------------
  /**
   * Link the folder to a repository the account already has: only one from the allow-list
   * (the factory's `isListed`, or link's own), over HTTPS, fetched, and kept only if it shares
   * history with this folder. An unrelated history is refused and the link undone (never
   * rebased); an empty repository is linked and the folder's first push follows.
   */
  async function linkNow(root, { repo, isListed: given = null } = {}) {
    const [linkOwner, linkName] = String(repo ?? "").split("/");
    if (!REPO.test(String(repo ?? "")) || !rules.validRepo(linkOwner, linkName) || !(await listedNow(repo, given))) return fail("not-listed", SAY.notListed);
    if (!(await exists(root))) return folderMissing();
    const read = await readGlance(root);
    if (!read.ok) return read.kind === "git-missing" ? fail("git-missing", SAY.gitMissing) : fail(read.kind, read.error || SAY.timeout);
    if (!read.isRepo) return fail("not-repo", "This project folder is not a Git repository. Start Git in it first."); // proposed
    if (read.unborn) return fail("no-commits", SAY.noCommits);
    // A folder inside another project would give that project the address.
    const prefix = await gitRead(root, ["rev-parse", "--show-prefix"], { timeout: 10000 });
    if (prefix.ok && prefix.stdout.trim() !== "") return fail("nested", REFUSALS.nested.replace("saving", "linking")); // proposed
    const remotes = await gitRead(root, ["remote"], { timeout: 10000 });
    if (remotes.stdout.split(/\r?\n/).map((line) => line.trim()).includes("origin")) return fail("exists", "This project already has a GitHub address. Studio never replaces it.");
    const added = await gitWrite(root, ["remote", "add", "origin", `https://github.com/${repo}.git`], { timeout: 20000 });
    if (!added.ok) return gitFailure(added, "Could not link this folder to the repository");
    const undo = () => gitWrite(root, ["remote", "remove", "origin"], { timeout: 20000 });
    // No tags: they would stay behind, in this project, after an unrelated history is refused and the link undone.
    const fetched = await gitWrite(root, ["fetch", "origin", "--prune", "--no-tags"], { timeout: 120000 });
    if (!fetched.ok) {
      await undo();
      return fetched.timedOut ? fail("timeout", SAY.timeout) : { ...ghFailure(fetched, { repo }), repo };
    }
    const heads = await gitRead(root, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"], { timeout: 20000 });
    const branches = heads.stdout.split(/\r?\n/).map((line) => line.trim().replace(/^origin\//, "")).filter((line) => line && line !== "origin" && line !== "HEAD");
    if (!branches.length) return { ok: true, repo, empty: true, related: false, upstream: false };
    // The default names first; a folder shares history if it shares any commit with any of them.
    const candidates = [...new Set([...["main", "master"].filter((item) => branches.includes(item)), ...branches])].slice(0, 20);
    let related = false;
    for (const branch of candidates) {
      if ((await gitRead(root, ["merge-base", "HEAD", `origin/${branch}`], { timeout: 30000 })).ok) { related = true; break; }
    }
    if (!related) {
      await undo();
      return fail("unrelated", `GitHub's copy of ${repo} is a different project (no shared history).`, { fix: "clone", repo });
    }
    let upstream = false;
    if (read.branch && !read.branch.startsWith("-") && branches.includes(read.branch)) upstream = (await gitWrite(root, ["branch", `--set-upstream-to=origin/${read.branch}`, read.branch], { timeout: 20000 })).ok;
    return { ok: true, repo, empty: false, related: true, upstream };
  }

  return {
    glance: async (root, options) => { try { return await glance(root, options); } catch { return null; } },
    glanceMany: async (list) => { try { return await glanceMany(list); } catch { return []; } },
    preview: guard(preview),
    save: (root, options = {}) => serial(root, guard(() => commitPaths(root, {
      paths: options.paths, message: options.message, builders: options.builders, ignoreBuilders: options.ignoreBuilders, identity: options.identity,
    }))),
    pushBranch: (root, options = {}) => serial(root, guard(() => pushBranchNow(root, options))),
    publish: (root, options = {}) => serial(root, guard(() => publishNow(root, options))),
    link: (root, options = {}) => serial(root, guard(() => linkNow(root, options))),
    owners: guard(owners), nameCheck: guard(nameCheck), publishPreview: guard(publishPreview), account: guard(account), identity: guard(identity),
  };
}

// `parts` are the readers and matchers the tests hold to account on their own.
module.exports = {
  createGitActions, GLANCE_CAP_MS, GLANCE_CONCURRENCY, MAX_FILES, WARN_BYTES, REFUSE_BYTES, LOCK_DELAYS,
  parts: { parseHeaders, parseStatusZ, addedLines, unquote, ignoreMatcher, pathspec, scanText },
};
