// The auditor must compare the two shipped catalogs, not merely parse them:
// curated.json ids and endpointMap routes resolve against models.json when the
// app routes models, so drift between the committed files breaks routing
// silently — while roster-only models.json ids are legitimate and must stay
// unflagged.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { audit } from "../scripts/auditor.mjs";

async function fixtureStudio({ curated, models } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "auditor-catalogs-"));
  for (const dir of ["renderer", "scripts", "data"]) await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, "renderer", "nav.js"), "");
  await writeFile(path.join(root, "renderer", "booklet.template.html"), "");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: {} }));
  await writeFile(path.join(root, "main.cjs"), "");
  await writeFile(path.join(root, "preload.cjs"), "");
  await writeFile(path.join(root, "scripts", "build-booklet.mjs"), "");
  if (curated !== undefined) await writeFile(path.join(root, "data", "curated.json"), JSON.stringify(curated));
  if (models !== undefined) await writeFile(path.join(root, "data", "models.json"), JSON.stringify(models));
  return root;
}

async function dataFindings(fixture) {
  const root = await fixtureStudio(fixture);
  try {
    const result = await audit({ root });
    return result.findings.filter((finding) => finding.area === "data");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const catalog = (ids) => ({ models: ids.map((id) => ({ id })) });
const curatedSeed = (ids, endpointIds = ids) => ({
  models: Object.fromEntries(ids.map((id) => [id, { listed: true }])),
  endpoints: { compat: { baseUrl: "https://example.invalid/v1" } },
  endpointMap: { compat: endpointIds },
});

test("in-sync catalogs report no data findings, roster-only ids included", async () => {
  const findings = await dataFindings({
    curated: curatedSeed(["glm-5.3"]),
    models: catalog(["glm-5.3", "roster-only-model"]),
  });
  assert.deepEqual(findings, [], "a models.json id curated.json does not list is expected, not drift");
});

test("a curated id missing from models.json is flagged as an error", async () => {
  const findings = await dataFindings({
    curated: curatedSeed(["glm-5.3", "ghost-model"], ["glm-5.3"]),
    models: catalog(["glm-5.3"]),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "error");
  assert.match(findings[0].message, /ghost-model/);
  assert.match(findings[0].message, /models\.json/);
});

test("an endpointMap route to a missing model is flagged as an error", async () => {
  const findings = await dataFindings({
    curated: curatedSeed(["glm-5.3"], ["glm-5.3", "ghost-route"]),
    models: catalog(["glm-5.3"]),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "error");
  assert.match(findings[0].message, /endpointMap compat routes ghost-route/);
});

test("an endpointMap kind with no matching endpoint is flagged as an error", async () => {
  const findings = await dataFindings({
    curated: {
      models: { "glm-5.3": { listed: true } },
      endpoints: { compat: { baseUrl: "https://example.invalid/v1" } },
      endpointMap: { openai: ["glm-5.3"] },
    },
    models: catalog(["glm-5.3"]),
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "error");
  assert.match(findings[0].message, /endpointMap routes openai/);
});

test("models.json without a valid models array is flagged as an error", async () => {
  const findings = await dataFindings({
    curated: curatedSeed(["glm-5.3"]),
    models: { models: [{ id: "glm-5.3" }, { id: "  " }] },
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /no valid models array/);
});

test("a tree without data files reports no data findings", async () => {
  const findings = await dataFindings({});
  assert.deepEqual(findings, [], "fixture and standalone roots must not invent catalog drift");
});
