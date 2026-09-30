import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The small .gitignore reader the file picker uses (scripts/gitignore-lite.cjs): a table of patterns
// against paths, and, where git is installed, the same verdicts checked against git itself.
const require = createRequire(import.meta.url);
const ignore = require("../scripts/gitignore-lite.cjs");

const verdict = (text, relative, isDirectory = false) => ignore.matcher(ignore.parse(text))(relative, isDirectory);

test("blank lines, comments and what cannot be understood make no rule", () => {
  assert.deepEqual(ignore.parse("\n\n# a comment\n   \n#another\n"), []);
  assert.equal(ignore.rule("/"), null);
  assert.equal(ignore.rule("!"), null);
  assert.equal(ignore.rule("   "), null);
  assert.equal(ignore.parse("*.log\r\nbuild/\r\n").length, 2, "CRLF is read");
  assert.equal(ignore.parse(undefined).length, 0);
});

test("the patterns a .gitignore is mostly made of decide as git does", () => {
  const table = [
    // [.gitignore text, path, isDirectory, expected verdict]
    ["*.log", "debug.log", false, true],
    ["*.log", "deep/er/debug.log", false, true],
    ["*.log", "debug.txt", false, null],
    ["*.log\n!keep.log", "keep.log", false, false],
    ["*.log\n!keep.log", "drop.log", false, true],
    ["!keep.log\n*.log", "keep.log", false, true],
    ["build/", "build", true, true],
    ["build/", "build", false, null],
    ["build/", "src/build", true, true],
    ["/build", "build", true, true],
    ["/build", "src/build", true, null],
    ["/build", "build", false, true],
    ["docs/*.md", "docs/a.md", false, true],
    ["docs/*.md", "docs/sub/a.md", false, null],
    ["docs/*.md", "a/docs/a.md", false, null],
    ["**/cache", "cache", true, true],
    ["**/cache", "a/b/cache", true, true],
    ["a/**/b", "a/b", false, true],
    ["a/**/b", "a/x/y/b", false, true],
    ["a/**/b", "b", false, null],
    ["logs/**", "logs/a.txt", false, true],
    ["logs/**", "logs/deep/a.txt", false, true],
    ["logs/**", "logs", true, null],
    ["file?.txt", "file1.txt", false, true],
    ["file?.txt", "file12.txt", false, null],
    ["file?.txt", "file/.txt", false, null],
    ["[abc].txt", "a.txt", false, true],
    ["[abc].txt", "d.txt", false, null],
    ["[!abc].txt", "d.txt", false, true],
    ["[!abc].txt", "a.txt", false, null],
    ["a*b", "axxb", false, true],
    ["a*b", "a/b", false, null],
    ["\\#hash", "#hash", false, true],
    ["\\!bang", "!bang", false, true],
    ["trailing   ", "trailing", false, true],
    ["name with space ", "name with space", false, true],
    ["*.tmp\n!*.tmp/", "x.tmp", false, true],
    ["node_modules", "node_modules", true, true],
    ["node_modules", "a/node_modules", true, true],
    ["vendor/*/cache", "vendor/x/cache", true, true],
    ["vendor/*/cache", "vendor/x/y/cache", true, null],
    ["*.o\n*.a\n", "lib.a", false, true],
  ];
  for (const [text, relative, directory, expected] of table) assert.equal(verdict(text, relative, directory), expected, `${JSON.stringify(text)} on ${relative}${directory ? "/" : ""}`);
});

// Git as the oracle, on a real repository: every path of a small tree, asked of `git check-ignore`, and of this reader the
// way the picker asks (a folder that is ignored hides everything in it).
const git = spawnSync("git", ["--version"], { encoding: "utf8" });
test("the same verdicts as git on a real tree", { skip: git.status !== 0 && "git is not installed" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-gitignore-"));
  try {
    // No global or system config, named the way the other git suites name it: a file that is not there (git for Windows
    // does not take the device name os.devNull as a config path).
    const run = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, ".no-global-config"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root } });
    const started = run("init", "-q");
    assert.equal(started.status, 0, `git init answered ${started.status}: ${started.stderr || started.error}`);
    const rootIgnore = "# build output\n*.log\n!keep.log\n/dist/\nbuild/\n**/cache\ndocs/*.md\n!docs/readme.md\nlogs/**\n*.tmp\n/only-here.txt\nsrc/**/generated\n";
    const nested = "*.gen.js\n!wanted.gen.js\n/local-only.txt\n";
    const files = {
      ".gitignore": rootIgnore, "a.js": "", "debug.log": "", "keep.log": "", "dist/x.js": "", "build/out.js": "", "src/build/o.js": "", "src/app.js": "", "src/generated/g.js": "", "src/deep/generated/h.js": "",
      "docs/a.md": "", "docs/readme.md": "", "docs/sub/b.md": "", "logs/one.txt": "", "logs/deep/two.txt": "", "x/cache/c.txt": "", "cache/d.txt": "", "t.tmp": "", "only-here.txt": "", "sub/only-here.txt": "",
      "pkg/.gitignore": nested, "pkg/a.gen.js": "", "pkg/wanted.gen.js": "", "pkg/local-only.txt": "", "pkg/deeper/local-only.txt": "", "pkg/deeper/b.gen.js": "", "pkg/plain.js": "",
    };
    for (const [file, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text); }
    const rules = new Map([["", ignore.matcher(ignore.parse(rootIgnore))], ["pkg", ignore.matcher(ignore.parse(nested))]]);
    // The picker's way: each folder on the way down is asked first; an ignored one ends the question.
    const ignoredByUs = (relative) => {
      const parts = relative.split("/");
      for (let depth = 1; depth <= parts.length; depth += 1) {
        const at = parts.slice(0, depth).join("/"), isDirectory = depth < parts.length;
        let answer = null;
        for (const [base, match] of rules) {
          const inside = base ? (at.startsWith(`${base}/`) ? at.slice(base.length + 1) : null) : at;
          if (inside === null) continue;
          const one = match(inside, isDirectory);
          if (one !== null) answer = one;
        }
        if (answer === true) return true;
      }
      return false;
    };
    const mismatches = [];
    for (const file of Object.keys(files).filter((name) => !name.endsWith(".gitignore"))) {
      const theirs = run("check-ignore", "-q", "--no-index", "--", file).status === 0;
      if (theirs !== ignoredByUs(file)) mismatches.push(`${file}: git says ${theirs ? "ignored" : "kept"}`);
    }
    assert.deepEqual(mismatches, []);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
});
