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
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { once } from "node:events";
import zlib from "node:zlib";

export const DEFAULT_REPO = "nateecho32-stack/mefi-studio";
// The host's release watcher reads this cadence: GitHub every 20 minutes.
export const CHECK_INTERVAL_MS = 20 * 60 * 1000;
export const DEFAULT_PLATFORM = "win32";
export const DEFAULT_ARCH = "x64";
export const PORTABLE_NAME = "Mefi Studio AI+";
export const USER_AGENT = "mefi-studio-release-updater";

// ---- versions --------------------------------------------------------------

export function parseVersion(value) {
  const text = String(value ?? "").trim().replace(/^v/i, "");
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
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

export function releaseAssetName(version, { platform = DEFAULT_PLATFORM, arch = DEFAULT_ARCH } = {}) {
  const clean = String(version ?? "").trim().replace(/^v/i, "").replace(/[^0-9A-Za-z.-]/g, "-");
  return `${PORTABLE_NAME.replace(/\s+/g, "-")}-v${clean}-${platform}-${arch}.zip`;
}

export function selectAsset(release, { platform = DEFAULT_PLATFORM, arch = DEFAULT_ARCH } = {}) {
  const assets = (Array.isArray(release?.assets) ? release.assets : []).filter((asset) => typeof asset?.name === "string");
  const zips = assets.filter((asset) => /\.zip$/i.test(asset.name));
  const wanted = releaseAssetName(release?.tag_name ?? release?.name ?? "", { platform, arch }).toLowerCase();
  const asset =
    zips.find((candidate) => candidate.name.toLowerCase() === wanted) ??
    zips.find((candidate) => candidate.name.toLowerCase().includes(`${platform}-${arch}`)) ??
    zips.find((candidate) => candidate.name.toLowerCase().includes(platform)) ??
    zips[0] ??
    null;
  if (!asset) return { asset: null, checksum: null };
  const checksum = assets.find((candidate) => candidate.name.toLowerCase() === `${asset.name.toLowerCase()}.sha256`) ?? null;
  return { asset, checksum };
}

export function describeRelease(release, { platform = DEFAULT_PLATFORM, arch = DEFAULT_ARCH } = {}) {
  if (!release || release.draft) return null;
  const parsed = parseVersion(release.tag_name) ?? parseVersion(release.name);
  if (!parsed) return null;
  const { asset, checksum } = selectAsset(release, { platform, arch });
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
      return {
        ok: false,
        error: token
          ? "no published release found for this repository"
          : "no release found — a private repository needs a GitHub token",
        needsToken: !token,
        checkedAt,
      };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "GitHub refused the release check (bad token or rate limit)", needsToken: true, checkedAt };
    }
    if (!response.ok) return { ok: false, error: `GitHub answered ${response.status}`, checkedAt };
    const json = await response.json();
    const latest = describeRelease(json, { platform, arch });
    if (!latest) return { ok: false, error: "the latest release has no readable version", checkedAt };
    if (!latest.asset) return { ok: false, error: `release ${latest.tag} has no ${platform} zip asset`, checkedAt };
    return { ok: true, current: current.raw, latest, update: isNewer(latest.version, current.raw) ? latest : null, checkedAt };
  } catch (error) {
    const aborted = error?.name === "AbortError" || error?.name === "TimeoutError";
    return { ok: false, error: aborted ? "the release check timed out" : String(error?.message ?? error).slice(0, 300), checkedAt };
  }
}

function safeFileName(name) {
  const base = path.basename(String(name ?? "release.zip")).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  return base.toLowerCase().endsWith(".zip") ? base : `${base}.zip`;
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
  headers.Accept = "application/octet-stream";
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
  await new Promise((resolve, reject) => {
    source
      .pipe(meter)
      .pipe(createWriteStream(file))
      .on("finish", resolve)
      .on("error", reject);
    source.on("error", reject);
    meter.on("error", reject);
  });
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
export async function zipDirectory(sourceDir, zipPath, { rootName = path.basename(sourceDir) } = {}) {
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

// Finds the portable folder inside an extracted release: the zip carries
// "Mefi Studio AI+/resources/app/main.cjs" (plus the Electron runtime next to
// it). Returns null when the archive has an unexpected layout.
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

export async function stageUpdate({ zipPath, stagingDir, installRoot }) {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await extractZip(zipPath, stagingDir);
  const sourceRoot = await payloadRoot(stagingDir);
  if (!sourceRoot) throw new Error("the release archive does not carry the portable app payload");
  const payload = path.join(sourceRoot, "resources", "app");
  if (!(await isFile(path.join(payload, "main.cjs"))) || !(await isFile(path.join(payload, "preload.cjs")))) {
    throw new Error("the release payload is missing main.cjs or preload.cjs");
  }
  return { sourceRoot, payloadRoot: payload, exePath: path.join(installRoot, `${PORTABLE_NAME}.exe`) };
}

// ---- apply helper ----------------------------------------------------------

function psQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

// The PowerShell helper runs detached. It waits for the host pid to disappear
// (the app is replacing its own folder), robocopies the staged folder over the
// install folder, and starts the app again with --released <version> so the
// fresh window can say what happened. resources/app/data is excluded from the
// copy so the user's live state survives the swap. It relaunches even when
// robocopy reports a partial failure, logs what happened, and then cleans up.
export function buildApplyScript({ sourceRoot, installRoot, exePath, pid, version = null, cleanupRoot = null, logPath = null }) {
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    `$source = ${psQuote(sourceRoot)}`,
    `$target = ${psQuote(installRoot)}`,
    `$exe = ${psQuote(exePath)}`,
    `$quiet = ${psQuote(logPath ?? "")}`,
    `$pidToWait = ${Number(pid) || 0}`,
    "function Log([string]$message) { if ($quiet) { Add-Content -LiteralPath $quiet -Value ((Get-Date -Format s) + ' ' + $message) } }",
    "Log 'waiting for Studio to exit'",
    "try { Wait-Process -Id $pidToWait -Timeout 180 -ErrorAction Stop } catch {}",
    "Start-Sleep -Milliseconds 900",
    "Log ('copying ' + $source + ' -> ' + $target)",
    `$skip = Join-Path $source 'resources\\app\\data'`,
    `$copyArgs = @(('"' + $source + '"'), ('"' + $target + '"'), '/E', '/R:5', '/W:2', '/XD', ('"' + $skip + '"'), '/NFL', '/NDL', '/NJH', '/NJS', '/NP')`,
    `$copy = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\robocopy.exe') -ArgumentList $copyArgs -Wait -PassThru -WindowStyle Hidden`,
    "Log ('robocopy exit ' + $copy.ExitCode)",
    "Start-Sleep -Milliseconds 600",
    "Log ('relaunching ' + $exe)",
    version
      ? `Start-Process -FilePath $exe -ArgumentList @('--released', ${psQuote(version)})`
      : "Start-Process -FilePath $exe",
    "Start-Sleep -Seconds 2",
    cleanupRoot ? `Remove-Item -LiteralPath ${psQuote(cleanupRoot)} -Recurse -Force -ErrorAction SilentlyContinue` : "",
    "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
  ];
  return lines.filter(Boolean).join("\r\n") + "\r\n";
}

export async function writeApplyScript(file, options) {
  await writeFile(file, buildApplyScript(options), "utf8");
  return file;
}
