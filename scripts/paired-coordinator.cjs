"use strict";
// Durable control plane. A lease that becomes uncertain is never reassigned.
// Workers receive one persisted start grant; a lost acknowledgement needs
// reconciliation, not another execution. No provider or process runs here.
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const { scrubOutbound } = require("./redaction.cjs");
const { appVersion } = require("./link-compat.cjs");
const LIMITS = Object.freeze({ workers: 16, jobs: 1000, page: 30, progress: 20, text: 800, result: 4000, leaseMs: 30000, inviteMs: 300000 });
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const REPO = /^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9_.-]{1,100}$/;
const SHA = /^[a-f0-9]{40}$/;
const digest = value => createHash("sha256").update(String(value)).digest("hex");
const equal = (a,b) => typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const text = (value,max=LIMITS.text) => scrubOutbound(String(value ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g," ")).slice(0,max);
function fault(message, status=409) { const error=new Error(message);error.status=status;return error; }
function specOf(raw) {
  if (!raw || !REPO.test(raw.repo) || !SHA.test(raw.commit) || raw.profile !== "studio-check") throw fault("Choose a GitHub repository, an exact commit and Studio checks.",400);
  return {repo:raw.repo,commit:raw.commit,profile:"studio-check"};
}
// app/protocol: the Studio version and protocol the worker last spoke (null before it said).
const publicWorker = w => ({id:w.id,name:w.name,repos:w.repos,profiles:w.profiles,revoked:w.revoked,lastSeen:w.lastSeen,app:w.app??null,protocol:w.protocol??null});
const publicJob = j => ({id:j.id,key:j.key,spec:j.spec,state:j.state,workerId:j.workerId,fence:j.fence,leaseUntil:j.leaseUntil,createdAt:j.createdAt,updatedAt:j.updatedAt,progress:j.progress,result:j.result,archived:j.archived??0,archiveChunks:j.archiveChunks??0});
async function atomic(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${randomUUID()}.tmp`;
  try { const handle=await fs.open(temporary,"wx",0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}await fs.rename(temporary,file); }
  catch(error){await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
}
async function archiveLine(file,line,inspect=false) {
  // A state-write retry must not append the same evicted line twice. The
  // monotonic archive sequence is stable until the state commit succeeds.
  let last=null;
  try{const handle=await fs.open(file,"r");try{const {size}=await handle.stat();const length=Math.min(size,8192),buffer=Buffer.alloc(length);await handle.read(buffer,0,length,size-length);const raw=buffer.toString("utf8").trim().split("\n").at(-1);if(raw)last=JSON.parse(raw);}finally{await handle.close();}}
  catch(error){if(error.code!=="ENOENT")throw error;}
  if(inspect)return last?.sequence;
  if(last?.sequence===line.sequence)return;
  await fs.appendFile(file,JSON.stringify(line)+"\n",{mode:0o600});
}
async function createCoordinator({directory,now=Date.now,write=atomic}={}) {
  if(!directory)throw new Error("Coordinator storage is required.");
  const file=path.join(directory,"coordinator.json");let state;
  try {state=JSON.parse(await fs.readFile(file,"utf8"));}
  catch(error){if(error.code!=="ENOENT")throw new Error("Coordinator state could not be read; existing work is preserved.");state={version:1,sequence:0,workers:[],jobs:[],invites:[]};}
  if(state.version!==1||!Array.isArray(state.workers)||!Array.isArray(state.jobs)||!Array.isArray(state.invites)||!Number.isSafeInteger(state.sequence))throw new Error("Coordinator state is unsupported; existing work is preserved.");
  let tail=Promise.resolve();
  const transaction=work=>{
    const pending=tail.then(async()=>{const next=structuredClone(state);const answer=await work(next);await write(file,next);state=next;return answer;});
    tail=pending.catch(()=>{});return pending;
  };
  const expire=s=>{for(const job of s.jobs){if(["assigned","running"].includes(job.state)&&job.leaseUntil<=now()){job.state="uncertain";job.updatedAt=now();}}s.invites=s.invites.filter(i=>i.until>now());};
  const worker=(s,auth)=>{
    const found=s.workers.find(w=>w.id===auth?.workerId);
    if(!found||found.revoked||!equal(found.tokenHash,digest(auth?.token??"")))throw fault("Worker authentication failed.",401);
    if(!ID.test(auth?.instanceId??""))throw fault("Worker instance is required.",400);
    return found;
  };
  const current=(s,auth)=>{const w=worker(s,auth);if(w.instanceId!==auth.instanceId)throw fault("Another worker instance owns this session.");return w;};
  const assignment=(s,auth,request)=>{
    const w=current(s,auth),job=s.jobs.find(j=>j.id===request?.jobId);
    if(!job||job.workerId!==w.id||job.fence!==request?.fence)throw fault("Assignment fence is stale.");
    return job;
  };
  const session=(w,auth)=>{
    if(w.instanceId&&w.instanceId!==auth.instanceId&&w.sessionUntil>now())throw fault("This worker is already connected from another instance.");
    w.instanceId=auth.instanceId;w.sessionUntil=now()+LIMITS.leaseMs;w.lastSeen=now();
    if(appVersion(auth.app))w.app=auth.app;if(Number.isInteger(auth.protocol))w.protocol=auth.protocol;
  };
  return {
    // Checks assigned or running right now. An update waits for these, and
    // only these: an idle coordinator stops, updates and starts again.
    activeJobs(){return state.jobs.filter(j=>["assigned","running"].includes(j.state)&&j.leaseUntil>now()).length;},
    async status({before=null}={}) {await tail;const index=before?state.jobs.findIndex(j=>j.id===before):state.jobs.length;if(index<0)throw fault("Queue history cursor is unavailable.",400);const eligible=state.jobs.slice(0,index),page=eligible.slice(-LIMITS.page).reverse();return {workers:state.workers.map(publicWorker),jobs:page.map(publicJob),total:state.jobs.length,nextCursor:eligible.length>LIMITS.page?page.at(-1).id:null};},
    async history(jobId,{chunk=0,offset=0}={}){await tail;const job=state.jobs.find(j=>j.id===jobId);if(!job||!Number.isInteger(chunk)||chunk<0||chunk>(job.archiveChunks??0)||!Number.isInteger(offset)||offset<0)throw fault("Progress history is unavailable.",400);let raw;try{raw=await fs.readFile(path.join(directory,"progress",`${job.id}-${chunk}.jsonl`),"utf8");}catch(error){if(error.code==="ENOENT")return {lines:[],next:null,previous:null};throw error;}const lines=raw.trim().split("\n").filter(Boolean).map(line=>JSON.parse(line));let previous=offset>0?{chunk,offset:Math.max(0,offset-LIMITS.progress)}:null;if(!previous&&chunk>0){const prior=(await fs.readFile(path.join(directory,"progress",`${job.id}-${chunk-1}.jsonl`),"utf8")).trim().split("\n").filter(Boolean);previous={chunk:chunk-1,offset:Math.floor(Math.max(0,prior.length-1)/LIMITS.progress)*LIMITS.progress};}return {lines:lines.slice(offset,offset+LIMITS.progress),next:offset+LIMITS.progress<lines.length?offset+LIMITS.progress:null,previous};},
    invite(){return transaction(s=>{expire(s);if(s.invites.length>=8)throw fault("Use or let an existing pairing code expire first.");const secret=randomBytes(32).toString("base64url"),id=randomUUID();s.invites.push({id,hash:digest(secret),until:now()+LIMITS.inviteMs});return {inviteId:id,secret,expiresAt:now()+LIMITS.inviteMs};});},
    pair(request){return transaction(s=>{expire(s);const invite=s.invites.find(i=>i.id===request?.inviteId);
      if(!invite||!equal(invite.hash,digest(request?.secret??"")))throw fault("Pairing code is invalid or expired.",401);
      if(s.workers.length>=LIMITS.workers)throw fault("Worker registry is full. Existing registrations are preserved.");
      const repos=Array.isArray(request.repos)?[...new Set(request.repos.filter(r=>typeof r==="string"&&REPO.test(r)))].slice(0,8):[];
      if(!repos.length||!Array.isArray(request.profiles)||!request.profiles.includes("studio-check"))throw fault("This worker must allow a repository and Studio checks.",400);
      const token=randomBytes(32).toString("base64url"),id=randomUUID();s.invites=s.invites.filter(i=>i.id!==invite.id);
      s.workers.push({id,name:text(request.name,60)||"Worker",tokenHash:digest(token),repos,profiles:["studio-check"],revoked:false,lastSeen:now(),instanceId:null,sessionUntil:0,app:appVersion(request.app)});return {workerId:id,token};
    });},
    // A worker stopping cleanly (a restart, an update, Stop) gives its session
    // back, so the next instance connects at once instead of after the lease.
    release(auth){return transaction(s=>{const w=worker(s,auth);if(w.instanceId===auth.instanceId)w.sessionUntil=0;return {ok:true};});},
    revoke(workerId){return transaction(s=>{const w=s.workers.find(w=>w.id===workerId);if(!w)throw fault("Worker not found.",404);w.revoked=true;for(const j of s.jobs){if(j.workerId===w.id&&["assigned","running"].includes(j.state))j.state="uncertain";}return {ok:true};});},
    enqueue(raw){return transaction(s=>{const spec=specOf(raw?.spec);if(!ID.test(raw?.key??""))throw fault("A queue request identity is required.",400);const previous=s.jobs.find(j=>j.key===raw.key);
      if(previous){if(JSON.stringify(previous.spec)!==JSON.stringify(spec))throw fault("Queue identity already belongs to another commit.");return publicJob(previous);}
      if(s.jobs.length>=LIMITS.jobs)throw fault("Queue is full. Existing history is preserved.");
      const job={id:randomUUID(),key:raw.key,spec,state:"queued",workerId:null,fence:0,leaseUntil:0,createdAt:now(),updatedAt:now(),progress:[],result:null};s.jobs.push(job);return publicJob(job);
    });},
    poll(auth){return transaction(s=>{expire(s);const w=worker(s,auth);session(w,auth);let job=s.jobs.find(j=>j.workerId===w.id&&["assigned","running","uncertain"].includes(j.state));
      if(!job){job=s.jobs.find(j=>j.state==="queued"&&w.repos.includes(j.spec.repo)&&w.profiles.includes(j.spec.profile));if(job){job.workerId=w.id;job.fence=++s.sequence;job.state="assigned";job.leaseUntil=now()+LIMITS.leaseMs;job.updatedAt=now();}}
      return {job:job?publicJob(job):null};
    });},
    start(auth,request){return transaction(s=>{expire(s);const job=assignment(s,auth,request);if(job.state==="running")return {started:false,job:publicJob(job)};if(job.state!=="assigned")throw fault("This assignment needs recovery before it can run.");job.state="running";job.startGranted=true;job.updatedAt=now();return {started:true,job:publicJob(job)};});},
    heartbeat(auth,request){return transaction(s=>{expire(s);const w=current(s,auth),job=assignment(s,auth,request);if(!["assigned","running"].includes(job.state))throw fault("Assignment is no longer live.");job.leaseUntil=now()+LIMITS.leaseMs;session(w,auth);return {leaseUntil:job.leaseUntil};});},
    progress(auth,request){return transaction(async s=>{expire(s);const job=assignment(s,auth,request);if(job.state!=="running")throw fault("Progress belongs to an inactive assignment.");const line={at:now(),text:text(request.text)};
      if(!line.text)return {ok:true};
      // Recent lines stay small; evicted lines remain in the job's archive.
      if(job.progress.length>=LIMITS.progress){await fs.mkdir(path.join(directory,"progress"),{recursive:true});job.archiveChunks??=0;const line={...job.progress.shift(),sequence:(job.archived??0)+1};let archive=path.join(directory,"progress",`${job.id}-${job.archiveChunks}.jsonl`);if(await archiveLine(archive,line,true)!==line.sequence){const size=await fs.stat(archive).then(s=>s.size,error=>{if(error.code==="ENOENT")return 0;throw error;});if(size+Buffer.byteLength(JSON.stringify(line)+"\n")>131072){job.archiveChunks++;archive=path.join(directory,"progress",`${job.id}-${job.archiveChunks}.jsonl`);}await archiveLine(archive,line);}job.archived=line.sequence;}
      job.progress.push(line);job.updatedAt=now();return {ok:true};
    });},
    finish(auth,request){return transaction(s=>{expire(s);const job=assignment(s,auth,request);const result={ok:request?.result?.ok===true,summary:text(request?.result?.summary,LIMITS.result),commit:job.spec.commit};
      if(job.result){if(JSON.stringify(job.result)!==JSON.stringify(result))throw fault("A different result is already recorded.");return {ok:true,duplicate:true};}
      if(!["running","assigned","uncertain"].includes(job.state))throw fault("Assignment is already closed.");
      if(result.ok&&job.startGranted!==true&&job.state!=="running")throw fault("This assignment has not received a persisted start grant.");
      job.result=result;job.state=request?.interrupted===true?"interrupted":result.ok?"completed":"failed";job.updatedAt=now();job.leaseUntil=0;return {ok:true};
    });},
    uncertain(auth,request){return transaction(s=>{const job=assignment(s,auth,request);if(!job.result){job.state="uncertain";job.updatedAt=now();}return {ok:true};});},
  };
}
module.exports={createCoordinator,atomic,LIMITS,specOf,text};
