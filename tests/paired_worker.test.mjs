import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import control from "../scripts/paired-coordinator.cjs";
import transport from "../scripts/paired-transport.cjs";
import workerModule from "../scripts/paired-worker.cjs";
const spec={repo:"owner/mefi-studio",commit:"a".repeat(40),profile:"studio-check"};
async function setup(t){const directory=await mkdtemp(path.join(os.tmpdir(),"mefi-paired-loopback-"));t.after(()=>rm(directory,{recursive:true,force:true}));const coordinator=await control.createCoordinator({directory:path.join(directory,"coordinator")});const server=await transport.startServer({coordinator});t.after(()=>server.close());const invite=await coordinator.invite();const paired=await transport.client({url:server.url})("pair",{...invite,name:"Loopback",repos:[spec.repo],profiles:[spec.profile]});await coordinator.enqueue({key:"request-one",spec});return {directory,coordinator,server,paired};}
test("real loopback pairing and check completion are durable; a lost result reply never repeats execution",async t=>{
  const h=await setup(t);let runs=0,drop=true;const send=transport.client({url:h.server.url,...h.paired,instanceId:"one-instance"});
  const request=async(action,payload)=>{const result=await send(action,payload);if(action==="finish"&&drop){drop=false;throw new Error("reply lost");}return result;};
  const worker=await workerModule.createWorker({directory:path.join(h.directory,"worker"),request,run:async()=>{runs++;return {ok:true,summary:"fixture check passed"};}});
  await Promise.all([worker.tick(),worker.tick()]);await worker.tick();assert.equal(runs,1);assert.equal((await h.coordinator.status()).jobs[0].state,"completed");
  const journal=JSON.parse(await readFile(path.join(h.directory,"worker","journal.json"),"utf8"));assert.equal(Object.values(journal.jobs)[0].phase,"finished");
});
test("a lost persisted start acknowledgement is held after worker restart without executing",async t=>{
  const h=await setup(t);let runs=0;const send=transport.client({url:h.server.url,...h.paired,instanceId:"same-test-instance"});
  const request=async(action,payload)=>{const result=await send(action,payload);if(action==="start")throw new Error("start reply lost");return result;};
  const options={directory:path.join(h.directory,"worker"),request,run:async()=>{runs++;return {ok:true};}};
  const first=await workerModule.createWorker(options);await first.tick();const restarted=await workerModule.createWorker({...options,request:send});await restarted.tick();assert.equal(runs,0);assert.equal((await h.coordinator.status()).jobs[0].state,"uncertain");assert.equal(restarted.status().uncertain.length,1);
  await restarted.confirmStopped(restarted.status().uncertain[0]);assert.equal((await h.coordinator.status()).jobs[0].state,"interrupted");
});
test("LAN plaintext, credential URLs and redirects are refused",async t=>{
  const h=await setup(t);for(const url of ["http://192.168.1.2:1234","https://user:secret@example.com","https://example.com/?token=secret"])assert.throws(()=>transport.endpoint(url));
  await assert.rejects(transport.startServer({coordinator:h.coordinator,host:"0.0.0.0"}),/TLS/);
  let options;const request=transport.client({url:"https://example.com",fetchImpl:async(_url,opts)=>{options=opts;return Response.json({ok:true});}});await request("pair",{});assert.equal(options.redirect,"error");
});

test("oversized coordinator responses are refused before decoding",async()=>{
  const request=transport.client({url:"http://127.0.0.1",fetchImpl:async()=>new Response(" ".repeat(32769))});
  await assert.rejects(request("poll"),/too large/);
});

test("heartbeats lost for the rest of the lease abort the owned runner and journal interruption without repeating it",async t=>{
  const h=await setup(t);let runs=0;
  const send=transport.client({url:h.server.url,...h.paired,instanceId:"disconnect-instance"});
  const request=(action,payload)=>action==="heartbeat"?Promise.reject(new Error("disconnected")):send(action,payload);
  const worker=await workerModule.createWorker({directory:path.join(h.directory,"worker"),request,heartbeatMs:10,leaseMs:40,run:async({signal})=>{runs++;await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true}));throw new Error("aborted");}});
  await worker.tick();await worker.tick();assert.equal(runs,1);assert.equal((await h.coordinator.status()).jobs[0].state,"interrupted");
});

test("a command deadline settles promptly and worker timeouts remain held for process recovery",async t=>{
  const started=Date.now();await assert.rejects(workerModule.command(process.execPath,["-e","setInterval(()=>{},1000)"],{timeout:30}),error=>error.needsRecovery===true);assert.ok(Date.now()-started<5000);
  const h=await setup(t);let runs=0;const worker=await workerModule.createWorker({directory:path.join(h.directory,"worker"),request:transport.client({url:h.server.url,...h.paired,instanceId:"timeout-instance"}),run:async()=>{runs++;throw Object.assign(new Error("deadline"),{needsRecovery:true});}});
  await worker.tick();await worker.tick();assert.equal(runs,1);assert.equal((await h.coordinator.status()).jobs[0].state,"uncertain");assert.equal(worker.status().uncertain.length,1);
});

test("a non-JSON proxy response preserves its HTTP status without exposing its body",async()=>{
  const request=transport.client({url:"http://127.0.0.1",fetchImpl:async()=>new Response("private upstream body",{status:502})});
  await assert.rejects(request("poll"),error=>error.status===502&&/HTTP 502/.test(error.message)&&!error.message.includes("private"));
});
