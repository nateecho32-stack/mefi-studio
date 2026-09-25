import test from "node:test";
import assert from "node:assert/strict";
import profiles from "../scripts/agent-profiles.cjs";
import resume from "../scripts/executor-resume.cjs";
import { executorHost } from "./fixtures/host_executor.mjs";

const base = () => ({ aiProvider: "zen", aiModels: { routine: "gpt-6-luna", heavy: "gpt-6-sol" }, agentSeats: { desk: { model: "gpt-6-sol", effort: "high", fast: true } }, autopilot: { enabled: false, parallel: 3 }, zenApiKeyEncrypted: "secret", customEndpoint: "https://local.invalid" });
const save = (settings, projectId, configuration, extra = {}) => profiles.mutate(settings, { action: "save", revision: profiles.view(settings, projectId).revision, configuration, ...extra }, { projectId, id: "team-one" });

test("teams inherit until configured; project copies never acquire subsequent default fields", () => {
  const settings = base();
  assert.equal(profiles.view(settings, "a").inherited, true);
  assert.ok(save(settings, "a", profiles.extract(settings)).ok);
  settings.aiProvider = "codex"; settings.agentBrain = { nestedDelegation: true };
  assert.equal(profiles.effective(settings, "a").aiProvider, "zen");
  assert.equal(profiles.effective(settings, "a").agentBrain, undefined);
  assert.equal(profiles.effective(settings, "b").aiProvider, "codex");
  assert.equal(profiles.effective(settings, "a").zenApiKeyEncrypted, "secret");
  assert.equal(profiles.view(settings, "a").configuration.zenApiKeyEncrypted, undefined);
});

test("preset creation, duplicate, rename, application and deletion keep independent copies", () => {
  const settings = base();
  const change = (action, extra = {}, id = "team-one") => profiles.mutate(settings, { action, revision: profiles.view(settings, "a").revision, ...extra }, { projectId: "a", id });
  assert.ok(change("preset-save", { name: "Calm team", configuration: profiles.extract(settings) }).ok);
  assert.ok(change("preset-save", { name: "Copy", configuration: profiles.view(settings, "a").presets[0].configuration }, "team-two").ok);
  assert.ok(change("apply", { id: "team-one" }).ok);
  assert.ok(change("preset-save", { id: "team-one", name: "Updated", configuration: { aiProvider: "codex" } }).ok);
  assert.equal(profiles.view(settings, "a").configuration.aiProvider, "zen");
  assert.ok(save(settings, "a", { aiProvider: "claude" }).ok);
  assert.equal(profiles.view(settings, "a").presets[0].configuration.aiProvider, "codex");
  assert.equal(profiles.view(settings, "a").presets[1].name, "Copy");
  assert.ok(change("preset-delete", { id: "team-one" }).ok);
  assert.equal(profiles.view(JSON.parse(JSON.stringify(settings)), "a").configuration.aiProvider, "claude");
  assert.ok(change("inherit").ok); assert.equal(profiles.view(settings, "a").inherited, true);
});

test("stale saves and unsafe configuration leave the transaction untouched", () => {
  const settings = base(), before = JSON.stringify(settings);
  assert.equal(profiles.mutate(settings, { action: "save", revision: 99, configuration: {} }, { projectId: "a" }).stale, true);
  for (const field of ["zenApiKeyEncrypted", "autopilot", "customEndpoint", "enabled", "parallel"]) assert.equal(save(settings, "a", { [field]: "bad" }).ok, false);
  assert.equal(JSON.stringify(settings), before);
  assert.match(profiles.validate({ aiProvider: "codex", agentEfforts: { routine: "max" } }), /not supported/);
  assert.match(profiles.validate({ agentSeats: { lead: { provider: "auto", fast: true } } }), /Fast mode/);
  assert.match(profiles.validate({ agentSeats: { lead: { model: "claude-opus", effort: "max" } } }), /effort/);
  assert.equal(profiles.validate(profiles.extract(base())), null);
  assert.deepEqual(profiles.capabilities("zen", "gpt-4o").efforts, []);
  assert.deepEqual(profiles.capabilities("openrouter", "openai/o3").efforts, ["low", "medium", "high"]);
  assert.equal(profiles.capabilities("claude", "gpt-6-sol").fast, false);
});

test("concurrent calls and interrupted continuations retain their admitted team", async () => {
  const settings = base(), first = profiles.capture(settings, "a");
  await profiles.run(first, async () => {
    settings.aiProvider = "codex"; settings.agentBrain = { deskTool: true };
    await Promise.resolve();
    assert.equal(profiles.effective(settings, "a", profiles.current()).aiProvider, "zen");
    assert.equal(profiles.effective(settings, "a", profiles.current()).agentBrain, undefined);
    const checkpoint = resume.checkpoint({ id: "run", projectId: "a", ref: { title: "Task" }, agentConfiguration: profiles.current() });
    await profiles.run(profiles.capture(settings, "b"), async () => {
      assert.equal(profiles.current().configuration.aiProvider, "codex");
      assert.equal(profiles.resume(checkpoint.agentConfiguration, "b"), false);
      assert.equal(profiles.resume(checkpoint.agentConfiguration, "a"), true);
      assert.equal(profiles.current().configuration.aiProvider, "zen");
    });
    assert.equal(profiles.current().projectId, "a");
  });
  assert.equal(profiles.current(), null);
});

test("automatic setup and workflow patches share scoped resolution without starting work", () => {
  const settings = base();
  profiles.update(settings, "a", (next) => { next.executorCli = "codex"; next.modelSelection = "fixed"; });
  assert.equal(profiles.effective(settings, "a").executorCli, "codex");
  assert.equal(profiles.effective(settings, "b").executorCli, undefined);
  assert.deepEqual(settings.autopilot, { enabled: false, parallel: 3 });
  assert.equal(settings.zenApiKeyEncrypted, "secret");
});

test("real dispatch restores an interrupted attempt's team before resolving its worker route", async () => {
  const original = { id: "keep-routing", title: "Implement retained routing", prompt: "Preserve the accepted configuration.", status: "open", createdAt: 1, files: ["src/retained.js"] };
  const first = executorHost({ tasks: [original], savedSettings: { aiProvider: "zen", executorCli: "codex" } });
  first.env.agentProfiles = profiles; first.env.structuredClone = structuredClone;
  await first.env.spawnNextJob();
  const entry = first.autopilot.jobs[0]; assert.ok(entry?.agentConfiguration);
  const checkpoint = resume.checkpoint(entry); checkpoint.pending = true;
  const next = executorHost({ tasks: [{ ...original, runProgress: checkpoint }], savedSettings: { aiProvider: "claude", executorCli: "claude" } });
  next.env.agentProfiles = profiles; next.env.structuredClone = structuredClone;
  let resolved;
  next.env.executorRunEnv = async () => { resolved = await next.env.readAgentSettings(); return { via: "fixture", modelArgs: "", env: {} }; };
  await next.env.spawnNextJob();
  assert.equal(resolved.executorCli, "codex"); assert.equal(resolved.aiProvider, "zen");
  assert.equal(next.autopilot.jobs[0].agentConfiguration.configuration.executorCli, "codex");
});
