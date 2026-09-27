"use strict";

// A local canvas stream exercises an actual playing video inside the provider
// iframe. No provider request, account, user media or application host is used.
module.exports = async function backgroundChecks({ session, window, contents, run, until, capture, reachable, report }) {
  const assert = require("node:assert/strict");
  let loads = 0;
  session.defaultSession.protocol.handle("https", () => {
    loads++;
    return new Response(`<!doctype html><html><body style="margin:0;overflow:hidden"><video muted autoplay style="width:100vw;height:100vh;object-fit:cover"></video><script>
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      const ctx=canvas.getContext('2d'),video=document.querySelector('video');window.framesDrawn=0;
      function draw(){window.framesDrawn++;ctx.fillStyle=framesDrawn%20<10?'white':'black';ctx.fillRect(0,0,320,180);ctx.fillStyle='#ff0088';ctx.fillRect((framesDrawn*8)%360-40,0,40,180);}
      draw();video.srcObject=canvas.captureStream(10);video.play();setInterval(draw,100);
      </script></body></html>`, { headers: { "content-type": "text/html" } });
  });
  window.setContentSize(1440, 900); contents.setZoomFactor(1);
  await run("window.MefiNav.closeAll();window.MefiVibe.setMode('build');window.MefiVibe.closeNotes();window.MefiMusic.playLink('https://youtu.be/dQw4w9WgXcQ',{autoplay:false});window.backgroundFixturePlayer=window.MefiMusic.linkElement().element;");
  await until("window.backgroundFixturePlayer?.contentWindow", "background player");
  let frame;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    frame = contents.mainFrame.frames.find(item => item.url.startsWith("https://www.youtube-nocookie.com/embed/"));
    if (frame && await frame.executeJavaScript("Boolean(document.querySelector('video')?.currentTime>0)")) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(frame && await frame.executeJavaScript("document.querySelector('video').currentTime>0"), "local video is playing before the layout sweep");
  const start = await frame.executeJavaScript("document.querySelector('video').currentTime");
  await run("if(document.body.dataset.mediaBackground!=='true')document.getElementById('media-window-background').click();const slider=document.getElementById('media-window-transparency');slider.value='0';slider.dispatchEvent(new Event('input'));window.MefiMusic.closeAudio();");
  const routes = [
    ['workspace',{}], ['agents',{}], ...['connections','team','routing','behavior'].map(pane=>['agents',{section:'setup',pane}]),
    ['command',{}], ...['live','playbook','map'].map(tab=>['agent-brain',{tab}]),
    ...['tasks','plans','ideas','analyzer','explorer','trace','overhead','brains','eyes','context','booklet','graph','usage'].map(id=>[id,{}]),
    ...['general','appearance','audio','system'].map(category=>['studio',{category}]), ...['help','profiler','palette'].map(id=>[id,{}]),
  ];
  report.backgroundLayouts = [];
  report.backgroundVibe = [];
  for (const [width,height,zoom,preset] of [[1440,900,1,'atmosphere'],[600,560,1,'studio'],[600,560,1.5,'focus']]) {
    window.setContentSize(width,height); contents.setZoomFactor(zoom);
    await run(`window.MefiAppearance.apply({preset:'${preset}'});`);
    for (const [id,params] of routes) {
      await run(`window.MefiNav.closeAll();await window.MefiNav.go(${JSON.stringify(id)},${JSON.stringify(params)});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
      const result = await run("const player=window.MefiMusic.linkElement().element;return {route:window.MefiNav.current(),overflow:document.documentElement.scrollWidth>innerWidth+1,persistent:player===window.backgroundFixturePlayer,background:document.body.dataset.mediaBackground};");
      report.backgroundLayouts.push({id,params,width,height,zoom,...result});
      assert.ok(!result.overflow && result.persistent && result.background==='true', JSON.stringify(report.backgroundLayouts.at(-1)));
      assert.deepEqual(report.errors, [], `${id}: no renderer errors`);
      if (id==='workspace' || id==='studio' && params.category==='general') await capture(`background-${width}-${zoom}-${id}.png`);
    }
    await run("window.MefiNav.closeAll();window.MefiVibe.setMode('vibe');await window.MefiNav.go('vibe');");
    for (const kind of ['tasks','plans','ideas','team','settings','decisions','newapp']) {
      await run(`window.MefiVibe.openPanel('${kind}');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
      assert.ok(await reachable('#vibe-panel-close'), `Vibe ${kind} close fits at ${width}/${zoom}`);
      const fits=await run("const panel=document.getElementById('vibe-panel'),box=panel.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1&&box.top>=0&&box.bottom<=innerHeight+1&&panel.scrollWidth<=panel.clientWidth+1;");
      assert.ok(fits, `Vibe ${kind} fits at ${width}/${zoom}`);
      report.backgroundVibe.push({kind,width,height,zoom});
    }
    await capture(`background-vibe-${width}-${zoom}.png`);
    await run("window.MefiVibePanels.close();window.MefiVibe.setMode('build');");
  }
  // Open the controls that an ordinary page-only tour misses.
  await run("window.MefiNav.closeAll();await window.MefiNav.go('agents',{section:'setup',pane:'routing'});document.getElementById('ai-role-routine').closest('details').open=true;");
  for (const selector of ['#ai-role-routine-choice','#ai-role-heavy-choice','#ai-model-routine','#ai-model-heavy']) assert.ok(await reachable(selector), `${selector} fits in narrow Routing`);
  assert.ok(await run("const body=document.getElementById('agents-body');return body.scrollWidth<=body.clientWidth+1;"), "expanded routing does not require horizontal scrolling");
  await capture('background-routing-narrow.png');
  await run("await window.MefiNav.go('ideas');document.getElementById('ideas-tools').open=true;");
  for (const selector of ['#ideas-scan','#ideas-clean']) assert.ok(await reachable(selector), `${selector} fits in the open Tools menu`);
  await capture('background-ideas-tools-narrow.png');
  await run("await window.MefiNav.go('studio',{category:'general'});window.scrollTo(0,document.body.scrollHeight);");
  assert.ok(await reachable('#settings-find'), 'sticky Settings search stays below the navigation');
  assert.ok(await run("return document.querySelector('.settings-nav').getBoundingClientRect().top>=document.getElementById('app-local-nav').getBoundingClientRect().bottom-1;"), 'sticky category strip clears the fixed bar');
  await capture('background-settings-scrolled.png');
  // Resolve the actual CSS fills, then composite against the two extreme
  // video frames. Blur cannot improve contrast against a uniform white frame.
  report.backgroundContrast = [];
  for (const mode of ['build','vibe']) for (const light of [false,true]) for (const glass of [0,45,100]) for (const noBlur of [false,true]) {
    await run(`window.MefiVibe.setMode('${mode}');`);
    await run(`window.MefiMusic.${light ? "applyCustomColors({background:'#f4f4f4',surface:'#ffffff',text:'#202020',accent:'#704000'})" : "applyTheme('gold')"};window.MefiAppearance.apply({glass:${glass}});document.documentElement.toggleAttribute('data-no-blur',${noBlur});`);
    const rows = await run(`
      const probe=document.createElement('div');probe.style.cssText='position:fixed;left:-100px;width:1px;height:1px';document.getElementById('vibe-layer').append(probe);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
      const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map(x=>x/255);};
      const lum=rgb=>rgb.slice(0,3).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
      const rows=[];
      for(const fill of ['studio-panel-bg','studio-shell-fill','studio-float-fill','studio-page-fill','v-glass','v-glass-hi','#app-rail','#app-local-nav','#vibe-panel','.settings-nav','#workspace-layer','.agents-card']) for(const ink of ['ivory','muted','dim']) {
        probe.style.backgroundColor=/^[#.]/.test(fill)?getComputedStyle(document.querySelector(fill)).backgroundColor:'var(--'+fill+')';probe.style.color='var(--'+ink+')';
        const css=getComputedStyle(probe),bg=rgba(css.backgroundColor),fg=rgba(css.color);
        const ratios=[0,1].map(video=>{const a=lum(bg.slice(0,3).map(x=>x*bg[3]+video*(1-bg[3]))),b=lum(fg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);});
        rows.push({fill,ink,alpha:bg[3],contrast:Math.min(...ratios)});
      }
      probe.remove();return rows;
    `);
    report.backgroundContrast.push({mode,light,glass,noBlur,rows});
    for (const row of rows) {
      assert.ok(row.contrast>=4.5, `background reading contrast: ${JSON.stringify({mode,light,glass,noBlur,...row})}`);
      if (!glass) assert.equal(row.alpha,1,'zero glass makes reading surfaces solid');
    }
  }
  assert.equal(loads,1,'navigation and appearance changes never reload playback');
  assert.ok(await frame.executeJavaScript('document.querySelector("video").currentTime')>start,'video advances throughout the sweep');
  report.backgroundPlayback = true;
  await run("document.documentElement.removeAttribute('data-no-blur');window.MefiVibe.setMode('build');window.MefiMusic.applyTheme('aurora');window.MefiAppearance.apply({preset:'studio'});if(document.body.dataset.mediaBackground==='true')document.getElementById('media-window-background').click();window.MefiMusic.closeAudio();");
};
