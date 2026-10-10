import test from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const electron=path.join(root,"node_modules/electron/dist",process.platform==="win32"?"electron.exe":process.platform==="darwin"?"Electron.app/Contents/MacOS/Electron":"electron");
test("social content in Chromium: no passive network, image re-encoding and review, exact two-step trade consent",{timeout:150000,skip:!existsSync(electron)||(process.platform==="linux"&&!process.env.DISPLAY&&!process.env.WAYLAND_DISPLAY)},async()=>{
  const fixture=await mkdtemp(path.join(tmpdir(),"mefi-social-content-"));
  try {
    const env={...process.env,MEFI_SOCIAL_FIXTURE:fixture};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(electron,[path.join(root,"tests/fixtures/social-content-electron.cjs")],{cwd:root,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let output="";for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{output=(output+chunk).slice(-12000);});
    const timer=setTimeout(()=>{if(process.platform==="win32"&&child.pid)spawn("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});else child.kill();},130000);
    const code=await new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);}).finally(()=>clearTimeout(timer));
    let report;try{report=JSON.parse(await readFile(path.join(fixture,"report.json"),"utf8"));}catch{}
    assert.equal(code,0,`${report?.error||"Missing report"}\n${output}`);assert.equal(report.complete,true);assert.deepEqual(report.permissions,[]);assert.deepEqual(report.passiveNetwork,[]);
  }finally{assert.equal(path.dirname(fixture),path.resolve(tmpdir()));assert.ok(path.basename(fixture).startsWith("mefi-social-content-"));await rm(fixture,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
});
