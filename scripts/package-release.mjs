// Mefi's Studio AI+ — builds the portable release zip and publishes it.
//
//   node scripts/package-release.mjs --version v0.2.0
//   node scripts/package-release.mjs --version v0.2.0 --publish
//
// The zip carries the whole portable folder (Electron runtime + resources/app,
// no data/) under a "Mefi Studio AI+" root, which is exactly the layout
// scripts/release-updater.mjs stages and swaps into an installed app. A
// sibling .sha256 file names the digest so the updater can verify a download.
// --publish uses the GitHub CLI: it creates the release (and its tag, when the
// tag is not pushed yet) or uploads over an existing one.
import { spawn } from "node:child_process";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build-booklet.mjs";
import {
  DEFAULT_ARCH,
  DEFAULT_PLATFORM,
  DEFAULT_REPO,
  PORTABLE_NAME,
  parseVersion,
  releaseAssetName,
  sha256File,
  zipDirectory,
} from "./release-updater.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: STUDIO, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(file)} exited with ${code}`))));
  });
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function portableRoots() {
  const releases = path.join(STUDIO, "dist", "releases");
  const entries = await readdir(releases, { withFileTypes: true }).catch(() => []);
  const roots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(releases, entry.name, PORTABLE_NAME);
    if (await isFile(path.join(root, "resources", "app", "main.cjs"))) {
      roots.push({ root, info: await stat(root) });
    }
  }
  roots.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  return roots.map((entry) => entry.root);
}

const pkgPath = path.join(STUDIO, "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
const requested = value("--version", null);
const version = parseVersion(requested ?? pkg.version);
if (!version) {
  console.error(`unreadable version: ${requested ?? pkg.version} (use --version vX.Y.Z)`);
  process.exit(1);
}
const repo = value("--repo", DEFAULT_REPO);
const publish = flag("--publish");
const skipBuild = flag("--skip-build");

if (pkg.version !== version.raw) {
  pkg.version = version.raw;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`package.json version set to ${version.raw}`);
}

if (!skipBuild) {
  const built = await build({ root: STUDIO });
  console.log(`built renderer/booklet.html — ${built.models} models`);
  await run(process.execPath, [path.join(STUDIO, "scripts", "package-portable.mjs"), "--release"]);
}

const roots = await portableRoots();
const portable = roots.find((root) => path.basename(path.dirname(root)).includes(version.raw)) ?? roots[0];
if (!portable) {
  console.error("no packaged release folder under dist/releases — run without --skip-build");
  process.exit(1);
}
console.log(`portable folder: ${path.relative(STUDIO, portable)}`);

const zipName = releaseAssetName(version.raw, { platform: DEFAULT_PLATFORM, arch: DEFAULT_ARCH });
const zipPath = path.join(STUDIO, "dist", "releases", zipName);
const checksumPath = `${zipPath}.sha256`;
await rm(zipPath, { force: true });
const zipped = await zipDirectory(portable, zipPath, { rootName: PORTABLE_NAME });
const digest = await sha256File(zipPath);
await writeFile(checksumPath, `${digest}  ${zipName}\n`);
console.log(`release zip: ${path.relative(STUDIO, zipPath)} (${zipped.entries} files)`);
console.log(`sha256: ${digest}`);

if (publish) {
  const tag = `v${version.raw}`;
  const assets = [zipPath, checksumPath];
  const view = await new Promise((resolve) => {
    const child = spawn("gh", ["release", "view", tag, "--repo", repo], { stdio: "ignore", windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
  if (view) {
    console.log(`release ${tag} exists — uploading assets over it`);
    await run("gh", ["release", "upload", tag, ...assets, "--clobber", "--repo", repo]);
  } else {
    await run("gh", [
      "release",
      "create",
      tag,
      ...assets,
      "--repo",
      repo,
      "--title",
      `${PORTABLE_NAME} v${version.raw}`,
      "--notes",
      `Portable Windows build of ${PORTABLE_NAME} v${version.raw}.\n\nStudio checks this release from its App updates block and installs it in place; user data (data/) never travels in the zip.`,
    ]);
  }
  console.log(`published: https://github.com/${repo}/releases/tag/${tag}`);
} else {
  console.log(`not published — rerun with --publish (or upload ${zipName} and its .sha256 by hand)`);
}
