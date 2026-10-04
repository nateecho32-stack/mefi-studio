// The Git chip's actions, JavaScript (scripts/git-actions.cjs, with the
// git-link.cjs, pc-setup.cjs, redaction.cjs and share-review.cjs parts it
// reads) against Rust (crates/mefi-core git, docs/rust-migration.md stage 2).
//
// The pure helpers run on the same inputs in both. The actions run on real
// folders: two identical boxes are built (fixed identity and dates, so every
// commit id matches), the JavaScript acts on one and Rust on the other, and
// the answers are compared with each box's folder masked. GitHub is a local
// bare repository reached through a url.insteadOf rule, and gh is a fake: a
// hard link of node.exe named gh.exe that a preloaded script answers from a
// table, so nothing here reaches the network or a real account.
//
// Needs the mefi-core binary (npm run host:core); skips without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { coreBinary } from "../scripts/rust-host.mjs";

const require = createRequire(import.meta.url);
const { createGitActions, parts } = require("../scripts/git-actions.cjs");
const rules = require("../scripts/git-link.cjs");
const { signedInAccount, filesystemQuery, filesystemOf, githubRemote } = require("../scripts/pc-setup.cjs");
const { maskCredentials } = require("../scripts/redaction.cjs");

const binary = coreBinary();
const skip = existsSync(binary) ? false : `mefi-core is not built (${binary}); run npm run host:core`;

const MIB = 1024 * 1024;
const NOW = Date.parse("2026-06-15T12:00:00Z");
const DATE = "2026-06-15T12:00:00Z";
// Built at run time so this file never holds a key-shaped line of its own.
const TOKEN = `ghp_${"a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6"}`;
const KEY_LINE = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ");
const JWT = ["eyJ" + "hbGciOiJIUzI1NiJ9x", "eyJzdWIiOiIxMjM0NTY3ODkw", "c2lnbmF0dXJlLXN0YW5kLWlu"].join(".");
const SLACK = ["xoxb", "1234567890", "abcdefghij"].join("-");

const CONST = (value) => ({ $mefi: "const", value });
const asJs = (value) => {
  if (value && typeof value === "object" && value.$mefi === "const") return () => value.value;
  if (Array.isArray(value)) return value.map(asJs);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asJs(item)]));
  return value;
};

function batch(calls, env = process.env) {
  const ran = spawnSync(binary, ["repo-batch"], { input: JSON.stringify(calls), encoding: "utf8", maxBuffer: 256 * MIB, windowsHide: true, env });
  assert.equal(ran.status, 0, ran.stderr);
  return JSON.parse(ran.stdout);
}

// ---- the pure helpers -----------------------------------------------------------

const STDERRS = [
  "",
  "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com",
  " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'https://github.com/o/r.git'\nhint: Updates were rejected because the remote contains work that you do not",
  "remote: error: GH006: Protected branch update failed for refs/heads/main.\nTo https://github.com/o/r.git\n ! [remote rejected] main -> main (protected branch hook declined)",
  "remote: error: GH013: Repository rule violations found for refs/heads/release.",
  "To https://github.com/o/r.git\n ] x -> develop\nremote: Changes must be made through a pull request.",
  "! [remote rejected] main -> main (refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope)",
  "remote: —— GitHub Personal Access Token ——————————————————\nremote:   locations:\nremote:     - commit: abc\nremote:       path: src/config.js:12\nremote: error: GH013: Repository rule violations found\nremote: - GITHUB PUSH PROTECTION",
  "remote: warning: File media/clip.mov is 62.10 MB; this is larger than GitHub's recommended maximum file size of 50.00 MB\nremote: error: File big/data.bin is 120.50 MB; this exceeds GitHub's file size limit of 100.00 MB\nremote: error: GH001: Large files detected.",
  "remote: error: File odd.bin is 1.2.3 MB; this exceeds GitHub's file size limit of 100.00 MB",
  "remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found",
  "remote: Permission to o/r.git denied to someone.\nfatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403",
  "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
  "error: something else went wrong at https://user:pass@example.com/path\nhint: try again later",
  `token ${TOKEN} leaked; GH_TOKEN=abc123 and Authorization: Bearer xyz.abc`,
  "spawn gh ENOENT",
  "'git' is not recognized as an internal or external command",
  "HTTP 422: Repository creation failed. name already exists on this account",
  "GraphQL: Name already exists on this account (createRepository)",
  "error: your authentication token is missing required scopes [repo workflow]",
  "To request it, run:  gh auth refresh -h github.com -s admin:org",
  "Resource protected by organization SAML enforcement.",
  "You are not logged into any GitHub hosts. To log in, run: gh auth login",
  "API rate limit exceeded for user ID 1. HTTP 429",
  "GraphQL: octo-org cannot create a repository for octo-cat. (createRepository)",
  "HTTP 403: Resource not accessible by integration",
  "GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)",
  "dial tcp: lookup api.github.com: no such host",
  "x".repeat(25000) + "\nerror: failed for good",
];

const PATHS = [
  ".env", ".env.local", ".env.example", "config/.ENV.sample", "server.pem", "server.pem.", "server.pem::$DATA", "keys/id_ed25519.pub", "auth.json", "Credentials.JSON",
  ".netrc", "_netrc", ".git-credentials", ".pypirc", ".pgpass", ".htpasswd", "cert.pfx", "cert.p12", "putty.ppk", "release.keystore", "app.jks",
  "secrets/", "app/.secrets/x.txt", ".ssh/config", "home/.AWS/credentials", ".gnupg/", "node_modules/", "a/Node_Modules/b.js", "DIST/out.js", "dist", "src/index.js",
  "./././.env", "a\\b\\.env", "", "/", "folder/sub/",
];

const NAMES = ["Mefi's Studio AI+", "Café Été.git", "  --..name..--  ", "日本語", "a".repeat(120), "x.git.git", "ok-name", "my_app.v2", "‘quoted’ ʼname`", ".hidden", "..", "-lead"];

test("the pure helpers answer like the JavaScript", { skip }, () => {
  const cases = [];
  const add = (fn, args, js) => cases.push({ fn, args, js });
  for (const stderr of STDERRS) {
    add("rules.classifyPush", [stderr, {}], () => rules.classifyPush(stderr));
    add("rules.classifyPush", [stderr, { timedOut: false, branch: "dev" }], () => rules.classifyPush(stderr, { branch: "dev" }));
    add("rules.classifyGh", [stderr, { repo: "octo-cat/app", action: "create" }], () => rules.classifyGh(stderr, { repo: "octo-cat/app", action: "create" }));
    add("rules.classifyGh", [stderr, {}], () => rules.classifyGh(stderr));
    add("rules.scrub", [stderr], () => rules.scrub(stderr));
    add("rules.maskCredentials", [stderr], () => maskCredentials(stderr));
  }
  add("rules.classifyPush", ["anything", { timedOut: true }], () => rules.classifyPush("anything", { timedOut: true }));
  add("rules.classifyGh", ["missing scope", { scope: "workflow" }], () => rules.classifyGh("missing scope", { scope: "workflow" }));
  for (const item of PATHS) add("rules.pathBlocked", [item], () => rules.pathBlocked(item));
  for (const name of NAMES) {
    add("rules.repoName", [name], () => rules.repoName(name));
    add("rules.nameSuggestions", [name], () => rules.nameSuggestions(name));
    add("rules.repoIssue", ["octo-cat", name], () => rules.repoIssue("octo-cat", name));
    add("rules.validRepo", ["octo-cat", name], () => rules.validRepo("octo-cat", name));
  }
  for (const owner of ["octo-cat", "-bad", "bad-", "a".repeat(40), "", "o"]) add("rules.repoIssue", [owner, "app"], () => rules.repoIssue(owner, "app"));
  for (const count of [0, 1, 2, 2.7, -1]) add("rules.saveMessage", [count], () => rules.saveMessage(count));
  for (const stacks of [[], ["node"], ["Python", "love", "node", "node", "rust"]]) add("rules.gitignoreFor", [stacks], () => rules.gitignoreFor(stacks));
  for (const [id, options] of [["mit", { holder: "Octo Cat", year: 2026 }], ["Apache-2.0", { holder: "x\u0001y  z", year: 2026.5 }], ["mit", {}], ["none", {}], ["gpl", {}]]) {
    add("rules.licenseText", [id, options], () => rules.licenseText(id, options));
  }
  for (const [where, env] of [
    ["C:\\Users\\me\\OneDrive\\code\\app", {}],
    ["C:/Users/me/Work/OneDrive - Contoso/app", {}],
    ["D:\\Sync\\app", { OneDriveCommercial: "D:\\Sync\\" }],
    ["D:\\Synced\\app", { OneDrive: "D:\\Sync" }],
    ["C:\\code\\app", { ONEDRIVE: "" }],
  ]) add("rules.oneDrive", [where, env], () => rules.oneDrive(where, env));
  for (const plan of [
    { owner: "octo-cat", name: "app", isRepo: false, stacks: ["node"], license: "MIT", holder: "octo-cat", year: 2026, description: "  An\tapp\n with  spaces " },
    { owner: "octo-cat", name: "app", isRepo: true, unborn: true, branch: "master", gitignore: false },
    { owner: "octo-cat", name: "app", isRepo: true, hasCommits: true, branch: "master", license: "apache-2.0" },
    { owner: "octo-cat", name: "app", isRepo: true, hasCommits: true, branch: "main", gitignore: false },
    { owner: "octo-cat", name: "app", visibility: "public", confirmPublic: " octo-cat/app " },
    { owner: "octo-cat", name: "app", visibility: "public", confirmPublic: "nope" },
    { owner: "octo-cat", name: "app", visibility: "secret" },
    { owner: "octo-cat", name: "app", license: "gpl" },
    { owner: "octo-cat", name: "app", hasRemote: true },
    { owner: "octo-cat", name: "app", isRepo: true, detached: true, hasCommits: true },
    { owner: "bad owner", name: "app" },
  ]) add("rules.publishPlan", [plan], () => rules.publishPlan(plan));
  const auth = "github.com\n  \u2713 Logged in to github.com account octo-cat (keyring)\n";
  for (const text of [auth, "Logged in to github.com as old-style", "nothing"]) add("rules.signedInAccount", [text], () => signedInAccount(text));
  for (const folder of ["C:\\Users\\me\\app", "e:/x", "\\\\server\\share", "/home/me", "", "1:"]) add("rules.filesystemQuery", [folder], () => filesystemQuery(folder));
  for (const text of ["NTFS\r\n", "  exFAT  ", "", "File System Name : NTFS", "FAT32\nNTFS", "a".repeat(33), "?"]) add("rules.filesystemOf", [text], () => filesystemOf(text));
  for (const url of ["https://github.com/octo-cat/app.git", "https://x:y@github.com/octo-cat/app/", "git@github.com:octo-cat/app.git", "ssh://git@github.com/octo-cat/app", "https://gitlab.com/a/b", " https://github.com/octo-cat/my.app.git \n", ""]) {
    add("rules.githubRemote", [url], () => githubRemote(url));
  }

  // git-actions' own parts.
  const status = "# branch.oid 1234\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n1 .M N... 100644 100644 100644 a b src/a.js\n? new.txt\r\n";
  for (const text of [status, "# branch.oid (initial)\n# branch.head master\n", "# branch.head (detached)\n# branch.ab +x -1\n"]) add("parts.parseHeaders", [text], () => parts.parseHeaders(text));
  const z = ["# branch.oid abc", "# branch.head feature x", "# branch.upstream origin/feature", "1 .M N... 100644 100644 100644 aaa bbb src/a b.js", "2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt", "old name.txt", "u UU N... 100644 100644 100644 100644 a b c conflict.txt", "? untracked dir/", "? file.txt", "1 bad", ""].join("\0");
  add("parts.parseStatusZ", [z], () => parts.parseStatusZ(z));
  const diff = [
    "diff --git a/src/a.js b/src/a.js", "--- a/src/a.js", "+++ b/src/a.js", "@@ -1,2 +1,3 @@", "-old", "+new line", "+++ not a header", "+third",
    "diff --git a/b.txt b/b.txt", "--- a/b.txt", "+++ b/b.txt\t(tabbed)", "@@ -5 +5 @@", "-x", "+y", "\\ No newline at end of file",
    "--- a/\"q\\tuote.txt\"", "+++ \"b/q\\tuote\\303\\251.txt\"", "@@ -0,0 +1 @@", "+quoted",
    "+++ /dev/null", "@@ -1 +0,0 @@", "-gone",
  ].join("\n");
  add("parts.addedLines", [diff], () => [...parts.addedLines(diff)]);
  for (const quoted of ['"a\\tb"', '"\\303\\251t\\303\\251"', '"a\\\\b\\"c"', '"x\\qy"', '"\\777"', '"emoji 😀 \\n"']) add("parts.unquote", [quoted], () => parts.unquote(quoted));
  const ignore = "# comment\n*.log\n!keep.log\nbuild/\n/root-only.txt\nsub/*.tmp\n  spaced.txt  \n?.md\n[ab].txt\n";
  const probes = [["a.log", false], ["dir/a.log", false], ["keep.log", false], ["build", true], ["build", false], ["x/build", true], ["root-only.txt", false], ["x/root-only.txt", false], ["sub/a.tmp", false], ["sub/deep/a.tmp", false], ["spaced.txt", false], ["a.md", false], ["ab.md", false], ["[ab].txt", false], ["a.txt", false]];
  add("parts.ignoreMatcher", [ignore, probes], () => probes.map(([rel, dir]) => parts.ignoreMatcher(ignore)(rel, dir)));
  for (const list of [["a.txt", "b c.txt"], Array.from({ length: 900 }, (_, index) => `folder/file-${index}.txt`), []]) add("parts.pathspec", [list], () => parts.pathspec(list));
  for (const text of [
    "plain words", `key ${TOKEN}`, KEY_LINE, `auth ${JWT}`, "password = hunter2secret", "https://user:pw@example.com/x", `${"a.".repeat(200)}://u:p@h`,
    "sk_live_" + "a".repeat(24), "npm_" + "b".repeat(36), SLACK, "aws_secret_access_key = " + "Q".repeat(40), "hooks.slack.com/services/" + "T".repeat(24),
    `password: something and ${TOKEN}`,
  ]) add("parts.scanText", [text], () => { const found = parts.scanText(text); return { stop: found.stop?.id ?? null, maybe: found.maybe?.id ?? null }; });

  const answers = batch(cases.map((item) => ({ function: `git.${item.fn}`, args: item.args })));
  for (const [index, item] of cases.entries()) {
    const answer = answers[index];
    assert.equal(answer.ok, true, `${item.fn} failed in Rust: ${answer.error}`);
    assert.deepEqual(answer.value, JSON.parse(JSON.stringify(item.js() ?? null)), `${item.fn}(${JSON.stringify(item.args).slice(0, 200)})`);
  }
});

// ---- the actions on real folders ----------------------------------------------------

// gh: node.exe under the name gh.exe, answered by a preloaded script that does
// nothing in any other process.
const FAKE_GH = String.raw`"use strict";
const path = require("node:path");
if (path.basename(process.execPath).toLowerCase() === "gh.exe") {
  const fs = require("node:fs");
  const { execFileSync } = require("node:child_process");
  const args = [path.basename(process.argv[1] ?? ""), ...process.argv.slice(2)];
  const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"));
  const out = (text, code = 0) => { fs.writeSync(code ? 2 : 1, text); process.exit(code); };
  if (args[0] === "auth" && args[1] === "status") {
    if (state.account) out("github.com\n  \u2713 Logged in to github.com account " + state.account + " (keyring)\n  - Token: gho_****\n");
    out("You are not logged into any GitHub hosts. To log in, run: gh auth login\n", 1);
  }
  if (args[0] === "api" && args[1] === "user/orgs") out((state.orgs ?? []).join("\n") + "\n");
  if (args[0] === "api" && args[1] === "user") state.userId ? out(state.account + " " + state.userId + "\n") : out("dial tcp: lookup api.github.com: no such host\n", 1);
  if (args[0] === "repo" && args[1] === "view") {
    const view = (state.views ?? {})[args[2]];
    if (view && view.fail) out(view.stderr + "\n", 1);
    if (view) out(JSON.stringify(view) + "\n");
    out("GraphQL: Could not resolve to a Repository with the name '" + args[2] + "'. (repository)\n", 1);
  }
  if (args[0] === "repo" && args[1] === "create") {
    const repo = args[2];
    const mode = (state.create ?? {})[repo];
    if (mode === "taken") out("GraphQL: Name already exists on this account (createRepository)\n", 1);
    if (mode !== "ok") out("HTTP 422: Repository creation failed.\n", 1);
    const hub = path.join(state.hub, repo + ".git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", hub], { windowsHide: true });
    fs.appendFileSync(state.config, "[url \"" + hub.replace(/\\/g, "/") + "\"]\n\tinsteadOf = https://github.com/" + repo + ".git\n");
    execFileSync("git", ["remote", "add", "origin", "https://github.com/" + repo + ".git"], { windowsHide: true });
    out("\u2713 Created repository " + repo + " on GitHub\n");
  }
  out("unexpected gh " + args.join(" ") + "\n", 2);
}
`;

function fakeGhBin(t) {
  const bin = mkdtempSync(path.join(tmpdir(), "mefi-pg-bin-"));
  t.after(() => rmSync(bin, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  try { linkSync(process.execPath, path.join(bin, "gh.exe")); } catch { copyFileSync(process.execPath, path.join(bin, "gh.exe")); }
  const script = path.join(bin, "fake-gh.cjs");
  writeFileSync(script, FAKE_GH);
  return { bin, script };
}

// A folder of folders, built the same way every time.
function makeBox(t, label, gh) {
  const root = mkdtempSync(path.join(tmpdir(), `mefi-pg-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const config = path.join(root, "gitconfig");
  const anonConfig = path.join(root, "gitconfig-anon");
  const base = ["[init]", "\tdefaultBranch = master", "[core]", "\tautocrlf = false", "[commit]", "\tgpgsign = false"];
  writeFileSync(config, `${[...base, "[user]", "\tname = Fixture Owner", "\temail = owner@fixture.invalid"].join("\n")}\n`);
  writeFileSync(anonConfig, `${base.join("\n")}\n`);
  const hub = path.join(root, "hub");
  const ghState = (name, value) => { const file = path.join(root, `gh-${name}.json`); writeFileSync(file, JSON.stringify({ hub, config, ...value })); return file; };
  const views = {
    "octo-cat/app": { nameWithOwner: "octo-cat/app" },
    "octo-cat/pub1": { nameWithOwner: "octo-cat/pub1", owner: { login: "Octo-Cat" }, isEmpty: false, isPrivate: true },
    "octo-cat/pub3": { nameWithOwner: "octo-cat/pub3", owner: { login: "octo-cat" }, isEmpty: true, isPrivate: true },
    "octo-cat/pub4": { nameWithOwner: "octo-cat/pub4", owner: { login: "someone-else" }, isEmpty: true, isPrivate: true },
    "octo-cat/flaky": { fail: true, stderr: "error connecting to api.github.com\ncheck your internet connection" },
  };
  const create = { "octo-cat/pub1": "ok", "octo-cat/pub3": "taken", "octo-cat/pub4": "taken", "octo-cat/pub5": "ok", "octo-cat/pub6": "ok" };
  const signedIn = ghState("in", { account: "octo-cat", orgs: ["octo-org", "bad org!", "other-org"], userId: "4242", views, create });
  const offline = ghState("offline", { account: "octo-cat", userId: null, views, create });
  const signedOut = ghState("out", { account: null, views, create });
  const realGh = new Set((process.env.PATH ?? "").split(path.delimiter).filter((dir) => dir && (existsSync(path.join(dir, "gh.exe")) || existsSync(path.join(dir, "gh.com")))));
  const plainPath = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => !realGh.has(dir)).join(path.delimiter);
  const clean = { ...process.env };
  for (const name of Object.keys(clean)) {
    if (/^(GIT_|GH_|GITHUB_TOKEN$|EMAIL$|NODE_OPTIONS$|PATH$)/i.test(name)) delete clean[name];
  }
  const envOf = ({ state = signedIn, gh: withGh = true, anon = false } = {}) => ({
    ...clean, PATH: withGh ? `${gh.bin}${path.delimiter}${plainPath}` : plainPath,
    GIT_CONFIG_GLOBAL: anon ? anonConfig : config, GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file", GIT_TERMINAL_PROMPT: "0",
    // NODE_OPTIONS reads a backslash inside quotes as an escape: forward slashes.
    GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE, FAKE_GH_STATE: state, NODE_OPTIONS: `--require "${gh.script.replace(/\\/g, "/")}"`,
    // A stray variable that must never reach git (it would point it at another repository).
    GIT_DIR: path.join(root, "nowhere"),
  });
  const env = envOf();
  const gitEnv = { ...env };
  delete gitEnv.GIT_DIR;
  delete gitEnv.NODE_OPTIONS;
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const p = (...names) => path.join(root, ...names);
  const put = (rel, text = `${path.basename(rel)}\n`) => { const file = p(rel); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  const dir = (rel) => { mkdirSync(p(rel), { recursive: true }); return p(rel); };
  const route = (repo) => {
    const target = path.join(hub, `${repo}.git`);
    mkdirSync(path.dirname(target), { recursive: true });
    git(root, "init", "-q", "--bare", "-b", "main", target);
    appendFileSync(config, `[url "${target.replace(/\\/g, "/")}"]\n\tinsteadOf = https://github.com/${repo}.git\n`);
    return target;
  };
  const repo = (rel, files, { branch = "main" } = {}) => {
    dir(rel);
    git(p(rel), "init", "-q", "-b", branch);
    for (const [name, text] of Object.entries(files)) put(`${rel}/${name}`, text);
    git(p(rel), "add", "-A");
    git(p(rel), "commit", "-q", "-m", "seed");
    return p(rel);
  };
  return {
    root, env, envOf, git, p, put, dir, route, repo, homes: [p("broad", "me")],
    envs: { signedOut: envOf({ state: signedOut }), offline: envOf({ state: offline }), noGh: envOf({ gh: false }), anon: envOf({ anon: true }) },
  };
}

// Everything the steps act on.
function build(box) {
  const { git, p, put, dir, route, repo } = box;
  dir("plain");
  put("plain/readme.txt");
  dir("unborn");
  git(p("unborn"), "init", "-q");
  put("unborn/a.txt");

  route("octo-cat/app");
  repo("app", { "README.md": "# app\n" });
  git(p("app"), "remote", "add", "origin", "https://github.com/octo-cat/app.git");
  git(p("app"), "push", "-q", "-u", "origin", "main");
  put("app/two.txt");
  git(p("app"), "add", "two.txt");
  git(p("app"), "commit", "-q", "-m", "two");
  put("app/dirty.txt");
  git(box.root, "clone", "-q", "https://github.com/octo-cat/app.git", p("feature"));
  git(p("feature"), "checkout", "-q", "-b", "feature");
  repo("detached", { "a.txt": "a\n" });
  git(p("detached"), "checkout", "-q", "--detach");
  repo("gitlab", { "a.txt": "a\n" });
  git(p("gitlab"), "remote", "add", "origin", "https://gitlab.com/x/y.git");
  // A GitHub address with no local stand-in: glance never fetches, so it reads as GitHub.
  repo("ghremote", { "a.txt": "a\n" }, { branch: "trunk" });
  git(p("ghremote"), "remote", "add", "origin", "https://github.com/octo-cat/ghremote.git");

  // A checkout with every kind of change.
  repo("work", { "README.md": "# work\n", "src/a.js": "const a = 1;\n", "keep.txt": "keep\n", "old.txt": "old\n", "del.txt": "del\n", "sub/tracked.txt": "t\n" });
  put("work/src/a.js", `const a = 1;\nconst key = "${TOKEN}";\n`);
  put("work/keep.txt", "keep\npassword = hunter2secret\n");
  git(p("work"), "mv", "old.txt", "new-name.txt");
  git(p("work"), "rm", "-q", "del.txt");
  put("work/notes.md", "# notes\n");
  put("work/.env", "API=1\n");
  put("work/config/.env.example", "API=\n");
  put("work/secrets/x.txt", "x\n");
  put("work/node_modules/pkg/index.js", "module.exports = 1;\n");
  put("work/dist/out.js", "out\n");
  put("work/sub/deep/file.txt", "deep\n");
  put("work/sub/jwt.txt", `token: ${JWT}\n`);
  writeFileSync(p("work", "utf16.txt"), Buffer.from(`\ufeffslack ${SLACK} here\n`, "utf16le"));
  writeFileSync(p("work", "bin.dat"), Buffer.from([0, 1, 2, 0, 0, 0, 65, 66, 0, 0]));
  put("work/big.txt", `${"line of text\n".repeat(Math.ceil((2 * MIB) / 13))}`);
  put("work/large.txt", "");
  truncateSync(p("work", "large.txt"), 51 * MIB);
  put("work/huge.bin", "");
  truncateSync(p("work", "huge.bin"), 101 * MIB);
  put("work/photo.png", "");
  truncateSync(p("work", "photo.png"), 2 * MIB);
  repo("work/inner", { "x.txt": "x\n" });
  put("outside/far.txt", "far\n");
  symlinkSync(p("outside"), p("work", "linkout"), "junction");
  // A merge in progress, a checkout with no identity, a folder inside a project.
  repo("merging", { "a.txt": "a\n" });
  put("merging/b.txt");
  repo("anon", { "a.txt": "a\n" });
  put("anon/b.txt");
  put("anon/c.txt");

  // Pushes: one behind GitHub, one with nothing to push to, one unborn.
  route("octo-cat/race");
  repo("race", { "a.txt": "a\n" });
  git(p("race"), "remote", "add", "origin", "https://github.com/octo-cat/race.git");
  git(p("race"), "push", "-q", "-u", "origin", "main");
  git(box.root, "clone", "-q", "https://github.com/octo-cat/race.git", p("race-other"));
  put("race-other/theirs.txt");
  git(p("race-other"), "add", "theirs.txt");
  git(p("race-other"), "commit", "-q", "-m", "theirs");
  git(p("race-other"), "push", "-q");
  put("race/mine.txt");
  git(p("race"), "add", "mine.txt");
  git(p("race"), "commit", "-q", "-m", "mine");
  repo("noremote", { "a.txt": "a\n" });

  // Publishing.
  put("site/package.json", "{}\n");
  put("site/index.js", "console.log(1);\n");
  put("site/.env", "X=1\n");
  put("site/node_modules/x/i.js", "x\n");
  put("site/logs/a.log", "log\n");
  put("site/secret.txt", `jwt ${JWT}\n`);
  put("site/docs/guide.md", "# guide\n");
  put("site-ignore/.gitignore", "*.log\n!keep.log\nbuild/\n");
  put("site-ignore/a.log", "a\n");
  put("site-ignore/keep.log", "k\n");
  put("site-ignore/build/x.js", "x\n");
  put("site-ignore/src/b.js", "b\n");
  dir("fresh-repo");
  git(p("fresh-repo"), "init", "-q");
  put("fresh-repo/main.lua", "print(1)\n");
  put("fresh-repo/node_modules/y.js", "y\n");
  put("fresh-repo/game.love", "zip\n");
  repo("oldrepo", { "README.md": "# old\n", ".env": "SECRET=1\n" }, { branch: "master" });
  put("broad/me/x.txt");
  put("pub1/README.md", "# pub1\n");
  put("pub1/src/main.py", "print(1)\n");
  put("pub1/requirements.txt", "requests\n");
  put("pub2/a.txt");
  put("pub3/a.txt");
  route("octo-cat/pub3");
  put("pub4/a.txt");
  repo("pub5", { "a.txt": "a\n" }, { branch: "master" });
  put("pub6/a.txt");

  // Linking.
  route("octo-cat/shared");
  repo("shared-src", { "s.txt": "s\n" });
  git(p("shared-src"), "remote", "add", "origin", "https://github.com/octo-cat/shared.git");
  git(p("shared-src"), "push", "-q", "-u", "origin", "main");
  git(box.root, "clone", "-q", "https://github.com/octo-cat/shared.git", p("linkme"));
  git(p("linkme"), "remote", "remove", "origin");
  repo("stranger", { "z.txt": "z\n" });
  route("octo-cat/empty");
  repo("toempty", { "e.txt": "e\n" });
}

// The steps: a call (both run it on their own box) or a change to the box between calls.
// `env` picks one of the box's environments; `args` builds the arguments in that box.
const STEPS = [
  { fn: "glance", args: (b) => [b.p("missing")] },
  { fn: "glance", args: (b) => [b.p("plain")] },
  { fn: "glance", args: (b) => [b.p("unborn")] },
  { fn: "glance", args: (b) => [b.p("app"), { budgetMs: 10000 }] },
  { fn: "glance", args: (b) => [b.p("feature")] },
  { fn: "glance", args: (b) => [b.p("detached")] },
  { fn: "glance", args: (b) => [b.p("gitlab")] },
  { fn: "glance", args: (b) => [b.p("ghremote")] },
  { fn: "publishPreview", args: (b) => [b.p("ghremote"), { owner: "octo-cat", name: "ghremote" }] },
  { fn: "glance", args: () => [""] },
  { fn: "glance", args: (b) => [b.p("app")], env: "noGh" },
  { fn: "glanceMany", args: (b) => [[{ id: "a", root: b.p("app") }, { id: "b", path: b.p("plain") }, { id: "c", root: b.p("missing") }, { id: "d" }, "junk", { id: "e", root: 5 }, { root: b.p("unborn") }]] },

  { fn: "preview", args: (b) => [b.p("work"), { builders: true }] },
  { fn: "preview", args: (b) => [b.p("work", "sub")] },
  { fn: "preview", args: (b) => [b.p("plain")] },
  { fn: "preview", args: (b) => [b.p("missing")] },
  { fn: "preview", args: (b) => [b.p("detached")] },
  { fn: "save", args: (b) => [b.p("work"), { paths: ["notes.md", "src/a.js"] }] },
  { fn: "save", args: (b) => [b.p("work"), { paths: ["huge.bin"] }] },
  { fn: "save", args: (b) => [b.p("work"), { paths: ["nope.txt"] }] },
  { fn: "save", args: (b) => [b.p("work"), { paths: [] }] },
  { fn: "save", args: (b) => [b.p("work"), { paths: ["notes.md"], builders: true }] },
  { fn: "save", args: (b) => [b.p("work"), { paths: ["notes.md", "keep.txt", "new-name.txt", "old.txt", "del.txt", "sub/deep/file.txt", "notes.md", 5, ""], message: "  Save\u0000 from parity  " }], succeeds: true },
  { fn: "preview", args: (b) => [b.p("work")] },
  { do: (b) => writeFileSync(b.p("work", ".git", "index.lock"), "") },
  { fn: "save", args: (b) => [b.p("work"), { paths: ["config/.env.example"] }] },
  { do: (b) => rmSync(b.p("work", ".git", "index.lock")) },
  { do: (b) => writeFileSync(b.p("merging", ".git", "MERGE_HEAD"), "0000000000000000000000000000000000000000\n") },
  { fn: "preview", args: (b) => [b.p("merging")] },
  { fn: "save", args: (b) => [b.p("merging"), { paths: ["b.txt"] }] },
  { fn: "preview", args: (b) => [b.p("anon"), { identity: { name: "Given\u0007 <Name>", email: "given@example.invalid" } }], env: "anon" },
  { fn: "preview", args: (b) => [b.p("anon")], env: "anon" },
  { fn: "save", args: (b) => [b.p("anon"), { paths: ["b.txt"] }], env: "anon", succeeds: true },
  { fn: "save", args: (b) => [b.p("anon"), { paths: ["c.txt"], message: "" }], env: { name: "anon", state: "signedOut" } },

  { fn: "pushBranch", args: (b) => [b.p("app"), { check: CONST({ ok: false, detail: "lint failed at https://u:p@example.com" }) }] },
  { fn: "pushBranch", args: (b) => [b.p("app"), { check: CONST({ ok: true }) }], succeeds: true },
  { fn: "pushBranch", args: (b) => [b.p("app")] },
  { fn: "glance", args: (b) => [b.p("app")] },
  { fn: "pushBranch", args: (b) => [b.p("race")] },
  { fn: "pushBranch", args: (b) => [b.p("noremote")] },
  { fn: "pushBranch", args: (b) => [b.p("unborn")] },
  { fn: "pushBranch", args: (b) => [b.p("detached")] },
  { fn: "pushBranch", args: (b) => [b.p("missing")] },

  { fn: "account", args: () => [], succeeds: true },
  { fn: "account", args: () => [], env: "signedOut" },
  { fn: "account", args: () => [], env: "noGh" },
  { fn: "identity", args: () => [], succeeds: true },
  { fn: "identity", args: () => [], env: "offline" },
  { fn: "identity", args: () => [], env: "signedOut" },
  { fn: "identity", args: () => [], env: "noGh" },
  { fn: "owners", args: () => [], succeeds: true },
  { fn: "owners", args: () => [], env: "signedOut" },
  { fn: "owners", args: () => [], env: "noGh" },
  { fn: "nameCheck", args: () => ["octo-cat", "app"] },
  { fn: "nameCheck", args: () => ["octo-cat", "brand-new"] },
  { fn: "nameCheck", args: () => ["octo-cat", "flaky"] },
  { fn: "nameCheck", args: () => ["bad owner", "x"] },
  { fn: "nameCheck", args: () => ["octo-cat", "x.git"] },
  { fn: "nameCheck", args: () => ["octo-cat", "Café Été"] },
  { fn: "nameCheck", args: () => ["octo-cat", "app"], env: "noGh" },

  { fn: "publishPreview", args: (b) => [b.p("site"), { owner: "octo-cat", name: "site" }] },
  { fn: "publishPreview", args: (b) => [b.p("site"), { owner: "octo-cat", name: "site", gitignore: false }] },
  { fn: "publishPreview", args: (b) => [b.p("site-ignore"), { owner: "octo-cat", name: "app" }] },
  { fn: "publishPreview", args: (b) => [b.p("fresh-repo"), { owner: "octo-cat", name: "fresh-repo" }] },
  { fn: "publishPreview", args: (b) => [b.p("oldrepo"), { owner: "octo-cat", name: "oldrepo" }] },
  { fn: "publishPreview", args: (b) => [b.p("gitlab"), { owner: "octo-cat", name: "gitlab" }], env: "signedOut" },
  { fn: "publishPreview", args: (b) => [b.p("broad"), { owner: "octo-cat", name: "broad" }] },
  { fn: "publishPreview", args: (b) => [b.p("work", "sub"), { owner: "octo-cat", name: "sub" }] },
  { fn: "publishPreview", args: (b) => [b.p("missing"), {}] },

  { fn: "publish", args: (b) => [b.p("pub1"), { owner: "octo-cat", name: "pub1", license: "MIT", description: "A parity\ttest" }], succeeds: true },
  { fn: "glance", args: (b) => [b.p("pub1")] },
  { fn: "publish", args: (b) => [b.p("pub1"), { owner: "octo-cat", name: "pub1" }] },
  { fn: "publish", args: (b) => [b.p("pub2"), { owner: "octo-cat", name: "pub2", visibility: "public" }] },
  { fn: "publish", args: (b) => [b.p("pub3"), { owner: "octo-cat", name: "pub3", license: "apache-2.0" }], succeeds: true },
  { fn: "publish", args: (b) => [b.p("pub4"), { owner: "octo-cat", name: "pub4" }] },
  { fn: "publish", args: (b) => [b.p("pub5"), { owner: "octo-cat", name: "pub5", gitignore: false }], succeeds: true },
  { fn: "publish", args: (b) => [b.p("pub6"), { owner: "octo-cat", name: "pub6" }], env: "signedOut" },
  { fn: "publish", args: (b) => [b.p("pub6"), { owner: "octo-cat", name: "-pub6" }] },
  { fn: "publish", args: (b) => [b.p("broad"), { owner: "octo-cat", name: "broad" }] },
  { fn: "publish", args: (b) => [b.p("gitlab"), { owner: "octo-cat", name: "gitlab" }] },

  { fn: "link", args: (b) => [b.p("linkme"), { repo: "octo-cat/shared", isListed: CONST(true) }], succeeds: true },
  { fn: "glance", args: (b) => [b.p("linkme")] },
  { fn: "link", args: (b) => [b.p("stranger"), { repo: "octo-cat/shared", isListed: CONST(["unused"]) }] },
  { fn: "link", args: (b) => [b.p("stranger"), { repo: "octo-cat/shared", isListed: CONST(true) }] },
  { fn: "link", args: (b) => [b.p("toempty"), { repo: "octo-cat/empty", isListed: CONST(true) }], succeeds: true },
  { fn: "link", args: (b) => [b.p("toempty"), { repo: "octo-cat/other" }] },
  { fn: "link", args: (b) => [b.p("app"), { repo: "octo-cat/app", isListed: CONST(true) }] },
  { fn: "link", args: (b) => [b.p("unborn"), { repo: "octo-cat/app", isListed: CONST(true) }] },
  { fn: "link", args: (b) => [b.p("plain"), { repo: "not a repo", isListed: CONST(true) }] },
];

function envFor(box, step) {
  if (!step.env) return box.env;
  if (typeof step.env === "string") return box.envs[step.env];
  return box.envOf({ anon: step.env.name === "anon", state: step.env.state === "signedOut" ? path.join(box.root, "gh-out.json") : undefined });
}

// Each box's folder, in every spelling an answer can carry it, becomes <box>.
function mask(value, root) {
  const forms = [...new Set([root, root.replace(/\\/g, "/"), path.resolve(root)].flatMap((form) => [form, form.toLowerCase()]))].sort((a, b) => b.length - a.length);
  let out = JSON.stringify(value ?? null);
  for (const form of forms) out = out.split(JSON.stringify(form).slice(1, -1)).join("<box>").split(form).join("<box>");
  return JSON.parse(out);
}

test("the actions answer like the JavaScript on real folders", { skip, timeout: 600000 }, async (t) => {
  const gh = fakeGhBin(t);
  const boxes = { js: makeBox(t, "js", gh), rust: makeBox(t, "rs", gh) };
  build(boxes.js);
  build(boxes.rust);

  const results = { js: [], rust: [] };
  // JavaScript: one step at a time.
  for (const step of STEPS) {
    if (step.do) { step.do(boxes.js); results.js.push("done"); continue; }
    const env = envFor(boxes.js, step);
    const actions = createGitActions({ env: () => env, homes: () => boxes.js.homes, now: () => NOW });
    results.js.push(await actions[step.fn](...asJs(step.args(boxes.js))));
  }
  // Rust: the calls between two changes in one batch.
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    for (const answer of batch(pending)) results.rust.push(answer.ok ? answer.value : { rustError: answer.error });
    pending = [];
  };
  for (const step of STEPS) {
    if (step.do) { flush(); step.do(boxes.rust); results.rust.push("done"); continue; }
    const env = envFor(boxes.rust, step);
    pending.push({ function: `git.${step.fn}`, args: [{ env: CONST(env), homes: CONST(boxes.rust.homes), now: CONST(NOW) }, ...step.args(boxes.rust)] });
  }
  flush();

  // MEFI_PARITY_DUMP=<file> saves what the JavaScript answered (masked): equal answers can still both be failures.
  if (process.env.MEFI_PARITY_DUMP) writeFileSync(process.env.MEFI_PARITY_DUMP, JSON.stringify(STEPS.map((step, index) => ({ fn: step.fn, js: mask(results.js[index], boxes.js.root) })), null, 1));
  for (const [index, step] of STEPS.entries()) {
    if (step.do) continue;
    const label = `${index}: ${step.fn}(${JSON.stringify(step.args(boxes.js)).replaceAll(boxes.js.root.replace(/\\/g, "\\\\"), "<box>").slice(0, 160)})${step.env ? ` with ${JSON.stringify(step.env)}` : ""}`;
    assert.deepEqual(mask(results.rust[index], boxes.rust.root), mask(JSON.parse(JSON.stringify(results.js[index] ?? null)), boxes.js.root), label);
  }
  // Equal is not enough: the flows that should work did (a broken fake gh once made both sides fail alike).
  for (const [index, step] of STEPS.entries()) {
    if (!step.succeeds) continue;
    const answer = results.js[index];
    assert.equal(answer?.ok, true, `${index}: ${step.fn} should succeed: ${JSON.stringify(answer).slice(0, 300)}`);
    if (step.fn === "account") assert.equal(answer.account, "octo-cat", "the fake gh answered");
  }
  // The two boxes ended the same: every commit the actions made has the same id.
  for (const folder of ["work", "anon", "app", "pub1", "pub3", "pub5", "linkme"]) {
    assert.equal(boxes.rust.git(boxes.rust.p(folder), "log", "--format=%H %s", "--all"), boxes.js.git(boxes.js.p(folder), "log", "--format=%H %s", "--all"), `${folder}'s history`);
  }
});
