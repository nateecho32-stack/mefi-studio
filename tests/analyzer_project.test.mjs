import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyzeProject, verifyIdea, PROJECT_LIMITS } from "../scripts/analyzer.mjs";

const execute = promisify(execFile);
async function fixture(t, entries = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "studio-analyzer-project-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(Object.entries(entries).map(async ([file, text]) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }));
  return root;
}

test("project inventory discovers arbitrary source directories and declared checks without running them", async (t) => {
  const root = await fixture(t, {
    "modules/frost/main.ts": "export function freezeInventory() { return true; }\n",
    "modules/frost/main.test.ts": "test('freezes inventory', () => {});\n",
    "README.md": "# Frost\nInventory work.\n",
    "package.json": JSON.stringify({ packageManager: "pnpm@10", scripts: { test: "node create-unwanted-file.js", lint: "eslint .", start: "node main.js" } }),
  });
  const result = await analyzeProject({ root, projectId: "frost" });
  assert.equal(result.kind, "project");
  assert.equal(result.projectId, "frost");
  assert.equal(result.inventory.files, 4);
  assert.equal(result.inventory.sourceFiles, 1);
  assert.equal(result.inventory.testFiles, 1);
  assert.equal(result.inventory.documents, 1);
  assert.deepEqual(result.inventory.languages, [{ name: "TypeScript", count: 1 }]);
  assert.ok(result.inventory.entryPoints.includes("modules/frost/main.ts"));
  assert.deepEqual(result.inventory.checks, [{ name: "test", command: "pnpm run test" }, { name: "lint", command: "pnpm run lint" }]);
  assert.equal(result.plans.length, 0);
  assert.match(result.startingPoints[0].title, /baseline plan/i);
  assert.match(result.startingPoints[0].firstStep, /main\.ts/);
  assert.ok(result.limitations.some((line) => /no commands or tests were run/.test(line)));
  assert.equal(await readFile(path.join(root, "README.md"), "utf8"), "# Frost\nInventory work.\n");
});

test("empty projects have a concrete first slice and repeatable check", async (t) => {
  const root = await fixture(t);
  const result = await analyzeProject({ root });
  assert.equal(result.inventory.files, 0);
  assert.equal(result.summary.plans, 0);
  assert.match(result.startingPoints[0].title, /first working slice/);
  assert.match(result.startingPoints[0].firstStep, /README/);
  assert.ok(result.startingPoints.every((item) => item.reason && item.firstStep && item.acceptance));
  assert.ok(result.startingPoints.some((item) => /baseline check/.test(item.title)));
});

test("old plans are compared with source lines, missing paths and checked claims remain unverified", async (t) => {
  const root = await fixture(t, {
    "archive/iterations/plans/winter.md": "# Winter roadmap\n- [ ] Add frost cache via modules/cache.ts\n- [x] Deliver moonwalk propulsion in modules/missing.ts\n- [x] Add gravity anchoring\n- [x] Frost cache complete\n",
    "modules/cache.ts": "export function frostCache() { return new Map(); }\n",
  });
  const result = await analyzeProject({ root });
  const plan = result.plans[0];
  assert.equal(plan.source, "archive/iterations/plans/winter.md");
  assert.equal(plan.status, "missing-reference");
  assert.equal(plan.items[0].status, "related");
  assert.deepEqual(plan.items[0].evidence[0], { file: "modules/cache.ts", line: 1, snippet: "export function frostCache() { return new Map(); }" });
  assert.deepEqual(plan.items[0].references[0], { ref: "modules/cache.ts", found: true, status: "present", file: "modules/cache.ts" });
  assert.equal(plan.items[1].status, "missing-reference");
  assert.equal(plan.items[1].claimedComplete, true);
  assert.equal(plan.items[2].status, "unverified");
  assert.equal(plan.items[3].status, "related");
  assert.equal(result.summary.claimedComplete, 3);
  assert.equal(result.summary.missingReferences, 1);
  assert.match(result.startingPoints[0].title, /Reconcile missing paths/);
  assert.ok(result.startingPoints.some((point) => /^Verify completed claim: Frost cache/.test(point.title)));
  assert.ok(result.startingPoints[0].evidence.some((hit) => hit.file === plan.source && hit.line === 3));
  assert.ok(plan.items.every((item) => !["implemented", "verified", "done"].includes(item.status)));
});

test("documentation, comments and test fixtures cannot count as implementation evidence", async (t) => {
  const root = await fixture(t, {
    "TODO.md": "# Intent\n- [x] Add teleportation capability\n",
    "docs/teleportation.md": "Teleportation capability is already implemented.\n",
    "docs/example.js": "function teleportationCapability() {}\n",
    "qa/fixtures/teleportation.js": "function teleportationCapability() {}\n",
    "test/teleportation.spec.js": "test('teleportation capability', () => {});\n",
    "source/main.js": "// teleportation capability exists here\nexport const current = 'baseline';\n",
  });
  const result = await analyzeProject({ root });
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].items[0].status, "unverified");
  assert.deepEqual(result.plans[0].items[0].evidence, []);
  assert.equal(result.inventory.sourceFiles, 1);
  assert.equal(result.inventory.testFiles, 2);
});

test("roadmap headings and prose designs are found, code-fence checklist examples are ignored", async (t) => {
  const root = await fixture(t, {
    "README.md": "# Product\n## Roadmap\n- [ ] Add orbital navigation\n```md\n- [x] Fake completion\n```\n",
    "research/design.txt": "Orbital navigation needs a keyboard-driven prototype.\n",
    "spec.md": "# Empty specification\n",
    "tests/basic.test.js": "test('baseline', () => {});",
  });
  const result = await analyzeProject({ root });
  assert.equal(result.plans.length, 3);
  const readme = result.plans.find((plan) => plan.source === "README.md");
  assert.equal(readme.items.length, 1);
  assert.equal(readme.items[0].line, 3);
  assert.ok(result.plans.find((plan) => plan.source === "research/design.txt").items[0].text.includes("Orbital"));
  const empty = await fixture(t, { "spec.md": "# Empty specification\n", "tests/basic.test.js": "test('baseline', () => {});" });
  assert.ok((await analyzeProject({ root: empty })).startingPoints.length > 0);
});

test("saved Studio tasks retain project scope and converted status never claims implementation", async (t) => {
  const root = await fixture(t, { "core/main.py": "def frost_cache():\n    return {}\n" });
  const result = await analyzeProject({ root, projectId: "selected", plans: [
    { id: "old", projectId: "other", title: "Other project secret plan", destination: "Do not include this" },
    { id: "winter", projectId: "selected", title: "Frost", status: "converted", destination: "Reliable cache", outOfScope: "No cloud synchronization", spec: { text: "Cache specification", tasks: [{ title: "Frost cache", prompt: "Add frost cache expiration", acceptance: ["Frost cache persists data after restart", "core/cache.test.py passes"] }] }, questions: [{ status: "open", question: "What expiration duration?" }, { status: "resolved", question: "Storage engine?", resolution: "Use SQLite" }] },
  ] });
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].sourceType, "studio");
  assert.equal(result.plans[0].source, "Studio plan");
  assert.equal(result.plans[0].sourceStatus, "converted");
  assert.equal(result.plans[0].items[0].claimedComplete, false);
  assert.equal(result.plans[0].items[0].status, "missing-reference");
  assert.ok(result.plans[0].items[0].evidence.some((hit) => hit.file === "core/main.py"));
  assert.equal(result.plans[0].items[0].acceptance[1], "core/cache.test.py passes");
  assert.equal(result.plans[0].context.outOfScope, "No cloud synchronization");
  assert.deepEqual(result.plans[0].context.decisions, [{ question: "Storage engine?", resolution: "Use SQLite" }]);
  assert.ok(result.plans[0].items.some((item) => item.text === "Cache specification"));
  assert.match(result.startingPoints[0].firstStep, /recorded decisions and scope boundaries/);
  assert.match(result.startingPoints[0].acceptance, /persists data after restart/);
  assert.ok(result.plans[0].items.some((item) => item.decision));
  assert.ok(!JSON.stringify(result).includes("Other project secret plan"));
  assert.ok(result.limitations.some((line) => /another project/.test(line)));
});

test("references are confined to the selected project including traversal and Studio filenames", async (t) => {
  const root = await fixture(t, {
    "docs/plan.md": "- [ ] Use ../core/cache.js and scripts/analyzer.mjs\n- [ ] Read ../../outside.js and C:\\external\\private.js and /outside.js\n- [ ] Follow https://example.com/external.js\n- [ ] Add ../core/missing.js\n- [ ] Build a Node.js backend with Next.js\n",
    "core/cache.js": "export const cache = {};\n",
  });
  const result = await analyzeProject({ root });
  const refs = result.plans[0].items.flatMap((item) => item.references);
  assert.equal(refs.find((ref) => ref.ref === "../core/cache.js").found, true);
  assert.equal(refs.find((ref) => ref.ref === "scripts/analyzer.mjs").status, "missing");
  for (const ref of ["../../outside.js", "C:\\external\\private.js", "/outside.js"]) assert.equal(refs.find((item) => item.ref === ref)?.status, "outside-project", ref);
  assert.ok(!refs.some((ref) => ref.ref.includes("example.com")));
  assert.equal(refs.find((ref) => ref.ref === "../core/missing.js").status, "missing");
  assert.ok(!refs.some((ref) => ["Node.js", "Next.js"].includes(ref.ref)));
});

test("excluded state, secrets and dependency trees are not scanned or reported as missing code", async (t) => {
  const root = await fixture(t, {
    "plan.md": "- [x] Add nebulizer capability in data/private.js and node_modules/pkg.js\n- [ ] Nebulizer secret token=top-secret-value\n",
    "data/private.js": "function nebulizerCapability() {}\n",
    "node_modules/pkg.js": "function nebulizerCapability() {}\n",
    ".hidden/plan.md": "- [x] Hidden nebulizer secret\n",
    "secrets/plan.md": "- [x] Password-only plan\n",
    "api-key.json": '{"key":"really-private"}',
    "dist/main.js": "function nebulizerCapability() {}\n",
    "src/main.js": 'export const nebulizer = {"apiKey": "a-private-key-value"};\n',
  });
  const result = await analyzeProject({ root });
  assert.equal(result.inventory.files, 2);
  assert.equal(result.plans.length, 1);
  assert.ok(result.plans[0].items[0].references.every((ref) => ref.status === "excluded"));
  assert.equal(result.summary.missingReferences, 0);
  const serialized = JSON.stringify(result);
  for (const secret of ["top-secret-value", "a-private-key-value", "really-private", "Hidden nebulizer secret", "Password-only plan"]) assert.ok(!serialized.includes(secret), secret);
  assert.ok(serialized.includes("[redacted]"));
});

test("symlink and junction targets never become evidence or a present reference", async (t) => {
  const outside = await fixture(t, { "escape.js": "export function warpDrive() {}\n" });
  const root = await fixture(t, { "plan.md": "- [x] Warp drive in linked/escape.js\n" });
  try { await symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) { t.skip("Symlink creation is unavailable on this host."); return; } throw error; }
  const result = await analyzeProject({ root });
  assert.equal(result.inventory.files, 1);
  assert.deepEqual(result.plans[0].items[0].evidence, []);
  assert.equal(result.plans[0].items[0].references[0].status, "excluded");
  assert.ok(result.limitations.some((line) => /Symbolic links/.test(line)));
});

test("large file and plan bounds disclose omissions and preserve saved plans", async (t) => {
  const entries = { "src/giant.js": "x".repeat(PROJECT_LIMITS.fileBytes + 1) };
  for (let i = 0; i < PROJECT_LIMITS.plans + 2; i += 1) entries[`docs/plans/plan-${i}.md`] = Array.from({ length: PROJECT_LIMITS.itemsPerPlan + 3 }, (_, j) => `- [ ] Orbital task ${j}`).join("\n");
  const root = await fixture(t, entries);
  const result = await analyzeProject({ root, projectId: "selected", plans: [{ id: "saved", projectId: "selected", title: "Keep this saved plan", destination: "Start a comet journey" }] });
  assert.equal(result.plans.length, PROJECT_LIMITS.plans);
  assert.ok(result.plans.some((plan) => plan.sourceType === "studio"));
  assert.equal(result.summary.items, PROJECT_LIMITS.items);
  assert.ok(result.plans.every((plan) => plan.items.length <= PROJECT_LIMITS.itemsPerPlan));
  assert.ok(result.limitations.some((line) => /larger than/.test(line)));
  assert.ok(result.limitations.some((line) => /Plan discovery truncated/.test(line)));
  assert.ok(result.limitations.some((line) => /Plan items were truncated/.test(line)));
  assert.ok(result.limitations.some((line) => /Combined plan items truncated/.test(line)));
});

test("a deep bulk tree cannot starve the plan documents at the top of the project", async (t) => {
  const entries = { "PLAN.md": "# PLAN\n- [ ] Add the next orbit\n", "README.md": "# Comet\n" };
  for (let index = 0; index < PROJECT_LIMITS.files + 3; index += 1) entries[`deep/level-${index % 4}/file-${index}.js`] = "export const orbit = true;\n";
  const root = await fixture(t, entries);
  const result = await analyzeProject({ root });
  assert.ok(result.inventory.files <= PROJECT_LIMITS.files);
  assert.equal(result.plans.length, 1, "the root plan is read before the deep files exhaust the file bound");
  assert.equal(result.plans[0].source, "PLAN.md");
  assert.equal(result.plans[0].items[0].text, "Add the next orbit");
  assert.ok(result.limitations.some((line) => /Scan truncated/.test(line)));
});

test("file and directory depth bounds stop scanning and disclose incomplete coverage", async (t) => {
  const entries = {};
  for (let index = 0; index < PROJECT_LIMITS.files + 3; index += 1) entries[`many/file-${index}.js`] = "export const orbit = true;\n";
  entries[`${"deeper/".repeat(PROJECT_LIMITS.depth + 2)}plan.md`] = "- [x] Invisible orbit\n";
  const root = await fixture(t, entries);
  const result = await analyzeProject({ root });
  assert.ok(result.inventory.files <= PROJECT_LIMITS.files);
  assert.ok(result.limitations.some((line) => /Scan truncated/.test(line)));
  const deepRoot = await fixture(t, { [`${"deeper/".repeat(PROJECT_LIMITS.depth + 2)}plan.md`]: "- [x] Invisible orbit\n" });
  const deepResult = await analyzeProject({ root: deepRoot });
  assert.equal(deepResult.plans.length, 0);
  assert.ok(deepResult.limitations.some((line) => /depth limit/.test(line)));
});

test("unavailable roots fail clearly and the project CLI emits the same bounded result", async (t) => {
  const root = await fixture(t, { "README.md": "# Comet\n" });
  await assert.rejects(analyzeProject({ root: path.join(root, "absent") }), /folder is unavailable/);
  await assert.rejects(analyzeProject({ root: path.join(root, "README.md") }), /folder is unavailable/);
  const { stdout } = await execute(process.execPath, [path.resolve("scripts/analyzer.mjs"), "--project", "--root", root]);
  const result = JSON.parse(stdout);
  assert.equal(result.kind, "project");
  assert.equal(result.inventory.files, 1);
  assert.ok(result.startingPoints.length > 0);
});

test("idea keyword coverage across many files never claims implementation", async (t) => {
  const root = await fixture(t, { "scripts/a.js": "function orbit() {}", "scripts/b.js": "function orbit() {}", "scripts/c.js": "function orbit() {}" });
  const result = await verifyIdea("orbital orbit capability", { root });
  assert.equal(result.verdict, "related work exists");
});

// The pre-cache scan, kept verbatim as the reference: every line lowercased
// once per keyword. The live scan lowercases each file once and uses indexOf.
async function referenceIdeaScan(root, keywords) {
  const { readdir, stat } = await import("node:fs/promises");
  const SCAN_DIRS = ["renderer", "scripts", "tests", "game", "render", "ui", "worldgen", "save", "tools", "dev", "docs", ".codex_smoke"];
  const SKIP = /node_modules|[\\/]build[\\/]|[\\/]\.git[\\/]|[\\/]assets[\\/]|[\\/]logs[\\/]/;
  const hits = [];
  const keywordHits = Object.fromEntries(keywords.map((keyword) => [keyword, 0]));
  let scanned = 0;
  async function walk(dir, depth) {
    if (depth > 5 || scanned > 600 || hits.length > 80) return;
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (hits.length > 80 || scanned > 600) return;
      const full = path.join(dir, entry.name);
      if (SKIP.test(full) || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) { await walk(full, depth + 1); continue; }
      if (!/\.(lua|py|js|mjs|cjs|md|json|css|ps1)$/.test(entry.name)) continue;
      const relative = path.relative(root, full).replace(/\\/g, "/");
      for (const keyword of keywords) {
        if (relative.toLowerCase().includes(keyword)) {
          hits.push({ keyword, file: relative, line: 0, snippet: "(file name match)" });
          keywordHits[keyword] += 1;
        }
      }
      try {
        const info = await stat(full);
        if (info.size > 260000) continue;
        const text = await readFile(full, "utf8");
        scanned += 1;
        const lines = text.split("\n");
        for (const keyword of keywords) {
          if (hits.length > 80) break;
          for (let index = 0; index < lines.length; index += 1) {
            if (lines[index].toLowerCase().includes(keyword)) {
              hits.push({ keyword, file: relative, line: index + 1, snippet: lines[index].trim().slice(0, 110) });
              keywordHits[keyword] += 1;
              break;
            }
          }
        }
      } catch {}
    }
  }
  for (const dir of SCAN_DIRS) await walk(path.join(root, dir), 0);
  return { hits, keywordHits, scanned };
}

test("idea scan lowercases each file once and reports exactly the per-line scan's hits", async (t) => {
  const idea = "Orbit comet nebula quasar pulsar meteor galaxy stellar zenith aurora eclipse photon plasma vortex";
  const entries = {
    "scripts/unicode.js": "const x = 'İİİ';  // dotted capital I lowercases to two code units\nfunction ORBIT() {}\n// ΟΔΟΣ\r\nlet Comet = 1;\r\n",
    "scripts/late.js": `${"filler line\n".repeat(400)}the NEBULA sits late\nquasar\n`,
    "game/notes.md": "# Pulsar\n\nMeteor showers and a Galaxy far away.\nStellar ZENITH aurora.\n",
    "tests/orbit-comet.test.mjs": "eclipse photon plasma vortex\n",
    "scripts/big.json": JSON.stringify({ skip: "x".repeat(270000) }),
  };
  for (let index = 0; index < 12; index += 1) {
    entries[`tools/many${index}.js`] = "orbit comet nebula quasar pulsar meteor galaxy stellar zenith aurora eclipse photon plasma vortex\n";
  }
  const root = await fixture(t, entries);
  const expected = await referenceIdeaScan(root, idea.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g));
  for (let pass = 0; pass < 2; pass += 1) {
    const result = await verifyIdea(idea, { root });
    assert.deepEqual(result.keywordHits, expected.keywordHits);
    assert.equal(result.scanned, expected.scanned);
    assert.deepEqual(result.hits, expected.hits.slice(0, 40));
    assert.deepEqual(result.files, [...new Set(expected.hits.map((hit) => hit.file))].slice(0, 20));
  }
  assert.ok(expected.hits.length > 80, "the fixture reaches the hit cap");
  assert.ok(expected.hits.some((hit) => hit.file === "scripts/late.js" && hit.line === 401));
  assert.ok(expected.hits.some((hit) => hit.file === "scripts/unicode.js" && hit.line === 4));

  // A rewritten file is read again, not served from the text cache.
  const lone = await fixture(t, { "scripts/a.js": "nothing here\n" });
  assert.equal((await verifyIdea("zircon", { root: lone })).verdict, "new");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(path.join(lone, "scripts/a.js"), "nothing here\nconst ZIRCON = 1;\n");
  const after = await verifyIdea("zircon", { root: lone });
  assert.deepEqual(after.hits, [{ keyword: "zircon", file: "scripts/a.js", line: 2, snippet: "const ZIRCON = 1;" }]);
});
