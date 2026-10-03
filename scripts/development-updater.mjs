// Opt-in GitHub Actions builds. Only completed successful push builds of this
// repository's main, through ci.yml, are eligible. No source tree is installed.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_REPO, githubHeaders, parseVersion, compareVersions, validateBuildAssets, extractZip, releaseAssetName, sha256File, parseChecksum } from "./release-updater.mjs";

export const DEVELOPMENT_ARTIFACT = "mefi-studio-development-win32-x64";
export const DEVELOPMENT_WARNING = "Development / beta automatically downloads and installs built GitHub development artifacts and restarts Studio when no build jobs are running. These changes are untested by the owner, may be unstable, and may cause data loss. Back up important work first. Return to Stable at any time; an older stable build may not understand data written by development builds.";
export const normalizeChannel = (value) => value === "development" ? "development" : "stable";

export async function checkForDevelopment({ repo = DEFAULT_REPO, currentVersion, token = null, fetchImpl = globalThis.fetch, platform = "win32", arch = "x64" } = {}) {
  const checkedAt = Date.now();
  const none = () => ({ ok: true, latest: null, update: null, checkedAt, unavailable: "No supported development artifact is available yet. Stable releases remain available." });
  if (platform !== "win32" || arch !== "x64") return { ok: false, error: "development artifacts support Windows x64 only", checkedAt };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !parseVersion(currentVersion)) return { ok: false, error: "invalid repository or current version", checkedAt };
  const get = async (suffix) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/${suffix}`, { headers: githubHeaders(token), redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "GitHub Actions access refused; an existing GitHub login with Actions read access is required to download development artifacts" : `GitHub Actions answered ${response.status}`);
    return response.json();
  };
  try {
    const listing = await get("actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=20");
    const runs = (listing.workflow_runs ?? []).filter(r => r.status === "completed" && r.conclusion === "success" && r.event === "push" && r.head_branch === "main" && r.repository?.full_name === repo && r.head_repository?.full_name === repo && r.path === ".github/workflows/ci.yml" && Number.isSafeInteger(r.id) && Number.isSafeInteger(r.run_number) && Number.isSafeInteger(r.run_attempt)).sort((a,b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt);
    for (const run of runs) {
      const listing = await get(`actions/runs/${run.id}/artifacts?per_page=100`);
      const artifact = (listing.artifacts ?? []).find(a => a.name === DEVELOPMENT_ARTIFACT && !a.expired && Date.parse(a.expires_at) > Date.now() && a.workflow_run?.id === run.id && a.workflow_run?.head_sha === run.head_sha && /^sha256:[a-f\d]{64}$/i.test(a.digest ?? ""));
      if (!artifact) continue;
      // GitHub artifacts have no custom metadata fields. Version discovery is
      // from the package.json at the exact built commit, never raw main HEAD.
      if (!/^[a-f\d]{40}$/.test(run.head_sha)) continue;
      const response = await get(`contents/package.json?ref=${run.head_sha}`);
      const pkg = JSON.parse(Buffer.from(response.content, "base64").toString("utf8"));
      const base = parseVersion(pkg.version);
      if (!base || base.pre) continue;
      const buildVersion = `${base.major}.${base.minor}.${base.patch}-dev.${run.run_number}.${run.run_attempt}`;
      const latest = { channel: "development", version: buildVersion, tag: `v${buildVersion}`, name: "Development / beta", htmlUrl: run.html_url, publishedAt: artifact.created_at, prerelease: true, runId: run.id, commit: run.head_sha, asset: { id: artifact.id, name: "development-artifact.zip", size: artifact.size_in_bytes, url: artifact.archive_download_url, digest: artifact.digest }, checksum: null };
      validateBuildAssets(latest, repo);
      if (!token) return { ok: false, error: "A development build exists, but downloading GitHub Actions artifacts requires an existing GitHub login with Actions read access.", checkedAt, needsToken: true };
      const current = parseVersion(currentVersion);
      const comparison = compareVersions(latest.version, current.raw);
      const sameStableBase = !current.pre && current.major === base.major && current.minor === base.minor && current.patch === base.patch;
      return { ok: true, latest, update: comparison > 0 || sameStableBase ? latest : null, checkedAt, current: current.raw };
    }
    return none();
  } catch (error) { return { ok: false, error: String(error.message).slice(0,300), checkedAt, needsToken: /access refused/.test(error.message) }; }
}

// Actions wraps the portable zip and checksum in an archive. The outer archive
// is verified by GitHub's digest before extraction; then verify the inner zip.
export async function unpackDevelopment(downloaded, latest, directory) {
  if (downloaded.sha256.toLowerCase() !== latest.asset.digest.slice(7).toLowerCase()) throw new Error("development artifact failed its GitHub SHA-256 check");
  await extractZip(downloaded.path, directory);
  const name = releaseAssetName(latest.version);
  const zipPath = path.join(directory, name);
  const checksum = await readFile(`${zipPath}.sha256`, "utf8");
  if (parseChecksum(checksum) !== await sha256File(zipPath)) throw new Error("development build failed its inner SHA-256 check");
  const metadata = JSON.parse(await readFile(path.join(directory, "development-build.json"), "utf8"));
  if (metadata.version !== latest.version || metadata.commit !== latest.commit || metadata.runId !== latest.runId || metadata.channel !== "development") throw new Error("development build provenance does not match the successful GitHub run");
  return zipPath;
}
