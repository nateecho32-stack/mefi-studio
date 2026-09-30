// project_list and project_search (scripts/project-search.cjs) against real
// temp projects: .gitignore honoured, binary and huge files skipped, links never
// followed, private files never returned, every cap and its truncation note, a
// bad pattern a tool error, paths from Windows refused on any platform. Nothing
// here touches the real project or the user's data: each test builds its own
// folder under the OS temp directory and removes it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createProjectSearch, LIMITS } = require("../scripts/project-search.cjs");

// A project built from { "relative/path": contents }, and links [name, target, type]; `made` names the links this account could create.
async function project(files, fn, { links = [] } = {}) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temp, "mefi-psearch-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      const file = path.join(root, ...name.split("/"));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    }
    const made = [];
    for (const [name, target, type] of links) {
      try { await symlink(target, path.join(root, ...name.split("/")), type); made.push(name); } catch { /* an account that cannot make links */ }
    }
    await fn({ root, tools: createProjectSearch(), made, make: (options) => createProjectSearch(options) });
  } finally { assert.equal(path.dirname(root), temp); await rm(root, { recursive: true, force: true }); }
}
const names = (list) => list.entries.map((entry) => entry.path);
const files = (result) => result.results.map((group) => group.file);
const seen = (result) => JSON.stringify(result);
const REFUSED = /not allowed|leaves the project|Give a path inside|too long|does not exist|is a file/;

const APP = { "README.md": "# App\nA small app.\n", "package.json": '{"name":"app"}', "src/app.js": "export const app = 1;\n", "src/util.js": "export const util = 2;\n", "src/lib/deep.js": "export const deep = 3;\n", "docs/guide.md": "The guide.\n" };

// ---- project_list -----------------------------------------------------------------------

test("a listing shows folders first, then files, each in name order, with sizes; depth reaches further; nothing hidden is named", () => project({ ...APP, "Zebra.txt": "zz", "apple.txt": "a", ".env": "SECRET=1", ".hidden/x.txt": "x" }, async ({ root, tools }) => {
  const top = await tools.list(root, {});
  assert.deepEqual(names(top), ["docs", "src", "apple.txt", "package.json", "README.md", "Zebra.txt"]);
  assert.deepEqual(top.entries.filter((entry) => entry.type === "dir").map((entry) => entry.path), ["docs", "src"]);
  assert.equal(top.entries.find((entry) => entry.path === "Zebra.txt").bytes, 2);
  assert.equal(top.path, "."); assert.equal(top.shown, 6); assert.equal(top.truncated, undefined); assert.equal(top.note, undefined);
  assert.equal(top.skipped.private, 2, "the two hidden entries are counted, never named");
  assert.doesNotMatch(seen(top), /\.env|\.hidden|SECRET/);
  const deep = await tools.list(root, { depth: 2 });
  assert.deepEqual(names(deep).filter((entry) => entry.startsWith("src")), ["src", "src/lib", "src/app.js", "src/util.js"]);
  assert.equal(names(deep).includes("src/lib/deep.js"), false);
  assert.ok(names(await tools.list(root, { depth: 3 })).includes("src/lib/deep.js"));
  assert.deepEqual(names(await tools.list(root, { path: "src" })), ["src/lib", "src/app.js", "src/util.js"]);
  assert.equal((await tools.list(root, { path: "src" })).path, "src");
  assert.deepEqual(names(await tools.list(root, { path: "src\\lib/" })), ["src/lib/deep.js"], "either slash, a trailing one too");
  assert.deepEqual(names(await tools.list(root, { path: "./src//lib" })), ["src/lib/deep.js"]);
  assert.deepEqual(names(await tools.list(root, { depth: "2", limit: "3" })), ["docs", "docs/guide.md", "src"], "numbers written as text are read");
}));

test("binary files are marked, by name or by what is inside; links are shown and never followed", (t) => project({ "a.txt": "text", "logo.png": "not really a png", "blob.dat": Buffer.from([1, 2, 0, 3]), "empty.txt": "", "src/x.js": "x" }, async ({ root, tools, made }) => {
  const list = await tools.list(root, {});
  const type = (name) => list.entries.find((entry) => entry.path === name)?.type;
  assert.equal(type("a.txt"), "file"); assert.equal(type("logo.png"), "binary", "by its extension");
  assert.equal(type("blob.dat"), "binary", "by a NUL byte in its first bytes"); assert.equal(type("empty.txt"), "file");
  assert.equal(list.entries.find((entry) => entry.path === "empty.txt").bytes, 0);
  if (made.length < 2) return t.skip("this account cannot create symlinks");
  assert.equal(type("ln-file"), "link"); assert.equal(type("ln-dir"), "link");
  assert.equal(list.entries.find((entry) => entry.path === "ln-file").bytes, undefined);
  assert.equal(names(await tools.list(root, { depth: 3 })).some((entry) => entry.startsWith("ln-dir/")), false, "a linked folder is never entered");
}, { links: [["ln-file", "a.txt"], ["ln-dir", "src", "junction"]] }));

test("what .gitignore and the built-in rules leave out stays out, of a listing and a search", () => project({
  ".gitignore": "*.log\nbuild-out/\n/scratch\n!keep.log\n",
  ".git/info/exclude": "local-notes.txt\n",
  "src/.gitignore": "generated/\n*.tmp\n!src-keep.tmp\n",
  "src/app.js": "needle app", "src/app.log": "needle log", "src/keep.log": "needle keep", "src/generated/out.js": "needle generated", "src/x.tmp": "needle tmp", "src/src-keep.tmp": "needle kept tmp",
  "build-out/a.js": "needle build-out", "scratch/a.js": "needle scratch", "lib/scratch/a.js": "needle nested scratch", "local-notes.txt": "needle notes",
  "node_modules/dep/index.js": "needle dep", "dist/bundle.js": "needle dist", "data/store.json": "needle data", "build/o.js": "needle build", "coverage/lcov.txt": "needle coverage", "vendor/v.js": "needle vendor",
  "lib/build/keep.js": "needle lib build", "lib/cache/c.js": "needle lib cache",
}, async ({ root, tools }) => {
  const listing = await tools.list(root, { depth: 3, limit: 300 });
  assert.deepEqual(names(listing), ["lib", "lib/build", "lib/build/keep.js", "lib/cache", "lib/cache/c.js", "lib/scratch", "lib/scratch/a.js", "src", "src/app.js", "src/keep.log", "src/src-keep.tmp"]);
  assert.ok(listing.skipped.ignored >= 6, "what the rules left out is counted");
  const found = await tools.search(root, { query: "needle" });
  assert.deepEqual(files(found), ["lib/build/keep.js", "lib/cache/c.js", "lib/scratch/a.js", "src/app.js", "src/keep.log", "src/src-keep.tmp"]);
  // A lower folder called build or cache is a source folder; only the top ones are noise. A .gitignore's own words decide the rest.
  assert.equal(found.matches, 6);
}));

test("an ignored folder can still be named, and only the rules below it apply", () => project({ ".gitignore": "logs-here/\n", "logs-here/a.txt": "needle in ignored", "logs-here/b.tmp": "needle b", "logs-here/.gitignore": "*.tmp\n" }, async ({ root, tools }) => {
  assert.deepEqual(names(await tools.list(root, {})), []);
  assert.deepEqual(names(await tools.list(root, { path: "logs-here" })), ["logs-here/a.txt"]);
  assert.deepEqual(files(await tools.search(root, { query: "needle", path: "logs-here" })), ["logs-here/a.txt"]);
  assert.equal((await tools.search(root, { query: "needle" })).matches, 0);
}));

test("a path outside the project, or private, is refused, in every spelling, on any platform", () => project({ ...APP, ".env": "SECRET=1", "data/store.json": "{}", ".mefi/worktrees/run1/src/app.js": "export const app = 1;", "notes/secrets.yaml": "k: v" }, async ({ root, tools }) => {
  const bad = ["../outside", "..", "src/../..", "..\\outside", "C:\\Windows", "C:/Windows/win.ini", "\\\\server\\share", "//server/share", "\\\\?\\C:\\x", "/etc", "\\etc", ".env", ".git", ".mefi", ".mefi/worktrees", ".mefi/worktrees/run1", "data", "data/store.json", "node_modules", "dist", "notes/secrets.yaml", "src/app.js:stream", "src/NUL", "src/a?b", "src/*", "x".repeat(600)];
  for (const value of bad) {
    await assert.rejects(tools.list(root, { path: value }), REFUSED, `list ${value.slice(0, 30)}`);
    await assert.rejects(tools.search(root, { query: "a", path: value }), REFUSED, `search ${value.slice(0, 30)}`);
  }
  await assert.rejects(tools.list(root, { path: "nope" }), /does not exist/);
  await assert.rejects(tools.search(root, { query: "a", path: "nope/deeper" }), /does not exist/);
  await assert.rejects(tools.list(root, { path: "src/app.js" }), /is a file, not a folder.*project_read/);
  await assert.rejects(tools.list(undefined, {}), /No project is open/);
  await assert.rejects(tools.search("", { query: "a" }), /No project is open/);
  await assert.rejects(tools.list(path.join(root, "gone"), {}), /not available/);
  assert.match((await tools.list(root, {}).then(() => "ok")), /ok/);
}));

test("a link out of the project is never followed: not as a path, not in a walk, not as a folder above the one asked for", (t) => project({ "inside.txt": "needle inside", "src/ok.js": "needle ok" }, async ({ root, tools, made }) => {
  if (made.length < 4) return t.skip("this account cannot create symlinks");
  const outside = await mkdtemp(path.join(await realpath(tmpdir()), "mefi-psearch-out-"));
  try {
    await writeFile(path.join(outside, "secret.txt"), "needle OUTSIDE SECRET"); await mkdir(path.join(outside, "sub")); await writeFile(path.join(outside, "sub", "more.txt"), "needle OUTSIDE MORE");
    for (const [name, kind] of [["escape-file", "file"], ["escape-dir", "junction"], ["src/escape-inner", "junction"]]) await symlink(kind === "file" ? path.join(outside, "secret.txt") : outside, path.join(root, name), kind);
    for (const value of ["escape-file", "escape-dir", "escape-dir/sub", "src/escape-inner", "src/escape-inner/sub"]) {
      await assert.rejects(tools.list(root, { path: value }), REFUSED, `list ${value}`);
      await assert.rejects(tools.search(root, { query: "needle", path: value }), REFUSED, `search ${value}`);
    }
    const found = await tools.search(root, { query: "needle" });
    assert.deepEqual(files(found), ["inside.txt", "src/ok.js"]);
    assert.doesNotMatch(seen(found), /OUTSIDE/);
    assert.doesNotMatch(seen(await tools.list(root, { depth: 3 })), /OUTSIDE|secret\.txt|more\.txt/);
    // Links to places inside the project, a cycle and the folder above are links: named in a listing, never entered.
    const listing = await tools.list(root, { depth: 3, limit: 300 });
    assert.equal(listing.entries.filter((entry) => entry.type === "link").length >= 7, true);
    assert.equal(names(listing).some((entry) => /^ln-[a-z]+\//.test(entry)), false);
  } finally { await rm(outside, { recursive: true, force: true }); }
}, { links: [["ln-inside", "src", "junction"], ["ln-file", "inside.txt"], ["ln-cycle", ".", "junction"], ["ln-parent", "..", "junction"]] }));

test("a link to a private folder inside the project is refused as a path, and its files stay unseen", (t) => project({ "data/store.json": "needle data", "src/ok.js": "needle ok" }, async ({ root, tools, made }) => {
  if (!made.length) return t.skip("this account cannot create symlinks");
  await assert.rejects(tools.list(root, { path: "alias" }), /not allowed/);
  await assert.rejects(tools.search(root, { query: "needle", path: "alias" }), /not allowed/);
  assert.deepEqual(files(await tools.search(root, { query: "needle" })), ["src/ok.js"]);
}, { links: [["alias", "data", "junction"]] }));

test("a task run's worktree copy is not searched or listed, so nothing is found twice; a project opened inside one works", () => project({
  "src/app.js": "needle app", ".mefi/worktrees/run1/src/app.js": "needle app", ".mefi/worktrees/run1/README.md": "needle readme",
}, async ({ root, tools, make }) => {
  assert.deepEqual(files(await tools.search(root, { query: "needle" })), ["src/app.js"]);
  assert.deepEqual(names(await tools.list(root, { depth: 3 })), ["src", "src/app.js"]);
  await assert.rejects(tools.list(root, { path: ".mefi/worktrees/run1/src" }), /not allowed/);
  await assert.rejects(tools.search(root, { query: "needle", path: ".mefi" }), /not allowed/);
  // The worktree as the project: its own files are the project's, and it does not see the main copy.
  const inside = path.join(root, ".mefi", "worktrees", "run1");
  assert.deepEqual(files(await make().search(inside, { query: "needle" })), ["README.md", "src/app.js"]);
  assert.deepEqual(names(await make().list(inside, {})), ["src", "README.md"]);
}));

// ---- project_search ------------------------------------------------------------------------

test("a literal search is case-insensitive unless asked, finds line numbers and short excerpts, and reads either line ending", () => project({
  "a.txt": "first line\r\nThe Needle is here\r\nlast line\r\n", "b.txt": "no match\nneedle lowercase\n\nNEEDLE upper", "c.txt": "nothing",
}, async ({ root, tools }) => {
  const found = await tools.search(root, { query: "needle" });
  assert.equal(found.mode, "literal"); assert.equal(found.query, "needle");
  assert.deepEqual(found.results, [{ file: "a.txt", matches: [{ line: 2, text: "The Needle is here" }] }, { file: "b.txt", matches: [{ line: 2, text: "needle lowercase" }, { line: 4, text: "NEEDLE upper" }] }]);
  assert.equal(found.matches, 3); assert.equal(found.files, 2); assert.equal(found.searched, 3); assert.equal(found.truncated, undefined); assert.equal(found.note, undefined);
  const exact = await tools.search(root, { query: "needle", caseSensitive: true });
  assert.deepEqual(exact.results, [{ file: "b.txt", matches: [{ line: 2, text: "needle lowercase" }] }]);
  await writeFile(path.join(root, "d.txt"), "price (a+b)* [x] $1.00\nother");
  assert.equal((await tools.search(root, { query: "(a+b)* [x] $1.00" })).matches, 1, "a query with regular-expression characters is literal by default");
  assert.equal((await tools.search(root, { query: "a.b" })).matches, 0, "a dot is a dot");
  const none = await tools.search(root, { query: "absent" });
  assert.equal(none.matches, 0); assert.deepEqual(none.results, []);
  assert.match(none.note, /No matches in 4 text files\. \.gitignore rules, hidden and private files, binary files and files over 512 KB are not searched\./);
}));

test("a regular expression, and every way a call can be wrong reported as a tool error, never a crash", () => project({ "a.js": "const alpha = 1;\nfunction beta() {}\nfunction gamma() {}\n", "b.js": "let x = 'function';\n" }, async ({ root, tools }) => {
  const found = await tools.search(root, { query: "function\\s+(beta|gamma)", regex: true });
  assert.equal(found.mode, "regex"); assert.deepEqual(found.results[0].matches.map((match) => match.line), [2, 3]);
  assert.equal((await tools.search(root, { query: "^FUNCTION", regex: true })).matches, 2, "case-insensitive unless asked");
  assert.equal((await tools.search(root, { query: "^FUNCTION", regex: true, caseSensitive: true })).matches, 0);
  for (const [query, words] of [["(", /not a valid regular expression: Unterminated group/], ["[a-", /not a valid regular expression/], ["a{2,1}", /numbers out of order/], ["*x", /not a valid regular expression/], ["x*", /matches an empty line/], ["^", /matches an empty line/], ["(?:)", /matches an empty line/]]) {
    await assert.rejects(tools.search(root, { query, regex: true }), words, query);
  }
  assert.equal((await tools.search(root, { query: "(" })).matches, 2, "the same text as a plain search is just a parenthesis: beta() and gamma()");
  for (const [args, words] of [[{}, /query must be 1 to 300 characters/], [{ query: "" }, /query must be/], [{ query: "   " }, /query must be/], [{ query: 5 }, /query must be/], [{ query: "x".repeat(301) }, /query must be 1 to 300/], [{ query: "two\nlines" }, /query must be one line/], [{ query: "two\r\nlines", regex: true }, /query must be one line/],
    [{ query: "a", regex: "yes" }, /regex must be true or false/], [{ query: "a", caseSensitive: 1 }, /caseSensitive must be true or false/], [{ query: "a", context: 4 }, /context must be a whole number from 0 to 3/], [{ query: "a", context: 1.5 }, /context must be a whole number/],
    [{ query: "a", maxResults: 0 }, /maxResults must be a whole number from 1 to 100/], [{ query: "a", maxResults: 101 }, /maxResults/], [{ query: "a", perFile: 21 }, /perFile must be a whole number from 1 to 20/], [{ query: "a", glob: 5 }, /glob is 1 to 200/i], [{ query: "a", glob: "x".repeat(201) }, /1 to 200 characters/]]) {
    await assert.rejects(tools.search(root, args), words, JSON.stringify(args).slice(0, 40));
  }
  await assert.rejects(tools.list(root, { depth: 4 }), /depth must be a whole number from 1 to 3/);
  await assert.rejects(tools.list(root, { depth: 0 }), /depth must be/); await assert.rejects(tools.list(root, { limit: 301 }), /limit must be a whole number from 1 to 300/); await assert.rejects(tools.list(root, { depth: "deep" }), /depth must be/);
}));

test("a pattern that backtracks without end is stopped, as a tool error, and the next call still works", () => project({ "long.txt": `${"a".repeat(64)}!\n`, "b.txt": "needle\n" }, async ({ root, make }) => {
  const tools = make({ limits: { regexMs: 60 } });
  const started = Date.now();
  await assert.rejects(tools.search(root, { query: "(a+)+$", regex: true }), /too slow to run safely.*simpler pattern, or a literal search/);
  await assert.rejects(tools.search(root, { query: "^(a|aa)+$", regex: true }), /too slow/);
  assert.ok(Date.now() - started < 5000, "each stopped in about the time limit");
  assert.equal((await tools.search(root, { query: "nee+dle", regex: true })).matches, 1, "the tool is not left broken");
}));

test("context lines, a cap per file with more marked, a cap on matches, and lines cut around the match", () => project({
  "a.txt": ["l1", "l2 hit", "l3", "l4", "l5 hit", "l6", "l7 hit", "l8", "l9 hit", "l10"].join("\n"),
  "b.txt": "hit at the very start\nmiddle\nhit at the very end",
  "minified.js": `${"x".repeat(1500)}NEEDLE${"y".repeat(1500)}`,
}, async ({ root, tools }) => {
  const one = await tools.search(root, { query: "hit", path: "b.txt", context: 1 });
  assert.deepEqual(one.results[0].matches, [{ line: 1, text: "hit at the very start", after: ["middle"] }, { line: 3, text: "hit at the very end", before: ["middle"] }]);
  const capped = await tools.search(root, { query: "hit", path: "a.txt", perFile: 2, context: 2 });
  assert.equal(capped.results[0].matches.length, 2); assert.equal(capped.results[0].more, true);
  assert.deepEqual(capped.results[0].matches[0], { line: 2, text: "l2 hit", before: ["l1"], after: ["l3", "l4"] });
  assert.equal((await tools.search(root, { query: "hit", path: "a.txt", perFile: 4 })).results[0].more, undefined, "exactly four is not more");
  const limited = await tools.search(root, { query: "hit", maxResults: 3 });
  assert.equal(limited.matches, 3); assert.equal(limited.truncated, true); assert.match(limited.note, /Stopped at 3 matches\. Narrow the search with path or glob/);
  const text = (await tools.search(root, { query: "needle", path: "minified.js" })).results[0].matches[0].text;
  assert.ok(text.length <= 210 && text.includes("NEEDLE") && text.startsWith("…") && text.endsWith("…"), `the excerpt keeps the match (${text.length})`);
  assert.equal((await tools.search(root, { query: "needle", regex: true, path: "minified.js" })).results[0].matches[0].text.includes("NEEDLE"), true, "and so does a regex");
}));

test("path and glob narrow a search: a folder, a file, a name at any depth, a path with **, braces and exclusions", () => project({
  "src/a.ts": "needle", "src/b.tsx": "needle", "src/deep/c.ts": "needle", "src/deep/c.test.ts": "needle", "lib/d.ts": "needle", "lib/e.js": "needle", "README.md": "needle", "docs/x.md": "needle",
}, async ({ root, tools }) => {
  const of = async (args) => files(await tools.search(root, { query: "needle", ...args }));
  assert.deepEqual(await of({ path: "src" }), ["src/a.ts", "src/b.tsx", "src/deep/c.test.ts", "src/deep/c.ts"]);
  assert.deepEqual(await of({ path: "src/a.ts" }), ["src/a.ts"]);
  assert.deepEqual(await of({ glob: "*.md" }), ["docs/x.md", "README.md"]);
  assert.deepEqual(await of({ glob: "*.{ts,tsx}" }), ["lib/d.ts", "src/a.ts", "src/b.tsx", "src/deep/c.test.ts", "src/deep/c.ts"]);
  assert.deepEqual(await of({ glob: "src/**/*.ts" }), ["src/a.ts", "src/deep/c.test.ts", "src/deep/c.ts"]);
  assert.deepEqual(await of({ glob: ["*.ts", "!*.test.ts"] }), ["lib/d.ts", "src/a.ts", "src/deep/c.ts"]);
  assert.deepEqual(await of({ glob: "lib/*", path: "lib" }), ["lib/d.ts", "lib/e.js"]);
  assert.deepEqual(await of({ glob: "*.py" }), []);
  assert.deepEqual(await of({ path: "src", glob: "*.tsx" }), ["src/b.tsx"]);
  assert.deepEqual(await of({ path: "src/deep", glob: "src/deep/*.ts" }), ["src/deep/c.test.ts", "src/deep/c.ts"], "a glob is checked against the project-relative path");
}));

test("binary, huge and unreadable files are skipped and counted, never returned", (t) => project({
  "text.txt": "needle in text", "image.png": "needle in a png by name", "blob.dat": Buffer.concat([Buffer.from("needle "), Buffer.from([0, 1, 2]), Buffer.from(" binary")]),
  "big.txt": `needle ${"x".repeat(3000)}`, "utf16.txt": Buffer.from("\uFEFFneedle in utf16", "utf16le"),
}, async ({ root, make }) => {
  const tools = make({ limits: { fileBytes: 2000 } });
  const found = await tools.search(root, { query: "needle" });
  assert.deepEqual(files(found), ["text.txt"]);
  assert.deepEqual(found.skipped, { binary: 3, large: 1 }, "a png by name, a NUL in the first bytes, utf-16 (NULs); one file over the limit");
  assert.equal(found.searched, 1);
  if (process.platform === "win32" || process.getuid?.() === 0) return t.skip("unreadable files need an unprivileged POSIX account");
  await chmod(path.join(root, "text.txt"), 0o000);
  assert.equal((await tools.search(root, { query: "needle" })).skipped.unreadable, 1);
  await chmod(path.join(root, "text.txt"), 0o644);
}));

test("private files are never opened, named or returned: keys, stores, .env, secrets by name, and a key under an ordinary name", () => project({
  "src/app.js": "needle app",
  ".env": "needle=ENVSECRET", ".env.local": "needle=LOCALSECRET", "src/.env": "needle=NESTEDSECRET",
  "server.pem": "needle PEMSECRET", "keys/id_rsa": "needle RSASECRET", "keys/cert.p12": "needle P12SECRET", "app.db": "needle DBSECRET", "cache.sqlite": "needle SQLITESECRET",
  "credentials.json": "needle CREDSECRET", "config/secrets.yaml": "needle YAMLSECRET", "db-password.txt": "needle PASSWORDSECRET", "token.json": "needle TOKENSECRET", "settings.json": "needle SETTINGSSECRET",
  "data/store.json": "needle DATASECRET", "dist/bundle.js": "needle DISTSECRET", "node_modules/dep/index.js": "needle DEPSECRET", ".git/config": "needle GITSECRET", ".mefi/x.txt": "needle MEFISECRET",
  "notes.txt": "deploy notes\n-----BEGIN RSA PRIVATE KEY-----\nneedle KEYBODYSECRET\n-----END RSA PRIVATE KEY-----\n",
  "deploy/hint.md": "needle: a key file starts with -----BEGIN PRIVATE KEY----- on a line of its own, which this sentence does not",
}, async ({ root, tools }) => {
  const found = await tools.search(root, { query: "needle" });
  assert.deepEqual(files(found), ["deploy/hint.md", "src/app.js"], "the ordinary files, and a document that only mentions a key header");
  assert.doesNotMatch(seen(found), /SECRET/);
  assert.ok(found.skipped.private >= 15, "what was left out is counted, not named");
  for (const secret of ["ENVSECRET", "LOCALSECRET", "NESTEDSECRET", "PEMSECRET", "RSASECRET", "P12SECRET", "DBSECRET", "SQLITESECRET", "CREDSECRET", "YAMLSECRET", "PASSWORDSECRET", "TOKENSECRET", "SETTINGSSECRET", "DATASECRET", "DISTSECRET", "DEPSECRET", "GITSECRET", "MEFISECRET", "KEYBODYSECRET"]) {
    assert.equal((await tools.search(root, { query: secret })).matches, 0, secret);
    assert.equal((await tools.search(root, { query: secret, regex: true })).matches, 0, `${secret} as a pattern`);
  }
  const listing = await tools.list(root, { depth: 3, limit: 300 });
  assert.deepEqual(names(listing), ["config", "deploy", "deploy/hint.md", "keys", "src", "src/app.js", "notes.txt"], "only what a model may know exists");
  for (const value of [".env", "server.pem", "keys/id_rsa", "keys/cert.p12", "config/secrets.yaml", "data", "credentials.json", "token.json", "notes/../.env"]) await assert.rejects(tools.search(root, { query: "needle", path: value }), REFUSED, value);
  // A key under an ordinary name is found out by its header, counted, and its lines never shown.
  await project({ "notes.txt": "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n", "ok.txt": "b3BlbnNzaC1rZXk=" }, async (inner) => {
    const result = await inner.tools.search(inner.root, { query: "b3BlbnNzaC1rZXk" });
    assert.deepEqual(files(result), ["ok.txt"]); assert.deepEqual(result.skipped, { private: 1 });
  });
}));

test("what is returned is masked: credentials in an ordinary file, and the home folder", () => project({
  "config.js": 'export const settings = { api_key: "sk-abcdefghijklmnopqrstuvwx", password: "hunter2hunter2", token: "ghp_abcdefghijklmnopqrstuv" };',
  "notes.md": "Authorization: Bearer abcdefghijklmnop1234567890\nvisit https://user:pw@example.com/x\nthe folder is C:\\Users\\Jane Doe\\project today",
}, async ({ root, tools }) => {
  const found = await tools.search(root, { query: "e", context: 2 });
  const text = seen(found);
  assert.doesNotMatch(text, /sk-abcdefghijklmnopqrstuvwx|hunter2hunter2|ghp_abcdefghijklmnopqrstuv|abcdefghijklmnop1234567890|user:pw@|Jane Doe/);
  assert.match(text, /\[redacted/); assert.match(text, /~/);
  // A different scrubber can be given; every excerpt and every context line goes through it.
  const upper = createProjectSearch({ scrub: (line) => line.toUpperCase() });
  assert.match(seen(await upper.search(root, { query: "visit", context: 1 })), /"VISIT HTTPS:\/\/USER:PW@EXAMPLE\.COM\/X".*"THE FOLDER IS/);
}));

test("a search stops, and says why, at its limits: files, bytes, entries, time and the size of the answer", () => project(Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`f${String(index).padStart(2, "0")}.txt`, `line ${index}\nneedle ${index}\n`])), async ({ root, make }) => {
  const byFiles = await make({ limits: { files: 7 } }).search(root, { query: "nomatchatall" });
  assert.equal(byFiles.truncated, true); assert.match(byFiles.note, /Stopped after reading 7 files\. Search a subfolder, or give a glob such as \*\.js\./); assert.equal(byFiles.searched, 7);
  const byBytes = await make({ limits: { totalBytes: 100 } }).search(root, { query: "nomatchatall" });
  assert.equal(byBytes.truncated, true); assert.match(byBytes.note, /Stopped after reading a lot of text/);
  const byEntries = await make({ limits: { visit: 10 } }).search(root, { query: "needle" });
  assert.equal(byEntries.truncated, true); assert.match(byEntries.note, /too many entries to walk in one call/); assert.ok(byEntries.matches > 0 && byEntries.matches < 40);
  // Time: a clock that jumps past the deadline once the call has begun.
  let ticks = 0;
  const late = await make({ now: () => (ticks += 1) * 4000 }).search(root, { query: "needle" });
  assert.equal(late.truncated, true); assert.match(late.note, /took too long/); assert.ok(late.matches < 40);
}));

test("no answer is longer than 10,000 characters, however much matches: it stops and says so, the JSON always whole", () => project(Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`src/module-${index}/file-with-a-fairly-long-name-${index}.js`, Array.from({ length: 30 }, (__, line) => `const value${line} = needle(${line}); // a comment about it that runs on a while`).join("\n")])), async ({ root, tools }) => {
  for (const args of [{ query: "needle" }, { query: "needle", maxResults: 100, perFile: 20 }, { query: "needle", maxResults: 100, perFile: 20, context: 3 }, { query: "e", maxResults: 100, context: 3 }, { query: "value\\d+", regex: true, maxResults: 100, perFile: 20, context: 2 }]) {
    const result = await tools.search(root, args);
    const size = JSON.stringify(result).length;
    assert.ok(size <= LIMITS.outputChars, `${JSON.stringify(args)}: ${size} characters`);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result, "whole JSON, nothing cut inside it");
    assert.equal(result.truncated, true); assert.match(result.note, /Stopped/);
    assert.ok(result.matches >= 1 && result.matches <= 100);
  }
}));

test("a listing has its own caps: entries, depth, the answer's size and the walk", () => project(Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`d${index % 5}/a-really-long-file-name-for-the-listing-${String(index).padStart(4, "0")}.txt`, "x"])), async ({ root, tools, make }) => {
  const limited = await tools.list(root, { depth: 2, limit: 12 });
  assert.equal(limited.entries.length, 12); assert.equal(limited.truncated, true); assert.match(limited.note, /Showing the first 12 entries\. List a subfolder, or lower depth, to see the rest\./);
  assert.equal((await tools.list(root, { depth: 1, limit: 12 })).truncated, undefined, "five folders fit");
  const big = await tools.list(root, { depth: 2, limit: 300 });
  assert.ok(JSON.stringify(big).length <= LIMITS.outputChars, `${JSON.stringify(big).length} characters`);
  assert.equal(big.truncated, true); assert.equal(big.shown, big.entries.length); assert.ok(big.shown < 255);
  assert.deepEqual(JSON.parse(JSON.stringify(big)), big);
  const walked = await make({ limits: { visit: 20 } }).list(root, { depth: 3 });
  assert.equal(walked.truncated, true); assert.match(walked.note, /Stopped early after looking at 21 entries/);
  await mkdir(path.join(root, "hollow")); const hollow = await tools.list(root, { path: "hollow" });
  assert.deepEqual(hollow.entries, []); assert.match(hollow.note, /Nothing to show: the folder is empty, or holds only hidden, private or ignored files\./);
}));

test("results come in one fixed order, whatever order the disk gives", () => project({ "Beta/z.txt": "needle", "alpha/x.txt": "needle", "c.txt": "needle", "A.txt": "needle", "Delta.txt": "needle" }, async ({ root, tools }) => {
  const order = ["A.txt", "alpha/x.txt", "Beta/z.txt", "c.txt", "Delta.txt"];
  assert.deepEqual(files(await tools.search(root, { query: "needle" })), order);
  assert.deepEqual(files(await tools.search(root, { query: "needle" })), order, "the same twice");
  assert.deepEqual(names(await tools.list(root, {})), ["alpha", "Beta", "A.txt", "c.txt", "Delta.txt"], "folders first");
}));

test("on Windows case does not matter to the ignore rules and the glob, and elsewhere it does", () => project({ ".gitignore": "Build-Out/\n*.LOG\n", "build-out/a.js": "needle a", "x.log": "needle log", "src/keep.js": "needle keep", "src/KEEP.MD": "needle md" }, async ({ root, make }) => {
  assert.deepEqual(files(await make({ platform: "linux" }).search(root, { query: "needle" })), ["build-out/a.js", "src/keep.js", "src/KEEP.MD", "x.log"]);
  assert.deepEqual(files(await make({ platform: "win32" }).search(root, { query: "needle" })), ["src/keep.js", "src/KEEP.MD"]);
  assert.deepEqual(files(await make({ platform: "win32" }).search(root, { query: "needle", glob: "*.md" })), ["src/KEEP.MD"]);
  assert.deepEqual(files(await make({ platform: "linux" }).search(root, { query: "needle", glob: "*.md" })), []);
}));
