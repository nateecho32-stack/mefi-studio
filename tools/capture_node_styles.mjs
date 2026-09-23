// Node-style sheets: every look in every state, theme and size on offscreen canvases, with motion strips and pixel
// metrics. No live app, settings, stores or workers: a blank Electron page loads renderer/node-styles.js whole
// (tests/fixtures/node-styles-sheet-electron.cjs) and this script writes what it paints.
// node tools/capture_node_styles.mjs --out DIR [--styles orbs,sigil] [--themes aurora,void,light] [--dpr 1|2|1,2] [--strips] [--source DIR]
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
if (args.includes("--help")) {
  console.log([
    "node tools/capture_node_styles.mjs --out DIR [--styles orbs,glass,...] [--themes aurora,void,light] [--dpr 1|2|1,2] [--strips] [--source DIR]",
    "  sheet-<style>-<theme>[@2x].png  every state (rows) at r 3..15 and t still/0/333/667/1000/2000 ms, wires and pulses",
    "  strip-<style>.gif, strip-<style>-6s.gif, strip-<style>.png  (--strips) a working node at r 15: 24 frames 33.3 ms apart, 12 across 6 s",
    "  metrics.json  frame-to-frame change, still-pose identity, reach from pixels, gradients/shadowBlur per steady frame",
    "--source reads renderer/ from another checkout (a HEAD control worktree, say); the fixture always comes from this one.",
  ].join("\n"));
  process.exit(0);
}
const outArg = value("--out", null);
if (!outArg) throw new Error("Choose an output folder with --out DIR");
const out = path.resolve(outArg);
const source = path.resolve(value("--source", studio));
const list = (text) => String(text).split(",").map((item) => item.trim()).filter(Boolean);
const read = (relative) => {
  const file = path.join(source, relative);
  if (!existsSync(file)) throw new Error(`${relative} is missing from ${source}`);
  return readFileSync(file, "utf8");
};
// First-occurrence slices, like the node suites take them.
function section(text, start, end, file) {
  const from = text.indexOf(start), to = from < 0 ? -1 : text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`${file}: the slice ${JSON.stringify(start)} … ${JSON.stringify(end)} is missing`);
  return text.slice(from, to);
}

// The painters, loaded whole the way tests/node_styles.test.mjs loads them, name the styles.
const nodeStylesSource = read(path.join("renderer", "node-styles.js"));
const painterBox = { window: {} };
vm.createContext(painterBox);
vm.runInContext(nodeStylesSource, painterBox, { filename: "node-styles.js" });
const painters = painterBox.window.MefiNodeStyles;
if (!painters?.STYLES) throw new Error("renderer/node-styles.js did not set window.MefiNodeStyles");
const known = [...painters.STYLES];
const styles = list(value("--styles", known.join(",")));
const unknown = styles.filter((style) => !known.includes(style));
if (!styles.length || unknown.length) throw new Error(`Unknown node style: ${unknown.join(", ") || "(none chosen)"}; known: ${known.join(", ")}`);
const STYLE_NAMES = { orbs: "Classic orbs", glass: "Soft glass", minimal: "Minimal", halo: "Halo", crystal: "Crystal", singularity: "Singularity", prism: "Prism", sigil: "Sigil" };

// Canvas palettes exactly as music.js resolves them (resolvePalette(theme).canvas, what idle.js syncGraphTheme and
// the module's theme() read). "light" is a light custom palette through the same resolver.
const LIGHT_CUSTOM = { accent: "#B07A2A", background: "#F3F0E8", surface: "#FFFFFF", text: "#1D2330" };
const music = read(path.join("renderer", "music.js"));
const musicBox = {};
vm.createContext(musicBox);
vm.runInContext([
  section(music, "  const THEMES = {", "  const NODE_STYLES = {", "music.js"),
  section(music, "  const CUSTOM_DEFAULTS", "  function spotifyLink(", "music.js"),
  "globalThis.__palettes = { THEMES, resolvePalette };",
].join("\n"), musicBox, { filename: "music.js" });
const { THEMES, resolvePalette } = musicBox.__palettes;
const plain = (object) => JSON.parse(JSON.stringify(object));
const themes = list(value("--themes", "aurora,void,light")).map((key) => {
  if (key === "light") return { key, name: `Light custom (${LIGHT_CUSTOM.background})`, palette: plain(resolvePalette("custom", LIGHT_CUSTOM).canvas) };
  if (!Object.hasOwn(THEMES, key)) throw new Error(`Unknown theme ${key}; use light or one of ${Object.keys(THEMES).join(", ")}`);
  return { key, name: THEMES[key].name, palette: plain(resolvePalette(key).canvas) };
});
if (!themes.length) throw new Error("Choose at least one theme");
const dprs = [...new Set(list(value("--dpr", "1")).map(Number))];
if (!dprs.length || dprs.some((dpr) => dpr !== 1 && dpr !== 2)) throw new Error("--dpr takes 1, 2 or 1,2");
const strips = args.includes("--strips");

// Agent glyphs come from tree3d.js through the slices tests/command_visuals.test.mjs takes.
const tree = read(path.join("renderer", "tree3d.js"));
const agentColors = section(tree, "  const AGENT_COLORS = {", "  // HSL -> #rrggbb", "tree3d.js");
const agentGlyphs = section(tree, "  const AGENT_GLYPHS = {", "  const AGENT_RING = 34;", "tree3d.js");
// The Command view skips a style's agent dress when drawAgentDress returns early for it.
const idle = read(path.join("renderer", "idle.js"));
const dressAt = idle.indexOf("  function drawAgentDress(");
const agentDressSkips = dressAt < 0 ? [] : [...idle.slice(dressAt, dressAt + 400).matchAll(/state\.nodeStyle === "(\w+)"\)\s*return/g)].map((match) => match[1]);

function stamp() {
  const git = (...rest) => execFileSync("git", ["-C", source, ...rest], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const dirty = git("status", "--porcelain", "--", "renderer/node-styles.js");
    return `${git("rev-parse", "--abbrev-ref", "HEAD")} ${git("rev-parse", "--short", "HEAD")}${dirty ? " + uncommitted node-styles.js" : ""}`;
  } catch { return path.basename(source); }
}

// PIL (installed; no numpy) assembles the GIFs from the frame PNGs.
const GIF_SCRIPT = `import json, sys
from PIL import Image
for job in json.load(open(sys.argv[1], encoding="utf-8")):
    frames = [Image.open(name).convert("RGB") for name in job["frames"]]
    paletted = [frame.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for frame in frames]
    paletted[0].save(job["out"], save_all=True, append_images=paletted[1:], duration=job["duration"], loop=0, disposal=1)
`;

const executable = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
if (!existsSync(executable)) throw new Error("Install repository dependencies before capturing (npm ci)");
await mkdir(out, { recursive: true });
const fixture = await mkdtemp(path.join(tmpdir(), "mefi-node-sheet-"));
try {
  const job = {
    styles, styleNames: STYLE_NAMES, themes, dprs, strips, stamp: stamp(), agentDressSkips,
    sources: { nodeStyles: nodeStylesSource, agentColors, agentGlyphs },
  };
  await writeFile(path.join(fixture, "job.json"), JSON.stringify(job));
  const env = { ...process.env, MEFI_NODE_SHEET_FIXTURE: fixture };
  delete env.ELECTRON_RUN_AS_NODE;
  // Chromium helpers can briefly outlive the Electron host. Keep their inherited
  // working directory outside the disposable fixture so Windows can remove it.
  const child = spawn(executable, [path.join(studio, "tests", "fixtures", "node-styles-sheet-electron.cjs"), "--force-device-scale-factor=1"], { cwd: studio, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-20000); process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-20000); });
  const timer = setTimeout(() => child.kill(), 60000 + styles.length * themes.length * (dprs.length * 20000 + 30000) + (strips ? styles.length * 20000 : 0));
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
  const reportPath = path.join(fixture, "report.json");
  if (!existsSync(reportPath)) throw new Error(`The sheet process exited ${code} without a report: ${diagnostics.slice(-6000)}`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (code !== 0 || report.failure) throw new Error(report.failure || `The sheet process exited ${code}: ${diagnostics.slice(-6000)}`);
  if (report.networkAttempts.length) throw new Error(`The sheet page tried the network: ${report.networkAttempts.join(", ")}`);

  // The page returned canvas.toDataURL() payloads; write them as PNGs. Strip frames stay in the fixture for PIL.
  const written = [];
  const frames = new Map();
  for (const { name, file } of report.outputs) {
    const png = Buffer.from(await readFile(file, "utf8"), "base64");
    const frame = /^strip-([a-z]+)\/(fast|slow)-\d+$/.exec(name);
    const target = frame ? path.join(fixture, "frames", `${name}.png`) : path.join(out, `${name}.png`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, png);
    if (frame) {
      const key = `${frame[1]}:${frame[2]}`;
      if (!frames.has(key)) frames.set(key, []);
      frames.get(key).push(target);
    } else written.push(target);
  }
  if (strips) {
    const gifs = [];
    for (const style of styles) {
      gifs.push({ frames: frames.get(`${style}:fast`) ?? [], out: path.join(out, `strip-${style}.gif`), duration: 33 });
      gifs.push({ frames: frames.get(`${style}:slow`) ?? [], out: path.join(out, `strip-${style}-6s.gif`), duration: 500 });
    }
    const usable = gifs.filter((gif) => gif.frames.length);
    for (const gif of usable) gif.frames.sort();
    await writeFile(path.join(fixture, "gifs.json"), JSON.stringify(usable));
    await writeFile(path.join(fixture, "gifs.py"), GIF_SCRIPT);
    const python = spawnSync("python", [path.join(fixture, "gifs.py"), path.join(fixture, "gifs.json")], { encoding: "utf8", windowsHide: true });
    if (python.error || python.status !== 0) console.warn(`GIF strips skipped (python + PIL): ${python.error?.message ?? python.stderr.trim().slice(-2000)}`);
    else written.push(...usable.map((gif) => gif.out));
  }

  // metrics.json: one entry per style and theme, and per style the checks the plan gates on.
  const metrics = {
    generated: new Date().toISOString(), source, stamp: job.stamp, moduleVersion: report.version, dprs,
    themes: themes.map(({ key, name, palette }) => ({ key, name, palette })), agentDressSkips,
    notes: {
      strip: "mean absolute RGB+alpha change (0..255) between consecutive frames of a working node at r 15 (body alone; WithOverlays adds the style's own hooks); > 0 means animated",
      still: "reduced motion: the still record after one frame at t 0 against 5 s later at t 5000, every steady row at r 8 and 15, body + style hooks; must be 0",
      reach: "farthest pixel with alpha >= 4/255 from the centre, in radii, at r 15 (steady: body alone; glow: Extra glow; arrival: body + arrival hook over the grow)",
      steadyFrames: "per 30 Hz frame after 2 warm-up frames, every steady row at r 4.5/8/12/15 plus the wires and pulses on one canvas: gradients built, shadowBlur/filter set, and module calls that left the context changed",
    },
    checks: {}, styles: {},
  };
  for (const entry of report.metrics) (metrics.styles[entry.style] ??= {})[entry.theme] = entry;
  const round = (number) => Math.round(number * 1000) / 1000;
  for (const style of styles) {
    const entries = Object.values(metrics.styles[style] ?? {});
    const most = (pick) => round(Math.max(...entries.map(pick)));
    const least = (pick) => round(Math.min(...entries.map(pick)));
    const sum = (object) => Object.values(object).reduce((total, number) => total + number, 0);
    const checks = {
      animated: { value: least((entry) => entry.strip.fast.mean), pass: entries.every((entry) => entry.strip.fast.mean > 0) },
      stillIdentical: { value: most((entry) => entry.still.meanChange), pass: entries.every((entry) => entry.still.meanChange === 0 && entry.still.changedShare === 0) },
      steadyReach: { value: most((entry) => entry.reach.steady.value), limit: 1.8 },
      glowReach: { value: most((entry) => entry.reach.glow.value), limit: 2.25 },
      arrivalReach: { value: most((entry) => entry.reach.arrival.value), limit: 2.25 },
      gradientsPerSteadyFrame: { value: most((entry) => sum(entry.steadyFrames.gradientsPerFrame)), limit: 0 },
      shadowBlurOrFilterPerFrame: { value: most((entry) => sum(entry.steadyFrames.shadowBlurPerFrame) + sum(entry.steadyFrames.filterPerFrame)), limit: 0 },
      stateLeaks: { value: most((entry) => sum(entry.steadyFrames.stateLeaks)), limit: 0 },
    };
    for (const check of Object.values(checks)) if ("limit" in check) check.pass = check.value <= check.limit;
    metrics.checks[style] = checks;
  }
  const metricsPath = path.join(out, "metrics.json");
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2) + "\n");
  written.push(metricsPath);

  const mark = (check) => `${check.value}${check.pass ? "" : " !"}`;
  const columns = [["animated", "animated"], ["still", "stillIdentical"], ["reach", "steadyReach"], ["glow", "glowReach"], ["arrival", "arrivalReach"], ["grad/frame", "gradientsPerSteadyFrame"], ["blur/filter", "shadowBlurOrFilterPerFrame"], ["leaks", "stateLeaks"]];
  console.log(`\nnode styles @ ${job.stamp} (module v${report.version}); "!" marks a check the plan's gates would fail`);
  console.log(["style".padEnd(12), ...columns.map(([title]) => title.padEnd(11))].join(" "));
  for (const style of styles) {
    const checks = metrics.checks[style];
    console.log([style.padEnd(12), ...columns.map(([, key]) => mark(checks[key]).padEnd(11))].join(" "));
  }
  console.log(`\n${written.length} files in ${out}`);
} finally {
  // This is the exact mkdtemp-created path; never remove source or output folders.
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(fixture));
  if (!relative.startsWith("mefi-node-sheet-") || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error("Unexpected temporary fixture path");
  await rm(fixture, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
}
