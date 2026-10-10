import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import contract from "../scripts/referrals-contract.cjs";
import actorContract from "../scripts/actor-contract.cjs";
import hub from "../scripts/hub-client.cjs";

const AP = actorContract.ACTOR_PROTOCOL, actor = "studio:12345678-1234-4abc-8abc-123456789abc", other = "studio:23456789-1234-4abc-8abc-123456789abc";
const code = "ref_" + "a".repeat(64), requestId = "referral_request_001", now = 1_800_000_000_000;
const clone = v => JSON.parse(JSON.stringify(v));
const status = () => ({threshold:5,qualifyingInvitees:0,qualified:false,attributionRecorded:false,invitation:null,canIssue:true,issueReason:null,canRedeem:true,redeemReason:null});
const deferred = () => { let resolve; const promise = new Promise(r => {resolve=r;}); return {promise,resolve}; };
test("referral routes accept only exact actor-free public requests", () => {
  assert.deepEqual(contract.request("readReferralStatus",{}),{method:"GET",path:"/v1/referrals"});
  assert.deepEqual(contract.request("issueReferralInvitation",{requestId}),{method:"POST",path:"/v1/referrals/invitations",body:{requestId}});
  assert.deepEqual(contract.request("redeemReferralInvitation",{code,requestId}),{method:"POST",path:"/v1/referrals/redeem",body:{code,requestId}});
  for (const extra of ["actor","actorId","guard","inviter","invitee","qualified","count"])
    assert.equal(contract.request("redeemReferralInvitation",{code,requestId,[extra]:actor}),null);
  for (const bad of [code.toUpperCase(),code+" ", "https://example.test/"+code,"room_123",null,123])
    assert.equal(contract.request("redeemReferralInvitation",{code:bad,requestId}),null);
  assert.equal(contract.request("readReferralStatus",{cursor:"x"}),null);
});
test("status preserves authoritative award independently of count and validates all bounds and gates", () => {
  const v=status();v.qualified=true;assert.equal(contract.response("readReferralStatus",v).qualified,true);
  for (const patch of [{threshold:4},{qualifyingInvitees:"5"},{qualifyingInvitees:-1},{qualifyingInvitees:1.5},{qualifyingInvitees:Number.MAX_SAFE_INTEGER+1},
    {canIssue:false},{issueReason:"private"},{canRedeem:false},{attributionRecorded:true},{redeemReason:"referral_already_recorded"},{qualified:1},{provider:"secret"}])
    assert.equal(contract.response("readReferralStatus",{...v,...patch}),null);
  assert.ok(contract.response("readReferralStatus",{...v,qualifyingInvitees:Number.MAX_SAFE_INTEGER,attributionRecorded:true,canRedeem:false,redeemReason:"referral_already_recorded"}));
  for (const invitation of [{code,expiresAt:0},{code,expiresAt:"123"},{code,expiresAt:now,owner:actor}])assert.equal(contract.status({...v,invitation}),null);
});
test("expired issue replay is a valid historical receipt and never implicitly renews", () => {
  assert.deepEqual(contract.response("issueReferralInvitation",{code,expiresAt:1,replayed:true}),{ok:true,code,expiresAt:1,replayed:true});
  assert.equal(contract.response("issueReferralInvitation",{code,expiresAt:now,replayed:true,url:"https://example.test"}),null);
  assert.equal(contract.response("redeemReferralInvitation",{recorded:false,replayed:true}),null);
});
test("only three exact durable negative receipts can retire an original redemption", () => {
  for (const error of ["self_referral","referral_already_recorded","referral_invitation_unavailable"]) {
    const raw={error:{code:error},outcome:"not-applied",requestId}, http=error==="referral_invitation_unavailable"?404:409;
    assert.deepEqual(contract.error("redeemReferralInvitation",raw,{code,requestId},http),{ok:false,error,outcome:"not-applied",requestId});
    assert.equal(contract.error("redeemReferralInvitation",raw,{code,requestId:"other_request"},http).error,"bad_response");
    assert.equal(contract.error("issueReferralInvitation",raw,{requestId},http).error,"bad_response");
    assert.equal(contract.error("redeemReferralInvitation",{...raw,inviter:actor},{code,requestId},http).error,"bad_response");
    assert.equal(contract.error("redeemReferralInvitation",{error:{code:error}},{code,requestId},http).outcome,undefined);
  }
  assert.equal(contract.error("redeemReferralInvitation",{error:{code:"read_only"},outcome:"not-applied",requestId},{code,requestId},403).error,"bad_response");
});
test("safe errors do not expose prose or mislabel lifetime capacity as a retry window", () => {
  assert.deepEqual(contract.error("readReferralStatus",{error:{code:"referral_rate_limited"}},{},429,"30"),{ok:false,error:"referral_rate_limited",retryAfter:30000});
  for (const header of ["0","3601","1.5","-1"])assert.equal(contract.error("readReferralStatus",{error:{code:"referral_rate_limited"}},{},429,header).retryAfter,undefined);
  assert.equal(contract.error("readReferralStatus",{error:{code:"referral_capacity_reached"}},{},429,"30").retryAfter,undefined);
  assert.equal(contract.error("readReferralStatus",{error:{code:"private_stack"}},{},500).error,"referrals_unavailable");
  assert.equal(contract.error("readReferralStatus",{error:{code:"unauthorized",message:"secret"}},{},401).error,"bad_response");
});
async function fixture({features=[AP,"referrals.1"],canonical=true,address="https://hub.example.test",reply=()=>new Response(JSON.stringify(status()))}={}) {
  let clock=now;const calls=[],sockets=[],timers=[];
  class Socket { constructor(){this.readyState=0;sockets.push(this);}send(){}close(){this.readyState=3;}receive(v){this.onmessage?.({data:JSON.stringify(v)});} }
  const user={id:canonical?actor:"123456789012345678",name:"Member"};
  const client=hub.createHubClient({url:address,WebSocket:Socket,now:()=>clock,
    getAccountSession:canonical && address.startsWith("https:") ? async()=>({ok:true,accountSession:"account_fixture"}) : undefined,
    getAccessToken:async()=>{assert.equal(canonical && address.startsWith("https:"),false,"No canonical fallback");return {ok:true,token:"discord_fixture"};},
    setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){},setInterval:()=>1,clearInterval(){},
    fetch:async(url,init)=>{calls.push({url,...init});if(new URL(url).pathname==="/v1/session")return new Response(JSON.stringify({ok:true,session:"session_fixture",expiresAt:now+900000,user,...(canonical?{actorProtocol:AP}:{})}));return reply(url,init);}
  });
  await client.connect();sockets[0].readyState=1;sockets[0].onopen?.();sockets[0].receive({type:"ready",user,protocol:1,features,...(canonical?{actorProtocol:AP}:{})});
  return {client,calls,sockets,timers,advance:n=>{clock+=n;}};
}
test("real Hub client requires canonical capability and sends trusted HTTPS Origin with actor-free body", async () => {
  const h=await fixture({reply:()=>new Response(JSON.stringify({code,expiresAt:now+1000,replayed:false}))});
  assert.equal(h.client.status().referralInvitations,true);
  assert.deepEqual(JSON.parse(h.calls[0].body),{accountSession:"account_fixture"});
  assert.equal((await h.client.referrals("issueReferralInvitation",{requestId})).ok,true);
  assert.equal(h.calls.at(-1).headers.Origin,"https://hub.example.test");
  assert.equal(h.calls.at(-1).headers.Authorization,"Bearer session_fixture");
  assert.deepEqual(JSON.parse(h.calls.at(-1).body),{requestId});assert.equal(h.calls.at(-1).redirect,"error");
  assert.equal(h.calls.at(-1).cache,"no-store");
  const absent=await fixture({features:[AP]});assert.equal((await absent.client.referrals("readReferralStatus",{})).error,"unsupported");assert.equal(absent.calls.length,1);
  const legacy=await fixture({canonical:false,features:["referrals.1"]});assert.equal(legacy.client.status().referralInvitations,false);
  assert.equal((await legacy.client.referrals("issueReferralInvitation",{requestId})).error,"unsupported");assert.equal(legacy.calls.length,1);
  const local=await fixture({address:"http://127.0.0.1:8787"});assert.equal((await local.client.referrals("issueReferralInvitation",{requestId})).error,"referral_origin_required");assert.equal(local.calls.length,1);
});
test("referral mutations never renew or replay after 401 and reject expired sessions before HTTP", async () => {
  const h=await fixture({reply:()=>new Response(JSON.stringify({error:{code:"unauthorized"}}),{status:401})});
  assert.equal((await h.client.referrals("redeemReferralInvitation",{code,requestId})).error,"unauthorized");assert.equal(h.calls.length,2);
  h.advance(900001);assert.equal((await h.client.referrals("readReferralStatus",{})).error,"unauthorized");assert.equal(h.calls.length,2);
});
test("in-flight session loss discards a response and immutable tuple survives caller mutation", async () => {
  const gate=deferred(),h=await fixture({reply:()=>gate.promise}),input={code,requestId};
  const pending=h.client.referrals("redeemReferralInvitation",input);input.requestId="changed_request";
  gate.resolve(new Response(JSON.stringify({error:{code:"self_referral"},outcome:"not-applied",requestId}),{status:409}));
  assert.equal((await pending).requestId,requestId);assert.deepEqual(JSON.parse(h.calls.at(-1).body),{code,requestId});
  const next=deferred(),stale=await fixture({reply:()=>next.promise});const waiting=stale.client.referrals("readReferralStatus",{});
  stale.sockets[0].onclose({code:1006});next.resolve(new Response(JSON.stringify(status())));assert.equal((await waiting).error,"stale_account");
});
test("referral stream is bounded before parsing and cannot leak unknown raw fields", async () => {
  let canceled=false;
  const reply={headers:new Headers(),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(8193)}),cancel:async()=>{canceled=true;},releaseLock(){}})}};
  await assert.rejects(contract.readJson(reply),/response-size/);assert.equal(canceled,true);
  const h=await fixture({reply:()=>new Response(JSON.stringify({...status(),providerId:"secret"}))});assert.equal((await h.client.referrals("readReferralStatus",{})).error,"bad_response");
});
const main=await readFile(new URL("../main.cjs",import.meta.url),"utf8");
const nativeSource=main.slice(main.indexOf("async function hubReferrals("),main.indexOf("// Commerce links are bound"));
const registration=main.split(/\r?\n/).find(line=>line.includes('ipcMain.handle("hub:referrals"'));
function nativeFixture() {
  const calls=[],handlers=new Map(),account={},state={state:"ready",actorProtocol:AP,referralInvitations:true,user:{id:actor}};
  const client={status:()=>clone(state),referrals:async(action,payload)=>{calls.push({action,payload:clone(payload)});return {ok:true,...status()};}};
  const c=vm.createContext({require:()=>contract,studioActor:actorContract,studioAccountActionGeneration:0,studioAccountClient:account,
    studioAccountReady:async()=>account,hubInstance:()=>c.hubClient,hubClient:client,ipcMain:{handle:(ch,fn)=>handlers.set(ch,fn)}});
  vm.runInContext(nativeSource+"\n"+registration,c);return {c,account,client,calls,state,invoke:payload=>handlers.get("hub:referrals")({},payload)};
}
test("actual native handler rejects queued actor A under actor B before any HTTP call", async () => {
  const h=nativeFixture(),gate=deferred();h.c.studioAccountReady=()=>gate.promise;
  const pending=h.invoke({action:"issueReferralInvitation",payload:{requestId},actorId:actor});h.state.user.id=other;gate.resolve(h.account);
  assert.equal((await pending).error,"stale_account");assert.equal(h.calls.length,0);
  assert.equal((await h.invoke({action:"issueReferralInvitation",payload:{requestId},actorId:"invalid"})).error,"bad_request");
});
test("actual native handler snapshots request before readiness and fences replacement after dispatch", async () => {
  const h=nativeFixture(),gate=deferred(),input={requestId};h.c.studioAccountReady=()=>gate.promise;
  const pending=h.invoke({action:"issueReferralInvitation",payload:input,actorId:actor});input.requestId="other_request";gate.resolve(h.account);
  assert.equal((await pending).ok,true);assert.deepEqual(h.calls[0].payload,{requestId});
  const response=deferred();h.client.referrals=()=>response.promise;
  const waiting=h.invoke({action:"readReferralStatus",payload:{},actorId:actor});await Promise.resolve();await Promise.resolve();
  h.c.studioAccountActionGeneration++;response.resolve({ok:true,...status()});assert.equal((await waiting).error,"stale_account");
});
test("real Rust page bridge and preload forward only the named bounded referral IPC to the actual native handler", async () => {
  const init=await readFile(new URL("../src-tauri/src/init.js",import.meta.url),"utf8"),preload=await readFile(new URL("../preload.cjs",import.meta.url),"utf8");
  const h=nativeFixture(),wireCalls=[];
  const c={console:{log(){},warn(){},error(){}},TextEncoder,TextDecoder,btoa,atob,Promise,Uint8Array,ArrayBuffer,JSON,Date,Number,String,Object,Array,Map,Error,
    location:{origin:"http://mefi.localhost"},document:{addEventListener(){}},addEventListener(){},reportError:e=>{throw e;}};
  c.window=c;c.globalThis=c;c.__TAURI__={core:{Channel:class{},invoke:async(command,args,options)=>{
    if(command!=="ipc_invoke")return null;const payload=args instanceof Uint8Array?JSON.parse(new TextDecoder().decode(args)):args;
    wireCalls.push({channel:options.headers["mefi-ch"],payload});
    assert.equal(options.headers["mefi-ch"],"hub:referrals");return {t:"result",ok:true,body:await h.invoke(payload[0])};
  }}};
  vm.runInNewContext(init.replace("/*__MEFI_PRELOAD__*/",preload),c);
  assert.equal((await c.mefiStudio.hubReferrals("readReferralStatus",{},actor)).ok,true);
  assert.deepEqual(clone(wireCalls[0].payload),[{action:"readReferralStatus",payload:{},actorId:actor}]);
  assert.equal((await c.mefiStudio.hubReferrals("grant",{},actor)).error,"bad_request");
  assert.equal((await c.mefiStudio.hubReferrals("readReferralStatus",{data:"x".repeat(513)},actor)).error,"bad_request");assert.equal(wireCalls.length,1);
  h.state.user.id=other;assert.equal((await c.mefiStudio.hubReferrals("issueReferralInvitation",{requestId},actor)).error,"stale_account");assert.equal(h.calls.length,1);
});
