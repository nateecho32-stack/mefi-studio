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
test("restart holds paired action admission closed until its decision and does not close on deferral",async()=>{
  const begin=source.indexOf("async function restartStudio("),end=source.indexOf("// Retained manual-mode default",begin);
  let finish,closed=0;const context=vm.createContext({activeChild:null,projectSwitching:false,pairedWorkersClosing:false,pairedWorkersClose:async()=>{closed++;},stopAllAgents:()=>new Promise(resolve=>{finish=resolve;}),assistantState:null,applyRestart:()=>({deferred:true}),CLI_MODE:false});
  vm.runInContext(source.slice(begin,end),context);const pending=context.restartStudio();await new Promise(resolve=>setImmediate(resolve));assert.equal(context.pairedWorkersClosing,true);finish({ok:true});await pending;assert.equal(context.pairedWorkersClosing,false);
  assert.equal(closed,0);
});

test("paired close occurs after final restart deferrals and before relaunch; close failure prevents exit",async()=>{
  const begin=source.indexOf("async function applyRestart("),end=source.indexOf("async function startUpdateWatch",begin);let closes=0;const calls=[];
  const context=vm.createContext({activeChild:null,projectSwitching:false,autopilot:{jobs:[]},updateDrainRequested:false,updater:null,window:null,updateSettings:async change=>change({}),saveResume:async()=>{},setTimeout,UPDATE_GRACE_MS:0,stopUpdateWatch:()=>calls.push("watch"),stopEyesWatch:()=>{},stopMachineWatch:()=>{},stopAssistant:()=>{},relaunchArgs:()=>[],app:{releaseSingleInstanceLock:()=>calls.push("lock"),relaunch:()=>calls.push("relaunch"),exit:()=>calls.push("exit")},pairedWorkersPrepareRestart:async()=>{closes++;calls.push("paired");return {ok:true};}});
  vm.runInContext(source.slice(begin,end),context);context.saveResume=async()=>{context.projectSwitching=true;};assert.equal((await context.applyRestart([])).deferred,true);assert.equal(closes,0);
  context.projectSwitching=false;context.saveResume=async()=>{};assert.equal((await context.applyRestart([])).ok,true);assert.ok(calls.includes("paired"));assert.ok(calls.includes("relaunch"));assert.ok(calls.indexOf("paired")<calls.indexOf("relaunch"));
  calls.length=0;context.pairedWorkersPrepareRestart=async()=>({ok:false,error:"held journal"});assert.equal((await context.applyRestart([])).ok,false);assert.deepEqual(calls,[]);
  context.pairedWorkersPrepareRestart=async()=>{context.projectSwitching=true;return {ok:true};};assert.equal((await context.applyRestart([])).deferred,true);assert.deepEqual(calls,[]);
});
