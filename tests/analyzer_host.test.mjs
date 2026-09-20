import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Extract only the host boundary; no Electron boot, project files, user stores,
// coding workers or provider connections participate in these fixtures.
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const start = source.indexOf("async function analyzerAi(");
const end = source.indexOf("async function gatherReferences(", start);
assert.ok(start >= 0 && end > start, "analyzer host helper section is present");
const helpers = source.slice(start, end);
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const projectA = { id: "fixture-a", path: "/fixture/project-a" };
const projectB = { id: "fixture-b", path: "/fixture/project-b" };
const report = (overrides = {}) => ({
  name: "Fixture project", analyzedAt: "2026-09-19T12:00:00.000Z",
  summary: "Local project evidence", inventory: { files: 3, languages: [{ name: "JavaScript", files: 2 }] },
  plans: [], startingPoints: [], limitations: ["No tests were run."], ...overrides,
});

function fixture(options = {}) {
  let current = projectA;
  const calls = { getAnalyzer: 0, services: [], lists: [], scans: [], files: [], ideas: [], routes: [], http: [], assistant: [] };
  const savedPlans = new Map([[projectA.id, [{ id: "old-a", title: "Old A plan" }]], [projectB.id, [{ id: "old-b", title: "Old B plan" }]]]);
  const analyzer = {
    async analyzeProject(input) {
      calls.scans.push(input);
      return options.scan ? options.scan(input, calls.scans.length) : report({ plans: input.plans });
    },
    async analyzeFile(file, input) { calls.files.push({ file, ...input }); return { kind: "file" }; },
    async verifyIdea(text, input) { calls.ideas.push({ text, ...input }); return { kind: "idea" }; },
  };
  const context = vm.createContext({
    projects: { current: () => current, open: () => current },
    getAnalyzer: async () => { calls.getAnalyzer += 1; if (options.importGate) await options.importGate; return analyzer; },
    planningService: () => {
      const project = current;
      calls.services.push(project.id);
      return { async list(payload) {
        calls.lists.push({ serviceProject: project.id, ...payload });
        if (payload.projectId !== project.id) return { ok: false, error: "Saved plan project mismatch" };
        return options.list ? options.list(payload) : { ok: true, projectId: project.id, plans: savedPlans.get(project.id) };
      } };
    },
    ASSISTANT_ANALYZER_SYSTEM: "Fixture analyzer instruction",
    resolveAiRoute: async (...args) => { calls.routes.push(args); return options.route || { ok: true, provider: "fixture-http" }; },
    httpAssistantCall: async (...args) => { calls.http.push(args); return options.httpReply || { ok: true, text: '{"summary":"Evidence-led suggestion","ideas":[]}' }; },
    assistantFetch: async (...args) => { calls.assistant.push(args); throw new Error("Project analysis must not invoke CLI-capable assistant routing"); },
  });
  vm.runInContext(helpers, context);
  const methods = vm.runInContext("({ runAnalyzer, analyzerAi, projectAnalyzerContext, analyzerProjectReports, analyzerProjectReads })", context);
  return { ...methods, calls, savedPlans, select: (project) => { current = project; } };
}

test("project scan captures its root and saved-plan service before a project switch", async () => {
  const gate = deferred();
  const f = fixture({ importGate: gate.promise });
  const pending = f.runAnalyzer({ kind: "project", projectId: projectA.id });
  f.select(projectB);
  gate.resolve();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.projectId, projectA.id);
  assert.deepEqual(plain(f.calls.lists), [{ serviceProject: projectA.id, projectId: projectA.id }]);
  assert.equal(f.calls.scans[0].root, projectA.path);
  assert.equal(f.calls.scans[0].projectId, projectA.id);
  assert.equal(f.calls.scans[0].plans, f.savedPlans.get(projectA.id));
  assert.equal(f.analyzerProjectReports.get(projectA.id), result.result);
  assert.equal(f.analyzerProjectReports.has(projectB.id), false);
});

test("stale project requests stop before loading the analyzer or reading stored plans", async () => {
  const f = fixture();
  const result = await f.runAnalyzer({ kind: "project", projectId: projectB.id });
  assert.equal(result.ok, false);
  assert.match(result.error, /selected project changed/i);
  assert.equal(f.calls.getAnalyzer, 0);
  assert.equal(f.calls.services.length, 0);
  assert.equal(f.calls.lists.length, 0);
  assert.equal(f.calls.scans.length, 0);
});

test("unreadable saved plans leave project analysis available with a visible limitation", async () => {
  const f = fixture({ list: async () => ({ ok: false, error: "Fixture planning store is unreadable" }) });
  const result = await f.runAnalyzer({ kind: "project", projectId: projectA.id });
  assert.equal(result.ok, true);
  assert.deepEqual(plain(f.calls.scans[0].plans), []);
  assert.match(result.result.limitations.join("\n"), /Saved Studio plans could not be read: Fixture planning store is unreadable/);
  assert.match(result.result.limitations.join("\n"), /No tests were run/);
});

test("concurrent requests share one stored-plan read and project scan, then permit refresh", async () => {
  const gate = deferred();
  const f = fixture({ scan: async () => { await gate.promise; return report(); } });
  const pending = Array.from({ length: 12 }, () => f.runAnalyzer({ kind: "project", projectId: projectA.id }));
  await flush();
  assert.equal(f.calls.lists.length, 1);
  assert.equal(f.calls.scans.length, 1);
  assert.equal(f.analyzerProjectReads.size, 1);
  gate.resolve();
  const results = await Promise.all(pending);
  assert.ok(results.every((result) => result === results[0]));
  assert.equal(f.analyzerProjectReads.size, 0);
  assert.equal((await f.runAnalyzer({ kind: "project" })).ok, true);
  assert.equal(f.calls.scans.length, 2);
  assert.equal(f.calls.lists.length, 2);
});

test("scan failures settle concurrent readers, clear old evidence and permit a retry", async () => {
  const gate = deferred();
  const f = fixture({ scan: async (_input, attempt) => { if (attempt === 1) await gate.promise; return report({ summary: "Fresh evidence" }); } });
  f.analyzerProjectReports.set(projectA.id, report({ summary: "Outdated evidence" }));
  const first = f.runAnalyzer({ kind: "project" });
  const second = f.runAnalyzer({ kind: "project" });
  await flush();
  assert.equal(f.analyzerProjectReports.has(projectA.id), false);
  gate.reject(new Error("Fixture directory unavailable"));
  for (const result of await Promise.all([first, second])) {
    assert.equal(result.ok, false);
    assert.equal(result.error, "Fixture directory unavailable");
  }
  assert.equal(f.analyzerProjectReads.size, 0);
  assert.equal(f.analyzerProjectReports.has(projectA.id), false);
  const retry = await f.runAnalyzer({ kind: "project" });
  assert.equal(retry.ok, true);
  assert.equal(retry.result.summary, "Fresh evidence");
  assert.equal(f.calls.scans.length, 2);
});

test("project scans keep separate in-flight results and a bounded recent-report cache", async () => {
  const gate = deferred();
  const f = fixture({ scan: async (input) => { if (input.projectId === projectA.id) await gate.promise; return report({ name: input.projectId }); } });
  const first = f.runAnalyzer({ kind: "project" });
  await flush();
  f.select(projectB);
  const second = await f.runAnalyzer({ kind: "project" });
  assert.equal(second.result.name, projectB.id);
  gate.resolve();
  assert.equal((await first).result.name, projectA.id);
  for (let index = 0; index < 8; index += 1) {
    f.select({ id: `extra-${index}`, path: `/fixture/extra-${index}` });
    await f.runAnalyzer({ kind: "project" });
  }
  assert.equal(f.analyzerProjectReports.size, 8);
  assert.equal(f.analyzerProjectReports.has(projectA.id), false);
  assert.equal(f.analyzerProjectReports.has(projectB.id), false);
  assert.equal(f.analyzerProjectReports.has("extra-7"), true);
});

test("file and idea analysis also retain the selected root across an import delay", async () => {
  const gate = deferred();
  const f = fixture({ importGate: gate.promise });
  const file = f.runAnalyzer({ kind: "file", path: "src/main.js" });
  const idea = f.runAnalyzer({ kind: "idea", text: "Add search" });
  f.select(projectB);
  gate.resolve();
  assert.equal((await file).projectId, projectA.id);
  assert.equal((await idea).projectId, projectA.id);
  assert.deepEqual(plain(f.calls.files), [{ file: "src/main.js", root: projectA.path }]);
  assert.deepEqual(plain(f.calls.ideas), [{ text: "Add search", root: projectA.path }]);
  assert.equal(f.calls.lists.length, 0);
});

test("project AI uses the host report and an explicit HTTP route without CLI tools", async () => {
  const f = fixture();
  f.analyzerProjectReports.set(projectA.id, report({ summary: "Host-verified source evidence" }));
  const result = await f.analyzerAi("project", { projectId: projectA.id, summary: "UNTRUSTED_RENDERER_SENTINEL", tools: ["shell"] });
  assert.equal(result.ok, true);
  assert.equal(result.result.summary, "Evidence-led suggestion");
  assert.deepEqual(plain(f.calls.routes), [["heavy", { allowCli: false }]]);
  assert.equal(f.calls.assistant.length, 0);
  assert.equal(f.calls.http.length, 1);
  const [, system, user, budget, metadata] = f.calls.http[0];
  assert.equal(system, "Fixture analyzer instruction");
  assert.equal(JSON.parse(user).payload.summary, "Host-verified source evidence");
  assert.equal(user.includes("UNTRUSTED_RENDERER_SENTINEL"), false);
  assert.equal(user.includes('"tools"'), false);
  assert.equal(budget, 6000);
  assert.deepEqual(plain(metadata), { role: "heavy", taskType: "analyzer", source: "analyzer" });
});

test("project AI requires this project's report and rejects a stale project before routing", async () => {
  const f = fixture();
  f.analyzerProjectReports.set(projectB.id, report({ summary: "Other project's evidence" }));
  const missing = await f.analyzerAi("project", { projectId: projectA.id });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Analyze the current project/);
  const stale = await f.analyzerAi("project", { projectId: projectB.id });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /selected project changed/i);
  assert.equal(f.calls.routes.length, 0);
  assert.equal(f.calls.http.length, 0);
  assert.equal(f.calls.assistant.length, 0);
});

test("missing HTTP credentials leave local analysis available without a CLI fallback", async () => {
  const f = fixture({ route: { ok: false, error: "No saved HTTP key" } });
  await f.runAnalyzer({ kind: "project" });
  const result = await f.analyzerAi("project", { projectId: projectA.id });
  assert.equal(result.ok, false);
  assert.match(result.error, /saved z.ai or OpenCode Go key/);
  assert.equal(f.analyzerProjectReports.has(projectA.id), true);
  assert.equal(f.calls.http.length, 0);
  assert.equal(f.calls.assistant.length, 0);
});

test("AI failures and plain-text provider replies remain readable", async () => {
  const failed = fixture({ httpReply: { ok: false, error: "Fixture provider offline" } });
  failed.analyzerProjectReports.set(projectA.id, report());
  assert.equal((await failed.analyzerAi("project", {})).error, "Fixture provider offline");
  const prose = fixture({ httpReply: { ok: true, text: "Inspect the existing plan before changing the app." } });
  prose.analyzerProjectReports.set(projectA.id, report());
  const result = await prose.analyzerAi("project", {});
  assert.equal(result.ok, true);
  assert.equal(result.result.summary, "Inspect the existing plan before changing the app.");
  assert.deepEqual(plain(result.result.ideas), []);
});

test("compact AI context stays valid JSON and reports omitted plans and items", () => {
  const f = fixture();
  const evidence = Array.from({ length: 5 }, (_, index) => ({ file: `src/feature-${index}.js`, line: index + 1, snippet: 'quoted "code" \\ newline\n'.repeat(15) }));
  const plans = Array.from({ length: 10 }, (_, index) => ({
    title: `Historical plan ${index}`, source: `docs/plan-${index}.md`, line: 1, status: "review-needed", sourceStatus: "approved",
    items: Array.from({ length: 7 }, (_, item) => ({ text: `Feature ${item} ` + "detail ".repeat(70), line: item + 2, status: "partial", claimedComplete: true, evidence, references: Array.from({ length: 7 }, (_, ref) => `src/file-${ref}.js`) })),
  }));
  const original = report({ plans, startingPoints: Array.from({ length: 9 }, (_, index) => ({ title: `Start ${index}`, reason: "why ".repeat(200), firstStep: "step ".repeat(200), acceptance: "check ".repeat(200), evidence })) });
  const snapshot = JSON.stringify(original);
  const encoded = f.projectAnalyzerContext(original);
  const parsed = JSON.parse(encoded);
  assert.equal(parsed.kind, "project");
  assert.ok(parsed.payload.plans.length > 0 && parsed.payload.plans.length <= 8);
  assert.equal(parsed.payload.omittedPlans, plans.length - parsed.payload.plans.length);
  assert.equal(parsed.payload.startingPoints.length, 6);
  for (const plan of parsed.payload.plans) {
    assert.equal(plan.items.length, 5);
    assert.equal(plan.omittedItems, 2);
    assert.equal(plan.items[0].claimedComplete, true);
    assert.equal(plan.items[0].status, "partial");
    assert.equal(plan.items[0].evidence.length, 3);
    assert.equal(plan.items[0].references.length, 5);
    assert.ok(plan.items[0].text.length <= 300);
    assert.ok(plan.items[0].evidence[0].snippet.length <= 160);
  }
  assert.ok(encoded.length <= 26100, "plan excerpt removal respects the context budget including its small envelope");
  assert.match(parsed.payload.limitations.join("\n"), /at most eight plans.*text is shortened/);
  assert.equal(JSON.stringify(original), snapshot, "creating an excerpt leaves the full local evidence intact");
});

test("AI plan excerpts preserve scope, settled decisions and task acceptance", () => {
  const f = fixture();
  const original = report({ plans: [{ title: "Offline journal", source: "Studio plan", context: {
    destination: "Keep notes offline", outOfScope: "Do not add cloud sync",
    decisions: Array.from({ length: 5 }, (_, index) => ({ question: `Storage decision ${index}`, resolution: "Use IndexedDB" })),
  }, items: [{ text: "Implement chosen storage", acceptance: ["Notes survive a reload"], evidence: [], references: [] }] }] });
  const { payload } = JSON.parse(f.projectAnalyzerContext(original));
  assert.equal(payload.plans[0].context.destination, "Keep notes offline");
  assert.equal(payload.plans[0].context.outOfScope, "Do not add cloud sync");
  assert.equal(payload.plans[0].context.decisions[0].resolution, "Use IndexedDB");
  assert.equal(payload.plans[0].context.omittedDecisions, 1);
  assert.deepEqual(payload.plans[0].items[0].acceptance, ["Notes survive a reload"]);
});
