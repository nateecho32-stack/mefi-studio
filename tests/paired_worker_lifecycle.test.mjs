import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
const source=(await readFile(new URL("../main.cjs",import.meta.url),"utf8")).replace(/\r\n/g,"\n");
function host(close){
  const start=source.indexOf("async function pairedWorkersClose("),end=source.indexOf("// ---- end of paired check workers",start);
  const context=vm.createContext({pairedWorkersHost:{close},pairedWorkersClosing:false,pairedWorkersQuitSaved:false,setTimeout,clearTimeout,app:{quit(){context.quits++;}},quits:0});
  vm.runInContext(source.slice(start,end),context);return context;
}
test("paired shutdown has a deadline and quit proceeds after rejection without repeating close",async()=>{
  const stalled=host(()=>new Promise(()=>{}));await assert.rejects(stalled.pairedWorkersClose(10),/saved journals need recovery/);
  let closes=0;const h=host(async()=>{closes++;throw new Error("disk failed");});let prevented=0;
  assert.equal(h.pairedWorkersQuit({preventDefault(){prevented++;}}),true);
  assert.equal(h.pairedWorkersQuit({preventDefault(){prevented++;}}),true);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(h.quits,1);assert.equal(closes,1);assert.equal(prevented,2);assert.equal(h.pairedWorkersQuit({preventDefault(){}}),false);
});
test("restart holds paired action admission closed until agent stop finishes, and reports close failure",async()=>{
  const begin=source.indexOf("async function restartStudio("),end=source.indexOf("// Retained manual-mode default",begin);
  let finish;const context=vm.createContext({activeChild:null,projectSwitching:false,pairedWorkersClosing:false,pairedWorkersClose:async()=>{},stopAllAgents:()=>new Promise(resolve=>{finish=resolve;}),assistantState:null,applyRestart:()=>({deferred:true}),CLI_MODE:false});
  vm.runInContext(source.slice(begin,end),context);const pending=context.restartStudio();await new Promise(resolve=>setImmediate(resolve));assert.equal(context.pairedWorkersClosing,true);finish({ok:true});await pending;assert.equal(context.pairedWorkersClosing,false);
  context.pairedWorkersClose=async()=>{throw new Error("held journal");};const result=await context.restartStudio();assert.equal(result.ok,false);assert.match(result.error,/held journal/);assert.equal(context.pairedWorkersClosing,false);
});
