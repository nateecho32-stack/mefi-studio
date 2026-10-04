// Guard tests for scripts/pc-setup.cjs (Friends › Your PCs › Set up this
// PC): the checks read only what they need and never pass a token on, setup
// windows run Studio's fixed commands only, and a clone takes a repository
// from the signed-in account's own list into a folder main's dialog chose,
// never onto a drive that cannot hold worktrees.
//
// Run: node --test tests/pc_setup.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFile as spawnFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { signedInAccount, filesystemQuery, filesystemOf, githubRemote, setupScript, createPcSetup } = require("../scripts/pc-setup.cjs");

// The drive query's command line for a drive letter, as the fake keys calls.
const volume = (letter) => { const query = filesystemQuery(`${letter}:\\`); return [query.command, ...query.args].join(" "); };

function fake({ answers = {}, files = [], settings = null, platform = "win32" } = {}) {
  const calls = [], spawned = [];
  const execFile = (command, args, options, done) => {
    const key = [command, ...args].join(" ");
    calls.push({ key, cwd: options.cwd, env: options.env, timeout: options.timeout });
    const answer = Object.entries(answers).find(([pattern]) => key.startsWith(pattern))?.[1];
    if (!answer) return done(Object.assign(new Error("not found"), { code: "ENOENT" }), "", "");
    if (answer.fail) return done(Object.assign(new Error("failed"), { code: 1 }), answer.stdout ?? "", answer.stderr ?? "");
    return done(null, answer.stdout ?? "", answer.stderr ?? "");
  };
  const spawn = (command, args, options) => {
    const handlers = {};
    const child = { once: (name, fn) => { handlers[name] = fn; if (name === "spawn") queueMicrotask(fn); }, unref() {} };
    spawned.push({ command, args, options, close: () => handlers.close?.() });
    return child;
  };
  const setup = createPcSetup({ execFile, spawn, platform, env: () => ({ PATH: "x" }), exists: (file) => files.some((item) => file.endsWith(item)), readText: async () => settings });
  return { setup, calls, spawned };
}

const ready = {
  "git --version": { stdout: "git version 2.47.1.windows.1" },
  "gh --version": { stdout: "gh version 2.63.0 (2024-11-27)" },
  "node --version": { stdout: "v24.21.0" },
  "gh auth status": { stdout: "github.com\n  ✓ Logged in to github.com account nateecho32-stack (keyring)\n  - Token: gho_************************************" },
};

test("the sign-in, drive and remote readers keep only what they need", () => {
  assert.equal(signedInAccount("✓ Logged in to github.com account octo-cat (keyring)\n- Token: gho_abc123"), "octo-cat");
  assert.equal(signedInAccount("✓ Logged in to github.com as octo-cat (oauth_token)"), "octo-cat", "older gh wording");
  assert.equal(signedInAccount("You are not logged into any GitHub hosts."), null);
  assert.equal(filesystemOf("exFAT\r\n"), "exFAT");
  assert.equal(filesystemOf("NTFS"), "NTFS");
  assert.equal(filesystemOf(""), null, "a drive that is not ready prints nothing");
  assert.equal(filesystemOf("Error 3: The system cannot find the path specified."), null, "an error is not a name");
  assert.equal(filesystemOf("NTFS\r\nexFAT\r\n"), null, "one drive, one name");
  assert.equal(githubRemote("https://github.com/nateecho32-stack/mefi-studio.git"), "nateecho32-stack/mefi-studio");
  assert.equal(githubRemote("https://user:token@github.com/a/b.git"), "a/b", "credentials never come along");
  assert.equal(githubRemote("git@github.com:a/b.git"), "a/b");
  assert.equal(githubRemote("https://gitlab.com/a/b.git"), null);
  assert.equal(githubRemote("E:/local/mirror"), null);
});

// fsutil answers "Access is denied" without elevation, so its exFAT warning could never show.
test("the drive query needs no administrator, names only the drive letter and stops after 10 s", async () => {
  const query = filesystemQuery("E:\\code\\app");
  assert.equal(query.command, "powershell.exe");
  assert.deepEqual(query.args.slice(0, -1), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.equal(query.args.at(-1), "try { [IO.DriveInfo]::new('E:').DriveFormat } catch { (Get-CimInstance Win32_LogicalDisk -Filter 'DeviceID=''E:''').FileSystem }");
  assert.equal(query.timeout, 10000);
  assert.doesNotMatch(filesystemQuery("C:'); Remove-Item x #").args.at(-1), /Remove-Item/, "only the letter goes in");
  for (const folder of ["\\\\server\\share\\app", "code/app", "", null]) assert.equal(filesystemQuery(folder), null, String(folder));
  const { setup, calls } = fake({ answers: { ...ready, "git rev-parse": { stdout: "E:/code/app" } } });
  const unknown = await setup.status("E:/code/app");
  assert.deepEqual([unknown.project.filesystem, unknown.project.weakDrive], [null, false], "a drive that does not answer is unknown, not weak");
  assert.equal(calls.find((call) => call.key === volume("E"))?.timeout, 10000);
  assert.ok(!calls.some((call) => call.key.startsWith("fsutil")), "fsutil never runs");
  const mac = fake({ platform: "darwin", answers: { ...ready, "git rev-parse": { stdout: "/code/app" } } });
  await mac.setup.status("/code/app");
  assert.ok(!mac.calls.some((call) => call.key.startsWith("powershell.exe")), "no drive query off Windows");
});

test("the drive query names this PC's system drive without elevation", { skip: process.platform !== "win32" && "Windows only" }, async () => {
  const query = filesystemQuery(process.env.SystemDrive || "C:");
  const stdout = await new Promise((resolve) => {
    spawnFile(query.command, query.args, { windowsHide: true, timeout: query.timeout }, (error, out, err) => resolve(error ? `${error.message}\n${err}` : out));
  });
  assert.notEqual(filesystemOf(stdout), null, `the query answered: ${stdout}`);
});

test("a ready PC with a synced project on NTFS has nothing to do, and no token leaves", async () => {
  const { setup } = fake({
    answers: { ...ready, "git rev-parse": { stdout: "C:/code/app" }, "git remote get-url": { stdout: "https://github.com/me/app.git" }, [volume("C")]: { stdout: "NTFS\r\n" } },
    files: ["package.json", "node_modules"],
    settings: '{"hooks":{"SessionStart":[{"hooks":[{"command":"node scripts/sync.mjs --hook"}]}]}}',
  });
  const status = await setup.status("C:/code/app");
  assert.equal(status.ready, true);
  assert.deepEqual(status.steps, []);
  assert.deepEqual(status.notes, []);
  assert.equal(status.account, "nateecho32-stack");
  assert.deepEqual(status.tools.map((tool) => [tool.id, tool.version]), [["git", "2.47.1"], ["gh", "2.63.0"], ["node", "24.21.0"]]);
  assert.deepEqual({ github: status.project.github, filesystem: status.project.filesystem, hook: status.project.hook, needsInstall: status.project.needsInstall }, { github: "me/app", filesystem: "NTFS", hook: true, needsInstall: false });
  assert.doesNotMatch(JSON.stringify(status), /gho_|Token/, "the auth output stays inside the module");
});

test("a new PC gets its steps in order, and an exFAT project is told why to move", async () => {
  const { setup } = fake({
    answers: { "git --version": ready["git --version"], "gh --version": ready["gh --version"], "gh auth status": { fail: true, stderr: "You are not logged into any GitHub hosts." }, "git rev-parse": { stdout: "E:/code/app" }, "git remote get-url": { stdout: "E:/mirror" }, [volume("E")]: { stdout: "exFAT\r\n" } },
    files: ["package.json"],
  });
  const status = await setup.status("E:/code/app");
  assert.equal(status.ready, false);
  assert.deepEqual(status.steps.map((step) => step.id), ["install-node", "github-login"], "no package install until Node.js is there");
  assert.match(status.notes[0], /no GitHub remote yet/);
  assert.match(status.notes[1], /on an exFAT drive\. Git cannot keep separate worktrees there/);
  assert.equal(status.project.weakDrive, true);
});

test("setup windows run only Studio's fixed commands, one at a time", async () => {
  const { setup, spawned } = fake();
  assert.deepEqual(await setup.action("rm -rf /"), { ok: false, error: "Unknown setup action." });
  const opened = await setup.action("github-login");
  assert.equal(opened.ok, true);
  assert.equal(spawned[0].command, "powershell.exe");
  const script = Buffer.from(spawned[0].args.at(-1), "base64").toString("utf16le");
  assert.match(script, /gh auth login --hostname github\.com --web --git-protocol https/);
  assert.match(script, /gh auth setup-git/);
  assert.equal(spawned[0].options.windowsHide, false, "the owner sees the window");
  assert.notEqual(spawned[0].options.detached, true, "a detached PowerShell gets no console and exits before its script runs");
  assert.match((await setup.action("github-login")).error, /already open/);
  spawned[0].close();
  assert.equal((await setup.action("github-login")).ok, true, "it can open again once closed");
  assert.match((await setup.action("install-deps")).error, /Open a project first/);
  await setup.action("install-deps", { cwd: "C:/code/app" });
  assert.equal(spawned.at(-1).options.cwd, "C:/code/app");
  assert.match(Buffer.from(spawned.at(-1).args.at(-1), "base64").toString("utf16le"), /npm\.cmd ci \} else \{ npm\.cmd install/);
  assert.match(setupScript("install-gh"), /winget install --id GitHub\.cli --exact/);
  assert.throws(() => setupScript("install-anything"), /Unknown setup action/);
  const mac = fake({ platform: "darwin" });
  assert.match((await mac.setup.action("install-git")).error, /runs on Windows/);
});

test("a clone takes a listed repository into a picked NTFS folder, and nothing else", async () => {
  const listing = JSON.stringify([
    { nameWithOwner: "me/app", isPrivate: true, description: "My app", updatedAt: "2026-09-27T00:00:00Z" },
    { nameWithOwner: "me/site; calc.exe", isPrivate: false },
  ]);
  const { setup, calls } = fake({ answers: { "gh repo list": { stdout: listing }, [volume("C")]: { stdout: "NTFS\r\n" }, [volume("E")]: { stdout: "exFAT\r\n" }, "gh repo clone me/app": { stdout: "" } }, files: ["C:\\code\\taken"] });
  assert.match((await setup.clone("me/app", "C:\\code")).error, /Choose a repository from your list/, "nothing is listed yet");
  const listed = await setup.repos();
  assert.deepEqual(listed.repos.map((row) => row.repo), ["me/app"], "an odd name never reaches the list");
  assert.equal(listed.repos[0].private, true);
  assert.match((await setup.clone("other/app", "C:\\code")).error, /from your list/);
  assert.match((await setup.clone("me/app", "relative")).error, /Choose a folder/);
  assert.match((await setup.clone("me/app", "E:\\code")).error, /That drive is exFAT/);
  const done = await setup.clone("me/app", "C:\\code");
  assert.deepEqual(done, { ok: true, folder: "C:\\code\\app" });
  const cloned = calls.find((call) => call.key.startsWith("gh repo clone"));
  assert.equal(cloned.key, "gh repo clone me/app C:\\code\\app -- --quiet");
  assert.equal(cloned.env.GIT_TERMINAL_PROMPT, "0");
});

test("main keeps pc-setup app-wide, refuses an unlisted repository before any dialog, and the bridge passes names only", async () => {
  const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(main.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1], /"pc-setup:"/, "a clone may open a project, which a gated handler would wait on");
  const handler = main.slice(main.indexOf('ipcMain.handle("pc-setup:clone"'), main.indexOf("\n  });", main.indexOf('ipcMain.handle("pc-setup:clone"')));
  assert.ok(handler.indexOf("pcSetup.isListed(repo)") < handler.indexOf("dialog.showOpenDialog"), "an unlisted name never opens a dialog");
  assert.match(handler, /pcSetup\.clone\(repo, picked\.filePaths\[0\]\)/, "the folder comes from the dialog");
  assert.match(handler, /registerProjectFolder\(cloned\.folder\)/);
  assert.match(main, /ipcMain\.handle\("pc-setup:status", async \(\) => \{\n\s+\/\/ .*\n\s+await refreshProcessPath\(\)/, "a tool installed since launch is found");
  const invoked = [];
  const page = { require: () => ({ contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) }, ipcRenderer: { invoke: async (channel, ...args) => { invoked.push([channel, args]); return { ok: true }; }, on: () => {} } }) };
  vm.runInNewContext(preload, page);
  await page.mefiStudio.pcSetupStatus("C:/x");
  await page.mefiStudio.pcSetupAction({ command: "calc.exe" });
  await page.mefiStudio.pcSetupAction("github-login");
  await page.mefiStudio.pcSetupRepos();
  await page.mefiStudio.pcSetupClone("me/app", "C:/anywhere");
  assert.deepEqual(JSON.parse(JSON.stringify(invoked)), [
    ["pc-setup:status", []],
    ["pc-setup:action", [{ action: "" }]],
    ["pc-setup:action", [{ action: "github-login" }]],
    ["pc-setup:repos", []],
    ["pc-setup:clone", [{ repo: "me/app" }]],
  ]);
});
