"use strict";
const fs=require("node:fs/promises"),path=require("node:path");
const {spawn}=require("node:child_process");
const {randomUUID}=require("node:crypto");
const {atomic,text,specOf,LIMITS}=require("./paired-coordinator.cjs");
const {client}=require("./paired-transport.cjs");
const {appVersion}=require("./link-compat.cjs");
// Fixed, explicitly enabled profile. The coordinator supplies no command or
// filesystem path. Repository mappings and execution credentials stay local.
const CHECKS=Object.freeze([["scripts/check-targets.mjs"],["scripts/spec-collisions.mjs"],["scripts/check-css.mjs","--merge"],["scripts/check-css.mjs","--unused"],["scripts/check-syntax.mjs"],["scripts/check-testruns.mjs"]]);
function command(executable,args,{cwd,signal,onLine=()=>{},timeout=120000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd,signal,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:"1",GIT_TERMINAL_PROMPT:"0"},stdio:["ignore","pipe","pipe"]});
    let output="";
    const drain=async stream=>{for await(const chunk of stream){output=(output+chunk.toString()).slice(-8000);await onLine(text(chunk.toString()));}};
    let drainError=null;const drained=Promise.all([drain(child.stdout),drain(child.stderr)]).catch(error=>{drainError=error;});
    const timer=setTimeout(()=>{child.kill();child.stdout.destroy();child.stderr.destroy();reject(Object.assign(new Error("The repository command timed out; verify its processes stopped before retrying."),{needsRecovery:true}));},timeout);child.once("error",error=>{clearTimeout(timer);reject(error);});child.once("close",async code=>{clearTimeout(timer);await drained;if(drainError)reject(drainError);else if(code===0)resolve(output);else reject(new Error("The repository command failed or was interrupted."));});
  });
}
function gitCheckRunner({roots,workspace,node=process.execPath,execute=command}={}){
  return async({spec,jobId,onProgress,signal})=>{
    const root=roots?.[spec.repo];if(!root||spec.profile!=="studio-check"||!/^[a-f0-9]{40}$/.test(spec.commit))throw new Error("This repository or profile is not enabled on this worker.");
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(jobId))throw new Error("Invalid job identity.");
    const directory=path.join(workspace,jobId);await fs.mkdir(workspace,{recursive:true});
    const git=(cwd,...args)=>execute("git",["-c",`safe.directory=${cwd.replace(/\\/g,"/")}`,"-c",`safe.directory=${path.join(cwd,".git").replace(/\\/g,"/")}`,...args],{cwd,signal});
    await onProgress("Preparing an isolated checkout of the exact commit.");
    // Existing folders are recovery evidence, never reset or reused for a run.
    await fs.mkdir(directory);await git(root,"clone","--no-hardlinks","--no-checkout","--",root,directory);
    try{await git(directory,"cat-file","-e",`${spec.commit}^{commit}`);}catch{
      const origin=(await git(root,"remote","get-url","origin")).trim();
      const match=/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(origin);
      if(match?.[1]?.toLowerCase()!==spec.repo.toLowerCase())throw new Error("Fetch this commit through the worker's matching GitHub project first.");
      await git(directory,"fetch","--",origin,spec.commit);
    }
    await git(directory,"checkout","--detach",spec.commit);
    const exact=(await git(directory,"rev-parse","HEAD")).trim();if(exact!==spec.commit)throw new Error("The isolated checkout does not match the assignment.");
    const pkg=JSON.parse(await fs.readFile(path.join(directory,"package.json"),"utf8"));if(pkg.name!=="mefi-studio")throw new Error("The first worker profile supports Studio repositories only.");
    const passed=[];
    for(const args of CHECKS){if(signal.aborted)throw new Error("Check interrupted.");await onProgress(`Checking ${args[0].split("/").pop()}.`);await execute(node,args,{cwd:directory,signal,onLine:onProgress});passed.push(args.join(" "));}
    return {ok:true,summary:`${passed.length} Studio check steps passed at ${exact}.`};
  };
}
// The coordinator said this assignment is gone (stale fence, revoked, behind):
// stop the check. A dropped connection or a coordinator restart is not that;
// the check carries on while its lease lasts and the next poll reconciles.
const lostAssignment=error=>Number.isInteger(error?.status)&&error.status>=400&&error.status<500&&error.status!==429;
// While the coordinator cannot be reached the poll backs off to a minute, and
// to ten minutes when one side must update first (the update restarts Studio,
// which starts the worker again by itself). wake() polls at once.
async function createWorker({directory,url,workerId,token,run,request=null,app=null,pollMs=5000,heartbeatMs=5000,maxBackoffMs=60000,updateWaitMs=600000,leaseMs=LIMITS.leaseMs,clock=Date.now,onBehind=null}={}){
  const file=path.join(directory,"journal.json");let journal;
  try{journal=JSON.parse(await fs.readFile(file,"utf8"));}catch(error){if(error.code!=="ENOENT")throw new Error("Worker journal could not be read. Previous work is preserved.");journal={version:1,jobs:{}};}
  if(journal.version!==1||!journal.jobs||typeof journal.jobs!=="object"||Array.isArray(journal.jobs))throw new Error("Worker journal is unsupported.");
  journal.jobs=Object.assign(Object.create(null),journal.jobs);
  const instanceId=randomUUID(),send=request??client({url,workerId,token,instanceId,app});
  let pending=null,timer=null,abort=null,stopped=true,lastError=null,journalTail=Promise.resolve();
  let failures=0,update=null,coordinatorApp=null,since=null,link="off";
  const save=()=>{const snapshot=structuredClone(journal);const promise=journalTail.then(()=>atomic(file,snapshot));journalTail=promise.catch(()=>{});return promise;};
  const report=(job,row)=>send("finish",{jobId:job.id,fence:job.fence,result:row.result,interrupted:row.interrupted===true});
  const tick=()=>{
    if(pending)return pending;
    pending=(async()=>{
      const answer=await send("poll");lastError=null;failures=0;update=null;coordinatorApp=appVersion(answer?.app)??coordinatorApp;if(!stopped&&link!=="connected"){link="connected";since=clock();}
      const {job}=answer;if(!job)return;
      if(!/^[0-9a-f-]{36}$/.test(job.id)||!Number.isSafeInteger(job.fence)||job.fence<1)throw new Error("Coordinator assignment is malformed.");
      specOf(job.spec);
      const existing=journal.jobs[job.id];
      if(existing){
        if(existing.fence!==job.fence)throw new Error("Worker journal fence differs from the coordinator; check recovery first.");
        if(existing.phase==="finished"){await report(job,existing);return;}
        existing.phase="uncertain";await save();await send("uncertain",{jobId:job.id,fence:job.fence});return;
      }
      if(job.state!=="assigned"){journal.jobs[job.id]={fence:job.fence,phase:"uncertain"};await save();await send("uncertain",{jobId:job.id,fence:job.fence});return;}
      if(Object.keys(journal.jobs).length>=1000)throw new Error("Worker journal is full; previous history is preserved.");
      const row={fence:job.fence,phase:"claimed"};journal.jobs[job.id]=row;await save();
      let grant;try{grant=await send("start",{jobId:job.id,fence:job.fence});}catch{row.phase="uncertain";await save();return;}
      if(!grant.started){row.phase="uncertain";await save();return;}
      row.phase="running";await save();const controller=new AbortController();abort=controller;
      let sending=false,progressTail=Promise.resolve(),beat=clock();
      // A missed heartbeat is tolerated until the lease would run out; a
      // progress line that cannot be sent is dropped. Either one stops the
      // check when the coordinator says the assignment is gone.
      const pulse=setInterval(()=>{if(sending)return;sending=true;send("heartbeat",{jobId:job.id,fence:job.fence}).then(()=>{beat=clock();},error=>{if(lostAssignment(error)||clock()-beat>=leaseMs-heartbeatMs)controller.abort();}).finally(()=>{sending=false;});},heartbeatMs);
      const onProgress=line=>{progressTail=progressTail.then(()=>send("progress",{jobId:job.id,fence:job.fence,text:text(line)})).catch(error=>{if(lostAssignment(error))controller.abort();});return progressTail;};
      try{row.result=await run({spec:job.spec,jobId:job.id,onProgress,signal:abort.signal});row.interrupted=abort.signal.aborted;}
      catch(error){row.needsRecovery=error?.needsRecovery===true;row.result={ok:false,summary:abort.signal.aborted?"Worker stopped after losing its assignment connection.":"Repository checks failed. Review this worker's isolated checkout."};row.interrupted=abort.signal.aborted;}
      finally{clearInterval(pulse);await progressTail;abort=null;}
      if(row.needsRecovery){row.phase="uncertain";await save();await send("uncertain",{jobId:job.id,fence:job.fence});return;}
      row.phase="finished";await save();await report(job,row);
    })().catch(error=>{lastError=text(error.message,300);failures+=1;update=error?.update??null;coordinatorApp=error?.peerApp??coordinatorApp;const next=update?"update":"reconnecting";if(!stopped&&link!==next){link=next;since=clock();if(update==="worker"&&typeof onBehind==="function")try{onBehind();}catch{}}}).finally(()=>{pending=null;});return pending;
  };
  const delay=()=>failures===0?pollMs:update?updateWaitMs:Math.min(maxBackoffMs,pollMs*2**(failures-1));
  const schedule=wait=>{clearTimeout(timer);timer=setTimeout(loop,wait);};
  const loop=async()=>{timer=null;if(stopped)return;await tick();if(!stopped&&!timer)schedule(delay());};
  return {
    tick,
    start(){if(!stopped)return;stopped=false;link="connecting";since=clock();void loop();},
    // Stopping hands the session back (an older coordinator answers 404, which
    // is fine: it lets the session lapse after its lease instead).
    async stop(){const was=!stopped;stopped=true;clearTimeout(timer);timer=null;link="off";since=null;abort?.abort();await pending;if(was){let wait;await Promise.race([send("release").catch(()=>{}),new Promise(resolve=>{wait=setTimeout(resolve,2000);wait.unref?.();})]);clearTimeout(wait);}},
    // After sleep or a network change: poll now instead of at the backoff's end.
    wake(){if(stopped)return false;failures=0;if(!pending)schedule(0);return true;},
    // busy: a check is running on this PC now. link: off | connecting |
    // connected | reconnecting | update (update names the side that must).
    status(){return {running:!stopped,busy:abort!==null,error:lastError,link,since,update,coordinatorApp,retryInMs:link==="reconnecting"||link==="update"?delay():null,uncertain:Object.entries(journal.jobs).filter(([,row])=>row.phase==="uncertain").map(([id])=>id).slice(0,30)};},
    async confirmStopped(jobId){const row=journal.jobs[jobId];if(!row||row.phase!=="uncertain")throw new Error("This check does not need restart recovery.");row.phase="finished";row.result={ok:false,summary:"Owner confirmed the previous check process stopped."};row.interrupted=true;await save();await tick();},
  };
}
module.exports={createWorker,gitCheckRunner,command,CHECKS};
