import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

// The host's PATH refresh (refreshProcessPath) run against a stubbed registry
// read: a CLI installed after launch must reach the where.exe probes without a
// restart. Nothing here spawns PowerShell or touches this process's env.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
}

const INHERITED = "C:\\Windows\\system32;C:\\Program Files\\nodejs\\";
const HOME = "C:\\Users\\fixture";
const EXTRAS = [`${HOME}\\.local\\bin`, `${HOME}\\AppData\\Local\\agy\\bin`, `${HOME}\\AppData\\Roaming\\npm`];

function host({ platform = "win32", registry = () => ({ code: 0, stdout: `${INHERITED}\r\n` }) } = {}) {
  const reads = [], logs = [];
  const env = { Path: INHERITED, LOCALAPPDATA: `${HOME}\\AppData\\Local`, APPDATA: `${HOME}\\AppData\\Roaming` };
  const context = vm.createContext({
    process: { platform, env },
    path: path.win32,
    os: { homedir: () => HOME },
    logLine: (line) => logs.push(line),
    loadModule: async (rel) => {
      assert.equal(rel, "scripts/first-scan.mjs");
      return { spawnExec: async (command, args, options) => { reads.push({ command, args, options }); return registry(); } };
    },
    grokCliProbe: { checkedAt: 1, ok: false },
    claudeCliProbe: { checkedAt: 1, ok: false },
    codexCliProbe: { checkedAt: 1, ok: false },
    antigravityCliProbe: { checkedAt: 1, ok: false },
  });
  vm.runInContext(section("// Entries of `incoming` that `current` lacks", "// Whether OpenCode itself holds"), context, { filename: "main.cjs:path-refresh" });
  const probes = () => ["grokCliProbe", "claudeCliProbe", "codexCliProbe", "antigravityCliProbe"].map((name) => context[name].checkedAt);
  return { context, env, reads, logs, probes };
}

test("PATH entries compare without case or a trailing separator, and blanks never count", () => {
  const { context } = host();
  const added = context.newPathEntries("C:\\Tools;C:\\Bin\\;;", ["c:\\tools\\", "C:\\bin", "", "  ", "C:\\New", "c:\\new\\", "C:\\Other/"]);
  assert.deepEqual([...added], ["C:\\New", "C:\\Other/"], "first new spelling kept once; known and blank entries skipped");
});

test("a CLI folder added to the registry PATH after launch reaches this process", async () => {
  const claude = `${HOME}\\.claude-cli\\bin`;
  const { context, env, reads, logs, probes } = host({ registry: () => ({ code: 0, stdout: `C:\\WINDOWS\\System32;C:\\Program Files\\nodejs;${claude}\r\n` }) });
  assert.equal(await context.refreshProcessPath(), true);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].command, "powershell.exe");
  assert.match(reads[0].args.at(-1), /GetEnvironmentVariable\('Path','Machine'\).*GetEnvironmentVariable\('Path','User'\)/);
  assert.equal(reads[0].options.timeoutMs, 10000);
  assert.equal(env.Path, [INHERITED, claude, ...EXTRAS].join(";"), "existing entries keep their order and spelling; new ones are appended");
  assert.deepEqual(probes(), [0, 0, 0, 0], "cached where.exe answers are dropped so routing re-probes");
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /claude-cli|fixture/, "the log names a count, not the owner's folders");

  // Nothing new on the next read: no rewrite, no probe churn.
  const before = env.Path;
  for (const name of ["grokCliProbe", "claudeCliProbe", "codexCliProbe", "antigravityCliProbe"]) context[name].checkedAt = 7;
  assert.equal(await context.refreshProcessPath(), false);
  assert.equal(reads.length, 2);
  assert.equal(env.Path, before);
  assert.deepEqual(probes(), [7, 7, 7, 7]);
  assert.equal(logs.length, 1);
});

test("callers that ask while a read is out share it, and the next ask reads again", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { context, reads } = host({ registry: async () => { await gate; return { code: 0, stdout: `${INHERITED};C:\\Late\\bin` }; } });
  const first = context.refreshProcessPath(), second = context.refreshProcessPath();
  assert.equal(first, second, "one promise for concurrent callers");
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(reads.length, 1);
  await context.refreshProcessPath();
  assert.equal(reads.length, 2, "a settled read is not cached");
});

test("a failed or empty registry read leaves PATH alone and never rejects", async () => {
  for (const registry of [() => ({ code: 1, stdout: "" }), () => ({ code: 0, stdout: "   " }), () => { throw new Error("powershell missing"); }]) {
    const { context, env, probes } = host({ registry });
    assert.equal(await context.refreshProcessPath(), false);
    assert.equal(env.Path, INHERITED);
    assert.deepEqual(probes(), [1, 1, 1, 1]);
  }
});

test("other platforms keep the inherited PATH without spawning", async () => {
  const { context, env, reads } = host({ platform: "linux" });
  assert.equal(await context.refreshProcessPath(), false);
  assert.equal(reads.length, 0);
  assert.equal(env.Path, INHERITED);
});

test("the CLI pills, auto setup and startup refresh PATH before a CLI is looked up", () => {
  assert.match(source, /ipcMain\.handle\("studio:cli-status", async \(\) => \{\n\s*await refreshProcessPath\(\);\n\s*return codingCliStatus\(\);/);
  assert.match(section("  async function autoSetup(", "  runAutoSetup = autoSetup;"), /await refreshProcessPath\(\);\n\s*const clis = await codingCliStatus\(\);/);
  const launch = section("app.whenReady().then(() => {", "  createWindow();");
  assert.ok(launch.indexOf("void refreshProcessPath()") >= 0 && launch.indexOf("void refreshProcessPath()") < launch.indexOf("startupResumed = startupResume();"), "the startup read begins before the resume check and the window");
  assert.doesNotMatch(section("function refreshProcessPath(", "// Whether OpenCode itself holds"), /providerBreaker/, "a settings re-read never unpauses a failing route");
});
