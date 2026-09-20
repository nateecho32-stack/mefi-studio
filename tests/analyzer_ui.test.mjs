import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/analyzer.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const flush = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const clean = (value) => JSON.parse(JSON.stringify(value));

function report(projectId = "alpha", name = "Alpha") {
  return { kind: "project", projectId, name, summary: { files: 3, plans: 1, items: 1 }, inventory: { files: 3, sourceFiles: 1, testFiles: 1, documents: 1, languages: [{ name: "JavaScript", count: 1 }], entryPoints: ["src/app.js"], checks: [{ name: "test", command: "npm test" }] }, plans: [{ id: "old-plan", title: "Storage plan", source: "docs/PLAN.md", line: 1, sourceStatus: "complete", status: "related", items: [{ text: "Build persistent storage", line: 4, claimedComplete: true, status: "related", evidence: [{ file: "src/store.js", line: 12, snippet: "saveRecord(value)" }], references: [{ ref: "src/store.js", found: true }, { ref: "tests/storage.test.js", found: false }] }] }], startingPoints: [{ title: "Verify saved records", reason: "The old plan claims storage is complete.", firstStep: "Trace save and restore behavior.", acceptance: "A saved record survives a restart.", evidence: [{ file: "src/store.js", line: 12, snippet: "saveRecord(value)" }] }], limitations: ["Bounded local scan. Tests were not run."] };
}

function idea(text = "new idea") {
  return { kind: "idea", text, verdict: "new", coverage: 0, files: [], scanned: 3, keywords: [text], keywordHits: {}, suggestions: [], references: [], hits: [], uncovered: [text] };
}

function file(name = "fixture.js") {
  return { kind: "file", name, language: "JavaScript", composition: { lines: 3, code: 3, comment: 0, blank: 0, codePercent: 100, commentPercent: 0 }, outline: [], markers: [], references: [], findings: [{ kind: "summary", text: name }] };
}

function environment(bridge = {}) {
  const ids = new Map();
  const listeners = new Map();
  let document;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.style = {}; this.value = ""; this.checked = false; this.disabled = false; this.hidden = true; this.className = ""; this.classList = { add() {}, remove() {} }; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(" "); }
    append(...children) { this.children.push(...children); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, detail = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, preventDefault() {}, ...detail }); }
    click() { if (!this.disabled) this.dispatch("click"); }
    focus() { document.activeElement = this; }
  }
  for (const match of template.matchAll(/<([a-z0-9]+)\b[^>]*\bid="(analyzer-[^"]+)"[^>]*>/g)) ids.set(match[2], new Element(match[1]));
  const get = (id) => ids.get(`analyzer-${id}`);
  document = { readyState: "complete", getElementById: (id) => ids.get(id) || null, createElement: (tag) => new Element(tag), activeElement: null };
  const calls = [];
  const aiCalls = [];
  const window = { addEventListener: (type, fn) => listeners.set(type, fn), mefiStudio: {
    analyzerRun: async (kind, payload) => { calls.push({ kind, payload: clean(payload) }); return { ok: true, projectId: payload.projectId || "alpha", result: kind === "project" ? report(payload.projectId || "alpha") : kind === "file" ? file() : idea(payload.text) }; },
    analyzerAi: async (kind, payload) => { aiCalls.push({ kind, payload: clean(payload) }); return { ok: true, projectId: payload.projectId, result: { summary: "Useful AI advice", ideas: ["Review the save path"] } }; },
    ...bridge,
  } };
  vm.runInContext(source, vm.createContext({ window, document }));
  const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)]);
  return { get, window, document, calls, aiCalls, analyzer: window.MefiAnalyzer, project: (projectId) => listeners.get("mefi:project-changed")({ detail: { projectId } }), descendants };
}

test("initial project load scans locally, shows evidence and preserves explicit AI consent", async () => {
  const env = environment();
  env.get("ai").checked = true;
  assert.equal(env.get("project-ai").disabled, true);
  env.project("alpha"); await flush();
  assert.deepEqual(env.calls, [{ kind: "project", payload: { projectId: "alpha" } }]);
  assert.equal(env.aiCalls.length, 0);
  assert.match(env.get("title").textContent, /Project · Alpha/);
  const text = env.get("findings").textContent;
  assert.match(text, /Starting points/);
  assert.match(text, /docs\/PLAN.md:4/);
  assert.match(text, /src\/store.js:12/);
  assert.match(text, /Missing: tests\/storage.test.js/);
  assert.match(text, /completion not verified/);
  assert.match(text, /Checks discovered — not run/);
  assert.match(env.get("evidence").textContent, /Tests were not run/);
  assert.equal(env.get("project-ai").disabled, false);
  env.get("project-ai").click(); await flush();
  assert.deepEqual(env.aiCalls, [{ kind: "project", payload: { projectId: "alpha" } }]);
  assert.match(env.get("ai-out").textContent, /Useful AI advice/);
});

test("starting points prepare editable ideas without creating work or calling AI", async () => {
  const env = environment(); env.project("alpha"); await flush();
  const prepare = env.descendants(env.get("findings")).find((element) => element.tagName === "button" && element.textContent === "Prepare idea");
  prepare.click();
  assert.match(env.get("idea").value, /First step: Trace save and restore behavior/);
  assert.match(env.get("idea").value, /Acceptance: A saved record survives a restart/);
  assert.equal(env.document.activeElement, env.get("idea"));
  assert.equal(env.calls.length, 1);
  assert.equal(env.aiCalls.length, 0);
});

test("uninspected references remain distinct from confirmed missing paths", async () => {
  const result = report();
  result.plans[0].items[0].references = [
    { ref: "../outside.js", found: false, status: "outside-project" },
    { ref: "data/settings.json", found: false, status: "excluded" },
    { ref: "locked.js", found: false, status: "unreadable" },
    { ref: "missing.js", found: false, status: "missing" },
  ];
  const env = environment({ analyzerRun: async () => ({ ok: true, projectId: "alpha", result }) });
  env.project("alpha"); await flush();
  const text = env.get("findings").textContent;
  assert.match(text, /Outside project — not inspected: \.\.\/outside.js/);
  assert.match(text, /Excluded — not inspected: data\/settings.json/);
  assert.match(text, /Unreadable — not inspected: locked.js/);
  assert.match(text, /Missing: missing.js/);
  assert.doesNotMatch(text, /Missing: (\.\.\/outside.js|data\/settings.json|locked.js)/);
});

test("list rows pin their visible label text and row-label title on the row-label span, not the heading", async () => {
  const rowsAfterHeading = (root, headingText) => {
    const entries = root.children;
    const at = entries.findIndex((el) => el.tagName === "h4" && el.text === headingText);
    assert.ok(at >= 0, `${headingText} heading renders`);
    const heading = entries[at];
    const list = entries[at + 1];
    assert.equal(list.tagName, "ul", `${headingText} heading is followed by its list`);
    return { heading, rows: list.children.map((li) => li.children[0]) };
  };

  const fileResult = file();
  fileResult.references = [
    { ref: "src/store.js", found: true },
    { ref: "tests/storage.test.js", found: false },
  ];
  const fileEnv = environment({ analyzerRun: async () => ({ ok: true, projectId: "alpha", result: fileResult }) });
  await fileEnv.analyzer.file("fixture.js");
  const references = rowsAfterHeading(fileEnv.get("findings"), "Referenced paths");
  assert.deepEqual(references.rows.map((key) => key.text), ["exists", "MISSING"], "each row shows its visible label text");
  assert.deepEqual(
    references.rows.map((key) => key.title),
    ["present in the work tree", "not found in the work tree"],
    "each row-label carries its restored title"
  );
  assert.equal(references.heading.title ?? "", "", "the adjacent h4 heading carries no row-label title");

  const ideaResult = idea("storage idea");
  ideaResult.hits = [{ file: "src/store.js", line: 12, snippet: "saveRecord(value)", keyword: "storage" }];
  const ideaEnv = environment({ analyzerRun: async (kind) => kind === "idea" ? { ok: true, projectId: "alpha", result: ideaResult } : { ok: true, projectId: "alpha", result: file() } });
  await ideaEnv.analyzer.idea("storage idea");
  const evidence = rowsAfterHeading(ideaEnv.get("evidence"), "Evidence");
  assert.equal(evidence.rows.length, 1, "the evidence list renders its row");
  assert.equal(evidence.rows[0].text, "src/store.js:12", "the evidence row-label shows its visible text");
  assert.equal(evidence.rows[0].title, "storage · src/store.js", "the evidence row-label title matches the hit");
});

test("saved plan scope, settled decisions and acceptance remain visible as unverified context", async () => {
  const result = report();
  Object.assign(result.plans[0], {
    source: "Studio plan", sourceType: "studio", line: 0,
    context: {
      destination: "Save a user's records between launches.",
      outOfScope: "No cloud sync in this plan.",
      decisions: [{ question: "Where are records stored?", resolution: "Use local storage <script>plain text only</script>." }],
    },
  });
  result.plans[0].items[0].acceptance = ["Restart the app and restore the saved record."];
  const env = environment({ analyzerRun: async () => ({ ok: true, projectId: "alpha", result }) });
  env.project("alpha"); await flush();
  const details = env.descendants(env.get("findings")).find((element) => element.tagName === "details");
  assert.match(details.textContent, /Destination\s+Save a user's records between launches/);
  assert.match(details.textContent, /Outside this plan\s+No cloud sync/);
  assert.match(details.textContent, /Settled planning decisions/);
  assert.match(details.textContent, /Where are records stored\? — Use local storage <script>plain text only<\/script>/);
  assert.match(details.textContent, /implementation still needs verification/);
  assert.match(details.textContent, /Acceptance checks — not run/);
  assert.match(details.textContent, /Restart the app and restore the saved record/);
  assert.equal(env.descendants(details).some((element) => element.tagName === "script"), false);
  assert.equal(env.aiCalls.length, 0);
});

test("project changes clear old findings and drafts before rejecting old scan replies", async () => {
  const first = deferred(), second = deferred(); let reads = 0;
  const env = environment({ analyzerRun: () => (++reads === 1 ? first : second).promise });
  env.project("alpha"); env.get("idea").value = "Alpha draft";
  env.project("beta");
  assert.equal(env.get("idea").value, "");
  assert.equal(env.get("findings").textContent, "");
  assert.equal(env.get("project-ai").disabled, true);
  second.resolve({ ok: true, projectId: "beta", result: report("beta", "Beta") }); await flush();
  first.resolve({ ok: true, projectId: "alpha", result: report("alpha", "Stale Alpha") }); await flush();
  assert.equal(env.get("title").textContent, "Project · Beta");
  assert.doesNotMatch(env.get("status").textContent, /Stale/);
});

test("a refreshed project report wins over an older scan of the same project", async () => {
  const first = deferred(), second = deferred(); let reads = 0;
  const env = environment({ analyzerRun: () => (++reads === 1 ? first : second).promise });
  env.project("alpha"); env.analyzer.project();
  second.resolve({ ok: true, projectId: "alpha", result: report("alpha", "Fresh") }); await flush();
  first.resolve({ ok: true, projectId: "alpha", result: report("alpha", "Old") }); await flush();
  assert.equal(env.get("title").textContent, "Project · Fresh");
});

test("late file and idea replies cannot replace a newly loaded project or launch AI", async () => {
  for (const kind of ["file", "idea"]) {
    const old = deferred();
    const env = environment({ analyzerRun: async (readKind, payload) => readKind === kind ? old.promise : { ok: true, projectId: payload.projectId, result: report(payload.projectId, payload.projectId) } });
    env.project("alpha"); await flush(); env.get("ai").checked = true;
    env.analyzer[kind]("old input");
    env.project("beta"); await flush();
    old.resolve({ ok: true, projectId: "alpha", result: kind === "file" ? file("old.js") : idea("Old") }); await flush();
    assert.equal(env.get("title").textContent, "Project · beta");
    assert.equal(env.aiCalls.length, 0);
  }
});

test("a later idea analysis wins over an earlier file analysis in the same project", async () => {
  const old = deferred();
  const env = environment({ analyzerRun: async (kind) => kind === "file" ? old.promise : { ok: true, projectId: "alpha", result: idea("Current idea") } });
  env.analyzer.file("old.js"); await env.analyzer.idea("Current idea");
  old.resolve({ ok: true, projectId: "alpha", result: file("old.js") }); await flush();
  assert.equal(env.get("title").textContent, "Findings · idea");
  assert.match(env.get("findings").textContent, /Current idea/);
});

test("native file selection is fenced by both a project change and a newer analysis", async () => {
  for (const next of ["project", "idea"]) {
    const pick = deferred();
    const env = environment({ analyzerPick: () => pick.promise });
    env.project("alpha"); await flush(); env.get("file").click();
    if (next === "project") env.project("beta"); else env.analyzer.idea("Current idea");
    await flush();
    pick.resolve({ ok: true, path: "old-project.js" }); await flush();
    assert.equal(env.calls.filter((entry) => entry.kind === "file").length, 0);
    assert.match(env.get("title").textContent, next === "project" ? /Project/ : /Findings · idea/);
  }
});

test("late project AI replies and failures cannot leak into a new project", async () => {
  for (const reject of [false, true]) {
    const ai = deferred();
    const env = environment({ analyzerAi: () => ai.promise });
    env.project("alpha"); await flush(); env.get("project-ai").click();
    env.project("beta"); await flush();
    if (reject) ai.reject(new Error("Old failure")); else ai.resolve({ ok: true, projectId: "alpha", result: { summary: "Old advice" } });
    await flush();
    assert.equal(env.get("ai-out").textContent, "");
    assert.match(env.get("status").textContent, /Project scan complete/);
    assert.equal(env.get("project-ai").disabled, false);
  }
});

test("starting a newer file read fences AI from a previous file in the same project", async () => {
  const ai = deferred(); let reads = 0;
  const env = environment({ analyzerRun: async () => ({ ok: true, projectId: "alpha", result: file(++reads === 1 ? "first.js" : "second.js") }), analyzerAi: () => ai.promise });
  env.get("ai").checked = true; env.analyzer.file("first.js"); await flush();
  env.get("ai").checked = false; await env.analyzer.file("second.js");
  ai.resolve({ ok: true, projectId: "alpha", result: { summary: "first file advice" } }); await flush();
  assert.equal(env.get("title").textContent, "Findings · second.js");
  assert.equal(env.get("ai-out").textContent, "");
});

test("scan failures are visible and retryable; old evidence and project AI remain unavailable", async () => {
  const env = environment(); env.project("alpha"); await flush();
  env.window.mefiStudio.analyzerRun = async () => { throw new Error("Folder unavailable"); };
  await env.analyzer.project();
  assert.match(env.get("status").textContent, /Folder unavailable/);
  assert.equal(env.get("findings").textContent, "");
  assert.equal(env.get("project-ai").disabled, true);
  assert.equal(env.get("project").disabled, false);
});

test("AI response shape errors do not crash the project view or disable retry", async () => {
  for (const malformed of [null, "plain text", { summary: "Usable summary", ideas: {}, gaps: [null, { nested: true }, "Review missing tests"] }]) {
    const env = environment({ analyzerAi: async () => ({ ok: true, projectId: "alpha", result: malformed }) });
    env.project("alpha"); await flush(); env.get("project-ai").click(); await flush();
    assert.equal(env.get("title").textContent, "Project · Alpha");
    assert.equal(env.get("project-ai").disabled, false);
    if (typeof malformed === "object" && malformed) {
      assert.match(env.get("ai-out").textContent, /Review missing tests/);
      assert.doesNotMatch(env.get("ai-out").textContent, /\[object Object\]/);
    } else assert.match(env.get("status").textContent, /invalid response/);
  }
});

test("opening Analyzer can scan before the workspace initial project event", async () => {
  const env = environment(); env.analyzer.open(); await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].kind, "project");
  assert.equal(env.get("overlay").hidden, false);
  env.analyzer.close(); env.analyzer.open(); await flush();
  assert.equal(env.calls.length, 1);
  assert.equal(env.aiCalls.length, 0);
});
