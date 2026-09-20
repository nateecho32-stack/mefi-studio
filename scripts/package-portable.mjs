// Builds a portable desktop app: copies the cached Electron runtime next to a
// resources/app payload. Double-click "Mefi Studio AI+.exe" to run; the app
// resolves REPO_ROOT from its own location (dist/<app>/ -> repo).
//
//   node scripts/package-portable.mjs [--clean]
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON_DIST = path.join(STUDIO, "node_modules", "electron", "dist");
const release = process.argv.includes("--release");
const clean = process.argv.includes("--clean");
if (release && clean) throw new Error("Use --release by itself. Release builds always use a new, empty folder.");
const pkg = JSON.parse(await readFile(path.join(STUDIO, "package.json"), "utf8"));
let releaseRoot = null;
if (release) {
  const releases = path.join(STUDIO, "dist", "releases");
  await mkdir(releases, { recursive: true });
  releaseRoot = await mkdtemp(path.join(releases, `mefi-studio-${String(pkg.version).replace(/[^a-zA-Z0-9.-]/g, "-")}-`));
}
const OUT_DIR = path.join(releaseRoot || path.join(STUDIO, "dist"), "Mefi Studio AI+");
const APP_DIR = path.join(OUT_DIR, "resources", "app");
const EXE_NAME = "Mefi Studio AI+.exe";

if (!existsSync(ELECTRON_DIST)) {
  console.error("electron dist missing - run: npm install (then node node_modules/electron/install.js)");
  process.exit(1);
}
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

// 1. Electron runtime. An open app locks its DLLs on Windows. Reuse byte-
// identical files so a code-only rebuild needs neither a shutdown nor a
// second runtime copy. A changed runtime still requires the app to close.
async function fileDigest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function copyRuntime(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, source === ELECTRON_DIST && entry.name === "electron.exe" ? EXE_NAME : entry.name);
    if (entry.isDirectory()) { await copyRuntime(from, to); continue; }
    if (existsSync(to)) {
      const [before, after] = await Promise.all([fileDigest(from), fileDigest(to)]);
      if (before === after) continue;
    }
    await cp(from, to);
  }
}
await copyRuntime(ELECTRON_DIST, OUT_DIR);

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

console.log(`portable app ready: ${path.relative(STUDIO, path.join(OUT_DIR, EXE_NAME))}`);
console.log(`payload: ${path.relative(STUDIO, APP_DIR)}`);
if (release) console.log(`Clean distribution folder: ${releaseRoot}\nZip the entire Mefi Studio AI+ folder before opening it. Local settings, tasks, keys and caches were not included.`);
if (kept) console.log(`live state kept: ${kept} data file${kept === 1 ? "" : "s"} already in the payload were left untouched`);
