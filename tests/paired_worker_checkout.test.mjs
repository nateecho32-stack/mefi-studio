import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import os from "node:os";
import path from "node:path";
import worker from "../scripts/paired-worker.cjs";
test("real Git and Node checks use the assigned older commit while preserving newer and dirty source work",async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"mefi-paired-checkout-"));t.after(()=>rm(directory,{recursive:true,force:true}));const root=path.join(directory,"source");await mkdir(path.join(root,"scripts"),{recursive:true});
  const git=(...args)=>execFileSync("git",["-c",`safe.directory=${root.replace(/\\/g,"/")}`,"-C",root,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init");git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");
  await writeFile(path.join(root,"package.json"),JSON.stringify({name:"mefi-studio",type:"module"}));await writeFile(path.join(root,"marker.txt"),"assigned commit");
  for(const [name] of worker.CHECKS)await writeFile(path.join(root,name),'import assert from "node:assert/strict";import{readFileSync}from"node:fs";assert.equal(readFileSync("marker.txt","utf8"),"assigned commit");console.log("isolated check passed");');
  git("add",".");git("commit","-m","assigned fixture");const commit=git("rev-parse","HEAD");await writeFile(path.join(root,"marker.txt"),"newer commit");git("add",".");git("commit","-m","newer fixture");await writeFile(path.join(root,"marker.txt"),"unsaved source work");
  const workspace=path.join(directory,"checkouts"),run=worker.gitCheckRunner({roots:{"owner/mefi-studio":root},workspace}),jobId=randomUUID(),lines=[];
  const result=await run({spec:{repo:"owner/mefi-studio",commit,profile:"studio-check"},jobId,onProgress:line=>lines.push(line),signal:new AbortController().signal});assert.equal(result.ok,true);assert.match(result.summary,/6 Studio check steps passed/);assert.equal(await readFile(path.join(root,"marker.txt"),"utf8"),"unsaved source work");assert.equal(await readFile(path.join(workspace,jobId,"marker.txt"),"utf8"),"assigned commit");
  await assert.rejects(run({spec:{repo:"owner/mefi-studio",commit,profile:"studio-check"},jobId,onProgress:()=>{},signal:new AbortController().signal}),/EEXIST/);assert.equal(await readFile(path.join(workspace,jobId,"marker.txt"),"utf8"),"assigned commit");assert.ok(lines.some(line=>line.includes("check passed")));
});
