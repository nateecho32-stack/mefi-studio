// Guard tests for scripts/spec-collisions.mjs — the audit that keeps spec
// basenames unique across tools/ and tests/ and keeps every tools/test_*.py
// contract reachable by the npm-test discovery pattern. Uses a synthetic
// fixture package so failures do not depend on the live tree.
//
// Run: node --test tests/spec_collisions.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSpecs, main } from "../scripts/spec-collisions.mjs";

function makeFixturePackage(files) {
  const root = mkdtempSync(join(tmpdir(), "spec-collisions-"));
  for (const rel of files) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "");
  }
  return root;
}

test("clean spec tree reports no duplicates or orphans", () => {
  const root = makeFixturePackage([
    "tools/test_mefi_studio_eyes.py",
    "tools/test_claim_registry.py",
    "tools/test_mefi_studio_claim_registry.py",
    "tools/benchmark_startup.py",
    "tests/board.test.mjs",
    "tests/fixtures/claim_worker.mjs",
  ]);
  try {
    const { duplicates, orphans, missing } = scanSpecs(root);
    assert.deepEqual(duplicates, []);
    assert.deepEqual(orphans, []);
    assert.deepEqual(missing, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate spec basenames are flagged across directories and case", () => {
  const root = makeFixturePackage([
    "tools/test_mefi_studio_eyes.py",
    "tests/test_mefi_studio_EYES.py",
  ]);
  try {
    const { duplicates } = scanSpecs(root);
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0].base, "test_mefi_studio_eyes");
    assert.deepEqual(duplicates[0].files.sort(), ["tests/test_mefi_studio_EYES.py", "tools/test_mefi_studio_eyes.py"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a directive-named contract without a discovery shim is an orphan", () => {
  const root = makeFixturePackage([
    "tools/test_claim_registry.py",
  ]);
  try {
    const { orphans } = scanSpecs(root);
    assert.deepEqual(orphans, [{ spec: "tools/test_claim_registry.py", shim: "tools/test_mefi_studio_claim_registry.py" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("main exits 1 and prints findings on a dirty tree, 0 on a clean one", () => {
  const dirty = makeFixturePackage([
    "tools/test_mefi_studio_a.py",
    "tests/test_mefi_studio_a.py",
    "tools/test_orphan_contract.py",
  ]);
  try {
    const seen = [];
    const original = console.error;
    console.error = (...parts) => seen.push(parts.join(" "));
    let code;
    try {
      code = main(["--package", dirty]);
    } finally {
      console.error = original;
    }
    assert.equal(code, 1);
    assert.ok(seen.some((line) => line.includes('DUPLICATE spec basename "test_mefi_studio_a"')));
    assert.ok(seen.some((line) => line.includes("ORPHAN spec") && line.includes("tools/test_orphan_contract.py")));
  } finally {
    rmSync(dirty, { recursive: true, force: true });
  }

  const clean = makeFixturePackage(["tools/test_mefi_studio_ok.py", "tests/placeHolder.test.mjs"]);
  try {
    const seen = [];
    const original = console.log;
    console.log = (...parts) => seen.push(parts.join(" "));
    let code;
    try {
      code = main(["--package", clean]);
    } finally {
      console.log = original;
    }
    assert.equal(code, 0);
    assert.ok(seen.some((line) => line.includes("spec-collisions: ok")));
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
});
