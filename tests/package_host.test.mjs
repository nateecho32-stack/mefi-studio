// The Rust host's portable build (scripts/package-portable.mjs --host tauri)
// and its release zip (scripts/package-release.mjs --host tauri), run in a
// scratch checkout with a stand-in host program and a stand-in node.exe. The
// layout must be the Electron build's, with the host program as
// "Mefi Studio AI+.exe" and node.exe beside it in place of Chromium's
// runtime; the payload and its data rules are the same; and the zip carries a
// name the updater tells apart from the Electron build's.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractZip, portableHost, releaseAssetName, stageUpdate } from "../scripts/release-updater.mjs";

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const APP = "Mefi Studio AI+";
const EXE = `${APP}.exe`;
const PAYLOAD = path.join("dist", APP, "resources", "app");

async function write(root, name, value) {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
}

// A scratch checkout: the payload's sources, a stand-in Electron runtime, a
// stand-in host program and node.exe, private data that must never ship, and
// the packaging scripts themselves.
async function checkout(t) {
  const root = await mkdtemp(path.join(tmpdir(), "mefi-package-host-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await write(root, "package.json", JSON.stringify({ name: "mefi-studio", productName: "Mefi's Studio AI+", version: "0.1.0", main: "main.cjs" }));
  for (const file of ["main.cjs", "preload.cjs", "README.md", "GETTING_STARTED.md", "renderer/booklet.html", "assets/icon.ico"]) await write(root, file, "fixture");
  for (const file of ["electron.exe", "icudtl.dat", "resources.pak", "v8_context_snapshot.bin", "LICENSE", "ffmpeg.dll", "locales/en-US.pak"]) await write(root, `node_modules/electron/dist/${file}`, `electron ${file}`);
  await mkdir(path.join(root, "node_modules/electron/dist/resources"), { recursive: true });
  await write(root, "bin/mefi-studio.exe", "the Rust host program");
  await write(root, "bin/node.exe", "a stand-in node");
  await write(root, "data/models.json", '{"models":[]}');
  await write(root, "data/curated.json", "{}");
  await write(root, "data/settings.json", '{"secret":"SOURCE-PRIVATE"}');
  await write(root, "data/projects/a/planning.json", "PRIVATE-PLAN");
  await mkdir(path.join(root, "scripts"), { recursive: true });
  for (const file of ["package-portable.mjs", "package-release.mjs", "release-updater.mjs", "rust-host.mjs", "stamp-exe.mjs", "build-booklet.mjs", "booklet-source-location.cjs"]) {
    await copyFile(path.join(SCRIPTS, file), path.join(root, "scripts", file));
  }
  return root;
}

function run(root, script, args, { env = {}, ok = true } = {}) {
  const clean = { ...process.env, ...env };
  for (const name of ["MEFI_STUDIO_NODE", "CARGO_TARGET_DIR", ...Object.keys(env)]) if (env[name] === undefined) delete clean[name];
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000, env: clean });
  if (ok) assert.equal(result.status, 0, `${script} ${args.join(" ")}\n${result.stderr || result.error?.message}`);
  return result;
}

const hostArgs = (root, ...more) => ["--host", "tauri", "--host-exe", path.join(root, "bin", "mefi-studio.exe"), "--node", path.join(root, "bin", "node.exe"), ...more];
const list = async (dir) => (await readdir(dir)).sort();
const text = (file) => readFile(file, "utf8");

test("a host build is the Electron layout with the host program and node.exe in place of Chromium", async (t) => {
  const root = await checkout(t);
  const out = path.join(root, "dist", APP);

  // A development folder that held an Electron build, with the owner's state in it.
  run(root, "package-portable.mjs", []);
  assert.ok((await list(out)).includes("icudtl.dat"));
  await write(root, `${PAYLOAD}/data/settings.json`, "PORTABLE-PRIVATE");

  const built = run(root, "package-portable.mjs", hostArgs(root));
  assert.match(built.stderr, /could not read the version of .*node\.exe.*not a release/, "a stand-in node is fine for a layout, and says so");
  assert.deepEqual(await list(out), [EXE, "node.exe", "resources"], "no Chromium runtime is left beside the host program");
  assert.deepEqual(await list(path.join(out, "resources")), ["app"]);
  assert.equal(await text(path.join(out, EXE)), "the Rust host program", "the host program is renamed (a non-Windows stand-in is not stamped)");
  assert.equal(await text(path.join(out, "node.exe")), "a stand-in node");
  assert.equal(await portableHost(out), "tauri");
  const payload = path.join(root, PAYLOAD);
  for (const file of ["main.cjs", "preload.cjs", "README.md", "GETTING_STARTED.md", "renderer/booklet.html", "assets/icon.ico", "scripts/package-portable.mjs"]) {
    assert.ok((await stat(path.join(payload, file))).isFile(), `the payload carries ${file}, as the Electron build's does`);
  }
  assert.deepEqual(JSON.parse(await text(path.join(payload, "package.json"))), { name: "mefi-studio", productName: "Mefi's Studio AI+", version: "0.1.0", main: "main.cjs" });
  assert.deepEqual(await list(path.join(payload, "data")), ["curated.json", "models.json", "settings.json"]);
  assert.equal(await text(path.join(payload, "data", "settings.json")), "PORTABLE-PRIVATE", "the folder's live state survives the switch");

  // --clean carries the live state across the wipe, on this host too.
  run(root, "package-portable.mjs", hostArgs(root, "--clean"));
  assert.deepEqual(await list(out), [EXE, "node.exe", "resources"]);
  assert.equal(await text(path.join(payload, "data", "settings.json")), "PORTABLE-PRIVATE");

  // And back: an Electron build carries no node.exe.
  run(root, "package-portable.mjs", ["--host", "electron"]);
  assert.ok(!(await list(out)).includes("node.exe"));
  assert.equal(await portableHost(out), "electron");
  assert.equal(await text(path.join(payload, "data", "settings.json")), "PORTABLE-PRIVATE");
  assert.equal(await text(path.join(root, "data", "settings.json")), '{"secret":"SOURCE-PRIVATE"}', "the checkout's own data is never touched");
});

test("the host program comes from the Rust host's release folder unless one is named", async (t) => {
  const root = await checkout(t);
  const target = path.join(root, "cargo-target");
  const missing = run(root, "package-portable.mjs", ["--host", "tauri", "--node", path.join(root, "bin", "node.exe")], { env: { CARGO_TARGET_DIR: target }, ok: false });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /the Rust host is not built: .*cargo-target.*release.*mefi-studio\.exe is missing - run: node scripts\/rust-host\.mjs release-build/);
  assert.equal(await stat(path.join(root, "dist")).then(() => true, () => false), false, "nothing is written before the program is found");

  await write(target, "release/mefi-studio.exe", "built by release-build");
  run(root, "package-portable.mjs", ["--host", "tauri", "--node", path.join(root, "bin", "node.exe")], { env: { CARGO_TARGET_DIR: target } });
  assert.equal(await text(path.join(root, "dist", APP, EXE)), "built by release-build");

  const unknown = run(root, "package-portable.mjs", ["--host", "qt"], { ok: false });
  assert.match(unknown.stderr, /--host must be electron or tauri/);
});

test("a host release ships Node 24 and the catalogs only, and zips under its own name", async (t) => {
  const root = await checkout(t);
  const refused = run(root, "package-portable.mjs", hostArgs(root, "--release"), { ok: false });
  assert.notEqual(refused.status, 0, "a release never ships a Node whose version is unknown");
  assert.match(refused.stderr, /A release ships the Node it runs on/);

  // Without --node the Node running the packager ships (this suite runs on 24).
  run(root, "package-portable.mjs", ["--host", "tauri", "--host-exe", path.join(root, "bin", "mefi-studio.exe"), "--release"]);
  run(root, "package-portable.mjs", ["--release"]);
  const folders = await list(path.join(root, "dist", "releases"));
  assert.equal(folders.length, 2);
  const hostFolder = folders.find((name) => /^mefi-studio-0\.1\.0-tauri-[A-Za-z0-9]{6}$/.test(name));
  assert.ok(hostFolder, `the release folder names its host: ${folders.join(", ")}`);
  assert.ok(folders.some((name) => /^mefi-studio-0\.1\.0-electron-[A-Za-z0-9]{6}$/.test(name)));
  const hostBuild = path.join(root, "dist", "releases", hostFolder, APP);
  assert.deepEqual(await list(hostBuild), [EXE, "node.exe", "resources"]);
  assert.equal((await stat(path.join(hostBuild, "node.exe"))).size, (await stat(process.execPath)).size, "node.exe is the packager's own Node");
  assert.deepEqual(await list(path.join(hostBuild, "resources", "app", "data")), ["curated.json", "models.json"]);

  // A folder that was launched holds that session's state: it never travels.
  await write(hostBuild, "resources/app/data/settings.json", "LAUNCHED-PRIVATE");
  // The zip below is about names and contents; a small node.exe keeps it quick.
  await write(hostBuild, "node.exe", "the shipped node");
  run(root, "package-release.mjs", ["--version", "v0.1.0", "--skip-build", "--host", "tauri"]);
  run(root, "package-release.mjs", ["--version", "v0.1.0", "--skip-build"]);
  const releases = path.join(root, "dist", "releases");
  const hostZip = releaseAssetName("0.1.0", { host: "tauri" });
  const electronZip = releaseAssetName("0.1.0");
  assert.equal(hostZip, "Mefi-Studio-AI+-v0.1.0-win32-x64-tauri.zip");
  assert.equal(electronZip, "Mefi-Studio-AI+-v0.1.0-win32-x64.zip", "the Electron zip keeps the name installed copies look for");
  for (const zip of [hostZip, electronZip]) assert.match(await text(path.join(releases, `${zip}.sha256`)), new RegExp(`^[0-9a-f]{64}  ${zip.replace(/[.+]/g, "\\$&")}\\n$`));

  const unpacked = path.join(root, "unpacked");
  const names = (await extractZip(path.join(releases, hostZip), unpacked)).sort();
  assert.ok(names.includes(`${APP}/node.exe`) && names.includes(`${APP}/${EXE}`));
  assert.ok(!names.some((name) => /icudtl|resources\.pak|locales\//.test(name)), "the host zip carries no Chromium runtime");
  assert.deepEqual(names.filter((name) => name.includes("/data/")), [`${APP}/resources/app/data/curated.json`, `${APP}/resources/app/data/models.json`]);
  const electronNames = await extractZip(path.join(releases, electronZip), path.join(root, "unpacked-electron"));
  assert.ok(electronNames.includes(`${APP}/icudtl.dat`) && !electronNames.includes(`${APP}/node.exe`));

  // What an installed copy's updater makes of the host zip.
  const install = path.join(root, "install", APP);
  await write(install, "resources/app/main.cjs", "installed");
  const staged = await stageUpdate({ zipPath: path.join(releases, hostZip), stagingDir: path.join(root, "staging"), installRoot: install, expectedVersion: "0.1.0" });
  assert.equal(staged.host, "tauri");
  assert.equal(staged.exePath, path.join(install, EXE));
});
