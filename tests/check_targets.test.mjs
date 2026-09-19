// Guard tests for scripts/check-targets.mjs — the audit that keeps the
// package.json "check" chain honest in both directions: every referenced
// target must exist on disk, and every scripts/*.mjs + renderer/*.js (plus
// the package "main" entry) must be referenced. Uses a synthetic fixture
// package so failures do not depend on the live tree.
//
// Run: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractCheckTargets, extractNodeRefs, audit, main } from "../scripts/check-targets.mjs";

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
      check: `node --check ${checkTargets.join(" && node --check ")}`,
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
