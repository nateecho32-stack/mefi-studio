import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {createDom} from "./fixtures/renderer-dom.mjs";
const source=await readFile(new URL("../renderer/referrals.js",import.meta.url),"utf8");
const accountSource=await readFile(new URL("../renderer/account.js",import.meta.url),"utf8");
const frontSource=await readFile(new URL("../renderer/friends-front.js",import.meta.url),"utf8");
const buildSource=await readFile(new URL("../scripts/build-booklet.mjs",import.meta.url),"utf8");
const actor="studio:12345678-1234-4abc-8abc-123456789abc",other="studio:23456789-1234-4abc-8abc-123456789abc",AP="accounts.canonical.1";
const now=1_800_000_000_000,code="ref_"+"a".repeat(64),otherCode="ref_"+"b".repeat(64),key=who=>"mefi.referrals.pending.v1:"+who;
const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const status=()=>({threshold:5,qualifyingInvitees:0,qualified:false,attributionRecorded:false,invitation:null,canIssue:true,issueReason:null,canRedeem:true,redeemReason:null});
function env({reply,storage=new Map(),storeFails=false,waitlisted=false,enabled=true,full=false}={}) {
  const dom=createDom(),calls=[],copied=[],events=[],accountEvents=[];let serial=0,clock=now,nav=0;
  let state={state:"ready",actorProtocol:AP,referralInvitations:enabled,user:{id:actor}};
  let account={selected:true,configured:true,linked:true,signingIn:false,state:waitlisted?"waitlisted":"admitted",socialAccess:!waitlisted,waitlistPosition:waitlisted?1001:null,user:{id:actor,name:"Member"}};
  let view=status(),custom=reply;
  const window={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(storeFails)throw Error("storage");storage.set(k,v);}},
    MefiCommunity:{open:()=>{nav++;return true;}},
    mefiStudio:{
      studioAccount:async()=>({ok:true,status:clone(account)}),onStudioAccount:fn=>accountEvents.push(fn),
      hubStatus:async()=>({ok:true,status:clone(state)}),onHubEvent:fn=>{events.push(fn);return()=>{const i=events.indexOf(fn);if(i>=0)events.splice(i,1);};},
      hubReferrals:async(action,payload,actorId)=>{
        calls.push({action,payload:clone(payload),actorId});
        const result=await custom?.(action,payload,actorId);if(result!==undefined)return result;
        if(action==="readReferralStatus")return{ok:true,...clone(view)};
        if(action==="issueReferralInvitation"){view.invitation={code,expiresAt:now+100000};return{ok:true,...view.invitation,replayed:false};}
        view.attributionRecorded=true;view.canRedeem=false;view.redeemReason="referral_already_recorded";return{ok:true,recorded:true,replayed:false};
      }
    }
  };
  class Clock extends Date{static now(){return clock;}}
  const context=vm.createContext({window,document:dom.document,Date:Clock,navigator:{clipboard:{writeText:async v=>copied.push(v)}},crypto:{randomUUID:()=>"referral_request_"+(++serial)},console});
  vm.runInContext(source,context);if(full)vm.runInContext(accountSource,context);
  let host=full?window.MefiAccount.card():window.MefiReferrals.card({accountStatus:()=>account});
  dom.document.body.append(host);
  const root=()=>full?host.querySelector("details"):host;
  const button=text=>root().querySelectorAll("button").find(b=>b.textContent===text);
  return {...dom,window,calls,copied,storage,context,get root(){return root();},get host(){return host;},button,get nav(){return nav;},
    setView:v=>{view=clone(v);},setReply:fn=>{custom=fn;},advance:ms=>{clock+=ms;},
    open:async()=>{root().open=true;await root().trigger("toggle");await flush();},
    input:async value=>{const input=root().querySelectorAll("input").find(n=>n.getAttribute("aria-label")==="A friend's referral code");assert.ok(input);input.value=value;await input.trigger("input");},
    hear:patch=>{state={...state,...patch};events.slice().forEach(fn=>fn({type:"status",status:clone(state)}));},
    switchAccount:who=>{account={...account,user:{id:who,name:"Other member"}};state={...state,user:{id:who}};accountEvents.forEach(fn=>fn(clone(account)));if(!full)root().accountChanged(account);events.slice().forEach(fn=>fn({type:"status",status:clone(state)}));},
    remount:async()=>{host.dispose();host.remove();host=full?window.MefiAccount.card():window.MefiReferrals.card({accountStatus:()=>account});dom.document.body.append(host);await flush();},
  };
}
test("one Account home and Friends shortcuts use existing navigation with no hidden referral reads",async()=>{
  const e=env({full:true});await flush();assert.equal(e.host.querySelectorAll("details").length,1);assert.equal(e.calls.length,0);
  const compact=e.window.MefiAccount.card({compact:true});assert.equal(compact.querySelectorAll("details").length,0);
  await compact.querySelectorAll("button").find(b=>b.textContent==="Referral rewards").click();await flush();
  assert.equal(e.nav,1);assert.equal(e.root.open,true);assert.equal(e.calls.filter(c=>c.action==="readReferralStatus").length,1);
  assert.match(frontSource,/button\("Referral rewards", \(\) => window\.MefiReferrals\.open\(\)/);
  assert.match(frontSource,/Copy invite/);assert.match(frontSource,/Join with a code/);
  assert.ok(buildSource.indexOf('"referrals.js"')<buildSource.indexOf('"account.js"'));
});
test("waitlisted and capability-off states cannot read or mutate referrals",async()=>{
  for(const options of [{waitlisted:true},{enabled:false}]){
    const e=env(options);await e.open();assert.equal(e.calls.length,0);assert.equal(e.button("Create referral invitation"),undefined);
    assert.match(e.root.textContent,options.waitlisted?/waitlist position is 1001/:/referrals enabled/);
  }
});
test("admitted progress uses authoritative award and copying an existing code issues no request",async()=>{
  const e=env();e.setView({...status(),qualified:true,qualifyingInvitees:2,invitation:{code,expiresAt:now+100000}});await e.open();
  assert.match(e.root.textContent,/2 of 5/);assert.match(e.root.textContent,/discount is active/);
  await e.button("Copy referral code").click();await flush();assert.deepEqual(e.copied,[code]);assert.deepEqual(e.calls.map(c=>c.action),["readReferralStatus"]);
});
test("new issue persists identity before send and clears only after receipt",async()=>{
  const e=env({reply:(action,input,who)=>{if(action!=="issueReferralInvitation")return;assert.equal(who,actor);assert.deepEqual(JSON.parse(e.storage.get(key(actor))).issue,clone(input));}});
  await e.open();await e.button("Create referral invitation").click();await flush();
  assert.equal(e.calls.filter(c=>c.action==="issueReferralInvitation").length,1);assert.equal(JSON.parse(e.storage.get(key(actor))).issue,null);
  assert.ok(e.button("Copy referral code"));assert.deepEqual(e.copied,[]);
});
test("saved issue remains recoverable when new issues are paused and response was lost",async()=>{
  let count=0;const e=env({reply:action=>action==="issueReferralInvitation"&&++count===1?{ok:false,error:"network"}:undefined});
  await e.open();await e.button("Create referral invitation").click();await flush();
  const original=clone(e.calls.find(c=>c.action==="issueReferralInvitation").payload);
  e.setView({...status(),canIssue:false,issueReason:"read_only",canRedeem:false,redeemReason:"read_only"});
  await e.remount();await e.open();assert.equal(e.button("Recover saved invitation").disabled,false);
  await e.button("Recover saved invitation").click();await flush();
  assert.deepEqual(e.calls.filter(c=>c.action==="issueReferralInvitation").map(c=>c.payload),[original,original]);
});
test("lost committed redemption survives status recorded and recovers exact tuple despite disabled new writes",async()=>{
  let calls=0;const e=env({reply:(action)=>{if(action!=="redeemReferralInvitation")return;calls++;
    e.setView({...status(),attributionRecorded:true,canRedeem:false,redeemReason:"referral_already_recorded",canIssue:false,issueReason:"read_only"});
    return calls===1?{ok:false,error:"network"}:{ok:true,recorded:true,replayed:true};}});
  await e.open();await e.input(code);await e.button("Confirm referral code").click();await flush();
  const original=clone(e.calls.find(c=>c.action==="redeemReferralInvitation").payload);
  await e.remount();await e.open();assert.equal(e.button("Recover saved redemption").disabled,false);
  assert.deepEqual(JSON.parse(e.storage.get(key(actor))).redeem,original);
  await e.button("Recover saved redemption").click();await flush();
  assert.deepEqual(e.calls.filter(c=>c.action==="redeemReferralInvitation").map(c=>c.payload),[original,original]);
  assert.equal(JSON.parse(e.storage.get(key(actor))).redeem,null);assert.match(e.root.textContent,/already recorded/);
});
test("only matched durable refusal offers explicit corrected-code review before a new ID",async()=>{
  const e=env({reply:(action,input)=>action==="redeemReferralInvitation"?{ok:false,error:"self_referral",outcome:"not-applied",requestId:input.requestId}:undefined});
  await e.open();await e.input(code);await e.button("Confirm referral code").click();await flush();
  const first=e.calls.find(c=>c.action==="redeemReferralInvitation").payload;
  assert.deepEqual(JSON.parse(e.storage.get(key(actor))).redeem,first);assert.ok(e.button("Review another code"));assert.equal(e.button("Confirm referral code"),undefined);
  await e.button("Review another code").click();await flush();assert.equal(JSON.parse(e.storage.get(key(actor))).redeem,null);
  assert.equal(e.calls.filter(c=>c.action==="redeemReferralInvitation").length,1);
  await e.input(otherCode);await e.button("Confirm referral code").click();await flush();
  const second=e.calls.filter(c=>c.action==="redeemReferralInvitation")[1].payload;
  assert.equal(second.code,otherCode);assert.notEqual(second.requestId,first.requestId);
});
test("ordinary error or mismatched negative proof cannot retire unknown request",async()=>{
  for(const result of [{ok:false,error:"self_referral"},{ok:false,error:"self_referral",outcome:"not-applied",requestId:"different_request"},{ok:false,error:"unauthorized"}]){
    const e=env({reply:action=>action==="redeemReferralInvitation"?result:undefined});await e.open();await e.input(code);await e.button("Confirm referral code").click();await flush();
    assert.ok(JSON.parse(e.storage.get(key(actor))).redeem);assert.equal(e.button("Review another code"),undefined);
    assert.equal(e.calls.filter(c=>c.action==="redeemReferralInvitation").length,1);
  }
});
test("rate cooldown blocks early recovery and becomes usable by explicit click after time without remount",async()=>{
  let count=0;const e=env({reply:action=>action==="issueReferralInvitation"&&++count===1?{ok:false,error:"referral_rate_limited",retryAfter:30000}:undefined});
  await e.open();await e.button("Create referral invitation").click();await flush();const button=e.button("Recover saved invitation");assert.equal(button.disabled,false);
  await button.click();await flush();assert.equal(e.calls.filter(c=>c.action==="issueReferralInvitation").length,1);
  e.advance(30001);await e.button("Recover saved invitation").click();await flush();assert.equal(e.calls.filter(c=>c.action==="issueReferralInvitation").length,2);
});
test("storage failure blocks send and malformed saved state is preserved for support",async()=>{
  const failed=env({storeFails:true});await failed.open();await failed.button("Create referral invitation").click();await flush();
  assert.equal(failed.calls.filter(c=>c.action!=="readReferralStatus").length,0);assert.match(failed.root.textContent,/safely save/);
  const storage=new Map([[key(actor),'{"issue":{"requestId":"bad"},"redeem":null}']]),e=env({storage});await e.open();
  assert.equal(e.button("Create referral invitation").disabled,true);assert.equal(storage.get(key(actor)),'{"issue":{"requestId":"bad"},"redeem":null}');
});
test("account switch discards old response and preserves original tuple for its account only",async()=>{
  const gate=deferred(),e=env({reply:action=>action==="redeemReferralInvitation"?gate.promise:undefined,full:true});await flush();await e.open();
  await e.input(code);await e.button("Confirm referral code").click();await flush();const original=JSON.parse(e.storage.get(key(actor))).redeem;
  e.switchAccount(other);await flush();gate.resolve({ok:true,recorded:true,replayed:false});await flush();
  assert.deepEqual(JSON.parse(e.storage.get(key(actor))).redeem,original);assert.equal(e.storage.get(key(other)),undefined);
  assert.equal(e.calls.filter(c=>c.action==="redeemReferralInvitation").length,1);assert.doesNotMatch(e.root.textContent,/Invitation recorded\./);
  e.switchAccount(actor);await flush();assert.ok(e.button("Recover saved redemption"));
});
test("exact code input trims ASCII edges only and room codes or links never dispatch",async()=>{
  const e=env();await e.open();
  for(const value of ["room-code","https://example.test/"+code,code.toUpperCase(),"\u00a0"+code]){
    await e.input(value);await e.button("Confirm referral code").click();await flush();
  }
  assert.equal(e.calls.filter(c=>c.action==="redeemReferralInvitation").length,0);
  await e.input(" \t"+code+"\r\n");await e.button("Confirm referral code").click();await flush();
  assert.equal(e.calls.find(c=>c.action==="redeemReferralInvitation").payload.code,code);
});
test("expired positive issue replay clears accepted tuple without automatic replacement",async()=>{
  const storage=new Map([[key(actor),JSON.stringify({issue:{requestId:"saved_issue_001"},redeem:null})]]);
  const e=env({storage,reply:action=>action==="issueReferralInvitation"?{ok:true,code,expiresAt:1,replayed:true}:undefined});await e.open();
  await e.button("Recover saved invitation").click();await flush();
  assert.equal(JSON.parse(storage.get(key(actor))).issue,null);assert.match(e.root.textContent,/has expired/);
  assert.equal(e.calls.filter(c=>c.action==="issueReferralInvitation").length,1);
});
