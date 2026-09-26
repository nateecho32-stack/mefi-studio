// Renders tools/promo/showreel-stage.js to an MP4: an offscreen Electron page
// gets the Studio's own node painters, agent glyphs and theme palettes, is sought
// frame by frame, and each frame is piped to ffmpeg with the score from
// showreel-score.cjs. No live app, settings, stores, workers or network.
//
//   node node_modules/electron/cli.js tools/promo/showreel.cjs              # dist/promo/mefi-showreel.mp4 (+ -discord.mp4 under 10 MB)
//   node node_modules/electron/cli.js tools/promo/showreel.cjs --stills 1,3,5.5,9,12,14.5,16,19
//   node node_modules/electron/cli.js tools/promo/showreel.cjs --fps 30 --theme abyss
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { writeScore } = require("./showreel-score.cjs");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "dist", "promo");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const FPS = Number(opt("fps", 60));
const THEME = opt("theme", "void");
const STILLS = opt("stills", "");
const FFMPEG = process.env.FFMPEG || "ffmpeg";

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
function section(text, start, end) {
  const from = text.indexOf(start), to = from < 0 ? -1 : text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`slice ${JSON.stringify(start)} … ${JSON.stringify(end)} is missing`);
  return text.slice(from, to);
}
// The canvas palette exactly as music.js resolves it (the node suites take the same slices).
const music = read("renderer/music.js");
const box = {};
vm.createContext(box);
vm.runInContext([section(music, "  const THEMES = {", "  const NODE_STYLES = {"), section(music, "  const CUSTOM_DEFAULTS", "  function spotifyLink("), "globalThis.__p = { THEMES, resolvePalette };"].join("\n"), box);
const { THEMES, resolvePalette } = box.__p;
if (!THEMES[THEME]) throw new Error(`unknown theme ${THEME}`);
// Every theme's colours and canvas palette: the film is in THEME, and its
// themes scene runs through several others.
const themes = Object.fromEntries(Object.keys(THEMES).map((key) => [key, { info: { ...THEMES[key] }, palette: JSON.parse(JSON.stringify(resolvePalette(key).canvas)) }]));
const tree = read("renderer/tree3d.js");
const sources = {
  nodeStyles: read("renderer/node-styles.js"),
  agentColors: section(tree, "  const AGENT_COLORS = {", "  // HSL -> #rrggbb"),
  agentGlyphs: section(tree, "  const AGENT_GLYPHS = {", "  const AGENT_RING = 34;"),
  stage: fs.readFileSync(path.join(__dirname, "showreel-stage.js"), "utf8"),
};

fs.mkdirSync(path.join(OUT, "work"), { recursive: true });
app.setPath("userData", fs.mkdtempSync(path.join(OUT, "work", "showreel-")));
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file:|data:|blob:)/.test(d.url) }));
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, frame: false, useContentSize: true, backgroundColor: "#000000",
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const wc = win.webContents;
  wc.setFrameRate(60);
  const errors = [];
  wc.on("console-message", (_e, d) => { if (d.level === "error" || d.level === 3) errors.push(d.message); });
  await win.loadFile(path.join(__dirname, "showreel.html"));
  const run = (code) => wc.executeJavaScript(code);
  await run(`window.__themes = ${JSON.stringify(themes)}; window.__themeKey = ${JSON.stringify(THEME)};
${sources.nodeStyles}
;(function () {
${sources.agentColors}
${sources.agentGlyphs}
  window.__agentLook = { AGENT_COLORS, agentGlyph, glyphInk };
})();
${sources.stage}
true`);
  await run("window.ready");
  const duration = await run("window.__duration");
  const cuts = await run("window.__cuts");
  // One frame as PNG bytes, read straight off the canvas (exact pixels, no compositor).
  const frame = async (t) => {
    const url = await run(`window.seek(${t}); document.getElementById("stage").toDataURL("image/png")`);
    return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  };

  if (STILLS) {
    const dir = path.join(OUT, "showreel-stills");
    fs.mkdirSync(dir, { recursive: true });
    // Walk up to each still at 30 fps so motion records are warm, as in the film.
    let t = 0;
    for (const at of STILLS.split(",").map(Number).sort((a, b) => a - b)) {
      for (; t < at - 1 / 30; t += 1 / 30) await run(`window.seek(${t}); true`);
      const file = path.join(dir, `t${at.toFixed(2).padStart(5, "0")}.png`);
      fs.writeFileSync(file, await frame(at));
      console.log(file);
      t = at;
    }
    if (errors.length) console.error(errors.join("\n"));
    app.exit(errors.length ? 1 : 0);
    return;
  }

  const wav = path.join(OUT, "work", "showreel-score.wav");
  writeScore(wav, duration, cuts);
  const file = path.join(OUT, `mefi-showreel${THEME === "void" ? "" : "-" + THEME}.mp4`);
  const ff = spawn(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-", "-i", wav,
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((ok, fail) => ff.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`)))));
  const frames = Math.round(duration * FPS);
  const started = Date.now();
  for (let f = 0; f < frames; f += 1) {
    const png = await frame(f / FPS);
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 120 === 0) console.log(`frame ${f}/${frames} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await done;
  console.log(file);
  // The share copy: two-pass H.264 sized to stay under Discord's 10 MB upload.
  const share = file.replace(/\.mp4$/, "-discord.mp4");
  const audioKbps = 160, targetBytes = 9.4 * 1024 * 1024;
  const videoKbps = Math.floor((targetBytes * 8 / duration) / 1000 - audioKbps);
  const pass = (n, extra) => new Promise((ok, fail) => spawn(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", file,
    "-c:v", "libx264", "-preset", "slow", "-b:v", `${videoKbps}k`, "-pass", String(n), "-passlogfile", path.join(OUT, "work", "share"), "-pix_fmt", "yuv420p", ...extra],
    { stdio: "inherit" }).on("close", (code) => (code === 0 ? ok() : fail(new Error(`share pass ${n} exited ${code}`)))));
  await pass(1, ["-an", "-f", "null", "-"]);
  await pass(2, ["-c:a", "aac", "-b:a", `${audioKbps}k`, "-movflags", "+faststart", share]);
  console.log(share);
  if (errors.length) console.error(errors.join("\n"));
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
