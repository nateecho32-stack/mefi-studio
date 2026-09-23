// Guard tests for scripts/check-targets.mjs — the audit that keeps the
// package.json "check" chain honest in both directions: every referenced
// target must exist on disk, and every scripts/*.mjs + renderer/*.js (plus
// the package "main" entry) must be referenced. Uses a synthetic fixture
// package so failures do not depend on the live tree.
//
// Run: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCheckTargets, extractNodeRefs, audit, main, findRawControls, indexedFiles, trackedTextFiles } from "../scripts/check-targets.mjs";

function makeFixturePackage(files, checkTargets, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-targets-"));
  for (const rel of files) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "export {};\n");
  }
  const pkg = {
    name: "fixture",
    main: extra.main || "main.cjs",
    scripts: {
      ...(extra.scripts || {}),
      check: extra.check || `node --check ${checkTargets.join(" && node --check ")}`,
    },
  };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
  return root;
}

test("extractCheckTargets pulls every node --check path in order, deduped", () => {
  const targets = extractCheckTargets(
    'node --check main.cjs && node --check scripts/a.mjs && node --check renderer/b.js && node --check scripts/a.mjs'
  );
  assert.deepEqual(targets, ["main.cjs", "scripts/a.mjs", "renderer/b.js"]);
});

test("audit reports a referenced file that is missing on disk", () => {
  const root = makeFixturePackage(
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"],
    ["main.cjs", "scripts/a.mjs", "renderer/b.js", "scripts/gone.mjs"]
  );
  try {
    const { missing, unreferenced } = audit(root, "node --check main.cjs && node --check scripts/gone.mjs");
    assert.deepEqual(missing, ["scripts/gone.mjs"]);
    assert.deepEqual(unreferenced, ["scripts/a.mjs", "renderer/b.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("audit reports sources present on disk but not covered by check", () => {
  const root = makeFixturePackage(
    ["main.cjs", "scripts/a.mjs", "scripts/b.mjs", "renderer/x.js"],
    ["main.cjs", "scripts/a.mjs"]
  );
  try {
    const { missing, unreferenced } = audit(root, "node --check main.cjs && node --check scripts/a.mjs");
    assert.deepEqual(missing, []);
    assert.deepEqual(unreferenced, ["scripts/b.mjs", "renderer/x.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("main entry left out of the chain is flagged as uncovered", () => {
  const root = makeFixturePackage(
    ["entry.cjs", "scripts/a.mjs"],
    ["scripts/a.mjs"],
    { main: "entry.cjs" }
  );
  try {
    const { unreferenced } = audit(root, "node --check scripts/a.mjs");
    assert.ok(unreferenced.includes("entry.cjs"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extractNodeRefs reads node targets from non-check scripts, skipping flags and globs", () => {
  const refs = extractNodeRefs(
    'node --watch server/index.js && node scripts/tool.mjs --offline && node --test "tests/**/*.test.mjs" && cd .. && python -m unittest'
  );
  assert.deepEqual(refs, ["server/index.js", "scripts/tool.mjs"]);
});

test("a stale node path in any non-check script fails the audit", () => {
  const root = makeFixturePackage(
    ["main.cjs", "scripts/a.mjs", "scripts/live.mjs", "renderer/b.js"],
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"],
    { scripts: { icon: "node scripts/live.mjs", data: "node scripts/gone.mjs" } }
  );
  try {
    const { missing, scriptMissing } = audit(root, "node --check main.cjs && node --check scripts/a.mjs && node --check renderer/b.js");
    assert.deepEqual(missing, []);
    assert.deepEqual(scriptMissing, [{ script: "data", path: "scripts/gone.mjs" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stale node path in the check chain itself fails the audit", () => {
  // The modern chain runs `node scripts/<gate>.mjs`, not `node --check`, so
  // the check script's own targets are not owned by extractCheckTargets.
  const files = ["main.cjs", "scripts/a.mjs", "scripts/check-syntax.mjs", "renderer/b.js"];
  const goodCheck = "node scripts/check-syntax.mjs && node scripts/a.mjs";
  const badCheck = "node scripts/check-syntax.mjs && node scripts/gone.mjs";
  const good = makeFixturePackage(files, [], { check: goodCheck });
  const bad = makeFixturePackage(files, [], { check: badCheck });
  try {
    const clean = audit(good, goodCheck);
    assert.deepEqual(clean.missing, []);
    assert.deepEqual(clean.scriptMissing, []);
    assert.equal(main(["--package", good]), 0);

    const stale = audit(bad, badCheck);
    assert.deepEqual(stale.scriptMissing, [{ script: "check", path: "scripts/gone.mjs" }]);
    assert.equal(main(["--package", bad]), 1);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test("main() exits 0 on a fully covered package and 1 on drift", () => {
  const good = makeFixturePackage(
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"],
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"]
  );
  const bad = makeFixturePackage(
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"],
    ["main.cjs", "scripts/a.mjs", "renderer/missing.js"]
  );
  try {
    assert.equal(main(["--package", good]), 0);
    assert.equal(main(["--package", bad]), 1);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test("audit flags a UTF-8 BOM in package.json and main() still parses and fails cleanly", () => {
  const root = makeFixturePackage(
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"],
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"]
  );
  try {
    const pkgPath = join(root, "package.json");
    writeFileSync(pkgPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(pkgPath)]));
    const { bommed } = audit(root, "node --check main.cjs");
    assert.deepEqual(bommed, ["package.json"]);
    assert.equal(main(["--package", root]), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("audit flags a UTF-8 BOM in committed data JSON and passes when BOM-free", () => {
  const root = makeFixturePackage(
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"],
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"]
  );
  try {
    mkdirSync(join(root, "data"), { recursive: true });
    const dataPath = join(root, "data", "models.json");
    writeFileSync(dataPath, "\uFEFF" + JSON.stringify({ schemaVersion: 1 }));
    assert.deepEqual(audit(root, "node --check main.cjs").bommed, ["data/models.json"]);
    writeFileSync(dataPath, JSON.stringify({ schemaVersion: 1 }));
    assert.deepEqual(audit(root, "node --check main.cjs").bommed, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Raw control and bidi characters. This file spells every one as an escape,
// which is the fix the gate asks for; the fixtures get the raw characters.
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

test("findRawControls locates C0, DEL and bidi controls and passes tab, CR, LF and escapes", () => {
  const root = mkdtempSync(join(tmpdir(), "check-targets-raw-"));
  try {
    writeFileSync(join(root, "clean.mjs"), 'const ANSI = /\\u001b\\[/;\r\n\tconst NUL = "\\0";\n');
    writeFileSync(join(root, "esc.mjs"), 'const ok = 1;\nconst ANSI = /\u001b\\[/;\n');
    writeFileSync(join(root, "mixed.md"), "a\u0000b\u007f\n\u202e \u2066\n");
    const found = findRawControls(root, ["clean.mjs", "esc.mjs", "mixed.md", "missing.md"]);
    assert.deepEqual(found, [
      { file: "esc.mjs", line: 2, column: 15, code: "U+001B" },
      { file: "mixed.md", line: 1, column: 2, code: "U+0000" },
      { file: "mixed.md", line: 1, column: 4, code: "U+007F" },
      { file: "mixed.md", line: 2, column: 1, code: "U+202E" },
      { file: "mixed.md", line: 2, column: 3, code: "U+2066" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("indexedFiles reads git index versions 2, 3 and 4 and declines a split index", () => {
  const root = mkdtempSync(join(tmpdir(), "check-targets-index-"));
  const files = ["a.mjs", "deep/nested/path/one.js", "deep/nested/path/two.js", "docs/caf\u00e9.md", "img.png"];
  const read = () => readFileSync(join(root, ".git", "index"));
  try {
    for (const rel of files) {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), rel.endsWith(".png") ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0x1b]) : "export {};\n");
    }
    git(root, "init", "-q");
    git(root, "add", "--", ...files);
    assert.equal(read().readUInt32BE(4), 2);
    assert.deepEqual(indexedFiles(read()).sort(), files);

    // An intent-to-add entry carries extended flags, which moves git to v3.
    writeFileSync(join(root, "later.md"), "# later\n");
    git(root, "add", "-N", "later.md");
    assert.equal(read().readUInt32BE(4), 3);
    assert.deepEqual(indexedFiles(read()).sort(), [...files, "later.md"].sort());

    git(root, "update-index", "--index-version", "4");
    assert.equal(read().readUInt32BE(4), 4);
    assert.deepEqual(indexedFiles(read()).sort(), [...files, "later.md"].sort());

    // A split index keeps most entries in a shared file: ask git instead.
    git(root, "update-index", "--split-index");
    assert.equal(indexedFiles(read()), null);
    assert.deepEqual(trackedTextFiles(root).sort(), ["a.mjs", "deep/nested/path/one.js", "deep/nested/path/two.js", "docs/caf\u00e9.md", "later.md"]);

    assert.equal(indexedFiles(Buffer.from("not an index at all, just some bytes")), null);
    assert.equal(indexedFiles(read().subarray(0, 40)), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("main() fails on a raw control in a tracked file and ignores untracked ones", () => {
  const root = makeFixturePackage(
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"],
    ["main.cjs", "scripts/a.mjs", "renderer/b.js"]
  );
  try {
    git(root, "init", "-q");
    git(root, "add", "-A");
    writeFileSync(join(root, "notes.md"), "untracked \u202e\u0000\n");
    assert.deepEqual(audit(root, "node --check main.cjs").controls, []);
    assert.equal(main(["--package", root]), 0);

    writeFileSync(join(root, "scripts", "a.mjs"), "export {};\nconst NUL = /[\u0000]/;\n");
    assert.deepEqual(audit(root, "node --check main.cjs").controls, [{ file: "scripts/a.mjs", line: 2, column: 15, code: "U+0000" }]);
    assert.equal(main(["--package", root]), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
