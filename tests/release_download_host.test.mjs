import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { readFile } from "node:fs/promises";

// main.cjs's downloadReleaseBuild, run against a stubbed release-updater
// module. The rule under test: a release that publishes a .sha256 asset must
// be verified against it, so an asset that cannot be read stops the update;
// only a release with no checksum at all is staged unverified.
const source = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const start = source.indexOf("async function downloadReleaseBuild() {");
const end = source.indexOf("\nasync function applyReleaseUpdate()", start);
assert.ok(start > 0 && end > start, "downloadReleaseBuild is where this suite slices it");

const BUILD_SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const ROOT = path.join("C:/tmp", "mefi-studio-update", "v0.9.0");

function release({ digest = null, checksum = true } = {}) {
  return {
    version: "0.9.0",
    asset: { name: "Mefi-Studio-win-x64.zip", size: 5 * 1024 * 1024, digest, url: "https://example.invalid/zip" },
    checksum: checksum ? { name: "Mefi-Studio-win-x64.zip.sha256", size: 90, url: "https://example.invalid/sha256" } : null,
  };
}

function host(latest, fetchChecksum = async () => BUILD_SHA) {
  const calls = { removed: [], fetched: 0, staged: 0, logs: [] };
  const updater = {
    downloadAsset: async () => ({ path: path.join(ROOT, "build.zip"), bytes: 5 * 1024 * 1024, sha256: BUILD_SHA.toUpperCase() }),
    fetchChecksum: async (args) => { calls.fetched += 1; return fetchChecksum(args); },
    stageUpdate: async () => { calls.staged += 1; return { sourceRoot: path.join(ROOT, "staging", "app"), exePath: path.join(ROOT, "staging", "app", "Mefi.exe") }; },
    writeApplyScript: async () => {},
  };
  const context = vm.createContext({
    releaseState: { latest },
    getReleaseUpdater: async () => updater,
    app: { getPath: () => "C:/tmp" },
    path,
    process: { execPath: "C:/Program Files/Mefi/Mefi.exe" },
    rm: async (target) => { calls.removed.push(target); },
    mkdir: async () => {},
    publishRelease: () => {},
    readSettings: async () => ({}),
    resolveGithubToken: async () => null,
    logLine: (line) => calls.logs.push(line),
  });
  vm.runInContext(source.slice(start, end), context);
  return { download: () => context.downloadReleaseBuild(), calls };
}

test("a published checksum that answers without a digest stops the update and removes the staging root", async () => {
  const { download, calls } = host(release(), async () => null);
  await assert.rejects(download(), /checksum \(Mefi-Studio-win-x64\.zip\.sha256\) could not be read, so the build was not staged/);
  assert.equal(calls.fetched, 1);
  assert.equal(calls.staged, 0, "nothing unverified was staged");
  assert.deepEqual(calls.removed, [ROOT, ROOT], "cleared before the download and again after the refusal");
  assert.ok(!calls.logs.some((line) => line.includes("downloaded v")), "no download is reported");
});

test("a published checksum whose fetch throws stops the update with the reason", async () => {
  const { download, calls } = host(release(), async () => { throw new Error("socket hang up"); });
  await assert.rejects(download(), /could not be read, so the build was not staged: socket hang up/);
  assert.equal(calls.staged, 0);
  assert.deepEqual(calls.removed, [ROOT, ROOT]);
});

test("a release that publishes no checksum is staged unverified and the log says so", async () => {
  const { download, calls } = host(release({ checksum: false }));
  const staged = await download();
  assert.equal(staged.verified, false);
  assert.equal(calls.fetched, 0);
  assert.equal(calls.staged, 1);
  assert.ok(calls.logs.includes("[release] downloaded v0.9.0 (5 MB, unverified: the release publishes no checksum)"), calls.logs.join("\n"));
});

test("a readable published checksum verifies the build, and a mismatch still stops it", async () => {
  const good = host(release());
  assert.equal((await good.download()).verified, true);
  assert.ok(good.calls.logs.includes("[release] downloaded v0.9.0 (5 MB, verified)"), good.calls.logs.join("\n"));

  const bad = host(release(), async () => OTHER_SHA);
  await assert.rejects(bad.download(), /failed its SHA-256 check/);
  assert.equal(bad.calls.staged, 0);
});

test("the asset's own sha256 digest is used before any checksum asset is fetched", async () => {
  const { download, calls } = host(release({ digest: `sha256:${BUILD_SHA}` }), async () => null);
  assert.equal((await download()).verified, true);
  assert.equal(calls.fetched, 0);
});
