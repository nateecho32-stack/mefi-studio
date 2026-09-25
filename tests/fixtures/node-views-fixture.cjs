"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

exports.seed = (responses, now) => {
  responses.communityStatus = { ok: true, status: { state: "member", configured: true, linked: true, entitlement: { premium: true, perks: ["premium"], validUntil: now + 86400000 }, nudge: { due: false } } };
  const titles = ["Search notes by tag", "Keep keyboard focus while filtering the results", "Export notes as Markdown", "Verify the saved notebook", "Add an empty state to the notes list", "Sync the sidebar selection", "Improve startup diagnostics", "Review completed changes"];
  responses.eyesState.sessions = titles.slice(0, 3).map((title, i) => ({ id: `visual-session-${i}`, title, timeCreated: now - 60000, timeUpdated: now }));
  responses.eyesState.todos = titles.slice(0, 3).flatMap((_, s) => Array.from({ length: 4 }, (_, i) => ({ id: `visual-todo-${s}-${i}`, sessionId: `visual-session-${s}`, content: ["Read the current behavior", "Implement the change", "Run the checks", "Review the result"][i], status: i === 0 ? "completed" : i === 1 ? "in_progress" : "pending" })));
  responses.tasksList.tasks = titles.map((title, i) => ({ id: `visual-task-${i}`, title, prompt: title, status: ["active", "open", "done", "awaiting_verification", "failed", "open", "open", "done"][i], sessionId: `visual-session-${i % 3}`, createdAt: now - 120000, updatedAt: now }));
  responses.assistantState.state.agents = [{ role: "reference", status: "running", text: "Reading the current behavior", target: { kind: "task", id: "visual-task-0" } }, { role: "auditor", status: "queued", text: "Waiting for evidence" }];
  responses.assistantState.state.status = "running";
  responses.assistantStatus.status.running = [{ id: "visual-worker", taskId: "visual-task-0", title: titles[0], startedAt: now - 65000, currentStep: "Checking tag matching", phase: "running" }];
  const steps = ["Understand the task", "Read storage", "Read search", "Build tag filtering", "Verify wide titles and keyboard focus", "Review changes"].map((title, i) => ({ id: `step-${i}`, title, kind: i > 3 ? "verify" : "build", status: ["done", "done", "failed", "active", "queued", "queued"][i], parents: i === 0 ? [] : i < 3 ? ["step-0"] : i === 3 ? ["step-1", "step-2"] : [`step-${i - 1}`] }));
  responses.brainState = { ok: true, pipelines: { "visual-task-0": { taskId: "visual-task-0", steps, updatedAt: now, summary: { total: 6, done: 2, active: 1 } } }, running: [], recent: [] };
  responses.brainEvents = { ok: true, events: [{ kind: "step.finish", taskId: "visual-task-0", step: "step-0", at: now }, { kind: "report", taskId: "visual-task-0", at: now + 20, text: "Checks passed" }] };
  responses.brainPlaybook = { ok: true, shelf: [], recipes: [] };
  responses.brainMap = { ok: true, map: { systems: ["Search", "Notebook storage", "Workspace interface", "Verification", "Model routing", "Project integration"].map((name, i) => ({ id: `system-${i}`, name, path: name.toLowerCase(), fileCount: 8 + i, files: [{ path: `src/system-${i}/index.js`, present: true }], tasks: { done: i, active: i === 0 ? 1 : 0, open: 2 }, heat: 6 - i })), links: [], sources: {} } };
};

exports.capture = async ({ window, contents, run, until, sleep, capturePage, report, root }) => {
  report.surfaces = []; report.styles = []; report.layouts = [];
  const settle = async () => { await run("return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));"); await sleep(650); };
  const save = async (name) => { await settle(); fs.writeFileSync(path.join(root, `${name}.png`), (await capturePage()).toPNG()); };
  await until("window.MefiIdle && window.MefiAgentBrain && window.MefiBrains && window.MefiMusic", "node views startup");
  await run("localStorage.setItem('mefiStudio.keyHint.v1','1'); localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,status:'complete'})); window.MefiIdle.setOrbit(false); window.MefiIdle.setBubbles(false);");
  for (const [width, height, zoom] of [[1440, 900, 1], [1024, 768, 1], [600, 560, 1], [1440, 900, 1.25]]) {
    window.setContentSize(width, height); contents.setZoomFactor(zoom);
    const suffix = `${width}-${Math.round(zoom * 100)}`;
    await run("window.MefiNav.go('command'); await window.MefiIdle.ready(); for(let i=0;i<3&&window.MefiIdle.selection();i++)window.MefiIdle.escape(); window.MefiIdle.fitAll();"); await settle();
    await until("window.MefiIdle.isActive() && window.MefiIdle.debugNodes().filter(n=>typeof n.radius==='number').length>5", "painted graph nodes");
    const command = await run("return {nodes:window.MefiIdle.debugNodes(),area:window.MefiIdle.graphViewport(),cards:window.MefiIdle.calloutStatus()};");
    assert.ok(command.nodes.length > 5);
    assert.ok(command.nodes.filter(n=>typeof n.radius==="number").every(n=>Number.isFinite(n.x+n.y+n.radius)));
    for (const card of command.cards) assert.ok(card.rect.w > 0 && card.rect.h > 0);
    report.surfaces.push({ view: "command", width, zoom, cards: command.cards.length }); await save(`command-${suffix}`);
    await run("window.MefiNav.go('brains');");
    await until("document.querySelectorAll('.brains-node').length > 5", "brain editor nodes"); await settle();
    const editor = await run(`return {nodes:document.querySelectorAll('.brains-node').length, wires:document.querySelectorAll('.brains-wire').length, ports:[...document.querySelectorAll('.brains-port')].map(p=>{const r=p.getBoundingClientRect();return {w:r.width,h:r.height};})};`);
    assert.ok(editor.wires > 5 && editor.ports.every(p=>p.w>0&&p.h>0));
    report.surfaces.push({ view: "brains", width, zoom, nodes: editor.nodes }); await save(`brains-${suffix}`);
    await run("window.MefiNav.go('agent-brain',{tab:'live',taskId:'visual-task-0'});");
    await until("document.querySelectorAll('#agent-brain-list .ab-pipe').length > 0", "live pipeline"); await settle();
    report.surfaces.push({ view: "pipeline", width, zoom }); await save(`pipeline-${suffix}`);
    await run("window.MefiAgentBrain.showTab('map');"); await settle();
    await until("document.querySelectorAll('#agent-brain-map .ab-index-item').length > 0", "project map");
    report.surfaces.push({ view: "map", width, zoom }); await save(`map-${suffix}`);
    await run("window.MefiNav.go('overhead');"); await until("document.querySelectorAll('.overhead-task-button').length > 0", "overhead tasks");
    if(!process.env.MEFI_NODE_VIEWS_SOURCE){
      const sizing = await run("const c=document.getElementById('overhead-canvas'),r=c.getBoundingClientRect();return {ratio:c.width/c.height,display:r.width/r.height};");
      assert.ok(Math.abs(sizing.ratio-sizing.display)<0.025,"Overhead bitmap matches its displayed aspect ratio");
    }
    report.surfaces.push({ view: "overhead", width, zoom }); await save(`overhead-${suffix}`);
  }
  window.setContentSize(1440, 900); contents.setZoomFactor(1);
  await run("window.MefiNav.go('command'); await window.MefiIdle.ready(); window.MefiIdle.fitAll();");
  for (const style of ["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"]) {
    await run(`window.MefiMusic.applyNodeStyle(${JSON.stringify(style)},false,{navigate:false});`); await settle();
    assert.equal(await run("return window.MefiIdle.status().nodeStyle;"), style);
    report.styles.push(style); await save(`style-${style}`);
  }
  await run("window.MefiMusic.applyNodeStyle('orbs',false); window.MefiIdle.setLabels('auto');");
  for (const view of ["2d", "3d"]) for (const layout of ["constellation", "tree", "radial", "helix", "layers"]) {
    await run(`window.MefiIdle.setView('${view}'); window.MefiMusic.applyNodeLayout('${layout}',false); window.MefiIdle.fitAll();`); await settle();
    const nodes = await run("return window.MefiIdle.debugNodes();");
    assert.ok(nodes.filter(n=>typeof n.radius==="number").every(n=>Number.isFinite(n.x+n.y)));
    report.layouts.push({ view, layout }); await save(`layout-${view}-${layout}`);
  }
  await contents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await run("window.MefiIdle.setView('3d'); window.MefiMusic.applyNodeLayout('constellation',false); window.MefiMusic.applyTheme('void',false,{navigate:false}); window.MefiIdle.fitAll();");
  await save("reduced-motion-void");
  const before = await run("return window.MefiIdle.geometryStatus();"); await sleep(200);
  const after = await run("return window.MefiIdle.geometryStatus();");
  assert.equal(after.angle, before.angle, "reduced motion keeps the camera still");
  await run("window.MefiIdle.select('task:visual-task-0');"); await settle();
  report.selected = await run("return window.MefiIdle.selection();");
  await save("focused-task");
  await run("window.MefiNav.go('agent-brain',{tab:'live'}); document.getElementById('agent-brain-replay').click();"); await save("pipeline-replay");
  // Exercise the same painter at small and large radii under real Chromium.
  report.paint = await run(`
    const v=window.MefiNodeVisuals;if(!v)return null;
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=320;
    const ctx=canvas.getContext('2d');ctx.fillStyle=v.palette().background;ctx.fillRect(0,0,800,320);
    let gradients=0;for(const name of ['createLinearGradient','createRadialGradient']){const original=ctx[name].bind(ctx);ctx[name]=(...a)=>{gradients++;return original(...a);};}
    const styles=['orbs','glass','minimal','halo','crystal','singularity','prism','sigil'];
    for(let j=0;j<3;j++)for(let i=0;i<8;i++)v.drawNode(ctx,{x:50+i*100,y:50+j*100},j===0?5:j===1?14:22,'#a99eff',{style:styles[i],active:j===1,selected:j===2,glyph:false});
    const warm=gradients;for(let i=0;i<8;i++)v.drawNode(ctx,{x:50+i*100,y:250},22,'#a99eff',{style:styles[i],selected:true});
    window.__nodeGallery=canvas.toDataURL();
    return {warm,after:gradients,pixels:ctx.getImageData(0,0,800,320).data.some((v,i)=>i%4!==3&&v>150)};
  `);
  if (report.paint) {
    assert.equal(report.paint.warm, report.paint.after); assert.ok(report.paint.pixels);
    fs.writeFileSync(path.join(root, "node-finishes.png"), Buffer.from((await run("return window.__nodeGallery;")).split(",")[1], "base64"));
  }
  await run("window.MefiMusic.applyTheme('aurora',false); window.MefiNav.go('brains'); document.getElementById('brains-zoom-level').click();");
  await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true})); document.querySelector('.brains-node').focus();");
  await save("brains-detail");
  report.wiring = await run(`
    const count=()=>document.querySelectorAll('.brains-wire').length, before=count();
    document.querySelector('.brains-port[data-node="n_verify_evidence"][data-port="issues"][data-dir="out"]').click();
    document.querySelector('.brains-port[data-node="n_issue_triage"][data-port="issue"][data-dir="in"]').click();
    const added=count(); document.getElementById('brains-undo').click(); const undone=count();
    document.getElementById('brains-redo').click(); const redone=count(); document.getElementById('brains-undo').click();
    return {before,added,undone,redone};
  `);
  assert.equal(report.wiring.added,report.wiring.before+1);
  assert.equal(report.wiring.undone,report.wiring.before);
  assert.equal(report.wiring.redone,report.wiring.added);
  report.scenes = [];
  for (const count of [80, 0]) {
    await run(`window.MefiNav.go('home'); window.nodeViewsFixture.scene(${count}); await window.MefiBoot.read('eyesState',{fresh:true}); await window.MefiBoot.read('tasksList',{fresh:true}); await window.MefiTree.reload(); window.MefiNav.go('command'); await window.MefiIdle.ready(); for(let i=0;i<3&&window.MefiIdle.selection();i++)window.MefiIdle.escape(); window.MefiIdle.fitAll();`);
    await settle();
    if(!count) await until("!window.MefiIdle.debugNodes().some(n=>n.kind==='session')", "empty Command graph");
    const scene = await run("return {nodes:window.MefiIdle.debugNodes(),cards:window.MefiIdle.calloutStatus()};");
    assert.ok(scene.nodes.filter(n=>typeof n.radius==="number").every(n=>Number.isFinite(n.x+n.y)));
    report.scenes.push({count,nodes:scene.nodes.length,cards:scene.cards.length});
    await save(count ? "crowded-long-titles" : "empty-command");
    if(!count){
      await run("window.MefiNav.go('agent-brain',{tab:'live'});"); await save("empty-pipeline");
      await run("window.MefiAgentBrain.showTab('map');"); await save("empty-map");
    }
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.networkAttempts, []);
  assert.deepEqual(report.processAttempts, []);
};
