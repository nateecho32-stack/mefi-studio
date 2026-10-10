// Mefi's Studio AI+ — GitHub release update engine (pure Node ESM, no Electron
// import). The host (main.cjs) asks GitHub for the newest published release at
// a slow cadence, compares its tag with the running app's version, and — when
// the user asks — downloads the release zip, verifies its SHA-256 when the
// release names one, extracts it, and stages the portable payload. The swap
// itself happens after the app exits: buildApplyScript writes a PowerShell
// helper that waits for the host pid, robocopies the staged folder over the
// install folder (never resources/app/data), and relaunches the app.
// Importing this file has no side effects, so tests drive it from plain node.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

// Portable payloads contain .asar files. Electron's patched fs treats them as
// virtual directories, even while extraction is writing an incomplete archive.
// Use raw disk I/O for update bytes; the Node engine and packager keep Node fs.
const disk = createRequire(import.meta.url)(process.versions.electron ? "original-fs" : "node:fs");
const { createReadStream, createWriteStream } = disk;
const { mkdir, open, readdir, readFile, rm, stat, writeFile } = disk.promises;

export const DEFAULT_REPO = "nateecho32-stack/mefi-studio";
// The host's release watcher reads this cadence: GitHub every 20 minutes.
export const CHECK_INTERVAL_MS = 20 * 60 * 1000;
export const DEFAULT_PLATFORM = "win32";
export const DEFAULT_ARCH = "x64";
export const PORTABLE_NAME = "Mefi Studio AI+";
export const USER_AGENT = "mefi-studio-release-updater";

// ---- hosts -----------------------------------------------------------------
// A portable build runs on one of two hosts (docs/rust-migration.md). Both
// keep the same folder: "Mefi Studio AI+.exe" beside resources/app. The
// Electron build carries Chromium's runtime files next to the program; the
// Rust host build carries node.exe instead, which runs main.cjs as its engine.
export const HOSTS = ["electron", "tauri"];
export const DEFAULT_HOST = "electron";
export const HOST_NODE = "node.exe";
// What Electron puts beside its program (Electron 44, plus the ANGLE DLLs that
// older installed builds still carry). An update to a host build removes these
// from the install folder once the new build is copied in, so a Rust-host
// install holds no Chromium runtime. A name the staged build ships itself is
// never removed.
export const ELECTRON_RUNTIME = [
  "LICENSE",
  "LICENSES.chromium.html",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "d3dcompiler_47.dll",
  "dxcompiler.dll",
  "dxil.dll",
  "ffmpeg.dll",
  "icudtl.dat",
  "libEGL.dll",
  "libGLESv2.dll",
  "locales",
  "resources.pak",
  "resources/default_app.asar",
  "snapshot_blob.bin",
  "v8_context_snapshot.bin",
  "version",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll",
];
// Files only an Electron runtime has: one of them beside the program means
// the folder is an Electron build.
const ELECTRON_MARKERS = ["icudtl.dat", "resources.pak", "v8_context_snapshot.bin"];

export function normalizeHost(value) {
  const host = String(value ?? "").trim().toLowerCase();
  return HOSTS.includes(host) ? host : null;
}

// Which host this engine runs under. main.cjs runs inside Electron, or under
// plain Node as the Rust host's engine, which the host marks with
// MEFI_STUDIO_HOST=tauri (main.cjs picks its Electron shim by the same value).
export function runningHost(env = process.env, versions = process.versions) {
  return !versions?.electron && env?.MEFI_STUDIO_HOST === "tauri" ? "tauri" : "electron";
}

// ---- versions --------------------------------------------------------------

export function parseVersion(value) {
  const text = String(value ?? "").trim().replace(/^v/i, "");
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  if (match.slice(1, 4).some(v => !Number.isSafeInteger(Number(v)) || /^0\d/.test(v))) return null;
  if (match[4] && match[4].split(".").some(v => !v || (/^\d+$/.test(v) && (!Number.isSafeInteger(Number(v)) || /^0\d/.test(v))))) return null;
  return { raw: text, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? null };
}

// Semver precedence for the shapes a release tag can take. A prerelease sorts
// before its own release (1.2.0-beta < 1.2.0); numeric identifiers compare
// numerically, and a numeric identifier sorts before an alphanumeric one.
export function compareVersions(a, b) {
  const left = typeof a === "string" ? parseVersion(a) : a;
  const right = typeof b === "string" ? parseVersion(b) : b;
  if (!left || !right) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  const leftParts = left.pre.split(".");
  const rightParts = right.pre.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const one = leftParts[index];
    const two = rightParts[index];
    if (one === undefined) return -1;
    if (two === undefined) return 1;
    if (one === two) continue;
    const oneNumeric = /^\d+$/.test(one);
    const twoNumeric = /^\d+$/.test(two);
    if (oneNumeric && twoNumeric) return Number(one) < Number(two) ? -1 : 1;
    if (oneNumeric) return -1;
    if (twoNumeric) return 1;
    return one < two ? -1 : 1;
  }
  return 0;
}

export function isNewer(remote, current) {
  const comparison = compareVersions(remote, current);
  return comparison === null ? false : comparison > 0;
}

// ---- release metadata ------------------------------------------------------

// The Electron build keeps the name every installed copy already looks for;
// a Rust-host build adds "-tauri", so one release can carry both and a copy
// that predates the host builds never downloads one.
export function releaseAssetName(version, { platform = DEFAULT_PLATFORM, arch = DEFAULT_ARCH, host = DEFAULT_HOST } = {}) {
  const clean = String(version ?? "").trim().replace(/^v/i, "").replace(/[^0-9A-Za-z.-]/g, "-");
  const suffix = normalizeHost(host) === "tauri" ? "-tauri" : "";
  return `${PORTABLE_NAME.replace(/\s+/g, "-")}-v${clean}-${platform}-${arch}${suffix}.zip`;
}

// A copy prefers a build for the host it runs on and takes the other when the
// release carries only that one: that is how an Electron install moves to the
// Rust host (and how a host install could return to an Electron release).
export function selectAsset(release, { platform = DEFAULT_PLATFORM, arch = DEFAULT_ARCH, host = runningHost() } = {}) {
  const assets = (Array.isArray(release?.assets) ? release.assets : []).filter((asset) => typeof asset?.name === "string");
  const zips = assets.filter((asset) => /\.zip$/i.test(asset.name));
  const own = normalizeHost(host) ?? DEFAULT_HOST;
  for (const candidate of [own, ...HOSTS.filter((other) => other !== own)]) {
    const wanted = releaseAssetName(release?.tag_name ?? release?.name ?? "", { platform, arch, host: candidate }).toLowerCase();
    const asset = zips.find((zip) => zip.name.toLowerCase() === wanted);
    if (!asset) continue;
    const checksum = assets.find((sibling) => sibling.name.toLowerCase() === `${asset.name.toLowerCase()}.sha256`) ?? null;
    return { asset, checksum, host: candidate };
  }
  return { asset: null, checksum: null };
}

export function describeRelease(release, { platform = DEFAULT_PLATFORM, arch = DEFAULT_ARCH, host = runningHost() } = {}) {
  if (!release || release.draft) return null;
  const parsed = parseVersion(release.tag_name) ?? parseVersion(release.name);
  if (!parsed) return null;
  const { asset, checksum, host: assetHost } = selectAsset(release, { platform, arch, host });
  return {
    version: parsed.raw,
    tag: release.tag_name ?? `v${parsed.raw}`,
    name: release.name ?? release.tag_name ?? parsed.raw,
    notes: typeof release.body === "string" ? release.body.slice(0, 4000) : "",
    htmlUrl: release.html_url ?? null,
    publishedAt: release.published_at ?? null,
    prerelease: Boolean(release.prerelease),
    asset: asset
      ? {
          id: asset.id ?? null,
          name: asset.name,
          size: Number(asset.size) || 0,
          url: asset.url,
          browserDownloadUrl: asset.browser_download_url ?? null,
          digest: typeof asset.digest === "string" ? asset.digest : null,
          host: assetHost ?? DEFAULT_HOST,
        }
      : null,
    checksum: checksum ? { id: checksum.id ?? null, name: checksum.name, size: Number(checksum.size) || 0, url: checksum.url } : null,
  };
}

export function githubHeaders(token = null) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Metadata controls executable downloads and credential destinations. Only
// the selected repository's GitHub API asset endpoints may receive a token.
export function validateBuildAssets(build, repo = DEFAULT_REPO) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("invalid update repository");
  for (const asset of [build?.asset, build?.checksum].filter(Boolean)) {
    const url = new URL(asset.url);
    const prefix = `/repos/${repo}/`;
    const suffix = url.pathname.slice(prefix.length);
    if (url.origin !== "https://api.github.com" || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix) || !/^(?:releases\/assets\/\d+|actions\/artifacts\/\d+\/zip)$/.test(suffix)) throw new Error("update asset is outside the selected GitHub repository");
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 1024 * 1024 * 1024) throw new Error("invalid update asset size");
  }
  if (!build?.asset || (!/^sha256:[a-f\d]{64}$/i.test(build.asset.digest ?? "") && !build.checksum)) throw new Error("the build has no SHA-256 verification metadata");
}

function timeoutSignal(ms) {
  if (typeof AbortSignal?.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref?.();
  return controller.signal;
}

// The check is read-only: it never throws for network trouble, it reports.
export async function checkForRelease({
  repo = DEFAULT_REPO,
  currentVersion,
  token = null,
  fetchImpl = globalThis.fetch,
  platform = DEFAULT_PLATFORM,
  arch = DEFAULT_ARCH,
  apiBase = "https://api.github.com",
  timeoutMs = 15000,
  allowStableReturn = false,
  host = runningHost(),
} = {}) {
  const checkedAt = Date.now();
  const current = parseVersion(currentVersion);
  if (!current) return { ok: false, error: `unreadable current version: ${currentVersion}`, checkedAt };
  if (typeof fetchImpl !== "function") return { ok: false, error: "no fetch implementation available", checkedAt };
  try {
    const response = await fetchImpl(`${apiBase}/repos/${repo}/releases/latest`, {
      headers: githubHeaders(token),
      redirect: "follow",
      signal: timeoutSignal(timeoutMs),
    });
    if (response.status === 404) {
      // GitHub answers 404 both for a private repository seen without a token
      // and for a public repository that simply has no release yet. Only the
      // second is the normal "nothing published" state, so a tokenless 404
      // asks whether the repository itself is visible before blaming a token.
      const visible = token ? true : await repoVisible({ repo, fetchImpl, apiBase, timeoutMs });
      return {
        ok: false,
        error: visible
          ? "no published release found for this repository"
          : "no release found — a private repository needs a GitHub token",
        needsToken: !visible,
        checkedAt,
      };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "GitHub refused the release check (bad token or rate limit)", needsToken: true, checkedAt };
    }
    if (!response.ok) return { ok: false, error: `GitHub answered ${response.status}`, checkedAt };
    const json = await response.json();
    if (!json.published_at) return { ok: false, error: "stable updates require a published release", checkedAt };
    const latest = describeRelease(json, { platform, arch, host });
    if (!latest) return { ok: false, error: "the latest release has no readable version", checkedAt };
    if (latest.prerelease || parseVersion(latest.version)?.pre) return { ok: false, error: "stable updates require a published stable release", checkedAt };
    if (!latest.asset) return { ok: false, error: `release ${latest.tag} has no ${platform} zip asset`, checkedAt };
    validateBuildAssets(latest, repo);
    latest.channel = "stable";
    return { ok: true, current: current.raw, latest, update: isNewer(latest.version, current.raw) || (allowStableReturn && current.pre && latest.version !== current.raw) ? latest : null, checkedAt };
  } catch (error) {
    const aborted = error?.name === "AbortError" || error?.name === "TimeoutError";
    return { ok: false, error: aborted ? "the release check timed out" : String(error?.message ?? error).slice(0, 300), checkedAt };
  }
}

// True when the repository page itself answers 200 without credentials, so a
// missing release is a missing release and not a hidden repository. Any
// failure counts as "not visible": the token hint then stays as the safe fallback.
async function repoVisible({ repo, fetchImpl, apiBase, timeoutMs }) {
  try {
    const response = await fetchImpl(`${apiBase}/repos/${repo}`, {
      headers: githubHeaders(null),
      redirect: "follow",
      signal: timeoutSignal(timeoutMs),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

function safeFileName(name) {
  const base = path.basename(String(name ?? "release.zip")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return base.toLowerCase().endsWith(".zip") ? base : `${base}.zip`;
}

// Release asset API urls hand over the bytes only for an octet-stream Accept.
// The Actions artifact zip endpoint answers that same header with 415 and
// wants the ordinary GitHub Accept, then redirects to the archive.
export function downloadAccept(url) {
  return /\/actions\/artifacts\/\d+\/zip$/.test(String(url ?? "")) ? "application/vnd.github+json" : "application/octet-stream";
}

// Streams the asset to disk, hashing and reporting as it goes. `asset.url` is
// the API url for API-described assets, which works for public and private
// repositories alike because the Accept header asks for the bytes.
export async function downloadAsset({
  asset,
  directory,
  token = null,
  fetchImpl = globalThis.fetch,
  onProgress = () => {},
  timeoutMs = 30 * 60 * 1000,
} = {}) {
  if (!asset?.url) throw new Error("release asset has no download url");
  if (typeof fetchImpl !== "function") throw new Error("no fetch implementation available");
  await mkdir(directory, { recursive: true });
  const headers = githubHeaders(token);
  headers.Accept = downloadAccept(asset.url);
  const response = await fetchImpl(asset.url, { headers, redirect: "follow", signal: timeoutSignal(timeoutMs) });
  if (!response.ok) throw new Error(`download failed: GitHub answered ${response.status}`);
  const total = Number(response.headers?.get?.("content-length")) || Number(asset.size) || 0;
  const file = path.join(directory, safeFileName(asset.name));
  const hash = createHash("sha256");
  let received = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      received += chunk.length;
      onProgress({ received, total });
      callback(null, chunk);
    },
  });
  const body = response.body;
  const source = body && typeof body.getReader === "function" ? Readable.fromWeb(body) : body;
  if (!source) throw new Error("download response has no body");
  try {
    await pipeline(source, meter, createWriteStream(file));
    if (Number(asset.size) > 0 && received !== Number(asset.size)) throw new Error("download size does not match the GitHub asset");
  } catch (error) {
    await rm(file, { force: true }).catch(() => {});
    throw error;
  }
  return { path: file, bytes: received, total, sha256: hash.digest("hex") };
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function parseChecksum(text) {
  const match = String(text ?? "").match(/\b([0-9a-fA-F]{64})\b/);
  return match ? match[1].toLowerCase() : null;
}

export async function fetchChecksum({ asset, token = null, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!asset?.url) return null;
  const headers = githubHeaders(token);
  headers.Accept = "application/octet-stream";
  const response = await fetchImpl(asset.url, { headers, redirect: "follow", signal: timeoutSignal(timeoutMs) });
  if (!response.ok) return null;
  return parseChecksum(await response.text());
}

// ---- zip -------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer, seed = 0) {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let index = 0; index < buffer.length; index += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, value.getFullYear());
  const time = ((value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2)) & 0xffff;
  const day = (((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate()) & 0xffff;
  return { time, day };
}

async function* walkFiles(root, prefix = "") {
  const entries = (await readdir(path.join(root, prefix), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walkFiles(root, rel);
    else if (entry.isFile()) yield rel;
  }
}

// A dependency-free streaming zip writer: each file is deflated, the sizes and
// CRC ride in a data descriptor (general purpose bit 3), and the central
// directory closes the archive. `rootName` wraps every entry in one top-level
// folder, which is how a portable release zip carries "Mefi Studio AI+/".
export async function zipDirectory(sourceDir, zipPath, { rootName = path.basename(sourceDir), include = null } = {}) {
  const info = await stat(sourceDir);
  if (!info.isDirectory()) throw new Error(`not a directory: ${sourceDir}`);
  await mkdir(path.dirname(zipPath), { recursive: true });
  const out = createWriteStream(zipPath);
  let offset = 0;
  let writeFault = null;
  out.on("error", (error) => {
    writeFault ??= error;
  });
  const write = async (buffer) => {
    offset += buffer.length;
    if (!out.write(buffer)) await once(out, "drain");
  };
  const central = [];
  try {
    for await (const rel of walkFiles(sourceDir)) {
      if (typeof include === "function" && !include(String(rel).replace(/\\/g, "/"))) continue;
      const full = path.join(sourceDir, rel);
      const fileInfo = await stat(full);
      if (!fileInfo.isFile()) continue;
      if (fileInfo.size >= 0xffffffff) throw new Error(`file too large for a 32-bit zip entry: ${rel}`);
      const name = Buffer.from(rootName ? `${rootName}/${rel}` : rel, "utf8");
      if (name.length > 0xffff) throw new Error(`zip entry name too long: ${rel}`);
      const { time, day } = dosDateTime(fileInfo.mtime);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(0x0808, 6);
      head.writeUInt16LE(8, 8);
      head.writeUInt16LE(time, 10);
      head.writeUInt16LE(day, 12);
      head.writeUInt32LE(0, 14);
      head.writeUInt32LE(0, 18);
      head.writeUInt32LE(0, 22);
      head.writeUInt16LE(name.length, 26);
      head.writeUInt16LE(0, 28);
      const localStart = offset;
      await write(head);
      await write(name);
      let crc = 0;
      let size = 0;
      let compressed = 0;
      const deflate = zlib.createDeflateRaw({ level: 6 });
      const source = createReadStream(full);
      source.on("data", (chunk) => {
        crc = crc32(chunk, crc);
        size += chunk.length;
      });
      source.on("error", (error) => deflate.destroy(error));
      source.pipe(deflate);
      for await (const chunk of deflate) {
        compressed += chunk.length;
        await write(chunk);
      }
      if (size >= 0xffffffff) throw new Error(`file too large for a 32-bit zip entry: ${rel}`);
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed, 8);
      descriptor.writeUInt32LE(size, 12);
      await write(descriptor);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(20, 4);
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x0808, 8);
      entry.writeUInt16LE(8, 10);
      entry.writeUInt16LE(time, 12);
      entry.writeUInt16LE(day, 14);
      entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(compressed, 20);
      entry.writeUInt32LE(size, 24);
      entry.writeUInt16LE(name.length, 28);
      entry.writeUInt16LE(0, 30);
      entry.writeUInt16LE(0, 32);
      entry.writeUInt16LE(0, 34);
      entry.writeUInt16LE(0, 36);
      entry.writeUInt32LE(0, 38);
      entry.writeUInt32LE(localStart, 42);
      central.push(Buffer.concat([entry, name]));
    }
    const centralStart = offset;
    for (const entry of central) await write(entry);
    const centralSize = offset - centralStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralStart, 16);
    eocd.writeUInt16LE(0, 20);
    await write(eocd);
  } catch (error) {
    writeFault = error;
  }
  out.end();
  await once(out, "close").catch(() => {});
  if (writeFault) throw writeFault;
  return { path: zipPath, entries: central.length };
}

function safeJoin(root, name) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, name.replace(/\\/g, "/"));
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`zip entry escapes the target folder: ${name}`);
  }
  return target;
}

async function readExactly(handle, buffer, position) {
  let read = 0;
  while (read < buffer.length) {
    const result = await handle.read(buffer, read, buffer.length - read, position + read);
    if (result.bytesRead === 0) throw new Error("zip file ended early");
    read += result.bytesRead;
  }
}

// Reads the central directory, so entries written with a data descriptor (our
// own writer) extract with their real sizes. Zip64, encryption and unknown
// compression are refused instead of guessing.
export async function extractZip(zipPath, destDir) {
  const handle = await open(zipPath, "r");
  try {
    const info = await handle.stat();
    const tailLength = Math.min(Number(info.size), 65536 + 22);
    if (tailLength < 22) throw new Error("not a zip file");
    const tail = Buffer.alloc(tailLength);
    await readExactly(handle, tail, Number(info.size) - tailLength);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) {
        eocd = index;
        break;
      }
    }
    if (eocd < 0) throw new Error("not a zip file (no end of central directory)");
    const count = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
      throw new Error("zip64 archives are not supported");
    }
    const central = Buffer.alloc(centralSize);
    await readExactly(handle, central, centralOffset);
    const written = [];
    let cursor = 0;
    for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) throw new Error("corrupt zip central directory");
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const expectedCrc = central.readUInt32LE(cursor + 16);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const size = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const localOffset = central.readUInt32LE(cursor + 42);
      const name = central.toString("utf8", cursor + 46, cursor + 46 + nameLength);
      cursor += 46 + nameLength + extraLength + commentLength;
      if (name.endsWith("/")) {
        await mkdir(safeJoin(destDir, name), { recursive: true });
        continue;
      }
      if (flags & 0x1) throw new Error(`encrypted zip entry: ${name}`);
      if (method !== 0 && method !== 8) throw new Error(`unsupported zip compression for ${name}`);
      const local = Buffer.alloc(30);
      await readExactly(handle, local, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error(`corrupt zip entry: ${name}`);
      const dataOffset = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const target = safeJoin(destDir, name);
      await mkdir(path.dirname(target), { recursive: true });
      let seenCrc = 0;
      let seenBytes = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          seenCrc = crc32(chunk, seenCrc);
          seenBytes += chunk.length;
          callback(null, chunk);
        },
      });
      const source = createReadStream(zipPath, { start: dataOffset, end: dataOffset + compressedSize - 1 });
      const sink = createWriteStream(target);
      await new Promise((resolve, reject) => {
        source.on("error", reject);
        meter.on("error", reject);
        sink.on("error", reject);
        sink.on("finish", resolve);
        const stream = method === 8 ? source.pipe(zlib.createInflateRaw()).pipe(meter) : source.pipe(meter);
        stream.pipe(sink);
      });
      if (seenBytes !== size) throw new Error(`zip entry size mismatch: ${name}`);
      if (seenCrc !== expectedCrc) throw new Error(`zip entry checksum mismatch: ${name}`);
      written.push(name);
    }
    return written;
  } finally {
    await handle.close().catch(() => {});
  }
}

// ---- portable payload ------------------------------------------------------

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

// Which host a portable folder carries: "electron" when Chromium's runtime sits
// beside the program, "tauri" when node.exe does (and no Chromium runtime), or
// null when it carries neither.
export async function portableHost(root) {
  for (const name of ELECTRON_MARKERS) if (await isFile(path.join(root, name))) return "electron";
  if (await isFile(path.join(root, HOST_NODE))) return "tauri";
  return null;
}

// Finds the portable folder inside an extracted release: the zip carries
// "Mefi Studio AI+/resources/app/main.cjs" (plus the Electron runtime, or the
// Rust host's node.exe, next to it). Returns null when the archive has an
// unexpected layout.
export async function payloadRoot(stagingDir) {
  const candidates = [stagingDir];
  for (const entry of await readdir(stagingDir, { withFileTypes: true })) {
    if (entry.isDirectory()) candidates.push(path.join(stagingDir, entry.name));
  }
  for (const candidate of candidates) {
    if (await isFile(path.join(candidate, "resources", "app", "main.cjs"))) return candidate;
  }
  return null;
}

export async function stageUpdate({ zipPath, stagingDir, installRoot, expectedVersion = null }) {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await extractZip(zipPath, stagingDir);
  const sourceRoot = await payloadRoot(stagingDir);
  if (!sourceRoot) throw new Error("the release archive does not carry the portable app payload");
  const payload = path.join(sourceRoot, "resources", "app");
  if (!(await isFile(path.join(payload, "main.cjs"))) || !(await isFile(path.join(payload, "preload.cjs")))) {
    throw new Error("the release payload is missing main.cjs or preload.cjs");
  }
  const host = await portableHost(sourceRoot);
  if (expectedVersion) {
    const pkg = JSON.parse(await readFile(path.join(payload, "package.json"), "utf8"));
    if (pkg.name !== "mefi-studio" || pkg.productName !== "Mefi's Studio AI+" || pkg.version !== expectedVersion || pkg.main !== "main.cjs") throw new Error("the staged build identity or version does not match GitHub");
    if (!(await isFile(path.join(sourceRoot, `${PORTABLE_NAME}.exe`))) || !(await isFile(path.join(payload, "renderer", "booklet.html")))) throw new Error("the staged build is missing its executable or renderer");
    // A Rust-host build runs main.cjs on the node.exe it ships; one without
    // either runtime would replace a working install with one that cannot start.
    if (!host) throw new Error(`the staged build carries no runtime: neither Electron's files nor ${HOST_NODE} beside its executable`);
    // The install folder comes from the running program's path. Under the Rust
    // host that is node.exe's folder, which is the install only while node.exe
    // sits beside the host program; never copy a build anywhere else.
    if (!(await isFile(path.join(installRoot, "resources", "app", "main.cjs")))) throw new Error(`the install folder ${installRoot} does not hold Studio (resources/app/main.cjs), so the update was not staged`);
  }
  return { sourceRoot, payloadRoot: payload, exePath: path.join(installRoot, `${PORTABLE_NAME}.exe`), host };
}

// What an update to a Rust-host build leaves behind of an Electron install:
// the Chromium runtime names the install has and the staged build does not.
// Empty for any other update, so an Electron build never loses a file.
export async function runtimeLeftovers(sourceRoot, installRoot) {
  if ((await portableHost(sourceRoot)) !== "tauri") return [];
  const left = [];
  for (const name of ELECTRON_RUNTIME) {
    const installed = path.join(installRoot, ...name.split("/"));
    if ((await stat(installed).then(() => true, () => false)) && !(await stat(path.join(sourceRoot, ...name.split("/"))).then(() => true, () => false))) left.push(name);
  }
  return left;
}

// The program an update or a rollback starts. Under the Rust host the engine's
// process.execPath is node.exe, never the app: the host program beside it is.
export function appExecutable(exePath, installRoot) {
  const exe = String(exePath ?? "");
  if (exe && path.win32.basename(exe).toLowerCase() !== HOST_NODE) return exe;
  return path.win32.join(String(installRoot ?? ""), `${PORTABLE_NAME}.exe`);
}

// ---- apply helper ----------------------------------------------------------

function psQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

// The variables that tie an engine to the Rust host that started it. The
// helper inherits the old engine's environment; an Electron build started with
// MEFI_STUDIO_HOST=tauri would load the host shim and stop at once, and a host
// build sets its own. ELECTRON_RUN_AS_NODE would turn an Electron build into
// plain Node. MEFI_STUDIO_ROOT would point a host build at other files and
// make it an unpackaged run, which never reports healthy.
const HOST_LINK_VARIABLES = ["MEFI_STUDIO_HOST", "MEFI_HOST_PIPE", "MEFI_HOST_TOKEN", "MEFI_HOST_INFO", "MEFI_STUDIO_ROOT", "ELECTRON_RUN_AS_NODE"];

// Waiting for the pid main.cjs passes is not enough. Under Electron it is the
// main process, while its helpers (and any ELECTRON_RUN_AS_NODE child) still
// run from the program for a moment; under the Rust host it is node.exe, and
// the host program leaves just after its engine. A program that is still
// running cannot be replaced (robocopy fails on it), and a host started while
// the old one holds the single-instance lock hands its launch to the old one
// and exits. So the helper also waits, for at most a minute, for every
// process started from the install's program or its node.exe.
function exitLines() {
  return [
    `foreach ($name in @(${HOST_LINK_VARIABLES.map(psQuote).join(", ")})) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }`,
    "Log 'waiting for Studio to exit'",
    "try { Wait-Process -Id $pidToWait -Timeout 180 -ErrorAction Stop } catch {}",
    `$engineExe = Join-Path $target ${psQuote(HOST_NODE)}`,
    "function InstallProcs { $names = @([System.IO.Path]::GetFileNameWithoutExtension($exe), [System.IO.Path]::GetFileNameWithoutExtension($engineExe)); return @(Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object { $p = $null; try { $p = $_.Path } catch {}; $p -and (($p -ieq $exe) -or ($p -ieq $engineExe)) }) }",
    "$until = (Get-Date).AddSeconds(60)",
    "$left = InstallProcs",
    "if ($left.Count) { Log ('waiting for ' + $left.Count + ' process(es) still running from the install folder') }",
    "while ($left.Count -and ((Get-Date) -lt $until)) { Start-Sleep -Milliseconds 500; $left = InstallProcs }",
    "Start-Sleep -Milliseconds 900",
  ];
}

// The PowerShell helper runs detached. It waits for the host pid to disappear
// (the app is replacing its own folder), robocopies the staged folder over the
// install folder, and starts the app again with --released <version> so the
// fresh window can say what happened. resources/app/data is excluded from the
// copy so the user's live state survives the swap. It relaunches even when
// robocopy reports a partial failure, logs what happened, and then cleans up.
//
// With `safety` the helper also keeps a copy of the old build first, launches
// the new one, and waits for it to raise the health flag (see
// scripts/update-safety.cjs). A build that exits or never reports is started
// once more, and then the old build is restored. Without `safety` the script
// is exactly the plain swap above.
//
// `prune` names install entries to remove after the copy: the Chromium runtime
// an Electron install no longer needs once a Rust-host build is copied over
// it (runtimeLeftovers; writeApplyScript works it out). The saved copy still
// holds them, so a rollback brings them back.
export function buildApplyScript({ sourceRoot, installRoot, exePath, pid, version = null, cleanupRoot = null, logPath = null, safety = null, prune = [] }) {
  const cleanup = [
    cleanupRoot ? `Remove-Item -LiteralPath ${psQuote(cleanupRoot)} -Recurse -Force -ErrorAction SilentlyContinue` : "",
    "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
  ];
  const leftovers = (Array.isArray(prune) ? prune : []).map((name) => String(name ?? "").replace(/\//g, "\\")).filter((name) => name && !name.split("\\").includes(".."));
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    `$source = ${psQuote(sourceRoot)}`,
    `$target = ${psQuote(installRoot)}`,
    `$exe = ${psQuote(appExecutable(exePath, installRoot))}`,
    `$quiet = ${psQuote(logPath ?? "")}`,
    `$pidToWait = ${Number(pid) || 0}`,
    "function Log([string]$message) { if ($quiet) { Add-Content -LiteralPath $quiet -Value ((Get-Date -Format s) + ' ' + $message) } }",
    ...exitLines(),
    ...(safety?.backupRoot ? safetyBackupLines(safety, version, cleanup) : []),
    "Log ('copying ' + $source + ' -> ' + $target)",
    `$skip = Join-Path $source 'resources\\app\\data'`,
    `$copyArgs = @(('"' + $source + '"'), ('"' + $target + '"'), '/E', '/R:5', '/W:2', '/XD', ('"' + $skip + '"'), '/NFL', '/NDL', '/NJH', '/NJS', '/NP')`,
    `$copy = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\robocopy.exe') -ArgumentList $copyArgs -Wait -PassThru -WindowStyle Hidden`,
    "Log ('robocopy exit ' + $copy.ExitCode)",
    // The data exclusion above also skipped the two tracked catalog files the
    // release ships; without this the host kept the first install's catalog
    // while the new booklet baked in the new one. User state stays excluded.
    `$catalogArgs = @(('"' + $skip + '"'), ('"' + (Join-Path $target 'resources\\app\\data') + '"'), 'curated.json', 'models.json', '/R:5', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')`,
    `$catalog = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\robocopy.exe') -ArgumentList $catalogArgs -Wait -PassThru -WindowStyle Hidden`,
    "Log ('catalog robocopy exit ' + $catalog.ExitCode)",
    ...(leftovers.length
      ? [
          `Log 'removing the Electron runtime the new build does not use'`,
          ...leftovers.map((name) => `Remove-Item -LiteralPath (Join-Path $target ${psQuote(name)}) -Recurse -Force -ErrorAction SilentlyContinue`),
        ]
      : []),
    "Start-Sleep -Milliseconds 600",
    ...(safety?.backupRoot && safety.watch
      ? safetyWatchLines(safety, version)
      : [
          "Log ('relaunching ' + $exe)",
          version
            ? `Start-Process -FilePath $exe -ArgumentList @('--released', ${psQuote(version)})${windowStyleArg(safety)}`
            : `Start-Process -FilePath $exe${windowStyleArg(safety)}`,
          "Start-Sleep -Seconds 2",
        ]),
    ...cleanup,
  ];
  return lines.filter(Boolean).join("\r\n") + "\r\n";
}

// The restore helper behind the Roll back button. It is the same rollback the
// apply helper performs on its own, started by the owner: wait for Studio to
// exit, mirror the saved copy over the install folder (never resources/app/data),
// record what happened, drop the copy and start the restored build.
export function buildRollbackScript({ installRoot, exePath, pid, safety, restoreVersion = "", replacedVersion = "", cleanupRoot = null, logPath = null }) {
  const cleanup = [
    cleanupRoot ? `Remove-Item -LiteralPath ${psQuote(cleanupRoot)} -Recurse -Force -ErrorAction SilentlyContinue` : "",
    "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
  ];
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    `$target = ${psQuote(installRoot)}`,
    `$exe = ${psQuote(appExecutable(exePath, installRoot))}`,
    `$quiet = ${psQuote(logPath ?? "")}`,
    `$pidToWait = ${Number(pid) || 0}`,
    "function Log([string]$message) { if ($quiet) { Add-Content -LiteralPath $quiet -Value ((Get-Date -Format s) + ' ' + $message) } }",
    ...exitLines(),
    ...safetyPrelude({ ...safety, from: restoreVersion, to: replacedVersion }),
    "Log ('restoring ' + $backupInstall + ' -> ' + $target)",
    "$code = Robo @((Q $backupInstall), (Q $target), '/MIR', '/R:5', '/W:2', '/XD', (Q $dataDir), '/NFL', '/NDL', '/NJH', '/NJS', '/NP')",
    "Log ('restore robocopy exit ' + $code)",
    "$failed = ($code -ge 8)",
    "WriteJson $resultPath @{ ok = $false; rolledBack = $true; rollbackFailed = $failed; stage = 'manual'; from = $fromVersion; to = $toVersion; at = (NowMs); reason = 'restored by request' }",
    "if (-not $failed) { Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue }",
    `Start-Process -FilePath $exe -ArgumentList @('--rolled-back', $fromVersion)${windowStyleArg(safety)}`,
    "Start-Sleep -Seconds 2",
    ...cleanup,
  ];
  return lines.filter(Boolean).join("\r\n") + "\r\n";
}

// ---- the safety net's PowerShell pieces --------------------------------------

// Tests start a .cmd stand-in for the app and pass windowStyle "Hidden" so no
// console flashes. The real app never sets it: hiding a GUI window would hide it.
function windowStyleArg(safety) {
  return safety?.windowStyle ? ` -WindowStyle ${safety.windowStyle}` : "";
}

// Declarations shared by the apply and restore helpers. `from` is the version
// the saved copy holds; `to` is the build that replaced it (or is being undone).
function safetyPrelude(safety) {
  return [
    `$backupRoot = ${psQuote(safety.backupRoot)}`,
    "$backupInstall = Join-Path $backupRoot 'install'",
    "$dataDir = Join-Path $target 'resources\\app\\data'",
    `$resultPath = ${psQuote(safety.resultPath)}`,
    `$fromVersion = ${psQuote(safety.from)}`,
    `$toVersion = ${psQuote(safety.to)}`,
    "function NowMs { [long][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }",
    "function Q([string]$path) { return '\"' + $path + '\"' }",
    "function Robo([string[]]$roboArgs) { $p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\robocopy.exe') -ArgumentList $roboArgs -Wait -PassThru -WindowStyle Hidden; return [int]$p.ExitCode }",
    "function WriteJson([string]$path, $object) { try { $dir = Split-Path -Parent $path; if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }; [System.IO.File]::WriteAllText($path, ($object | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false))) } catch { Log ('could not write ' + $path + ': ' + $_.Exception.Message) } }",
  ];
}

// Copy the old build aside before anything is replaced. If the copy fails the
// update is skipped: nothing has changed yet, so the current build starts again
// and the next launch tells the owner why.
function safetyBackupLines(safety, version, cleanup) {
  return [
    ...safetyPrelude({ ...safety, to: version ?? "" }),
    "Log ('backing up ' + $target + ' -> ' + $backupInstall)",
    "Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue",
    "$backupOk = $false",
    "try { New-Item -ItemType Directory -Force -Path $backupInstall | Out-Null; $code = Robo @((Q $target), (Q $backupInstall), '/E', '/R:2', '/W:1', '/XD', (Q $dataDir), '/NFL', '/NDL', '/NJH', '/NJS', '/NP'); Log ('backup robocopy exit ' + $code); if ($code -lt 8) { $backupOk = $true } } catch { Log ('backup failed: ' + $_.Exception.Message) }",
    "if ($backupOk) {",
    "  WriteJson (Join-Path $backupRoot 'manifest.json') @{ v = 1; from = $fromVersion; to = $toVersion; installRoot = $target; at = (NowMs) }",
    "} else {",
    "  Log 'the backup failed; the update is skipped and the current build starts again'",
    "  Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue",
    "  WriteJson $resultPath @{ ok = $false; stage = 'backup'; from = $fromVersion; to = $toVersion; at = (NowMs); reason = 'the current build could not be backed up' }",
    `  Start-Process -FilePath $exe${windowStyleArg(safety)}`,
    "  Start-Sleep -Seconds 2",
    ...cleanup.filter(Boolean).map((line) => `  ${line}`),
    "  exit",
    "}",
  ];
}

// Start the new build, wait for its health flag, start it once more if it did
// not raise one, and restore the saved copy when the second try fails too. An
// exited process is given a short grace before it counts as failed, because a
// build may legitimately restart itself right after it starts.
function safetyWatchLines(safety, version) {
  const wait = Math.max(3, Math.floor(Number(safety.waitSeconds) || 120));
  const grace = Math.max(1, Math.floor(Number(safety.exitGraceSeconds) || 20));
  const style = windowStyleArg(safety);
  return [
    `$healthPath = ${psQuote(safety.healthPath)}`,
    `$waitSeconds = ${wait}`,
    `$exitGrace = ${grace}`,
    "function StopTree($proc) { try { if ($proc -and -not $proc.HasExited) { & taskkill.exe /PID $proc.Id /T /F | Out-Null } } catch {} }",
    "function Boot([string[]]$bootArgs) {",
    "  $launchedAt = NowMs",
    "  Log ('starting ' + $exe)",
    `  $proc = Start-Process -FilePath $exe -ArgumentList $bootArgs -PassThru${style}`,
    "  $deadline = (Get-Date).AddSeconds($waitSeconds)",
    "  $exitedAt = $null",
    "  while ((Get-Date) -lt $deadline) {",
    "    Start-Sleep -Milliseconds 700",
    "    try { if (Test-Path -LiteralPath $healthPath) { $h = Get-Content -LiteralPath $healthPath -Raw | ConvertFrom-Json; if ($h -and $h.healthyAt -and ([long]$h.healthyAt -ge $launchedAt)) { return @{ healthy = $true; proc = $proc } } } } catch {}",
    "    $gone = $false",
    "    try { $gone = $proc.HasExited } catch { $gone = $true }",
    "    if ($gone) { if (-not $exitedAt) { $exitedAt = Get-Date } elseif (((Get-Date) - $exitedAt).TotalSeconds -ge $exitGrace) { break } }",
    "  }",
    "  return @{ healthy = $false; proc = $proc }",
    "}",
    "function Rollback([string]$why) {",
    "  Log ('rolling back to ' + $fromVersion + ': ' + $why)",
    "  $code = Robo @((Q $backupInstall), (Q $target), '/MIR', '/R:5', '/W:2', '/XD', (Q $dataDir), '/NFL', '/NDL', '/NJH', '/NJS', '/NP')",
    "  Log ('rollback robocopy exit ' + $code)",
    "  $failed = ($code -ge 8)",
    "  WriteJson $resultPath @{ ok = $false; rolledBack = $true; rollbackFailed = $failed; stage = 'boot'; from = $fromVersion; to = $toVersion; at = (NowMs); reason = $why }",
    "  if (-not $failed) { Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue }",
    `  Start-Process -FilePath $exe -ArgumentList @('--rolled-back', $fromVersion)${style}`,
    "}",
    `$launchArgs = @('--released', ${psQuote(version ?? "")})`,
    "$boot = Boot $launchArgs",
    "if (-not $boot.healthy) { Log 'the new build did not report healthy in time; starting it once more'; StopTree $boot.proc; Start-Sleep -Seconds 2; $boot = Boot $launchArgs }",
    "if ($boot.healthy) { Log 'the new build reported healthy' } else { StopTree $boot.proc; Start-Sleep -Seconds 2; Rollback 'the new build did not start properly' }",
    "Start-Sleep -Seconds 1",
  ];
}

// Where one install keeps its saved copy: outside the install folder, OneDrive
// and %TEMP% (the apply helper deletes its own staging folder there, and
// Storage Sense clears it). Null when the machine names no local app-data
// folder, in which case an update simply installs without a backup.
export function rollbackFolder(installRoot, env = process.env, installKey = null) {
  const base = env?.LOCALAPPDATA;
  if (!base || !installRoot) return null;
  const key = typeof installKey === "function" ? installKey(installRoot) : String(installKey ?? "default");
  return path.win32.join(base, "MefiStudio", "rollback", key);
}

// A staged build only earns the boot watch when its main.cjs still raises the
// flag the helper waits for; otherwise the helper would undo a healthy build.
export async function stagedBuildWritesHealth(payloadRoot, writesHealth) {
  try {
    const source = await readFile(path.join(payloadRoot, "main.cjs"), "utf8");
    return Boolean(writesHealth(source));
  } catch {
    return false;
  }
}

// Written with a byte order mark: Windows PowerShell 5.1 reads a BOM-less
// script as the ANSI code page, which turns a non-ASCII folder or user name in
// the install path into a different folder.
// The helper is written by the build being replaced, so this is where an
// Electron install learns what a Rust-host build leaves behind of it.
export async function writeApplyScript(file, options) {
  const prune = options?.prune ?? (await runtimeLeftovers(options?.sourceRoot, options?.installRoot).catch(() => []));
  await writeFile(file, `﻿${buildApplyScript({ ...options, prune })}`, "utf8");
  return file;
}

export async function writeRollbackScript(file, options) {
  await writeFile(file, `﻿${buildRollbackScript(options)}`, "utf8");
  return file;
}
