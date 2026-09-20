// GitHub release updater contracts: pure-module behavior through the real
// scripts/release-updater.mjs. Version parsing and semver precedence for the
// tag shapes a release can carry; release normalization with the API's asset
// and digest metadata; the check (newer/equal/older, private-repo 404 hint,
// refusal, malformed body) driven by a fake fetch that records what the host
// sends; streaming download with sha256 and progress; checksum asset parsing;
// the hand-rolled zip writer and central-directory extractor round-tripping
// nested and unicode entries; zip-slip refusal on a crafted archive; staging
// that finds the portable root and rejects an unexpected payload; and the
// PowerShell apply helper's wait/copy/relaunch/cleanup shape with escaping.
// The wiring is pinned at source shape: main.cjs's 20-minute watcher reads the
// module's cadence, exposes the release:status/check/apply IPC, resolves the
// GitHub token, and stops the watcher on quit; preload, the template and
// nav.js expose the button the user presses.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  CHECK_INTERVAL_MS,
  DEFAULT_REPO,
  buildApplyScript,
  checkForRelease,
  compareVersions,
  crc32,
  describeRelease,
  downloadAsset,
  extractZip,
  isNewer,
  parseChecksum,
  parseVersion,
  payloadRoot,
  releaseAssetName,
  selectAsset,
  stageUpdate,
  zipDirectory,
} from "../scripts/release-updater.mjs";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixtureRelease({ tag = "v0.2.0", asset = true, digest = "sha256:aaa" } = {}) {
  const assets = [];
  if (asset) {
    assets.push({
      id: 1,
      name: releaseAssetName(tag),
      size: 2048,
      url: "https://api.github.com/repos/owner/repo/releases/assets/1",
      browser_download_url: `https://github.com/owner/repo/releases/download/${tag}/build.zip`,
      digest,
    });
    assets.push({
      id: 2,
      name: `${releaseAssetName(tag)}.sha256`,
      size: 80,
      url: "https://api.github.com/repos/owner/repo/releases/assets/2",
    });
  }
  return {
    tag_name: tag,
    name: `Mefi's Studio AI+ ${tag}`,
    body: "release notes",
    html_url: `https://github.com/owner/repo/releases/tag/${tag}`,
    published_at: "2026-01-01T00:00:00Z",
    prerelease: false,
    assets,
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test("versions parse, prefix-tolerant, and compare by semver precedence", () => {
  assert.deepEqual(parseVersion("v1.2.3"), { raw: "1.2.3", major: 1, minor: 2, patch: 3, pre: null });
  assert.equal(parseVersion("1.2") , null);
  assert.equal(parseVersion("release-1.2.3"), null);
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.11"), -1, "numeric prerelease identifiers compare numerically");
  assert.equal(compareVersions("1.0.0-beta", "1.0.0"), -1, "a prerelease sorts before its release");
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0-beta.2"), 1, "alphanumeric identifiers compare as text");
  assert.equal(isNewer("v0.2.0", "0.1.5"), true);
  assert.equal(isNewer("0.1.0", "0.1.0"), false);
  assert.equal(isNewer("garbage", "0.1.0"), false);
});

test("release assets resolve to the platform zip and its checksum sibling", () => {
  assert.equal(releaseAssetName("v0.2.0"), "Mefi-Studio-AI+-v0.2.0-win32-x64.zip");
  const json = fixtureRelease();
  const { asset, checksum } = selectAsset(json, { platform: "win32", arch: "x64" });
  assert.equal(asset.name, "Mefi-Studio-AI+-v0.2.0-win32-x64.zip");
  assert.equal(checksum.name, "Mefi-Studio-AI+-v0.2.0-win32-x64.zip.sha256");
  const described = describeRelease(json, { platform: "win32", arch: "x64" });
  assert.equal(described.version, "0.2.0");
  assert.equal(described.tag, "v0.2.0");
  assert.equal(described.asset.digest, "sha256:aaa");
  assert.equal(describeRelease({ ...json, tag_name: "not-a-version" }), null);
  assert.deepEqual(selectAsset({ tag_name: "v0.2.0", assets: [] }), { asset: null, checksum: null });
});

test("the check reports newer, equal and older releases, and never throws", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(200, fixtureRelease());
  };
  const newer = await checkForRelease({ repo: "owner/repo", currentVersion: "0.1.0", fetchImpl, token: "secret" });
  assert.equal(newer.ok, true);
  assert.equal(newer.update.version, "0.2.0");
  assert.equal(calls[0].url, "https://api.github.com/repos/owner/repo/releases/latest");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");

  const same = await checkForRelease({ repo: "owner/repo", currentVersion: "0.2.0", fetchImpl });
  assert.equal(same.ok, true);
  assert.equal(same.update, null, "the running version is not an update");

  const older = await checkForRelease({ repo: "owner/repo", currentVersion: "0.3.0", fetchImpl });
  assert.equal(older.update, null);

  const missing = await checkForRelease({ repo: "owner/repo", currentVersion: "0.1.0", fetchImpl: async () => jsonResponse(404, {}) });
  assert.equal(missing.ok, false);
  assert.equal(missing.needsToken, true, "a private repo's 404 tells the user a token is the way in");
  const missingWithToken = await checkForRelease({ repo: "owner/repo", currentVersion: "0.1.0", token: "t", fetchImpl: async () => jsonResponse(404, {}) });
  assert.equal(missingWithToken.needsToken, false);
  const refused = await checkForRelease({ repo: "owner/repo", currentVersion: "0.1.0", fetchImpl: async () => jsonResponse(403, {}) });
  assert.equal(refused.needsToken, true);
  const broken = await checkForRelease({ repo: "owner/repo", currentVersion: "0.1.0", fetchImpl: async () => jsonResponse(200, { tag_name: "nope" }) });
  assert.equal(broken.ok, false);
  const noAsset = await checkForRelease({ repo: "owner/repo", currentVersion: "0.1.0", fetchImpl: async () => jsonResponse(200, fixtureRelease({ asset: false })) });
  assert.match(noAsset.error, /no win32 zip asset/);
  const network = await checkForRelease({ repo: "owner/repo", currentVersion: "0.1.0", fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(network.ok, false);
  assert.match(network.error, /offline/);
  assert.equal((await checkForRelease({ currentVersion: "nope", fetchImpl })).ok, false);
});

test("download streams to disk, hashes, and reports progress", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mefi-release-download-"));
  const bytes = Buffer.from("portable payload".repeat(1000));
  const progress = [];
  const digest = createHash("sha256").update(bytes).digest("hex");
  const response = {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(bytes.length) : null) },
    body: Readable.from([bytes.subarray(0, 111), bytes.subarray(111)]),
  };
  const result = await downloadAsset({
    asset: { name: "Mefi-Studio-AI+-v0.2.0-win32-x64.zip", size: bytes.length, url: "https://api.github.com/assets/1" },
    directory,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.github.com/assets/1");
      assert.equal(options.headers.Accept, "application/octet-stream");
      return response;
    },
    onProgress: (row) => progress.push(row),
  });
  assert.equal(result.sha256, digest);
  assert.equal(result.bytes, bytes.length);
  assert.equal(progress.at(-1).received, bytes.length);
  assert.equal(progress.at(-1).total, bytes.length);
  assert.equal(await readFile(result.path, "utf8"), bytes.toString("utf8"));
  await assert.rejects(downloadAsset({ asset: { url: "" }, directory }), /no download url/);
  await rm(directory, { recursive: true, force: true });
});

test("checksum files parse, and a bad digest is a hard stop", () => {
  const sha = "a".repeat(64);
  assert.equal(parseChecksum(`${sha}  build.zip\n`), sha);
  assert.equal(parseChecksum("no checksum here"), null);
});

async function makePortableZip(root, { payload = true } = {}) {
  const content = path.join(root, "content");
  if (payload) {
    await mkdir(path.join(content, "resources", "app", "renderer"), { recursive: true });
    await writeFile(path.join(content, "resources", "app", "main.cjs"), "// main\n");
    await writeFile(path.join(content, "resources", "app", "preload.cjs"), "// preload\n");
    await writeFile(path.join(content, "resources", "app", "renderer", "booklet.html"), "<html></html>");
  }
  await mkdir(path.join(content, "sub", "deep"), { recursive: true });
  await writeFile(path.join(content, "sub", "hello.txt"), "hello world");
  await writeFile(path.join(content, "sub", "deep", "π.txt"), "unicode entry");
  await mkdir(path.join(content, "empty"), { recursive: true });
  const zipPath = path.join(root, "build.zip");
  const result = await zipDirectory(content, zipPath, { rootName: "Mefi Studio AI+" });
  return { zipPath, result };
}

test("the zip writer and extractor round-trip nested, unicode and payload files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-release-zip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { zipPath, result } = await makePortableZip(root);
  assert.equal(result.entries, 5);
  const out = path.join(root, "out");
  const names = await extractZip(zipPath, out);
  assert.deepEqual(names.sort(), ["Mefi Studio AI+/resources/app/main.cjs", "Mefi Studio AI+/resources/app/preload.cjs", "Mefi Studio AI+/resources/app/renderer/booklet.html", "Mefi Studio AI+/sub/deep/π.txt", "Mefi Studio AI+/sub/hello.txt"].sort());
  assert.equal(await readFile(path.join(out, "Mefi Studio AI+", "sub", "hello.txt"), "utf8"), "hello world");
  assert.equal(await readFile(path.join(out, "Mefi Studio AI+", "sub", "deep", "π.txt"), "utf8"), "unicode entry");
  assert.equal((await stat(path.join(out, "Mefi Studio AI+", "resources", "app", "main.cjs"))).isFile(), true);

  const portable = await payloadRoot(out);
  assert.equal(path.basename(portable), "Mefi Studio AI+");
  const staged = await stageUpdate({ zipPath, stagingDir: path.join(root, "staging"), installRoot: "C:\\Portable" });
  assert.equal(staged.sourceRoot, path.join(root, "staging", "Mefi Studio AI+"));
  assert.equal(staged.exePath, path.join("C:\\Portable", "Mefi Studio AI+.exe"));
});

function rawZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuffer.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, data);
    central.push(entry, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralSize = central.reduce((sum, buffer) => sum + buffer.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, eocd]);
}

test("a crafted archive cannot write outside the extraction folder", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-release-slip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const zipPath = path.join(root, "evil.zip");
  await writeFile(zipPath, rawZip([["../evil.txt", "escape"]]));
  await assert.rejects(extractZip(zipPath, path.join(root, "out")), /escapes the target folder/);
  assert.equal(await stat(path.join(root, "evil.txt")).then(() => true, () => false), false);
});

test("staging refuses an archive that is not the portable payload", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-release-stage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { zipPath } = await makePortableZip(root, { payload: false });
  await assert.rejects(stageUpdate({ zipPath, stagingDir: path.join(root, "staging"), installRoot: root }), /does not carry the portable app payload/);
});

test("the apply helper waits for the pid, excludes data, relaunches and cleans up", () => {
  const script = buildApplyScript({
    sourceRoot: "C:\\Temp\\mefi-studio-update\\v0.2.0\\staging\\Mefi Studio AI+",
    installRoot: "C:\\Users\\O'Brien\\Portable\\Mefi Studio AI+",
    exePath: "C:\\Users\\O'Brien\\Portable\\Mefi Studio AI+\\Mefi Studio AI+.exe",
    pid: 1234,
    version: "0.2.0",
    cleanupRoot: "C:\\Temp\\mefi-studio-update\\v0.2.0",
    logPath: "C:\\Temp\\mefi-studio-update\\v0.2.0\\apply-update.log",
  });
  assert.match(script, /Wait-Process -Id \$pidToWait -Timeout 180/);
  assert.match(script, /robocopy\.exe/);
  assert.match(script, /resources\\app\\data/);
  assert.match(script, /\/XD/);
  assert.match(script, /'--released', '0.2.0'/);
  assert.match(script, /Start-Process -FilePath \$exe/);
  assert.match(script, /Remove-Item -LiteralPath 'C:\\Temp\\mefi-studio-update\\v0\.2\.0' -Recurse -Force/);
  assert.ok(script.includes("O''Brien"), "apostrophes in paths are doubled for PowerShell");
  assert.equal(CHECK_INTERVAL_MS, 20 * 60 * 1000);
  assert.equal(DEFAULT_REPO, "nateecho32-stack/mefi-studio");
});

test("the host, bridge and page wire the 20-minute GitHub check", async () => {
  const main = await readFile(path.join(STUDIO, "main.cjs"), "utf8");
  const preload = await readFile(path.join(STUDIO, "preload.cjs"), "utf8");
  const nav = await readFile(path.join(STUDIO, "renderer", "nav.js"), "utf8");
  const template = await readFile(path.join(STUDIO, "renderer", "booklet.template.html"), "utf8");

  assert.match(main, /function startReleaseWatch\(\)/);
  assert.match(main, /module\.CHECK_INTERVAL_MS/, "the watcher reads the module's cadence instead of a second constant");
  assert.match(main, /setTimeout\(\(\) => startReleaseWatch\(\), 6000\)/);
  assert.match(main, /function stopReleaseWatch\(\)/);
  assert.match(main, /stopReleaseWatch\(\);/);
  assert.match(main, /ipcMain\.handle\("release:status"/);
  assert.match(main, /ipcMain\.handle\("release:check"/);
  assert.match(main, /ipcMain\.handle\("release:apply"/);
  assert.match(main, /scripts\/release-updater\.mjs/);
  assert.match(main, /githubTokenEncrypted/, "a saved GitHub token backs a private repository");
  assert.match(main, /gh", \["auth", "token"\]/, "the host falls back to the GitHub CLI login");
  assert.match(main, /release:event/);
  assert.match(main, /--released/);

  assert.match(preload, /releaseStatus: \(\) => ipcRenderer\.invoke\("release:status"\)/);
  assert.match(preload, /releaseCheck: \(\) => ipcRenderer\.invoke\("release:check"\)/);
  assert.match(preload, /releaseApply: \(\) => ipcRenderer\.invoke\("release:apply"\)/);
  assert.match(preload, /onReleaseEvent/);

  assert.match(template, /data-release-row/);
  assert.match(template, /id="release-apply"/);
  assert.match(template, /id="release-check"/);
  assert.match(template, /id="release-token"/);

  assert.match(nav, /function initRelease\(\)/);
  assert.match(nav, /initRelease\(\);/);
  assert.match(nav, /onReleaseEvent/);
  assert.match(nav, /#release-apply/);
  assert.match(nav, /data-release-row/);
});
