"use strict";
// Full renderer, isolated profile, no application host or real provider traffic.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_MEDIA_RENDER_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated media fixture directory is required");
const report = { errors: [], playerLoads: 0, layouts: [] };
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
app.whenReady().then(async () => {
  // Answer the actual official embed URL locally. Reloads increment this
  // counter, so an unchanged iframe node alone cannot conceal playback resets.
  session.defaultSession.protocol.handle("https", request => {
    if (request.url.startsWith("https://www.youtube-nocookie.com/embed/")) {
      report.playerLoads++;
      return new Response('<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 70% 20%,#afccb2,transparent 45%),linear-gradient(165deg,#506e91 35%,#68887f 36%,#193635 70%,#142426);color:white;font:16px system-ui"><div style="text-align:center;text-shadow:0 2px 10px #000"><div style="font-size:36px">▶</div>Media preview<div style="font-size:11px;margin-top:10px">Isolated playback fixture</div></div><button id="settings" style="position:absolute;bottom:8px;right:8px;width:36px;height:30px" onclick="document.getElementById(&quot;menu&quot;).hidden=false">⚙</button><div id="menu" hidden style="position:absolute;bottom:44px;right:8px;background:#222;padding:12px;width:170px;height:110px"><button style="width:100%;height:40px" onclick="parent.postMessage(&quot;fixture-quality-clicked&quot;,&quot;*&quot;)">Quality · 1080p</button></div></body></html>', { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Fixture blocks external requests", { status: 403 });
  });
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url) || details.url.startsWith("https://www.youtube-nocookie.com/embed/");
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
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
  const capture = async name => { await sleep(220); fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG()); };
  const layout = async () => {
    const result = await run("const r=document.getElementById('media-window').getBoundingClientRect(), c=document.querySelector('.media-window-controls'), b=c.getBoundingClientRect(), f=window.fixtureMedia.getBoundingClientRect(); return {width:innerWidth,contained:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,controlsFit:document.getElementById('music-dropdown').contains(c)&&!document.getElementById('media-window').contains(c),hits:[[f.left+1,f.top+1],[f.right-1,f.bottom-1],[f.right-30,f.bottom-55]].map(([x,y])=>document.elementFromPoint(x,y)?.outerHTML?.slice(0,160)),providerClear:[[f.left+1,f.top+1],[f.right-1,f.bottom-1],[f.right-30,f.bottom-55]].every(([x,y])=>document.elementFromPoint(x,y)===window.fixtureMedia)};");
    report.layouts.push(result); assert.ok(result.contained && result.controlsFit && result.providerClear, JSON.stringify(result));
  };
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await run("window.MefiNav.go('studio',{category:'audio'});window.MefiMusic.playLink('https://youtu.be/dQw4w9WgXcQ',{autoplay:false});window.fixtureMedia=window.MefiMusic.linkElement().element;");
  await sleep(4500);
  report.borderless = await run("const w=document.getElementById('media-window');return w.parentElement===document.body&&!w.hidden&&getComputedStyle(w).borderTopWidth==='0px'&&getComputedStyle(document.querySelector('.media-window-controls')).opacity==='1'&&w.contains(window.fixtureMedia);");
  assert.ok(report.borderless, "player is a borderless body surface with separate side controls");
  await layout(); await capture("media-window-rest.png");
  let before = await rect(); await mouse(before.x + 50, before.y + 80); await sleep(220);
  report.hover = await run("return getComputedStyle(document.querySelector('.media-window-controls')).opacity==='1';"); assert.ok(report.hover);
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
  await run("document.querySelectorAll('#toast-host .toast-dismiss').forEach(button=>button.click());window.MefiMusic.openAudio();document.getElementById('media-window-move').scrollIntoView({block:'nearest'});"); await sleep(450);
  const handle = await run("const n=document.getElementById('media-window-move'),r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,400)};");
  await mouse(handle.x, handle.y); await mouse(handle.x, handle.y, "mouseDown"); await mouse(handle.x - 160, handle.y - 100); await mouse(handle.x - 160, handle.y - 100, "mouseUp");
  let after = await rect(); report.drag = Math.abs(after.x - (before.x - 160)) < 2 && Math.abs(after.y - (before.y - 100)) < 2; assert.ok(report.drag, JSON.stringify({ before, after, handle }));
  await run("window.MefiMusic.closeAudio();");
  before = after;
  await mouse(before.x + before.width - 5, before.y + before.height - 5); await mouse(before.x + before.width - 5, before.y + before.height - 5, "mouseDown");
  await mouse(before.x + before.width + 59, before.y + before.height + 31); await mouse(before.x + before.width + 59, before.y + before.height + 31, "mouseUp");
  after = await rect(); report.resize = Math.abs(after.width - before.width - 64) < 2 && Math.abs(after.height - before.height - 36) < 2; assert.ok(report.resize, JSON.stringify({ before, after }));
  await run("document.getElementById('media-window-minimize').click();"); report.minimize = (await rect()).height === 44;
  await run("document.getElementById('music-link-show').click();window.MefiNav.go('workspace');");
  assert.equal(await run("return window.fixtureMedia===window.MefiMusic.linkElement().element&&!document.getElementById('media-window').hidden;"), true);
  await run("window.MefiNav.go('studio',{category:'general'});document.activeElement.blur();document.documentElement.dataset.motion='on';");
  await mouse(10, 10); await sleep(1850); before = await rect();
  await run(`document.dispatchEvent(new PointerEvent('pointermove',{clientX:${before.x - 40},clientY:${before.y + 70},pointerType:'mouse'}));`);
  await sleep(260);
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
  await run("const volume=document.getElementById('music-link-volume');volume.scrollIntoView({block:'center'});volume.value='35';volume.dispatchEvent(new Event('input'));document.getElementById('music-link-mute').click();");
  assert.equal(await run("const saved=JSON.parse(localStorage.getItem('mefiStudio.mediaVolume.v1'));return saved.volume===.35&&saved.muted===true&&document.getElementById('music-link-mute').getAttribute('aria-pressed')==='true';"), true);
  await capture("media-window-volume-settings.png");
  await run("const input=document.getElementById('music-link-url');for(const url of ['https://vimeo.com/12345678','https://example.com/queued.mp4','https://youtu.be/M7lc1UVf-VE']){input.value=url;document.getElementById('music-link-queue-add').click();}const list=document.getElementById('music-link-queue-list');list.children[2].querySelectorAll('button')[1].click();list.children[1].querySelectorAll('button')[2].click();list.scrollIntoView({block:'center'});");
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
  report.tree = await run("const near=document.getElementById('idle-layer'),far=document.getElementById('idle-layer-far');return getComputedStyle(near).opacity==='1'&&getComputedStyle(far).opacity==='1'&&far.getContext('2d').getContextAttributes().alpha===true&&getComputedStyle(document.querySelector('main')).visibility==='hidden';");
  assert.ok(report.tree, "tree stays fully opaque above the video and inactive pages stay hidden");
  await run("const video=document.getElementById('media-window-transparency');video.value='0';video.dispatchEvent(new Event('input'));const tree=document.getElementById('media-window-tree-transparency');tree.value='40';tree.dispatchEvent(new Event('input'));const brightness=document.getElementById('media-window-brightness');brightness.value='125';brightness.dispatchEvent(new Event('input'));");
  await run("await Promise.all([document.querySelector('.music-link-player'),document.getElementById('idle-layer')].flatMap(node=>node.getAnimations()).map(animation=>animation.finished.catch(()=>{})));");
  report.visibilitySliders = await run("return {tree:getComputedStyle(document.getElementById('idle-layer')).opacity,video:getComputedStyle(document.querySelector('.music-link-player')).opacity,brightness:getComputedStyle(document.querySelector('.music-link-player')).filter,visible:document.body.dataset.mediaVisible,variable:document.body.style.getPropertyValue('--media-tree-opacity')};");
  assert.ok(Math.abs(Number(report.visibilitySliders.tree)-.6)<.01&&Math.abs(Number(report.visibilitySliders.video)-1)<.01&&report.visibilitySliders.brightness==='brightness(1.25)', `tree opacity and video opacity/brightness change independently: ${JSON.stringify(report.visibilitySliders)}`);
  await run("for(const [id,value] of [['media-window-tree-transparency','0'],['media-window-brightness','100']]){const slider=document.getElementById(id);slider.value=value;slider.dispatchEvent(new Event('input'));}");
  await run("await Promise.all([document.getElementById('idle-layer'),document.getElementById('idle-layer-far')].flatMap(node=>node.getAnimations()).map(animation=>animation.finished.catch(()=>{})));");
  assert.equal(await run("const holder=document.createElement('div');holder.hidden=true;const page=document.createElement('section');page.className='workspace-page';holder.append(page);document.body.append(holder);const bright=getComputedStyle(document.getElementById('idle-layer')).opacity==='1'&&getComputedStyle(document.getElementById('idle-layer-far')).opacity==='1'&&getComputedStyle(document.querySelector('.music-link-player')).filter==='brightness(1)';holder.remove();return bright;"), true, "inactive workspace pages cannot dim the tree at zero transparency");
  await capture("media-window-background-tree.png");
  await mouse(10, 10);
  const mediaButton = await run("window.fixtureHoverFocus=document.activeElement;const r=document.getElementById('idle-music-toggle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};");
  await mouse(mediaButton.x, mediaButton.y); await sleep(300);
  assert.equal(await run("return !document.getElementById('music-dropdown').hidden&&document.activeElement===window.fixtureHoverFocus&&!document.getElementById('music-link-panel').hidden;"), true, "native hover opens the current media controls without moving keyboard focus");
  assert.equal(await run("const volume=document.getElementById('music-link-volume'),r=volume.getBoundingClientRect();return r.y>document.getElementById('music-dropdown').getBoundingClientRect().y+45&&volume===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);"), true, "hover brings current volume settings into view even after scrolling the queue");
  const dropdownPoint = await run("const r=document.getElementById('music-dropdown').getBoundingClientRect();return {x:r.x+60,y:r.y+24};");
  await mouse(dropdownPoint.x, dropdownPoint.y); await sleep(550);
  assert.equal(await run("return document.getElementById('music-dropdown').hidden;"), false, "crossing into the dropdown cancels hover dismissal");
  await capture("media-hover-dropdown.png");
  await mouse(10, 10); await sleep(550);
  assert.equal(await run("return document.getElementById('music-dropdown').hidden;"), true, "leaving an untouched hover dismisses it");
  await mouse(mediaButton.x, mediaButton.y); await sleep(300);
  const volumePoint = await run("const input=document.getElementById('music-link-volume'),r=input.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,clear:input===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)};");
  assert.ok(volumePoint.clear, `hover exposes the volume slider: ${JSON.stringify(volumePoint)}`);
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
  await run("document.body.classList.add('command-zen');");
  report.zen = await run("return getComputedStyle(document.querySelector('.media-window-controls')).visibility==='hidden'&&getComputedStyle(document.querySelector('.music-link-player')).visibility==='visible';");
  assert.ok(report.zen, "Zen keeps the video and hides its controls");
  await run("document.body.classList.remove('command-zen');");
  // Exercise the shared tree controls in the real menu at both viewport sizes.
  for (const width of [1440, 600]) {
    window.setSize(width, width === 600 ? 650 : 900); await sleep(250);
    await run("window.MefiMusic.openAudio();document.getElementById('music-audio-reactions').open=true;document.getElementById('audio-tree-mode').closest('details').open=true;const mode=document.getElementById('audio-tree-mode');mode.value='hybrid';mode.dispatchEvent(new Event('change'));const shape=document.getElementById('audio-tree-shape');shape.value='ring';shape.dispatchEvent(new Event('change'));document.getElementById('audio-tree-mode-choice').scrollIntoView({block:'center'});");
    await sleep(250);
    await capture(`tree-dynamics-controls-${width}.png`);
    const treeControls = await run("const input=document.getElementById('audio-tree-mode'),button=document.getElementById('audio-tree-mode-choice'),r=button.getBoundingClientRect(),panel=input.closest('details');return {mode:input.value,shared:document.getElementById('appearance-tree-mode').value,width:panel.clientWidth,scroll:panel.scrollWidth,rect:{x:r.x,y:r.y,w:r.width,h:r.height},hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,400),clear:button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};");
    assert.ok(treeControls.mode==='hybrid'&&treeControls.shared==='hybrid'&&treeControls.scroll<=treeControls.width+1&&treeControls.clear, `tree modes are synchronized and reachable at ${width}px: ${JSON.stringify(treeControls)}`);
    await run("window.MefiMusic.closeAudio();");
  }
  await run("window.MefiMusic.openAudio();const brightness=document.getElementById('media-tree-nodeBrightness');brightness.closest('details').open=true;brightness.value='1.5';brightness.dispatchEvent(new Event('input'));const lines=document.getElementById('media-tree-lineBrightness');lines.value='.5';lines.dispatchEvent(new Event('input'));const outlines=document.getElementById('media-tree-outlines');outlines.checked=true;outlines.dispatchEvent(new Event('change'));brightness.scrollIntoView({block:'center'});");
  await sleep(250);
  assert.equal(await run("const input=document.getElementById('media-tree-nodeBrightness'),r=input.getBoundingClientRect(),panel=input.closest('details');return document.getElementById('appearance-tree-nodeBrightness').value==='1.5'&&document.getElementById('audio-tree-lineBrightness').value==='0.5'&&window.MefiTreeDynamics.preferences().outlines&&panel.scrollWidth<=panel.clientWidth+1&&input===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)&&window.fixtureMedia===window.MefiMusic.linkElement().element;"), true, "brightness and outline controls synchronize across menus and remain reachable at 600px without reloading playback");
  await capture("media-tree-brightness-controls.png");
  await run("window.MefiMusic.closeAudio();");
  await run("window.MefiTreeDynamics.update({mode:'music',shape:'layout'});");
  await run("document.getElementById('media-window-background').click();");
  assert.equal(await run("return document.querySelector('.music-link-player').inert;"), false);
  assert.equal(report.playerLoads, 1);
  await run("document.getElementById('media-window-close').click();");
  report.closed = await run("return document.getElementById('media-window').hidden&&window.MefiMusic.linkElement()===null&&!window.fixtureMedia.isConnected;");
  assert.ok(report.closed); assert.deepEqual(report.errors, []);
  finish();
}).catch(finish);
