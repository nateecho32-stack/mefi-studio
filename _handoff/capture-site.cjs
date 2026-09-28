// Offscreen screenshots of a static site folder, for design review.
//
//   <electron.exe> capture-site.cjs --root C:\wt\site --out <dir> [--pages index.html,roadmap.html]
//                  [--widths 1440,390] [--height 900] [--full-cap 9000] [--prefix name]
//
// Serves --root on 127.0.0.1 (random port), loads each page at each width in an
// offscreen window with reduced motion forced (so reveal-on-scroll content is
// shown settled) and device scale factor 1, then writes, per page and width:
//   <slug>-w<width>-full.png   the whole page (up to --full-cap px tall)
//   <slug>-w<width>-<n>.png    viewport-height segments, top to bottom
// and report.json with each page's height, console errors, failed requests
// (404s) and the links it contains. Exits 0 even when pages have errors; read
// report.json.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const ROOT = path.resolve(opt("root", process.cwd()));
const OUT = path.resolve(opt("out", path.join(process.cwd(), "shots")));
const PAGES = opt("pages", "index.html").split(",").map((p) => p.trim()).filter(Boolean);
const WIDTHS = opt("widths", "1440,390").split(",").map(Number).filter((n) => n > 0);
const H = Number(opt("height", "900"));
const FULL_CAP = Number(opt("full-cap", "9000"));
const PREFIX = opt("prefix", "");

fs.mkdirSync(OUT, { recursive: true });
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("force-prefers-reduced-motion");
app.disableHardwareAcceleration();
const userData = path.join(OUT, ".userdata");
fs.rmSync(userData, { recursive: true, force: true });
app.setPath("userData", userData);

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".md": "text/markdown; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".woff2": "font/woff2", ".txt": "text/plain" };
const served = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html"); } catch {}
  fs.readFile(file, (error, data) => {
    if (error) { served.push({ status: 404, path: url.pathname }); res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slugOf = (page) => `${PREFIX}${page.replace(/\.html$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "index"}`;

// One window per page and width; the app must not quit between them.
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const report = [];
  for (const page of PAGES) {
    for (const width of WIDTHS) {
      const win = new BrowserWindow({ width, height: H, show: false, useContentSize: true, backgroundColor: "#000000",
        webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
      win.webContents.setFrameRate(30);
      let frame = null;
      win.webContents.on("paint", (_e, _dirty, image) => { frame = image; });
      const errors = [];
      win.webContents.on("console-message", (event) => { const level = event.level ?? event?.params?.level; if (level === "error" || level === 3 || level === "warning" && /404|failed/i.test(event.message)) errors.push(String(event.message).slice(0, 300)); });
      win.webContents.on("did-fail-load", (_e, code, desc, url) => errors.push(`load failed ${code} ${desc} ${url}`));
      const before = served.length;
      try { await win.loadURL(base + page); } catch (error) { errors.push(`loadURL: ${error.message}`); }
      await wait(1400);
      const info = await win.webContents.executeJavaScript(`({ height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0), title: document.title,
        links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter((h, i, all) => all.indexOf(h) === i),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1 })`).catch((error) => ({ height: H, title: "", links: [], error: error.message }));
      const slug = `${slugOf(page)}-w${width}`;
      // Segments, top to bottom.
      const segments = Math.max(1, Math.min(14, Math.ceil(info.height / H)));
      for (let index = 0; index < segments; index += 1) {
        await win.webContents.executeJavaScript(`window.scrollTo(0, ${index * H}); true`).catch(() => {});
        await wait(350); frame = null; win.webContents.invalidate(); await wait(450);
        if (frame) fs.writeFileSync(path.join(OUT, `${slug}-${String(index + 1).padStart(2, "0")}.png`), frame.toPNG());
      }
      // The whole page in one frame.
      await win.webContents.executeJavaScript("window.scrollTo(0, 0); true").catch(() => {});
      const fullHeight = Math.min(info.height, FULL_CAP);
      win.setContentSize(width, fullHeight);
      await wait(900); frame = null; win.webContents.invalidate(); await wait(900);
      if (frame) fs.writeFileSync(path.join(OUT, `${slug}-full.png`), frame.toPNG());
      report.push({ page, width, title: info.title, height: info.height, cappedAt: info.height > FULL_CAP ? FULL_CAP : null, segments,
        horizontalOverflow: info.overflowX === true, consoleErrors: errors, notFound: served.slice(before).filter((row) => row.status === 404).map((row) => row.path), links: info.links });
      win.destroy();
    }
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  server.close();
  app.exit(0);
});
