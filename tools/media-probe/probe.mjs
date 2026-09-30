// The media player probe (2026-09-28 redesign). Builds an isolated booklet
// from a studio checkout, drives it in an offscreen 1920x1080 Electron window
// with a fake YouTube embed that speaks the widget protocol (fake-youtube.html)
// and a stub YouTube search, then copies captures and report.json out.
// usage: node tools/media-probe/probe.mjs <studioDir> <outDir> [scenario] [script]
//   script probe-after.cjs: the new menu (dock, transport, Browse, drops, sections)
//   script probe-electron.cjs: the old menu's hover/scroll capture (before)
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [studio, out, scenario = "before", script = "probe-electron.cjs"] = process.argv.slice(2);
const { build } = await import(pathToFileURL(path.join(studio, "scripts", "build-booklet.mjs")).href);
const fixture = await mkdtemp(path.join(tmpdir(), "mefi-media-probe-"));
await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
const sources = (await readdir(path.join(studio, "renderer"))).filter(name => /\.(js|css)$/.test(name) || name === "booklet.template.html");
await Promise.all(sources.map(name => copyFile(path.join(studio, "renderer", name), path.join(fixture, "renderer", name))));
await copyFile(path.join(studio, "data", "models.json"), path.join(fixture, "data", "models.json"));
await build({ root: fixture });
const executable = path.join(studio, "node_modules", "electron", "dist", "electron.exe");
const env = { ...process.env, PROBE_ROOT: fixture, PROBE_SCENARIO: scenario }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [path.join(here, script)], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { output = (output + chunk).slice(-20000); });
const timer = setTimeout(() => spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }), 150000);
const code = await new Promise(resolve => child.once("close", resolve));
clearTimeout(timer);
await mkdir(out, { recursive: true });
for (const name of (await readdir(fixture)).filter(name => name.endsWith(".png") || name.endsWith(".json"))) await copyFile(path.join(fixture, name), path.join(out, name));
console.log(`exit ${code}`);
if (code) console.log(output.slice(-4000));
await rm(fixture, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
