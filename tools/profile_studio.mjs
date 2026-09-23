// Reproducible real-renderer workloads. No live app, settings, task stores or workers.
// node tools/profile_studio.mjs --output tools/logs/profile-baseline.json [--source DIR] [--capture]
//   [--scenarios command-30-3d,command-showcase] [--styles orbs,sigil] [--width 1440 --height 900]
// --styles runs every scenario once per node style; run names (report entries and
// images) gain a "-<style>" suffix. command-showcase is a visual-only scene: every
// node state at once, then a focused branch so the far layer shows. --capture saves
// each run's PNG at device scale factor 1, plus a six-frame strip 100 ms apart.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
// The eight node styles (renderer/music.js NODE_STYLES); a --source control may predate node-styles.js.
const NODE_STYLES = ["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"];
if (args.includes("--help")) {
  console.log(`node tools/profile_studio.mjs --output tools/logs/profile.json [--source DIR] [--capture] [--warmup-ms 2000] [--duration-ms 5000] [--scenarios command-30-3d,command-150-3d,command-30-2d,command-150-2d,command-showcase] [--styles ${NODE_STYLES.join(",")}] [--width 1280] [--height 900]`);
  process.exit(0);
}
const source = path.resolve(value("--source", studio));
const outputArg = value("--output", null);
if (!outputArg) throw new Error("Choose a local output file with --output tools/logs/profile.json");
const output = path.resolve(outputArg);
const warmupMs = Number(value("--warmup-ms", "2000"));
const durationMs = Number(value("--duration-ms", "5000"));
if (![warmupMs, durationMs].every((n) => Number.isInteger(n) && n >= 100 && n <= 60000)) throw new Error("Durations must be integers between 100 and 60000 milliseconds");
const scenarios = value("--scenarios", "command-30-3d,command-150-3d,command-30-2d,command-150-2d").split(",");
if (!scenarios.length || scenarios.some((name) => !/^command-(?:(?:30|150)-(?:3d|2d)|showcase)$/.test(name))) throw new Error("Unsupported workload scenario");
const stylesArg = value("--styles", null);
const styles = stylesArg ? stylesArg.split(",") : [];
if (stylesArg && (styles.some((style) => !NODE_STYLES.includes(style)) || new Set(styles).size !== styles.length)) throw new Error(`Unsupported node style list; choose from ${NODE_STYLES.join(",")}`);
const width = Number(value("--width", "1280"));
const height = Number(value("--height", "900"));
if (![width, height].every((n) => Number.isInteger(n) && n >= 480 && n <= 3840)) throw new Error("--width and --height must be integers between 480 and 3840 pixels");
// One run per scenario, or per scenario and style.
const runs = scenarios.length * Math.max(1, styles.length);
const executable = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
if (!existsSync(executable)) throw new Error("Install repository dependencies before profiling (npm ci)");
const fixture = await mkdtemp(path.join(tmpdir(), "mefi-profile-workload-"));
try {
  for (const directory of ["renderer", "data", "scripts"]) await mkdir(path.join(fixture, directory));
  const files = (await readdir(path.join(source, "renderer"))).filter((name) => /\.(?:js|css)$/.test(name) || name === "booklet.template.html");
  await Promise.all(files.map((name) => copyFile(path.join(source, "renderer", name), path.join(fixture, "renderer", name))));
  await copyFile(path.join(source, "data", "models.json"), path.join(fixture, "data", "models.json"));
  await copyFile(path.join(source, "scripts", "performance-profiler.cjs"), path.join(fixture, "scripts", "performance-profiler.cjs"));
  const { build } = await import(pathToFileURL(path.join(source, "scripts", "build-booklet.mjs")).href);
  await build({ root: fixture });
  const hash = createHash("sha256").update(await readFile(path.join(fixture, "renderer", "booklet.html"))).digest("hex");
  const config = { warmupMs, durationMs, scenarios, styles, width, height, capture: args.includes("--capture"), rendererSha256: hash };
  await writeFile(path.join(fixture, "workload.json"), JSON.stringify(config));
  const env = { ...process.env, MEFI_PROFILE_WORKLOAD: fixture };
  delete env.ELECTRON_RUN_AS_NODE;
  // Chromium helpers can briefly outlive the Electron host. Keep their inherited
  // working directory outside the disposable fixture so Windows can remove it.
  const child = spawn(executable, [path.join(studio, "tests", "fixtures", "profile-workload-electron.cjs")], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => { diagnostics += chunk; process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { diagnostics += chunk; });
  const timer = setTimeout(() => child.kill(), (warmupMs + durationMs + (config.capture ? 25000 : 15000)) * runs + 15000);
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
  const reportPath = path.join(fixture, "report.json");
  if (!existsSync(reportPath)) throw new Error(`Workload process exited ${code} without a report: ${diagnostics.slice(-6000)}`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  if (config.capture) {
    const imageDirectory = output.replace(/\.json$/i, "") + "-images";
    await mkdir(imageDirectory, { recursive: true });
    for (const name of (await readdir(fixture)).filter((name) => name.endsWith(".png"))) await copyFile(path.join(fixture, name), path.join(imageDirectory, name));
  }
  console.log(`Numeric capture: ${output}`);
  if (code !== 0 || report.failure || report.scenarios.length !== runs) throw new Error(report.failure || `Incomplete workload (${report.scenarios.length}/${runs} runs): ${diagnostics.slice(-6000)}`);
} finally {
  // This is the exact mkdtemp-created path; never remove source or output folders.
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(fixture));
  if (!relative.startsWith("mefi-profile-workload-") || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error("Unexpected temporary fixture path");
  await rm(fixture, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
}
