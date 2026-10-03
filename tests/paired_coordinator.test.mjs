import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import module from "../scripts/paired-coordinator.cjs";
const {createCoordinator,atomic,LIMITS}=module;
const spec={repo:"owner/mefi-studio",commit:"a".repeat(40),profile:"studio-check"};
async function fixture(t,options={}){const directory=await mkdtemp(path.join(os.tmpdir(),"mefi-paired-control-"));t.after(()=>rm(directory,{recursive:true,force:true}));const coordinator=await createCoordinator({directory,...options});const invite=await coordinator.invite();const paired=await coordinator.pair({...invite,name:"Worker",repos:[spec.repo],profiles:[spec.profile]});return {directory,coordinator,invite,auth:{...paired,instanceId:"instance-one"}};}
test("one-use expiring pairing persists hashes without invitation or worker secrets",async t=>{
  let now=1000;const h=await fixture(t,{now:()=>now});
  await assert.rejects(h.coordinator.pair({...h.invite,repos:[spec.repo],profiles:[spec.profile]}),/invalid or expired/);
  const raw=await readFile(path.join(h.directory,"coordinator.json"),"utf8");assert.ok(!raw.includes(h.auth.token));assert.ok(!raw.includes(h.invite.secret));
  const next=await h.coordinator.invite();now+=LIMITS.inviteMs+1;await assert.rejects(h.coordinator.pair({...next,repos:[spec.repo],profiles:[spec.profile]}),/invalid or expired/);
  const restarted=await createCoordinator({directory:h.directory,now:()=>now});assert.equal((await restarted.status()).workers[0].id,h.auth.workerId);
});
test("queue identity pins the exact commit and concurrent starts grant execution once across restart",async t=>{
  const h=await fixture(t);const first=await h.coordinator.enqueue({key:"request-one",spec});assert.equal((await h.coordinator.enqueue({key:"request-one",spec})).id,first.id);
  await assert.rejects(h.coordinator.enqueue({key:"request-one",spec:{...spec,commit:"b".repeat(40)}}),/another commit/);
  const {job}=await h.coordinator.poll(h.auth);const request={jobId:job.id,fence:job.fence};
  const grants=await Promise.all([h.coordinator.start(h.auth,request),h.coordinator.start(h.auth,request)]);assert.equal(grants.filter(g=>g.started).length,1);
  const restarted=await createCoordinator({directory:h.directory});assert.equal((await restarted.start(h.auth,request)).started,false);
  const result={ok:true,summary:"checks passed"};assert.equal((await restarted.finish(h.auth,{...request,result})).ok,true);assert.equal((await restarted.finish(h.auth,{...request,result})).duplicate,true);
  assert.equal((await restarted.status()).jobs[0].state,"completed");
});
test("expired assignments remain held and stale fences or overlapping worker sessions are rejected",async t=>{
  let now=1000;const h=await fixture(t,{now:()=>now});await h.coordinator.enqueue({key:"request-one",spec});const {job}=await h.coordinator.poll(h.auth);
  await assert.rejects(h.coordinator.poll({...h.auth,instanceId:"second-instance"}),/already connected/);
  now+=LIMITS.leaseMs+1;const renewed=await h.coordinator.poll(h.auth);assert.equal(renewed.job.state,"uncertain");assert.equal(renewed.job.fence,job.fence);
  await assert.rejects(h.coordinator.start(h.auth,{jobId:job.id,fence:job.fence}),/needs recovery/);
  await assert.rejects(h.coordinator.finish(h.auth,{jobId:job.id,fence:job.fence+1,result:{ok:true}}),/stale/);
  const invite=await h.coordinator.invite(),other=await h.coordinator.pair({...invite,name:"Other",repos:[spec.repo],profiles:[spec.profile]});assert.equal((await h.coordinator.poll({...other,instanceId:"other"})).job,null);
});
test("a failed persistence never publishes an assignment or start grant",async t=>{
  let fail=false;const h=await fixture(t,{write:async(file,state)=>{if(fail)throw new Error("disk full");await atomic(file,state);}});await h.coordinator.enqueue({key:"request-one",spec});fail=true;
  await assert.rejects(h.coordinator.poll(h.auth),/disk full/);assert.equal((await h.coordinator.status()).jobs[0].state,"queued");
  fail=false;const {job}=await h.coordinator.poll(h.auth);fail=true;const request={jobId:job.id,fence:job.fence};await assert.rejects(h.coordinator.start(h.auth,request),/disk full/);assert.equal((await h.coordinator.status()).jobs[0].state,"assigned");fail=false;assert.equal((await h.coordinator.start(h.auth,request)).started,true);
});
test("bounded progress retains older lines in a paged archive and revoked credentials stop working",async t=>{
  const h=await fixture(t);await h.coordinator.enqueue({key:"request-one",spec});const {job}=await h.coordinator.poll(h.auth),request={jobId:job.id,fence:job.fence};await h.coordinator.start(h.auth,request);
  for(let i=0;i<30;i++)await h.coordinator.progress(h.auth,{...request,text:`line ${i} token=super-private-value`});
  const view=(await h.coordinator.status()).jobs[0];assert.equal(view.progress.length,LIMITS.progress);assert.equal(view.archived,10);assert.equal((await h.coordinator.history(job.id)).lines.length,10);assert.match(view.progress[0].text,/redacted/);
  await h.coordinator.revoke(h.auth.workerId);await assert.rejects(h.coordinator.poll(h.auth),/authentication failed/);assert.equal((await h.coordinator.status()).jobs[0].state,"uncertain");
});

test("archive append remains idempotent when the following state write fails and is retried after restart",async t=>{
  let fail=false;const h=await fixture(t,{write:async(file,state)=>{if(fail)throw new Error("disk full");await atomic(file,state);}});await h.coordinator.enqueue({key:"archive-retry",spec});const {job}=await h.coordinator.poll(h.auth),request={jobId:job.id,fence:job.fence};await h.coordinator.start(h.auth,request);
  for(let i=0;i<LIMITS.progress;i++)await h.coordinator.progress(h.auth,{...request,text:`line ${i}`});
  fail=true;await assert.rejects(h.coordinator.progress(h.auth,{...request,text:"next line"}),/disk full/);
  const restarted=await createCoordinator({directory:h.directory});await restarted.progress(h.auth,{...request,text:"next line"});const page=await restarted.history(job.id);assert.equal(page.lines.length,1);assert.equal(page.lines[0].text,"line 0");assert.equal((await restarted.status()).jobs[0].archived,1);
});

test("late success reconciles an expired lease only when its start grant was persisted",async t=>{
  let now=1000;const h=await fixture(t,{now:()=>now});await h.coordinator.enqueue({key:"unstarted",spec});let {job}=await h.coordinator.poll(h.auth);let request={jobId:job.id,fence:job.fence};now+=LIMITS.leaseMs+1;await h.coordinator.poll(h.auth);await assert.rejects(h.coordinator.finish(h.auth,{...request,result:{ok:true}}),/persisted start grant/);await h.coordinator.finish(h.auth,{...request,result:{ok:false},interrupted:true});
  await h.coordinator.enqueue({key:"finished-before-disconnect",spec});({job}=await h.coordinator.poll(h.auth));request={jobId:job.id,fence:job.fence};await h.coordinator.start(h.auth,request);now+=LIMITS.leaseMs+1;await h.coordinator.poll(h.auth);await h.coordinator.finish(h.auth,{...request,result:{ok:true,summary:"finished before lost reply"}});assert.equal((await h.coordinator.status()).jobs[0].state,"completed");
});
