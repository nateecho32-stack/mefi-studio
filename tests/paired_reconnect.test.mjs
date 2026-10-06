import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import control from "../scripts/paired-coordinator.cjs";
import transport from "../scripts/paired-transport.cjs";
import workerModule from "../scripts/paired-worker.cjs";
import adapter from "../scripts/paired-worker-host.cjs";

// Paired PCs that reconnect by themselves: the protocol window between a
// coordinator and its workers (scripts/link-compat.cjs), a worker that backs
// off while the coordinator is away and rides out a short drop mid-check, and
// a host that brings back what the owner left running after a restart.

const spec={repo:"owner/mefi-studio",commit:"a".repeat(40),profile:"studio-check"};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const network=()=>Object.assign(new Error("fetch failed"),{status:undefined});
const stale=()=>Object.assign(new Error("Assignment fence is stale."),{status:409});

async function setup(t,{spoken}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),"mefi-paired-reconnect-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const coordinator=await control.createCoordinator({directory:path.join(directory,"coordinator")});
  const server=await transport.startServer({coordinator,app:"0.5.0",...(spoken?{spoken}:{})});t.after(()=>server.close());
  const invite=await coordinator.invite();
  const paired=await transport.client({url:server.url,app:"0.4.6",...(spoken?{spoken}:{})})("pair",{...invite,name:"Laptop",repos:[spec.repo],profiles:[spec.profile]});
  return {directory,coordinator,server,paired};
}

test("PCs a protocol apart still connect; only the side that is really behind is told to update",async t=>{
  const h=await setup(t);
  const health=await (await fetch(`${h.server.url}/v1/health`)).json();
  assert.deepEqual(health,{ok:true,protocol:1,oldest:1,app:"0.5.0"},"health names the coordinator's window and Studio version");
  assert.equal((await h.coordinator.status()).workers[0].app,"0.4.6","pairing records the worker's Studio version");

  const newer=transport.client({url:h.server.url,...h.paired,instanceId:"newer-instance",app:"0.6.0",spoken:{protocol:2,oldest:1}});
  const answer=await newer("poll");
  assert.equal(answer.ok,true,"a worker one protocol ahead that still speaks 1 connects");
  assert.equal(answer.app,"0.5.0","every answer carries the coordinator's version");
  const worker=(await h.coordinator.status()).workers[0];
  assert.equal(worker.app,"0.6.0");assert.equal(worker.protocol,1,"they speak the highest number both know");

  const ahead=transport.client({url:h.server.url,...h.paired,instanceId:"ahead-instance",spoken:{protocol:3,oldest:2}});
  await assert.rejects(ahead("poll"),error=>error.status===426&&error.update==="coordinator"&&/coordinator PC's Studio is too far behind/.test(error.message));
});

test("a worker below the coordinator's oldest protocol is refused with words that name it",async t=>{
  const h=await setup(t,{spoken:{protocol:3,oldest:2}});
  const old=transport.client({url:h.server.url,...h.paired,instanceId:"old-instance",app:"0.3.3"});
  await assert.rejects(old("poll"),error=>error.status===426&&error.update==="worker"&&error.peerApp==="0.5.0"&&/This PC's Studio is too far behind/.test(error.message));
  const legacy=await fetch(`${h.server.url}/v1/poll`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
  assert.equal(legacy.status,426,"a worker from before versions were sent speaks protocol 1 only");
});

test("an unreachable coordinator is retried with backoff; wake() tries at once; a too-old worker waits for its update",async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"mefi-paired-backoff-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  let fail=network,behindCalls=0;
  const request=async action=>{if(action!=="poll")return {ok:true};if(fail)throw fail();return {ok:true,job:null,app:"0.5.0"};};
  const worker=await workerModule.createWorker({directory,request,run:async()=>({ok:true}),pollMs:60_000,maxBackoffMs:240_000,updateWaitMs:600_000,onBehind:()=>{behindCalls++;}});
  t.after(()=>worker.stop());
  worker.start();await pause(20);
  assert.equal(worker.status().link,"reconnecting");assert.equal(worker.status().retryInMs,60_000);
  worker.wake();await pause(20);
  assert.equal(worker.status().retryInMs,60_000,"wake() starts the backoff over");
  await worker.tick();assert.equal(worker.status().retryInMs,120_000,"each miss doubles the wait");
  await worker.tick();await worker.tick();assert.equal(worker.status().retryInMs,240_000,"up to the cap");
  fail=()=>Object.assign(new Error("too far behind"),{status:426,update:"worker",peerApp:"0.6.0"});
  await worker.tick();await worker.tick();
  assert.equal(worker.status().link,"update");assert.equal(worker.status().update,"worker");assert.equal(worker.status().coordinatorApp,"0.6.0");
  assert.equal(worker.status().retryInMs,600_000,"it asks again every ten minutes, not every minute");
  assert.equal(behindCalls,1,"the update look runs once per change, not per poll");
  fail=null;worker.wake();await pause(20);
  assert.equal(worker.status().link,"connected");assert.equal(worker.status().retryInMs,null);assert.equal(worker.status().update,null);
});

test("a check rides out missed heartbeats while its lease lasts and stops when the coordinator says the assignment is gone",async t=>{
  const h=await setup(t);await h.coordinator.enqueue({key:"request-one",spec});
  const send=transport.client({url:h.server.url,...h.paired,instanceId:"tolerant-instance"});
  let beats=null,now=0,signal=null,finish=null;
  const request=async(action,payload)=>{if(action==="heartbeat"&&beats)throw beats();if(action==="progress"&&beats)throw beats();return send(action,payload);};
  const run=async options=>{signal=options.signal;await options.onProgress("working");await new Promise(resolve=>{finish=resolve;options.signal.addEventListener("abort",resolve);});return {ok:true,summary:"done"};};
  const worker=await workerModule.createWorker({directory:path.join(h.directory,"worker"),request,run,heartbeatMs:5,leaseMs:30_000,clock:()=>now});
  const ticking=worker.tick();await pause(30);
  assert.equal(worker.status().busy,true,"the check is running");
  beats=network;await pause(40);
  assert.equal(signal.aborted,false,"a dropped connection inside the lease does not stop the check");
  now=30_000;await pause(30);
  assert.equal(signal.aborted,true,"once the lease would run out it stops");
  await ticking;
  const second=await setup(t);await second.coordinator.enqueue({key:"request-two",spec});
  const sendTwo=transport.client({url:second.server.url,...second.paired,instanceId:"stale-instance"});
  let gone=false,signalTwo=null;
  const requestTwo=async(action,payload)=>{if(action==="heartbeat"&&gone)throw stale();return sendTwo(action,payload);};
  const workerTwo=await workerModule.createWorker({directory:path.join(second.directory,"worker"),request:requestTwo,run:async options=>{signalTwo=options.signal;await new Promise(resolve=>options.signal.addEventListener("abort",resolve));return {ok:false};},heartbeatMs:5,leaseMs:30_000,clock:()=>0});
  const tickingTwo=workerTwo.tick();await pause(30);
  gone=true;await pause(30);
  assert.equal(signalTwo.aborted,true,"a 409 stops it at once");
  await tickingTwo;finish?.();
});

async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const {port}=server.address();await new Promise(resolve=>server.close(resolve));return port;}

async function hostFixture(t,{settings,accept}){
  const directory=await mkdtemp(path.join(os.tmpdir(),"mefi-paired-resume-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const root=path.join(directory,"project");await mkdir(root);await writeFile(path.join(root,"package.json"),'{"name":"mefi-studio"}');
  const dialogs=[];
  const host=adapter.createPairedHost({directory:path.join(directory,"desktop"),app:"0.5.0",project:async()=>({root,repo:spec.repo,commit:"a".repeat(40)}),readSettings:async()=>settings,updateSettings:async fn=>fn(settings),confirm:async(message)=>{dialogs.push(message);return accept.value;},chooseTLS:async()=>null,seal:value=>`fixture-encrypted:${Buffer.from(value).toString("base64")}`,unseal:value=>Buffer.from(value.slice(18),"base64").toString(),encryptionAvailable:()=>true});
  t.after(()=>host.close());return {host,dialogs,directory};
}

test("a started worker and coordinator come back by themselves after a restart; Stop and the switch keep them off",async t=>{
  const settings={},accept={value:true};
  const coordinator=await control.createCoordinator({directory:path.join(await mkdtemp(path.join(os.tmpdir(),"mefi-paired-remote-")),"c")});
  const server=await transport.startServer({coordinator,app:"0.5.0"});t.after(()=>server.close());
  const first=await hostFixture(t,{settings,accept});
  await first.host.pairWorker(JSON.stringify({url:server.url,...await coordinator.invite()}));
  let view=await first.host.startWorker();
  assert.equal(view.worker.running,true);assert.equal(view.worker.autoStart,true,"the confirmed Start remembers it");
  const port=await freePort();
  view=await first.host.startCoordinator({port});
  assert.equal(view.coordinator.running,true);assert.equal(settings.pairedCoordinator.autoStart,true);assert.equal(settings.pairedCoordinator.port,port);
  assert.match(first.dialogs.join("\n"),/Start the coordinator\?/);
  await first.host.close();
  assert.equal(settings.pairedWorker.autoStart,true,"closing for a restart or update keeps the switch");
  assert.equal(settings.pairedCoordinator.autoStart,true);

  const second=await hostFixture(t,{settings,accept});
  const resumed=await second.host.resume();
  assert.deepEqual(resumed.started,["coordinator","worker"]);assert.equal(second.dialogs.length,0,"nothing is asked at launch");
  assert.equal(resumed.coordinator.url,`http://127.0.0.1:${port}`);
  assert.equal(second.host.inFlight(),false,"idle services never hold an update");
  await pause(50);
  assert.equal((await second.host.status()).worker.link,"connected");
  assert.equal((await coordinator.status()).workers[0].app,"0.5.0","the coordinator sees this PC's Studio version");

  await second.host.stopWorker();await second.host.stopCoordinator();
  assert.equal(settings.pairedWorker.autoStart,false,"Stop holds it off after the next restart");
  assert.equal(settings.pairedCoordinator.autoStart,false);
  const third=await hostFixture(t,{settings,accept});
  assert.deepEqual((await third.host.resume()).started,[]);

  accept.value=false;
  assert.equal((await third.host.setAutoStart("worker",true)).cancelled,true,"turning the switch on asks first");
  assert.equal(settings.pairedWorker.autoStart,false);
  accept.value=true;
  assert.equal((await third.host.setAutoStart("worker",true)).worker.autoStart,true);
  assert.equal(third.dialogs.at(-1),"Start this worker by itself?");
  const asked=third.dialogs.length;
  assert.equal((await third.host.setAutoStart("worker",false)).worker.autoStart,false);
  assert.equal(third.dialogs.length,asked,"turning it off never asks");
  await assert.rejects(third.host.setAutoStart("both",true),/coordinator or the worker/);
});

test("a saved coordinator whose port is taken reports why and the worker still starts",async t=>{
  const blocker=net.createServer();await new Promise(resolve=>blocker.listen(0,"127.0.0.1",resolve));t.after(()=>blocker.close());
  const settings={pairedCoordinator:{autoStart:true,port:blocker.address().port,mode:"loopback",url:null,tls:null}};
  const h=await hostFixture(t,{settings,accept:{value:true}});
  const resumed=await h.host.resume();
  assert.deepEqual(resumed.started,[]);
  assert.match(resumed.coordinator.resumeError,/EADDRINUSE/);
  assert.equal(resumed.coordinator.running,false);
});
