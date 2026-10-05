"use strict";
// Full renderer, isolated profile, no application host or real provider traffic.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_MEDIA_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated media fixture directory is required");
const report = { errors: [], networkAttempts: [], playerLoads: 0, layouts: [] };
for (const key of ["userData", "sessionData", "crashDumps"]) { const directory = path.join(root, key); fs.mkdirSync(directory); app.setPath(key, directory); }
app.setName("Studio Media Fixture"); app.disableHardwareAcceleration();
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
// The official embed, answered locally: a picture, a settings menu with one button that
// reports back to Studio, and the part of YouTube's widget protocol Studio's transport
// uses. It says "listening" back with the state it holds (title, length, level), obeys
// playVideo, pauseVideo, seekTo, setVolume, mute and unMute, and tells the page which
// command it received, so a click on the card can be followed all the way to the frame.
const EMBED_HTML = `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 70% 20%,#afccb2,transparent 45%),linear-gradient(165deg,#506e91 35%,#68887f 36%,#193635 70%,#142426);color:white;font:16px system-ui"><div style="text-align:center;text-shadow:0 2px 10px #000"><div style="font-size:36px">▶</div>Media preview<div style="font-size:11px;margin-top:10px">Isolated playback fixture</div></div><button id="settings" style="position:absolute;bottom:8px;right:8px;width:36px;height:30px" onclick="document.getElementById('menu').hidden=false">⚙</button><div id="menu" hidden style="position:absolute;bottom:44px;right:8px;background:#222;padding:12px;width:170px;height:110px"><button style="width:100%;height:40px" onclick="parent.postMessage('fixture-quality-clicked','*')">Quality · 1080p</button></div><script>
const s = { t: 0, d: 225, playing: false, vol: 100, muted: false, listening: false };
const info = () => ({ currentTime: s.t, duration: s.d, playerState: s.playing ? 1 : 2, volume: s.vol, muted: s.muted, videoData: { video_id: location.pathname.split('/').pop().slice(0, 11), title: 'Fixture night drive', author: 'Fixture channel' } });
const send = (event, extra) => parent.postMessage(JSON.stringify(Object.assign({ event, id: 'studio-media', channel: 'widget' }, extra)), '*');
addEventListener('message', (e) => {
  let m; try { m = JSON.parse(e.data); } catch (error) { return; }
  if (m.event === 'listening') { if (!s.listening) { s.listening = true; send('initialDelivery', { info: info() }); send('onReady', {}); } return; }
  if (m.event !== 'command') return;
  parent.postMessage(JSON.stringify({ probeCommand: m.func, args: m.args }), '*');
  if (m.func === 'playVideo') s.playing = true;
  if (m.func === 'pauseVideo') s.playing = false;
  if (m.func === 'seekTo') s.t = Math.max(0, Math.min(s.d, Number(m.args[0]) || 0));
  if (m.func === 'setVolume') s.vol = Math.max(0, Math.min(100, Number(m.args[0]) || 0));
  if (m.func === 'mute') s.muted = true;
  if (m.func === 'unMute') s.muted = false;
  if (s.listening) send('infoDelivery', { info: info() });
});
setInterval(() => { if (s.playing) s.t = Math.min(s.d, s.t + 0.25); if (s.listening) send('infoDelivery', { info: info() }); }, 250);
</script></body></html>`;
// A YouTube thumbnail, answered locally: the card asks for one while a video is not in its stage.
const THUMBNAIL = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#3a6a8a"/></svg>';
const EMBED = "https://www.youtube-nocookie.com/embed/", THUMBNAILS = /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/mqdefault\.jpg$/;
app.whenReady().then(async () => {
  // Answer the actual official embed URL locally. Reloads increment this
  // counter, so an unchanged iframe node alone cannot conceal playback resets.
  session.defaultSession.protocol.handle("https", request => {
    if (request.url.startsWith(EMBED)) {
      report.playerLoads++;
      return new Response(EMBED_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (THUMBNAILS.test(request.url)) { report.thumbnails = (report.thumbnails || 0) + 1; return new Response(THUMBNAIL, { headers: { "content-type": "image/svg+xml" } }); }
    return new Response("Fixture blocks external requests", { status: 403 });
  });
  // Everything else is refused, and noted: the run ends by asserting nothing else was tried.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url) || details.url.startsWith(EMBED) || THUMBNAILS.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = code => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const rect = () => run("const r=document.getElementById('media-window').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};");
  const mouse = async (x, y, type = "mouseMove") => { contents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...(type !== "mouseMove" ? { button: "left", clickCount: 1 } : {}) }); await sleep(70); };
  const click = async id => {
    const look = () => run(`const n=document.getElementById(${JSON.stringify(id)}),r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,clear:r.width>0&&r.height>0&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};`);
    // A player that is still gliding (it steps aside with a short transition) is not a target yet: look
    // again a few frames later until two looks agree, then click where it is.
    let point = await look();
    for (let tries = 0; tries < 20; tries++) {
      await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));");
      const again = await look(); const still = again.x === point.x && again.y === point.y; point = again;
      if (still) break;
    }
    assert.ok(point.clear, `${id} is visibly reachable: ${JSON.stringify(point)}`);
    await mouse(point.x, point.y); await mouse(point.x, point.y, "mouseDown"); await mouse(point.x, point.y, "mouseUp");
  };
  const capture = async name => { await sleep(220); fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG()); };
  // Polls a page expression (code that returns) until it is truthy, instead of trusting a fixed delay.
  const until = async (code, label, limit = 10000) => {
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) { if (await run(code)) return; await sleep(100); }
    throw new Error(`Timed out waiting for ${label}`);
  };
  // The floating player's bar holds a transport (Previous, Play, Next, Mute and a volume) and the window's
  // own Settings, Minimize and Close. A button is "shown" unless it, or something above it, is hidden or
  // display:none (a narrow bar leaves the volume to the menu); every shown one must be the topmost thing at
  // its own centre, and Close, Minimize and Settings must always be among them.
  const layout = async () => {
    const result = await run(`
      const root=document.getElementById('media-window'),r=root.getBoundingClientRect(),c=document.querySelector('.media-window-toolbar'),b=c.getBoundingClientRect(),f=window.fixtureMedia.getBoundingClientRect();
      const shown=[...c.querySelectorAll('button')].filter(n=>getComputedStyle(n).display!=='none'&&!n.closest('[hidden]'));
      const unreachable=shown.filter(n=>{const t=n.getBoundingClientRect();return !(t.width>0&&t.height>0&&n.contains(document.elementFromPoint(t.x+t.width/2,t.y+t.height/2)));}).map(n=>n.id);
      const points=[[f.left+1,f.top+1],[f.right-1,f.bottom-1],[f.right-30,f.bottom-55]];
      return {width:innerWidth,narrow:root.dataset.narrow,contained:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,shown:shown.map(n=>n.id),unreachable,
        essentials:['media-window-move','media-window-previous','media-window-play','media-window-next','media-window-settings','media-window-minimize','media-window-close'].every(id=>shown.some(n=>n.id===id)),
        controlsFit:c.parentElement===root&&b.left>=r.left&&b.right<=r.right&&b.bottom<=f.top+1&&unreachable.length===0,
        hits:points.map(([x,y])=>document.elementFromPoint(x,y)?.outerHTML?.slice(0,160)),providerClear:points.every(([x,y])=>document.elementFromPoint(x,y)===window.fixtureMedia)};`);
    report.layouts.push(result); assert.ok(result.contained && result.essentials && result.controlsFit && result.providerClear, JSON.stringify(result));
  };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  // Studio shows a one-time key tip after 30 quiet seconds, and this run is long enough to meet it on top of
  // a control that is being measured: mark it seen and load again, so it never comes.
  await run("localStorage.setItem('mefiStudio.keyHint.v1','1');");
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  // Studio's little companion roams to a random edge spot every few seconds, and when it looks for a clear
  // place it ignores frames, so it can settle on the player's corner. It is not what this fixture
  // measures: it stays out of the way, so a run does not depend on where it happens to be. Its panel goes
  // too: a hidden orb measures at 0,0, so the run's pointer in the top-left corner reads as a hover on it,
  // and in the 0.5 frame the panel then opens in the free area, over the player.
  await run("const style=document.createElement('style');style.textContent='.companion-orb,.companion-bubble,.companion-panel{display:none!important}';document.head.append(style);");
  await run("window.MefiNav.go('studio',{category:'audio'});window.MefiMusic.playLink('https://youtu.be/dQw4w9WgXcQ',{autoplay:false});window.fixtureMedia=window.MefiMusic.linkElement().element;");
  // What the embed reports having been told, as "command:args", so a click in Studio can be followed to the frame.
  await run("window.fixtureCommands=[];window.addEventListener('message',event=>{if(event.source!==window.fixtureMedia.contentWindow)return;try{const message=JSON.parse(event.data);if(message.probeCommand)window.fixtureCommands.push([message.probeCommand,...(message.args||[])].join(':'));}catch{}});");
  await sleep(4500);
  report.borderless = await run("const w=document.getElementById('media-window');return w.parentElement===document.body&&!w.hidden&&getComputedStyle(w).borderTopWidth==='0px'&&getComputedStyle(document.querySelector('.media-window-controls')).opacity==='1'&&w.contains(window.fixtureMedia);");
  assert.ok(report.borderless, "player is a borderless body surface with window controls");
  // A loaded link is shown no picture while the menu is closed: it has asked YouTube's image host for nothing
  // (this is the request tests/unified_studio_render.test.mjs once caught). The stub only counts what is asked.
  assert.equal(report.thumbnails || 0, 0, "a loaded link asks for no picture until the menu opens");
  await layout(); await capture("media-window-rest.png");
  await run("document.body.classList.add('command-zen');");
  assert.equal(await run("return getComputedStyle(document.querySelector('.media-window-toolbar')).visibility==='hidden'&&getComputedStyle(window.fixtureMedia).visibility==='visible';"), true, "Zen hides floating window controls while preserving playback");
  await run("document.body.classList.remove('command-zen');");
  let before = await rect(); await mouse(before.x + 50, before.y + 80);
  // The controls fade in; a loaded run sampled them mid-fade after a fixed wait, so wait for the settled value.
  const hoverDeadline = Date.now() + 3000;
  while (!(report.hover = await run("return getComputedStyle(document.querySelector('.media-window-controls')).opacity==='1';")) && Date.now() < hoverDeadline) await sleep(50);
  assert.ok(report.hover, "hovering the player shows its controls within 3 s");
  await capture("media-window-hover.png");
  await run("window.fixtureQuality=0;window.addEventListener('message',event=>{if(event.source===window.fixtureMedia.contentWindow&&event.data==='fixture-quality-clicked')window.fixtureQuality++;});");
  let embedded;
  const providerDeadline = Date.now() + 10000;
  while (!(embedded = contents.mainFrame.frames.find(frame => frame.url.startsWith("https://www.youtube-nocookie.com/embed/"))) && Date.now() < providerDeadline) await sleep(100);
  assert.ok(embedded, "the isolated provider frame is ready");
  // Hit-test through the parent first (layout() checks the actual iframe at its
  // corners and settings area). Exercise the mock menu inside its own frame;
  // offscreen synthetic mouse input does not reach this cross-origin frame.
  await embedded.executeJavaScript("document.getElementById('settings').click()");
  assert.equal(await embedded.executeJavaScript("document.getElementById('menu').hidden"), false);
  await capture("media-window-provider-settings.png");
  await embedded.executeJavaScript("document.querySelector('#menu button').click()");
  await sleep(100);
  assert.equal(await run("return window.fixtureQuality;"), 1, "provider settings menu remains usable");
  await run("document.querySelectorAll('#toast-host .toast-dismiss').forEach(button=>button.click());window.MefiMusic.closeAudio();"); await sleep(450);
  const handle = await run("const n=document.getElementById('media-window-move'),r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,400)};");
  await mouse(handle.x, handle.y); await mouse(handle.x, handle.y, "mouseDown"); await mouse(handle.x - 160, handle.y - 100); await mouse(handle.x - 160, handle.y - 100, "mouseUp");
  let after = await rect(); report.drag = Math.abs(after.x - (before.x - 160)) < 2 && Math.abs(after.y - (before.y - 100)) < 2; assert.ok(report.drag, JSON.stringify({ before, after, handle }));
  await run("window.MefiMusic.closeAudio();");
  before = after;
  await mouse(before.x + before.width - 5, before.y + before.height - 5); await mouse(before.x + before.width - 5, before.y + before.height - 5, "mouseDown");
  await mouse(before.x + before.width + 59, before.y + before.height + 31); await mouse(before.x + before.width + 59, before.y + before.height + 31, "mouseUp");
  after = await rect(); report.resize = Math.abs(after.width - before.width - 64) < 2 && Math.abs(after.height - before.height - 36) < 2; assert.ok(report.resize, JSON.stringify({ before, after }));
  await click("media-window-minimize");
  report.minimize = await run("const root=document.getElementById('media-window'),r=root.getBoundingClientRect(),button=document.getElementById('media-window-minimize'),b=button.getBoundingClientRect();return r.height>=44&&r.height<=64&&root.dataset.minimized==='true'&&root.contains(button)&&button.getAttribute('aria-label')==='Restore media'&&button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2))&&document.querySelector('.music-link-player').inert&&document.getElementById('music-dropdown').hidden;");
  assert.ok(report.minimize, "minimized player retains its restore button without opening a menu");
  await capture("media-window-minimized.png");
  await click("media-window-minimize");
  report.restored = await run("return document.getElementById('media-window').dataset.minimized==='false'&&!document.querySelector('.music-link-player').inert&&window.fixtureMedia===window.MefiMusic.linkElement().element;");
  assert.ok(report.restored);
  await run("window.MefiNav.go('workspace');");
  assert.equal(await run("return window.fixtureMedia===window.MefiMusic.linkElement().element&&!document.getElementById('media-window').hidden;"), true);
  await run("window.MefiNav.go('studio',{category:'general'});document.activeElement.blur();document.documentElement.dataset.motion='on';");
  await mouse(10, 10); await sleep(1850); before = await rect();
  await run(`document.dispatchEvent(new PointerEvent('pointermove',{clientX:${before.x - 40},clientY:${before.y + 70},pointerType:'mouse'}));`);
  await sleep(260);
  report.stillByDefault = JSON.stringify(await rect()) === JSON.stringify(before) && await run("return document.getElementById('media-window-avoid').getAttribute('aria-pressed')==='false';");
  assert.ok(report.stillByDefault, "approaching the player leaves it still until Move aside is explicitly enabled");
  await run("document.getElementById('media-window-avoid').click();document.activeElement.blur();");
  await run(`document.dispatchEvent(new PointerEvent('pointermove',{clientX:0,clientY:0,pointerType:'mouse'}));document.dispatchEvent(new PointerEvent('pointermove',{clientX:${before.x - 40},clientY:${before.y + 70},pointerType:'mouse'}));`);
  await sleep(260);
  // Wait for the dodge to finish before testing a second pointer approach.
  // A busy compositor can start the CSS transition after the fixed delay.
  await run("await Promise.all(document.getElementById('media-window').getAnimations().map(animation=>animation.finished.catch(()=>{})));");
  after = await rect(); report.dodge = after.x !== before.x || after.y !== before.y; assert.ok(report.dodge, JSON.stringify({ before, after }));
  await run(`document.dispatchEvent(new PointerEvent('pointermove',{clientX:${after.x + after.width + 40},clientY:${after.y + 70},pointerType:'mouse'}));`);
  report.follow = JSON.stringify(await rect()) === JSON.stringify(after); assert.ok(report.follow);
  await run("document.getElementById('media-window-pin').click();document.activeElement.blur();");
  await run("await Promise.all(document.getElementById('media-window').getAnimations().map(animation=>animation.finished.catch(()=>{})));");
  after = await rect();
  await mouse(10, 10); await sleep(2600);
  await run(`document.dispatchEvent(new PointerEvent('pointermove',{clientX:0,clientY:0,pointerType:'mouse'}));document.dispatchEvent(new PointerEvent('pointermove',{clientX:${after.x - 40},clientY:${after.y + 70},pointerType:'mouse'}));`);
  report.pin = JSON.stringify(await rect()) === JSON.stringify(after); assert.ok(report.pin);
  await run("document.querySelectorAll('#toast-host .toast-dismiss').forEach(button=>button.click());");
  window.setSize(600, 560); await sleep(400); await layout();
  const compact = await rect(); await mouse(compact.x + 50, compact.y + 75); await capture("media-window-compact.png");
  assert.equal(await run("return window.fixtureMedia===window.MefiMusic.linkElement().element;"), true);
  assert.equal(report.playerLoads, 1);
  await run("document.documentElement.dataset.motion='off';document.getElementById('media-window-background').click();const slider=document.getElementById('media-window-transparency');slider.value='60';slider.dispatchEvent(new Event('input'));window.MefiNav.go('workspace');");
  await sleep(850);
  report.background = await run("const content=document.querySelector('.music-link-player'), controls=document.querySelector('.media-window-controls'), r=controls.getBoundingClientRect();return document.getElementById('music-dropdown').hidden&&content.inert&&getComputedStyle(content).pointerEvents==='none'&&getComputedStyle(content).opacity==='0.4'&&document.body.dataset.mediaBackground==='true'&&r.right<=innerWidth&&r.bottom<=innerHeight&&window.fixtureMedia===window.MefiMusic.linkElement().element;");
  assert.ok(report.background); await capture("media-window-background.png");
  await run("await window.MefiNav.go('studio',{category:'general'});"); await sleep(300);
  const menuPoint = await run("const n=document.querySelector('[data-settings-category=audio]');n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,180),clear:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};");
  report.menuPoint = menuPoint;
  await capture("media-window-settings-menu.png");
  assert.ok(menuPoint.clear, "background media leaves menu buttons reachable");
  await mouse(menuPoint.x, menuPoint.y); await mouse(menuPoint.x, menuPoint.y, "mouseDown"); await mouse(menuPoint.x, menuPoint.y, "mouseUp");
  assert.equal(await run("return document.getElementById('settings-category-audio').hidden;"), false);
  await run("window.MefiMusic.openAudio();"); await sleep(300);
  report.menus = await run("const menu=document.getElementById('music-dropdown');return !menu.hidden&&getComputedStyle(menu).opacity==='1'&&getComputedStyle(document.querySelector('.media-window-controls')).opacity==='1';");
  assert.ok(report.menus); await capture("media-window-background-menu.png");
  // The card's one slider (0 to 100) and mute button set the video's level, saved apart from the music
  // level; the floating bar's own mute follows it.
  await run("const volume=document.getElementById('music-volume');volume.value='35';volume.dispatchEvent(new Event('input'));document.getElementById('music-mute').click();");
  assert.equal(await run("const saved=JSON.parse(localStorage.getItem('mefiStudio.mediaVolume.v1'));return saved.volume===.35&&saved.muted===true&&document.getElementById('music-mute').getAttribute('aria-pressed')==='true'&&document.getElementById('media-window-mute').getAttribute('aria-pressed')==='true';"), true);
  await capture("media-window-volume-settings.png");
  // Up next belongs to the unfolded card: open Browse, add three links (the box empties after each),
  // move one to the front and remove another.
  await run("window.MefiMusic.openSection('browse');const input=document.getElementById('music-link-url');for(const url of ['https://vimeo.com/12345678','https://example.com/queued.mp4','https://youtu.be/M7lc1UVf-VE']){input.value=url;document.getElementById('music-link-queue-add').click();}const list=document.getElementById('music-link-queue-list');list.children[2].querySelectorAll('button')[1].click();list.children[1].querySelectorAll('button')[2].click();list.scrollIntoView({block:'center'});");
  report.queue = await run("const list=document.getElementById('music-link-queue-list'),saved=JSON.parse(localStorage.getItem('mefiStudio.mediaQueue.v1'));return list.children.length===2&&saved[0].url.includes('M7lc1UVf-VE')&&saved[1].url.includes('queued.mp4')&&list.scrollWidth<=list.clientWidth+1&&window.fixtureMedia===window.MefiMusic.linkElement().element;");
  assert.ok(report.queue, "queue controls work at narrow width without replacing playback");
  await capture("media-window-queue.png");
  await run("window.MefiMusic.closeAudio();");
  for (const value of [0, 90]) {
    await run(`const slider=document.getElementById('media-window-transparency');slider.value='${value}';slider.dispatchEvent(new Event('input'));`);
    await sleep(800);
    assert.ok(Math.abs(Number(await run("return getComputedStyle(document.querySelector('.music-link-player')).opacity;")) - (1 - value / 100)) < .01);
  }
  window.setSize(1440, 900);
  await run("await window.MefiNav.go('command');"); await sleep(500);
  report.tree = await run("const near=document.getElementById('idle-layer'),far=document.getElementById('idle-layer-far');return getComputedStyle(near).opacity==='1'&&getComputedStyle(far).opacity==='1'&&window.MefiIdle.canvasContext(far).getContextAttributes().alpha===true&&getComputedStyle(document.querySelector('main')).visibility==='hidden';");
  assert.ok(report.tree, "tree stays fully opaque above the video and inactive pages stay hidden");
  await run("const video=document.getElementById('media-window-transparency');video.value='0';video.dispatchEvent(new Event('input'));const tree=document.getElementById('media-window-tree-transparency');tree.value='40';tree.dispatchEvent(new Event('input'));const brightness=document.getElementById('media-window-brightness');brightness.value='125';brightness.dispatchEvent(new Event('input'));");
  await run("await Promise.all([document.querySelector('.music-link-player'),document.getElementById('idle-layer')].flatMap(node=>node.getAnimations()).map(animation=>animation.finished.catch(()=>{})));");
  report.visibilitySliders = await run("return {tree:getComputedStyle(document.getElementById('idle-layer')).opacity,video:getComputedStyle(document.querySelector('.music-link-player')).opacity,brightness:getComputedStyle(document.querySelector('.music-link-player')).filter,visible:document.body.dataset.mediaVisible,variable:document.body.style.getPropertyValue('--media-tree-opacity')};");
  assert.ok(Math.abs(Number(report.visibilitySliders.tree)-.6)<.01&&Math.abs(Number(report.visibilitySliders.video)-1)<.01&&report.visibilitySliders.brightness==='brightness(1.25)', `tree opacity and video opacity/brightness change independently: ${JSON.stringify(report.visibilitySliders)}`);
  await run("for(const [id,value] of [['media-window-tree-transparency','0'],['media-window-brightness','100']]){const slider=document.getElementById(id);slider.value=value;slider.dispatchEvent(new Event('input'));}");
  await run("await Promise.all([document.getElementById('idle-layer'),document.getElementById('idle-layer-far')].flatMap(node=>node.getAnimations()).map(animation=>animation.finished.catch(()=>{})));");
  assert.equal(await run("const holder=document.createElement('div');holder.hidden=true;const page=document.createElement('section');page.className='workspace-page';holder.append(page);document.body.append(holder);const bright=getComputedStyle(document.getElementById('idle-layer')).opacity==='1'&&getComputedStyle(document.getElementById('idle-layer-far')).opacity==='1'&&getComputedStyle(document.querySelector('.music-link-player')).filter==='brightness(1)';holder.remove();return bright;"), true, "inactive workspace pages cannot dim the tree at zero transparency");
  await capture("media-window-background-tree.png");
  await run("document.getElementById('media-window-background').click();");
  // The 0.5 frame has no Command toolbar (its music button went with it); the button that opens the card on a
  // hover is Settings › Sound and music's "Open music & video".
  await run("await window.MefiNav.go('studio',{category:'audio'});"); await sleep(300);
  await mouse(10, 10);
  const mediaButton = await run("window.fixtureHoverFocus=document.activeElement;const n=document.getElementById('settings-audio-open');n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};");
  await mouse(mediaButton.x, mediaButton.y);
  // Hover opens the menu after a short delay; a busy box can take longer than a fixed wait, so wait for it.
  await until("return !document.getElementById('music-dropdown').hidden;", "a native hover to open the mini player");
  assert.equal(await run("const menu=document.getElementById('music-dropdown');return !menu.hidden&&menu.dataset.source==='link'&&menu.dataset.size==='compact'&&document.activeElement===window.fixtureHoverFocus;"), true, "native hover opens the mini player on the current video, folded, without moving keyboard focus");
  // Every visit starts at the top of the card with the video docked in its stage (carried there, not
  // reloaded), so nothing needs scrolling into view, however far the card was scrolled last time.
  report.hoverPlayer = await run("const body=document.querySelector('.music-dropdown-body'),stage=document.getElementById('music-video-stage'),r=stage.getBoundingClientRect(),menu=document.getElementById('music-dropdown').getBoundingClientRect(),frame=window.fixtureMedia.getBoundingClientRect();return body.scrollTop===0&&r.top>menu.top+45&&r.bottom<=innerHeight&&document.getElementById('media-window').dataset.docked==='true'&&document.elementFromPoint(frame.x+frame.width/2,frame.y+frame.height/2)===window.fixtureMedia;");
  assert.ok(report.hoverPlayer, "hover opens at the top of the card with the player docked in view");
  const playerPoint = await run("const r=window.fixtureMedia.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};");
  await mouse(playerPoint.x, playerPoint.y); await sleep(550);
  assert.equal(await run("return document.getElementById('music-dropdown').hidden;"), false, "entering the docked provider frame keeps its controls open");
  const dropdownPoint = await run("const r=document.getElementById('music-dropdown').getBoundingClientRect();return {x:r.x+60,y:r.y+24};");
  await mouse(dropdownPoint.x, dropdownPoint.y); await sleep(550);
  assert.equal(await run("return document.getElementById('music-dropdown').hidden;"), false, "crossing into the dropdown cancels hover dismissal");
  await capture("media-hover-dropdown.png");
  await mouse(10, 10); await sleep(550);
  assert.equal(await run("return document.getElementById('music-dropdown').hidden;"), false, "using the provider keeps its menu open until dismissed");
  await click("music-dropdown-close");
  await mouse(10, 10); await mouse(mediaButton.x, mediaButton.y);
  await until("return !document.getElementById('music-dropdown').hidden;", "a second native hover to open the menu");
  await mouse(10, 10);
  await until("return document.getElementById('music-dropdown').hidden;", "leaving an untouched hover to dismiss it");
  assert.equal(await run("return document.getElementById('music-dropdown').hidden;"), true, "leaving an untouched hover dismisses it");
  await mouse(mediaButton.x, mediaButton.y);
  await until("return !document.getElementById('music-dropdown').hidden;", "a third native hover to open the menu");
  // The card eases open over a moment: measure once it has finished rather than after a guessed delay.
  await run("await Promise.all(document.getElementById('music-dropdown').getAnimations().map(animation=>animation.finished.catch(()=>{})));");
  const volumePoint = await run("const input=document.getElementById('music-volume'),r=input.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,clear:input===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)};");
  assert.ok(volumePoint.clear, `hover exposes the card's volume slider without scrolling: ${JSON.stringify(volumePoint)}`);
  await mouse(volumePoint.x, volumePoint.y); await mouse(volumePoint.x, volumePoint.y, "mouseDown");
  await mouse(10, 10); await sleep(550);
  report.hoverDropdown = await run("return !document.getElementById('music-dropdown').hidden&&window.fixtureMedia===window.MefiMusic.linkElement().element;");
  assert.ok(report.hoverDropdown, "adjusting a slider holds the menu open even when the pointer leaves");
  await mouse(10, 10, "mouseUp");
  // An offscreen window cannot own desktop focus. Model focus only for this
  // local clipboard stub; host tests separately prove the real focus boundary.
  await run("window.MefiMusic.closeAudio();Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});window.mefiStudio={...window.mefiStudio,mediaClipboardLink:async()=>({ok:true,url:'https://example.com/copied.mp4'})};window.MefiMusic.openAudio();");
  await sleep(250);
  report.clipboardOffer = await run("const offer=document.getElementById('music-clipboard-offer');document.getElementById('music-show-links').click();return !offer.hidden&&getComputedStyle(offer.querySelector('small')).display==='none'&&document.getElementById('music-link-url').type==='password'&&document.getElementById('music-show-links').getAttribute('aria-pressed')==='false'&&window.fixtureMedia===window.MefiMusic.linkElement().element;");
  assert.ok(report.clipboardOffer, "copied-link offers and hidden URLs leave current playback intact");
  await capture("media-clipboard-hidden-links.png");
  await run("document.getElementById('music-clipboard-next').click();");
  assert.equal(await run("return JSON.parse(localStorage.getItem('mefiStudio.mediaQueue.v1'))[0].url==='https://example.com/copied.mp4'&&document.getElementById('music-clipboard-offer').hidden;"), true);
  await run("delete document.hasFocus;");
  await run("window.MefiMusic.closeAudio();");
  await run("document.getElementById('media-window-background').click();");
  await run("document.body.classList.add('command-zen');");
  report.zen = await run("return getComputedStyle(document.querySelector('.media-window-controls')).visibility==='hidden'&&getComputedStyle(document.querySelector('.music-link-player')).visibility==='visible';");
  assert.ok(report.zen, "Zen keeps the video and hides its controls");
  await run("document.body.classList.remove('command-zen');");
  // Exercise the shared tree controls in the real menu at both viewport sizes.
  for (const width of [1440, 600]) {
    window.setSize(width, width === 600 ? 650 : 900); await sleep(250);
    // The menu eases open over 280 ms; scroll a control into view only once it has settled.
    await run("window.MefiMusic.openSection('tree');"); await sleep(450);
    await run("document.getElementById('music-audio-reactions').open=true;document.getElementById('audio-tree-mode').closest('details').open=true;const mode=document.getElementById('audio-tree-mode');mode.value='hybrid';mode.dispatchEvent(new Event('change'));const shape=document.getElementById('audio-tree-shape');shape.value='ring';shape.dispatchEvent(new Event('change'));document.getElementById('audio-tree-mode-choice').scrollIntoView({block:'center'});");
    await sleep(250);
    await capture(`tree-dynamics-controls-${width}.png`);
    const treeControls = await run("const input=document.getElementById('audio-tree-mode'),button=document.getElementById('audio-tree-mode-choice'),r=button.getBoundingClientRect(),panel=input.closest('details');return {mode:input.value,shared:document.getElementById('appearance-tree-mode').value,width:panel.clientWidth,scroll:panel.scrollWidth,rect:{x:r.x,y:r.y,w:r.width,h:r.height},hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,400),clear:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};");
    assert.ok(treeControls.mode==='hybrid'&&treeControls.shared==='hybrid'&&treeControls.scroll<=treeControls.width+1&&treeControls.clear, `tree modes are synchronized and reachable at ${width}px: ${JSON.stringify(treeControls)}`);
    await run("window.MefiMusic.closeAudio();");
  }
  // The tree's visibility switches ride with the player's picture settings, in the Picture section.
  await run("window.MefiMusic.openSection('picture');"); await sleep(450);
  await run("const brightness=document.getElementById('media-tree-nodeBrightness');brightness.closest('details').open=true;brightness.value='1.5';brightness.dispatchEvent(new Event('input'));const lines=document.getElementById('media-tree-lineBrightness');lines.value='.5';lines.dispatchEvent(new Event('input'));const outlines=document.getElementById('media-tree-outlines');outlines.checked=true;outlines.dispatchEvent(new Event('change'));brightness.scrollIntoView({block:'center'});");
  await sleep(250);
  assert.equal(await run("const input=document.getElementById('media-tree-nodeBrightness'),r=input.getBoundingClientRect(),panel=input.closest('details');return document.getElementById('appearance-tree-nodeBrightness').value==='1.5'&&document.getElementById('audio-tree-lineBrightness').value==='0.5'&&window.MefiTreeDynamics.preferences().outlines&&panel.scrollWidth<=panel.clientWidth+1&&input===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)&&window.fixtureMedia===window.MefiMusic.linkElement().element;"), true, "brightness and outline controls synchronize across menus and remain reachable at 600px without reloading playback");
  await capture("media-tree-brightness-controls.png");
  await run("window.MefiMusic.closeAudio();");
  await run("window.MefiTreeDynamics.update({mode:'music',shape:'layout'});");
  await run("document.getElementById('media-window-background').click();");
  assert.equal(await run("return document.querySelector('.music-link-player').inert;"), false);
  assert.equal(report.playerLoads, 1);
  // The card's transport, end to end. The embed's own report names the video and gives its length; a click
  // on Play, a drag on the bar and the volume slider each arrive at the real, cross-origin frame as the
  // command YouTube's widget expects, and the card follows what the frame then reports.
  window.setSize(1440, 900); await sleep(250);
  await run("window.fixtureCommands.length=0;window.MefiMusic.openAudio();");
  await until("return document.querySelector('.music-now-title').textContent==='Fixture night drive'&&document.getElementById('music-seek').max==='225'&&document.getElementById('media-window').dataset.docked==='true';", "the embed to name the video and give its length, with the player docked in the card");
  assert.deepEqual(await run("return [document.querySelector('.music-now-detail').textContent,document.querySelector('.music-now-kicker').textContent,document.getElementById('music-play').dataset.playing];"), ["Fixture channel · YouTube", "Paused", "false"]);
  await run("document.getElementById('music-play').click();");
  await until("return window.fixtureCommands.includes('playVideo')&&document.getElementById('music-play').dataset.playing==='true'&&document.querySelector('.music-now-kicker').textContent==='Now playing';", "Play to reach the embed and the card to show it playing");
  await run("const seek=document.getElementById('music-seek');seek.value='120';seek.dispatchEvent(new Event('input'));seek.dispatchEvent(new Event('change'));const volume=document.getElementById('music-volume');volume.value='40';volume.dispatchEvent(new Event('input'));");
  await until("return window.fixtureCommands.includes('seekTo:120:false')&&window.fixtureCommands.includes('seekTo:120:true')&&window.fixtureCommands.includes('setVolume:40');", "the seek (previewed, then settled) and the volume to reach the embed");
  await until("return Number(document.getElementById('music-seek').value)>=120&&document.getElementById('music-seek').value!=='225';", "the bar to follow the embed's own time");
  await until("return document.getElementById('media-window-play').dataset.playing==='true'&&document.getElementById('media-window-volume').value==='40';", "the floating bar's own transport to follow the same state");
  await run("document.getElementById('music-play').click();");
  await until("return window.fixtureCommands.includes('pauseVideo')&&document.getElementById('music-play').dataset.playing==='false'&&document.querySelector('.music-now-kicker').textContent==='Paused';", "Pause to reach the embed and the card to show it paused");
  report.transportCommands = await run("return window.fixtureCommands.slice();");
  assert.equal(report.playerLoads, 1, "the transport never reloads the player");
  await capture("media-transport-card.png");
  // No jitter: with the window short enough that the card scrolls, the docked player stays exactly on its
  // stage on every frame, because it is carried inside the card rather than placed over it by script.
  window.setSize(1440, 640); await sleep(500);
  await run("window.MefiMusic.closeAudio();window.MefiMusic.openAudio();"); await sleep(400);
  report.dockedDrift = await run("const body=document.querySelector('.music-dropdown-body'),stage=document.getElementById('music-video-stage'),player=document.getElementById('media-window');const samples=[];for(let index=0;index<12;index++){body.scrollTop=index*18;await new Promise(resolve=>requestAnimationFrame(resolve));const s=stage.getBoundingClientRect(),m=player.getBoundingClientRect();samples.push(Math.round((m.top-s.top)*10)/10);}return {samples,scrolls:body.scrollHeight>body.clientHeight,docked:player.dataset.docked,loaded:window.fixtureMedia===window.MefiMusic.linkElement().element};");
  assert.ok(report.dockedDrift.scrolls && report.dockedDrift.docked === "true" && report.dockedDrift.loaded, `the card scrolls with the player in it: ${JSON.stringify(report.dockedDrift)}`);
  assert.ok(report.dockedDrift.samples.every(sample => Math.abs(sample) <= .5), `the docked player drifts from its stage while the card scrolls: ${JSON.stringify(report.dockedDrift)}`);
  await run("document.querySelector('.music-dropdown-body').scrollTop=0;window.MefiMusic.closeAudio();");
  window.setSize(1440, 900); await sleep(250);
  assert.equal(report.playerLoads, 1, "scrolling and docking keep the original provider load");
  // The mini player keeps the video, its transport, the background switch and Up next in one card: folded it
  // is the card alone, unfolded (Browse) the card keeps its width with Up next under the stage.
  for (const width of [1440, 600]) {
    window.setSize(width, 900); await sleep(250);
    await run("window.MefiMusic.openSection('browse');document.getElementById('music-sound').scrollTop=0;document.querySelector('.music-dropdown-body').scrollTop=0;"); await sleep(450);
    await capture(`media-design-player-${width}.png`);
    // Scroll Up next into view first: the docked player travels with the card, so it stays on its stage.
    // A queue row's own buttons appear when the row is hovered or focused (they take no pointer before), so the
    // row's title is what must be clear of the player on its own, and the buttons once the row is focused.
    const design = await run("const queue=document.getElementById('music-link-queue-list');queue.scrollIntoView({block:'nearest'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const player=document.getElementById('media-window'),p=player.getBoundingClientRect(),s=document.getElementById('music-video-stage').getBoundingClientRect(),q=queue.getBoundingClientRect(),item=queue.querySelector('.music-link-queue-item'),title=item.querySelector('strong'),t=title.getBoundingClientRect(),titleClear=title.contains(document.elementFromPoint(t.x+12,t.y+t.height/2)),b=item.querySelector('button');b.focus({preventScroll:true});await new Promise(resolve=>requestAnimationFrame(resolve));const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),actionsClear=b.contains(hit);b.blur();const play=document.getElementById('music-play').getBoundingClientRect(),menu=document.getElementById('music-dropdown');return {docked:player.dataset.docked==='true',same:window.fixtureMedia===window.MefiMusic.linkElement().element,fits:Math.abs(p.width-s.width)<1&&Math.abs(p.x-s.x)<1&&Math.abs(p.y-s.y)<1,separate:p.right<=q.left+1||p.bottom<=q.top+1,queueClear:titleClear&&actionsClear,titleClear,actionsClear,hit:String(hit?.outerHTML).slice(0,140),transportBelow:play.top>=s.bottom-1,size:menu.dataset.size,section:menu.dataset.section,providerHeight:window.fixtureMedia.getBoundingClientRect().height,width:innerWidth};");
    assert.ok(design.docked&&design.same&&design.fits&&design.separate&&design.queueClear&&design.transportBelow&&design.size==='full'&&design.section==='browse'&&design.providerHeight>=170, `Integrated player retains room for provider controls and queue at ${width}px: ${JSON.stringify(design)}`);
    await run("document.getElementById('music-video-background').click();"); await sleep(250);
    assert.equal(await run("const button=document.getElementById('music-video-background');return document.body.dataset.mediaBackground==='true'&&button.getAttribute('aria-pressed')==='true'&&button.getAttribute('aria-label')==='Bring the video back from behind your workspace'&&document.getElementById('music-link-queue-list').children.length===3&&window.fixtureMedia===window.MefiMusic.linkElement().element;"), true);
    await capture(`media-design-background-${width}.png`);
    await run("document.getElementById('music-video-background').click();"); await sleep(100);
    assert.equal(await run("return document.getElementById('media-window').dataset.docked==='true'&&document.body.dataset.mediaBackground==='false';"), true);
    // Closing the menu sends the docked player home in one jump. It once glided in from the page's corner
    // (the step-aside transition laid on the change from the card to the page), and a click on Close could
    // land on a window that was still on its way: nothing may be animating, and the place must not change.
    const home = await run("const root=document.getElementById('media-window');window.MefiMusic.closeAudio();const first=root.getBoundingClientRect();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const later=root.getBoundingClientRect();return {docked:root.dataset.docked,dodging:root.dataset.dodging,first:[first.x,first.y],later:[later.x,later.y],gliding:root.getAnimations().length};");
    assert.ok(home.docked === "false" && home.gliding === 0 && home.first[0] === home.later[0] && home.first[1] === home.later[1], `the player goes home in one jump when the menu closes at ${width}px: ${JSON.stringify(home)}`);
  }
  assert.equal(report.playerLoads, 1, "docking and background switches keep the original provider load");
  await click("media-window-close");
  report.closed = await run("return document.getElementById('media-window').hidden&&window.MefiMusic.linkElement()===null&&!window.fixtureMedia.isConnected;");
  if (!report.closed) assert.fail(`Close hides the window, drops the link and removes the embed: ${JSON.stringify(await run("const w=document.getElementById('media-window');return {hidden:w.hidden,docked:w.dataset.docked,minimized:w.dataset.minimized,link:window.MefiMusic.linkElement()===null,connected:window.fixtureMedia.isConnected,width:innerWidth,focus:document.activeElement?.id};"))} with errors ${JSON.stringify(report.errors)}`);
  assert.deepEqual(report.errors, []);
  // Capture each source's mini player, folded and unfolded, at both widths without touching user data:
  // every visit starts folded, and neither state scrolls sideways.
  for (const width of [1440, 600]) {
    window.setSize(width, 900); await sleep(180);
    for (const [source, section] of [["local", "tracks"], ["radio", "stations"], ["link", "browse"]]) {
      await run(`window.MefiMusic.closeAudio();window.MefiMusic.openAudio();document.getElementById('music-${source}-tab').click();document.querySelector('.music-dropdown-body').scrollTop=0;`);
      assert.equal(await run("const menu=document.getElementById('music-dropdown'),body=document.querySelector('.music-dropdown-body');return menu.dataset.size==='compact'&&menu.scrollWidth<=menu.clientWidth+1&&body.scrollWidth<=body.clientWidth+1;"), true, `${source} folded at ${width}px`);
      await capture(`music-upgrade-${source}-${width}.png`);
      await run(`window.MefiMusic.openSection('${section}');`); await sleep(400);
      assert.equal(await run("const menu=document.getElementById('music-dropdown'),body=document.querySelector('.music-dropdown-body');return menu.dataset.size==='full'&&menu.scrollWidth<=menu.clientWidth+1&&body.scrollWidth<=body.clientWidth+1;"), true, `${source} unfolded at ${width}px`);
      await capture(`music-upgrade-${source}-open-${width}.png`);
    }
  }
  // Nothing but the local embed and thumbnail stubs was ever asked for.
  assert.deepEqual(report.networkAttempts, [], "the player asked for nothing this fixture does not answer locally");
  finish();
}).catch(finish);
