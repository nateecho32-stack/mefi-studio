import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
const source=await readFile(new URL("../renderer/pc-sync.js",import.meta.url),"utf8");
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.attrs={};this.dataset={};this.text="";this.isConnected=true;}
  set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text+this.children.map(c=>c.textContent).join("");}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=[];this.append(...children);}setAttribute(key,value){this.attrs[key]=value;}removeAttribute(key){delete this.attrs[key];}addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}fire(type){for(const fn of this.listeners[type]??[])fn();}find(id){return this.id===id?this:this.children.map(c=>c.find?.(id)).find(Boolean);}
}
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const view=()=>({ok:true,encryptionAvailable:true,coordinator:{running:false,workers:[],jobs:[],nextCursor:null},worker:{paired:false,running:false,uncertain:[]}});
function fixture(api){const context=vm.createContext({window:{mefiStudio:api},document:{createElement:tag=>new Element(tag),getElementById:()=>null},setTimeout:()=>1,clearTimeout:()=>{}});vm.runInContext(source,context);return context.window.MefiPcSync.card();}
test("paired setup only reads after disclosure, and the operator starts a coordinator once per pending action",async()=>{
  const calls=[];let finish;const state=view();const card=fixture({pairedStatus:async()=>{calls.push("status");return state;},pairedCoordinator:()=>{calls.push("start");return new Promise(resolve=>{finish=resolve;});}}),box=card.find("pc-paired-workers");assert.deepEqual(calls,[]);
  box.open=true;box.fire("toggle");await flush();assert.deepEqual(calls,["status"]);
  card.find("paired-coordinator-start").fire("click");card.find("paired-coordinator-start").fire("click");assert.equal(calls.filter(c=>c==="start").length,1);finish({ok:true,cancelled:true});await flush();assert.equal(card.find("paired-coordinator-stop").disabled,true);
});
test("status refresh preserves a job's expanded detail and closed setup clears its invitation",async()=>{
  const state=view();state.coordinator.running=true;state.coordinator.jobs=[{id:"fixture-job",spec:{repo:"owner/mefi-studio",commit:"a".repeat(40)},state:"queued",progress:[]}];const card=fixture({pairedStatus:async()=>state,pairedInvite:async()=>({ok:true,code:"fixture-code"})}),box=card.find("pc-paired-workers");box.open=true;box.fire("toggle");await flush();
  const detail=box.children.find(c=>c.tagName==="DIV"&&c.children.some(x=>x.tagName==="DETAILS")).children[0];detail.open=true;card.find("paired-refresh").fire("click");await flush();assert.equal(detail.open,true);assert.ok(box.children.some(c=>c.children.includes(detail)));
  card.find("paired-invite").fire("click");await flush();assert.equal(card.find("paired-invitation").value,"fixture-code");box.open=false;box.fire("toggle");assert.equal(card.find("paired-invitation").value,"");
});

test("progress pages remain bounded and previously loaded lines are reachable with Previous",async()=>{
  const state=view();state.coordinator.jobs=[{id:"fixture-job",spec:{repo:"owner/mefi-studio",commit:"a".repeat(40)},state:"completed",progress:[],archived:40,archiveChunks:0}];const offsets=[];
  const card=fixture({pairedStatus:async()=>state,pairedHistory:async(_id,{offset})=>{offsets.push(offset);return {lines:Array.from({length:20},(_,i)=>({text:`line ${offset+i}`})),next:offset===0?20:null,previous:offset===0?null:{chunk:0,offset:0}};}}),box=card.find("pc-paired-workers");box.open=true;box.fire("toggle");await flush();
  card.find("paired-history-fixture-job").fire("click");await flush();card.find("paired-history-fixture-job").fire("click");await flush();assert.equal(card.find("paired-history-back-fixture-job").hidden,false);card.find("paired-history-back-fixture-job").fire("click");await flush();assert.deepEqual(offsets,[0,20,0]);const parent=el=>el.children.some(child=>child.id==="paired-history-fixture-job")?el:el.children.map(parent).find(Boolean);assert.equal(parent(box).children.at(-1).children.length,20);
});

test("Start by itself switches follow main's answer, and the status says how the worker's connection is doing",async()=>{
  const state=view();state.app="0.5.0";state.worker={paired:true,running:true,url:"https://desk.example",repo:"owner/mefi-studio",autoStart:true,link:"reconnecting",retryInMs:20000,uncertain:[]};
  state.coordinator.workers=[{id:"w1",name:"Laptop",repos:["owner/mefi-studio"],revoked:false,app:"0.4.6"},{id:"w2",name:"Tower",repos:["owner/mefi-studio"],revoked:false,app:"0.5.0"}];
  const calls=[];const card=fixture({pairedStatus:async()=>state,pairedAuto:async(role,on)=>{calls.push([role,on]);const next=structuredClone(state);next.coordinator.autoStart=role==="coordinator"?on:false;next.worker.autoStart=role==="worker"?on:true;return next;}}),box=card.find("pc-paired-workers");
  box.open=true;box.fire("toggle");await flush();
  assert.equal(card.find("paired-worker-auto").checked,true);assert.equal(card.find("paired-coordinator-auto").checked,false);
  assert.match(card.find("paired-status").textContent,/Worker lost https:\/\/desk\.example; reconnecting by itself \(next try in 20 s\)/);
  assert.match(box.textContent,/Laptop · Studio 0\.4\.6 \(older, still connects\)/);assert.match(box.textContent,/Tower · Studio 0\.5\.0 · owner/,"same version: no note");
  const tick=card.find("paired-coordinator-auto");tick.checked=true;tick.fire("change");await flush();
  assert.deepEqual(calls,[["coordinator",true]]);assert.equal(tick.checked,true,"main's answer sets the box");
  state.worker.link="update";state.worker.update="worker";card.find("paired-refresh").fire("click");await flush();
  assert.match(card.find("paired-status").textContent,/This PC's Studio is too far behind the coordinator's\. Update Studio here; the worker reconnects by itself\./);
  state.worker={paired:true,running:false,url:"https://desk.example",repo:"owner/mefi-studio",autoStart:true,resumeError:"Encrypted local storage is unavailable",uncertain:[]};card.find("paired-refresh").fire("click");await flush();
  assert.match(card.find("paired-status").textContent,/Worker did not start by itself: Encrypted local storage is unavailable/);
});
