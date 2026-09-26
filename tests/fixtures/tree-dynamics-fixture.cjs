"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
exports.capture = async ({ contents, run, until, sleep, capturePage, report, root }) => {
  await until("window.MefiNav && window.MefiIdle && !window.MefiBoot?.isBooting?.()", "tree controls startup");
  await run("window.MefiNav.go('command');await window.MefiIdle.ready();window.MefiIdle.setView('2d');document.getElementById('idle-cam-orbit').click();window.MefiIdle.setOrbit(false);window.MefiIdle.setLabels('none');window.MefiTreeDynamics.update({mode:'steady',width:.7,height:.7,smoothing:.2,adaptCount:false});");
  await until("window.MefiIdle.debugNodes().some(n=>n.id==='task:command_render_task'&&Number.isFinite(n.x))", "painted tree task");
  await sleep(1200);
  const nodes = () => run("return window.MefiIdle.debugNodes().filter(n=>n.layoutAnchor&&Number.isFinite(n.x));");
  const original = await nodes();
  await run("window.MefiTreeDynamics.update({shape:'ring'});"); await sleep(1200);
  const ring = await nodes();
  report.geometryDebug = { original, ring, status: await run("return {idle:window.MefiIdle.status(),camera:window.MefiIdle.followStatus(),dynamics:window.MefiTreeDynamics.status()};") };
  assert.ok(ring.some(n => { const a = original.find(v => v.id === n.id); return a && Math.hypot(n.x - a.x, n.y - a.y) > 5; }), "ring moves the painted nodes");
  const anchors = new Map(ring.map(n => [n.id, n.layoutAnchor]));
  // Supply a deterministic decoded music frame to the real drawing loop.
  // FFT decoding and connection effects have their own real-WAV fixture.
  await run("const apply=window.MefiTreeDynamics.apply;window.MefiTreeDynamics.apply=(nodes,area,options)=>apply(nodes,area,{...options,linked:true,response:1,music:{bass:.9,mid:.8,treble:.5}});window.MefiTreeDynamics.update({mode:'music',nodeMotion:.8,shapeMotion:.8,positionMotion:.8});");
  await sleep(1200); const musical = await nodes();
  assert.ok(musical.some(n => { const a = ring.find(v => v.id === n.id); return a && Math.hypot(n.x - a.x, n.y - a.y) > 1 && n.radius > a.radius; }), "music changes painted positions and radii");
  for (const n of musical) assert.deepEqual(n.layoutAnchor, anchors.get(n.id), "live music preserves layout anchors");
  fs.writeFileSync(path.join(root, "tree-dynamics-canvas.png"), (await capturePage()).toPNG());
  await run("window.MefiTreeDynamics.update({mode:'video',videoTarget:'dark',videoStrength:1});window.MefiTreeDynamics.setVideoAvailable(true);");
  await sleep(1000); const neutral = await nodes();
  assert.equal(await run("const d=window.MefiTreeDynamics,token=d.sampleRequest().revision,scores=[.02,.3,.5,.3,.5,.7,.5,.7,.9];d.acceptSample(scores,token,10000);return d.acceptSample(scores,token,15000);"), true);
  await sleep(1200); const video = await nodes();
  const meanX = entries => entries.reduce((sum, n) => sum + n.x, 0) / entries.length;
  assert.ok(meanX(video) < meanX(neutral) - 1, "dark video regions move the real tree left");
  for (const n of video) assert.deepEqual(n.layoutAnchor, anchors.get(n.id));
  await run("document.body.classList.add('no-motion');window.MefiTreeDynamics.update({mode:'music'});");
  await sleep(250); const still = await nodes(); await sleep(300); const later = await nodes();
  for (const n of later) { const a = still.find(v => v.id === n.id); assert.ok(Math.hypot(n.x - a.x, n.y - a.y) < .1, "reduced motion freezes reactive positions"); }
  report.brightnessPixels = await run("const d=window.MefiTreeDynamics;d.update({nodeBrightness:.5,lineBrightness:1.5,outlines:true});const canvas=document.createElement('canvas');canvas.width=canvas.height=10;const pen=canvas.getContext('2d'),samples={};for(const kind of ['nodes','lines']){pen.clearRect(0,0,10,10);const restore=d.beginPaint([pen],kind);pen.fillStyle='rgb(100,120,140)';pen.fillRect(0,0,10,10);restore?.();samples[kind]=[...pen.getImageData(5,5,1,1).data];}d.update({nodeBrightnessEnabled:false});pen.clearRect(0,0,10,10);const restore=d.beginPaint([pen],'nodes');pen.fillStyle='rgb(100,120,140)';pen.fillRect(0,0,10,10);restore?.();samples.disabled=[...pen.getImageData(5,5,1,1).data];return samples;");
  assert.deepEqual(report.brightnessPixels, { nodes: [50,60,70,255], lines: [150,180,210,255], disabled: [100,120,140,255] }, "real canvas filters adjust each paint pass independently and preserve alpha");
  await run("window.MefiTreeDynamics.update({nodeBrightness:1.25,lineBrightness:1.6,nodeBrightnessEnabled:true,outlines:true});");
  await sleep(300);
  const visible = await nodes();
  for (const n of visible) { const a = later.find(v => v.id === n.id); assert.ok(Math.hypot(n.x-a.x,n.y-a.y)<.1, "brightness and outlines never move the tree"); }
  assert.equal(await run("return document.getElementById('idle-layer').getContext('2d').filter==='none'&&document.getElementById('idle-layer-far').getContext('2d').filter==='none';"), true, "brightness filters are restored before drawing labels or the next backdrop");
  fs.writeFileSync(path.join(root, "tree-brightness-outlines.png"), (await capturePage()).toPNG());
  const task = later.find(n => n.id === "task:command_render_task");
  for (const type of ["mouseMove", "mouseDown", "mouseUp"]) contents.sendInputEvent({ type, x: Math.round(task.x), y: Math.round(task.y), ...(type === "mouseMove" ? {} : { button: "left", clickCount: 1 }) });
  await until("window.MefiIdle.focusStatus().id==='task:command_render_task'", "clicking the transformed node selects its work");
  assert.deepEqual(report.errors, []);
  report.treeDynamics = { count: ring.length, shape: true, music: true, video: true, anchors: true, reducedMotion: true, hitTarget: true };
};
