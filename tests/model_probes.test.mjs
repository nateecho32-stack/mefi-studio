// Studio's model probes: every scorer against a reply that should pass and one
// that should fail, the code probes run for real in a child node process, and
// the results store keeps its shape and limits. No model is called.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PROBES, PROBE_KINDS, PROBE_MAX_TOKENS, PROBE_RUNS_KEPT, forbiddenCode, jsonOf, normalizeProbeStore, probeFor, probeRunsFor,
  probeSummary, recordProbeRun, runNode, scoreProbe, unfence,
} from "../scripts/model-probes.mjs";

const failed = (result) => result.checks.filter((item) => !item.ok).map((item) => item.name);

test("the probe set covers the owner's task kinds with small fixed prompts", () => {
  assert.deepEqual(PROBES.map((probe) => probe.kind), PROBE_KINDS);
  for (const kind of ["planning", "structuring", "writing", "commits", "tests"]) assert.ok(probeFor(kind), kind);
  for (const probe of PROBES) {
    assert.ok(probe.maxTokens <= 1500 && probe.maxTokens === PROBE_MAX_TOKENS, probe.kind);
    assert.ok(probe.user.length < 3000, `${probe.kind} prompt stays small`);
    assert.doesNotMatch(probe.user + probe.system, /api[_ -]?key|password|secret|token=|C:\\|\/Users\//i, `${probe.kind} carries no secrets or local paths`);
    assert.equal(typeof probe.score, "function");
  }
});

test("reply helpers read fenced and bare replies", () => {
  assert.equal(unfence("```js\nexport const a = 1;\n```"), "export const a = 1;");
  assert.equal(unfence("plain"), "plain");
  assert.deepEqual(jsonOf("Here you go:\n```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(jsonOf("prose {\"a\":2} prose"), { a: 2 });
  assert.equal(jsonOf("[1,2]"), null);
  assert.equal(jsonOf("not json"), null);
  assert.equal(forbiddenCode("import fs from \"node:fs\";"), "fs\"");
  assert.ok(forbiddenCode("const r = await fetch(url)"));
  assert.ok(forbiddenCode("process.env.KEY"));
  assert.ok(forbiddenCode("const cp = require(\"child_process\")"));
  assert.equal(forbiddenCode("export function add(a, b) { return a + b; }"), null);
});

test("planning: steps with files, actions and verification that cover R1-R3", async () => {
  const good = JSON.stringify({ steps: [
    { id: 1, action: "Give each note an optional tags array, defaulting to [] when an old notes.json entry has none", files: ["src/store.mjs"], verify: "node --test test/store.test.mjs loads a notes.json written without tags", covers: ["R3"] },
    { id: 2, action: "Parse --tag in notes add and pass it to the store", files: ["src/cli.mjs", "src/store.mjs"], verify: "run notes add \"x\" --tag work and check notes.json", covers: ["R1"] },
    { id: 3, action: "Filter notes list output by --tag", files: ["src/cli.mjs"], verify: "run notes list --tag work and see only tagged notes", covers: ["R2"] },
    { id: 4, action: "Add tests for the tag round trip and the filter", files: ["test/store.test.mjs", "test/cli.test.mjs"], verify: "npm test passes", covers: ["R1", "R2", "R3"] },
  ] });
  const pass = await scoreProbe("planning", good);
  assert.equal(pass.passed, true, failed(pass).join());
  assert.equal(pass.score, 1);
  const bad = await scoreProbe("planning", JSON.stringify({ steps: [
    { id: 1, action: "Add tags to the database layer", files: ["lib/db.js"], verify: "", covers: ["R1"] },
    { id: 2, action: "Filter by tag", files: ["src/cli.mjs"], verify: "looks right", covers: ["R2"] },
  ] }));
  assert.equal(bad.passed, false);
  assert.deepEqual(failed(bad), ["step-fields", "known-files", "covers-requirements", "concrete-verification", "old-files-load"]);
  assert.ok(bad.score > 0 && bad.score < 0.5);
  assert.equal((await scoreProbe("planning", "I would start by reading the code.")).score, 0);
});

test("structuring: the split modules are imported and their behaviour checked in a child node", async () => {
  const good = JSON.stringify({ modules: [
    { path: "src/dates.mjs", exports: ["fmtDate", "addDays"], code: "export function fmtDate(d) { return d.toISOString().slice(0, 10); }\nexport function addDays(d, n) { const r = new Date(d.getTime()); r.setUTCDate(r.getUTCDate() + n); return r; }" },
    { path: "src/strings.mjs", exports: ["slugify", "titleCase"], code: "export function slugify(s) { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, \"-\").replace(/^-|-$/g, \"\"); }\nexport function titleCase(s) { return String(s).split(\" \").map((w) => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(\" \"); }" },
    { path: "src/money.mjs", exports: ["cents", "formatMoney"], code: "export function cents(amount) { return Math.round(amount * 100); }\nexport const formatMoney = (c) => \"$\" + (c / 100).toFixed(2);" },
  ] });
  const pass = await scoreProbe("structuring", good);
  assert.equal(pass.passed, true, failed(pass).join());
  // One module, a kept counter, a changed behaviour and calls() still exported.
  const bad = await scoreProbe("structuring", JSON.stringify({ modules: [
    { path: "src/all.mjs", code: "let counter = 0;\nexport function fmtDate(d) { counter++; return d.toISOString(); }\nexport function addDays(d, n) { return d; }\nexport function slugify(s) { return s; }\nexport function titleCase(s) { return s; }\nexport function cents(a) { return a * 100; }\nexport function formatMoney(c) { return String(c); }\nexport function calls() { return counter; }" },
    { path: "src/extra.mjs", code: "export default 1;" },
  ] }));
  assert.equal(bad.passed, false);
  for (const name of ["no-module-exports", "no-mutable-state", "exports-once", "cohesion", "behaviour"]) assert.ok(failed(bad).includes(name), name);
  // Code that reaches for the file system is never run.
  let ran = false;
  const refused = await scoreProbe("structuring", JSON.stringify({ modules: [
    { path: "src/a.mjs", code: "import fs from \"node:fs\"; export const fmtDate = 1;" },
    { path: "src/b.mjs", code: "export const x = 1;" },
  ] }), { runNode: async () => { ran = true; return { code: 0, stdout: "" }; } });
  assert.equal(ran, false);
  assert.match(refused.checks.find((item) => item.name === "exports-once").detail, /refused/);
});

test("coding: hidden cases run against the model's module", async () => {
  const good = "```js\nexport function mergeIntervals(list) {\n  if (!Array.isArray(list)) throw new TypeError(\"list must be an array\");\n  const pairs = list.map((pair) => { if (!Array.isArray(pair) || pair[0] > pair[1]) throw new TypeError(\"bad pair\"); return [pair[0], pair[1]]; });\n  pairs.sort((a, b) => a[0] - b[0]);\n  const out = [];\n  for (const [start, end] of pairs) { const last = out[out.length - 1]; if (last && start <= last[1]) last[1] = Math.max(last[1], end); else out.push([start, end]); }\n  return out;\n}\n```";
  const pass = await scoreProbe("coding", good);
  assert.equal(pass.passed, true, failed(pass).join());
  const bad = await scoreProbe("coding", "export function mergeIntervals(list) {\n  const out = [];\n  for (const pair of list) { const last = out[out.length - 1]; if (last && pair[0] < last[1]) last[1] = Math.max(last[1], pair[1]); else out.push(pair); }\n  return out;\n}");
  assert.equal(bad.passed, false);
  for (const name of ["merges-touching", "sorts-input", "rejects-non-array", "rejects-reversed"]) assert.ok(failed(bad).includes(name), name);
  const hostile = await scoreProbe("coding", "import { execSync } from \"node:child_process\";\nexport function mergeIntervals() { return execSync(\"whoami\"); }", { runNode: async () => assert.fail("refused code never runs") });
  assert.deepEqual(failed(hostile).slice(0, 1), ["no-forbidden-code"]);
  assert.equal(hostile.score, 0.1);
});

test("writing: four facts, a word limit and no invented facts", async () => {
  const pass = await scoreProbe("writing", "Studio 0.5 adds a Probes button under Models. Probes run only when you click it, each probe uses at most 1,500 output tokens, and Studio keeps the last 5 runs per model.");
  assert.equal(pass.passed, true, failed(pass).join());
  const bad = await scoreProbe("writing", "## Release notes\n\nStudio 0.5 adds free daily probes under Models in beta, keeping the last 10 runs, 20% faster.");
  assert.equal(bad.passed, false);
  assert.deepEqual(failed(bad), ["one-paragraph", "runs-on-click", "token-cap", "keeps-five-runs", "no-invented-facts"]);
  const long = await scoreProbe("writing", `Studio 0.5 adds a Probes button under Models. ${"Probes run only when you click it. ".repeat(20)}Each probe uses at most 1,500 output tokens and Studio keeps the last 5 runs.`);
  assert.deepEqual(failed(long), ["word-limit"]);
});

test("commits: subject length, mood, area, blank line and a wrapped body", async () => {
  const good = "Add on-demand model probes to Models\n\nThe Models panel gets a Probes section with Run and Cancel buttons.\nmain.cjs adds a models:probe-run IPC handler that runs each probe in\nturn, preload.cjs exposes modelProbeRun and modelProbeCancel, and new\ntests cover the probe scorers.";
  const pass = await scoreProbe("commits", good);
  assert.equal(pass.passed, true, failed(pass).join());
  assert.equal((await scoreProbe("commits", `feat(models): ${good}`)).passed, true, "a conventional prefix is allowed");
  const bad = await scoreProbe("commits", "Added probes and some other stuff to the models page and the main process and preload and tests.");
  assert.equal(bad.passed, false);
  assert.deepEqual(failed(bad), ["subject-length", "imperative", "no-trailing-period", "blank-line", "body-wrapped", "body-covers-change"]);
});

test("tests: the model's test file runs against the right function and two buggy ones", async () => {
  const good = [
    "import test from \"node:test\";",
    "import assert from \"node:assert/strict\";",
    "import { parseDuration } from \"./duration.mjs\";",
    "test(\"units\", () => { assert.equal(parseDuration(\"90s\"), 90); assert.equal(parseDuration(\"5m\"), 300); assert.equal(parseDuration(\"2h\"), 7200); assert.equal(parseDuration(\"1h30m\"), 5400); assert.equal(parseDuration(\"45\"), 45); });",
    "test(\"invalid\", () => { for (const value of [\"\", \"abc\", \"5x\", 7]) assert.equal(parseDuration(value), null); });",
  ].join("\n");
  const pass = await scoreProbe("tests", good);
  assert.equal(pass.passed, true, failed(pass).join());
  // Passing but toothless: it never checks hours or invalid input.
  const weak = await scoreProbe("tests", "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { parseDuration } from \"./duration.mjs\";\ntest(\"seconds\", () => assert.equal(parseDuration(\"90s\"), 90));");
  assert.deepEqual(failed(weak), ["catches-hours-as-minutes", "catches-zero-for-invalid"]);
  const wrong = await scoreProbe("tests", "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { parseDuration } from \"./duration.mjs\";\ntest(\"wrong\", () => assert.equal(parseDuration(\"2h\"), 120));");
  assert.ok(failed(wrong).includes("passes-correct"), "a test that fails the correct function scores nothing for catching bugs");
  assert.ok(failed(wrong).includes("catches-hours-as-minutes"));
  const hostile = await scoreProbe("tests", "import test from \"node:test\";\nimport { parseDuration } from \"./duration.mjs\";\ntest(\"x\", async () => { await fetch(\"https://example.invalid\"); parseDuration(\"1s\"); });", { runNode: async () => assert.fail("refused code never runs") });
  assert.ok(failed(hostile).includes("no-forbidden-code"));
});

test("tests: a test that hangs is killed at the timeout", async () => {
  const run = await runNode({ files: { "hang.mjs": "setInterval(() => {}, 1000);" }, args: ["hang.mjs"], timeoutMs: 500 });
  assert.equal(run.timedOut, true);
  const env = await runNode({ files: { "env.mjs": "console.log(JSON.stringify(Object.keys(process.env)));" }, args: ["env.mjs"] });
  const keys = JSON.parse(env.stdout.trim());
  assert.ok(!keys.some((key) => /KEY|TOKEN|SECRET|PROXY|NODE_OPTIONS/i.test(key)), keys.join());
  assert.equal((await runNode({ files: { "../escape.mjs": "" }, args: [] })).stderr.startsWith("refused"), true);
});

test("setup: package.json, .gitignore and .env.example that are safe to commit", async () => {
  const good = JSON.stringify({
    packageJson: { name: "svc", type: "module", engines: { node: ">=24" }, scripts: { start: "node server.mjs", test: "node --test" }, dependencies: { express: "^5.1.0" } },
    gitignore: ["node_modules/", ".env", "coverage/"],
    envExample: { PORT: "3000", DATABASE_URL: "postgres://localhost:5432/app" },
  });
  const pass = await scoreProbe("setup", good);
  assert.equal(pass.passed, true, failed(pass).join());
  const bad = await scoreProbe("setup", JSON.stringify({
    packageJson: { name: "svc", engines: { node: ">=18" }, scripts: { start: "node index.js", test: "jest" }, dependencies: { express: "^4.19.0" }, devDependencies: { jest: "^29.0.0" } },
    gitignore: ["node_modules", ".env*"],
    envExample: { PORT: "3000", DATABASE_URL: "postgres://admin:hunter2@db.example.com/app" },
  }));
  assert.deepEqual(failed(bad), ["esm", "engines-node-24", "start-script", "test-script", "dependencies", "gitignore", "env-example"]);
});

test("unknown kinds and throwing scorers score zero instead of failing the run", async () => {
  assert.deepEqual(await scoreProbe("vibes", "x"), { passed: false, score: 0, checks: [{ name: "known-probe", ok: false, detail: "vibes" }] });
  const thrown = await scoreProbe("structuring", JSON.stringify({ modules: [{ path: "src/a.mjs", code: "export const a = 1;" }, { path: "src/b.mjs", code: "export const b = 1;" }] }), { runNode: async () => { throw new Error("boom"); } });
  assert.equal(thrown.score, 0);
  assert.match(thrown.checks[0].detail, /boom/);
});

test("the results store keeps the newest five runs per model and kind, and routing sees scored runs only", () => {
  let store = normalizeProbeStore(null);
  for (let index = 0; index < 7; index += 1) {
    store = recordProbeRun(store, { provider: "zai", model: "glm-5.3", kind: "planning", run: { at: 1000 + index, passed: index % 2 === 0, score: index % 2 === 0 ? 1 : 0.5, checks: [{ name: "a", ok: true }], elapsedMs: 10 } });
  }
  store = recordProbeRun(store, { provider: "zai", model: "glm-5.3", kind: "coding", run: { at: 2000, passed: false, score: null, checks: [], error: "HTTP 500" } });
  const runs = probeRunsFor(store, { provider: "zai", model: "glm-5.3" });
  assert.equal(runs.planning.length, PROBE_RUNS_KEPT);
  assert.equal(runs.planning[0].at, 1006, "newest first");
  assert.equal(runs.coding[0].error, "HTTP 500");
  const summary = probeSummary(store, { provider: "zai", model: "glm-5.3", kinds: ["planning", "coding", "writing"] });
  assert.equal(summary.source, "studio-probe-measurements");
  assert.deepEqual(Object.keys(summary.kinds), ["planning"], "a failed call is not a score; an unrun kind is absent");
  assert.deepEqual(summary.kinds.planning, { runs: 5, passedRuns: 3, meanScore: 0.8, latest: { at: 1006, passed: true, score: 1, checksPassed: 1, checksTotal: 1 } });
  assert.equal(probeSummary(store, { provider: "zai", model: "glm-5.3", kinds: ["writing"] }), null);
  // Hostile store content is cleaned on read.
  const dirty = normalizeProbeStore({ schema: 1, models: { x: { provider: "zai", model: "m", kinds: { planning: [{ at: 1, score: 7, passed: true }, "junk"], "__proto__": [{ at: 1, score: 1 }] } }, y: { provider: "bad\nid", model: "m" } } });
  assert.deepEqual(Object.keys(dirty.models), ["zai::m"]);
  assert.equal(dirty.models["zai::m"].kinds.planning[0].score, null);
  assert.equal(dirty.models["zai::m"].kinds.planning[0].passed, false);
  assert.equal(recordProbeRun(dirty, { provider: "zai", model: "m", kind: "vibes", run: { at: 1, score: 1 } }).models["zai::m"].kinds.vibes, undefined);
});
