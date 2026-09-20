"""Verify Command against a dense, isolated Electron fixture, without workers.

python tools/verify_command.py [--baseline] [--node-readability] [--output tools/logs/command-ui]

Uses the Workspace harness's offscreen window, logging and network guard. All
board files, projects and Electron settings live in a temporary directory. A
read-only IPC fixture supplies four sessions (eight for node readability) and synthetic worker/roster status;
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
  async dismissOnboarding() {
    // Exercise the public close control rather than seeding a private guide
    // preference: fresh profiles now open the resumable first-run walkthrough.
    if (await this.run("return Boolean(document.getElementById('walkthrough-overlay') && !document.getElementById('walkthrough-overlay').hidden);")) {
      await this.click('[data-nav-close="onboarding"]');
      await this.until("document.getElementById('walkthrough-overlay').hidden", 'Save & close dismisses the first-run walkthrough');
      (report.onboardingDismissals ||= []).push({at:Date.now(),control:'Save & close'});
    }
  }
  async layout(name, strict = true) {
    const layout = await this.run(`
      for(let frame=0;frame<8;frame++) {
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const nodes=window.MefiIdle.debugNodes();
        if(nodes.length>=10 && nodes.every(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)))break;
        if(frame===7)throw new Error('Layout did not receive a complete painted frame');
      }
      const rect = (selector) => { const el = document.querySelector(selector); if (!el || el.hidden || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return r.width && r.height ? r.toJSON() : null; };
      const viewport = window.MefiIdle.graphViewport?.() || {x:innerWidth * .3,y:180,w:innerWidth * .4,h:innerHeight - 290};
      const center = document.elementFromPoint(viewport.x + viewport.w/2, viewport.y + viewport.h/2);
      return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,viewport,
        centerId:center?.id,centerTag:center?.tagName, nodes:window.MefiIdle.debugNodes(),graph:window.MefiIdle.status(),
        header:rect('.cmd-top'),feed:rect('#idle-feed'),chat:rect('#cmd-chat'),selected:rect('#idle-info'),
        dock:rect('#cmd-dock'),search:rect('.cmd-search'),composer:rect('.cmd-composer'),tools:rect('.cmd-tools'),music:rect('#idle-music-toggle'),canvas:rect('#idle-layer'),
        follow:rect('#idle-follow-status'),legend:rect('#cmd-legend'),ambience:rect('#idle-ambience-pop')};
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
  async verifyAutoOverview() {
    await this.run("window.MefiIdle.clearSearch(); window.MefiIdle.setLabels('auto'); window.MefiIdle.setOrbit(false);");
    report.autoOverview = [];
    const intersections = (a,b) => Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>2 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>2;
    const activeTaskIds = new Set(config.fixture.autopilot.running.map(job=>`task:${job.taskId}`));
    for (const [width,height,name] of [[1460,943,'07g-auto-active-desktop'],[900,900,'07h-auto-active-narrow']]) {
      this.setContentSize(width,height);
      await sleep(250);
      await this.run("window.MefiIdle.fitAll();");
      await sleep(450);
      const samples = [];
      // Inspect several real draw frames: a screenshot alone can miss labels
      // crossing one another as the layout finishes easing after a resize.
      for (let frame=0;frame<3;frame++) {
        if (frame) await sleep(180);
        const layout = await this.layout(`${name}-frame-${frame+1}`);
        assert.equal(layout.graph.labels,'auto',`${name}: the capture exercises Auto labels`);
        assert.equal(layout.graph.query,'',`${name}: no search filter conceals the dense backlog`);
        const area=layout.viewport;
        const budget=area.w<480 || area.h<400 ? 4 : area.w<800 || area.h<480 ? 6 : 8;
        const visible=layout.nodes.filter(node=>node.labelRect || node.cardRect);
        const cards=layout.nodes.filter(node=>node.cardRect);
        const workNodes=layout.nodes.filter(node=>activeTaskIds.has(node.id));
        assert.equal(workNodes.length,activeTaskIds.size,`${name}: all three running tasks remain in the node tree`);
        for (const node of workNodes) {
          assert(['circle','orb'].includes(node.shape),`${name}: active ${node.id} keeps the restored orb appearance`);
          assert(Number.isFinite(node.x) && Number.isFinite(node.y) && node.radius>0,`${name}: active ${node.id} has a real drawn orb`);
          assert(node.x-node.radius>=area.x-2 && node.y-node.radius>=area.y-2 && node.x+node.radius<=area.x+area.w+2 && node.y+node.radius<=area.y+area.h+2,`${name}: active ${node.id} orb stays inside the clear graph viewport`);
        }
        assert(visible.length>0,`${name}: Auto draws useful labels rather than hiding every name`);
        assert(visible.length<=budget,`${name}: ${visible.length} drawn labels/cards respect the ${budget}-item Auto budget`);
        assert(visible.some(node=>activeTaskIds.has(node.id)),`${name}: Auto names actual running work`);
        const painted=visible.flatMap(node=>['labelRect','cardRect'].filter(key=>node[key]).map(key=>({id:node.id,kind:node.kind,type:key,rect:node[key]})));
        const controls=['header','feed','chat','selected','dock','search','composer','tools','follow','legend','ambience'].filter(key=>layout[key]).map(key=>({id:key,rect:{x:layout[key].x,y:layout[key].y,w:layout[key].width,h:layout[key].height}}));
        for (const [index,item] of painted.entries()) {
          const box=item.rect;
          assert([box.x,box.y,box.w,box.h].every(Number.isFinite) && box.w>0 && box.h>0,`${name}: ${item.type} for ${item.id} has finite drawn bounds`);
          assert(box.x>=area.x-2 && box.y>=area.y-2 && box.x+box.w<=area.x+area.w+2 && box.y+box.h<=area.y+area.h+2,`${name}: ${item.type} for ${item.id} fits the clear graph viewport`);
          for (const other of painted.slice(0,index)) {
            if (other.id!==item.id) assert(!intersections(box,other.rect),`${name}: drawn ${item.id} ${item.type} overlaps ${other.id} ${other.type}`);
          }
          for (const control of controls) assert(!intersections(box,control.rect),`${name}: drawn ${item.id} ${item.type} overlaps the ${control.id} controls`);
        }
        const positions=layout.nodes.filter(node=>Number.isFinite(node.x) && Number.isFinite(node.y)).map(node=>({id:node.id,kind:node.kind,x:node.x,y:node.y}));
        if (samples.length) this.assertStableNodes(samples[0].positions,positions,`${name}: unchanged work nodes stay fixed between draw frames`);
        samples.push({frame:frame+1,budget,viewport:area,positions,workNodes,visible:visible.map(node=>({id:node.id,kind:node.kind,label:node.label,shape:node.shape,labelRect:node.labelRect,cardRect:node.cardRect})),cards:cards.length});
      }
      report.autoOverview.push({name,width,height,samples});
      await this.capture(name);
    }
    this.setContentSize(1463,943);
    await sleep(200);
    await this.run("window.MefiIdle.fitAll();");
    this.check("Auto keeps three running work orbs visible at desktop and narrow widths; drawn labels stay within their density budget and avoid each other and controls across repeated frames");
  }
  async verifyNodeReadability() {
    const activeIds=new Set(config.fixture.autopilot.running.map(job=>`task:${job.taskId}`));
    assert.equal(activeIds.size,6,'readability fixture exercises six concurrent builders');
    assert.equal(config.fixture.store.sessions.length,8,'readability fixture exercises eight saved sessions');
    await this.run("window.MefiMusic.applyTheme('aurora');window.MefiMusic.applyNodeStyle('orbs');window.MefiMusic.applyNodeLayout('constellation');window.MefiMusic.applyNodeEffects({orbitTrails:true,extraGlow:true});window.MefiIdle.clearSearch();window.MefiIdle.setLabels('auto');window.MefiIdle.setOrbit(false);");
    for(const [id,expanded] of [['idle-feed-toggle',false],['cmd-chat-toggle',true]]) {
      if(await this.run(`return document.getElementById(${JSON.stringify(id)}).getAttribute('aria-expanded');`)!==String(expanded))await this.click(`#${id}`);
    }
    await this.until("document.getElementById('idle-feed-toggle').getAttribute('aria-expanded')==='false' && document.getElementById('cmd-chat-toggle').getAttribute('aria-expanded')==='true'",'Live work collapses while Assistant stays expanded');
    const overlaps=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1;
    const gap=(node,box)=>Math.max(0,Math.hypot(Math.max(box.x-node.x,0,node.x-box.x-box.w),Math.max(box.y-node.y,0,node.y-box.y-box.h))-node.radius);
    report.nodeReadability={cases:[],failures:[],baseline:Boolean(config.baseline)};
    const requireReadable=(condition,message)=>{if(!condition)report.nodeReadability.failures.push(message);};
    for(const [width,height,size] of [[1916,1170,'wide'],[1463,943,'desktop']]) {
      this.setContentSize(width,height);await sleep(200);
      for(const view of ['3d','2d']) {
        const name=`readability-${size}-${view}`;
        await this.run(`window.MefiIdle.setView(${JSON.stringify(view)});window.MefiIdle.fitAll();`);
        this.webContents.sendInputEvent({type:'mouseMove',x:400,y:40});
        await sleep(500);
        const samples=[];
        for(let frame=0;frame<3;frame++) {
          if(frame)await sleep(160);
          const layout=await this.layout(`${name}-frame-${frame+1}`,false);
          const extra=await this.run("return {geometry:window.MefiIdle.geometryStatus(),camera:window.MefiIdle.settingsPreviewStatus(),centres:window.MefiIdle.debugNodes().filter(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)).map(node=>({id:node.id,hit:document.elementFromPoint(node.x,node.y)?.id}))};");
          const nodes=layout.nodes.filter(node=>Number.isFinite(node.x)&&Number.isFinite(node.y));
          const active=nodes.filter(node=>activeIds.has(node.id));
          const labels=nodes.filter(node=>node.labelRect);
          const controls=['header','feed','chat','selected','dock','search','composer','tools','follow','legend','ambience'].filter(key=>layout[key]).map(key=>({id:key,rect:{x:layout[key].x,y:layout[key].y,w:layout[key].width,h:layout[key].height}}));
          requireReadable(layout.graph.labels==='auto' && layout.graph.orbit==='paused',`${name}: Auto labels and paused orbit remain selected`);
          requireReadable(active.length===6,`${name}: all six running tasks remain visible`);
          for(const node of active) {
            requireReadable(Boolean(node.labelRect),`${name}: ${node.id} has a readable task name`);
            if(node.labelRect) {
              requireReadable(gap(node,node.labelRect)<=80,`${name}: ${node.id} label is ${gap(node,node.labelRect).toFixed(1)}px from its orb`);
              requireReadable(node.labelLines?.length>=1 && node.labelLines.length<=2,`${name}: ${node.id} paints one or two readable title lines`);
              requireReadable(node.labelLines?.join(' ')===node.label,`${name}: ${node.id} retains its complete task title`);
            }
          }
          for(const entry of extra.centres)requireReadable(entry.hit==='idle-layer',`${name}: ${entry.id} orb is obscured by ${entry.hit}`);
          for(const node of nodes)for(const control of controls)requireReadable(gap({...node,radius:node.orbitTrail?.radius??node.radius},control.rect)>=2,`${name}: ${node.id} orb touches ${control.id}`);
          for(const [index,node] of labels.entries()) {
            const box=node.labelRect,area=layout.viewport;
            requireReadable(box.x>=area.x-1 && box.y>=area.y-1 && box.x+box.w<=area.x+area.w+1 && box.y+box.h<=area.y+area.h+1,`${name}: ${node.id} label fits the clear graph viewport`);
            for(const previous of labels.slice(0,index))requireReadable(!overlaps(box,previous.labelRect),`${name}: ${node.id} label overlaps ${previous.id}`);
            for(const control of controls)requireReadable(!overlaps(box,control.rect),`${name}: ${node.id} label overlaps ${control.id}`);
            for(const other of nodes.filter(other=>other.id!==node.id))requireReadable(gap(other,box)>=3,`${name}: ${node.id} label touches ${other.id} orb`);
          }
          if(samples.length) {
            const first=samples[0],byId=new Map(nodes.map(node=>[node.id,node]));
            for(const previous of first.layout.nodes.filter(node=>node.kind!=='agent')) {
              const next=byId.get(previous.id);
              requireReadable(next && Math.hypot(next.x-previous.x,next.y-previous.y)<=1,`${name}: ${previous.id} stays fixed between unchanged frames`);
            }
            requireReadable(Math.abs(extra.geometry.angle-first.geometry.angle)<.0001 && Math.abs(extra.geometry.pitch-first.geometry.pitch)<.0001,`${name}: paused camera keeps its angle`);
            requireReadable(JSON.stringify(extra.camera.camera)===JSON.stringify(first.camera.camera) && extra.camera.zoom===first.camera.zoom,`${name}: paused camera keeps its position and zoom`);
          }
          samples.push({layout,...extra,activeLabelGaps:active.filter(node=>node.labelRect).map(node=>({id:node.id,gap:gap(node,node.labelRect)}))});
        }
        report.nodeReadability.cases.push({name,width,height,view,samples});
        await this.capture(name);
      }
    }
    report.nodeReadability.failures=[...new Set(report.nodeReadability.failures)];
    if(!config.baseline)assert.equal(report.nodeReadability.failures.length,0,report.nodeReadability.failures.join('\n'));
    this.check(config.baseline?'Captured the six-builder readability baseline and recorded its geometry failures':'Six concurrent long task names stay close to their unobscured orbs, clear other labels and controls, and keep a stable camera in 3D and 2D at wide and desktop sizes');
  }
  assertStableNodes(before,after,label) {
    const current=new Map(after.map(node=>[node.id,node]));
    // Agent satellites may travel to their real targets; work nodes and hubs
    // keep their locations while those agents join, move, or leave.
    const fixed=before.filter(node=>node.kind!=='agent');
    assert(fixed.length>=10,`${label}: the fixture covers a populated tree`);
    for (const node of fixed) {
      const next=current.get(node.id);
      assert(next,`${label}: existing ${node.id} remains present`);
      const drift=Math.hypot(next.x-node.x,next.y-node.y);
      assert(drift<=1,`${label}: ${node.id} moved ${drift.toFixed(2)}px`);
    }
  }
  async verifyStableNodes() {
    const snapshot=()=>this.run("for(let frame=0;frame<8;frame++){await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const nodes=window.MefiIdle.debugNodes();if(nodes.length>10&&nodes.every(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)))return nodes.map(node=>({id:node.id,kind:node.kind,x:node.x,y:node.y}));}throw new Error('Stable-node check did not receive a complete painted frame');");
    await sleep(350);
    const before=await snapshot();
    const assistant=await fixtureAssistantPromise;
    const watcher=assistant.agents.find(agent=>agent.role==='watcher');
    assert(watcher,'fixture includes a dormant watcher role');
    const original={...watcher};
    const id='__agent__:watcher';
    assert(!before.some(node=>node.id===id),'dormant roles do not clutter the active graph');
    try {
      Object.assign(watcher,{status:'running',text:'Watching the current task',since:Date.now()});
      this.webContents.send('eyes:assistant',{state:assistant,event:{kind:'agent',role:'watcher',status:'running',at:Date.now(),text:'watcher started fixture check',target:{kind:'task',id:'command_task_00'}}});
      await this.until(`window.MefiIdle.debugNodes().some(node=>node.id===${JSON.stringify(id)})`,'newly active watcher joins the tree');
      await sleep(300);
      const added=await snapshot();
      this.assertStableNodes(before,added,'Adding one agent does not reshuffle existing nodes');
      await this.capture('07i-stable-agent-added');
      Object.assign(watcher,original);
      this.webContents.send('eyes:assistant',{state:assistant,event:{kind:'agent',role:'watcher',status:original.status,at:Date.now(),text:'watcher finished fixture check'}});
      await this.until(`!window.MefiIdle.debugNodes().some(node=>node.id===${JSON.stringify(id)})`,'finished watcher leaves the active tree');
      await sleep(250);
      const removed=await snapshot();
      this.assertStableNodes(before,removed,'Removing one agent does not reshuffle surviving nodes');
      await this.capture('07j-stable-agent-removed');
      report.stableNodes={before,added,removed,tolerancePx:1};
    } finally {
      Object.assign(watcher,original);
      this.webContents.send('eyes:assistant',{state:assistant,event:{kind:'agent',role:'watcher',status:original.status,at:Date.now(),text:'watcher fixture state restored'}});
    }
    this.check("Work nodes and hubs remain fixed between frames and when an active agent joins or leaves; dormant roles stay out of the active tree");
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
    // Workers are synthetic; use real open tasks instead of trying to set
    // host-owned active status through the task editor's save route.
    const titles = await this.run("const tasks=(await window.mefiStudio.tasksList()).tasks;const selected=tasks.filter(task=>['command_task_16','command_task_17'].includes(task.id));if(selected.length!==2 || selected.some(task=>task.status!=='open'))throw new Error('Parallel fixture requires two open tasks');return selected.map(task=>({id:task.id,title:task.title}));");
    for (const [index,task] of titles.entries()) config.fixture.autopilot.running.push({title:task.title,taskId:task.id,sessionId:`command_session_${index+1}`,projectId:config.alpha.id,startedAt:Date.now()-35000-index*12000,source:'fixture',progress:index===0?.2:.6});
    this.webContents.send('assistant:status', config.fixture.autopilot);
    await this.until("document.querySelectorAll('#idle-feed-now .feed-current-card').length===3 && document.getElementById('cmd-chat-state').textContent.includes('3 builds')", "three distinct builders appear together");
    await this.until("['command_task_00','command_task_16','command_task_17'].every(id=>window.MefiIdle.debugNodes().some(node=>node.id==='task:'+id))", "each synthetic builder owns a real task node");
    this.setContentSize(1280,720); await sleep(250);
    await this.run("document.getElementById('idle-feed-scroll').scrollTop=0;");
    const cards = await this.run("const rail=document.getElementById('idle-feed-now'),worklist=document.getElementById('idle-feed-scroll'),panel=document.getElementById('idle-feed');return {panel:panel.getBoundingClientRect().toJSON(),worklist:worklist.getBoundingClientRect().toJSON(),scroll:worklist.scrollHeight,client:worklist.clientHeight,scrollWidth:worklist.scrollWidth,clientWidth:worklist.clientWidth,overflow:getComputedStyle(worklist).overflowY,currentOverflow:getComputedStyle(rail).overflowY,activityOverflow:getComputedStyle(document.getElementById('idle-feed-activity')).overflowY,titles:[...rail.querySelectorAll('.feed-current-title')].map(el=>el.textContent),metrics:document.getElementById('idle-feed-metrics').getBoundingClientRect().toJSON(),capacity:document.getElementById('idle-feed-parallel').getBoundingClientRect().toJSON()};");
    assert.equal(cards.titles.length,3);
    for (const task of titles) assert(cards.titles.includes(task.title), "each concurrent build keeps its own title");
    assert(cards.worklist.height>=140 && cards.worklist.bottom<=cards.panel.bottom+1, "the shared work list keeps a usable bounded scroll area");
    assert.equal(cards.overflow,'auto');
    assert.equal(cards.currentOverflow,'visible', "current builds do not create a nested scroller");
    assert.equal(cards.activityOverflow,'visible', "attention and queue share the current-work scroller");
    assert(cards.scroll>cards.client, "additional builders and queue entries scroll in one work list");
    assert(cards.scrollWidth<=cards.clientWidth+1, "the shared work list never scrolls horizontally");
    assert(cards.metrics.bottom<=cards.worklist.top && cards.capacity.bottom<=cards.worklist.top, "readiness and worker controls remain above the scrolling work list");
    await this.capture('07c-parallel-builds');
    const later = await this.run("const worklist=document.getElementById('idle-feed-scroll'),title=document.querySelector('#idle-feed-now .feed-current-card:last-child .feed-current-title');worklist.scrollTop+=title.getBoundingClientRect().top-worklist.getBoundingClientRect().top;const box=worklist.getBoundingClientRect(),target=title.getBoundingClientRect();return {visible:target.top>=box.top-1&&target.bottom<=box.bottom+1,scrollTop:worklist.scrollTop,metrics:document.getElementById('idle-feed-metrics').getBoundingClientRect().toJSON(),capacity:document.getElementById('idle-feed-parallel').getBoundingClientRect().toJSON()};");
    assert(later.scrollTop>0 && later.visible, "scrolling the shared work list reaches the last builder's title");
    assert.equal(later.metrics.top,cards.metrics.top,"readiness metrics stay fixed while work scrolls");
    assert.equal(later.capacity.top,cards.capacity.top,"worker controls stay fixed while work scrolls");
    await this.capture('07d-parallel-builds-scrolled');
    const queue = await this.run("const worklist=document.getElementById('idle-feed-scroll'),queue=document.querySelector('.feed-upnext');worklist.scrollTop+=queue.getBoundingClientRect().top-worklist.getBoundingClientRect().top;const box=worklist.getBoundingClientRect(),target=queue.getBoundingClientRect();return {visible:target.top<box.bottom&&target.bottom>box.top,scrollTop:worklist.scrollTop};");
    assert(queue.visible && queue.scrollTop>0,"the same scroll area reaches queued work after all builders");
    await this.run("document.getElementById('idle-feed-scroll').scrollTop=0;");
    this.setContentSize(1463,943); await sleep(150);
    report.parallelLayout=cards;
    this.check("Parallel capacity saves only worker count; three named builders share one scroll area with queued work while readiness and worker controls stay fixed");
  }
  async verifyReadiness() {
    await this.until("document.querySelector('#idle-feed-metrics [data-state=blocked] strong')?.textContent === '3'", "blocked attempts have their own attention count");
    const panel=await this.run("const attention=document.getElementById('idle-feed-attention'),heading=[...attention.querySelectorAll('h3')].find(el=>el.textContent.includes('Needs attention')),review=[...attention.querySelectorAll('button')].find(el=>el.textContent.includes('Review all'));return {metrics:[...document.querySelectorAll('#idle-feed-metrics .feed-metric')].map(item=>({state:item.dataset.state,text:item.textContent})),attention:attention.textContent,heading:heading?.textContent,review:review?.textContent,reviewBeforeRows:Boolean(review&&attention.querySelector('.feed-attention-row')&&(review.compareDocumentPosition(attention.querySelector('.feed-attention-row'))&Node.DOCUMENT_POSITION_FOLLOWING))};");
    assert.equal(panel.metrics.length,4);
    assert(panel.heading?.includes('Needs attention'), 'blocked work has a readable section heading');
    assert(panel.review?.includes('Review all') && panel.reviewBeforeRows, 'the attention review action appears before blocker details');
    assert(panel.attention.includes('Missing prerequisite'), 'missing prerequisite includes a corrective reason');
    assert(panel.attention.includes('Completion could not be verified'), 'failed verification is visible');
    assert(panel.attention.includes('Next automatic retry in'), 'automatic retry has a visible ETA');
    for (const [width,height,name] of [[1463,943,'04b-attention-desktop'],[1280,720,'04c-attention-short'],[900,900,'04d-attention-narrow']]) {
      this.setContentSize(width,height); await sleep(180);
      await this.run("document.getElementById('idle-feed-scroll').scrollTop=0;");
      const bounds=await this.run("const panel=document.getElementById('idle-feed'),worklist=document.getElementById('idle-feed-scroll'),now=document.getElementById('idle-feed-now'),attention=document.getElementById('idle-feed-attention');return {panel:panel.getBoundingClientRect().toJSON(),worklist:worklist.getBoundingClientRect().toJSON(),now:now.getBoundingClientRect().toJSON(),attention:attention.getBoundingClientRect().toJSON(),metrics:document.getElementById('idle-feed-metrics').getBoundingClientRect().toJSON(),scrollWidth:worklist.scrollWidth,clientWidth:worklist.clientWidth};");
      await this.capture(name);
      if (width===1463) {
        const rect={x:Math.floor(bounds.panel.x),y:Math.floor(bounds.panel.y),width:Math.ceil(bounds.panel.right)-Math.floor(bounds.panel.x),height:Math.ceil(bounds.panel.bottom)-Math.floor(bounds.panel.y)};
        const image=await this.webContents.capturePage(rect);
        assert(!image.isEmpty(),'live-work-panel screenshot must contain pixels');
        const output=path.join(config.output,'live-work-panel.png');
        fs.writeFileSync(output,image.toPNG());
        report.screenshots.push({name:'live-work-panel',file:output,...image.getSize()});
      }
      assert(bounds.scrollWidth<=bounds.clientWidth+1,'attention reasons never force horizontal scrolling');
      assert(bounds.now.height>=80 && bounds.now.top<bounds.worklist.bottom,'current work is visible at the top of the shared list');
      assert(bounds.worklist.height>=140 && bounds.worklist.bottom<=bounds.panel.bottom+1,'work and attention retain a usable shared scroll area');
      assert(bounds.metrics.bottom<=bounds.worklist.top,'readiness stays above the work list');
      const attentionControls=await this.run("const worklist=document.getElementById('idle-feed-scroll'),attention=document.getElementById('idle-feed-attention'),heading=[...attention.querySelectorAll('h3')].find(el=>el.textContent.includes('Needs attention')),review=[...attention.querySelectorAll('button')].find(el=>el.textContent.includes('Review all'));worklist.scrollTop+=attention.getBoundingClientRect().top-worklist.getBoundingClientRect().top;const box=worklist.getBoundingClientRect(),head=heading.getBoundingClientRect(),action=review.getBoundingClientRect();return {headingVisible:head.top>=box.top-1&&head.bottom<=box.bottom+1,reviewVisible:action.top>=box.top-1&&action.bottom<=box.bottom+1,metrics:document.getElementById('idle-feed-metrics').getBoundingClientRect().toJSON()};");
      assert(attentionControls.headingVisible && attentionControls.reviewVisible,'attention heading and top review action are reachable together');
      assert.equal(attentionControls.metrics.top,bounds.metrics.top,'readiness stays fixed when reviewing attention details');
      await this.capture(`${name}-review`);
      const queueVisible=await this.run("const worklist=document.getElementById('idle-feed-scroll'),queue=document.querySelector('.feed-upnext');worklist.scrollTop+=queue.getBoundingClientRect().top-worklist.getBoundingClientRect().top;const box=worklist.getBoundingClientRect(),target=queue.getBoundingClientRect();return target.top<box.bottom&&target.bottom>box.top;");
      assert(queueVisible,'the shared work list reaches queued work below attention details');
      await this.run("document.getElementById('idle-feed-scroll').scrollTop=0;");
    }
    this.setContentSize(1463,943); await sleep(180);
    await this.click('#idle-feed-metrics [data-state=blocked]');
    await this.until("!document.getElementById('tasks-overlay').hidden && window.MefiTasks.state.readiness==='blocked'", 'attention metric opens its filtered task board');
    const tasks=await this.run("return [...document.querySelectorAll('#task-list .task-row')].map(row=>row.dataset.readiness);");
    assert.equal(tasks.length,3); assert(tasks.every(stage=>stage==='blocked'));
    await this.capture('04e-attention-board');
    await this.click('#tasks-close');
    await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle.isActive()", 'Command resumes after reviewing a blocker');
    await this.click('#idle-feed-metrics [data-state=waiting]');
    await this.until("!document.getElementById('tasks-overlay').hidden && window.MefiTasks.state.readiness==='waiting'", 'waiting metric opens prerequisites and retries');
    assert.equal(await this.run("return document.querySelectorAll('#task-list .task-row').length;"),2);
    await this.run("window.MefiTasks.selectTask('command_task_23');");
    await this.until("document.getElementById('task-detail').textContent.includes('Automatic retry in') && [...document.querySelectorAll('#task-status-row button')].some(button=>button.textContent==='Retry now')",'retry detail explains the timer and offers explicit recovery');
    await this.capture('04f-retry-detail');
    await this.click('#tasks-close'); await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle.isActive()", 'Command returns from retry detail');
    const job=config.fixture.autopilot.running[0];
    job.stopping={since:Date.now(),reason:'No worker activity before the deadline',error:'The stop command failed; another attempt is scheduled',retryAt:Date.now()+15000};
    this.webContents.send('assistant:status',config.fixture.autopilot);
    await this.until("document.getElementById('idle-feed-now').textContent.includes('Stopping safely')",'worker termination remains visible until its process exits');
    assert.equal(await this.run("return document.querySelector('#idle-feed-now progress')===null;"),true,'a stopping worker does not report finishing progress');
    await this.capture('04g-stopping-worker');
    delete job.stopping; this.webContents.send('assistant:status',config.fixture.autopilot);
    await this.until("document.getElementById('idle-feed-now').textContent.includes('Working now') && !document.getElementById('idle-feed-now').textContent.includes('Stopping safely')",'fixture restores the active worker after termination display check');
    report.readiness=panel;
    this.check('Blocked work, prerequisite waits and timed retries remain readable with current work, and metrics open the matching board and recovery details');
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
  async verifyNodePreferences() {
    const snapshot=()=>this.run("for(let frame=0;frame<8;frame++){await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const nodes=window.MefiIdle.debugNodes();if(nodes.length>10&&nodes.every(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)))return {prefs:window.MefiMusic.graphPreferences(),graph:window.MefiIdle.status(),nodes:nodes.map(node=>({id:node.id,kind:node.kind,x:node.x,y:node.y,shape:node.shape,visualStyle:node.visualStyle,layoutAnchor:node.layoutAnchor,orbitTrail:node.orbitTrail,extraGlow:node.extraGlow})),playing:window.MefiMusic.status().playing};}throw new Error('Node preferences did not produce a complete drawn frame');");
    const preview=async(label)=>{
      const current=await this.run("const area=window.MefiIdle.graphViewport(),pane=document.querySelector('.music-sheet').getBoundingClientRect(),preview=document.getElementById('music-tree-preview').getBoundingClientRect();const nodes=window.MefiIdle.debugNodes().filter(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)).map(node=>({id:node.id,kind:node.kind,x:node.x,y:node.y,radius:node.radius,hit:document.elementFromPoint(node.x,node.y)?.id}));return {area,pane:pane.toJSON(),preview:preview.toJSON(),width:innerWidth,height:innerHeight,active:window.MefiIdle.isActive(),open:!document.getElementById('music-overlay').hidden,nodes};");
      (report.previewSamples ||= []).push({label,...current});
      assert(current.open&&current.active,`${label}: the real tree stays active beside the open menu`);
      assert(current.preview.width>=160 && current.area.w>=160 && current.area.h>=150,`${label}: the visible live tree has usable space`);
      assert(current.pane.right<=current.preview.x+2,`${label}: settings remain to the left of the live tree`);
      assert(current.area.x>=current.preview.x-2 && current.area.x+current.area.w<=current.preview.right+2,`${label}: actual drawn bounds match the visible right pane`);
      for (const node of current.nodes.filter(node=>node.kind!=='agent')) assert(node.x-node.radius>=current.area.x-2 && node.y-node.radius>=current.area.y-2 && node.x+node.radius<=current.area.x+current.area.w+2 && node.y+node.radius<=current.area.y+current.area.h+2,`${label}: the complete ${node.id} orb fits the preview, including quiet nodes`);
      const unobscured=current.nodes.filter(node=>node.hit==='idle-layer');
      assert(unobscured.length>=10,`${label}: populated real canvas nodes are visible and interactive through the menu overlay`);
      for (const job of config.fixture.autopilot.running) assert(unobscured.some(node=>node.id===`task:${job.taskId}`),`${label}: active task ${job.taskId} remains visible on the right`);
      return current;
    };
    const openMusic=async()=>{
      if (await this.run("return document.getElementById('music-overlay').hidden;")) await this.click('#cmd-dock [data-nav="music"]');
    };
    const setPreference=async(kind,value,keyboard=false)=>{
      await openMusic();
      const selector=`#music-node-${kind}-${value}`;
      if (keyboard) {
        this.webContents.focus();
        await this.run(`const button=document.querySelector(${JSON.stringify(selector)});button.scrollIntoView({block:'nearest'});button.focus();`);
        this.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
        this.webContents.sendInputEvent({type:'char',keyCode:'\r'});
        this.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
      } else await this.click(selector);
      await this.until(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')==='true'`,`node ${kind} selects ${value}`);
      const selected=await this.run(`return [...document.querySelectorAll('.music-node-${kind}[aria-pressed="true"]')].map(button=>button.dataset[${JSON.stringify(kind==='style'?'nodeStyle':'nodeLayout')}]);`);
      assert.deepEqual(selected,[value],`only one node ${kind} is selected`);
      await this.until(`window.MefiIdle.status().${kind==='style'?'nodeStyle':'nodeLayout'}===${JSON.stringify(value)}`,`canvas applies ${kind} ${value}`);
      await sleep(250);
    };
    await this.run("window.MefiIdle.clearSearch();window.MefiIdle.setOrbit(false);window.MefiIdle.fitAll();");
    await sleep(450);
    const requestsBefore=report.musicRequests || 0;
    const beforeMenu=await this.run("return {area:window.MefiIdle.graphViewport(),camera:window.MefiIdle.followStatus()};");
    await openMusic();
    await sleep(350);
    const baseline=await snapshot();
    report.nodePreferences={styles:[],layouts:[],initialPreview:await preview('Music preview opens')};
    for (const [index,style] of ['orbs','glass','minimal','halo','crystal'].entries()) {
      await setPreference('style',style,style==='glass');
      const current=await snapshot();
      assert.equal(current.prefs.nodeStyle,style);
      assert(current.nodes.length>10 && current.nodes.every(node=>node.visualStyle===style),`${style} is applied to the drawn nodes`);
      this.assertStableNodes(baseline.nodes,current.nodes,`Changing appearance to ${style} preserves work-node positions`);
      assert.equal(current.playing,false,'appearance preferences do not start playback');
      report.nodePreferences.styles.push({...current,preview:await preview(`Style ${style}`)});
      await this.capture(`16${String.fromCharCode(97+index)}-node-style-${style}`);
    }
    await setPreference('style','orbs');
    const beforeEffects=await snapshot();
    assert.equal(beforeEffects.prefs.orbitTrails,false,'Blue orbit trails start disabled');
    assert.equal(beforeEffects.prefs.extraGlow,false,'Extra glow starts disabled');
    await this.click('#music-orbit-trails');
    this.webContents.focus();
    await this.run("const control=document.getElementById('music-extra-glow');control.scrollIntoView({block:'nearest'});control.focus();");
    this.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});
    this.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
    await this.until("document.getElementById('music-orbit-trails').checked && document.getElementById('music-extra-glow').checked && window.MefiIdle.status().orbitTrails && window.MefiIdle.status().extraGlow",'both effects respond to real mouse and keyboard controls');
    const effects=await snapshot();
    this.assertStableNodes(beforeEffects.nodes,effects.nodes,'Blue orbits and extra glow preserve work-node anchors');
    const trails=effects.nodes.filter(node=>node.orbitTrail?.drawn);
    assert(trails.length>=3,'actual running work receives drawn blue orbit trails');
    assert(trails.every(node=>node.orbitTrail.segments===3 && node.orbitTrail.animated),'blue orbit trails are actually animated under normal motion');
    assert(effects.nodes.filter(node=>['assistant','music','root'].includes(node.kind)).every(node=>!node.orbitTrail),'unrelated idle hubs never receive work trails');
    assert(effects.nodes.filter(node=>node.kind!=='agent').every(node=>node.extraGlow),'Extra glow reaches the actual drawn work nodes');
    report.nodePreferences.effects=effects;
    await this.capture('16f-node-effects');
    let previous=await snapshot();
    for (const [index,layout] of ['tree','radial','helix','layers','constellation'].entries()) {
      await setPreference('layout',layout);
      const current=await snapshot();
      assert.equal(current.prefs.nodeLayout,layout);
      const prior=new Map(previous.nodes.filter(node=>node.kind!=='agent').map(node=>[node.id,node]));
      const changed=current.nodes.filter(node=>prior.has(node.id) && Math.hypot(node.x-prior.get(node.id).x,node.y-prior.get(node.id).y)>8);
      assert(changed.length>=10,`${layout} rearranges actual work nodes rather than only changing its label`);
      await sleep(250);
      this.assertStableNodes(current.nodes,(await snapshot()).nodes,`${layout} settles into fixed work-node positions`);
      report.nodePreferences.layouts.push({...current,changedNodes:changed.length,preview:await preview(`Layout ${layout}`)});
      await this.capture(`17${String.fromCharCode(97+index)}-node-layout-${layout}`);
      previous=current;
    }
    await setPreference('style','glass');
    await setPreference('layout','radial');
    await this.click('#music-close');
    await sleep(300);
    const afterMenu=await this.run("return {area:window.MefiIdle.graphViewport(),camera:window.MefiIdle.followStatus()};");
    assert.equal(afterMenu.camera.mode,beforeMenu.camera.mode,'closing node preferences restores the previous camera mode');
    assert(Math.abs(afterMenu.area.w-beforeMenu.area.w)<=2 && Math.abs(afterMenu.area.h-beforeMenu.area.h)<=2,'closing the menu restores the full tree viewport');
    report.nodePreferences.camera={before:beforeMenu,after:afterMenu};
    await new Promise(resolve=>{this.webContents.once('did-finish-load',resolve);this.webContents.reload();});
    await this.until("document.getElementById('boot-layer')?.hidden && window.MefiMusic?.graphPreferences",'Studio reloads saved node preferences');
    assert.deepEqual(await this.run("const {nodeStyle,nodeLayout}=window.MefiMusic.graphPreferences();return {nodeStyle,nodeLayout};"),{nodeStyle:'glass',nodeLayout:'radial'},'both preferences survive a renderer reload');
    assert.deepEqual(await this.run("const {orbitTrails,extraGlow}=window.MefiMusic.graphPreferences();return {orbitTrails,extraGlow};"),{orbitTrails:true,extraGlow:true},'both effects survive a renderer reload');
    await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle.isActive() && window.MefiIdle.status().nodeStyle==='glass' && window.MefiIdle.status().nodeLayout==='radial' && window.MefiIdle.debugNodes().some(node=>Number.isFinite(node.x))",'reloaded canvas applies saved appearance and layout');
    this.setContentSize(900,900);await sleep(250);
    await this.click('#cmd-dock [data-nav="music"]');
    await this.click('#music-node-style-minimal');
    await this.click('#music-node-layout-tree');
    assert.deepEqual(await this.run("const {nodeStyle,nodeLayout}=window.MefiMusic.graphPreferences();return {nodeStyle,nodeLayout};"),{nodeStyle:'minimal',nodeLayout:'tree'},'both controls work through real clicks in a narrow sheet');
    await this.click('#music-node-style-glass');
    await this.click('#music-node-layout-radial');
    await sleep(250);
    await this.run("document.getElementById('music-node-styles').scrollIntoView({block:'center'});");
    const narrow=await this.run("const sheet=document.querySelector('.music-sheet').getBoundingClientRect();const nodes=[...document.querySelectorAll('.music-node-style,.music-node-layout')];return {width:innerWidth,scroll:document.documentElement.scrollWidth,sheet:sheet.toJSON(),controls:nodes.map(button=>({id:button.id,rect:button.getBoundingClientRect().toJSON()})),style:document.getElementById('music-node-style-glass').getAttribute('aria-pressed'),layout:document.getElementById('music-node-layout-radial').getAttribute('aria-pressed')};");
    assert.equal(narrow.style,'true');assert.equal(narrow.layout,'true');
    assert(narrow.scroll<=narrow.width+1,'node preferences do not create page overflow');
    for (const control of narrow.controls) assert(control.rect.width>20 && control.rect.x>=narrow.sheet.x && control.rect.right<=narrow.sheet.right+1,`${control.id} fits the narrow music sheet`);
    report.nodePreferences.narrow={...narrow,preview:await preview('900px preview')};
    await this.capture('18-node-preferences-narrow');
    this.setContentSize(650,760);await sleep(250);
    await this.click('#music-node-layout-tree');
    await this.click('#music-node-style-glass');
    await sleep(250);
    await this.run("document.getElementById('music-node-layouts').scrollIntoView({block:'center'});");
    const compact=await this.run("const sheet=document.querySelector('.music-sheet').getBoundingClientRect(),close=document.getElementById('music-close').getBoundingClientRect();return {width:innerWidth,height:innerHeight,sheet:sheet.toJSON(),close:close.toJSON(),controls:[...document.querySelectorAll('.music-node-style,.music-node-layout')].map(button=>({id:button.id,rect:button.getBoundingClientRect().toJSON()}))};");
    assert(compact.sheet.x>=0 && compact.sheet.right<=compact.width+1,'music fits a compact650px window');
    assert(compact.close.top>=0 && compact.close.bottom<=compact.height && compact.close.width>20,'Close stays visible while the compact preferences section is scrolled');
    for (const control of compact.controls) assert(control.rect.x>=compact.sheet.x && control.rect.right<=compact.sheet.right+1,`${control.id} fits the compact sheet`);
    report.nodePreferences.compact={...compact,preview:await preview('650px preview')};
    await this.capture('19-node-preferences-compact');
    await this.click('#music-close');
    this.setContentSize(1463,943);await sleep(200);
    await setPreference('style','orbs');
    await setPreference('layout','constellation');
    await this.click('#music-close');
    assert.equal(report.musicRequests || 0,requestsBefore,'changing node preferences never requests AI recommendations');
    assert.equal(await this.run("return window.MefiMusic.status().playing;"),false);
    this.check("Music & themes keeps the real tree visible on the right while every style and layout updates, preserves work anchors during appearance changes, restores the full view on Close, and saves keyboard/narrow preferences across reload");
  }
  async verifyCustomPalette() {
    const dark={accent:'#61CDA8',background:'#06111B',surface:'#172434',text:'#E2EBFF'};
    const light={accent:'#365FC0',background:'#F1F4FC',surface:'#FFFFFF',text:'#172638'};
    const before=await this.run("return {preferences:window.MefiMusic.graphPreferences(),audio:window.MefiMusic.status()};");
    const requestsBefore=report.musicRequests||0;
    await this.click('#cmd-dock [data-nav="music"]');
    await this.click('.music-theme[data-theme="custom"]');
    const colors=async(value)=>{
      for(const [key,color] of Object.entries(value)) {
        const selector=`#music-color-${key}-hex`;
        await this.click(selector);
        await this.run(`const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(color)};input.dispatchEvent(new Event('input',{bubbles:true}));`);
      }
      await sleep(250);
    };
    const sample=()=>this.run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const palette=window.MefiMusic.themePalette(),area=window.MefiIdle.graphViewport(),canvas=document.getElementById('idle-layer'),rect=canvas.getBoundingClientRect();const pixels=[8,14,20].map(offset=>Array.from(canvas.getContext('2d').getImageData(Math.round((area.x+offset)*canvas.width/rect.width),Math.round((area.y+8)*canvas.height/rect.height),1,1).data));return {colors:window.MefiMusic.customColors(),palette,pixels,sheet:getComputedStyle(document.querySelector('.music-sheet')).backgroundColor,heading:getComputedStyle(document.querySelector('.music-preview-header h3')).color,controls:[...document.querySelectorAll('.music-color-picker,.music-color-hex')].map(input=>({id:input.id,type:input.type,value:input.value,color:getComputedStyle(input).color,background:getComputedStyle(input).backgroundColor,invalid:input.getAttribute('aria-invalid'),label:input.getAttribute('aria-label'),rect:input.getBoundingClientRect().toJSON()})),preferences:window.MefiMusic.graphPreferences()};");
    report.customPalette={};
    for(const [name,value] of [['dark',dark],['light',light]]) {
      await colors(value);
      const current=await sample();report.customPalette[name]=current;
      assert.deepEqual(current.colors,value,`${name} custom colors apply through hex controls`);
      assert.deepEqual(current.preferences,before.preferences,'colors never change node placement or style preferences');
      const brightness=current.pixels.map(pixel=>(pixel[0]+pixel[1]+pixel[2])/3).sort((a,b)=>a-b)[1];
      assert(name==='dark'?brightness<90:brightness>170,`${name} palette changes actual painted canvas background (${brightness.toFixed(1)})`);
      assert(current.controls.every(control=>control.label && control.invalid!=='true'),'all custom controls remain named and valid');
      for(const control of current.controls.filter(control=>control.type==='text')) {
        const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(channel=>{const c=channel/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((total,channel,index)=>total+channel*[.2126,.7152,.0722][index],0);
        const fore=luminance(control.color),back=luminance(control.background);
        assert((Math.max(fore,back)+.05)/(Math.min(fore,back)+.05)>=4.5,`${name} ${control.id} has readable actual CSS input contrast`);
      }
      for(const view of ['2d','3d']) {
        await this.click(`#music-tree-view-${view}`);
        await this.until(`window.MefiIdle.geometryStatus().view===${JSON.stringify(view)} && document.getElementById('music-tree-view-${view}').getAttribute('aria-pressed')==='true'`,`${name} preview switches its actual canvas to ${view}`);
        assert.equal(await this.run("return document.getElementById('music-overlay').hidden;"),false,'preview view controls keep settings open');
      }
      await this.run("document.getElementById('music-custom-palette').scrollIntoView({block:'center'});");
      await this.capture(`23-custom-${name}`);
    }
    const savedBefore=await this.run("return JSON.stringify(window.MefiMusic.customColors());");
    await this.run("const input=document.getElementById('music-color-accent-hex');input.value='#12';input.dispatchEvent(new Event('input',{bubbles:true}));");
    assert.equal(await this.run("return document.getElementById('music-color-accent-hex').getAttribute('aria-invalid');"),'true');
    assert.equal(await this.run("return JSON.stringify(window.MefiMusic.customColors());"),savedBefore,'incomplete hex never overwrites saved colors');
    await this.click('#music-close');
    await new Promise(resolve=>{this.webContents.once('did-finish-load',resolve);this.webContents.reload();});
    await this.until("document.getElementById('boot-layer')?.hidden && window.MefiMusic?.themePalette",'custom palette reloads');
    assert.equal(await this.run("return window.MefiMusic.status().theme;"),'custom');
    assert.deepEqual(await this.run("return window.MefiMusic.customColors();"),light,'custom colors survive reload');
    await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle.isActive()",'Command opens after custom palette reload');
    this.setContentSize(650,760);await sleep(200);
    await this.click('#cmd-dock [data-nav="music"]');
    await this.run("document.getElementById('music-custom-palette').scrollIntoView({block:'center'});");
    await sleep(200);
    const compact=await sample();
    const pane=await this.run("return document.querySelector('.music-sheet').getBoundingClientRect().toJSON();");
    for(const control of compact.controls)assert(control.rect.width>=30 && control.rect.x>=pane.x && control.rect.right<=pane.right,`${control.id} fits the compact picker`);
    assert.equal(await this.run("return document.documentElement.scrollWidth<=innerWidth+1;"),true,'custom palette has no page overflow');
    report.customPalette.compact=compact;
    await this.capture('24-custom-palette-compact');
    await this.click('#music-custom-reset');
    assert.deepEqual(await this.run("return window.MefiMusic.customColors();"),{accent:'#C9A86A',background:'#050507',surface:'#0D0E12',text:'#ECE5D8'},'Reset restores only custom colors');
    await this.click('.music-theme[data-theme="aurora"]');await this.capture('25-theme-aurora');
    await this.click('.music-theme[data-theme="rose"]');await this.capture('26-theme-rose');
    await this.run("document.querySelector('.music-theme[data-theme=\"gold\"]').scrollIntoView({block:'center'});");
    await this.click('.music-theme[data-theme="gold"]');await this.click('#music-close');
    this.setContentSize(1463,943);await sleep(250);
    assert.equal(report.musicRequests||0,requestsBefore,'colors never ask the model for recommendations');
    assert.equal(await this.run("return window.MefiMusic.status().playing;"),false,'colors never start audio');
    this.check("Custom dark and light palettes change the actual canvas, preserve node preferences, validate hex entry, survive reload, reset cleanly and fit compact windows");
  }
  async verifySpatialView() {
    const snapshot=()=>this.run("for(let frame=0;frame<8;frame++){await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const types=new Map(window.MefiIdle.debugNodes().map(node=>[node.id,node.kind]));const geometry=window.MefiIdle.geometryStatus();const nodes=geometry.nodes.filter(node=>types.get(node.id)!=='agent');if(nodes.length>10&&nodes.every(node=>node.anchor&&Object.values(node.anchor).every(Number.isFinite)&&Number.isFinite(node.projected?.x)))return {...geometry,nodes};}throw new Error('No complete managed geometry frame');");
    const anchors=(a,b,label)=>{
      const current=new Map(b.nodes.map(node=>[node.id,node]));
      for(const node of a.nodes){const next=current.get(node.id);assert(next,`${label}: ${node.id} remains present`);for(const axis of ['x','y','z'])assert(Math.abs(node.anchor[axis]-next.anchor[axis])<.0001,`${label}: ${node.id} ${axis} anchor stays fixed`);}
    };
    const moved=(a,b)=>{const before=new Map(a.nodes.map(node=>[node.id,node]));return b.nodes.filter(node=>before.has(node.id)&&Math.hypot(node.projected.x-before.get(node.id).projected.x,node.projected.y-before.get(node.id).projected.y)>1).length;};
    report.spatial=[];
    await this.run("window.MefiIdle.clearSearch();window.MefiIdle.setOrbit(false);");
    await this.click('#idle-fit');
    for(const [index,layout] of ['constellation','tree','radial','helix','layers'].entries()) {
      await this.run(`window.MefiMusic.applyNodeLayout(${JSON.stringify(layout)});window.MefiIdle.fitAll();`);
      if((await snapshot()).view!=='3d')await this.click('#idle-view');
      await sleep(250);
      const solid=await snapshot();
      const depths=solid.nodes.map(node=>node.projected.depth),scales=solid.nodes.map(node=>node.projected.k);
      assert(Math.max(...depths)-Math.min(...depths)>30,`${layout} has real projected 3D depth`);
      assert(Math.max(...scales)-Math.min(...scales)>.02,`${layout} scales near and far nodes through perspective`);
      assert(Math.max(...solid.nodes.map(node=>node.anchor.z))-Math.min(...solid.nodes.map(node=>node.anchor.z))>30,`${layout} stores world-space depth`);
      await this.capture(`27${String.fromCharCode(97+index)}-${layout}-3d`);
      await this.click('#idle-orbit');
      await this.until(`Math.abs(window.MefiIdle.geometryStatus().angle-${solid.angle})>.035`,`${layout} camera actually orbits`,5000);
      const orbit=await snapshot();anchors(solid,orbit,`${layout} orbit preserves managed world positions`);
      assert(moved(solid,orbit)>=5,`${layout} orbit moves projected positions of fixed world nodes`);
      await this.click('#idle-orbit');
      await this.click('#idle-view');await sleep(250);
      const flat=await snapshot();assert.equal(flat.view,'2d');
      assert(flat.nodes.every(node=>node.projected.k===1 && node.projected.depth===500),`${layout} flat view removes perspective`);
      const solidById=new Map(solid.nodes.map(node=>[node.id,node]));
      const changedProjection=flat.nodes.filter(node=>{const prior=solidById.get(node.id);return prior && (Math.hypot(node.projected.x-prior.projected.x,node.projected.y-prior.projected.y)>1 || Math.abs(node.projected.k-prior.projected.k)>.01);}).length;
      assert(changedProjection>=10,`${layout} 2D changes actual projected scale or position after refitting`);
      assert.equal(await this.run("return document.getElementById('idle-orbit').disabled;"),true,'flat maps disable orbit');
      await sleep(160);anchors(flat,await snapshot(),`${layout} flat map settles`);
      await this.capture(`28${String.fromCharCode(97+index)}-${layout}-2d`);
      report.spatial.push({layout,solid,orbit,flat});
      await this.click('#idle-view');
    }
    await this.run("window.MefiMusic.applyNodeLayout('constellation');window.MefiIdle.setOrbit(false);window.MefiIdle.fitAll();");
    await sleep(250);
    this.check("All five layouts have real 3D depth and perspective; orbit moves their projections without moving anchors, and each 2D view is flat and stable");
  }
  async verifyAppearanceMatrix() {
    const styles=['orbs','glass','minimal','halo','crystal'];
    const layouts=['constellation','tree','radial','helix','layers'];
    const views=['2d','3d'];
    const light={accent:'#365FC0',background:'#F1F4FC',surface:'#FFFFFF',text:'#172638'};
    const snapshot=()=>this.run(`
      for(let frame=0;frame<12;frame++) {
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const nodes=window.MefiIdle.debugNodes(),geometry=window.MefiIdle.geometryStatus();
        const fixed=geometry.nodes.filter(node=>nodes.find(drawn=>drawn.id===node.id)?.kind!=='agent');
        if(nodes.length>20 && nodes.every(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)&&Number.isFinite(node.radius)) && fixed.every(node=>node.anchor&&Object.values(node.anchor).every(Number.isFinite)&&Object.values(node.projected).every(Number.isFinite))) {
          const area=window.MefiIdle.graphViewport(),pane=document.querySelector('.music-sheet').getBoundingClientRect();
          return {prefs:window.MefiMusic.graphPreferences(),status:window.MefiIdle.status(),theme:window.MefiMusic.themePalette(),area,pane:pane.toJSON(),width:innerWidth,height:innerHeight,
            nodes:nodes.map(node=>({...node,hit:document.elementFromPoint(node.x,node.y)?.id})),geometry:{...geometry,nodes:fixed},
            open:!document.getElementById('music-overlay').hidden,playing:window.MefiMusic.status().playing};
        }
      }
      throw new Error('Appearance matrix did not receive a complete painted frame');
    `);
    const sameAnchors=(before,after,label)=>{
      const current=new Map(after.geometry.nodes.map(node=>[node.id,node]));
      for(const node of before.geometry.nodes) {
        const next=current.get(node.id);assert(next,`${label}: ${node.id} remains present`);
        for(const axis of ['x','y','z'])assert(Math.abs(node.anchor[axis]-next.anchor[axis])<.0001,`${label}: ${node.id} ${axis} world anchor stays fixed`);
      }
    };
    const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>2 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>2;
    const validate=(sample,style,layout,view,label)=>{
      assert(sample.open&&sample.status.nodes>20,`${label}: populated real tree remains beside settings`);
      assert.equal(sample.prefs.nodeStyle,style);assert.equal(sample.prefs.nodeLayout,layout);assert.equal(sample.status.view,view);
      assert.equal(sample.geometry.view,view);assert.equal(sample.playing,false,'appearance controls never play audio');
      const area=sample.area;
      assert(area.w>=160&&area.h>=150&&sample.pane.right<=area.x+2,`${label}: settings leave a usable clear canvas`);
      const fixed=sample.nodes.filter(node=>node.kind!=='agent');
      assert(fixed.length>20&&sample.nodes.every(node=>node.visualStyle===style),`${label}: every drawn node uses the requested style`);
      for(const node of fixed)assert(node.radius>0&&node.x-node.radius>=area.x-2&&node.y-node.radius>=area.y-2&&node.x+node.radius<=area.x+area.w+2&&node.y+node.radius<=area.y+area.h+2,`${label}: full ${node.id} node stays within preview bounds`);
      // Validate resting satellite bodies separately from decorative glow and
      // trails. Orbit samples deliberately exercise transient projections.
      for(const agent of sample.nodes.filter(node=>node.kind==='agent'&&node.radius>0)) {
        for(const node of fixed)assert(Math.hypot(agent.x-node.x,agent.y-node.y)>=agent.radius+node.radius-1,`${label}: resting ${agent.id} satellite does not overlap ${node.id}`);
      }
      assert(fixed.filter(node=>node.hit==='idle-layer').length>=20,`${label}: actual canvas nodes are visible through the settings overlay`);
      for(const job of config.fixture.autopilot.running)assert(fixed.some(node=>node.id===`task:${job.taskId}`&&node.hit==='idle-layer'),`${label}: running ${job.taskId} remains visible`);
      const labelled=sample.nodes.filter(node=>node.labelRect);
      const budget=area.w<480||area.h<400?4:area.w<800||area.h<480?6:8;
      assert(labelled.length>0&&labelled.length<=budget,`${label}: labels respect Auto density ${budget}`);
      assert(labelled.some(node=>config.fixture.autopilot.running.some(job=>node.id===`task:${job.taskId}`)),`${label}: Auto names actual running work`);
      for(const [index,node] of labelled.entries()) {
        const box=node.labelRect;
        assert([box.x,box.y,box.w,box.h].every(Number.isFinite)&&box.w>0&&box.h>0,`${label}: ${node.id} label has actual finite bounds`);
        assert(box.x>=area.x-2&&box.y>=area.y-2&&box.x+box.w<=area.x+area.w+2&&box.y+box.h<=area.y+area.h+2,`${label}: ${node.id} label fits the preview`);
        for(const previous of labelled.slice(0,index))assert(!overlap(box,previous.labelRect),`${label}: labels ${node.id}/${previous.id} do not overlap`);
      }
      const projected=sample.geometry.nodes.map(node=>node.projected);
      if(view==='2d')assert(projected.every(point=>point.k===1&&point.depth===500),`${label}: 2D really removes perspective`);
      else {
        const depths=projected.map(point=>point.depth),scales=projected.map(point=>point.k),zs=sample.geometry.nodes.map(node=>node.anchor.z);
        assert(Math.max(...depths)-Math.min(...depths)>30,`${label}: real projected depth remains`);
        assert(Math.max(...scales)-Math.min(...scales)>.02,`${label}: near and far nodes have different perspective scale`);
        assert(Math.max(...zs)-Math.min(...zs)>30,`${label}: fixed anchors contain real world depth`);
      }
    };
    const choose=async(kind,value)=>{
      const selector=kind==='view'?`#music-tree-view-${value}`:`#music-node-${kind}-${value}`;
      await this.run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});`);
      await this.click(selector);
      await this.until(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')==='true'`,'appearance matrix selects '+kind+' '+value);
    };
    const drag=async(area,reverse=false)=>{
      const x=Math.round(area.x+area.w*.48),y=Math.round(area.y+area.h*.42),dx=14,dy=6;
      const start=reverse?{x:x+dx,y:y+dy}:{x,y},end=reverse?{x,y}:{x:x+dx,y:y+dy};
      this.webContents.focus();
      this.webContents.sendInputEvent({type:'mouseMove',...start});
      this.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...start});
      this.webContents.sendInputEvent({type:'mouseMove',button:'right',...end});
      this.webContents.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...end});
      await sleep(60);
    };
    report.appearanceMatrix={cases:[],rotations:[],expectedDarkCases:50,expectedLightCases:10};
    const requestsBefore=report.musicRequests||0;
    await this.run("window.MefiIdle.clearSearch();window.MefiIdle.setLabels('auto');window.MefiIdle.setOrbit(false);window.MefiIdle.fitAll();");
    await this.click('#cmd-dock [data-nav="music"]');await sleep(260);
    await this.run("window.__matrixViewToasts=[];const host=document.getElementById('toast-host');window.__matrixToastObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(/2D map view|3D orbit view/.test(node.textContent||''))window.__matrixViewToasts.push(node.textContent);});if(host)window.__matrixToastObserver.observe(host,{childList:true,subtree:true});");
    await this.run("document.querySelector('.music-theme[data-theme=\"gold\"]').scrollIntoView({block:'center'});");
    await this.click('.music-theme[data-theme="gold"]');
    for(const palette of ['dark','light']) {
      if(palette==='light') {
        await this.run("document.querySelector('.music-theme[data-theme=\"custom\"]').scrollIntoView({block:'center'});");
        await this.click('.music-theme[data-theme="custom"]');
        for(const [key,color] of Object.entries(light)) {
          const selector=`#music-color-${key}-hex`;
          await this.run(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});`);await this.click(selector);
          await this.run(`const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(color)};input.dispatchEvent(new Event('input',{bubbles:true}));`);
        }
      }
      for(const layout of palette==='dark'?layouts:['layers']) {
        await choose('layout',layout);
        for(const view of views) {
          await choose('view',view);await sleep(100);
          const baseline=await snapshot();
          for(const style of styles) {
            const label=`${palette}/${layout}/${view}/${style}`;
            await choose('style',style);
            const sample=await snapshot();validate(sample,style,layout,view,label);
            sameAnchors(baseline,sample,`${label} style switch`);
            const later=await snapshot();sameAnchors(sample,later,`${label} stable frames`);
            report.appearanceMatrix.cases.push({palette,layout,view,style,sample});
            if(view==='3d') {
              await drag(sample.area);
              const rotated=await snapshot();sameAnchors(sample,rotated,`${label} actual right-drag orbit`);
              assert(Math.abs(rotated.geometry.angle-sample.geometry.angle)>.02,`${label}: actual pointer drag rotates the camera`);
              const before=new Map(sample.geometry.nodes.map(node=>[node.id,node]));
              const moved=rotated.geometry.nodes.filter(node=>before.has(node.id)&&Math.hypot(node.projected.x-before.get(node.id).projected.x,node.projected.y-before.get(node.id).projected.y)>1).length;
              assert(moved>=5,`${label}: rotation changes projected positions of fixed nodes`);
              report.appearanceMatrix.rotations.push({label,angleBefore:sample.geometry.angle,angleAfter:rotated.geometry.angle,movedNodes:moved,anchorsStable:true});
              if(style==='crystal')await this.capture(`matrix-${palette}-${layout}-${style}-rotated`);
              await drag(sample.area,true);
              const restored=await snapshot();sameAnchors(sample,restored,`${label} reverse orbit`);
              assert(Math.abs(restored.geometry.angle-sample.geometry.angle)<.0001,`${label}: inverse gesture returns the original angle`);
            }
            if(palette==='light'||layout==='constellation'||style==='halo'||style==='crystal')await this.capture(`matrix-${palette}-${layout}-${style}-${view}`);
          }
        }
      }
    }
    const cases=report.appearanceMatrix.cases;
    assert.equal(cases.filter(item=>item.palette==='dark').length,50);
    assert.equal(cases.filter(item=>item.palette==='light').length,10);
    assert.equal(new Set(cases.map(item=>`${item.palette}/${item.layout}/${item.view}/${item.style}`)).size,60,'each matrix case is unique');
    this.check("All 50 dark style/layout/view combinations and 10 light style/view combinations render finite visible nodes, respect preview bounds and label density, and retain fixed anchors during style changes");
    this.check("Every 3D matrix style responds to real right-drag orbit with changing perspective and fixed world anchors; all 2D cases are flat");
    report.appearanceMatrix.viewToasts=await this.run("window.__matrixToastObserver?.disconnect();return window.__matrixViewToasts;");
    assert.deepEqual(report.appearanceMatrix.viewToasts,[],'preview view changes do not create toast clutter');
    const expected=await snapshot();
    await this.click('#music-close');
    await new Promise(resolve=>{this.webContents.once('did-finish-load',resolve);this.webContents.reload();});
    await this.until("document.getElementById('boot-layer')?.hidden&&window.MefiMusic?.graphPreferences",'matrix preference reload');
    assert.deepEqual(await this.run("return window.MefiMusic.graphPreferences();"),expected.prefs,'latest style and layout survive reload');
    assert.deepEqual(await this.run("return window.MefiMusic.customColors();"),light,'light palette survives reload');
    assert.equal(await this.run("return window.MefiIdle.status().view;"),'3d','latest view survives reload');
    await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle.isActive()",'matrix Command returns after reload');
    await this.click('#cmd-dock [data-nav="music"]');await sleep(200);
    const reloaded=await snapshot();validate(reloaded,'crystal','layers','3d','reloaded latest combination');
    report.appearanceMatrix.reloaded=reloaded;
    await this.capture('matrix-reloaded-crystal-layers-3d-light');
    const initialCamera=await this.run("return window.MefiIdle.settingsPreviewStatus();");
    const area=reloaded.area;
    const x=Math.round(area.x+area.w*.4),y=Math.round(area.y+area.h*.4);
    this.webContents.focus();
    this.webContents.sendInputEvent({type:'mouseMove',x,y});
    this.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});
    this.webContents.sendInputEvent({type:'mouseMove',button:'left',x:x+70,y:y+35});
    this.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:x+70,y:y+35});
    this.webContents.sendInputEvent({type:'mouseWheel',x:x+70,y:y+35,deltaY:-100,deltaX:0,canScroll:true});
    await sleep(180);
    const shifted=await snapshot(),shiftedCamera=await this.run("return window.MefiIdle.settingsPreviewStatus();");
    report.appearanceMatrix.previewGesture={initialCamera,shiftedCamera};
    assert(Math.abs(shiftedCamera.zoom-initialCamera.zoom)>.01,'real wheel gesture changes preview zoom before Fit');
    await choose('view','3d');
    const unchanged=await snapshot(),unchangedCamera=await this.run("return window.MefiIdle.settingsPreviewStatus();");
    sameAnchors(shifted,unchanged,'clicking the already-selected view');
    assert.deepEqual(unchangedCamera.camera,shiftedCamera.camera,'already-selected view preserves manual pan');
    assert.equal(unchangedCamera.zoom,shiftedCamera.zoom,'already-selected view preserves manual zoom');
    await this.click('#music-tree-fit');await sleep(120);
    const fitted=await snapshot();validate(fitted,'crystal','layers','3d','Fit recovers manual pan and zoom');
    assert.deepEqual(fitted.prefs,reloaded.prefs,'Fit preserves style, layout and effects');
    assert.equal(await this.run("return window.MefiIdle.settingsPreviewStatus().zoom;"),1,'Fit resets manual zoom');
    report.appearanceMatrix.previewControls={shiftedCamera,unchangedCamera,fitted};
    await choose('view','2d');
    this.webContents.sendInputEvent({type:'mouseMove',x,y});
    this.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});
    this.webContents.sendInputEvent({type:'mouseMove',button:'left',x:x+60,y:y+25});
    this.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:x+60,y:y+25});
    this.webContents.sendInputEvent({type:'mouseWheel',x:x+60,y:y+25,deltaY:-100,deltaX:0,canScroll:true});await sleep(120);
    const flatBefore=await snapshot(),flatCamera=await this.run("return window.MefiIdle.settingsPreviewStatus();");
    await choose('view','2d');
    sameAnchors(flatBefore,await snapshot(),'clicking the already-selected flat view');
    const flatUnchanged=await this.run("return window.MefiIdle.settingsPreviewStatus();");
    assert.deepEqual(flatUnchanged.camera,flatCamera.camera,'already-selected flat view preserves manual pan');
    assert.equal(flatUnchanged.zoom,flatCamera.zoom,'already-selected flat view preserves manual zoom');
    await this.click('#music-tree-fit');await sleep(100);
    validate(await snapshot(),'crystal','layers','2d','flat Fit recovers manual pan and zoom');
    const panArea=(await snapshot()).area;
    const panStart={x:Math.round(panArea.x+panArea.w*.22),y:Math.round(panArea.y+panArea.h*.4)};
    const panEnd={x:Math.round(panArea.x+panArea.w*.8),y:panStart.y};
    for(let step=0;step<3;step++) {
      this.webContents.sendInputEvent({type:'mouseMove',...panStart});
      this.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...panStart});
      this.webContents.sendInputEvent({type:'mouseMove',button:'left',...panEnd});
      this.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...panEnd});
      await sleep(80);
    }
    const offscreen=await snapshot();
    const outside=node=>node.x+node.radius<offscreen.area.x||node.x-node.radius>offscreen.area.x+offscreen.area.w||node.y+node.radius<offscreen.area.y||node.y-node.radius>offscreen.area.y+offscreen.area.h;
    const offscreenTasks=offscreen.nodes.filter(node=>config.fixture.autopilot.running.some(job=>node.id===`task:${job.taskId}`)&&outside(node));
    assert(offscreenTasks.length>=2,'real pan moves running task hosts out of the preview');
    for(const task of offscreenTasks) {
      const builder=offscreen.nodes.find(node=>node.id===`builder:${task.id.slice(5)}`);
      assert(builder&&outside(builder),`offscreen ${task.id} keeps its builder offscreen rather than pinned to the viewport edge`);
      assert(Math.hypot(builder.x-task.x,builder.y-task.y)<120,`offscreen ${task.id} keeps its builder close to its host`);
    }
    report.appearanceMatrix.offscreenPan={tasks:offscreenTasks.map(node=>node.id),sample:offscreen};
    await this.click('#music-tree-fit');await sleep(100);
    validate(await snapshot(),'crystal','layers','2d','Fit restores panned tasks and their satellites');
    await choose('view','3d');
    this.setContentSize(650,760);await sleep(180);
    await this.click('#music-tree-fit');await sleep(120);
    const compact=await this.run("const pane=document.querySelector('.music-sheet').getBoundingClientRect(),header=document.querySelector('.music-preview-header').getBoundingClientRect();return {width:innerWidth,height:innerHeight,pane:pane.toJSON(),header:header.toJSON(),controls:['music-tree-view-2d','music-tree-view-3d','music-tree-fit'].map(id=>{const el=document.getElementById(id),rect=el.getBoundingClientRect();return {id,rect:rect.toJSON(),label:el.getAttribute('aria-label'),hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.id};})};");
    for(const control of compact.controls)assert(control.label&&control.hit===control.id&&control.rect.x>=compact.pane.right&&control.rect.right<=compact.width&&control.rect.top>=0&&control.rect.bottom<=compact.height,`${control.id} is named, visible and clickable in the compact preview header`);
    const compactTree=await snapshot();
    assert(compactTree.nodes.some(node=>node.labelRect&&config.fixture.autopilot.running.some(job=>node.id===`task:${job.taskId}`)),'650px preview names at least one running task');
    compact.tree=compactTree;
    report.appearanceMatrix.compact=compact;
    await this.capture('matrix-650-preview-controls');
    this.check("Preview Fit recovers real pan and zoom without changing appearance; reselecting the current view preserves the camera and all preview controls fit at 650px");
    assert.equal(report.musicRequests||0,requestsBefore,'appearance matrix never requests recommendations');
    assert.equal(await this.run("return window.MefiMusic.status().playing;"),false,'appearance matrix never starts playback');
    this.check("The final Crystal/Terraces/3D selection and custom light colors survive reload and render together in the live preview");
  }
  async verifyCollapsedPolish() {
    report.collapsedPolish={cases:[],verificationTasks:[]};
    const activeIds=new Set(config.fixture.autopilot.running.map(job=>`task:${job.taskId}`));
    const initial=await this.run("return (await window.mefiStudio.tasksList()).tasks;");
    report.collapsedPolish.verificationTasks=initial.filter(task=>task.status==='awaiting_verification').map(task=>task.id);
    assert(report.collapsedPolish.verificationTasks.length>=3,'collapsed fixture contains waiting verification cards beside three actual builders');
    const setPanels=async expanded=>{
      for(const id of ['idle-feed-toggle','cmd-chat-toggle']) {
        if(await this.run(`return document.getElementById(${JSON.stringify(id)}).getAttribute('aria-expanded');`)!==String(expanded))await this.click(`#${id}`);
      }
      await this.until(`['idle-feed-toggle','cmd-chat-toggle'].every(id=>document.getElementById(id).getAttribute('aria-expanded')===${JSON.stringify(String(expanded))})`,'both panel disclosures reach their requested state');
      await sleep(350);
    };
    const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>1 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>1;
    const capture=async(name,{light=false,strictCollapsed=true}={})=>{
      // A view/style change schedules graph rebuilding, so wait for complete
      // painted diagnostics rather than reading yesterday's geometry.
      await sleep(300);
      const current=await this.layout(name);
      const extra=await this.run("return {prefs:window.MefiMusic.graphPreferences(),theme:window.MefiMusic.themePalette(),geometry:window.MefiIdle.geometryStatus(),panels:['idle-feed-toggle','cmd-chat-toggle'].map(id=>({id,expanded:document.getElementById(id).getAttribute('aria-expanded')})),centres:window.MefiIdle.debugNodes().filter(node=>Number.isFinite(node.x)&&Number.isFinite(node.y)).map(node=>({id:node.id,hit:document.elementFromPoint(node.x,node.y)?.id})),pixels:[[12,innerHeight-90],[innerWidth-12,innerHeight/2],[innerWidth/2,innerHeight-90]].map(([x,y])=>[...document.getElementById('idle-layer').getContext('2d').getImageData(Math.round(x*devicePixelRatio),Math.round(y*devicePixelRatio),1,1).data])};");
      (report.collapsedPolish.samples ||= []).push({name,layout:current,...extra});
      const area=current.viewport,budget=area.w<480||area.h<400?4:area.w<800||area.h<480?6:8;
      const labels=current.nodes.filter(node=>node.labelRect);
      assert.equal(current.graph.labels,'auto');assert.equal(current.graph.orbit,'paused');
      assert.deepEqual(extra.prefs,{nodeStyle:'orbs',nodeLayout:'constellation',orbitTrails:true,extraGlow:true});
      if(strictCollapsed)assert(extra.panels.every(panel=>panel.expanded==='false'),`${name}: both panels stay collapsed`);
      assert(labels.length<=budget,`${name}: Auto labels remain within ${budget}`);
      const named=labels.filter(node=>activeIds.has(node.id));
      const required=current.width>=1200?3:area.w>=600&&area.h>=450&&budget>=6?2:1;
      assert(named.length>=required,`${name}: actual running work keeps ${required} readable task names`);
      assert([...activeIds].every(id=>current.nodes.some(node=>node.id===id)),`${name}: all three running work nodes remain present`);
      const controls=['header','feed','chat','selected','dock','search','composer','tools','follow','legend','ambience'].filter(key=>current[key]).map(key=>({id:key,rect:{x:current[key].x,y:current[key].y,w:current[key].width,h:current[key].height}}));
      const paint=labels.map(node=>({id:node.id,type:'label',rect:node.labelRect}));
      const badges=current.nodes.filter(node=>node.bubbleRect).map(node=>({id:node.id,type:'checkpoint',rect:node.bubbleRect}));
      assert(badges.length>0,`${name}: the screenshot exercises actual checkpoint badges`);
      const badgeFrames=[];
      for(let frame=0;frame<3;frame++) {
        await sleep(90);
        const ids=await this.run("await new Promise(resolve=>requestAnimationFrame(resolve));return window.MefiIdle.debugNodes().filter(node=>node.bubbleRect).map(node=>node.id);");
        badgeFrames.push(ids);
      }
      (report.collapsedPolish.badgeFrames ||= []).push({name,frames:badgeFrames});
      assert(badgeFrames.every(ids=>ids.length>0),`${name}: checkpoint badges remain painted across successive HUD-cache frames`);
      paint.push(...badges);
      for(const entry of extra.centres)assert.equal(entry.hit,'idle-layer',`${name}: ${entry.id} centre is visible and interactive outside the HUD`);
      for(const [index,item] of paint.entries()) {
        const box=item.rect;
        assert([box.x,box.y,box.w,box.h].every(Number.isFinite)&&box.w>0&&box.h>0,`${name}: ${item.type} has actual painted bounds`);
        assert(box.x>=-1&&box.y>=-1&&box.x+box.w<=current.width+1&&box.y+box.h<=current.height+1,`${name}: ${item.type} stays in the viewport`);
        for(const control of controls)assert(!overlap(box,control.rect),`${name}: ${item.id} ${item.type} clears ${control.id}`);
        for(const previous of paint.slice(0,index))assert(!overlap(box,previous.rect),`${name}: ${item.type} ${item.id} clears ${previous.type} ${previous.id}`);
      }
      for(const node of current.nodes.filter(node=>activeIds.has(node.id)))assert(node.orbitTrail?.drawn && node.extraGlow===true,`${name}: enabled effects appear on real running work`);
      const brightness=extra.pixels.map(pixel=>(pixel[0]+pixel[1]+pixel[2])/3).sort((a,b)=>a-b)[1];
      assert(light?brightness>170:brightness<90,`${name}: the actual canvas reflects the chosen ${light?'light':'dark'} colors`);
      report.collapsedPolish.cases.push({name,requiredActiveLabels:required,namedActiveIds:named.map(node=>node.id),budget,badges,layout:current,...extra,brightness});
      await this.capture(name);
      return {layout:current,...extra};
    };
    await this.run("window.MefiMusic.applyTheme('gold');window.MefiMusic.applyNodeStyle('orbs');window.MefiMusic.applyNodeLayout('constellation');window.MefiMusic.applyNodeEffects({orbitTrails:true,extraGlow:true});window.MefiIdle.clearSearch();window.MefiIdle.setLabels('auto');window.MefiIdle.setOrbit(false);window.MefiIdle.setView('3d');");
    await setPanels(false);
    for(const [width,height,label] of [[1920,1200,'wide'],[1463,943,'desktop'],[900,900,'narrow']]) {
      this.setContentSize(width,height);await sleep(250);await this.run("window.MefiIdle.fitAll();");
      await capture(`polish-01-${label}-3d`);
    }
    this.setContentSize(1463,943);await sleep(250);
    await this.run("window.MefiIdle.setView('2d');window.MefiIdle.fitAll();");
    await capture('polish-02-desktop-2d');
    await this.run("window.MefiMusic.applyCustomColors({accent:'#365FC0',background:'#F1F4FC',surface:'#FFFFFF',text:'#172638'});window.MefiIdle.setView('3d');window.MefiIdle.fitAll();");
    await capture('polish-03-light-blue-3d',{light:true});
    await this.run("window.MefiIdle.setView('2d');window.MefiIdle.fitAll();");
    await capture('polish-04-light-blue-2d',{light:true});
    await this.run("window.MefiMusic.applyTheme('gold');window.MefiIdle.setView('3d');");
    await setPanels(true);await this.capture('polish-05-panels-reopened');
    await setPanels(false);await this.run("window.MefiIdle.fitAll();");
    const beforeReload=await capture('polish-06-panels-reclosed');
    await new Promise(resolve=>{this.webContents.once('did-finish-load',resolve);this.webContents.reload();});
    await this.until("document.getElementById('boot-layer')?.hidden && window.MefiIdle?.status",'collapsed preference reload completes');
    await this.dismissOnboarding();
    await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle.isActive() && window.MefiIdle.debugNodes().length>20",'the saved collapsed tree reloads');
    await this.run("window.MefiIdle.fitAll();");
    const reloaded=await capture('polish-07-reloaded');
    assert.deepEqual(reloaded.prefs,beforeReload.prefs,'orb style, constellation layout and both effects survive reload');
    assert.deepEqual(reloaded.panels,beforeReload.panels,'both collapsed panel preferences survive reload');
    assert.equal(report.musicRequests||0,0,'appearance does not request model recommendations');
    assert.equal(await this.run("return window.MefiMusic.status().playing;"),false,'appearance does not start playback');
    this.check("Both collapsed headers leave the real three-builder graph readable at wide, desktop and narrow sizes, in 3D and 2D, with checkpoint paint bounds checked");
    this.check("Custom light-blue colors reach both canvas views; reopen/reclose and reload preserve the collapsed panels, orb style, layout and effects");
  }
  async verifyQuietControls() {
    const feed=()=>this.run("const box=document.getElementById('idle-feed').getBoundingClientRect();return {status:window.MefiIdle.ambientZenStatus(),expanded:document.getElementById('idle-feed-toggle').getAttribute('aria-expanded'),hidden:document.getElementById('idle-feed-content').hidden,height:box.height,area:window.MefiIdle.graphViewport()};");
    const expanded=await feed();
    assert.equal(expanded.expanded,'true');
    assert.equal(expanded.status.enabled,false,'Zen is off in a fresh profile');
    assert.equal(await this.run("return document.getElementById('idle-ambient-zen').checked;"),false);
    await this.click('#idle-ambience');
    await this.click('#idle-ambient-zen');
    await this.click('#idle-ambience');
    assert.equal(await this.run("return window.MefiIdle.ambientZenStatus().enabled;"),true,'the Ambience toggle opts into Zen');
    await this.click('#idle-feed-toggle');
    await this.until("window.MefiIdle.ambientZenStatus().feedCollapsed && document.getElementById('idle-feed-content').hidden",'Live work collapses its contents');
    await sleep(400);
    const collapsed=await feed();
    assert.equal(collapsed.expanded,'false');
    assert(collapsed.height<expanded.height*.4,'collapsing Live work frees its vertical space');
    assert(collapsed.area.w>expanded.area.w+70,'collapsing Live work gives the graph more usable width');
    await this.capture('20-live-work-collapsed');
    await new Promise(resolve=>{this.webContents.once('did-finish-load',resolve);this.webContents.reload();});
    await this.until("document.getElementById('boot-layer')?.hidden && window.MefiIdle?.ambientZenStatus",'Studio reloads the saved Live work preference');
    await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle.isActive() && window.MefiIdle.ambientZenStatus().feedCollapsed",'Live work remains collapsed after reload');
    assert.equal((await feed()).expanded,'false');
    assert.equal(await this.run("return window.MefiIdle.ambientZenStatus().enabled && document.getElementById('idle-ambient-zen').checked;"),true,'the Zen opt-in survives reload');
    await this.click('#idle-feed-toggle');
    await this.until("!window.MefiIdle.ambientZenStatus().feedCollapsed",'Live work expands again');
    await sleep(400);
    report.liveWorkCollapse={expanded,collapsed};
    this.check("Live work collapses into a dropdown, frees graph space, remembers its state across reload, and opens again");
    await this.click('#cmd-dock [data-nav="music"]');
    await sleep(300);
    assert.equal(await this.run("return window.MefiIdle.ambientZenStatus().eligible;"),false,'Music settings block automatic Zen');
    if (!await this.run("return document.getElementById('music-orbit-trails').checked;")) {
      await this.run("document.getElementById('music-orbit-trails').scrollIntoView({block:'center'});");
      await this.click('#music-orbit-trails');
    }
    const normalMotion=await this.run("const sheet=getComputedStyle(document.querySelector('.music-sheet'));return {name:sheet.animationName,duration:sheet.animationDuration};");
    assert(normalMotion.name.includes('studio-settings-enter'),'settings have the expected entry animation');
    this.webContents.debugger.attach('1.3');
    try {
      await this.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await sleep(150);
      const reduced=await this.run("return {matches:matchMedia('(prefers-reduced-motion: reduce)').matches,surfaces:['.music-sheet','#music-close','.music-node-style'].map(selector=>{const style=getComputedStyle(document.querySelector(selector));return {selector,animation:style.animationName,duration:style.animationDuration,transition:style.transitionDuration};})};");
      assert.equal(reduced.matches,true);
      for (const surface of reduced.surfaces) {
        assert.equal(surface.animation,'none',`${surface.selector} skips animation with reduced motion`);
        assert(surface.duration.split(',').every(value=>parseFloat(value)===0));
        assert(surface.transition.split(',').every(value=>parseFloat(value)===0));
      }
      const trailFrames=[];
      for(let frame=0;frame<2;frame++) {
        await sleep(180);
        const trails=await this.run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return window.MefiIdle.debugNodes().filter(node=>node.orbitTrail?.drawn).map(node=>({id:node.id,...node.orbitTrail}));");
        assert(trails.length>=3,'reduced motion preserves visible static blue arcs');
        assert(trails.every(trail=>trail.animated===false),'reduced motion disables actual trail animation');
        trailFrames.push(trails);
      }
      for(const trail of trailFrames[0]) assert.equal(trailFrames[1].find(node=>node.id===trail.id)?.phase,trail.phase,'reduced-motion trail phases remain fixed across real frames');
      report.reducedMotion={normal:normalMotion,reduced,trailFrames};
    } finally {
      await this.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
      this.webContents.debugger.detach();
    }
    assert.equal(await this.run("return document.getElementById('music-overlay').hidden;"),false,'motion preferences leave Music settings open');
    await this.click('#music-close');
    this.check("Music settings block idle Zen and new animations honor the operating-system reduced-motion preference");
    await this.run("window.MefiIdle.clearSearch();window.MefiIdle.setOrbit(false);document.activeElement?.blur();");
    const before=await this.run("return {camera:window.MefiIdle.settingsPreviewStatus(),mode:window.MefiIdle.followStatus().mode,orbit:window.MefiIdle.status().orbit,area:window.MefiIdle.graphViewport()};");
    this.webContents.focus();
    this.webContents.sendInputEvent({type:'mouseMove',x:Math.round(before.area.x+30),y:Math.round(before.area.y+30)});
    await this.until("window.MefiIdle.ambientZenStatus().eligible && !window.MefiIdle.ambientZenStatus().active",'a quiet Command tree can enter Zen');
    const began=Date.now();
    await this.until("window.MefiIdle.ambientZenStatus().active",'30 seconds of real inactivity enters Zen',35000);
    const elapsed=Date.now()-began;
    assert(elapsed>=28000,'Zen does not activate early');
    await sleep(650);
    const zen=await this.run("return {status:window.MefiIdle.ambientZenStatus(),body:document.body.classList.contains('command-zen'),inert:document.getElementById('idle-hud').inert,hudOpacity:getComputedStyle(document.getElementById('idle-hud')).opacity,orbit:window.MefiIdle.status().orbit};");
    assert(zen.body&&zen.inert,'Zen fades controls and prevents invisible interactions');
    assert(Number(zen.hudOpacity)<.1,'Command panels are visually faded in Zen');
    await this.capture('21-idle-zen');
    this.webContents.sendInputEvent({type:'mouseMove',x:Math.round(before.area.x+45),y:Math.round(before.area.y+45)});
    await this.until("!window.MefiIdle.ambientZenStatus().active && !document.getElementById('idle-hud').inert",'a real mouse movement restores Command controls');
    await sleep(650);
    const after=await this.run("return {camera:window.MefiIdle.settingsPreviewStatus(),mode:window.MefiIdle.followStatus().mode,orbit:window.MefiIdle.status().orbit,hudOpacity:getComputedStyle(document.getElementById('idle-hud')).opacity};");
    assert.equal(after.mode,before.mode);
    assert.equal(after.orbit,before.orbit,'waking Zen preserves the prior paused orbit choice');
    assert(Number(after.hudOpacity)>.9,'Command panels return visibly after mouse movement');
    report.zen={elapsedMs:elapsed,before,zen,after};
    await this.capture('22-idle-zen-restored');
    await this.click('#idle-ambience');
    await this.click('#idle-ambient-zen');
    await this.click('#idle-ambience');
    assert.equal(await this.run("return window.MefiIdle.ambientZenStatus().enabled;"),false);
    assert.equal(await this.run("return localStorage.getItem('mefiStudio.ambientZen');"),'0');
    this.check("Zen defaults off, saves its Ambience toggle across reload, enters after thirty seconds when enabled, and restores the panels and camera on mouse movement");
    await this.run("window.MefiNav.go('workspace');");
    await this.until("window.MefiWorkspace.isActive()&&!window.MefiIdle.isActive()",'Workspace is restored before its music preview');
    await this.run("window.MefiNav.go('music');");
    await this.until("window.MefiIdle.settingsPreviewStatus().active&&!document.getElementById('music-overlay').hidden",'Music opened from Workspace starts the real tree preview');
    await this.click('#music-close');
    await this.until("window.MefiWorkspace.isActive()&&!window.MefiIdle.isActive()",'closing Music returns to its Workspace origin');
    await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle.isActive()",'Command remains accessible after the preview lifecycle');
    this.check("Opening Music from Workspace shows the live tree and Close returns to Workspace without leaving a canvas behind");
  }
  async verify() {
    await this.until("window.MefiWorkspace?.isActive?.() && document.getElementById('boot-layer')?.hidden", "fixture home ready");
    await this.dismissOnboarding();
    if (config.interactive) {
      await this.run("window.MefiNav.go('command');");
      this.setTitle("Studio UI Test — disposable music and Command fixture");
      this.show();
      await new Promise((resolve) => this.once('closed', resolve));
      return;
    }
    assert.equal((await this.run("return (await window.mefiStudio.tasksList()).tasks;")).length, 66);
    assert.equal((await this.run("return (await window.mefiStudio.ideasList()).ideas;")).length, 105);
    if (!config.baseline) {
      const shortcut=await this.run("const button=document.getElementById('workspace-node-tree');const box=button?.getBoundingClientRect();return {text:button?.textContent,route:button?.dataset.nav,width:box?.width,height:box?.height,insideClosedDetails:Boolean(button?.closest('details:not([open])'))};");
      assert.equal(shortcut.route,'command');
      assert(/node tree/i.test(shortcut.text),'Workspace names the destination plainly');
      assert(shortcut.width>40 && shortcut.height>20 && !shortcut.insideClosedDetails,'Node tree is directly visible outside collapsed tools');
      await this.capture('00-workspace-node-tree');
      this.setContentSize(900,900); await sleep(180);
      await this.capture('00b-workspace-node-tree-narrow');
      await this.click('#workspace-node-tree');
      this.check("Workspace exposes a directly visible Node tree button that remains clickable in a narrow window");
    } else await this.run("window.MefiNav.go('command');");
    await this.until("window.MefiIdle?.isActive?.() && window.MefiIdle.status().nodes > 15", "Command dense graph ready");
    if (!config.baseline) assert.equal(await this.run("return window.MefiIdle.status().orbit;"),'paused','fresh Node tree opens with a stationary camera');
    assert.equal(await this.run("const canvas=document.getElementById('idle-layer');const rect=canvas.getBoundingClientRect();return rect.width>200 && rect.height>180 && getComputedStyle(canvas).visibility!=='hidden';"),true,'Node tree navigation opens a visible populated canvas');
    if(config.nodeReadability) {
      await this.verifyNodeReadability();
      assert.equal(report.networkAttempts.length,0,'readability fixture never attempts external requests');
      assert.equal(report.workerAttempts.length,0,'readability fixture never starts worker processes');
      assert.equal(report.consoleErrors.length,0,`Renderer errors: ${report.consoleErrors.join('; ')}`);
      return;
    }
    this.setContentSize(1463,943);
    await sleep(250);
    await this.capture('00c-node-tree-opened');
    await this.until("document.getElementById('idle-feed-now')?.textContent.includes('Refine the project switcher')", "synthetic current work appears");
    this.webContents.send('eyes:assistant', {state: await fixtureAssistantPromise, event:{kind:'agent',role:'reference',status:'running',at:Date.now(),text:'reference is checking the current task',target:{kind:'task',id:'command_task_00'}}});
    await this.run("window.MefiIdle.setOrbit(false); window.MefiIdle.fitAll();");
    await sleep(450);
    this.check("Dense real board fixture loads with read-only synthetic session and worker status");

    if (config.appearanceMatrix) {
      await this.verifyParallelBuilds();
      await this.verifyAppearanceMatrix();
      assert.equal(report.networkAttempts.length,0,"fixture never attempts external requests");
      assert.equal(report.workerAttempts.length,0,"synthetic workers never start a process");
      assert.equal(report.consoleErrors.length,0,`Renderer errors: ${report.consoleErrors.join('; ')}`);
      return;
    }

    if (config.collapsedPolish) {
      await this.verifyParallelBuilds();
      await this.verifyCollapsedPolish();
      assert.equal(report.networkAttempts.length,0,"fixture never attempts external requests");
      assert.equal(report.workerAttempts.length,0,"synthetic workers never start a process");
      assert.equal(report.consoleErrors.length,0,`Renderer errors: ${report.consoleErrors.join('; ')}`);
      return;
    }

    if (config.paletteOnly) {
      await this.verifyParallelBuilds();
      await this.verifyCustomPalette();
      await this.verifyQuietControls();
      assert.equal(report.networkAttempts.length,0,"fixture never attempts external requests");
      assert.equal(report.workerAttempts.length,0,"synthetic workers never start a process");
      assert.equal(report.consoleErrors.length,0,`Renderer errors: ${report.consoleErrors.join('; ')}`);
      return;
    }

    for (const [width,height,name] of [[1920,1200,'01-wide'],[1463,943,'02-desktop'],[1280,720,'03-short'],[900,900,'04-narrow']]) {
      this.setContentSize(width,height);
      await sleep(200);
      await this.run("window.MefiIdle.fitAll();");
      await sleep(350);
      await this.layout(name);
      await this.capture(name);
    }
    this.check("Command controls, dock and graph remain accessible at four window sizes");
    if (!config.baseline) await this.verifyReadiness();
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
      assert.equal(await this.run("return document.getElementById('idle-source').value;"), 'auto', "audio defaults to automatic Studio-track linking");
      assert.equal(await this.run("return document.getElementById('idle-reactive').checked;"), false, "opening settings does not enable capture");
      await this.capture('07b-music-settings');
      await this.click('#idle-ambience');
      this.check("Music control and source settings are visible without requesting audio capture");
      await this.verifyParallelBuilds();
      await this.verifyAutoOverview();
      await this.verifyStableNodes();
      await this.verifyFollow();
      await this.verifyMusic();
      await this.verifyNodePreferences();
      await this.verifySpatialView();
      await this.verifyCustomPalette();
      await this.verifyQuietControls();
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
if (!config.interactive) setTimeout(()=>finish(new Error('Command verification exceeded 180 seconds')),180000).unref();
'''


def bootstrap(config):
    prefix = WORKSPACE_BOOTSTRAP.split("  async verify() {", 1)[0]
    # Chromium can transiently reject an offscreen capture during a resized
    # compositor frame. Retry that specific transport failure, never a UI
    # assertion or an empty image, and retain every retry in the report.
    prefix = prefix.replace("const image = await this.webContents.capturePage();", r'''
    let image;
    for (let attempt=0;attempt<3;attempt++) {
      try { image=await this.webContents.capturePage();break; }
      catch(error) {
        if (!String(error).includes('UnknownVizError') || attempt===2) throw error;
        (report.captureRetries ||= []).push({name,attempt:attempt+1,error:String(error)});
        this.webContents.invalidate();await sleep(300);
      }
    }
''')
    if config.get("interactive"):
        prefix = prefix.replace("offscreen: true", "offscreen: false")
    prefix = prefix.replace("const config = __CONFIG__;", "const config = __CONFIG__;\n" + r'''
const fixtureAssistantPromise = import('./scripts/assistant.mjs').then(module => {
  const state = module.emptyState();
  Object.assign(state, config.fixture.assistant);
  return state;
});
''')
    # Reuse the shared childProcess/report bindings, then strengthen its worker
    # guard after installation: Command's synthetic fixture needs no processes.
    spawn_guard_marker = "let failNextMessage = false;"
    if prefix.count(spawn_guard_marker) != 1:
        raise RuntimeError("Workspace process guard changed; update the isolated Command fixture before running.")
    prefix = prefix.replace(spawn_guard_marker, "childProcess.spawn = (...args) => { report.workerAttempts.push(String(args[0])); throw new Error('Process launching is disabled by the isolated Command fixture'); };\n" + spawn_guard_marker, 1)
    marker = '  if (channel === "assistant:message" && failNextMessage) {'
    fixture_reads = r'''
  if (channel === 'eyes:state') return {ok:true,...config.fixture.store};
  if (channel === 'eyes:todos') return {ok:true,todos:config.fixture.store.todos};
  if (channel === 'eyes:changes') return {ok:true,changes:config.fixture.store.changes};
  if (channel === 'eyes:checkpoints-read' && config.collapsedPolish) return {ok:true,checkpoints:config.fixture.checkpoints};
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


def fixture(project, now, node_readability=False):
    titles = ["Refine the project switcher", "Save a durable task handoff", "Verify keyboard navigation", "Polish the progress view"]
    tasks = [{"id": f"command_task_{i:02d}", "projectId": project["id"], "projectPath": project["path"],
              "title": titles[0] if i == 0 else f"{titles[i % 4]} — backlog {i + 1}",
              "prompt": "Preserve existing project data, implement the smallest useful step, and verify keyboard navigation.",
              "status": "active" if i == 0 else "awaiting_verification" if i < 4 else "done" if i < 15 else "open",
              "createdAt": now - (i + 1) * 1200000, "updatedAt": now - i * 60000,
              "logs": [], "refs": [], "ideas": []} for i in range(66)]
    tasks[4]["dependsOn"] = ["command_task_00"]
    tasks[20].update(runFailures=5, lastRunError="Fixture worker could not finish the export checks")
    tasks[21].update(verification={"state": "failed", "reason": "Fixture completion evidence is missing"}, verifyAttempts=3)
    tasks[22]["dependsOn"] = ["deleted_fixture_prerequisite"]
    tasks[23].update(runFailures=1, nextRunAt=now + 3600000, lastRunError="Fixture temporary worker error")
    tasks[24]["dependsOn"] = ["command_task_00"]
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
    if node_readability:
        running_titles = [
            "Guard the remaining live-state refresh paths",
            "Verify the dev-store after a live session refresh",
            "Commit the suite registration and discovery checks",
            "Audit tests for incomplete worker handoff evidence",
            "Run the full Python discovery sweep",
            "Mark idle-only sessions clearly in the node tree",
        ]
        session_titles = running_titles + ["Dead-selector detection comparison", "Review the saved task handoff"]
        store["sessions"] = [{"id": f"command_session_{i}", "title": title, "agent": "build", "model": "fixture/local", "timeCreated": now - 3600000, "timeUpdated": now - i * 90000, "parentId": None} for i, title in enumerate(session_titles)]
        store["todos"] = [{"sessionId": session["id"], "position": 0, "content": f"Checking {session['title'].lower()}", "status": "in_progress" if i < 6 else "pending", "priority": "medium"} for i, session in enumerate(store["sessions"])]
        for task, title in zip(tasks, running_titles):
            task.update(title=title, status="active")
        status.update(parallel=6, running=[{"title": title, "taskId": f"command_task_{i:02d}", "sessionId": f"command_session_{i}", "projectId": project["id"], "startedAt": now - 95000 - i * 17000, "source": "fixture", "progress": .15 + i * .12} for i, title in enumerate(running_titles)])
        for agent in agents:
            agent.update(status="idle", progress=None)
        transcript = [
            ("user", "Keep the six active tasks readable in the node tree."),
            ("assistant", "Six builds are working through their saved checks. Open a task node to review its brief and current activity."),
            ("user", "Review the remaining live-state refresh paths."),
            ("assistant", "The task is on the board with its existing acceptance checks. Its current build is verifying the saved state before it records a result."),
            ("user", "Work on node-tree focus and label gaps."),
            ("assistant", "The node-tree follow-up is pinned near the front of the board. It will start when machine capacity and the task prerequisites allow it."),
            ("assistant", "The latest completed task is ready for review. Its saved work log includes the checks and remaining follow-up notes."),
        ]
        assistant.update(messages=[{"id": f"readability_message_{i}", "at": now - (len(transcript)-i) * 20000, "role": role, "text": message, "via": "fixture"} for i, (role, message) in enumerate(transcript)], unread=4, action={"kind": "working", "text": "Six builds in progress", "since": now - 95000})
    return tasks, ideas, {"assistant": assistant, "autopilot": status, "store": store}


def verify(source, output, baseline=False, interactive=False, palette_only=False, appearance_matrix=False, collapsed_polish=False, node_readability=False):
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
        tasks, ideas, data = fixture(project_info, now, node_readability=node_readability)
        if collapsed_polish:
            data["checkpoints"] = {session["id"]: [{"at": now - 30000, "note": "Saved fixture checkpoint: keyboard navigation and recovery context."}] for session in data["store"]["sessions"]}
        write_json(app_root / "data/eyes-tasks.json", tasks)
        write_json(app_root / "data/eyes-feature-ideas.json", ideas)
        write_json(app_root / "data/eyes-requests.json", [{"title": f"Verify backlog work {i + 1}", "prompt": "Keep the stored acceptance checks.", "source": "chat", "at": now - i * 60000} for i in range(8)])
        package = json.loads((source / "package.json").read_text(encoding="utf-8-sig"))
        package["main"] = "command-verify-entry.cjs"
        write_json(app_root / "package.json", package)
        config = {"profile": str(profile), "appRoot": str(app_root), "output": str(destination), "alpha": project_info, "baseline": baseline, "fixture": data, "interactive": interactive, "paletteOnly": palette_only, "appearanceMatrix": appearance_matrix, "collapsedPolish": collapsed_polish, "nodeReadability": node_readability}
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
                process.wait(timeout=3600 if interactive else 190)
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
    parser.add_argument("--palette-only", action="store_true", help="Check custom palettes, preview view controls and Zen on a fresh disposable fixture")
    parser.add_argument("--appearance-matrix", action="store_true", help="Check all 50 style/layout/view combinations and 10 light-theme style/view combinations")
    parser.add_argument("--collapsed-polish", action="store_true", help="Capture both collapsed panels with three builders, checkpoint badges, orb effects, 3D/2D and light colors; skip the Zen wait")
    parser.add_argument("--node-readability", action="store_true", help="Check six long running-task names with eight sessions, collapsed Live work and expanded Assistant in 3D/2D at wide and desktop sizes")
    args = parser.parse_args()
    result = verify(args.source.resolve(), args.output.resolve(), args.baseline, args.interactive, args.palette_only, args.appearance_matrix, args.collapsed_polish, args.node_readability)
    print(f"Command UI verified: {len(result['checks'])} checks, {len(result['screenshots'])} screenshots in {args.output.resolve()}")
