"""Verify Command against a dense, isolated Electron fixture, without workers.

python tools/verify_command.py [--baseline] [--output tools/logs/command-ui]

Uses the Workspace harness's offscreen window, logging and network guard. All
board files, projects and Electron settings live in a temporary directory. A
read-only IPC fixture supplies four sessions and synthetic worker/roster status;
it never launches those workers. Baseline screenshots are retained separately.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from verify_workspace import BOOTSTRAP as WORKSPACE_BOOTSTRAP, project_id, write_json

ROOT = Path(__file__).resolve().parents[1]

VERIFY_METHOD = r'''
  async layout(name, strict = true) {
    const layout = await this.run(`
      const rect = (selector) => { const el = document.querySelector(selector); if (!el || el.hidden || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r.toJSON() : null; };
      const viewport = window.MefiIdle.graphViewport?.() || {x:innerWidth * .3,y:180,w:innerWidth * .4,h:innerHeight - 290};
      const center = document.elementFromPoint(viewport.x + viewport.w/2, viewport.y + viewport.h/2);
      return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,viewport,
        centerId:center?.id,centerTag:center?.tagName, nodes:window.MefiIdle.debugNodes(),
        header:rect('.cmd-top'),feed:rect('#idle-feed'),chat:rect('#cmd-chat'),selected:rect('#idle-info'),
        dock:rect('#cmd-dock'),search:rect('.cmd-search'),composer:rect('.cmd-composer'),tools:rect('.cmd-tools'),music:rect('#idle-music-toggle'),canvas:rect('#idle-layer')};
    `);
    report.layouts ||= {};
    report.layouts[name] = layout;
    if (!strict || config.baseline) return layout;
    assert(layout.scroll <= layout.width + 2, `${name}: no horizontal page overflow`);
    for (const key of ['header','feed','dock','search','composer','tools']) {
      const box = layout[key];
      assert(box && box.width > 10 && box.height > 10, `${name}: ${key} remains visible`);
      assert(box.x >= -2 && box.right <= layout.width + 2 && box.y >= -2 && box.bottom <= layout.height + 2, `${name}: ${key} fits viewport`);
    }
    const overlap = (a,b) => a && b && Math.min(a.right,b.right) - Math.max(a.x,b.x) > 2 && Math.min(a.bottom,b.bottom) - Math.max(a.y,b.y) > 2;
    for (const [a,b] of [['search','composer'],['search','tools'],['composer','tools'],['header','feed'],['feed','dock'],['chat','dock'],['feed','chat']]) {
      assert(!overlap(layout[a],layout[b]), `${name}: ${a} and ${b} do not overlap`);
    }
    assert(layout.viewport.w >= 200 && layout.viewport.h >= 180, `${name}: graph has usable clear area`);
    assert.equal(layout.centerId, 'idle-layer', `${name}: graph center is directly interactive`);
    assert(layout.nodes.filter(node => Number.isFinite(node.x) && Number.isFinite(node.y)).length >= 10, `${name}: graph positions are finite`);
    assert(layout.music && layout.music.right <= layout.width + 2, `${name}: music control remains visible`);
    const labels = layout.nodes.map(node => node.labelRect).filter(Boolean);
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index];
      assert(label.x >= -2 && label.y >= -2 && label.x + label.w <= layout.width + 2 && label.y + label.h <= layout.height + 2, `${name}: node labels stay in view`);
      for (const previous of labels.slice(0,index)) {
        assert(!(Math.min(label.x+label.w,previous.x+previous.w)-Math.max(label.x,previous.x)>2 && Math.min(label.y+label.h,previous.y+previous.h)-Math.max(label.y,previous.y)>2), `${name}: node labels do not overlap`);
      }
    }
    return layout;
  }
  async verifyParallelBuilds() {
    await this.until("document.getElementById('cmd-chat-state').textContent.includes('2 agents') && document.getElementById('cmd-chat-state').textContent.includes('1 build')", "header distinguishes service agents from builders");
    for (const parallel of [2,3]) {
      await this.run(`const select=document.getElementById('idle-feed-parallel');if(select.disabled)throw new Error('Capacity control disabled');select.value='${parallel}';select.dispatchEvent(new Event('change',{bubbles:true}));`);
      await this.until(`!document.getElementById('idle-feed-parallel').disabled && document.getElementById('idle-feed-parallel').value==='${parallel}'`, `capacity saves ${parallel} workers`);
    }
    assert.deepEqual(report.parallelRequests, [{parallel:2},{parallel:3}], "capacity changes never toggle enable or execute");
    assert.equal(config.fixture.autopilot.execute, true);
    assert.equal(config.fixture.autopilot.enabled, true);
    const titles = await this.run("const tasks=(await window.mefiStudio.tasksList()).tasks;const selected=tasks.filter(task=>['command_task_01','command_task_02'].includes(task.id));for(const task of selected)task.status='active';const result=await window.mefiStudio.tasksSave(tasks);if(!result?.ok)throw new Error('Fixture tasks did not save');return selected.map(task=>({id:task.id,title:task.title}));");
    for (const [index,task] of titles.entries()) config.fixture.autopilot.running.push({title:task.title,taskId:task.id,sessionId:`command_session_${index+1}`,projectId:config.alpha.id,startedAt:Date.now()-35000-index*12000,source:'fixture',progress:index===0?.2:.6});
    this.webContents.send('assistant:status', config.fixture.autopilot);
    await this.until("document.querySelectorAll('#idle-feed-now .feed-current-card').length===3 && document.getElementById('cmd-chat-state').textContent.includes('3 builds')", "three distinct builders appear together");
    this.setContentSize(1280,720); await sleep(250);
    const cards = await this.run("const rail=document.getElementById('idle-feed-now'),panel=document.getElementById('idle-feed');const box=rail.getBoundingClientRect(),outer=panel.getBoundingClientRect();return {height:box.height,panelHeight:outer.height,top:box.top,bottom:box.bottom,scroll:rail.scrollHeight,client:rail.clientHeight,scrollWidth:rail.scrollWidth,clientWidth:rail.clientWidth,overflow:getComputedStyle(rail).overflowY,titles:[...rail.querySelectorAll('.feed-current-title')].map(el=>el.textContent),metrics:document.getElementById('idle-feed-metrics').getBoundingClientRect().toJSON()};");
    assert.equal(cards.titles.length,3);
    for (const task of titles) assert(cards.titles.includes(task.title), "each concurrent build keeps its own title");
    assert(cards.height>=140 && cards.height<cards.panelHeight*.65, "current builds use a bounded part of the live-work panel");
    assert.equal(cards.overflow,'auto');
    assert(cards.scroll>cards.client, "extra current builds scroll inside their section");
    assert(cards.scrollWidth<=cards.clientWidth+1, "current build titles wrap without horizontal scrolling");
    assert(cards.metrics.bottom<=720, "readiness metrics stay available on a short screen");
    await this.capture('07c-parallel-builds');
    await this.run("const rail=document.getElementById('idle-feed-now');rail.scrollTop=rail.scrollHeight;");
    await this.capture('07d-parallel-builds-scrolled');
    this.setContentSize(1463,943); await sleep(150);
    report.parallelLayout=cards;
    this.check("Parallel capacity saves only worker count; three named builders coexist with separate agent counts and a bounded current-work scroller");
  }
  async verifyFollow() {
    await this.click('#idle-cam-follow');
    await this.until("window.MefiIdle.followStatus?.().mode === 'follow' && Boolean(window.MefiIdle.followStatus().taskId) && !document.getElementById('idle-follow-status').hidden", "Follow names the actual active task");
    await this.until("Math.abs(window.MefiIdle.followStatus().zoom-window.MefiIdle.followStatus().targetZoom)<.08", "Follow camera eases into its task context");
    const focus = await this.run("const status=window.MefiIdle.followStatus(),area=window.MefiIdle.graphViewport(),node=window.MefiIdle.debugNodes().find(node=>node.id===status.nodeId);return {status,area,node,text:document.getElementById('idle-follow-status').textContent};");
    assert(config.fixture.autopilot.running.some(job=>job.taskId===focus.status.taskId), "Follow must target a running worker's task");
    assert.equal(focus.node.kind,'task',"Follow resolves the task before its execution session");
    assert(focus.text.includes(focus.status.title), "follow status names the actual task");
    assert(focus.node.x>focus.area.x && focus.node.x<focus.area.x+focus.area.w && focus.node.y>focus.area.y && focus.node.y<focus.area.y+focus.area.h, "the focused task remains inside the available graph viewport");
    await this.capture('07e-follow-current-task');
    this.setContentSize(900,900);
    await sleep(300);
    await this.until("Math.abs(window.MefiIdle.followStatus().zoom-window.MefiIdle.followStatus().targetZoom)<.08", "Follow refits after the graph viewport narrows");
    const narrow = await this.run("const status=window.MefiIdle.followStatus(),area=window.MefiIdle.graphViewport(),node=window.MefiIdle.debugNodes().find(node=>node.id===status.nodeId);return {status,area,node};");
    assert.equal(narrow.status.mode,'follow');
    assert(narrow.node.x>narrow.area.x && narrow.node.x<narrow.area.x+narrow.area.w && narrow.node.y>narrow.area.y && narrow.node.y<narrow.area.y+narrow.area.h, "Follow keeps the actual task in the narrowed clear viewport");
    await this.capture('07f-follow-narrow');
    this.setContentSize(1463,943);
    await sleep(300);
    const running = [...config.fixture.autopilot.running];
    config.fixture.autopilot.running = running.filter(job=>job.taskId!==focus.status.taskId);
    this.webContents.send('assistant:status',config.fixture.autopilot);
    await this.until(`window.MefiIdle.followStatus().taskId && window.MefiIdle.followStatus().taskId!==${JSON.stringify(focus.status.taskId)}`, "Follow advances when its current worker finishes");
    const next = await this.run("return window.MefiIdle.followStatus();");
    assert(config.fixture.autopilot.running.some(job=>job.taskId===next.taskId));
    const area = await this.run("return window.MefiIdle.graphViewport();");
    this.webContents.focus();
    this.webContents.sendInputEvent({type:'mouseMove',x:Math.round(area.x+area.w/2),y:Math.round(area.y+area.h/2)});
    this.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(area.x+area.w/2),y:Math.round(area.y+area.h/2),deltaX:0,deltaY:-80,canScroll:true});
    await this.until("window.MefiIdle.followStatus().mode==='free' && document.getElementById('idle-follow-status').hidden", "manual zoom holds the view and stops following");
    report.follow={focus,narrow,next,manualMode:await this.run("return window.MefiIdle.followStatus().mode;")};
    config.fixture.autopilot.running = running;
    this.webContents.send('assistant:status',config.fixture.autopilot);
    await this.click('#idle-cam-orbit');
    await this.run("window.MefiIdle.fitAll();");
    this.check("Follow frames actual tasks, advances to the next worker and gives control back after a real wheel gesture");
  }
  async verifyMusic() {
    this.webContents.setAudioMuted(true); // Silence the final output, not the analyser's source.
    await this.run("window.__musicCaptureAttempts=0; navigator.mediaDevices.getDisplayMedia=async()=>{window.__musicCaptureAttempts++;throw new Error('Desktop capture is disabled in this fixture');};");
    assert.equal(await this.run("return Boolean(window.MefiMusic?.status && window.MefiMusic?.getAudioElement);"), true, "built-in player API is bundled");
    assert.equal(report.musicRequests || 0, 0, "loading Studio does not request recommendations");
    await this.click('#cmd-dock [data-nav="music"]');
    await this.until("!document.getElementById('music-overlay').hidden && document.body.dataset.sheet === 'music'", "music opens as the current Studio sheet");
    assert.equal(await this.run("return window.MefiMusic.status().playing;"), false);
    await this.click('.music-theme[data-theme="violet"]');
    assert.deepEqual(await this.run("return [...document.querySelectorAll('.music-theme[aria-pressed=\"true\"]')].map(button=>button.dataset.theme);"), ['violet'], "only the chosen Violet theme is selected");
    assert.equal(await this.run("return getComputedStyle(document.documentElement).getPropertyValue('--gold-bright').trim();"), '#dcc4ff');
    assert.equal(await this.run("return getComputedStyle(document.getElementById('workspace-layer')).getPropertyValue('--ws-accent').trim();"), '#dcc4ff', "theme also reaches Workspace");
    await this.run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await this.capture('11-music-room');
    await this.click('#music-spotify-tab');
    await this.run("document.getElementById('music-spotify-url').value = 'https://evil.test/playlist/not-spotify';");
    await this.click('#music-spotify-load');
    assert.equal(await this.run("return document.querySelectorAll('#music-overlay iframe').length;"), 0);
    assert.equal(await this.run("return document.querySelector('.music-notice').dataset.error;"), 'true');
    this.check("Music opens inside Studio, applies themes across surfaces and rejects non-Spotify embeds");
    await this.click('#music-local-tab');
    await this.run(`
      const sampleRate = 22050, seconds = 30, samples = sampleRate * seconds;
      const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
      const text = (offset,value) => [...value].forEach((letter,index) => view.setUint8(offset+index,letter.charCodeAt(0)));
      text(0,'RIFF'); view.setUint32(4,36+samples*2,true); text(8,'WAVE'); text(12,'fmt ');
      view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
      view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
      text(36,'data'); view.setUint32(40,samples*2,true);
      for(let index=0;index<samples;index++) view.setInt16(44+index*2,Math.sin(index*2*Math.PI*220/sampleRate)*1200,true);
      window.MefiMusic.getAudioElement().muted = false;
      const files = new DataTransfer(); files.items.add(new File([buffer],'Soft fixture.wav',{type:'audio/wav'})); files.items.add(new File([buffer],'Second fixture.wav',{type:'audio/wav'}));
      const picker = document.getElementById('music-files'); picker.files = files.files; picker.dispatchEvent(new Event('change',{bubbles:true}));
    `);
    await this.until("window.MefiMusic.getAudioElement().readyState >= 1", "local WAV metadata loads");
    assert.equal(await this.run("return window.MefiMusic.status().queueLength;"), 2);
    assert.equal(await this.run("return window.MefiMusic.status().playing;"), false, "choosing files does not autoplay");
    await this.click('#music-play');
    await this.until("window.MefiMusic.status().playing && window.MefiMusic.getAudioElement().currentTime > .01", "actual local audio playback starts");
    await this.run("const seek=document.getElementById('music-seek');seek.value='12';seek.dispatchEvent(new Event('input',{bubbles:true}));");
    assert(await this.run("return window.MefiMusic.getAudioElement().currentTime >= 11.9;"), "timeline seeks the actual element");
    await this.click('#music-next');
    await this.until("window.MefiMusic.status().title === 'Second fixture' && window.MefiMusic.status().playing", "next selects and plays the next local track");
    await this.capture('12-local-playing');
    await this.click('#music-close');
    await this.until("!document.body.dataset.sheet && window.MefiIdle.isActive()", "closing music returns focus to Command");
    await this.click('#idle-music-toggle');
    await this.until("window.MefiIdle.audioStatus().source === 'local' && window.MefiIdle.audioStatus().listening", "Command uses the local track directly for reactivity");
    await this.until("window.MefiIdle.audioStatus().energy > .01 && window.MefiIdle.audioStatus().bands.bass > .01", "the real local WAV reaches the reactive FFT bands");
    report.musicAudio = await this.run("return window.MefiIdle.audioStatus();");
    await this.until("window.MefiIdle.debugNodes().some(node => node.kind === 'music')", "music is a selectable graph node");
    await this.capture('13-local-reactive');
    await this.click('#idle-music-toggle');
    assert.equal(await this.run("return window.MefiMusic.status().playing;"), true, "disabling reactivity keeps the player's audio running");
    await this.click('#cmd-dock [data-nav="music"]');
    await this.click('#music-play');
    assert.equal(await this.run("return window.MefiMusic.status().playing;"), false);
    this.check("Real WAV playback, next, seeking and pause work; Command analyses the local player without capture");
    await this.click('#music-play');
    await this.click('#music-close');
    await this.click('#idle-music-toggle');
    await this.until("window.MefiIdle.audioStatus().energy > .01", "local reactivity reconnects from its existing audio source");
    await this.click('#cmd-dock [data-nav="music"]');
    await this.click('#music-spotify-tab');
    assert.equal(await this.run("const status=window.MefiIdle.audioStatus();return !status.listening&&!status.pending&&status.energy===0&&window.__musicCaptureAttempts===0;"), true, "source switching releases local reactivity without arming desktop capture");
    await this.run("document.getElementById('music-spotify-url').value='https://open.spotify.com/playlist/37i9dQZF1DX7zqr9q1MPG7';");
    await this.click('#music-spotify-load');
    await this.until("Boolean(document.querySelector('#music-overlay iframe'))", "Spotify iframe is mounted");
    let spotifyFrame = null;
    let spotifyFrameText = '';
    for (let attempt=0;attempt<50;attempt++) {
      spotifyFrame = this.webContents.mainFrame.frames.find(frame => frame.url === 'https://open.spotify.com/embed/playlist/37i9dQZF1DX7zqr9q1MPG7');
      if (spotifyFrame) {
        try { spotifyFrameText = await spotifyFrame.executeJavaScript('document.body?.textContent || ""'); } catch {}
        if (spotifyFrameText.includes('Offline Spotify frame fixture')) break;
      }
      await sleep(100);
    }
    assert(spotifyFrame, "the validated Spotify origin loads inside Studio's CSP");
    assert(spotifyFrameText.includes('Offline Spotify frame fixture'), "Spotify frame content came only from the isolated local response");
    report.spotifyFrame = {url:spotifyFrame.url,mode:'local protocol response fixture; no live Spotify playback tested'};
    assert.equal(await this.run("return window.MefiMusic.status().externalPlayback && !window.MefiMusic.status().playing;"), true, "embedded playback state stays explicitly unknown");
    await this.capture('13b-spotify-embed-fixture');
    await this.click('#music-local-tab');
    assert.equal(await this.run("return document.querySelectorAll('#music-overlay iframe').length;"), 0, "returning local unloads Spotify playback");
    await this.run("document.querySelector('#music-queue .music-track-remove').click(); document.querySelector('#music-queue .music-track-remove').click();");
    assert.equal(await this.run("const status=window.MefiIdle.audioStatus();return window.MefiMusic.status().queueLength===0&&!status.listening&&!status.pending&&status.energy===0&&window.__musicCaptureAttempts===0;"), true, "removing the last track releases the analyser without requesting capture");
    this.check("Canonical Spotify iframe passes CSP using a local protocol fixture; source switching unloads it without claiming live playback");
    await this.click('#music-recommend');
    await this.until("document.getElementById('music-recommendation').dataset.error === 'true'", "disconnected recommendations fail visibly");
    assert.equal(report.musicRequests, 1, "recommendations request only follows a button click");
    await this.run("window.MefiMusic.setRecommender(async()=>({ok:true,suggestions:[{title:'Fixture soundscape',artist:'Fixture artist',reason:'A calm instrumental direction.',query:'Fixture soundscape'}]}));");
    await this.click('#music-recommend');
    await this.until("document.getElementById('music-recommendation').textContent.includes('Fixture soundscape')", "assistant suggestions render from actual returned data");
    assert.equal(await this.run("return document.querySelectorAll('.music-suggestion-search').length;"), 1);
    await this.capture('14-music-suggestions');
    this.setContentSize(820,760); await sleep(200);
    const fits = await this.run("const r=document.querySelector('.music-sheet').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1&&r.y>=0&&r.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1;");
    assert.equal(fits, true, "music room fits narrow windows");
    await this.capture('15-music-narrow');
    this.setContentSize(1463,943); await sleep(150);
    await this.click('.music-theme[data-theme="gold"]');
    await this.click('#music-close');
    this.check("AI recommendations remain explicit, errors are visible, returned suggestions are usable and music fits narrow windows");
  }
  async verify() {
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden", "fixture home ready");
    if (config.interactive) {
      await this.run("window.MefiNav.go('command');");
      this.setTitle("Studio UI Test — disposable music and Command fixture");
      this.show();
      await new Promise((resolve) => this.once('closed', resolve));
      return;
    }
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 66);
    assert.equal((await this.run("return (await window.mefiStudio.ideasList()).ideas;")).length, 105);
    await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle?.isActive?.() && window.MefiIdle.status().nodes > 15", "Command dense graph ready");
    await this.until("document.getElementById('idle-feed-now')?.textContent.includes('Refine the project switcher')", "synthetic current work appears");
    this.webContents.send('eyes:assistant', {state: await fixtureAssistantPromise, event:{kind:'agent',role:'reference',status:'running',at:Date.now(),text:'reference is checking the current task',target:{kind:'task',id:'command_task_00'}}});
    await this.run("window.MefiIdle.setOrbit(false); window.MefiIdle.fitAll();");
    await sleep(450);
    this.check("Dense real board fixture loads with read-only synthetic session and worker status");

    for (const [width,height,name] of [[1920,1200,'01-wide'],[1463,943,'02-desktop'],[1280,720,'03-short'],[900,900,'04-narrow']]) {
      this.setContentSize(width,height);
      await sleep(200);
      await this.run("window.MefiIdle.fitAll();");
      await sleep(350);
      await this.layout(name);
      await this.capture(name);
    }
    this.check("Command controls, dock and graph remain accessible at four window sizes");
    this.setContentSize(1463,943);
    await sleep(200);
    if (!config.baseline) {
      assert.equal(await this.run("return document.getElementById('idle-feed-log-section')?.open;"), false, "technical log is closed by default");
      assert.equal(await this.run("return document.getElementById('idle-feed-agent-section')?.open;"), false, "full roster is closed by default");
      const current = await this.run("return document.getElementById('idle-feed-now').textContent;");
      assert(current.includes('Refine the project switcher'), "current work names the real job");
      assert(current.includes('Checking keyboard navigation'), "current stage names the worker's actual todo");
      await this.click('#idle-feed-log-section > summary');
      await this.capture('05-work-log');
      assert.equal(await this.run("return document.getElementById('idle-feed-log-section').open;"), true);
      await this.click('#idle-feed-log-section > summary');
      await this.click('#idle-feed-agent-section > summary');
      await this.capture('06-agent-details');
      await this.click('#idle-feed-agent-section > summary');
      this.check("Named current work and actual stage stay primary while roster and technical log are disclosures");
      if (await this.run("return Boolean(document.getElementById('cmd-more-tools'));")) {
        this.webContents.focus();
        await this.run("window.__commandKeys = []; for (const type of ['keydown','keypress','keyup']) window.addEventListener(type,event=>window.__commandKeys.push({type,key:event.key,target:event.target.tagName,prevented:event.defaultPrevented})); document.querySelector('#cmd-more-tools > summary').focus();");
        this.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
        this.webContents.sendInputEvent({type:'char',keyCode:'\r'});
        this.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
        await sleep(100);
        report.keyboard = await this.run("return {keys:window.__commandKeys,active:document.activeElement?.tagName,open:document.getElementById('cmd-more-tools').open};");
        await this.until("document.getElementById('cmd-more-tools').open", "keyboard opens More tools");
        await this.capture('07-more-tools');
        assert.equal(await this.run("return document.getElementById('cmd-more-tools').open;"), true);
        await this.click('#cmd-more-tools > summary');
        this.check("Consolidated navigation tools open by keyboard without replacing primary work controls");
      }
      assert.equal(await this.run("return document.getElementById('idle-music-toggle').getAttribute('aria-pressed');"), 'false', "audio capture starts off");
      await this.click('#idle-ambience');
      await this.until("!document.getElementById('idle-ambience-pop').hidden", "Ambience opens");
      assert.equal(await this.run("return document.getElementById('idle-source').value;"), 'desktop', "music source is explicit");
      assert.equal(await this.run("return document.getElementById('idle-reactive').checked;"), false, "opening settings does not enable capture");
      await this.capture('07b-music-settings');
      await this.click('#idle-ambience');
      this.check("Music control and source settings are visible without requesting audio capture");
      await this.verifyParallelBuilds();
      await this.verifyFollow();
      await this.verifyMusic();
    }

    await this.run("const input = document.getElementById('idle-search'); input.value = 'Refine the project switcher'; input.dispatchEvent(new Event('input',{bubbles:true}));");
    await this.until("window.MefiIdle.status().matches > 0", "search identifies current work");
    await this.capture('08-find-work');
    const selection = await this.run("const node = window.MefiIdle.debugNodes().find(node => node.kind === 'task' && node.label === 'Refine the project switcher'); if (!node) throw new Error('Current task missing from graph'); window.MefiIdle.select(node.id); return node;");
    await this.until("!document.getElementById('idle-info').hidden", "task detail opens from graph");
    await this.capture('09-selected-task');
    report.selectedNode = selection;
    this.check("Graph search and selection expose the current task's details");

    await this.run("window.MefiNav.go('tasks',{taskId:'command_task_00'});");
    await this.until("!document.getElementById('tasks-overlay').hidden && document.getElementById('task-title').textContent.includes('Refine the project switcher')", "task board opens matching work");
    await this.capture('10-task-detail');
    await this.click('#tasks-close');
    await this.until("window.MefiIdle.isActive() && document.getElementById('tasks-overlay').hidden", "Command returns after detail");
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace.isActive() && !window.MefiIdle.isActive()", "return home closes Command");
    this.check("Selected work opens its existing task board and navigation returns to Workspace");

    assert.equal(report.networkAttempts.length,0,"fixture never attempts external requests");
    assert.equal(report.workerAttempts.length,0,"synthetic workers never start a process");
    const serious=report.consoleErrors.filter(line=>!/ERR_FILE_NOT_FOUND/.test(line));
    assert.equal(serious.length,0,`Renderer errors: ${serious.join('; ')}`);
  }
}
global.__MefiVerifiedWindow = VerifiedWindow;
require('./main.cjs');
if (!config.interactive) setTimeout(()=>finish(new Error('Command verification exceeded 70 seconds')),70000).unref();
'''


def bootstrap(config):
    prefix = WORKSPACE_BOOTSTRAP.split("  async verify() {", 1)[0]
    if config.get("interactive"):
        prefix = prefix.replace("offscreen: true", "offscreen: false")
    prefix = prefix.replace("const config = __CONFIG__;", "const config = __CONFIG__;\n" + r'''
const fixtureAssistantPromise = import('./scripts/assistant.mjs').then(module => {
  const state = module.emptyState();
  Object.assign(state, config.fixture.assistant);
  return state;
});
const childProcess = require('node:child_process');
''')
    prefix = prefix.replace("const report = { checks: [], screenshots: [], networkAttempts: [], consoleErrors: [] };", "const report = { checks: [], screenshots: [], networkAttempts: [], consoleErrors: [], workerAttempts: [] };\nchildProcess.spawn = (...args) => { report.workerAttempts.push(String(args[0])); throw new Error('Process launching is disabled by the isolated Command fixture'); };")
    marker = '  if (channel === "assistant:message" && failNextMessage) {'
    fixture_reads = r'''
  if (channel === 'eyes:state') return {ok:true,...config.fixture.store};
  if (channel === 'eyes:todos') return {ok:true,todos:config.fixture.store.todos};
  if (channel === 'eyes:changes') return {ok:true,changes:config.fixture.store.changes};
  if (channel === 'assistant:state') return fixtureAssistantPromise.then(state=>({ok:true,state}));
  if (channel === 'assistant:status') return {ok:true,status:config.fixture.autopilot};
  if (channel === 'assistant:autopilot') {
    const patch=args[0]||{};
    (report.parallelRequests ||= []).push({...patch});
    config.fixture.autopilot.parallel=Math.max(1,Math.min(3,Math.round(Number(patch.parallel)||2)));
    return {ok:true,...config.fixture.autopilot};
  }
  if (channel === 'machine:status') return {ok:true,status:{updatedAt:Date.now(),running:[],strays:[],leases:{exclusive:false},lines:'fixture machine idle'}};
  if (channel === 'eyes:collisions') return {ok:true,collisions:[],presence:[]};
  if (channel === 'eyes:log') return {ok:true,text:'Fixture: keyboard navigation checks are running.'};
  if (channel === 'studio:cli-status') return [];
  if (channel === 'music:recommend') { report.musicRequests = (report.musicRequests || 0) + 1; return {ok:false,error:'Music recommendations are disconnected in this isolated fixture.'}; }
'''
    prefix = prefix.replace(marker, fixture_reads + marker)
    prefix = prefix.replace('[workspace-ui]', '[command-ui]').replace('[workspace-check]', '[command-check]')
    # A single whitelisted Spotify embed receives a local response. Every
    # other network request remains blocked, including subresources.
    old_network_guard = '''electron.app.whenReady().then(() => {
  electron.session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    report.networkAttempts.push(details.url);
    callback({ cancel: true });
  });
});'''
    fixture_network_guard = '''electron.app.whenReady().then(() => {
  const fixtureURL = 'https://open.spotify.com/embed/playlist/37i9dQZF1DX7zqr9q1MPG7';
  const session = electron.session.defaultSession;
  session.protocol.interceptBufferProtocol('https', (request, callback) => {
    if (request.url !== fixtureURL) return callback({error:-10});
    report.fixtureEmbeds = (report.fixtureEmbeds || 0) + 1;
    callback({mimeType:'text/html',data:Buffer.from('<!doctype html><html><head><title>Offline Spotify fixture</title></head><body style="background:#172c20;color:#cde8d6;font:16px system-ui;padding:24px"><h2>Offline Spotify frame fixture</h2><p>This local test response verifies the embedded frame only.</p></body></html>')});
  });
  session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{
    if (details.url === fixtureURL) return callback({cancel:false});
    report.networkAttempts.push(details.url); callback({cancel:true});
  });
});'''
    if old_network_guard not in prefix:
        raise RuntimeError("Workspace network guard changed; update the isolated Spotify fixture before running.")
    prefix = prefix.replace(old_network_guard, fixture_network_guard, 1)
    return (prefix + VERIFY_METHOD).replace('__CONFIG__', json.dumps(config))


def fixture(project, now):
    titles = ["Refine the project switcher", "Save a durable task handoff", "Verify keyboard navigation", "Polish the progress view"]
    tasks = [{"id": f"command_task_{i:02d}", "projectId": project["id"], "projectPath": project["path"],
              "title": titles[0] if i == 0 else f"{titles[i % 4]} — backlog {i + 1}",
              "prompt": "Preserve existing project data, implement the smallest useful step, and verify keyboard navigation.",
              "status": "active" if i == 0 else "awaiting_verification" if i < 4 else "done" if i < 15 else "open",
              "createdAt": now - (i + 1) * 1200000, "updatedAt": now - i * 60000,
              "logs": [], "refs": [], "ideas": []} for i in range(66)]
    tasks[4]["dependsOn"] = ["command_task_00"]
    ideas = [{"id": f"command_idea_{i:03d}", "title": f"Saved workspace idea {i + 1}", "detail": "A small quality improvement with an explicit acceptance check.", "status": "new", "source": "manual", "at": now - i * 60000} for i in range(105)]
    sessions = [{"id": f"command_session_{i}", "title": title, "agent": "build", "model": "fixture/local", "timeCreated": now - 3600000, "timeUpdated": now - i * 90000, "parentId": None} for i, title in enumerate(titles)]
    todos = [{"sessionId": session["id"], "position": j, "content": "Checking keyboard navigation" if i == 0 and j == 1 else f"{session['title']}: step {j + 1}", "status": "completed" if j == 0 else "in_progress" if j == 1 else "pending", "priority": "medium"} for i, session in enumerate(sessions) for j in range(6)]
    roles = ["watcher", "machine", "auditor", "keeper", "compactor", "foreman", "thinker", "briefer", "overseer", "improver", "ideas", "grower", "reference", "responder"]
    agents = [{"role": role, "status": "running" if role in ("reference", "auditor") else "queued" if role == "keeper" else "error" if role == "briefer" else "done" if i % 2 == 0 else "idle", "text": "Checking keyboard navigation" if role == "auditor" else f"{role} fixture activity", "since": now - 30000, "lastRunAt": now - 60000, "runs": 3, "progress": .4 if role == "reference" else None, "target": {"kind": "task", "id": "command_task_00"}, "targets": [{"kind": "task", "id": "command_task_00"}]} for i, role in enumerate(roles)]
    messages = [{"id": "fixture_user", "at": now - 90000, "role": "user", "text": "Make the project switcher easier to use.", "via": "local"}, {"id": "fixture_reply", "at": now - 80000, "role": "assistant", "text": "I’m checking keyboard navigation on the project switcher. The task board keeps its saved requirements and earlier findings.", "via": "fixture"}]
    logs = [{"at": now - i * 2000, "kind": "tool" if i % 2 else "tick", "text": f"Fixture progress {i + 1}: checking saved work and keyboard behavior"} for i in range(12)]
    assistant = {"status": "running", "agents": agents, "messages": messages, "log": logs, "prefs": {"proactive": False, "keepAwake": False, "background": False, "backlogMode": True}, "heartbeatAt": now, "action": {"kind": "working", "text": "Checking keyboard navigation", "since": now - 30000}, "work": [], "unread": 1}
    status = {"enabled": True, "execute": True, "parallel": 1, "running": [{"title": titles[0], "taskId": "command_task_00", "sessionId": "command_session_0", "projectId": project["id"], "startedAt": now - 95000, "source": "chat", "progress": .4}], "queueDepth": 51, "waiting": None, "history": [{"at": now - 20000, "kind": "run", "text": "Working on keyboard navigation"}], "foreman": {"status": "done", "text": "Handed current work to the builder", "lastRunAt": now - 20000}}
    store = {"sessions": sessions, "todos": todos, "changes": [{"id": f"change_{i}", "sessionId": "command_session_0", "time": now - i * 10000, "tool": "edit", "file": f"renderer/component_{i}.js", "additions": i + 2, "deletions": 1} for i in range(7)], "pngs": []}
    return tasks, ideas, {"assistant": assistant, "autopilot": status, "store": store}


def verify(source, output, baseline=False, interactive=False):
    electron = ROOT / "node_modules/electron/dist/electron.exe"
    if not electron.is_file():
        raise RuntimeError("Install Electron with npm ci before verifying Command.")
    destination = output / ("baseline" if baseline else "final")
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mefi-command-ui-") as folder:
        temporary = Path(folder)
        app_root = temporary / "app"
        app_root.mkdir()
        for name in ("main.cjs", "preload.cjs", "README.md", "TESTRUNS.md", ".gitignore"):
            shutil.copy2(source / name, app_root / name)
        for name in ("scripts", "renderer", "assets", "tests"):
            shutil.copytree(source / name, app_root / name)
        (app_root / "tools").mkdir()
        for item in (source / "tools").iterdir():
            if item.is_file() and item.suffix in (".json", ".py"):
                shutil.copy2(item, app_root / "tools" / item.name)
        (app_root / "data").mkdir()
        for name in ("curated.json", "models.json"):
            shutil.copy2(source / "data" / name, app_root / "data" / name)
        subprocess.run(["node", str(app_root / "scripts/build-booklet.mjs")], cwd=app_root, check=True, capture_output=True, text=True, timeout=30)
        project = temporary / "Workspace fixture"
        project.mkdir()
        (project / "README.md").write_text("Disposable Command verification project.\n", encoding="utf-8")
        profile = temporary / "profile"
        (profile / "session").mkdir(parents=True)
        project_info = {"id": project_id(project), "name": project.name, "path": str(project)}
        write_json(profile / "settings.json", {"machine": {"autoKill": False}, "assistant": {"background": False, "keepAwake": False, "proactive": False}, "projects": {"activeId": project_info["id"], "items": [project_info]}, "ui": {"useWeb": False, "autoReference": False, "autopilot": {"enabled": False, "execute": False}}})
        now = int(time.time() * 1000)
        tasks, ideas, data = fixture(project_info, now)
        write_json(app_root / "data/eyes-tasks.json", tasks)
        write_json(app_root / "data/eyes-feature-ideas.json", ideas)
        write_json(app_root / "data/eyes-requests.json", [{"title": f"Verify backlog work {i + 1}", "prompt": "Keep the stored acceptance checks.", "source": "chat", "at": now - i * 60000} for i in range(8)])
        package = json.loads((source / "package.json").read_text(encoding="utf-8"))
        package["main"] = "command-verify-entry.cjs"
        write_json(app_root / "package.json", package)
        config = {"profile": str(profile), "appRoot": str(app_root), "output": str(destination), "alpha": project_info, "baseline": baseline, "fixture": data, "interactive": interactive}
        (app_root / package["main"]).write_text(bootstrap(config), encoding="utf-8")
        main = app_root / "main.cjs"
        instrumented = main.read_text(encoding="utf-8")
        for before, after in [("new BrowserWindow({", "new global.__MefiVerifiedWindow({"), ("setTimeout(() => startMachineWatch(), 2500);", "/* no fixture machine watcher */"), ("if (!CAPTURE && !CLI_MODE) setTimeout(() => startAssistant()", "if (false) setTimeout(() => startAssistant()"), ('if (SMOKE) {\n    window.webContents.once("did-finish-load", async () => {', 'if (false) {\n    window.webContents.once("did-finish-load", async () => {')]:
            if instrumented.count(before) != 1:
                raise RuntimeError(f"Harness instrumentation target changed: {before}")
            instrumented = instrumented.replace(before, after, 1)
        main.write_text(instrumented, encoding="utf-8")
        env = {key: value for key, value in os.environ.items() if not any(token in key.upper() for token in ("API_KEY", "API_TOKEN", "GATEWAY_KEY", "STUDIO_KEY", "STUDIO_ZAI_KEY"))}
        for name in ("ELECTRON_RUN_AS_NODE", "OPENCODE_CONFIG_CONTENT"):
            env.pop(name, None)
        env.update(HOME=str(profile), USERPROFILE=str(profile), APPDATA=str(profile / "AppData/Roaming"), LOCALAPPDATA=str(profile / "AppData/Local"), MEFI_STUDIO_BOARD_DB=str(profile / "board.db"), MEFI_STUDIO_REPO=str(project), MEFI_STUDIO_GAME_ROOT=str(temporary / "absent-game"))
        for name in ("APPDATA", "LOCALAPPDATA"):
            Path(env[name]).mkdir(parents=True)
        with (destination / "electron.log").open("w", encoding="utf-8") as log:
            process = subprocess.Popen([str(electron), ".", "--smoke"], cwd=app_root, env=env, stdout=log, stderr=log)
            try:
                process.wait(timeout=3600 if interactive else 80)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
                process.wait(timeout=10)
                raise RuntimeError(f"Command UI verification timed out: {destination / 'electron.log'}")
        report_path = destination / "report.json"
        if not report_path.is_file():
            raise RuntimeError(f"Electron exited {process.returncode} without a report: {destination / 'electron.log'}")
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if process.returncode or not report.get("ok"):
            raise RuntimeError(f"{report.get('error', 'Command verification failed')}\nSee {destination / 'electron.log'}")
        return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=ROOT / "tools/logs/command-ui")
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--interactive", action="store_true", help="Open a visible disposable fixture for manual or computer-use checks")
    args = parser.parse_args()
    result = verify(args.source.resolve(), args.output.resolve(), args.baseline, args.interactive)
    print(f"Command UI verified: {len(result['checks'])} checks, {len(result['screenshots'])} screenshots in {args.output.resolve()}")
