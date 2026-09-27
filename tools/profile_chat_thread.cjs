// Isolated DOM benchmark of the production thread renderer and Studio's shared
// controls observer. No app boot, live data, providers or coding workers.
// node tools/profile_chat_thread.cjs --before <old-idle.js> --output <report.json>
// Add --composer to measure textarea sizing instead of thread updates.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
if (!args.includes("--before") || !args.includes("--output")) {
  console.error("node tools/profile_chat_thread.cjs --before <old-idle.js> --output <report.json>");
  process.exit(2);
}
if (!process.versions.electron) {
  const { spawnSync } = require("node:child_process");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mefi-thread-profile-"));
  env.MEFI_THREAD_PROFILE = fixture;
  let run;
  try {
    run = spawnSync(require(path.join(root, "node_modules/electron")), [__filename, ...args], {
      env, cwd: root, windowsHide: true, stdio: "inherit", timeout: 120000,
    });
  } finally {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(fixture));
    if (!relative.startsWith("mefi-thread-profile-") || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error("Unexpected temporary fixture path");
    fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
  if (run.error) console.error(run.error.message);
  process.exit(run.status ?? 1);
}
const { app, BrowserWindow, session } = require("electron");
const fixture = process.env.MEFI_THREAD_PROFILE;
if (!fixture || !path.isAbsolute(fixture)) throw new Error("Run this benchmark through Node to provide an isolated profile");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(fixture, name);
  fs.mkdirSync(directory);
  app.setPath(name, directory);
}
app.disableHardwareAcceleration();
const section = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing source section: ${start}`);
  return source.slice(a, b);
};
const renderer = (source) => `(() => {
  const state = { assistantSending: false };
  const agoLabel = () => 'just now';
  ${section(source, "  // Drop a just-repeated user/assistant pair.", "  function commandChatActivity(")}
  ${section(source, "  function replyPending(", "  // The assistant console in the rail.")}
  return fillThread;
})()`;
async function profileComposer(contents) {
  const grow = source => `(() => { ${section(source, "  function growArea(", "  // The reply-is-coming bubble:")} return growArea; })()`;
  const before = grow(fs.readFileSync(path.resolve(value("--before")), "utf8"));
  const after = grow(fs.readFileSync(path.join(root, "renderer/idle.js"), "utf8"));
  const report = await contents.executeJavaScript(`(() => {
    if (!CSS.supports('field-sizing','content')) throw Error('Native field sizing unavailable');
    const host=document.createElement('div'); host.className='assistant-composer'; host.style.width='420px';
    const area=document.createElement('textarea'); area.rows=1; area.placeholder='Message the assistant';
    const button=document.createElement('button'); button.textContent='Send'; host.append(area,button); document.body.append(host);
    const background=document.createElement('section');
    for(let i=0;i<1000;i++) { const row=document.createElement('p'); row.textContent='Saved activity '+i; background.append(row); }
    document.body.append(background);
    const methods={before:${before},after:${after}};
    const scroll=Object.getOwnPropertyDescriptor(Element.prototype,'scrollHeight');
    let reads=0;
    Object.defineProperty(area,'scrollHeight',{get(){reads++;return scroll.get.call(this);}});
    const run=name=>{
      area.removeAttribute('style'); area.value='A draft that stays unchanged during assistant status updates. '.repeat(3);
      methods[name](area); area.getBoundingClientRect(); reads=0;
      const start=performance.now();
      for(let i=0;i<40;i++) methods[name](area);
      area.getBoundingClientRect();
      return {name,elapsedMs:performance.now()-start,scrollHeightReads:reads};
    };
    run('before');run('after');const runs=[];
    for(let i=0;i<7;i++) for(const name of i%2?['after','before']:['before','after']) runs.push(run(name));
    area.removeAttribute('style'); methods.after(area);
    const snapshot=()=>({height:area.getBoundingClientRect().height,width:area.clientWidth,scrollHeight:area.scrollHeight,clientHeight:area.clientHeight});
    area.value='';const empty=snapshot();
    area.value='One line';const short=snapshot();
    area.value='Line of draft text\\n'.repeat(30);const long=snapshot();
    area.value='Draft with enough words to wrap naturally when the composer gets narrower. '.repeat(2);
    host.style.width='600px';const wide=snapshot();host.style.width='240px';const narrow=snapshot();
    area.value='Two lines\\nOf text';area.style.fontSize='12px';const smallFont=snapshot();area.style.fontSize='26px';const largeFont=snapshot();
    host.hidden=true; area.value='Updated while hidden'; host.hidden=false; const reopened=snapshot();
    area.value='';const cleared=snapshot();
    return {runs,layouts:{empty,short,long,wide,narrow,smallFont,largeFont,reopened,cleared}};
  })()`);
  const { layouts } = report;
  assert.ok(layouts.empty.height >= 38 && layouts.short.height < layouts.long.height);
  assert.ok(layouts.long.height <= 120 && layouts.long.scrollHeight > layouts.long.clientHeight);
  assert.ok(layouts.narrow.height > layouts.wide.height, "native layout follows width changes without a JS resize call");
  assert.ok(layouts.largeFont.height > layouts.smallFont.height, "font changes resize the composer");
  assert.ok(layouts.reopened.height >= 38 && layouts.cleared.height < layouts.long.height);
  for (const run of report.runs) assert.equal(run.scrollHeightReads, run.name === "before" ? 80 : 0);
  const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  report.medianMsPerUpdate = Object.fromEntries(["before","after"].map(name=>[name,median(report.runs.filter(run=>run.name===name).map(run=>run.elapsedMs/40))]));
  report.environment = {electron:process.versions.electron,platform:process.platform,updates:40,pairs:7,note:"Production composer sizing with real CSS and 1000 synthetic activity rows; excludes the rest of the app. Timing is diagnostic."};
  return report;
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith("file:") }));
  const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: {
    offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const html = path.join(fixture, "thread.html");
  fs.writeFileSync(html, '<!doctype html><html><body><div id="thread" class="assistant-thread"></div></body></html>');
  await win.loadFile(html);
  await win.webContents.insertCSS(fs.readFileSync(path.join(root, "renderer/styles.css"), "utf8") + "\n#thread{display:block;width:400px;height:400px;overflow:auto}");
  if (args.includes("--composer")) {
    const report = await profileComposer(win.webContents);
    const output = path.resolve(value("--output")); fs.mkdirSync(path.dirname(output), {recursive:true}); fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify({medianMsPerUpdate:report.medianMsPerUpdate,scrollHeightReads:report.runs.slice(0,2).map(({name,scrollHeightReads})=>({name,scrollHeightReads})),layouts:report.layouts,output}));
    win.destroy(); app.exit(0); return;
  }
  await win.webContents.executeJavaScript("window.mefiStudio={assistantMessage(){}}; void 0;");
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, "renderer/studio-ui.js"), "utf8"));
  const before = renderer(fs.readFileSync(path.resolve(value("--before")), "utf8"));
  const after = renderer(fs.readFileSync(path.join(root, "renderer/idle.js"), "utf8"));
  const report = await win.webContents.executeJavaScript(`(async () => {
    const renderers = { before: ${before}, after: ${after} };
    const container = document.getElementById('thread');
    const messages = Array.from({length:30}, (_, i) => ({id:'m'+i, role:i%2?'assistant':'user', at:i+1,
      text:'Message '+i+': '+ 'Review the implementation and check its behavior. '.repeat(8)}));
    const drain = async () => { await Promise.resolve(); await Promise.resolve(); };
    const run = async (name) => {
      const fill = renderers[name];
      container.textContent = '';
      fill(container, {messages, thinking:{text:'Starting'}});
      await drain();
      const history = Array.from(container.children).slice(0,30);
      let addedElements = 0;
      const observer = new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1) addedElements += 1 + node.querySelectorAll('*').length;
        }
      });
      observer.observe(container, {subtree:true,childList:true});
      const began = performance.now();
      for (let i=0;i<40;i++) {
        fill(container, {messages, thinking:{text:'Inspecting file '+i}});
        await drain();
      }
      const elapsedMs = performance.now()-began;
      observer.disconnect();
      return {name,elapsedMs,addedElements,retained:history.filter((row,i)=>container.children[i]===row).length,text:container.textContent};
    };
    await run('before'); await run('after');
    const runs=[];
    for(let i=0;i<7;i++) for(const name of i%2?['after','before']:['before','after']) runs.push(await run(name));
    container.textContent='';
    const fill=renderers.after;
    fill(container,{messages,thinking:{text:'Starting'}});
    const range=document.createRange(); range.selectNodeContents(container.children[4]);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    const selected=getSelection().toString();
    container.scrollTop=100;
    fill(container,{messages,thinking:{text:'A longer pending thought. '.repeat(20)}});
    const scrollRetained=container.scrollTop===100;
    const selectionRetained=getSelection().toString()===selected;
    container.scrollTop=container.scrollHeight;
    fill(container,{messages,thinking:{text:'More detail. '.repeat(100)}});
    const tailPinned=Math.abs(container.scrollTop+container.clientHeight-container.scrollHeight)<=1;
    return {runs,scrollRetained,selectionRetained,tailPinned};
  })()`);
  assert.ok(report.scrollRetained && report.selectionRetained && report.tailPinned, "scroll and text selection survive live updates");
  const expected = report.runs[0].text;
  for (const run of report.runs) {
    assert.equal(run.text, expected, "before and after render identical words");
    if (run.name === "after") { assert.equal(run.addedElements, 0); assert.equal(run.retained, 30); }
    delete run.text;
  }
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  report.medianMsPerUpdate = Object.fromEntries(["before", "after"].map(name => [name, median(report.runs.filter(run => run.name === name).map(run => run.elapsedMs / 40))]));
  report.environment = { electron: process.versions.electron, platform: process.platform, messages: 30, updates: 40, pairs: 7, note: "Isolated DOM + shared controls observer; excludes the rest of the app, IPC and canvas rendering. Timing is diagnostic, not a test threshold." };
  const output = path.resolve(value("--output"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ medianMsPerUpdate: report.medianMsPerUpdate, addedElements: report.runs.slice(0, 2).map(({ name, addedElements }) => ({ name, addedElements })), scrollRetained: report.scrollRetained, selectionRetained: report.selectionRetained, tailPinned: report.tailPinned, output }));
  win.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
