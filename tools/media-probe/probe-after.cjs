"use strict";
// The redesigned media menu, driven offscreen at 1920x1080 with a fake
// YouTube embed (widget protocol) and a stub YouTube search.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.PROBE_ROOT;
const report = { errors: [], loads: 0, steps: {} };
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
const PLAYER = fs.readFileSync(path.join(__dirname, "fake-youtube.html"), "utf8");
const THUMB = (id) => {
  const hues = [[224, 179, 106], [58, 163, 143], [29, 53, 87], [190, 90, 140], [120, 110, 230], [240, 140, 80]];
  let n = 0; for (const c of id) n = (n * 31 + c.charCodeAt(0)) % 997;
  const [a, b] = [hues[n % hues.length], hues[(n + 2) % hues.length]];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(${a})"/><stop offset="1" stop-color="rgb(${b})"/></linearGradient><radialGradient id="r" cx=".7" cy=".3" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="320" height="180" fill="url(#g)"/><rect width="320" height="180" fill="url(#r)"/><circle cx="${60 + n % 200}" cy="${40 + n % 100}" r="${20 + n % 30}" fill="#000" opacity=".18"/></svg>`;
};
app.whenReady().then(async () => {
  session.defaultSession.protocol.handle("https", request => {
    if (request.url.startsWith("https://www.youtube-nocookie.com/embed/")) { report.loads++; return new Response(PLAYER, { headers: { "content-type": "text/html; charset=utf-8" } }); }
    const thumb = /^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\//.exec(request.url);
    if (thumb) return new Response(THUMB(thumb[1]), { headers: { "content-type": "image/svg+xml" } });
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
  const capture = async name => { await sleep(420); contents.invalidate(); await sleep(140); fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG()); };
  const mouse = async (x, y, type = "mouseMove") => { contents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...(type !== "mouseMove" ? { button: "left", clickCount: 1 } : {}) }); await sleep(70); };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await sleep(1500);
  await run("window.fixtureCommands=[];window.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.probeCommand)window.fixtureCommands.push(m.probeCommand+(m.args&&m.args.length?':'+m.args.join(','):''));}catch{}});");
  await run(`window.fixtureSearches=[];window.mefiStudio={...(window.mefiStudio||{}),youtubeSearch:async(request)=>{window.fixtureSearches.push(request);await new Promise(r=>setTimeout(r,250));const page=request&&typeof request==='object'&&request.more?Number(String(request.more).slice(4)):1;const names=['Night drive synthwave mix','Lofi beats to focus to','Rainy jazz café, 2 hours','Deep house sunrise set','Ambient space drift','Piano covers for deep work','Retro game soundtrack medley','Chill guitar evening','Neon city walk 4K','Forest rain and piano','Vaporwave dreams vol. 3','Cozy coding session'];const channels=['Neon Hours','Lofi Room','Café Tunes','Sunrise Sets','Deep Field'];return {ok:true,results:Array.from({length:12},(_,i)=>({id:('v'+page+'x'+String(i).padStart(2,'0')+'abcdefgh').slice(0,11),title:names[i]+(page>1?' · page '+page:''),channel:channels[i%5],duration:(i%3?'':'1:')+(10+i)+':0'+(i%10)})),more:page<3?'page'+(page+1):null};}};`);
  await run("await window.MefiNav.go('command');");
  await sleep(1200);
  await run("window.MefiMusic.playLink('https://youtu.be/dQw4w9WgXcQ',{autoplay:true});");
  await sleep(2600);
  await run("const input=document.getElementById('music-link-url');for(const url of ['https://youtu.be/M7lc1UVf-VE','https://vimeo.com/12345678','https://example.com/queued.mp4']){input.value=url;document.getElementById('music-link-queue-add').click();}");
  await capture("after-floating.png");
  report.steps.floating = await run("const w=document.getElementById('media-window'),r=w.getBoundingClientRect(),t=w.querySelector('.media-window-toolbar').getBoundingClientRect();return {parent:w.parentElement?.id||w.parentElement?.tagName,rect:[r.x,r.y,r.width,r.height],toolbar:[t.width,t.height],playPressed:document.getElementById('media-window-play').dataset.playing};");
  // Hover the toolbar button, as the owner does.
  const button = await run("const r=document.getElementById('idle-music-toggle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};");
  await mouse(10, 500); await mouse(button.x, button.y); await sleep(750);
  report.steps.hover = await run("const d=document.getElementById('music-dropdown'),r=d.getBoundingClientRect(),w=document.getElementById('media-window'),s=document.getElementById('music-video-stage').getBoundingClientRect(),m=w.getBoundingClientRect();return {hidden:d.hidden,size:d.dataset.size,rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],dockedIn:w.parentElement?.id,stage:[s.width,s.height],player:[m.width,m.height],same:Math.abs(s.x-m.x)<1&&Math.abs(s.y-m.y)<1,title:document.querySelector('.music-now-title').textContent,kicker:document.querySelector('.music-now-kicker').textContent,seek:[document.getElementById('music-seek').value,document.getElementById('music-seek').max],loads:0};");
  await capture("after-hover.png");
  // Transport through the card: pause, seek, volume.
  await run("document.getElementById('music-play').click();"); await sleep(600);
  await run("const s=document.getElementById('music-seek');s.value='120';s.dispatchEvent(new Event('input'));s.dispatchEvent(new Event('change'));const v=document.getElementById('music-volume');v.value='40';v.dispatchEvent(new Event('input'));"); await sleep(700);
  report.steps.transport = await run("return {commands:window.fixtureCommands.slice(-8),playing:document.getElementById('music-play').dataset.playing,seek:document.getElementById('music-seek').value,volume:document.getElementById('music-volume').value,kicker:document.querySelector('.music-now-kicker').textContent};");
  await capture("after-paused.png");
  await run("document.getElementById('music-play').click();"); await sleep(400);
  // Unfold into Browse: the related list loads for the playing video.
  await run("document.getElementById('music-section-browse').click();"); await sleep(1400);
  report.steps.browse = await run("const d=document.getElementById('music-dropdown'),r=d.getBoundingClientRect(),w=document.getElementById('media-window');return {size:d.dataset.size,section:d.dataset.section,rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],cards:document.querySelectorAll('.music-youtube-result').length,searches:window.fixtureSearches,dockedIn:w.parentElement?.id,feedTitle:document.querySelector('.music-feed-head h3').textContent,note:document.querySelector('.music-feed-note').textContent};");
  await capture("after-browse.png");
  // Endless scroll: the deck's end loads the next page.
  await run("const deck=document.getElementById('music-deck');deck.scrollTop=deck.scrollHeight;"); await sleep(1400);
  await run("const deck=document.getElementById('music-deck');deck.scrollTop=deck.scrollHeight;"); await sleep(1400);
  report.steps.scrolled = await run("return {cards:document.querySelectorAll('.music-youtube-result').length,searches:window.fixtureSearches.length};");
  await run("document.getElementById('music-deck').scrollTop=0;"); await sleep(300);
  // Click a card while a video plays: it lines up in Up next.
  await run("document.querySelectorAll('.music-youtube-result')[2].querySelector('.music-yt-copy').click();"); await sleep(300);
  // Drag a card onto the top of Up next.
  report.steps.drop = await run(`
    const card=document.querySelectorAll('.music-youtube-result')[5];
    const box=document.querySelector('.music-link-queue');const first=document.querySelector('.music-link-queue-item');const r=first.getBoundingClientRect();
    const dt=new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    box.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.x+20,clientY:r.y+2}));
    const marked=first.dataset.drop;
    box.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.x+20,clientY:r.y+2}));
    card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
    const saved=JSON.parse(localStorage.getItem('mefiStudio.mediaQueue.v1'));
    return {marked,order:saved.map(i=>i.title),cardState:[...document.querySelectorAll('.music-youtube-result')].slice(0,6).map(c=>c.dataset.state||'')};`);
  await sleep(500);
  await capture("after-queued.png");
  // Reorder by dragging the last row to the top.
  report.steps.reorder = await run(`
    const rows=[...document.querySelectorAll('.music-link-queue-item')];const last=rows.at(-1);const box=document.querySelector('.music-link-queue');const r=rows[0].getBoundingClientRect();
    const dt=new DataTransfer();
    last.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
    box.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.x+20,clientY:r.y+2}));
    box.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.x+20,clientY:r.y+2}));
    last.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
    return JSON.parse(localStorage.getItem('mefiStudio.mediaQueue.v1')).map(i=>i.title);`);
  // The other sections.
  for (const section of ["picture", "tree", "more"]) {
    await run(`document.getElementById('music-section-${section}').click();`); await sleep(700);
    await capture(`after-${section}.png`);
  }
  // Fold back, then scroll a short window's card with the video in it.
  await run("document.getElementById('music-dropdown-expand').click();"); await sleep(700);
  report.steps.folded = await run("const d=document.getElementById('music-dropdown'),r=d.getBoundingClientRect();return {size:d.dataset.size,rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],dockedIn:document.getElementById('media-window').parentElement?.id};");
  window.setSize(1920, 640); await sleep(700);
  report.steps.shortScroll = await run(`
    const body=document.querySelector('.music-dropdown-body'),stage=document.getElementById('music-video-stage'),w=document.getElementById('media-window');
    const samples=[];for(let i=0;i<12;i++){body.scrollTop=i*18;await new Promise(r=>requestAnimationFrame(r));const s=stage.getBoundingClientRect(),m=w.getBoundingClientRect();samples.push(Math.round((m.top-s.top)*10)/10);}
    return {scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,samples};`);
  await run("document.querySelector('.music-dropdown-body').scrollTop=90;"); await sleep(200);
  await capture("after-short-scrolled.png");
  window.setSize(1920, 1080); await sleep(500);
  // Close: the player floats again, with its own transport.
  await run("window.MefiMusic.closeAudio();"); await sleep(600);
  report.steps.closed = await run("const w=document.getElementById('media-window');return {parent:w.parentElement?.tagName,docked:w.dataset.docked,toolbarHidden:w.querySelector('.media-window-toolbar').hidden};");
  await mouse(1500, 900); await sleep(300);
  await capture("after-floating-closed.png");
  // Other sources in the card.
  await run("window.MefiMusic.setSource('radio');window.MefiMusic.openAudio(document.getElementById('idle-music-toggle'));"); await sleep(700);
  await capture("after-radio.png");
  await run("window.MefiMusic.closeAudio();window.MefiMusic.setSource('local');window.MefiMusic.openAudio(document.getElementById('idle-music-toggle'));"); await sleep(700);
  await capture("after-local.png");
  await run("window.MefiMusic.closeAudio();");
  report.loads = report.loads;
  finish();
}).catch(finish);
