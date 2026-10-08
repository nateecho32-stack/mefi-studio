"use strict";

// Set up this PC (Friends › Your PCs): what a PC needs to share projects with
// the owner's other PCs through GitHub, and a fixed setup window for each gap.
// Checks: Git, the GitHub CLI and Node.js on PATH, a GitHub sign-in (the
// account name only; `gh auth status` output never leaves this module), and
// for the open project a GitHub remote, installed dependencies and a drive
// that supports Git worktrees (exFAT and FAT do not). Actions run Studio's own
// commands in a visible PowerShell window (scripts/setup-window.cjs, shared
// with scripts/cli-setup.cjs): the renderer names an action, never a command,
// a URL or a path. Cloning takes a repository from the signed-in account's own
// list and a folder the owner picks in main's dialog. Guarded by
// tests/pc_setup.test.mjs.
const path = require("node:path");

const TOOLS = Object.freeze([
  { id: "git", name: "Git", cmd: "git", winget: "Git.Git" },
  { id: "gh", name: "GitHub CLI", cmd: "gh", winget: "GitHub.cli" },
  { id: "node", name: "Node.js", cmd: "node", winget: "OpenJS.NodeJS.LTS" },
]);
// Each setup window's title bar, so the owner can tell it from other consoles.
const WINDOW_TITLES = Object.freeze({
  "install-git": "Mefi Studio: Install Git",
  "install-gh": "Mefi Studio: Install GitHub CLI",
  "install-node": "Mefi Studio: Install Node.js",
  "github-login": "Mefi Studio: Sign in to GitHub",
  "install-deps": "Mefi Studio: Install project packages",
});
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const WEAK_FILESYSTEMS = new Set(["EXFAT", "FAT", "FAT32"]);
const refreshPath = "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path";

// `gh auth status` prints the account; keep only its login name.
function signedInAccount(output) {
  const match = /Logged in to github\.com (?:account|as) ([A-Za-z0-9-]{1,39})/i.exec(String(output ?? ""));
  return match ? match[1] : null;
}

// The command that names the file system of a Windows folder's drive, or null
// for a folder without a drive letter. fsutil needs an administrator, so this
// asks .NET's DriveInfo (GetVolumeInformationW) through PowerShell, about
// 0.2 s; PowerShell locked to constrained language cannot make that type and
// asks CIM instead. Only the drive letter goes into the script. A drive that
// is not ready prints nothing.
function filesystemQuery(folder) {
  const letter = /^([A-Za-z]):/.exec(String(folder ?? ""))?.[1];
  if (!letter) return null;
  const script = `try { [IO.DriveInfo]::new('${letter}:').DriveFormat } catch { (Get-CimInstance Win32_LogicalDisk -Filter 'DeviceID=''${letter}:''').FileSystem }`;
  return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script], timeout: 10000 };
}

// The query prints the bare name ("NTFS", "exFAT"); anything else is unknown.
function filesystemOf(output) {
  const name = String(output ?? "").trim();
  return /^[A-Za-z0-9]{1,32}$/.test(name) ? name : null;
}

// Only github.com remotes count, and never with credentials in them.
function githubRemote(url) {
  const text = String(url ?? "").trim();
  const match = /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(text);
  return match ? match[1] : null;
}

function setupScript(action) {
  const lines = ["$ErrorActionPreference = 'Stop'", refreshPath];
  const tool = TOOLS.find((item) => `install-${item.id}` === action);
  if (tool) {
    lines.push("if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Windows Package Manager (winget) is missing. Install App Installer from the Microsoft Store, then try again.' }",
      `winget install --id ${tool.winget} --exact --accept-source-agreements --accept-package-agreements`,
      "if ($LASTEXITCODE -ne 0) { throw 'The installation did not finish. Check the message above and try again.' }",
      refreshPath,
      `Write-Host '${tool.name} is installed. Return to Studio and choose Check again.'`);
  } else if (action === "github-login") {
    lines.push("if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Install the GitHub CLI first.' }",
      "Write-Host 'The GitHub CLI may ask a question first (Enter takes the default). Then copy the one-time code it shows, press Enter, and enter the code on the GitHub page that opens. Studio never sees your password or token.'",
      "gh auth login --hostname github.com --web --git-protocol https",
      "if ($LASTEXITCODE -ne 0) { throw 'GitHub sign-in did not finish. Try again.' }",
      "gh auth setup-git",
      "Write-Host 'Signed in. Return to Studio and choose Check again.'");
  } else if (action === "install-deps") {
    lines.push("if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Install Node.js first.' }",
      "if (Test-Path -LiteralPath 'package-lock.json') { npm.cmd ci } else { npm.cmd install }",
      "if ($LASTEXITCODE -ne 0) { throw 'Installing the project''s packages did not finish. Check the message above and try again.' }",
      "Write-Host 'Packages installed. Return to Studio.'");
  } else throw new Error("Unknown setup action.");
  return lines.join("\n");
}

function createPcSetup({ execFile, spawn, platform = process.platform, env = () => process.env, exists = () => false, readText = async () => null }) {
  const run = (command, args, options = {}) => new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: options.timeout ?? 20000, maxBuffer: 4 * 1024 * 1024, env: { ...env(), GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", NO_COLOR: "1" }, cwd: options.cwd }, (error, stdout, stderr) => {
      resolve({ ok: !error, code: error?.code ?? 0, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
  // The folder rules of the PC being set up, not of whatever runs this module.
  const paths = platform === "win32" ? path.win32 : path.posix;
  const running = new Set();
  let listed = new Set();
  // Null off Windows, for a folder without a drive letter, and when the drive does not answer.
  async function filesystemAt(folder) {
    const query = platform === "win32" ? filesystemQuery(folder) : null;
    return query ? filesystemOf((await run(query.command, query.args, { timeout: query.timeout })).stdout) : null;
  }

  async function status(root) {
    const tools = [];
    for (const tool of TOOLS) {
      const answer = await run(tool.cmd, ["--version"]);
      const version = answer.ok ? (/(\d+\.\d+(?:\.\d+)?)/.exec(answer.stdout) ?? [])[1] ?? "installed" : null;
      tools.push({ id: tool.id, name: tool.name, installed: answer.ok, version });
    }
    const gh = tools.find((tool) => tool.id === "gh");
    const auth = gh.installed ? await run("gh", ["auth", "status", "--hostname", "github.com"]) : null;
    // Newer gh writes the status to stdout, older to stderr; neither leaves here.
    const account = auth ? signedInAccount(`${auth.stdout}\n${auth.stderr}`) : null;
    const project = { root: root || null, repo: false, github: null, needsInstall: false, filesystem: null, weakDrive: false, hook: false };
    if (root) {
      const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd: root });
      project.repo = top.ok;
      if (top.ok) project.github = githubRemote((await run("git", ["remote", "get-url", "origin"], { cwd: root })).stdout);
      project.needsInstall = exists(paths.join(root, "package.json")) && !exists(paths.join(root, "node_modules"));
      project.hook = /scripts\/sync\.mjs --hook/.test(String(await readText(paths.join(root, ".claude", "settings.json")) ?? ""));
      project.filesystem = await filesystemAt(root);
      project.weakDrive = WEAK_FILESYSTEMS.has(String(project.filesystem ?? "").toUpperCase());
    }
    const steps = [
      ...tools.filter((tool) => !tool.installed).map((tool) => ({ id: `install-${tool.id}`, label: `Install ${tool.name}`, why: tool.id === "node" ? "Projects install their packages with it." : "Studio shares projects between your PCs through GitHub with it." })),
      ...(gh.installed && !account ? [{ id: "github-login", label: "Sign in to GitHub", why: "So this PC can pull and push your projects. Studio never sees your password or token." }] : []),
      ...(project.needsInstall && tools.find((tool) => tool.id === "node").installed ? [{ id: "install-deps", label: "Install the project's packages", why: "This project's packages are not installed on this PC yet." }] : []),
    ];
    const notes = [];
    if (root && !project.repo) notes.push("This project folder is not a Git repository, so it cannot sync between your PCs yet.");
    else if (root && !project.github) notes.push("This project has no GitHub remote yet. Publish it to GitHub once to share it with your other PCs.");
    if (project.weakDrive) notes.push(`This project is on ${/^[aeiou]/i.test(project.filesystem) ? "an" : "a"} ${project.filesystem} drive. Git cannot keep separate worktrees there, so sessions end up sharing one folder. Move the project to an NTFS drive when you can.`);
    return { ok: true, platform, tools, account, project, steps, notes, ready: !steps.length && Boolean(account) };
  }

  async function action(name, { cwd } = {}) {
    if (!["install-git", "install-gh", "install-node", "github-login", "install-deps"].includes(name)) return { ok: false, error: "Unknown setup action." };
    if (platform !== "win32") return { ok: false, error: "Guided setup currently runs on Windows." };
    if (name === "install-deps" && !cwd) return { ok: false, error: "Open a project first." };
    if (running.has(name)) return { ok: false, error: "That setup window is already open. Finish or close it first." };
    running.add(name);
    try {
      const script = `try {\n${setupScript(name)}\n} catch { Write-Host $_.Exception.Message -ForegroundColor Red }\nRead-Host 'Press Enter to close this setup window'`;
      // A console of its own (setup-window.cjs, loaded on first use): gh's sign-in shows its code and opens the browser only in a terminal.
      const { openSetupWindow } = require("./setup-window.cjs");
      const child = await openSetupWindow(spawn, script, { title: WINDOW_TITLES[name], cwd: name === "install-deps" ? cwd : undefined, env: env() });
      child.once("close", () => running.delete(name));
      child.unref?.();
      return { ok: true, launched: true, message: "Finish in the setup window, then choose Check again." };
    } catch (error) { running.delete(name); return { ok: false, error: `Could not open the setup window: ${error.message}` }; }
  }

  // The signed-in account's own repositories, newest first. Only names from
  // this list can be cloned.
  async function repos() {
    const answer = await run("gh", ["repo", "list", "--limit", "100", "--json", "nameWithOwner,isPrivate,description,updatedAt"], { timeout: 30000 });
    if (!answer.ok) return { ok: false, error: "Could not list your GitHub repositories. Sign in to GitHub first." };
    let rows;
    try { rows = JSON.parse(answer.stdout); } catch { return { ok: false, error: "GitHub's answer could not be read." }; }
    const list = (Array.isArray(rows) ? rows : []).filter((row) => REPO.test(String(row?.nameWithOwner ?? ""))).map((row) => ({
      repo: row.nameWithOwner, private: row.isPrivate === true, description: String(row.description ?? "").slice(0, 200), updatedAt: String(row.updatedAt ?? ""),
    }));
    listed = new Set(list.map((row) => row.repo));
    return { ok: true, repos: list };
  }

  // parent comes from main's folder dialog, never from the renderer.
  async function clone(repo, parent) {
    if (!REPO.test(String(repo ?? "")) || !listed.has(repo)) return { ok: false, error: "Choose a repository from your list." };
    if (typeof parent !== "string" || !paths.isAbsolute(parent)) return { ok: false, error: "Choose a folder for the project." };
    const target = paths.join(parent, repo.split("/")[1]);
    if (exists(target)) return { ok: false, error: `${target} already exists. Choose another folder.` };
    const filesystem = await filesystemAt(parent);
    if (WEAK_FILESYSTEMS.has(String(filesystem ?? "").toUpperCase())) return { ok: false, error: `That drive is ${filesystem}. Git cannot keep separate worktrees there; choose a folder on an NTFS drive.` };
    const answer = await run("gh", ["repo", "clone", repo, target, "--", "--quiet"], { timeout: 15 * 60 * 1000 });
    if (!answer.ok) return { ok: false, error: `Cloning ${repo} did not finish: ${String(answer.stderr).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "unknown error"}`.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1") };
    return { ok: true, folder: target };
  }

  return { status, action, repos, clone, isListed: (repo) => listed.has(repo) };
}

module.exports = { TOOLS, signedInAccount, filesystemQuery, filesystemOf, githubRemote, setupScript, createPcSetup };
