// Builds a portable desktop app: a runtime next to a resources/app payload.
// Double-click "Mefi Studio AI+.exe" to run; the app resolves REPO_ROOT from
// its own location (dist/<app>/ -> repo).
//
//   node scripts/package-portable.mjs [--clean | --release] [--host electron|tauri]
//                                     [--host-exe <path>] [--node <path>]
//
// Two hosts share one layout (docs/rust-migration.md):
//   electron (default)  the cached Electron runtime, electron.exe renamed.
//   tauri               the Rust host's release program (src-tauri) renamed,
//                       with node.exe beside it to run main.cjs as its engine.
//                       --host-exe overrides the program (default: Cargo's
//                       release folder, as scripts/rust-host.mjs places it);
//                       --node or MEFI_STUDIO_NODE overrides the Node that
//                       ships (default: the Node running this script).
// The payload under resources/app is the same for both, and so are the rules
// for the data/ folder inside it.
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyrightLine, isWindowsExecutable, stampExecutable } from "./stamp-exe.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON_DIST = path.join(STUDIO, "node_modules", "electron", "dist");
const argv = process.argv.slice(2);
const option = (name) => {
  const joined = argv.find((arg) => arg.startsWith(`${name}=`));
  if (joined) return joined.slice(name.length + 1) || null;
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : null;
};
const release = argv.includes("--release");
const clean = argv.includes("--clean");
if (release && clean) throw new Error("Use --release by itself. Release builds always use a new, empty folder.");
const HOST = (option("--host") ?? "electron").toLowerCase();
if (!["electron", "tauri"].includes(HOST)) throw new Error(`--host must be electron or tauri, not ${HOST}`);
// Node 24 is what the repository and main.cjs are written for (package.json engines).
const NODE_MAJOR = 24;
const pkg = JSON.parse(await readFile(path.join(STUDIO, "package.json"), "utf8"));
const EXE_NAME = "Mefi Studio AI+.exe";
const NODE_NAME = "node.exe";

// What runs the app: the program that becomes EXE_NAME and, for the Rust
// host, the Node beside it. Resolved before anything is written, so a missing
// host build leaves an existing folder as it was.
let hostExe = null;
let nodeSource = null;
if (HOST === "electron") {
  if (!existsSync(ELECTRON_DIST)) {
    console.error("electron dist missing - run: npm install (then node node_modules/electron/install.js)");
    process.exit(1);
  }
} else {
  hostExe = option("--host-exe");
  if (!hostExe) {
    // Loaded only here: Electron builds and their tests never need it.
    const { hostBinary } = await import("./rust-host.mjs");
    hostExe = hostBinary();
  }
  hostExe = path.resolve(hostExe);
  if (!isFile(hostExe)) {
    console.error(`the Rust host is not built: ${hostExe} is missing - run: node scripts/rust-host.mjs release-build (or pass --host-exe <path>)`);
    process.exit(1);
  }
  nodeSource = path.resolve(option("--node") || process.env.MEFI_STUDIO_NODE || process.execPath);
  if (!isFile(nodeSource)) {
    console.error(`the Node to ship is missing: ${nodeSource}`);
    process.exit(1);
  }
  const version = nodeVersion(nodeSource);
  const major = Number.parseInt(String(version ?? "").replace(/^v/, ""), 10);
  const problem = !version ? `could not read the version of ${nodeSource}` : major < NODE_MAJOR ? `${nodeSource} is Node ${version}; Studio's engine needs Node ${NODE_MAJOR} or newer` : null;
  if (problem && release) {
    console.error(`${problem}. A release ships the Node it runs on: pass --node <node.exe> or set MEFI_STUDIO_NODE.`);
    process.exit(1);
  }
  if (problem) console.warn(`${problem}; the build is laid out anyway, but it is not a release`);
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function nodeVersion(file) {
  if (path.resolve(file) === path.resolve(process.execPath)) return process.versions.node;
  const probe = spawnSync(file, ["-p", "process.versions.node"], { encoding: "utf8", windowsHide: true, timeout: 20000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" } });
  const text = String(probe.stdout ?? "").trim();
  return probe.status === 0 && /^\d+\.\d+\.\d+/.test(text) ? text : null;
}

let releaseRoot = null;
if (release) {
  const releases = path.join(STUDIO, "dist", "releases");
  await mkdir(releases, { recursive: true });
  // The host is in the folder's name (package-release.mjs reads it back), and
  // the folder is always new, so a release cannot inherit either data store.
  releaseRoot = await mkdtemp(path.join(releases, `mefi-studio-${String(pkg.version).replace(/[^a-zA-Z0-9.-]/g, "-")}-${HOST}-`));
}
const OUT_DIR = path.join(releaseRoot || path.join(STUDIO, "dist"), "Mefi Studio AI+");
const APP_DIR = path.join(OUT_DIR, "resources", "app");

// --clean wipes the old build, but the payload's data/ holds the user's live state:
// carry it across the wipe instead of deleting it with everything else.
const LIVE_DATA = path.join(APP_DIR, "data");
let stash = null;
if (clean) {
  if (existsSync(LIVE_DATA)) {
    stash = await mkdtemp(path.join(os.tmpdir(), "mefi-studio-data-"));
    await cp(LIVE_DATA, stash, { recursive: true });
  }
  await rm(OUT_DIR, { recursive: true, force: true });
}
await mkdir(APP_DIR, { recursive: true });
if (stash) {
  await cp(stash, LIVE_DATA, { recursive: true });
  await rm(stash, { recursive: true, force: true });
}

// 1. Runtime. An open app locks its program and DLLs on Windows. Reuse byte-
// identical files so a code-only rebuild needs neither a shutdown nor a
// second runtime copy. A changed runtime still requires the app to close.
async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
// The executable is Electron's or the Rust host's, stamped with Studio's name,
// version and icon (scripts/stamp-exe.mjs) so Windows and a later code
// signature name Studio. The host program already carries a version resource
// from tauri.conf.json, but its version can lag package.json, its company
// reads "github" and its description keeps a stray backslash; the stamp makes
// both programs say the same thing. The stamp is deterministic, so an
// unchanged result is left alone like the rest of the runtime.
async function placeExecutable(from, to) {
  let bytes = await readFile(from);
  if (isWindowsExecutable(bytes)) {
    const license = existsSync(path.join(STUDIO, "LICENSE")) ? await readFile(path.join(STUDIO, "LICENSE"), "utf8") : "";
    const copyright = copyrightLine(license) || "";
    const icon = path.join(STUDIO, "assets", "icon.ico");
    bytes = await stampExecutable(bytes, {
      productName: pkg.productName,
      version: pkg.version,
      fileName: EXE_NAME,
      company: copyright.replace(/^Copyright\s+(\(c\)\s*)?[\d\s,-]*/i, ""),
      copyright,
      icon: existsSync(icon) ? await readFile(icon) : null,
    });
  }
  if (existsSync(to) && (await fileDigest(to)) === createHash("sha256").update(bytes).digest("hex")) return;
  try {
    await writeFile(to, bytes);
  } catch (error) {
    // A running development copy locks its executable. Its payload still
    // updates; only a release build must carry the new stamp.
    if (release || !["EBUSY", "EPERM"].includes(error.code)) throw error;
    console.warn(`${EXE_NAME} is in use and keeps its old name, version and icon until the app is closed and this runs again`);
  }
}
// The Rust host's engine. Skipped when identical; a running development copy
// locks it, and its engine is just Node, so the old copy keeps working until
// the app is closed. A release always gets the new one.
async function placeNode(from, to) {
  if (existsSync(to) && (await fileDigest(from)) === (await fileDigest(to))) return;
  try {
    await cp(from, to);
  } catch (error) {
    if (release || !["EBUSY", "EPERM"].includes(error.code)) throw error;
    console.warn(`${NODE_NAME} is in use and keeps its old copy until the app is closed and this runs again`);
  }
}
async function copyRuntime(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    // electron's own debug.log names the builder's user folder; never ship it
    if (source === ELECTRON_DIST && entry.name === "debug.log") continue;
    const from = path.join(source, entry.name);
    const executable = source === ELECTRON_DIST && entry.name === "electron.exe";
    const to = path.join(target, executable ? EXE_NAME : entry.name);
    if (entry.isDirectory()) { await copyRuntime(from, to); continue; }
    if (executable) { await placeExecutable(from, to); continue; }
    if (existsSync(to)) {
      const [before, after] = await Promise.all([fileDigest(from), fileDigest(to)]);
      if (before === after) continue;
    }
    await cp(from, to);
  }
}
// A development folder can switch hosts. What the other host put beside the
// program goes, so a host build carries no Chromium runtime and an Electron
// build no node.exe. Release folders are always new and hold nothing stale.
async function removeStale(names) {
  for (const name of names) {
    const target = path.join(OUT_DIR, ...name.split("/"));
    if (!existsSync(target)) continue;
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      if (release) throw error;
      console.warn(`${name} is in use and stays until the app is closed and this runs again (${error.code ?? error.message})`);
    }
  }
}
if (HOST === "electron") {
  await removeStale([NODE_NAME]);
  await copyRuntime(ELECTRON_DIST, OUT_DIR);
} else {
  // The list of Electron's files lives with the updater, which removes the
  // same names from an install that moves to the host.
  const { ELECTRON_RUNTIME } = await import("./release-updater.mjs");
  await removeStale(ELECTRON_RUNTIME);
  await placeExecutable(hostExe, path.join(OUT_DIR, EXE_NAME));
  await placeNode(nodeSource, path.join(OUT_DIR, NODE_NAME));
}

// What's new: this build's notes come from the changelog's released sections
// (scripts/release-notes.mjs) before assets/ is copied, so the package says
// what changed in its own version. A failure keeps the file that is there.
try {
  const { generate: writeWhatsNew } = await import("./release-notes.mjs");
  const notes = await writeWhatsNew({ root: STUDIO });
  console.log(`assets/whats-new.json: ${notes.versions.join(", ") || "no versions with notes"}${notes.changed ? " (refreshed from CHANGELOG.md; commit it)" : ""}`);
  if (release && !notes.table[pkg.version]) console.warn(`CHANGELOG.md has no released section with bold-lead bullets for ${pkg.version}, so What's new will say nothing after this build installs.`);
} catch (error) {
  console.warn(`could not refresh assets/whats-new.json (${error.message}); the file that is there ships as it is`);
}

// 2. app payload
for (const entry of ["main.cjs", "preload.cjs", "README.md", "GETTING_STARTED.md"]) {
  await cp(path.join(STUDIO, entry), path.join(APP_DIR, entry));
}
for (const dir of ["renderer", "scripts", "assets"]) {
  if (existsSync(path.join(STUDIO, dir))) await cp(path.join(STUDIO, dir), path.join(APP_DIR, dir), { recursive: true });
}

// Ship only public catalog data. Source data is personal even when the
// destination is empty. An existing development payload keeps its own state;
// a --release payload is always new and cannot inherit either data store.
const CATALOG = new Set(["curated.json", "models.json"]);
const dataSource = path.join(STUDIO, "data");
const dataTarget = path.join(APP_DIR, "data");
const kept = existsSync(dataTarget) ? (await readdir(dataTarget)).filter((name) => !CATALOG.has(name)).length : 0;
if (existsSync(dataSource)) {
  await mkdir(dataTarget, { recursive: true });
  for (const entry of await readdir(dataSource)) {
    if (!CATALOG.has(entry)) continue;
    const target = path.join(dataTarget, entry);
    await cp(path.join(dataSource, entry), target, { recursive: true });
  }
}
const appPkg = {
  name: pkg.name,
  productName: pkg.productName,
  version: pkg.version,
  description: pkg.description,
  main: pkg.main,
};
await writeFile(path.join(APP_DIR, "package.json"), JSON.stringify(appPkg, null, 2) + "\n");

console.log(`portable app ready (${HOST} host): ${path.relative(STUDIO, path.join(OUT_DIR, EXE_NAME))}`);
console.log(`payload: ${path.relative(STUDIO, APP_DIR)}`);
if (HOST === "tauri") console.log(`host program: ${hostExe}\nengine: ${NODE_NAME} from ${nodeSource}`);
if (release) console.log(`Clean distribution folder: ${releaseRoot}\nZip the entire Mefi Studio AI+ folder before opening it. Local settings, tasks, keys and caches were not included.`);
if (kept) console.log(`live state kept: ${kept} data file${kept === 1 ? "" : "s"} already in the payload were left untouched`);
