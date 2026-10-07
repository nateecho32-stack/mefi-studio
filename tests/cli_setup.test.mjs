import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { CLIS, INSTALL_FOLDERS, singleProvider, setupScript, createCliSetup } from "../scripts/cli-setup.cjs";
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
    // The window finds a CLI in the same per-user folders Studio's own refresh adds,
    // even when its installer did not update the user PATH.
    for (const script of [install, login]) for (const folder of INSTALL_FOLDERS) assert.ok(script.includes(`"${folder}"`), `${cli.id} looks in ${folder}`);
    assert.doesNotMatch(install, /Restart Studio/, "Studio re-reads PATH itself; a restart is never the advice");
    assert.match(install, new RegExp(`the ${cli.cmd} command was not found\\. Close this window: Studio refreshes your installed tools`));
  }
  assert.deepEqual([...INSTALL_FOLDERS], ["$env:USERPROFILE\\.local\\bin", "$env:LOCALAPPDATA\\agy\\bin", "$env:APPDATA\\npm", "$env:USERPROFILE\\.grok\\bin"]);
  assert.throws(() => setupScript("codex;evil", "install"));
  assert.throws(() => setupScript("codex", "run this"));
  assert.throws(() => singleProvider({}, "unknown"));
});

test("setup reports launch errors, prevents duplicate windows, and refreshes on close", async () => {
  const calls = [], order = []; let refreshes = 0, child;
  const setup = createCliSetup({ platform: "win32", cwd: "C:/fixture", refresh: async () => { refreshes++; order.push("refresh"); }, closed: (detail) => order.push(["closed", { ...detail }]), openExternal: async () => {}, spawn: (command, args, options) => {
    calls.push({ command, args, options }); child = Object.assign(new EventEmitter(), { unref() {} });
    queueMicrotask(() => child.emit("spawn")); return child;
  } });
  const launched = await setup.action({ id: "codex", action: "install" });
  assert.equal(launched.launched, true);
  assert.match(launched.message, /Studio refreshes your installed tools when it closes \(or choose Refresh installed tools\)/);
  assert.equal(calls[0].options.windowsHide, false, "the user explicitly opened interactive setup");
  // scripts/setup-window.cjs: cmd's start gives PowerShell a console of its
  // own, so a sign-in has a terminal to ask in (tests/setup_window.test.mjs).
  assert.equal(calls[0].command, "cmd.exe");
  assert.deepEqual(calls[0].args.slice(3, 7), ["start", '"Mefi Studio: Codex setup"', "/wait", "powershell.exe"]);
  assert.equal(calls[0].options.cwd, "C:/fixture");
  assert.match(Buffer.from(calls[0].args.at(-1), "base64").toString("utf16le"), /@openai\/codex/);
  assert.equal((await setup.action({ id: "codex", action: "login" })).ok, false);
  child.emit("close", 0);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(refreshes, 1);
  // The guide hears about the closed window only after PATH was re-read.
  assert.deepEqual(order, ["refresh", ["closed", { id: "codex", action: "install" }]]);
  assert.equal((await setup.action({ id: "codex", action: "login" })).ok, true);
  assert.equal((await setup.action({ id: "evil", action: "install" })).ok, false);
  assert.equal(calls.length, 2);
  const broken = createCliSetup({ platform: "win32", spawn: () => { const c = new EventEmitter(); queueMicrotask(() => c.emit("error", new Error("missing shell"))); return c; } });
  assert.match((await broken.action({ id: "grok", action: "login" })).error, /missing shell/);
});

test("an added login signs in under its own folder, named by id and resolved by the host", async () => {
  const calls = [], closed = [], asked = [];
  const children = [];
  const setup = createCliSetup({ platform: "win32", cwd: "C:/fixture", env: () => ({ PATH: "C:/bin" }), closed: (detail) => closed.push({ ...detail }), openExternal: async () => {},
    loginEnv: async (id, account) => { asked.push([id, account]); return account === "claude-a1b2" ? { CLAUDE_CONFIG_DIR: "C:/logins/claude-a1b2" } : null; },
    spawn: (command, args, options) => {
      calls.push({ command, args, options }); const child = Object.assign(new EventEmitter(), { unref() {} }); children.push(child);
      queueMicrotask(() => child.emit("spawn")); return child;
    } });
  const main = await setup.action({ id: "claude", action: "login" });
  assert.equal(main.ok, true);
  assert.deepEqual(calls[0].options.env, { PATH: "C:/bin" }, "the main login signs in where it always has");
  const added = await setup.action({ id: "claude", action: "login", account: "claude-a1b2" });
  assert.equal(added.ok, true, "the main login's open window does not block another login's");
  assert.match(added.message, /Sign in to the other Claude Code account/);
  assert.deepEqual(calls[1].options.env, { PATH: "C:/bin", CLAUDE_CONFIG_DIR: "C:/logins/claude-a1b2" });
  assert.equal(calls[1].args[4], '"Mefi Studio: Claude Code sign-in"');
  assert.match(Buffer.from(calls[1].args.at(-1), "base64").toString("utf16le"), /claude auth login/);
  assert.doesNotMatch(Buffer.from(calls[1].args.at(-1), "base64").toString("utf16le"), /logins/, "the folder never rides the script");
  assert.equal((await setup.action({ id: "claude", action: "login", account: "claude-a1b2" })).ok, false, "one window per login");
  assert.equal((await setup.action({ id: "claude", action: "login", account: "claude-gone" })).error, "That login is not saved.");
  assert.match((await setup.action({ id: "claude", action: "install", account: "claude-a1b2" })).error, /can only be signed in/);
  assert.deepEqual(asked, [["claude", "claude-a1b2"], ["claude", "claude-a1b2"], ["claude", "claude-gone"]]);
  children[1].emit("close", 0);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(closed, [{ id: "claude", action: "login", account: "claude-a1b2" }]);
});
