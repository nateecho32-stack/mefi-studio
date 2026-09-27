import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { CLIS, singleProvider, setupScript, createCliSetup } from "../scripts/cli-setup.cjs";
import profiles from "../scripts/agent-profiles.cjs";

for (const provider of ["codex", "claude", "grok", "antigravity"]) test(`${provider} alone configures every role without other keys or model leakage`, () => {
  const settings = { aiProvider: "zen", aiRoleProviders: { heavy: "zai" }, aiModels: { heavy: "foreign-model" }, apiKeyEncrypted: "keep", executorTier: "free", agentSubtasks: { cli: "opencode", model: "other-model" }, aiModelsByProvider: { [provider]: { routine: "my-model" } }, agentSeats: { lead: { provider: "zen", model: "gpt-other" } } };
  singleProvider(settings, provider);
  assert.equal(settings.aiProvider, provider);
  assert.equal(settings.executorCli, provider);
  assert.equal(settings.modelSelection, "fixed");
  assert.equal(settings.executorTier, "auto");
  assert.deepEqual(settings.aiModels, {});
  assert.equal(settings.executorModel, "");
  assert.deepEqual(settings.aiRoleProviders, { routine: provider, heavy: provider });
  assert.deepEqual(settings.aiAutoProviders, [provider]);
  assert.equal(settings.aiAutoFallback, false);
  assert.equal(settings.aiFallbackOpenCode, false);
  assert.ok(Object.values(settings.agentSeats).every((seat) => seat.provider === provider && !seat.fast && !seat.effort));
  assert.equal(settings.agentSeats.companion.model, "my-model");
  assert.equal(settings.agentSeats.lead.model, "");
  assert.deepEqual(settings.agentSubtasks, { cli: "auto", model: "" });
  assert.equal(settings.apiKeyEncrypted, "keep");
  assert.equal(profiles.validate(profiles.extract(settings)), null);
});

test("install actions use allowlisted vendor commands and bootstrap Node only for npm tools", () => {
  for (const cli of CLIS) {
    const install = setupScript(cli.id, "install"), login = setupScript(cli.id, "login");
    assert.ok(install.includes(cli.login));
    assert.ok(login.includes(cli.login));
    assert.doesNotMatch(login, /winget install|npm.cmd install|install.ps1/);
    assert.equal(install.includes("OpenJS.NodeJS.LTS"), !!cli.package);
    assert.match(install, /GetEnvironmentVariable/);
  }
  assert.throws(() => setupScript("codex;evil", "install"));
  assert.throws(() => setupScript("codex", "run this"));
  assert.throws(() => singleProvider({}, "unknown"));
});

test("setup reports launch errors, prevents duplicate windows, and refreshes on close", async () => {
  const calls = []; let refreshes = 0, child;
  const setup = createCliSetup({ platform: "win32", cwd: "C:/fixture", refresh: async () => refreshes++, openExternal: async () => {}, spawn: (command, args, options) => {
    calls.push({ command, args, options }); child = Object.assign(new EventEmitter(), { unref() {} });
    queueMicrotask(() => child.emit("spawn")); return child;
  } });
  assert.equal((await setup.action({ id: "codex", action: "install" })).launched, true);
  assert.equal(calls[0].options.windowsHide, false, "the user explicitly opened interactive setup");
  assert.match(Buffer.from(calls[0].args.at(-1), "base64").toString("utf16le"), /@openai\/codex/);
  assert.equal((await setup.action({ id: "codex", action: "login" })).ok, false);
  child.emit("close", 0); await Promise.resolve();
  assert.equal(refreshes, 1);
  assert.equal((await setup.action({ id: "codex", action: "login" })).ok, true);
  assert.equal((await setup.action({ id: "evil", action: "install" })).ok, false);
  assert.equal(calls.length, 2);
  const broken = createCliSetup({ platform: "win32", spawn: () => { const c = new EventEmitter(); queueMicrotask(() => c.emit("error", new Error("missing shell"))); return c; } });
  assert.match((await broken.action({ id: "grok", action: "login" })).error, /missing shell/);
});
