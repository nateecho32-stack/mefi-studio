// The @ picker's project file search, JavaScript (scripts/project-files.cjs
// with gitignore-lite.cjs) against Rust (crates/mefi-core files,
// docs/rust-migration.md stage 2): the same rules, the same tree, the same
// queries must give the same answers. Needs npm run host:core; skips without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { coreBinary } from "../scripts/rust-host.mjs";

const require = createRequire(import.meta.url);
const gitignore = require("../scripts/gitignore-lite.cjs");
const { createProjectFiles } = require("../scripts/project-files.cjs");
const binary = coreBinary();
const skip = existsSync(binary) ? false : `mefi-core is not built (${binary}); run npm run host:core`;
const CONST = (value) => ({ $mefi: "const", value });

function rust(calls) {
  const result = spawnSync(binary, ["repo-batch"], { input: JSON.stringify(calls), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).map((answer) => {
    assert.equal(answer.ok, true, answer.error);
    return answer.value;
  });
}

test("gitignore rules decide the same in both languages", { skip }, () => {
  const files = [
    "*.log\n!keep.log\nbuild/\n/root-only.txt\ndocs/**/draft.md\n**/tmp\nlogs/**\n\\#hash\n\\!bang\nspace\\ \ntrailing   \n",
    "a?c\n[abc]x\n[!z]y\n[a-c]*.js\nsub/*.md\n/sub2/\n*.MD\n# comment\n\n!\n/\n",
    "x/**/y\n**/\n***\n[\nfoo[\na\\*b\nweird[]]\n",
  ];
  const paths = [
    ["a/b/x.log", false], ["keep.log", false], ["build", true], ["build", false], ["root-only.txt", false], ["x/root-only.txt", false],
    ["docs/a/b/draft.md", false], ["docs/draft.md", false], ["tmp", true], ["a/tmp", false], ["logs/a/b", false], ["logs", true],
    ["#hash", false], ["!bang", false], ["space ", false], ["trailing", false], ["abc", false], ["bx", false], ["zy", false], ["ay", false],
    ["b-file.js", false], ["sub/readme.md", false], ["sub/deep/readme.md", false], ["sub2", true], ["README.MD", false], ["x/y", false],
    ["x/a/b/y", false], ["foo[", false], ["a*b", false], ["weird]", false], ["é.log", false], ["日本/x.log", false],
  ];
  const calls = files.map((text) => ({ function: "files.gitignoreVerdicts", args: [text, paths] }));
  const answers = rust(calls);
  files.forEach((text, index) => {
    const match = gitignore.matcher(gitignore.parse(text));
    assert.deepEqual(answers[index], paths.map(([file, isDirectory]) => match(file, isDirectory)), `rules ${index}`);
  });
});

function tree(t) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-parity-files-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const write = (relative, text = "x") => {
    const file = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  for (const relative of [
    "main.js", "Main.test.js", "readme.md", "src/main.js", "src/app/main.js", "src/app/util.mjs", "src/app/deep/a/b/c/d.js",
    "src/zz-last.js", "src/émoji-😀.js", "docs/guide.md", "docs/draft/notes.md", ".hidden/x.js", ".env.local", "data/models.json",
    "dist/out.js", "node_modules/pkg/index.js", "build/b.js", "out/o.js", "coverage/c.js", "__pycache__/p.pyc", "keys/server.pem",
    "secret.key", "credentials.json", "app/settings.json", "logs/today.log", "logs/keep.log", "vendor/lib.js", "vendor/keep/me.js",
    "a/b/c/d/e/f/g/h/deep.js", "UPPER/Case.JS", "mjs-lookalike/m_j_s.txt",
  ]) write(relative);
  write(".gitignore", "*.log\n!keep.log\nvendor/\n");
  write("vendor/.gitignore", "!keep/\n");
  write("docs/.gitignore", "draft/\n");
  try {
    symlinkSync(path.join(root, "src"), path.join(root, "linked"), "junction");
  } catch { /* no junctions here: the rest still compares */ }
  return root;
}

const QUERIES = [{}, { query: "" }, { query: "main" }, { query: "MAIN" }, { query: "src/" }, { query: "./src/app" }, { query: "src\\app" }, { query: "util" }, { query: "mjs" },
  { query: "zz" }, { query: "é" }, { query: "😀" }, { query: "d.js" }, { query: "a/b" }, { query: "nothing-matches-this" }, { query: "case" }, { query: 5 },
  { query: "main", limit: 1 }, { query: "", limit: 25 }, { query: "", limit: 100 }, { query: "js", limit: "x" }, { query: "js", limit: null }, { query: "js", limit: 2.7 }];

test("project file search answers the same", { skip }, async (t) => {
  const root = tree(t);
  const variants = [{}, { limits: { files: 5 } }, { limits: { depth: 2 } }, { limits: { dirs: 2 } }];
  for (const variant of variants) {
    const js = createProjectFiles({ root: () => root, ...variant });
    const expected = [];
    for (const request of QUERIES) expected.push(await js.search(request));
    const answers = rust(QUERIES.map((request) => ({ function: "files.search", args: [{ root: CONST(root), ...variant }, request] })));
    QUERIES.forEach((request, index) => assert.deepEqual(answers[index], expected[index], `${JSON.stringify(variant)} ${JSON.stringify(request)}`));
  }
});

test("resolving named paths answers the same", { skip }, async (t) => {
  const root = tree(t);
  const lists = [
    ["main.js", "./src/main.js", "src\\app\\util.mjs", "../outside.js", "C:/abs.js", "/rooted.js", "data/models.json", "missing.js", "src", "linked/main.js", "main.js", ".hidden/x.js", "src//main.js", "src/./main.js"],
    Array.from({ length: 20 }, (_, index) => (index % 2 ? "main.js" : `nope-${index}.js`)),
    ["readme.md", "docs/guide.md", "src/main.js", "src/app/main.js", "src/app/util.mjs", "src/zz-last.js", "UPPER/Case.JS", "vendor/lib.js", "logs/keep.log", "a/b/c/d/e/f/g/h/deep.js"],
    [],
  ];
  const js = createProjectFiles({ root: () => root });
  const expected = [];
  for (const list of lists) expected.push(await js.resolve(list));
  expected.push(await js.resolve("not-a-list"));
  expected.push(await createProjectFiles({ root: () => null }).resolve(["main.js"]));
  expected.push(await createProjectFiles({ root: () => null }).search({ query: "x" }));
  expected.push(await createProjectFiles({ root: () => path.join(root, "gone") }).search({ query: "x" }));
  const answers = rust([
    ...lists.map((list) => ({ function: "files.resolve", args: [{ root: CONST(root) }, list] })),
    { function: "files.resolve", args: [{ root: CONST(root) }, "not-a-list"] },
    { function: "files.resolve", args: [{ root: CONST(null) }, ["main.js"]] },
    { function: "files.search", args: [{ root: CONST(null) }, { query: "x" }] },
    { function: "files.search", args: [{ root: CONST(path.join(root, "gone")) }, { query: "x" }] },
  ]);
  answers.forEach((answer, index) => assert.deepEqual(answer, expected[index], `case ${index}`));
});
