// The shipped renderer, exercised with an isolated bridge and real Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../scripts/build-booklet.mjs";
const studio=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const executable=path.join(studio,"node_modules","electron","dist",process.platform==="win32"?"electron.exe":"electron");
test("update channel UI keeps cancelled consent stable, shows missing artifacts and supports narrow windows",{skip:!existsSync(executable)||(process.platform!=="win32"&&!process.env.DISPLAY)},async()=>{
  const fixture=await mkdtemp(path.join(os.tmpdir(),"mefi-release-channel-render-"));
  try {
    await mkdir(path.join(fixture,"renderer"));await mkdir(path.join(fixture,"data"));
    const files=(await readdir(path.join(studio,"renderer"))).filter(name=>/\.(js|css)$/.test(name)||name==="booklet.template.html");
    await Promise.all(files.map(name=>copyFile(path.join(studio,"renderer",name),path.join(fixture,"renderer",name))));
    await copyFile(path.join(studio,"data","models.json"),path.join(fixture,"data","models.json"));await build({root:fixture});
    const env={...process.env,MEFI_COMMAND_RENDER_FIXTURE:fixture,MEFI_RELEASE_CHANNEL_CAPTURE:"1"};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(executable,[path.join(studio,"tests","fixtures","command-render-electron.cjs")],{cwd:fixture,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let output="";child.stdout.on("data",chunk=>{output=(output+chunk).slice(-8000);});child.stderr.on("data",chunk=>{output=(output+chunk).slice(-8000);});
    const timer=setTimeout(()=>child.kill(),60000);
    const code=await new Promise((resolve,reject)=>{child.on("error",reject);child.on("close",resolve);}).finally(()=>clearTimeout(timer));
    const report=JSON.parse(await readFile(path.join(fixture,"report.json"),"utf8"));assert.equal(code,0,report.failure||output);assert.equal(report.channels.cancelKeptStable,true);assert.equal(report.channels.returnedToStable,true);
  } finally {await rm(fixture,{recursive:true,force:true});}
});
