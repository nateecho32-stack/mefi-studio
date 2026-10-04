import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The @ picker's file list (scripts/project-files.cjs) against real temporary projects: matching and
// order, what is left out (and that it is exactly what the read tool refuses), .gitignore, the bounds,
// the kept list, links that lead outside, and which mentioned paths are real files.
const require = createRequire(import.meta.url);
const { createProjectFiles, excluded, rank, score, MAX_LIMIT, DEFAULT_LIMIT } = require("../scripts/project-files.cjs");
const agentTools = require("../scripts/agent-tools.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));

async function project(files, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-project-files-"));
  const folder = path.join(root, "project"), outside = path.join(root, "outside");
  await mkdir(folder, { recursive: true }); await mkdir(outside, { recursive: true });
  for (const [file, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(folder, file)), { recursive: true }); await writeFile(path.join(folder, file), text ?? ""); }
  const calls = { readdir: [], lstat: [], readFile: [] };
  const spy = new Proxy(fsp, { get: (target, key) => {
    const real = target[key];
    if (typeof real !== "function" || !["readdir", "lstat", "readFile", "realpath"].includes(key)) return real;
    return (...args) => { if (key in calls) calls[key].push(typeof args[0] === "string" ? path.relative(root, args[0]).replace(/\\/g, "/") : args[0]); return real.apply(target, args); };
  } });
  let clock = 1000;
  const host = createProjectFiles({ root: () => (options.closed ? null : folder), fs: spy, now: () => clock, limits: options.limits });
  return { root, folder, outside, host, calls, tick: (ms) => { clock += ms; }, done: () => rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }) };
}
const names = (result) => plain(result).files.map((file) => file.path);

const TREE = {
  "README.md": "", "package.json": "", "main.cjs": "", "LICENSE": "",
  "src/app.js": "", "src/util.js": "", "src/ui/composer.js": "", "src/ui/composer.css": "", "src/ui/deeply/nested/thing.js": "",
  "docs/readme.md": "", "docs/guide.md": "", "tests/app.test.mjs": "", "notes/meeting notes.md": "",
};

test("a name is found by what it starts with, contains or scatters, and a path by a piece of it", async () => {
  const p = await project(TREE);
  try {
    const ask = async (query, limit) => names(await p.host.search({ query, limit }));
    assert.deepEqual(await ask("composer"), ["src/ui/composer.js", "src/ui/composer.css"], "a name, shortest first");
    assert.deepEqual((await ask("readme")).slice(0, 2), ["README.md", "docs/readme.md"], "case does not matter, and the shallower wins a tie");
    assert.deepEqual(await ask("app.js"), ["src/app.js", "tests/app.test.mjs"], "a real substring first, then a name the letters are scattered through");
    assert.deepEqual((await ask("app")).slice(0, 2), ["src/app.js", "tests/app.test.mjs"], "starts with beats contains");
    assert.deepEqual(await ask("src/ui/comp"), ["src/ui/composer.js", "src/ui/composer.css"], "a piece of a path");
    assert.deepEqual(await ask("ui\\comp"), ["src/ui/composer.js", "src/ui/composer.css"], "a Windows separator is read as a /");
    assert.deepEqual(await ask("cmpsr"), ["src/ui/composer.js", "src/ui/composer.css"], "letters in order");
    assert.deepEqual(await ask("meeting notes"), ["notes/meeting notes.md"], "a space is fine in a name");
    assert.deepEqual(await ask("nothing-like-this"), []);
    assert.equal((await p.host.search({ query: "x" })).ok, true);
    // The empty query is the shallowest files, in a steady order.
    const shallow = await ask("");
    assert.equal(shallow.length, DEFAULT_LIMIT);
    assert.deepEqual(shallow.slice(0, 4), ["LICENSE", "main.cjs", "package.json", "README.md"], "top-level files come first, in name order whatever the case");
    assert.deepEqual(await ask(""), shallow, "the same each time");
  } finally { await p.done(); }
});

test("how many come back is bounded, and a strange query is only ever a string to match", async () => {
  const many = {}; for (let index = 0; index < 60; index += 1) many[`f/file-${String(index).padStart(2, "0")}.js`] = "";
  const p = await project(many);
  try {
    assert.equal(names(await p.host.search({ query: "file" })).length, DEFAULT_LIMIT, "eight by default");
    assert.equal(names(await p.host.search({ query: "file", limit: 500 })).length, MAX_LIMIT, "twenty-five at most");
    assert.equal(names(await p.host.search({ query: "file", limit: 0 })).length, 1, "at least one");
    assert.equal(names(await p.host.search({ query: "file", limit: -5 })).length, 1);
    assert.equal(names(await p.host.search({ query: "file", limit: "3" })).length, 3);
    assert.equal(names(await p.host.search({ query: "file", limit: "lots" })).length, DEFAULT_LIMIT);
    const before = p.calls.readdir.length + p.calls.lstat.length;
    for (const query of ["../../etc/passwd", "/etc/passwd", "C:\\Windows\\system32", ".*", "[", "(", "\\", "a".repeat(5000), "\u0000", "file\nfile", null, undefined, 42, {}, ["x"], "%2e%2e%2f", "..\\..\\", "~", "$HOME", "`id`"]) {
      const result = await p.host.search({ query, limit: 3 });
      assert.equal(result.ok, true, JSON.stringify(query)?.slice(0, 30));
      assert.ok(result.files.length <= 3);
    }
    assert.equal(p.calls.readdir.length + p.calls.lstat.length, before, "no query was ever used as a path: the kept list answered them all");
    assert.deepEqual(names(await p.host.search({ query: "../../etc/passwd" })), [], "and nothing matches a path that goes up");
  } finally { await p.done(); }
});

test("what is left out is exactly what the read tool refuses", async () => {
  const candidates = [
    "ok.txt", "src/ok.js", ".env", ".env.local", ".git/config", ".github/workflows/ci.yml", ".gitignore", "a/.hidden/b.txt", "a/.hidden.txt", ".vscode/settings.json",
    "data/x.txt", "Data/x.txt", "DATA/x.txt", "a/data/x.txt", "data.txt", "mydata/x.txt", "data-old/x.txt", "dist/app.js", "DIST/app.js", "dist-old/app.js", "a/dist/b.js",
    "node_modules/x/y.js", "a/node_modules/x.js", "Node_Modules/x.js", "node_modules2/x.js",
    "secret.pem", "SECRET.PEM", "id.key", "id.KEY", "keys/private.key", "app.db", "APP.DB", "credentials.json", "sub/credentials.json", "Credentials.JSON", "settings.json", "sub/settings.json", "settings.json.bak", "my-settings.json", "notes.db.txt", "x.keychain", "monkey.txt", "pem.txt", "key", "dbfile",
  ];
  const tree = Object.fromEntries(candidates.map((candidate) => [candidate, "small text"]));
  const p = await project(tree);
  try {
    for (const candidate of candidates) {
      let refused = false;
      try { await agentTools.readProject(p.folder, candidate); } catch (error) { refused = error.message === "This project path is not allowed."; if (!refused && !/ENOENT/.test(error.message)) throw error; }
      assert.equal(excluded(candidate), refused, `${candidate}: the picker and the read tool agree`);
    }
    const listed = names(await p.host.search({ query: "", limit: 25 }));
    for (const file of listed) assert.equal(excluded(file), false, `${file} is offered, so it is readable`);
    assert.deepEqual(listed.filter((file) => /\.env|\.git|\.hidden|\.vscode|^data\/|^Data\/|dist\/|node_modules\/|\.pem|\.key$|\.db$|credentials|settings\.json$/i.test(file) && excluded(file)), []);
  } finally { await p.done(); }
});

test(".gitignore files are honoured, nested ones for their own folder, and the built-in skips apply", async () => {
  const p = await project({
    ".gitignore": "*.log\n!keep.log\ngenerated/\n/root-only.txt\n", "a.js": "", "x.log": "", "keep.log": "", "root-only.txt": "", "sub/root-only.txt": "", "generated/g.js": "", "src/generated/h.js": "", "src/real.js": "",
    "pkg/.gitignore": "*.gen.js\n!wanted.gen.js\n/local.txt\n", "pkg/a.gen.js": "", "pkg/wanted.gen.js": "", "pkg/local.txt": "", "pkg/deeper/local.txt": "", "pkg/plain.js": "", "other/a.gen.js": "",
    "build/out.js": "", "out/o.js": "", "coverage/c.js": "", "src/__pycache__/m.pyc": "", "src/build/ok.js": "",
  });
  try {
    const all = new Set(names(await p.host.search({ query: "", limit: 25 })));
    const expected = ["a.js", "keep.log", "sub/root-only.txt", "src/real.js", "pkg/wanted.gen.js", "pkg/deeper/local.txt", "pkg/plain.js", "other/a.gen.js"];
    assert.deepEqual([...all].sort(), expected.sort());
  } finally { await p.done(); }
});

test("a link is never followed or listed, and nothing outside the project can appear", async () => {
  const p = await project({ "real.js": "", "src/inner.js": "" });
  try {
    await writeFile(path.join(p.outside, "secret.txt"), "outside");
    await mkdir(path.join(p.outside, "folder")); await writeFile(path.join(p.outside, "folder", "deep.txt"), "outside");
    let linked = true;
    try { await symlink(p.outside, path.join(p.folder, "out-link"), "junction"); await symlink(path.join(p.outside, "secret.txt"), path.join(p.folder, "secret-link.txt"), "file"); } catch (error) { if (["EPERM", "EACCES"].includes(error.code)) linked = false; else throw error; }
    const listed = names(await p.host.search({ query: "", limit: 25 }));
    assert.deepEqual(listed.sort(), ["real.js", "src/inner.js"], linked ? "neither a linked folder nor a linked file is listed" : "only the project's own files");
    assert.deepEqual(names(await p.host.search({ query: "secret" })), []);
    assert.deepEqual(names(await p.host.search({ query: "deep" })), []);
    assert.deepEqual(await p.host.resolve(["out-link/folder/deep.txt", "secret-link.txt", "real.js"]), ["real.js"], "a mention through a link is not a file of the project");
  } finally { await p.done(); }
});

test("an entry that a filesystem layer reports as a link AND as a file is still not listed", async () => {
  // Node's readdir never does this; a virtual or remote layer might. The picker's rule is: a link is not followed or named.
  const entry = (name, flags) => ({ name, isFile: () => Boolean(flags.file), isDirectory: () => Boolean(flags.dir), isSymbolicLink: () => Boolean(flags.link) });
  const fake = {
    realpath: async (given) => given,
    readdir: async () => [entry("real.js", { file: true }), entry("sneaky.js", { file: true, link: true }), entry("sneaky-folder", { dir: true, link: true })],
    lstat: async () => { throw Object.assign(new Error("none"), { code: "ENOENT" }); }, readFile: async () => "",
  };
  const host = createProjectFiles({ root: () => "/project", fs: fake });
  assert.deepEqual(names(await host.search({ query: "", limit: 25 })), ["real.js"]);
});

test("the walk is bounded, and says when it stopped early", async () => {
  const tree = {}; for (let index = 0; index < 50; index += 1) tree[`d${index % 5}/f${index}.js`] = "";
  const few = await project(tree, { limits: { files: 10 } });
  try {
    const result = plain(await few.host.search({ query: "", limit: 25 }));
    assert.equal(result.truncated, true);
    assert.ok(result.scanned <= 10 + 10, `it stopped near the file bound (${result.scanned})`);
  } finally { await few.done(); }
  const deep = await project({ "a.js": "", "l1/b.js": "", "l1/l2/c.js": "", "l1/l2/l3/d.js": "", "l1/l2/l3/l4/e.js": "" }, { limits: { depth: 3 } });
  try {
    assert.deepEqual(names(await deep.host.search({ query: "", limit: 25 })).sort(), ["a.js", "l1/b.js", "l1/l2/c.js"], "folders below the depth bound are not read");
    assert.equal(plain(await deep.host.search({ query: "x" })).truncated, false, "a bound that cut nothing off is not reported");
  } finally { await deep.done(); }
  const dirs = await project({ "a/x.js": "", "b/y.js": "", "c/z.js": "", "d/w.js": "" }, { limits: { dirs: 2 } });
  try { assert.equal(plain(await dirs.host.search({ query: "" })).truncated, true); } finally { await dirs.done(); }
  // A slow disk: the clock passes the budget after the first folder, and what was read is what is searched.
  const slow = await project({ "top.js": "", "a/x.js": "", "b/y.js": "" }, { limits: { budgetMs: 100 } });
  try {
    const first = slow.host.search({ query: "" });
    slow.tick(500);
    const result = plain(await first);
    assert.equal(result.ok, true);
    assert.ok(result.files.some((file) => file.path === "top.js"));
  } finally { await slow.done(); }
});

test("the list is kept for a while, shared by searches made together, and read again when it is old or forgotten", async () => {
  const p = await project(TREE);
  try {
    const walks = () => p.calls.readdir.length;
    await Promise.all([p.host.search({ query: "app" }), p.host.search({ query: "ui" }), p.host.search({ query: "" })]);
    const first = walks();
    assert.ok(first > 0);
    await p.host.search({ query: "readme" }); await p.host.search({ query: "guide" });
    assert.equal(walks(), first, "typing does not walk the tree again");
    p.tick(14000);
    await p.host.search({ query: "x" });
    assert.equal(walks(), first, "still fresh at 14 s");
    p.tick(2000);
    await p.host.search({ query: "x" });
    assert.equal(walks(), first * 2, "read again after 15 s");
    p.host.forget();
    await p.host.search({ query: "x" });
    assert.equal(walks(), first * 3, "and when it is forgotten");
  } finally { await p.done(); }
});

test("with no project open, a search says so and a resolve names nothing", async () => {
  const p = await project(TREE, { closed: true });
  try {
    assert.deepEqual(plain(await p.host.search({ query: "a" })), { ok: false, error: "Open a project first." });
    assert.deepEqual(await p.host.resolve(["README.md"]), []);
    assert.deepEqual(p.calls.readdir, []);
  } finally { await p.done(); }
});

test("a mentioned path is a file of the project, through real folders, that the picker rules allow; nothing else is referred to", async () => {
  const p = await project({ ...TREE, ".env": "SECRET=1", "data/x.txt": "", "node_modules/a/b.js": "" });
  try {
    await mkdir(path.join(p.folder, "emptydir"), { recursive: true });
    const asked = ["src/app.js", "README.md", "src/missing.js", "emptydir", "src", "../outside/secret.txt", "/etc/passwd", "C:/Windows/win.ini", ".env", "data/x.txt", "node_modules/a/b.js", "src/app.js", "notes/meeting notes.md", "src\\util.js", "a\"b.js", "", null, 7, "x".repeat(400)];
    assert.deepEqual(await p.host.resolve(asked), ["src/app.js", "README.md", "notes/meeting notes.md", "src/util.js"]);
    assert.deepEqual(await p.host.resolve("src/app.js"), [], "it takes a list");
    const repeats = Array.from({ length: 16 }, () => "src/app.js").concat(["README.md"]);
    assert.deepEqual(await p.host.resolve(repeats), ["src/app.js"], "at most sixteen are looked at, and repeats are one");
    assert.deepEqual(await p.host.resolve(repeats.slice(1)), ["src/app.js", "README.md"], "the seventeenth is out of reach, the sixteenth is not");
    const nine = ["README.md", "main.cjs", "package.json", "LICENSE", "src/app.js", "src/util.js", "docs/guide.md", "docs/readme.md", "tests/app.test.mjs"];
    assert.equal((await p.host.resolve(nine)).length, 8, "eight are kept");
  } finally { await p.done(); }
});

test("rank and score order the way the picker promises", () => {
  const entry = (file) => ({ path: file, name: file.split("/").pop(), dir: file.split("/").slice(0, -1).join("/"), depth: file.split("/").length - 1, lname: file.split("/").pop().toLowerCase(), lpath: file.toLowerCase() });
  const entries = ["a/b/readme.md", "readme.md", "README", "docs/readme-old.md", "xreadme", "r/e/a/d/m/e"].map(entry);
  assert.deepEqual(rank(entries, "readme", 6).map((item) => item.path), ["README", "readme.md", "a/b/readme.md", "docs/readme-old.md", "xreadme", "r/e/a/d/m/e"], "the exact name, then names that start with it (the shorter, then the shallower first), then contains, then scattered");
  assert.equal(score(entry("x/readme.md"), "readme.md"), 1000, "an exact name");
  assert.ok(score(entry("x/readme.md"), "read") > score(entry("x/myreadme.md"), "read"), "starts with beats contains");
  assert.ok(score(entry("x/myreadme.md"), "read") > score(entry("x/r-e-a-d.md"), "read"), "contains beats scattered");
  assert.equal(score(entry("x/y.md"), "zzz"), null);
  assert.equal(rank([], "x").length, 0);
});
