"use strict";

const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.MEFI_NODE_PAINT_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated node paint directory is required");
const report = { networkAttempts: [] };
app.setName("Studio Node Paint Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}
app.disableHardwareAcceleration();
let finished = false;
let window;
// Finish owns shutdown so closing the last window cannot quit before the
// session has released connections and the report has been written.
app.on("window-all-closed", () => {});
async function finish(error) {
  if (finished) return;
  finished = true;
  const errors = error ? [error] : [];
  try {
    if (window && !window.isDestroyed()) {
      await new Promise((resolve) => { window.once("closed", resolve); window.close(); });
    }
    if (app.isReady()) {
      session.defaultSession.flushStorageData();
      await session.defaultSession.closeAllConnections();
    }
  } catch (shutdownError) { errors.push(shutdownError); }
  if (errors.length) report.failure = errors.map((failure) => failure.stack || String(failure)).join("\nShutdown also failed:\n");
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (report.failure) console.error(report.failure);
  process.exitCode = errors.length ? 1 : 0;
  app.quit();
}
process.on("uncaughtException", finish);
process.on("unhandledRejection", finish);

function browserChecks() {
  const state = { nodeStyle: "orbs", extraGlow: false };
  const rgba = (tint, alpha) => `rgba(${tint[0]},${tint[1]},${tint[2]},${alpha})`;
  // PRODUCTION_NODE_PAINT

  // Direct screen-space oracle from the pre-cache orb painter. Keep it
  // independent of production helpers so radius quantization, transformed
  // outlines, gradient-stop changes, and stale theme colors remain detectable.
  function reference(ctx, node, p, radius, tint, { selected = false, active = false, alpha = 1 } = {}) {
    ctx.save();
    ctx.globalAlpha = (node._fade ?? 1) * alpha;
    if (state.extraGlow) {
      const spread = radius * (active || selected ? 2.25 : 1.8);
      const glow = ctx.createRadialGradient(p.x, p.y, radius * 0.25, p.x, p.y, spread);
      glow.addColorStop(0, rgba(tint, active || selected ? 0.32 : 0.16));
      glow.addColorStop(0.45, rgba(tint, active || selected ? 0.14 : 0.05));
      glow.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, spread, 0, Math.PI * 2); ctx.fill();
    }
    const glowRadius = radius * (active || selected ? 1.9 : 1.45);
    const halo = ctx.createRadialGradient(p.x, p.y, radius * 0.45, p.x, p.y, glowRadius);
    halo.addColorStop(0, rgba(tint, active ? 0.22 : 0.1)); halo.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#151a22"; ctx.fill();
    const body = ctx.createRadialGradient(p.x - radius * 0.25, p.y - radius * 0.3, 0, p.x, p.y, radius);
    body.addColorStop(0, rgba(tint, 0.95)); body.addColorStop(0.42, rgba(tint, 0.48)); body.addColorStop(1, rgba(tint, 0.1));
    ctx.fillStyle = body; ctx.fill();
    ctx.strokeStyle = rgba(tint, selected ? 1 : active ? 0.85 : 0.55);
    ctx.lineWidth = selected ? 1.8 : active ? 1.3 : 0.8; ctx.stroke();
    if (node.kind !== "assistant" && node.kind !== "music") {
      ctx.fillStyle = "rgba(242,249,255,0.62)"; ctx.beginPath(); ctx.arc(p.x - radius * 0.25, p.y - radius * 0.3, Math.max(1, radius * 0.13), 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.font = '600 10px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#edf0f5"; ctx.fillText(node.kind === "music" ? "♪" : "M", p.x, p.y + 0.5);
    }
    ctx.restore();
  }

  const createCanvas = (dpr = 1) => {
    const canvas = document.createElement("canvas"); canvas.width = 1280 * dpr; canvas.height = 960 * dpr;
    const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    ctx.fillStyle = "#102030"; ctx.fillRect(0, 0, 1280, 960);
    // Exercise preservation of the existing clip and non-default transform.
    ctx.translate(0.25, 0.375); ctx.beginPath(); ctx.rect(7, 5, 1263, 940); ctx.clip();
    return { canvas, ctx };
  };
  const radii = [2, 2.125, 3.4, 4.5, 7.75, 10, 11.123, 15];
  const colors = [[222, 170, 95], [125, 178, 255], [27, 49, 63], [231, 241, 248]];
  const samples = [];
  for (const radius of radii) for (const active of [false, true]) for (const selected of [false, true]) for (const extraGlow of [false, true]) for (const kind of ["task", "assistant", "music"]) {
    const i = samples.length;
    samples.push({ node: { kind, _fade: i % 7 === 0 ? 0.51 : 1 }, p: { x: 40 + i % 16 * 80 + Math.sin(i) * 0.31, y: 40 + Math.floor(i / 16) * 80 + Math.cos(i) * 0.27 }, radius, tint: colors[i % colors.length], options: { active, selected, alpha: i % 3 === 0 ? 0.65 : 1 }, extraGlow });
  }
  const result = { scenes: [], contextRestored: true };
  const contextState = (ctx) => ({ matrix: Array.from(ctx.getTransform().toFloat64Array()), alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth, font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle });
  for (const dpr of [1, 1.5, 2]) {
    const targets = [createCanvas(dpr), createCanvas(dpr)];
    for (let index = 0; index < targets.length; index++) {
      const { ctx } = targets[index];
      ctx.globalAlpha = 0.73;
      const originalState = JSON.stringify(contextState(ctx));
      for (const sample of samples) {
        state.extraGlow = sample.extraGlow;
        (index === 0 ? reference : drawNodeSurface)(ctx, sample.node, sample.p, sample.radius, sample.tint, sample.options);
        if (JSON.stringify(contextState(ctx)) !== originalState) result.contextRestored = false;
      }
    }
    const pixels = targets.map(({ canvas, ctx }) => ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    let maxDelta = 0, sum = 0, changedChannels = 0;
    for (let i = 0; i < pixels[0].length; i++) {
      const delta = Math.abs(pixels[0][i] - pixels[1][i]);
      maxDelta = Math.max(maxDelta, delta); sum += delta; if (delta) changedChannels++;
    }
    result.scenes.push({ dpr, samples: samples.length, maxDelta, meanDelta: sum / pixels[0].length, changedChannels });
  }
  state.extraGlow = false;
  const { ctx } = createCanvas();
  let created = 0;
  const createRadialGradient = ctx.createRadialGradient.bind(ctx);
  ctx.createRadialGradient = (...args) => { created++; return createRadialGradient(...args); };
  const paint = (tint, i = 0) => drawNodeSurface(ctx, { kind: "task", _fade: 0.25 + i % 4 * 0.2 }, { x: 35 + i * 0.31, y: 38 + i * 0.27 }, 2 + i % 13 + Math.sin(i) * 0.1, tint, { alpha: 0.8 });
  paint(colors[0]);
  result.warmGradientCreates = created;
  for (let i = 0; i < 60; i++) paint(colors[0], i);
  result.movingGradientCreates = created;
  const palette = Array.from({ length: 160 }, (_, i) => [i, 101, 201]);
  for (const tint of palette) paint(tint);
  result.cacheEntries = window.MefiNodeStyles.cacheStats(ctx).entries;
  const beforeRecent = created; paint(palette.at(-1)); result.recentReused = created === beforeRecent;
  const beforeOldest = created; paint(colors[0]); result.oldestEvicted = created > beforeOldest;
  const second = createCanvas().ctx;
  let secondCreates = 0;
  const secondCreate = second.createRadialGradient.bind(second);
  second.createRadialGradient = (...args) => { secondCreates++; return secondCreate(...args); };
  drawNodeSurface(second, { kind: "task" }, { x: 40, y: 40 }, 8.123, colors[0]);
  result.secondContextCreates = secondCreates;
  return result;
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith("data:");
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadURL("data:text/html,<html></html>");
  const source = fs.readFileSync(path.join(root, "idle.js"), "utf8");
  const start = source.indexOf("  function traceNodeSurface("), end = source.indexOf("  function drawWorkOrbit(", start);
  if (start < 0 || end <= start) throw new Error("Node painter extraction markers are missing");
  // The painters themselves (renderer/node-styles.js) load first, whole, as
  // the booklet bundles them; the idle.js adapter slice then paints through
  // window.MefiNodeStyles exactly as the Command view does.
  const painters = fs.readFileSync(path.join(root, "node-styles.js"), "utf8");
  const script = `${painters}\n;(${browserChecks.toString().replace("// PRODUCTION_NODE_PAINT", source.slice(start, end))})()`;
  Object.assign(report, await window.webContents.executeJavaScript(script));
  await finish();
}).catch(finish);
