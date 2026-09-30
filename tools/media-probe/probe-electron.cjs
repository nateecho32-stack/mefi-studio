"use strict";
// Offscreen Studio with a fake YouTube embed that speaks the widget protocol
// (listening -> initialDelivery/onReady/infoDelivery; command playVideo, ...).
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.PROBE_ROOT;
const scenario = process.env.PROBE_SCENARIO || "before";
const report = { errors: [], loads: 0, commands: [], steps: {} };
for (const key of ["userData", "sessionData", "crashDumps"]) { const directory = path.join(root, key); fs.mkdirSync(directory); app.setPath(key, directory); }
app.setName("Studio Media Probe"); app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let finished = false;
function finish(error) {
  if (finished) return; finished = true;
  if (error) report.failure = error.stack || String(error);
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);
const PLAYER = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:#101820;font:600 15px system-ui;color:#fff}
#art{position:absolute;inset:0;background:radial-gradient(ellipse at 30% 30%,#e0b36a,transparent 45%),radial-gradient(ellipse at 75% 70%,#3aa38f,transparent 50%),linear-gradient(160deg,#1d3557,#0b1320)}
#t{position:absolute;left:14px;top:12px;text-shadow:0 2px 8px #000}#c{position:absolute;left:14px;bottom:44px;font:12px monospace;text-shadow:0 1px 4px #000}
#bar{position:absolute;left:0;right:0;bottom:0;height:36px;background:linear-gradient(transparent,#000a)}#p{position:absolute;left:12px;right:12px;bottom:28px;height:3px;background:#fff4}#f{height:100%;width:0;background:#f33}
#gear{position:absolute;right:10px;bottom:6px;width:26px;height:24px;border:0;background:#fff3;color:#fff}
</style></head><body><div id="art"></div><div id="t"></div><div id="c"></div><div id="bar"></div><div id="p"><div id="f"></div></div><button id="gear">⚙</button><script>
const id = (location.pathname.split("/").pop() || "video").slice(0, 11);
const titles = { dQw4w9WgXcQ: ["Night Drive — Lo-fi mix", "Studio Test Channel"], M7lc1UVf_VE: ["Aurora timelapse over the fjords", "Northern Lights TV"] };
const [title, author] = titles[id] || ["Queued fixture video " + id, "Fixture uploads"];
const autoplay = /[?&]autoplay=1/.test(location.search);
const s = { t: Number((/[?&]start=(\\d+)/.exec(location.search) || [])[1] || 0), d: 225, playing: autoplay, vol: 100, muted: /[?&]mute=1/.test(location.search), last: performance.now(), listening: false };
document.getElementById("t").textContent = title;
function info() { return { currentTime: s.t, duration: s.d, playerState: s.playing ? 1 : 2, volume: s.vol, muted: s.muted, videoData: { video_id: id, title, author } }; }
function send(event, extra) { parent.postMessage(JSON.stringify({ event, id: "studio-media", channel: "widget", ...extra }), "*"); }
addEventListener("message", (e) => {
  let m; try { m = JSON.parse(e.data); } catch { return; }
  if (m.event === "listening") { if (!s.listening) { s.listening = true; send("initialDelivery", { info: info() }); send("onReady", {}); } return; }
  if (m.event !== "command") return;
  parent.postMessage(JSON.stringify({ probeCommand: m.func, args: m.args }), "*");
  if (m.func === "playVideo") s.playing = true;
  if (m.func === "pauseVideo") s.playing = false;
  if (m.func === "seekTo") s.t = Math.max(0, Math.min(s.d, Number(m.args[0]) || 0));
  if (m.func === "setVolume") s.vol = Math.max(0, Math.min(100, Number(m.args[0]) || 0));
  if (m.func === "mute") s.muted = true;
  if (m.func === "unMute") s.muted = false;
  if (s.listening) send("infoDelivery", { info: info() });
});
setInterval(() => {
  const now = performance.now();
  if (s.playing) s.t = Math.min(s.d, s.t + (now - s.last) / 1000);
  s.last = now;
  document.getElementById("c").textContent = (s.playing ? "▶ " : "❚❚ ") + s.t.toFixed(1) + " / " + s.d + " · vol " + s.vol + (s.muted ? " (muted)" : "");
  document.getElementById("f").style.width = (s.t / s.d * 100) + "%";
  if (s.listening) send("infoDelivery", { info: info() });
}, 250);
</script></body></html>`;
app.whenReady().then(async () => {
  session.defaultSession.protocol.handle("https", request => {
    if (request.url.startsWith("https://www.youtube-nocookie.com/embed/")) { report.loads++; return new Response(PLAYER, { headers: { "content-type": "text/html; charset=utf-8" } }); }
    if (request.url.startsWith("https://i.ytimg.com/vi/")) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0b36a"/><stop offset=".5" stop-color="#3aa38f"/><stop offset="1" stop-color="#1d3557"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/></svg>`;
      return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
    }
    return new Response("blocked", { status: 403 });
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url) || details.url.startsWith("https://www.youtube-nocookie.com/embed/") || details.url.startsWith("https://i.ytimg.com/vi/");
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_c, _p, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080, frame: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = code => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const capture = async name => { await sleep(260); contents.invalidate(); await sleep(120); fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG()); };
  const mouse = async (x, y, type = "mouseMove") => { contents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...(type !== "mouseMove" ? { button: "left", clickCount: 1 } : {}) }); await sleep(70); };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await sleep(1500);
  await run("window.fixtureCommands=[];window.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.probeCommand)window.fixtureCommands.push(m.probeCommand);}catch{}});");
  await run("await window.MefiNav.go('command');");
  await sleep(1200);
  await run("window.MefiMusic.playLink('https://youtu.be/dQw4w9WgXcQ',{autoplay:true});");
  await sleep(2500);
  await run("const input=document.getElementById('music-link-url');for(const url of ['https://youtu.be/M7lc1UVf-VE','https://vimeo.com/12345678','https://example.com/queued.mp4']){input.value=url;document.getElementById('music-link-queue-add')?.click();}");
  await capture(`${scenario}-floating.png`);
  // Hover the toolbar button, as the owner does.
  const button = await run("const r=document.getElementById('idle-music-toggle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width};");
  report.steps.button = button;
  await mouse(10, 500); await mouse(button.x, button.y); await sleep(700);
  report.steps.hoverOpen = await run("const d=document.getElementById('music-dropdown');const r=d.getBoundingClientRect();return {hidden:d.hidden,x:r.x,y:r.y,w:r.width,h:r.height,scrollH:d.scrollHeight};");
  await capture(`${scenario}-hover.png`);
  // Scroll the box and sample where the video sits relative to its stage, frame by frame.
  report.steps.scroll = await run(`
    const d=document.getElementById('music-dropdown');const stage=document.getElementById('music-video-stage');const w=document.getElementById('media-window');
    const samples=[];let y=d.scrollTop;
    for(let i=0;i<24;i++){ y+=14; d.scrollTop=y; await new Promise(r=>requestAnimationFrame(r)); const s=stage?.getBoundingClientRect(),m=w.getBoundingClientRect(); samples.push(s?Math.round((m.top-s.top)*10)/10:null); }
    return {samples,scrollTop:d.scrollTop};`);
  await capture(`${scenario}-scrolled.png`);
  await run("document.getElementById('music-dropdown').scrollTop=0;");
  report.commands = await run("return window.fixtureCommands;");
  finish();
}).catch(finish);
