import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import addons from "../scripts/agent-addons.cjs";
import profiles from "../scripts/agent-profiles.cjs";
import models from "../scripts/agent-models.cjs";

test("only a selected agent's installed skills enter its prompt and snapshots keep the selection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mefi-skill-fixture-"));
  try {
    for (const [folder, body] of [[".agents/skills/testing", "Run the relevant checks."], [".claude/skills/review", "Review boundary conditions."], [".codex/skills/too-large", "x".repeat(33000)]]) {
      await mkdir(path.join(root, folder), { recursive: true }); await writeFile(path.join(root, folder, "SKILL.md"), body);
    }
    const skills = await addons.catalog(root, { home: null }); assert.equal(skills.length, 2);
    assert.ok(skills.every((skill) => !skill.file && !JSON.stringify(skill).includes(root)));
    const id = skills.find((skill) => skill.name === "testing").id;
    const settings = { agentSkills: { companion: [id] } };
    assert.equal(profiles.validate(settings), null);
    const snapshot = profiles.capture(settings, "project"); settings.agentSkills.companion = [];
    const active = profiles.effective(settings, "project", snapshot);
    assert.match(await addons.instructions(root, active, "companion", { home: null }), /Run the relevant checks/);
    assert.equal(await addons.instructions(root, active, "desk", { home: null }), "");
    assert.equal(await addons.instructions(root, { agentSkills: { desk: ["0".repeat(24)] } }, "desk", { home: null }), "");
    assert.match(profiles.validate({ agentSkills: { companion: ["../../secret"] } }), /skills/);
    assert.match(profiles.validate({ agentSkills: { invalid: [id] } }), /skills/);
    assert.match(profiles.validate({ agentSkills: { companion: [id, id] } }), /skills/);
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith("mefi-skill-fixture-"));
    await rm(root, { recursive: true, force: true });
  }
});

test("model discovery uses the configured provider and exposes only bounded model metadata", async () => {
  const calls = [];
  const result = await models.list({ endpoint: "https://provider.invalid/v1/chat/completions", apiKey: "fixture-key", fetchImpl: async (...args) => {
    calls.push(args); return { ok: true, json: async () => ({ data: [{ id: "vendor/new", name: "New", apiKey: "do not expose" }, { id: "vendor/new" }, { id: "bad id" }] }) };
  } });
  assert.equal(calls[0][0], "https://provider.invalid/v1/models");
  assert.equal(calls[0][1].headers.authorization, "Bearer fixture-key");
  assert.equal(calls[0][1].redirect, "error");
  assert.deepEqual(result.models, [{ id: "vendor/new", name: "vendor/new" }]);
  assert.equal(JSON.stringify(result).includes("fixture-key"), false);
  assert.equal((await models.list({ endpoint: "", fetchImpl: () => assert.fail("unconfigured provider") })).ok, false);
  const failure = await models.list({ endpoint: "https://provider.invalid/v1/responses", fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(failure.ok, false); assert.match(failure.error, /401.*model ID/);
});
