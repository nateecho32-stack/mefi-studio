import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm,stat} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import adapter from "../scripts/paired-worker-host.cjs";
import control from "../scripts/paired-coordinator.cjs";
import transport from "../scripts/paired-transport.cjs";
async function fixture(t,{accept=false,encrypted=true}={}){
  const directory=await mkdtemp(path.join(os.tmpdir(),"mefi-paired-host-"));t.after(()=>rm(directory,{recursive:true,force:true}));const root=path.join(directory,"project");await mkdir(root);await writeFile(path.join(root,"package.json"),'{"name":"mefi-studio"}');
  const settings={},dialogs=[];const host=adapter.createPairedHost({directory:path.join(directory,"desktop"),project:async()=>({root,repo:"owner/mefi-studio",commit:"a".repeat(40)}),readSettings:async()=>settings,updateSettings:async fn=>fn(settings),confirm:async(message,detail)=>{dialogs.push({message,detail});return accept;},chooseTLS:async()=>null,seal:value=>`fixture-encrypted:${Buffer.from(value).toString("base64")}`,unseal:value=>Buffer.from(value.slice(18),"base64").toString(),encryptionAvailable:()=>encrypted});t.after(()=>host.close());return {directory,host,settings,dialogs};
}
test("opening status is local-only; cancelled coordinator start and queueing make no grants",async t=>{
  const h=await fixture(t);assert.equal((await h.host.status()).coordinator.running,false);await assert.rejects(stat(path.join(h.directory,"desktop","coordinator","coordinator.json")),/ENOENT/);
  assert.equal((await h.host.startCoordinator({port:42240})).cancelled,true);assert.equal(h.host.isRunning(),false);assert.equal((await h.host.enqueue()).cancelled,true);assert.equal((await h.host.status()).coordinator.total,0);
});
test("pairing needs encrypted storage; accepted loopback pairing stores a sealed credential that public status omits",async t=>{
  const missing=await fixture(t,{encrypted:false});await assert.rejects(missing.host.pairWorker("{}"),/Encrypted local storage/);assert.equal(missing.dialogs.length,0);
  const h=await fixture(t,{accept:true}),coordinator=await control.createCoordinator({directory:path.join(h.directory,"server")}),server=await transport.startServer({coordinator});t.after(()=>server.close());const invitation=await coordinator.invite();
  const view=await h.host.pairWorker(JSON.stringify({url:server.url,...invitation}));assert.equal(view.worker.paired,true);assert.equal(view.worker.running,false);assert.match(h.settings.pairedWorker.credentials,/^fixture-encrypted:/);assert.ok(!JSON.stringify(view).includes(h.settings.pairedWorker.credentials));assert.equal(h.dialogs.length,1);
  await h.host.forgetWorker();assert.equal((await h.host.status()).worker.paired,false);
});
