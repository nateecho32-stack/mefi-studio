import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { DEVELOPMENT_WARNING } from "../scripts/development-updater.mjs";
const source = (await readFile(new URL("../main.cjs",import.meta.url),"utf8")).replace(/\r\n/g,"\n");
const slice = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function channelHost({confirm=0,failSave=false}={}) {
  const calls={dialogs:[],writes:[],checks:0,published:[]}; const settings={release:{lastApply:{from:"0.4.4"}},other:"kept"};
  const context=vm.createContext({releaseApplyInFlight:false,releaseCheckInFlight:null,window:{},dialog:{showMessageBox:async(_window,opts)=>{calls.dialogs.push(opts);return {response:confirm};}},loadModule:async()=>({DEVELOPMENT_WARNING}),updateSettings:async f=>{if(failSave)throw new Error("disk full");f(settings);calls.writes.push(structuredClone(settings));},publishRelease:p=>calls.published.push(p),checkRelease:async()=>{calls.checks++;},releaseStatus:()=>({channel:vm.runInContext("releaseChannel",context)})});
  vm.runInContext(slice('let releaseChannel = "stable";','\nfunction releaseStatus()'),context);
  return {context,calls,settings,set:channel=>context.setReleaseChannel(channel),get:()=>vm.runInContext("releaseChannel",context)};
}
test("native confirmation defaults to cancel and no renderer flag can bypass it",async()=>{
  const h=channelHost(); const result=await h.set("development"); assert.equal(result.cancelled,true);assert.equal(h.get(),"stable");assert.equal(h.calls.writes.length,0);assert.equal(h.calls.checks,0);
  assert.equal(h.calls.dialogs[0].defaultId,0);assert.equal(h.calls.dialogs[0].cancelId,0);assert.match(h.calls.dialogs[0].detail,/data loss/);
});
test("confirmed opt-in persists only the channel, fences old responses and clears stale staging",async()=>{
  const h=channelHost({confirm:1});assert.equal((await h.set("development")).ok,true);assert.equal(h.settings.release.channel,"development");assert.equal(h.settings.other,"kept");assert.equal(h.settings.release.lastApply.from,"0.4.4");assert.equal(vm.runInContext("releaseChannelEpoch",h.context),1);assert.equal(h.calls.published[0].staged,null);
  assert.equal((await h.set("stable")).ok,true);assert.equal(h.get(),"stable");assert.equal(h.calls.dialogs.length,1);assert.equal(h.calls.checks,2);
});
test("failed persistence leaves stable active; invalid and concurrent changes are refused",async()=>{
  const h=channelHost({confirm:1,failSave:true});assert.equal((await h.set("development")).ok,false);assert.equal(h.get(),"stable");assert.equal(h.calls.published.length,0);
  assert.equal((await h.set("main")).ok,false);h.context.releaseApplyInFlight=true;assert.equal((await h.set("development")).ok,false);
});
test("a channel change waits for the old check and refreshes only after the old response settles",async()=>{
  const h=channelHost({confirm:1});let release;h.context.releaseCheckInFlight=new Promise(resolve=>{release=resolve;});const change=h.set("development");await new Promise(resolve=>setImmediate(resolve));assert.equal(h.get(),"development");assert.equal(h.calls.checks,0);release();await change;assert.equal(h.calls.checks,1);
});
test("installed portable builds never activate the raw source updater",async()=>{
  let imports=0;const context=vm.createContext({updater:null,SMOKE:false,CAPTURE:false,CLI_MODE:false,app:{isPackaged:true},send:()=>{},updateEvent:x=>x,loadModule:()=>{imports++;},process:{env:{}}});
  vm.runInContext(slice("async function startUpdateWatch() {","\nfunction stopUpdateWatch()"),context);
  const result=await context.startUpdateWatch();assert.equal(result.disabled,true);assert.equal(result.running,false);assert.equal(imports,0);
});
function checkHost(channel="stable") {
  const calls={published:[],auto:0,queued:[]};let finish;
  const result=new Promise(resolve=>{finish=resolve;});
  const updater={DEFAULT_REPO:"owner/repo",checkForRelease:()=>result,CHECK_INTERVAL_MS:1200000};
  const context=vm.createContext({releaseCheckInFlight:null,releaseApplyInFlight:false,releaseState:{state:"idle",latest:null},releaseChannel:channel,releaseChannelEpoch:0,RELEASE_REPO:null,Date,app:{isPackaged:true,getVersion:()=>"0.4.4"},process:{platform:"win32",arch:"x64"},getReleaseUpdater:async()=>updater,loadModule:async()=>({checkForDevelopment:()=>result}),readSettings:async()=>({}),resolveGithubToken:async()=>null,publishRelease:p=>{calls.published.push(p);context.releaseState={...context.releaseState,...p};},releaseStatus:()=>context.releaseState,logLine:()=>{},setImmediate:f=>calls.queued.push(f),applyReleaseUpdate:async()=>{calls.auto++;}});
  vm.runInContext(slice("async function checkRelease() {","\nasync function getReleaseUpdater()"),context);
  return {context,calls,finish,check:()=>context.checkRelease()};
}
test("old channel responses cannot reintroduce a stale build, even after a late exception",async()=>{
  const h=checkHost();const pending=h.check();await new Promise(resolve=>setImmediate(resolve));h.context.releaseChannelEpoch++;h.finish({ok:true,latest:{version:"9.0.0"},update:{version:"9.0.0"}});await pending;assert.equal(h.context.releaseState.latest,null);
});
test("automatic installation is scheduled only for development and rechecks opt-out",async()=>{
  for(const channel of ["stable","development"]){const h=checkHost(channel);const pending=h.check();h.finish({ok:true,latest:{version:"0.4.5"},update:{version:"0.4.5"}});await pending;assert.equal(h.calls.queued.length,channel==="development"?1:0);h.context.releaseChannel="stable";for(const f of h.calls.queued)await f();assert.equal(h.calls.auto,0);}
});

test("failed automatic builds back off by version while manual attempts and newer builds remain available",async()=>{
  const h=checkHost("development");let now=1000;
  h.context.Date={now:()=>now};
  h.context.applyReleaseUpdate=async()=>{h.calls.auto++;return {ok:false,status:{state:"error"}};};
  h.finish({ok:true,latest:{version:"0.4.5-dev.100.1"},update:{version:"0.4.5-dev.100.1"}});
  const drain=async()=>{for(const callback of h.calls.queued.splice(0))await callback();};
  await h.check();await drain();assert.equal(h.calls.auto,1);
  await h.check();await drain();assert.equal(h.calls.auto,1);
  await h.context.applyReleaseUpdate();assert.equal(h.calls.auto,2);
  now+=60*60*1000;await h.check();await drain();assert.equal(h.calls.auto,3);
  h.context.checkRelease.developmentAutoFailure={version:"older-build",at:now};
  await h.check();await drain();assert.equal(h.calls.auto,4);
});

test("busy automatic updates do not back off and thrown failures do",async()=>{
  const h=checkHost("development");h.finish({ok:true,latest:{version:"0.4.5"},update:{version:"0.4.5"}});
  h.context.applyReleaseUpdate=async()=>{h.calls.auto++;return {ok:false,deferred:true,status:{state:"available"}};};
  const drain=async()=>{for(const callback of h.calls.queued.splice(0))await callback();};
  await h.check();await drain();await h.check();await drain();assert.equal(h.calls.auto,2);
  h.context.applyReleaseUpdate=async()=>{h.calls.auto++;throw new Error("download interrupted");};
  await h.check();await drain();await h.check();await drain();assert.equal(h.calls.auto,3);
});

test("channel failures show a useful fallback and preserve the bridge's reason",async()=>{
  const nav=(await readFile(new URL("../renderer/nav.js",import.meta.url),"utf8")).replace(/\r\n/g,"\n");
  const start=nav.indexOf('document.querySelector("#release-development")?.addEventListener("change",');
  const end=nav.indexOf('\n    });',start)+9;
  assert.ok(start>=0&&end>start);
  for(const error of [undefined,"Settings could not be saved"]){
    let handler;const toasts=[];const toggle={checked:true,disabled:false};
    const context=vm.createContext({document:{querySelector:()=>({addEventListener:(_event,f)=>{handler=f;}})},window:{mefiStudio:{releaseSetChannel:async()=>({ok:false,error})},MefiToast:message=>toasts.push(message)},paintRelease:()=>{},releaseUpdateState:{channel:"stable"}});
    vm.runInContext(nav.slice(nav.indexOf("function releaseView(status)"),nav.indexOf("function paintRelease(status)")),context);
    vm.runInContext(nav.slice(start,end),context);await handler({target:toggle});
    assert.equal(toggle.disabled,false);assert.equal(toasts.length,1);
    if(error)assert.equal(toasts[0],error);else assert.match(toasts[0],/Could not change.*try again/);
  }
});

test("channel cleanup preserves the disabled toggle during a concurrent update operation",async()=>{
  const nav=(await readFile(new URL("../renderer/nav.js",import.meta.url),"utf8")).replace(/\r\n/g,"\n");
  const start=nav.indexOf('document.querySelector("#release-development")?.addEventListener("change",');
  const end=nav.indexOf('\n    });',start)+9;
  for(const state of ["checking","downloading","applying","rollingback","current"]){
    let handler;const toggle={checked:true,disabled:false};
    const context=vm.createContext({document:{querySelector:()=>({addEventListener:(_event,f)=>{handler=f;}})},window:{mefiStudio:{releaseSetChannel:async()=>({ok:true,status:{state,channel:"development"}})}},releaseUpdateState:{state:"current"}});
    context.paintRelease=status=>{if(status)context.releaseUpdateState=status;};
    vm.runInContext(nav.slice(nav.indexOf("function releaseView(status)"),nav.indexOf("function paintRelease(status)")),context);
    vm.runInContext(nav.slice(start,end),context);await handler({target:toggle});
    assert.equal(toggle.disabled,state!=="current",state);
  }
});

test("jobs and project switches that begin during download retain verified staging instead of restarting",async()=>{
  for(const kind of ["job","switch"]){
    const context=vm.createContext({SMOKE:false,CAPTURE:false,CLI_MODE:false,app:{isPackaged:true,getVersion:()=>"0.4.4"},process:{platform:"win32"},projectSwitching:false,activeChild:null,autopilot:{jobs:[]},releaseApplyInFlight:false,releaseChannelSetting:false,releaseChannel:"stable",releaseState:{state:"available",latest:{version:"0.4.5",channel:"stable"},staged:null},getReleaseUpdater:async()=>({compareVersions:()=>1}),releaseStatus:()=>context.releaseState,publishRelease:p=>{context.releaseState={...context.releaseState,...p};},downloadReleaseBuild:async()=>{if(kind==="job")context.autopilot.jobs.push({finished:true,settlementPending:false});else context.projectSwitching=true;return {version:"0.4.5"};},logLine:()=>{}});
    vm.runInContext(slice("async function applyReleaseUpdate() {","\n// A boot that carries --released"),context);
    const result=await context.applyReleaseUpdate();assert.equal(result.deferred,true);assert.equal(context.releaseApplyInFlight,false);assert.equal(context.releaseState.state,"available");assert.equal(context.releaseState.staged.version,"0.4.5");
  }
});
