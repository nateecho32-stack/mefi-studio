// Advisory checks (ZB3): which lint, typecheck and build a project has, how a run is read into
// ok / warn / bad / skipped, the runner with a fake spawner (safety: allowlisted commands, a hard
// limit that ends the tree, capped and scrubbed output, Studio's keys withheld), the two
// builder-only tools run_check and project_logs (declared, gated, refused elsewhere), the file the
// builder reads its logs from, and the preview's own longer memory of its output.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { spawn as realSpawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const advisory = require("../scripts/advisory-checks.cjs");
const { createAdvisoryChecks, checkTool, logsTool } = require("../scripts/advisory-checks-host.cjs");
const { createSpawn, spawn: platformSpawn } = require("../scripts/platform.cjs");
const tools = require("../scripts/agent-tools.cjs");
const configs = require("../scripts/agent-tool-configs.cjs");
const { createProjectPreview } = require("../scripts/project-preview.cjs");

const temp = (t) => { const dir = mkdtempSync(path.join(tmpdir(), "mefi-advisory-")); t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })); return dir; };
const NODE_PROJECT = { scripts: { typecheck: "tsc --noEmit", lint: "eslint .", build: "vite build", test: "node --test", dev: "vite" } };

// ---- the table ----------------------------------------------------------------------------------
test("the module is pure and its limits are the ones the docs state", () => {
  const source = readFileSync(new URL("../scripts/advisory-checks.cjs", import.meta.url), "utf8");
  assert.match(source.slice(0, 4000), /Pure module: no Electron, no filesystem, no network, no processes, no/);
  assert.equal(advisory.LIMITS.checkMs, 120000);
  assert.equal(advisory.LIMITS.toolMs, 90000);
});

test("a package.json's typecheck, lint and build scripts are found, in the order the table names them", () => {
  const found = advisory.detect({ packageJson: NODE_PROJECT, names: ["package.json"] });
  assert.deepEqual(found.map((check) => [check.id, check.label, check.kind, check.command.display, check.auto, check.writes]), [
    ["typecheck", "Typecheck", "typecheck", "npm run typecheck", true, false],
    ["lint", "Lint", "lint", "npm run lint", true, false],
    ["build", "Build", "build", "npm run build", false, true],
  ]);
  assert.deepEqual(found[0].command, { exe: "npm", args: ["run", "typecheck"], display: "npm run typecheck" });
  for (const [scripts, expected] of [
    [{ "type-check": "x" }, "type-check"], [{ "check:types": "x" }, "check:types"], [{ tsc: "x" }, "tsc"], [{ "test:types": "x" }, "test:types"], [{ types: "x" }, "types"],
    [{ tsc: "a", typecheck: "b", "test:types": "c" }, "typecheck"],
  ]) assert.equal(advisory.detect({ packageJson: { scripts } })[0].command.args[1], expected, JSON.stringify(scripts));
  assert.equal(advisory.detect({ packageJson: { scripts: { eslint: "x" } } })[0].command.args[1], "eslint");
  assert.equal(advisory.detect({ packageJson: { scripts: { "lint:check": "x", lint: "y" } } })[0].command.args[1], "lint");
  assert.deepEqual(advisory.detect({ packageJson: { scripts: { test: "x", dev: "y", start: "z", check: "w", preview: "v" } } }), [], "tests, servers and the project's own check are not advisory checks");
  assert.deepEqual(advisory.detect({ packageJson: { scripts: { "lint;rm -rf": "x", "ty pe": "y" } } }), [], "a script name outside the table's words is never used");
  assert.deepEqual(advisory.detect({ packageJson: { scripts: { lint: "" } } }), [], "an empty script is no script");
});

test("a lint script that fixes files is found but never run", () => {
  for (const script of ["eslint . --fix", "prettier --write .", "biome check --write", "eslint --fix src && tsc"]) {
    const [lint] = advisory.detect({ packageJson: { scripts: { lint: script } } });
    assert.equal(lint.auto, false, script);
    assert.match(lint.skip, /fixes files/, script);
    assert.deepEqual(advisory.planAuto([lint]), []);
    assert.equal(advisory.placeholder(lint).status, "skipped");
  }
  assert.equal(advisory.detect({ packageJson: { scripts: { lint: "eslint ." } } })[0].skip, undefined);
});

test("Python, Rust and Go projects are found from their own files", () => {
  const ids = (facts) => advisory.detect(facts).map((check) => check.id);
  assert.deepEqual(ids({ names: ["ruff.toml"] }), ["ruff"]);
  assert.deepEqual(ids({ names: [".ruff.toml"] }), ["ruff"]);
  assert.deepEqual(ids({ names: ["pyproject.toml"], pyproject: "[project]\nname = 'x'\n\n[tool.ruff]\nline-length = 100\n" }), ["ruff"]);
  assert.deepEqual(ids({ pyproject: "[tool.ruff.lint]\nselect = ['E']\n" }), ["ruff"]);
  assert.deepEqual(ids({ names: ["mypy.ini"] }), ["mypy"]);
  assert.deepEqual(ids({ pyproject: "[tool.mypy]\nstrict = true\n" }), ["mypy"]);
  assert.deepEqual(ids({ setupCfg: "[metadata]\nname = x\n\n[mypy]\nignore_missing_imports = True\n" }), ["mypy"]);
  assert.deepEqual(ids({ names: ["Cargo.toml"] }), ["cargo-check"], "file names are matched without regard to case");
  assert.deepEqual(ids({ names: ["go.mod"] }), ["go-vet"]);
  assert.deepEqual(ids({ pyproject: "[project]\nname = 'plain'\n", names: ["pyproject.toml"] }), [], "a Python project with neither tool configured has no check");
  assert.deepEqual(advisory.detect({ names: ["go.mod"] })[0].command, { exe: "go", args: ["vet", "./..."], display: "go vet ./..." });
  assert.deepEqual(advisory.detect({ names: ["cargo.toml"] })[0].command.args, ["check", "--message-format", "short"]);
  const mixed = advisory.detect({ packageJson: NODE_PROJECT, names: ["package.json", "ruff.toml", "go.mod", "Cargo.toml"] });
  assert.deepEqual(mixed.map((check) => check.id), ["typecheck", "lint", "build", "ruff", "cargo-check", "go-vet"], "a project with several toolchains lists them all");
  assert.equal(new Set(mixed.map((check) => check.id)).size, mixed.length, "ids are unique");
  assert.ok(mixed.every((check) => advisory.ID.test(check.id)));
});

test("nothing on disk, or nonsense on disk, is no checks", () => {
  for (const facts of [undefined, null, {}, { packageJson: null }, { packageJson: [] }, { packageJson: { scripts: "x" } }, { packageJson: { scripts: null } }, { names: "no" }, { pyproject: 5 }]) assert.deepEqual(advisory.detect(facts), [], JSON.stringify(facts));
});

test("what runs by itself is the auto checks, plus the build only when the owner turned it on", () => {
  const found = advisory.detect({ packageJson: NODE_PROJECT, names: ["Cargo.toml"] });
  assert.deepEqual(advisory.planAuto(found, {}).map((check) => check.id), ["typecheck", "lint"]);
  assert.deepEqual(advisory.planAuto(found, { advisoryBuild: true }).map((check) => check.id), ["typecheck", "lint", "build"]);
  assert.deepEqual(advisory.planAuto(found, { advisoryBuild: "yes" }).map((check) => check.id), ["typecheck", "lint"], "only a real true counts");
  const build = found.find((check) => check.id === "build");
  assert.match(advisory.placeholder(build, {}).detail, /Not run on its own, because a build writes files\. Run it now\./);
  assert.match(advisory.placeholder(found.find((check) => check.id === "cargo-check")).detail, /Not run on its own\. Run it now\./);
  assert.equal(advisory.placeholder(found[0], {}).detail, "Not run yet.");
  assert.deepEqual(advisory.planAuto(null), []);
});

// ---- reading a run --------------------------------------------------------------------------------
test("output is trimmed to its last lines with no colour codes, and never past the caps", () => {
  assert.equal(advisory.trimOutput("\u001b[31mred\u001b[0m\nplain\n\n\n"), "red\nplain");
  assert.equal(advisory.trimOutput(Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n"), { lines: 3 }), "line 97\nline 98\nline 99");
  assert.equal(advisory.trimOutput("a\r\nb\rc\r\n"), "a\nb\nc");
  assert.ok(advisory.trimOutput("x".repeat(10000)).length <= advisory.LIMITS.tailChars, "a line is cut at 400 and the whole at the limit");
  assert.ok(advisory.trimOutput("y".repeat(300).concat("\n").repeat(30)).length <= advisory.LIMITS.tailChars);
  assert.equal(advisory.trimOutput(null), "");
  assert.equal(advisory.stripAnsi("\u001b[1;32mok\u001b[0m"), "ok");
});

test("each well-known tool's summary line is read for its errors and warnings", () => {
  assert.deepEqual(advisory.countProblems("\n✖ 5 problems (3 errors, 2 warnings)\n"), { errors: 3, warnings: 2 });
  assert.deepEqual(advisory.countProblems("src/a.ts(1,1): error TS2322: x\nFound 2 errors in 1 file.\n"), { errors: 2, warnings: null });
  assert.deepEqual(advisory.countProblems("Found 1 error."), { errors: 1, warnings: null });
  assert.deepEqual(advisory.countProblems("Found 3 errors in 2 files (checked 9 source files)"), { errors: 3, warnings: null });
  assert.deepEqual(advisory.countProblems("src/a.ts(1,1): error TS2322: x\nsrc/b.ts(2,2): error TS2304: y"), { errors: 2, warnings: null }, "no summary: the error lines are counted");
  assert.deepEqual(advisory.countProblems("warning: `demo` (lib) generated 2 warnings\nwarning: `demo` (bin \"demo\") generated 1 warning"), { errors: null, warnings: 3 });
  assert.deepEqual(advisory.countProblems("src/main.rs:3:5: error[E0425]: cannot find value\nerror: could not compile `demo` due to 2 previous errors"), { errors: 2, warnings: null });
  assert.deepEqual(advisory.countProblems("./main.go:12:3: unreachable code\n./util.go:4:1: composite literal uses unkeyed fields\n"), { errors: 2, warnings: null });
  assert.deepEqual(advisory.countProblems("all good"), { errors: null, warnings: null });
  assert.deepEqual(advisory.countProblems(""), { errors: null, warnings: null });
});

test("a run becomes one line: ok, warn, bad or skipped, with a short detail and its time", () => {
  const row = (extra) => advisory.normalize({ id: "lint", label: "Lint", kind: "lint", exitCode: 0, output: "", ms: 900, ...extra });
  assert.deepEqual(row({}), { id: "lint", label: "Lint", ms: 900, status: "ok", detail: "clean" });
  assert.deepEqual(row({ kind: "typecheck", id: "typecheck", label: "Typecheck", ms: 1234 }), { id: "typecheck", label: "Typecheck", ms: 1234, status: "ok", detail: "0 errors" });
  assert.equal(row({ kind: "build", ms: 1900 }).detail, "1.9 s", "a build reports its time");
  assert.equal(row({ kind: "build", ms: 420 }).detail, "420 ms");
  assert.equal(row({ kind: "build", ms: 12500 }).detail, "13 s");
  assert.equal(row({ kind: "other" }).detail, "passed");
  const warn = row({ output: "✖ 2 problems (0 errors, 2 warnings)" });
  assert.deepEqual([warn.status, warn.detail, warn.tail], ["warn", "2 warnings", "✖ 2 problems (0 errors, 2 warnings)"]);
  assert.equal(row({ output: "warning: `x` (lib) generated 1 warning" }).detail, "1 warning", "singular");
  const bad = row({ exitCode: 1, output: "✖ 4 problems (4 errors, 0 warnings)" });
  assert.deepEqual([bad.status, bad.detail], ["bad", "4 errors"]);
  assert.equal(row({ exitCode: 2, output: "boom" }).detail, "Failed (exit 2)");
  assert.equal(row({ exitCode: null }).detail, "Failed (exit ?)");
  const slow = row({ timedOut: true, ms: 120000 });
  assert.deepEqual([slow.status, slow.detail], ["warn", "Stopped after 120 s: it needs longer than Studio waits."], "a check that ran out of time is not a failed check");
  assert.deepEqual(row({ skipped: "Not run." }), { id: "lint", label: "Lint", ms: 0, status: "skipped", detail: "Not run." });
  assert.equal(row({ spawnError: "ENOENT", command: "ruff" }).detail, "ruff is not installed here.");
  assert.equal(row({ spawnError: "EACCES" }).detail, "It could not be started.");
  assert.equal(row({ skipped: "x".repeat(400) }).detail.length, advisory.LIMITS.detailChars);
  assert.equal(row({ ms: -5 }).ms, 0);
  assert.equal("tail" in row({}), false, "a clean run carries no output");
  assert.equal(advisory.worst([{ status: "ok" }, { status: "warn" }, { status: "skipped" }]), "warn");
  assert.equal(advisory.worst([{ status: "ok" }, { status: "bad" }, { status: "warn" }]), "bad");
  assert.equal(advisory.worst([{ status: "skipped" }]), null);
  assert.equal(advisory.worst(null), null);
});

test("a builder gets the line and the end of the output; the log tail says how much was cut", () => {
  const tool = advisory.toolResult({ id: "lint", label: "Lint", status: "bad", detail: "4 errors", ms: 1200, tail: "x" }, `${Array.from({ length: 200 }, (_, index) => `out ${index}`).join("\n")}\n`);
  assert.deepEqual(Object.keys(tool), ["id", "label", "status", "detail", "ms", "output"]);
  assert.ok(tool.output.length <= advisory.LIMITS.toolChars);
  assert.ok(tool.output.endsWith("out 199"));
  assert.deepEqual(advisory.logLines("a\nb\nc\nd\n\n", 2), { lines: ["c", "d"], total: 4, cut: 2 });
  assert.deepEqual(advisory.logLines("a\n", 0).lines, ["a"], "at least one line");
  assert.equal(advisory.logLines(Array.from({ length: 500 }, (_, index) => `l${index}`).join("\n"), 9999).lines.length, 200, "at most two hundred");
  assert.deepEqual(advisory.logLines("\u001b[31mred\u001b[0m", 5).lines, ["red"]);
  assert.match(advisory.NOTHING_LOGGED, /^Nothing captured/);
});

// ---- the runner, with a fake process --------------------------------------------------------------
function fakeSpawner({ script = () => ({ code: 0, out: "" }), pid = 4242 } = {}) {
  const calls = [];
  let active = 0;
  let peak = 0;
  const spawn = (command, args, options) => {
    const record = { command, args: [...args], options };
    calls.push(record);
    const child = new EventEmitter();
    child.pid = pid;
    child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
    child.kill = () => { record.killed = true; };
    if (command === "taskkill") { setImmediate(() => child.emit("close", 0)); return child; }
    const plan = script(record, child);
    if (plan === "spawn-error") { setImmediate(() => child.emit("error", Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT" }))); return child; }
    if (plan === "hang") { active += 1; peak = Math.max(peak, active); record.hung = () => { active -= 1; child.emit("close", null, "SIGKILL"); }; return child; }
    active += 1; peak = Math.max(peak, active);
    setImmediate(() => { if (plan.out) child.stdout.emit("data", plan.out); if (plan.err) child.stderr.emit("data", plan.err); active -= 1; child.emit("close", plan.code, null); });
    return child;
  };
  return { spawn, calls, peak: () => peak };
}
const lintCheck = () => advisory.detect({ packageJson: { scripts: { lint: "eslint ." } } })[0];

test("a check runs in the folder with no stdin, plain output and the whole environment minus Studio's keys", async () => {
  const fake = fakeSpawner({ script: () => ({ code: 0, out: "all good\n" }) });
  const env = { PATH: "/bin", KEEP_ME: "1", MEFI_STUDIO_ZAI_KEY: "sk-secret", MEFI_STUDIO_HUB_TOKEN: "tok-secret", mefi_studio_other_key: "lower" };
  const runner = createAdvisoryChecks({ spawn: createSpawn({ spawnImpl: fake.spawn, platform: "linux", env }), platform: "linux", env: () => env });
  const { result } = await runner.run("/work/project", lintCheck());
  assert.deepEqual([result.status, result.detail], ["ok", "clean"]);
  const [call] = fake.calls;
  assert.equal(call.command, "npm");
  assert.deepEqual(call.args, ["run", "lint"]);
  assert.equal(call.options.cwd, "/work/project");
  assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"], "nothing to read from: a prompt cannot hold it");
  assert.equal(call.options.detached, true, "on POSIX it leads its own group so the whole tree can end");
  assert.equal(call.options.env.NO_COLOR, "1");
  assert.equal(call.options.env.KEEP_ME, "1", "the rest of the environment passes");
  assert.equal(call.options.env.MEFI_STUDIO_ZAI_KEY, undefined, "Studio's own keys are withheld");
  assert.equal(call.options.env.MEFI_STUDIO_HUB_TOKEN, undefined);
  assert.equal(call.options.env.mefi_studio_other_key, undefined);
  const source = readFileSync(new URL("../scripts/advisory-checks-host.cjs", import.meta.url), "utf8");
  assert.match(source, /platformSpawn = require\("\.\/platform\.cjs"\)\.spawn/, "the default spawn is the shared one that withholds the keys");
  assert.doesNotMatch(source, /shell:\s*true|exec\(|execSync/, "no shell option");
});

test("on Windows npm goes through cmd.exe with a line built from checked words, and nothing else does", async () => {
  const fake = fakeSpawner();
  const runner = createAdvisoryChecks({ spawn: fake.spawn, platform: "win32" });
  await runner.run("C:\\proj", lintCheck());
  assert.deepEqual([fake.calls[0].command, fake.calls[0].args], ["cmd.exe", ["/d", "/s", "/c", "npm run lint"]]);
  assert.equal("detached" in fake.calls[0].options, false);
  await runner.run("C:\\proj", advisory.detect({ names: ["go.mod"] })[0]);
  assert.deepEqual([fake.calls[1].command, fake.calls[1].args], ["go", ["vet", "./..."]], "a real program is started directly");
  const tampered = { ...lintCheck(), command: { exe: "npm", args: ["run", "lint"], display: "npm run lint & calc.exe" } };
  await runner.run("C:\\proj", tampered);
  assert.equal(fake.calls[2].args[3], "npm run lint", "the display text is never the command line");
});

test("only the table's programs with the table's arguments are ever started", async () => {
  const fake = fakeSpawner();
  const runner = createAdvisoryChecks({ spawn: fake.spawn, platform: "linux" });
  const bad = [
    { id: "x", command: { exe: "rm", args: ["-rf", "/"] } },
    { id: "x", command: { exe: "npm", args: ["run", "lint; rm -rf /"] } },
    { id: "x", command: { exe: "npm", args: ["exec", "evil"] } },
    { id: "x", command: { exe: "npm", args: ["run", "lint", "--", "--fix"] } },
    { id: "x", command: { exe: "cargo", args: ["check\nrm"] } },
    { id: "x", command: { exe: "go", args: [1] } },
    { id: "x", command: { exe: "node", args: ["-e", "1"] } },
    { id: "x", command: null }, { id: "x" }, null, undefined,
  ];
  for (const check of bad) {
    const { result } = await runner.run("/p", check);
    assert.deepEqual([result.status, result.detail], ["skipped", "Studio does not run that."], JSON.stringify(check));
  }
  assert.equal(fake.calls.length, 0, "not one process was started");
  const fixer = advisory.detect({ packageJson: { scripts: { lint: "eslint --fix ." } } })[0];
  assert.match((await runner.run("/p", fixer)).result.detail, /fixes files/);
  assert.equal(fake.calls.length, 0);
});

test("a check that runs too long is ended with its whole tree at the limit and reads as a warning", async () => {
  const fake = fakeSpawner({ script: () => "hang" });
  const runner = createAdvisoryChecks({ spawn: fake.spawn, platform: "win32" });
  const started = Date.now();
  const { result } = await runner.run("C:\\proj", lintCheck(), { timeoutMs: 60 });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /^Stopped after/);
  assert.ok(Date.now() - started < 4000, "and it answered, though the fake never closed");
  const killer = fake.calls.find((call) => call.command === "taskkill");
  assert.deepEqual(killer.args, ["/pid", "4242", "/t", "/f"], "the whole tree, not just the top process");
  fake.calls[0].hung?.();
});

test("output is kept only up to a cap, from its end, and credentials in it are masked", async () => {
  const noise = "y".repeat(1000);
  const fake = fakeSpawner({ script: () => ({ code: 1, out: `${Array.from({ length: 2000 }, () => noise).join("\n")}\nsk-abcdefghijklmnopqrstuvwxyz0123456789 Authorization: Bearer abcdef0123456789abcdef\n✖ 7 problems (7 errors, 0 warnings)\n` }) });
  const runner = createAdvisoryChecks({ spawn: fake.spawn, platform: "linux" });
  const { result, output } = await runner.run("/p", lintCheck());
  assert.ok(output.length <= advisory.LIMITS.outputBytes, `2 MB of output became ${output.length}`);
  assert.deepEqual([result.status, result.detail], ["bad", "7 errors"], "the summary at the end survived the cap");
  assert.ok(result.tail.length <= advisory.LIMITS.tailChars);
  assert.doesNotMatch(output, /sk-abcdefghijklmnopqrstuvwxyz0123456789/, "a key is masked");
});

test("a tool that is not installed, or a spawn that throws, is a skipped line and never an error", async () => {
  const runner = createAdvisoryChecks({ spawn: fakeSpawner({ script: () => "spawn-error" }).spawn, platform: "linux" });
  assert.equal((await runner.run("/p", lintCheck())).result.detail, "npm is not installed here.");
  const throwing = createAdvisoryChecks({ spawn: () => { throw Object.assign(new Error("no"), { code: "EACCES" }); }, platform: "linux", log: () => {} });
  assert.deepEqual([(await throwing.run("/p", lintCheck())).result.status], ["skipped"]);
});

test("at most two checks run at once, wherever they were asked for", async () => {
  const fake = fakeSpawner({ script: () => "hang" });
  const runner = createAdvisoryChecks({ spawn: fake.spawn, platform: "linux" });
  const running = Array.from({ length: 5 }, () => runner.run("/p", lintCheck(), { timeoutMs: 5000 }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(fake.calls.filter((call) => call.command === "npm").length, 2, "two started, three wait");
  for (let round = 0; round < 5; round += 1) { for (const call of fake.calls) call.hung?.(); await new Promise((resolve) => setTimeout(resolve, 20)); }
  await Promise.all(running);
  assert.equal(fake.peak(), 2);
});

test("switched off, nothing is found and nothing runs", async (t) => {
  const dir = temp(t);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint ." } }));
  const fake = fakeSpawner();
  const off = createAdvisoryChecks({ spawn: fake.spawn, platform: "linux", disabled: () => true });
  assert.deepEqual(await off.detect(dir), []);
  assert.match((await off.run(dir, lintCheck())).result.detail, /switched off/);
  assert.deepEqual(await off.runAll(dir, {}), []);
  assert.equal(fake.calls.length, 0);
  const previous = process.env.MEFI_STUDIO_NO_ADVISORY_CHECKS;
  process.env.MEFI_STUDIO_NO_ADVISORY_CHECKS = "1";
  try { assert.deepEqual(await createAdvisoryChecks({ spawn: fake.spawn }).detect(dir), [], "MEFI_STUDIO_NO_ADVISORY_CHECKS=1 is the default kill switch"); }
  finally { if (previous === undefined) delete process.env.MEFI_STUDIO_NO_ADVISORY_CHECKS; else process.env.MEFI_STUDIO_NO_ADVISORY_CHECKS = previous; }
});

test("detect reads the folder, and runAll runs the auto checks in order and lists the rest as not run", async (t) => {
  const dir = temp(t);
  writeFileSync(path.join(dir, "package.json"), `\uFEFF${JSON.stringify(NODE_PROJECT)}`);
  writeFileSync(path.join(dir, "pyproject.toml"), "[tool.ruff]\nline-length = 88\n");
  const runner = createAdvisoryChecks({ spawn: fakeSpawner({ script: (call) => ({ code: call.args[1] === "lint" ? 1 : 0, out: call.args[1] === "lint" ? "it broke" : "" }) }).spawn, platform: "linux" });
  assert.deepEqual((await runner.detect(dir)).map((check) => check.id), ["typecheck", "lint", "build", "ruff"]);
  const results = await runner.runAll(dir, { prefs: {} });
  assert.deepEqual(results.map((row) => [row.id, row.status]), [["typecheck", "ok"], ["lint", "bad"], ["build", "skipped"], ["ruff", "ok"]]);
  assert.equal(results[1].detail, "Failed (exit 1)", "a summary this tool does not print falls back to the exit code");
  assert.match(results[2].detail, /Run it now/);
  const withBuild = await runner.runAll(dir, { prefs: { advisoryBuild: true } });
  assert.equal(withBuild[2].status, "ok", "the build joins when the owner asked");
  const tight = await runner.runAll(dir, { prefs: {}, totalMs: 4000 });
  assert.deepEqual(tight.map((row) => row.status), ["skipped", "skipped", "skipped", "skipped"], "no time left: each says so");
  assert.match(tight[0].detail, /used up the time/);
  assert.deepEqual(await runner.detect(path.join(dir, "missing")), []);
  assert.deepEqual(await runner.detect(""), []);
});

test("a real npm script runs, its output is read, and a real hang is ended at the limit", { timeout: 60000 }, async (t) => {
  const dir = temp(t);
  // `node` from the PATH the app's own tools use: a path in quotes with doubled backslashes is not what a project's scripts hold.
  const node = "node";
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fx", version: "1.0.0", scripts: {
    lint: `${node} -e "console.log('✖ 3 problems (1 errors, 2 warnings)'); process.exit(1)"`,
    typecheck: `${node} -e "console.log('fine')"`,
    build: `${node} -e "setTimeout(() => {}, 60000)"`,
  } }));
  const runner = createAdvisoryChecks({ platform: process.platform });
  const found = await runner.detect(dir);
  const typecheck = await runner.run(dir, found.find((check) => check.id === "typecheck"));
  const lint = await runner.run(dir, found.find((check) => check.id === "lint"));
  if (typecheck.result.status === "skipped") { t.skip("npm is not available here"); return; }
  assert.deepEqual([typecheck.result.status, typecheck.result.detail], ["ok", "0 errors"], `typecheck answered ${JSON.stringify(typecheck).slice(0, 700)}`);
  assert.deepEqual([lint.result.status, lint.result.detail], ["bad", "1 error"], `lint answered ${JSON.stringify(lint).slice(0, 700)}`);
  const started = Date.now();
  const slow = await runner.run(dir, found.find((check) => check.id === "build"), { timeoutMs: 1500 });
  assert.equal(slow.result.status, "warn");
  assert.ok(Date.now() - started < 15000, `ended at the limit (${Date.now() - started} ms)`);
});

// ---- the tools a builder is offered --------------------------------------------------------------
test("run_check and project_logs are offered to a builder and to no other role", async () => {
  const names = async (settings, role) => (await tools.definitions(settings, role)).map((tool) => tool.name);
  assert.deepEqual((await names({}, "builder")).slice(-2), ["run_check", "project_logs"]);
  for (const role of ["routine", "heavy", "companion", "scout", "overseer", "lead", "desk"]) {
    const list = await names({}, role);
    assert.equal(list.includes("run_check") || list.includes("project_logs"), false, `${role} is not offered them`);
    assert.equal((await names({ review: { advisory: true }, agentTools: { [role]: { projectRead: true } } }, role)).some((name) => /run_check|project_logs/.test(name)), false, `${role} still is not`);
  }
  const run = (await tools.definitions({}, "builder")).find((tool) => tool.name === "run_check");
  assert.deepEqual(run.inputSchema.required, ["id"]);
  assert.match(run.description, /never decides whether the task is done/);
  assert.match(run.description, /untrusted/i);
  const logs = (await tools.definitions({}, "builder")).find((tool) => tool.name === "project_logs");
  assert.deepEqual([logs.inputSchema.properties.lines.minimum, logs.inputSchema.properties.lines.maximum], [1, 200]);
  assert.match(logs.description, /do not start a server yourself/);
  // The two switches.
  assert.equal((await names({ review: { advisory: false } }, "builder")).some((name) => /run_check|project_logs/.test(name)), false, "the setting");
  const previous = process.env.MEFI_STUDIO_NO_ADVISORY_CHECKS;
  process.env.MEFI_STUDIO_NO_ADVISORY_CHECKS = "1";
  try { assert.equal((await names({}, "builder")).some((name) => /run_check|project_logs/.test(name)), false, "the environment variable"); }
  finally { if (previous === undefined) delete process.env.MEFI_STUDIO_NO_ADVISORY_CHECKS; else process.env.MEFI_STUDIO_NO_ADVISORY_CHECKS = previous; }
  assert.equal(tools.validate({ builder: { webSearch: true } }), null, "the permission table did not change shape");
  assert.deepEqual(Object.keys(tools.policy({}, "builder")).sort(), ["mcpTools", "projectRead", "webRead", "webSearch"]);
});

test("a call for either tool is refused for any other role and when switched off, at execution as well as in the list", async (t) => {
  const dir = temp(t);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { lint: `${JSON.stringify(process.execPath)} -e "1"` } }));
  for (const role of ["routine", "companion", "overseer", "desk", "lead", "scout", "heavy"]) {
    await assert.rejects(tools.execute("run_check", { id: "lint" }, { root: dir, settings: {}, role }), /not allowed/, role);
    await assert.rejects(tools.execute("project_logs", {}, { root: dir, settings: {}, role }), /not allowed/, role);
  }
  await assert.rejects(tools.execute("run_check", { id: "lint" }, { root: dir, settings: { review: { advisory: false } }, role: "builder" }), /not allowed/);
  await assert.rejects(tools.execute("project_logs", {}, { root: dir, settings: { review: { advisory: false } }, role: "builder" }), /not allowed/);
});

test("run_check runs a check the folder has, and a wrong id lists the ones it does", async (t) => {
  const dir = temp(t);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc --noEmit" } }));
  const fake = fakeSpawner({ script: () => ({ code: 1, out: `${Array.from({ length: 300 }, (_, index) => `row ${index}`).join("\n")}\n✖ 9 problems (9 errors, 0 warnings)\n` }) });
  const runner = createAdvisoryChecks({ spawn: fake.spawn, platform: "linux" });
  const answer = await checkTool(dir, { id: "lint" }, runner);
  assert.deepEqual([answer.id, answer.status, answer.detail], ["lint", "bad", "9 errors"]);
  assert.match(answer.note, /Untrusted/);
  assert.ok(answer.output.length <= advisory.LIMITS.toolChars && answer.output.endsWith("9 errors, 0 warnings)"));
  assert.deepEqual(Object.keys(answer).sort(), ["detail", "id", "label", "ms", "note", "output", "status"]);
  await assert.rejects(checkTool(dir, { id: "build" }, runner), /No check named "build"\. This project has: typecheck, lint\./);
  await assert.rejects(checkTool(dir, { id: "../x" }, runner), /Give the id of a check/);
  await assert.rejects(checkTool(dir, {}, runner), /Give the id of a check/);
  await assert.rejects(checkTool(temp(t), { id: "lint" }, runner), /no lint, typecheck or build/);
  assert.equal(fake.calls.filter((call) => call.command === "npm").length, 1, "only the one asked for ran");
  const viaExecute = await tools.execute("run_check", { id: "nope" }, { root: dir, settings: {}, role: "builder" }).catch((error) => error.message);
  assert.match(viaExecute, /No check named "nope"/, "the same answer through the tool loop");
});

test("project_logs returns the last lines Studio captured, or says honestly that it captured nothing", async (t) => {
  const dir = temp(t);
  const file = path.join(dir, "preview.log");
  writeFileSync(file, `${Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n")}\nAuthorization: Bearer abcdef0123456789abcdef0123\n`);
  const some = await logsTool(file, { lines: 3 });
  assert.equal(some.captured, true);
  assert.equal(some.lines.length, 3);
  assert.doesNotMatch(some.lines.join("\n"), /abcdef0123456789abcdef0123/, "credentials in the output are masked");
  assert.equal(some.earlierLines, 98);
  assert.match(some.note, /Untrusted/);
  assert.equal((await logsTool(file, {})).lines.length, 60, "sixty by default");
  const none = await logsTool(path.join(dir, "missing.log"), {});
  assert.deepEqual([none.captured, none.lines], [false, []]);
  assert.match(none.message, /^Nothing captured/);
  writeFileSync(path.join(dir, "empty.log"), "\n\n");
  assert.equal((await logsTool(path.join(dir, "empty.log"), { lines: 5 })).captured, false);
  assert.equal((await logsTool(null, {})).captured, false, "no file at all is the same honest answer");
  for (const lines of [0, 201, 1.5, "ten", -1]) await assert.rejects(logsTool(file, { lines }), /whole number from 1 to 200/, String(lines));
  writeFileSync(path.join(dir, "big.log"), "x".repeat(2 * 1024 * 1024));
  assert.equal((await logsTool(path.join(dir, "big.log"), {})).captured, false, "a file past the size cap is not read");
});

test("the preview's output reaches a builder through a file that goes with the run", async (t) => {
  const dir = temp(t);
  const script = fileURLToPath(new URL("../scripts/agent-tools-mcp.cjs", import.meta.url));
  const files = await configs.prepare({ root: dir, settings: {}, script, dir, review: { advisory: true }, logs: "Vite ready\nline two\n" });
  try {
    assert.equal(files.logs, path.join(files.folder, "preview.log"));
    assert.equal(readFileSync(files.logs, "utf8"), "Vite ready\nline two\n");
    if (process.platform !== "win32") assert.equal(statSync(files.logs).mode & 0o077, 0, "private to the user");
    const policy = JSON.parse(readFileSync(path.join(files.folder, "policy.json"), "utf8"));
    assert.deepEqual([policy.review, policy.logs], [{ advisory: true }, files.logs]);
    assert.equal(await configs.updateLogs(files, "Vite ready\nline two\nline three\n"), true);
    assert.equal(readFileSync(files.logs, "utf8"), "Vite ready\nline two\nline three\n");
    assert.deepEqual(readdirSync(files.folder).filter((name) => name.endsWith(".tmp")), [], "replaced whole, no temporary file left");
    assert.equal(await configs.updateLogs({ logs: files.logs, folder: dir }, "x"), false, "only a folder Studio made is written into");
    assert.equal(await configs.updateLogs(null, "x"), false);
    // The worker's own tool server over real stdio.
    const child = realSpawn(process.execPath, [script], { env: { ...process.env, MEFI_TOOLS_CONFIG: path.join(files.folder, "policy.json") }, stdio: ["pipe", "pipe", "ignore"] });
    try {
      const replies = new Map();
      let buffer = "";
      child.stdout.on("data", (chunk) => { buffer += chunk; let at; while ((at = buffer.indexOf("\n")) >= 0) { const message = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); replies.set(message.id, message); } });
      const ask = async (id, method, params = {}) => { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); for (let turn = 0; turn < 200 && !replies.has(id); turn += 1) await new Promise((resolve) => setTimeout(resolve, 25)); return replies.get(id); };
      await ask(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
      const listed = (await ask(2, "tools/list")).result.tools.map((tool) => tool.name);
      assert.ok(listed.includes("run_check") && listed.includes("project_logs"), listed.join());
      const called = await ask(3, "tools/call", { name: "project_logs", arguments: { lines: 2 } });
      assert.deepEqual(JSON.parse(called.result.content[0].text).lines, ["line two", "line three"]);
    } finally { child.kill(); }
  } finally { await configs.remove(files); }
  assert.equal(existsSync(files.folder), false, "the folder, the log included, goes when the run ends");
  const off = await configs.prepare({ root: dir, settings: {}, script, dir, review: { advisory: false } });
  try {
    const child = realSpawn(process.execPath, [script], { env: { ...process.env, MEFI_TOOLS_CONFIG: path.join(off.folder, "policy.json") }, stdio: ["pipe", "pipe", "ignore"] });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    for (let turn = 0; turn < 200 && !text.includes("\n"); turn += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    child.kill();
    assert.doesNotMatch(text, /run_check|project_logs/, "a run started with the setting off is not offered them");
  } finally { await configs.remove(off); }
});

test("the preview service remembers two hundred lines of its output for project_logs and still hands the page 24", async (t) => {
  const root = temp(t);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "node server.cjs" } }));
  writeFileSync(path.join(root, "server.cjs"), `const http = require("node:http");
for (let index = 0; index < 60; index += 1) console.log("compiled module " + index);
http.createServer((request, response) => response.end("ok")).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("Local: http://127.0.0.1:" + process.env.PORT + "/"));`);
  const events = [];
  const api = createProjectPreview({ readinessMs: 20000, probeMs: 500, pollMs: 50, onChange: (state) => events.push(state), spawnImpl: (...args) => (args[0] === "cmd.exe" ? platformSpawn(process.execPath, [path.join(args[2].cwd, "server.cjs")], args[2]) : platformSpawn(...args)) });
  const project = { id: "p1", path: root };
  t.after(async () => { await api.closeAll().catch(() => api.disposeSync()); });
  assert.deepEqual(api.tail(project), { ok: true, phase: "stopped", url: null, owned: false, lines: [] }, "nothing captured before anything runs, and asking starts nothing");
  const started = await api.start(project);
  assert.equal(started.phase, "ready", started.error);
  const tail = api.tail(project, 5);
  assert.equal(tail.lines.length, 5);
  assert.match(tail.lines.at(-1), /^Local: http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(api.tail(project, 500).lines.length, 61, "all of it, up to two hundred");
  assert.equal(started.logs.length, 24, "the page's own snapshot is unchanged");
  assert.equal(api.tail(project, 1).owned, true);
  assert.deepEqual(api.tail({ id: "other", path: root }).lines, [], "another project has its own output");
  await api.stop(project);
  assert.equal(api.tail(project).lines.length > 0, true, "the output stays after a stop, until the next start");
});
