// Build an Actions artifact using the established portable release packager.
// This never publishes a release or creates a tag.
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { parseVersion } from "./release-updater.mjs";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const base = parseVersion(pkg.version);
const { GITHUB_RUN_NUMBER: number, GITHUB_RUN_ATTEMPT: attempt, GITHUB_RUN_ID: id, GITHUB_SHA: commit } = process.env;
if (!base || base.pre || ![number, attempt, id].every(v => /^[1-9]\d*$/.test(v ?? "")) || !/^[a-f\d]{40}$/.test(commit ?? "")) throw new Error("development packaging needs a stable base version and GitHub run provenance");
const version = `${base.major}.${base.minor}.${base.patch}-dev.${number}.${attempt}`;
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["scripts/package-release.mjs", "--version", version], { stdio: "inherit", windowsHide: true });
  child.on("error", reject);
  child.on("exit", code => code === 0 ? resolve() : reject(new Error(`development packaging exited ${code}`)));
});
await writeFile("dist/releases/development-build.json", JSON.stringify({ channel: "development", version, commit, runId: Number(id) }) + "\n");
