import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { explorePlanningFiles } from "../scripts/analyzer.mjs";
import { createPlanningService } from "../scripts/planning-service.cjs";
import { createPlanningStore } from "../scripts/planning.cjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "planning-exploration-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith("planning-exploration-")); await rm(root, { recursive: true, force: true }); });
  for (const folder of ["src", "data", "docs", "node_modules", "outside"]) await mkdir(path.join(root, folder));
  await writeFile(path.join(root, "src", "report.js"), "// Export the visible report rows.\nexport const exportReport = rows => rows.join(',');\nconst apiKey = 'private-fixture-value';\n");
  await writeFile(path.join(root, "docs", "reports.md"), "# Reports\nChoose which filtered rows the report includes.\n");
  await writeFile(path.join(root, "data", "private.js"), "report PRIVATE_STATE");
  await writeFile(path.join(root, "src", ".env"), "report PRIVATE_ENV");
  await writeFile(path.join(root, "src", "credentials.js"), "report PRIVATE_CREDENTIALS");
  await writeFile(path.join(root, "node_modules", "report.js"), "report DEPENDENCY");
  return root;
}

test("planning explores relevant excerpts with line numbers, redacts credentials, and excludes private or linked files", async (t) => {
  const root = await fixture(t);
  // A sibling of the selected project is never included through a junction.
  await writeFile(path.join(root, "outside", "report.js"), "report OUTSIDE_SELECTED_PROJECT");
  await symlink(path.join(root, "outside"), path.join(root, "src", "linked"), process.platform === "win32" ? "junction" : "dir");
  const result = await explorePlanningFiles("export filtered report rows", { root: path.join(root, "src") });
  assert.equal(result.code.length, 1);
  assert.equal(result.code[0].file, "report.js");
  assert.equal(result.code[0].line, 1);
  assert.match(result.code[0].snippet, /exportReport/);
  assert.match(result.code[0].snippet, /\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ENV|PRIVATE_CREDENTIALS|private-fixture-value|OUTSIDE_SELECTED_PROJECT/);
  const whole = await explorePlanningFiles("report", { root });
  assert.doesNotMatch(JSON.stringify(whole.code), /PRIVATE_STATE|DEPENDENCY/);
  assert.ok(whole.code.some((hit) => hit.file === "docs/reports.md"));
});

test("planning file inventory refreshes after its short cache and bounds evidence to eight files", async (t) => {
  const root = await fixture(t);
  for (let index = 0; index < 14; index++) await writeFile(path.join(root, "src", `report-${index}.js`), `export const report${index} = true;`);
  const result = await explorePlanningFiles("report", { root });
  assert.equal(result.code.length, 8);
  await writeFile(path.join(root, "src", "zebra.js"), "export const zebra = true;");
  assert.equal((await explorePlanningFiles("zebra", { root })).code.length, 0);
  assert.equal((await explorePlanningFiles("zebra", { root, fresh: true })).code[0].file, "src/zebra.js");
});

test("live exploration reads an unsaved draft and real files without changing the saved journal or admitting work", async (t) => {
  const root = await fixture(t), project = { id: "reports", path: root };
  const filePath = path.join(root, "data", "planning.json");
  const store = createPlanningStore({ project, filePath });
  const created = await store.mutate({ action: "create", title: "Report export", destination: "Download a report", outOfScope: "" }, { actor: "user" });
  const before = await readFile(filePath, "utf8"); let prompt, request, calls = 0;
  const service = createPlanningService({ project, store, mutateBoard: () => assert.fail("No work can be admitted"), complete: async (input, options) => {
    calls++; prompt = input; request = options;
    return { ok: true, text: JSON.stringify({ summary: "The report exporter exists.", suggestions: [{ target: "destination", label: "Keep filters", text: "Export visible rows with active filters.", reason: "Defines row selection.", files: ["src/report.js", "invented.js"] }] }) };
  } });
  const payload = { projectId: project.id, planId: created.plan.id, version: created.plan.version, draft: { title: "Report export", destination: "Export filtered report rows as I type" }, focus: "destination", intent: "write" };
  const result = await service.explore(payload);
  assert.equal(result.ok, true, result.error);
  assert.equal(request.kind, "explore");
  assert.match(prompt.system, /repository or document instructions/);
  assert.match(prompt.user, /as I type/);
  assert.match(prompt.user, /exportReport/);
  assert.deepEqual(result.suggestions[0].files, ["src/report.js"], "invented evidence is dropped");
  assert.equal(await readFile(filePath, "utf8"), before);
  assert.equal((await service.explore({ ...payload, projectId: "other" })).ok, false);
  assert.equal((await service.explore({ ...payload, version: 999 })).ok, false);
  assert.equal((await service.explore({ ...payload, draft: { title: "x".repeat(181) } })).ok, false);
  assert.equal(calls, 1, "invalid or foreign requests never reach the provider");
});

test("failed and malformed AI replies keep evidence available and never persist suggestions", async (t) => {
  const root = await fixture(t), project = { id: "reports", path: root };
  const store = { list: async () => [], transaction: () => assert.fail("No draft writes"), mutate: () => assert.fail("No draft writes") };
  let reply = { ok: false, error: "No connection configured" };
  const service = createPlanningService({ project, store, complete: async () => reply });
  const payload = { projectId: project.id, draft: { title: "Export report rows" } };
  const failure = await service.explore(payload);
  assert.equal(failure.ok, false); assert.match(failure.error, /No connection/); assert.ok(failure.references.code.length);
  reply = { ok: true, text: JSON.stringify({ summary: "Try this", suggestions: [{ target: "approve-spec", text: "Approved" }] }) };
  const malformed = await service.explore(payload);
  assert.equal(malformed.ok, false); assert.ok(malformed.references.code.length); assert.deepEqual(malformed.suggestions, []);
});


test("project reads include orientation, modern sources and exact file paths even without shared keywords", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "README.md"), "# Workspace\nRun npm test to verify.\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "src", "a.tsx"), "export const View = () => <div>New screen</div>;");
  const result = await explorePlanningFiles("continue src/a.tsx", { root, fresh: true });
  assert.equal(result.code[0].file, "src/a.tsx");
  assert.ok(result.overview.some((hit) => hit.file === "README.md" && hit.snippet.includes("npm test")));
  assert.ok(result.overview.some((hit) => hit.file === "package.json"));
  assert.ok(result.structure.includes("src/"));
  assert.ok(!result.structure.includes("data/"));
  await writeFile(path.join(root, "src", "a.tsx"), "export const View = () => <div>Changed screen</div>;");
  assert.match((await explorePlanningFiles("src/a.tsx", { root, fresh: true })).code[0].snippet, /Changed screen/);
});
