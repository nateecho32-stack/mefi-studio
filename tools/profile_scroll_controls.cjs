// Compare actual scroll-control layout and behavior in an isolated renderer.
// node tools/profile_scroll_controls.cjs --before file.js --after file.js --output report.json
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
for (const name of ["--before", "--after", "--output"]) if (!args.includes(name)) throw new Error(`Missing ${name}`);
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mefi-scroll-profile-"));
  const env = { ...process.env, MEFI_SCROLL_PROFILE: directory }; delete env.ELECTRON_RUN_AS_NODE;
  let run;
  try {
    run = require("node:child_process").spawnSync(require(path.join(root, "node_modules/electron")), [__filename, ...args], { env, cwd: root, windowsHide: true, stdio: "inherit", timeout: 90000 });
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("mefi-scroll-profile-"));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
  if (run.error) console.error(run.error.message);
  process.exit(run.status ?? 1);
}
const { app, BrowserWindow, session } = require("electron");
const directory = process.env.MEFI_SCROLL_PROFILE;
if (!directory || !path.isAbsolute(directory)) throw new Error("Run through Node for an isolated profile");
app.setName("Studio Scroll Performance Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) { const folder = path.join(directory, name); fs.mkdirSync(folder); app.setPath(name, folder); }
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
const sources = Object.fromEntries(["before", "after"].map(name => [name, fs.readFileSync(path.resolve(arg(`--${name}`)), "utf8")]));
function excerpt(source) {
  const start = source.indexOf("(function () {"), end = source.indexOf("  function scan(");
  assert.ok(start >= 0 && end > start);
  // Only scroll regions participate. Selects, observers and animation scheduling
  // are excluded so the comparison attributes layout to refresh itself.
  return source.slice(start, end).replace('"use strict";', '"use strict"; const requestAnimationFrame=()=>0; const ResizeObserver=undefined;') +
    "function positionPopup(){} window.scrollFixture={track,refresh,regions};})();";
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith("file:") }));
  const report = { environment: { electron: process.versions.electron, platform: process.platform, panels: 16, iterations: 25, pairs: 5 }, runs: [] };
  const windows = {};
  for (const name of ["before", "after"]) {
    const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    windows[name] = win;
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const file = path.join(directory, `${name}.html`);
    fs.writeFileSync(file, "<!doctype html><html><body><main id='panels'></main></body></html>");
    await win.loadFile(file);
    await win.webContents.insertCSS(fs.readFileSync(path.join(root, "renderer/studio-ui.css"), "utf8") + "\n*{box-sizing:border-box}body{margin:0;overflow:hidden}#panels{display:grid;grid-template-columns:repeat(4,290px);gap:8px;padding:8px}.panel{height:180px;overflow:auto;padding:8px}.content{height:360px;width:340px;background:#eee}.studio-scroll-hint{position:fixed}");
    await win.webContents.executeJavaScript(excerpt(sources[name]));
    await win.webContents.executeJavaScript(`(()=>{for(let i=0;i<16;i++){const panel=document.createElement('section');panel.id='panel-'+i;panel.className='panel';const content=document.createElement('div');content.className='content';content.textContent='Synthetic scroll content';panel.append(content);document.getElementById('panels').append(panel);window.scrollFixture.track(panel);}window.scrollFixture.refresh();void document.body.offsetHeight;})()`);
    win.webContents.debugger.attach("1.3"); await win.webContents.debugger.sendCommand("Performance.enable");
  }
  async function sample(name) {
    const contents = windows[name].webContents;
    const before = (await contents.debugger.sendCommand("Performance.getMetrics")).metrics;
    const elapsedMs = await contents.executeJavaScript(`(()=>{const panels=[...document.querySelectorAll('.panel')];const start=performance.now();for(let i=0;i<25;i++){for(const panel of panels)panel.firstChild.style.height=(360+i%2)+'px';window.scrollFixture.refresh();void document.body.offsetHeight;}return performance.now()-start;})()`);
    const after = (await contents.debugger.sendCommand("Performance.getMetrics")).metrics;
    const delta = key => after.find(x=>x.name===key).value - before.find(x=>x.name===key).value;
    return { name, elapsedMs, layouts: delta("LayoutCount"), layoutMs: delta("LayoutDuration") * 1000,
      stylePasses: delta("RecalcStyleCount"), styleMs: delta("RecalcStyleDuration") * 1000 };
  }
  await sample("before"); await sample("after");
  for (let pair=0;pair<5;pair++) for (const name of pair%2 ? ["after","before"] : ["before","after"]) report.runs.push(await sample(name));
  const behavior = `(()=>{
    const f=window.scrollFixture, panel=document.getElementById('panel-0');
    panel.focus();
    const snapshot=()=>{f.refresh();const r=f.regions.get(panel);return {hidden:r.hint.hidden,tab:panel.getAttribute('tabindex'),directions:Object.fromEntries(Object.entries(r.buttons).map(([k,b])=>[k,!b.hidden])),bounds:['left','top','width','height'].map(k=>r.hint.style[k]),arrows:Object.fromEntries(Object.entries(r.buttons).map(([k,b])=>[k,[b.style.left,b.style.top]]))};};
    panel.scrollTo(0,0);const top=snapshot();panel.scrollTo(1000,1000);const bottom=snapshot();
    panel.hidden=true;const hidden=snapshot();panel.hidden=false;const reopened=snapshot();
    panel.firstChild.style.height='20px';panel.firstChild.style.width='20px';const fits=snapshot();
    panel.firstChild.style.height='400px';panel.firstChild.style.width='340px';const again=snapshot();
    panel.remove();f.refresh();const removed=!f.regions.has(panel)&&!document.querySelector('[data-scroll-owner="panel-0"]');
    return {top,bottom,hidden,reopened,fits,again,removed};
  })()`;
  report.behavior = {};
  for (const name of ["before", "after"]) report.behavior[name] = await windows[name].webContents.executeJavaScript(behavior);
  assert.deepEqual(report.behavior.after, report.behavior.before, "scroll boundaries, tab stops, hide/reopen, no-overflow and removal stay identical");
  assert.ok(report.behavior.after.removed);
  const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  report.medians = Object.fromEntries(["before","after"].map(name => [name, { msPerRefresh: median(report.runs.filter(x=>x.name===name).map(x=>x.elapsedMs/25)), layoutsPerRefresh: median(report.runs.filter(x=>x.name===name).map(x=>x.layouts/25)), stylePassesPerRefresh: median(report.runs.filter(x=>x.name===name).map(x=>x.stylePasses/25)) }]));
  const output = path.resolve(arg("--output")); fs.mkdirSync(path.dirname(output), { recursive: true });fs.writeFileSync(output, JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({medians:report.medians,behaviorParity:true,output},null,2));
  for (const win of Object.values(windows)) win.destroy(); app.quit();
}).catch(error=>{console.error(error.stack);app.exit(1);});
