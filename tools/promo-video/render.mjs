// Renders promo.html into an MP4: seeks the page to every frame's time,
// screenshots it in headless Chromium, and pipes the frames to ffmpeg with
// the score from music.mjs. Needs Playwright (a global install is fine) and an
// ffmpeg with libx264 on PATH or in FFMPEG. Not part of the app or its gates.
//
//   node tools/promo-video/render.mjs                       # full film
//   node tools/promo-video/render.mjs --stills 0.5,12,30    # PNG stills only
//   node tools/promo-video/render.mjs --out promo.mp4 --fps 30
import { spawn, execSync, execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeScore } from "./music.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const FPS = Number(opt("fps", 30));
const DURATION = 50;
const OUT = resolve(opt("out", join(here, "out", "mefi-studio-promo.mp4")));
const STILLS = opt("stills", "");
const FFMPEG = process.env.FFMPEG || "ffmpeg";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(join(root, "noop.js"))("playwright");
  }
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
// Web fonts come from Google Fonts. Behind an HTTPS proxy with its own CA the
// browser can't reach them, so curl, which follows the shell's proxy and CA
// settings, fetches them instead.
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => {
    const url = route.request().url();
    const body = execFileSync("curl", ["-sSfL", "-A", route.request().headers()["user-agent"], url]);
    route.fulfill({ body, contentType: url.includes("googleapis") ? "text/css" : "font/woff2", headers: { "access-control-allow-origin": "*" } });
  });
}
await page.goto(pathToFileURL(join(here, "promo.html")).href);
await page.evaluate(() => globalThis.ready);
const loaded = await page.evaluate(() => [...globalThis.document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
const missing = ["Newsreader", "Inter", "JetBrains Mono"].filter((f) => !loaded.includes(f));
if (missing.length) console.warn(`warning: web fonts not loaded, falling back for: ${missing.join(", ")}`);

if (STILLS) {
  const dir = join(here, "out", "stills");
  mkdirSync(dir, { recursive: true });
  for (const t of STILLS.split(",").map(Number)) {
    await page.evaluate((x) => globalThis.seek(x), t);
    const file = join(dir, `t${t.toFixed(2).padStart(6, "0")}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
const wav = join(here, "out", "score.wav");
if (!existsSync(dirname(wav))) mkdirSync(dirname(wav), { recursive: true });
writeScore(wav, DURATION);

const ff = spawn(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
  "-i", wav,
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-tune", "animation",
  "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
  OUT,
], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((ok, fail) => ff.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`)))));

const frames = Math.round(DURATION * FPS);
const started = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate((x) => globalThis.seek(x), f / FPS);
  const png = await page.screenshot({ type: "png" });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % 150 === 0) console.log(`frame ${f}/${frames} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
ff.stdin.end();
await done;
await browser.close();
console.log(OUT);
