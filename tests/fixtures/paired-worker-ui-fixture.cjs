"use strict";
// Renderer bridge simulation only: no coordinator, credential or worker grant.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
exports.seed=responses=>{
  responses.syncStatus={ok:true,state:{behind:0,ahead:0},pending:[],problems:[]};
  responses.pairedStatus={ok:true,encryptionAvailable:true,coordinator:{running:false,url:null,workers:[{id:"fixture-worker",name:"Paired check PC",repos:["owner/mefi-studio"],revoked:false}],jobs:[{id:"fixture-job",spec:{repo:"owner/mefi-studio",commit:"a".repeat(40)},state:"uncertain",progress:[{text:"Connection lost; previous assignment is held for recovery."}],archived:0}],nextCursor:null},worker:{paired:true,running:false,repo:"owner/mefi-studio",uncertain:["fixture-job"]}};
};
exports.capture=async({window,run,until,sleep,capturePage,report,root})=>{
  await until("window.MefiPcSync", "PC sync surface");
  await run("const host=document.createElement('section');host.id='paired-fixture-host';host.style='position:fixed;inset:0;overflow:auto;background:var(--bg,#151515);padding:24px;z-index:99999';host.append(window.MefiPcSync.card());document.body.append(host);document.getElementById('pc-paired-workers').open=true;");
  await until("document.getElementById('paired-worker-start')&&!document.getElementById('paired-worker-start').disabled", "paired setup ready");
  const directory=process.env.MEFI_PAIRED_WORKER_CAPTURE_DIR||root;fs.mkdirSync(directory,{recursive:true});
  await run("document.getElementById('pc-paired-workers').scrollIntoView({block:'start'});");await sleep(200);
  fs.writeFileSync(path.join(directory,"paired-workers-desktop.png"),(await capturePage()).toPNG());
  window.setSize(600,900);await sleep(200);
  const geometry=await run("const section=document.getElementById('pc-paired-workers');return {width:innerWidth,controls:[...section.querySelectorAll('input,select,button')].filter(e=>e.checkVisibility()).map(e=>({id:e.id,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right})),text:section.textContent};");
  for(const control of geometry.controls)assert.ok(control.left>=0&&control.right<=geometry.width+1,`Control fits: ${control.id}`);
  assert.match(geometry.text,/Confirm previous check stopped/);assert.match(geometry.text,/uncertain/);
  fs.writeFileSync(path.join(directory,"paired-workers-narrow.png"),(await capturePage()).toPNG());
  report.pairedWorkers={bridge:"simulation",narrowFits:true,recoveryVisible:true};
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.networkAttempts,[]);assert.deepEqual(report.processAttempts,[]);
};
