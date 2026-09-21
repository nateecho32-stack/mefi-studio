// Guard tests for scripts/check-syntax.mjs, the in-process syntax pass that
// replaced the serial `node --check` chain, and for the check-targets audit
// that treats the pass as covering everything it discovers. Synthetic
// fixture packages only; the live tree is exercised by `npm run check`.
//
// Run: node --test tests/

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { discoverTargets, formatFor, checkSource, checkFiles, checkWithNode, describeError, vmModulesAvailable } from "../scripts/check-syntax.mjs";
import { audit } from "../scripts/check-targets.mjs";

const script = fileURLToPath(new URL("../scripts/check-syntax.mjs", import.meta.url));

function fixture(files, { type = "module", check = "node scripts/check-syntax.mjs", main = "main.cjs" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-syntax-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  const pkg = { name: "fixture", main, scripts: { check } };
  if (type) pkg.type = type;
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg, null, 2));
  return root;
}

const GOOD = {
  "main.cjs": "#!/usr/bin/env node\nconst x = require('node:path');\nif (!x) return;\nmodule.exports = { x };\n",
  "preload.cjs": "module.exports = 1;\n",
  "scripts/a.mjs": "import path from 'node:path';\nexport const a = path.sep;\n",
  "scripts/b.cjs": "with ({}) {}\nmodule.exports = 2;\n",
  "renderer/x.js": "await Promise.resolve();\nexport {};\n",
  "renderer/notes.txt": "not a source file\n",
};
const BAD = {
  "scripts/broken.mjs": "export const = 1;\n",
  "scripts/bad.cjs": "const = 1;\n",
  "renderer/bad.js": "with ({}) {}\n",
};

test("discoverTargets lists the entry, preload and every script and renderer source once, in order", () => {
  const root = fixture(GOOD);
  try {
    assert.deepEqual(discoverTargets(root), ["main.cjs", "preload.cjs", "scripts/a.mjs", "scripts/b.cjs", "renderer/x.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatFor follows the extension, then the nearest package type", () => {
  const moduleRoot = fixture(GOOD);
  const plainRoot = fixture(GOOD, { type: null });
  try {
    assert.equal(formatFor(join(moduleRoot, "main.cjs")), "commonjs");
    assert.equal(formatFor(join(moduleRoot, "scripts/a.mjs")), "module");
    assert.equal(formatFor(join(moduleRoot, "renderer/x.js")), "module");
    assert.equal(formatFor(join(plainRoot, "renderer/x.js")), "detect");
  } finally {
    rmSync(moduleRoot, { recursive: true, force: true });
    rmSync(plainRoot, { recursive: true, force: true });
  }
});

test("CommonJS sources compile through the module wrapper: hashbang, top-level return and sloppy code pass, a broken file reports its line", () => {
  assert.equal(checkSource("main.cjs", GOOD["main.cjs"], "commonjs"), null);
  assert.equal(checkSource("b.cjs", GOOD["scripts/b.cjs"], "commonjs"), null);
  const error = checkSource("bad.cjs", "const ok = 1;\nconst = 1;\n", "commonjs");
  assert.equal(error?.name, "SyntaxError");
  const text = describeError("scripts/bad.cjs", error);
  assert.match(text, /^check-syntax: scripts\/bad\.cjs:2 SyntaxError: /);
});

test("module sources are checked in-process when vm modules are available, otherwise the file is not silently passed", { skip: !vmModulesAvailable() && "run under --experimental-vm-modules to cover the in-process path" }, () => {
  const root = fixture({ ...GOOD, ...BAD });
  try {
    assert.equal(checkSource("a.mjs", GOOD["scripts/a.mjs"], "module"), null);
    assert.equal(checkSource("x.js", GOOD["renderer/x.js"], "module"), null);
    assert.equal(checkSource("bad.js", BAD["renderer/bad.js"], "module")?.name, "SyntaxError", "a with statement is invalid module code");
    assert.equal(checkSource("x.js", GOOD["renderer/x.js"], "detect"), null, "an untyped package tries module syntax after CommonJS");
    const failures = checkFiles(root).map((entry) => entry.file);
    assert.deepEqual(failures, ["scripts/bad.cjs", "scripts/broken.mjs", "renderer/bad.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the command line relaunches with vm modules, passes a clean package and names every broken file", () => {
  const good = fixture(GOOD);
  const bad = fixture({ ...GOOD, ...BAD });
  try {
    const clean = spawnSync(process.execPath, [script, "--package", good], { encoding: "utf8" });
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /check-syntax: ok \(5 files, in-process\)/);
    const broken = spawnSync(process.execPath, [script, "--package", bad], { encoding: "utf8" });
    assert.equal(broken.status, 1);
    for (const file of ["scripts/bad.cjs", "scripts/broken.mjs", "renderer/bad.js"]) assert.match(broken.stderr, new RegExp(`check-syntax: ${file.replace(/[./]/g, "\\$&")}:1 SyntaxError`));
    assert.match(broken.stderr, /3 of 8 files failed/);
    assert.doesNotMatch(broken.stderr, /main\.cjs|scripts\/a\.mjs|renderer\/x\.js/);
  } finally {
    rmSync(good, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test("the node --check fallback pool reaches the same verdicts", async () => {
  const root = fixture({ ...GOOD, ...BAD });
  try {
    const files = discoverTargets(root);
    const failures = await checkWithNode(root, files, 3);
    assert.deepEqual(failures.map((entry) => entry.file).sort(), ["renderer/bad.js", "scripts/bad.cjs", "scripts/broken.mjs"]);
    assert.ok(failures.every((entry) => entry.error.name === "SyntaxError" && entry.error.message.includes("SyntaxError")));
    assert.deepEqual(await checkWithNode(root, files.filter((file) => !(file in BAD)), 2), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a check chain that runs the syntax pass covers every discovered source for the targets audit", () => {
  const root = fixture({ ...GOOD, "scripts/check-syntax.mjs": "export {};\n" });
  try {
    const covered = audit(root, "node scripts/check-targets.mjs && node scripts/check-syntax.mjs");
    assert.deepEqual(covered.unreferenced, []);
    assert.deepEqual(covered.missing, []);
    assert.deepEqual(covered.discovered, ["main.cjs", "preload.cjs", "scripts/a.mjs", "scripts/b.cjs", "scripts/check-syntax.mjs", "renderer/x.js"]);
    const flagged = audit(root, "node --experimental-vm-modules scripts/check-syntax.mjs");
    assert.deepEqual(flagged.unreferenced, []);
    const explicit = audit(root, "node --check main.cjs");
    assert.deepEqual(explicit.discovered, []);
    assert.deepEqual(explicit.unreferenced, ["scripts/a.mjs", "scripts/check-syntax.mjs", "renderer/x.js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("naming the syntax pass without shipping it is a missing target", () => {
  const root = fixture(GOOD);
  try {
    const result = audit(root, "node scripts/check-syntax.mjs");
    assert.deepEqual(result.missing, ["scripts/check-syntax.mjs"]);
    assert.deepEqual(result.unreferenced, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
