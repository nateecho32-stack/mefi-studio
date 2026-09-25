// All graph surfaces in real Chromium, isolated from Studio's host and stores.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(studio, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const canRun = existsSync(executable) && (process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

test("all node views paint across window sizes, themes, layouts, styles and reduced motion", { skip: !canRun, timeout: 180000 }, async (t) => {
  const source = process.env.MEFI_NODE_VIEWS_SOURCE || studio;
  const fixture = await mkdtemp(path.join(tmpdir(), "mefi-node-views-"));
  try {
    await mkdir(path.join(fixture, "renderer")); await mkdir(path.join(fixture, "data"));
    const files = (await readdir(path.join(source, "renderer"))).filter(n=>/\.(js|css)$/.test(n)||n==="booklet.template.html");
    await Promise.all(files.map(n=>copyFile(path.join(source,"renderer",n),path.join(fixture,"renderer",n))));
    await copyFile(path.join(source,"data","models.json"),path.join(fixture,"data","models.json"));
    const { build } = await import(pathToFileURL(path.join(source,"scripts","build-booklet.mjs")));
    await build({root:fixture});
    const env={...process.env,MEFI_COMMAND_RENDER_FIXTURE:fixture,MEFI_NODE_VIEWS_CAPTURE:"1"}; delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(executable,[path.join(studio,"tests","fixtures","command-render-electron.cjs")],{cwd:studio,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let output="";
    for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{output=(output+chunk).slice(-12000);});
    const timer=setTimeout(()=>child.kill(),150000);
    const code=await new Promise((resolve,reject)=>{child.once("close",resolve);child.once("error",reject);}).finally(()=>clearTimeout(timer));
    let report;try{report=JSON.parse(await readFile(path.join(fixture,"report.json"),"utf8"));}catch{}
    const capture=process.env.MEFI_NODE_VIEWS_OUTPUT;
    if(capture&&path.isAbsolute(capture)){
      await mkdir(capture,{recursive:true});
      await Promise.all((await readdir(fixture)).filter(n=>n.endsWith(".png")||n==="report.json").map(n=>copyFile(path.join(fixture,n),path.join(capture,n))));
      t.diagnostic(`Graph captures: ${capture}`);
    }
    assert.equal(code,0,`${report?.failure||"No graph report"}\n${output}`);
    assert.equal(report.surfaces.length,20); assert.equal(report.styles.length,8); assert.equal(report.layouts.length,10);
    if(!process.env.MEFI_NODE_VIEWS_SOURCE)assert.ok(report.paint?.pixels);
  } finally {
    assert.equal(path.dirname(fixture),path.resolve(tmpdir()));
    await rm(fixture,{recursive:true,force:true,maxRetries:8,retryDelay:250});
  }
});
