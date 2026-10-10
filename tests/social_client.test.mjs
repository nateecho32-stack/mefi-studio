import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
const {createSocialClient,trade,imageRef}=createRequire(import.meta.url)("../scripts/social-client.cjs");
const A="200000000000000001", B="200000000000000002", id="trade_"+"a".repeat(32), image="image_"+"b".repeat(32);
const offer={id,sender:{id:A,name:"Alice"},recipient:{id:B,name:"Bob"},offered:{id:"studio:pet-cloud",kind:"pet",name:"Cloud"},requested:{id:"studio:skin-frost",kind:"skin",name:"Frost"},status:"pending",createdAt:10,expiresAt:20};
function setup(enabled=true){const calls=[];let response={ok:true,data:{trade:offer}};const client=createSocialClient({supported:()=>enabled,request:async(...args)=>{calls.push(args);return response;}});return {client,calls,respond:r=>response=r};}
test("old relays are not called; malformed requests never cross the bridge",async()=>{
  const old=setup(false);assert.equal((await old.client.trades()).error,"unsupported");assert.equal(old.calls.length,0);
  const h=setup();for(const input of [null,{recipient:B,offered:"studio:pet-cloud",requested:"studio:pet-cloud",receipt:"receipt_1234567890"},{recipient:"../owner",offered:"studio:pet-cloud",requested:"studio:skin-frost",receipt:"receipt_1234567890"}])assert.equal((await h.client.tradeOffer(input)).ok,false);
  assert.equal((await h.client.tradeDecide(id,"grant")).ok,false);assert.equal((await h.client.roomImage("../room",image)).ok,false);assert.equal(h.calls.length,0);
});
test("immutable terms and stable receipt cross without renderer-provided credits or authority",async()=>{
  const h=setup(),input={recipient:B,offered:offer.offered.id,requested:offer.requested.id,receipt:"receipt_1234567890",balance:99999,donor:true};
  assert.equal((await h.client.tradeOffer(input)).trade.id,id);await h.client.tradeOffer(input);
  assert.deepEqual(h.calls[0],h.calls[1]);assert.deepEqual(h.calls[0][2],{recipient:B,offered:input.offered,requested:input.requested,receipt:input.receipt});
  h.respond({ok:true,data:{trade:{...offer,recipient:{id:"bad"}}}});assert.equal((await h.client.tradeDecide(id,"accept")).error,"failed");
  assert.equal(trade({...offer,status:"admin-granted"}),null);assert.equal(imageRef({id:image,width:99999,height:8}),null);
});
test("authenticated image reads return bounded pixels, never an arbitrary image URL",async()=>{
  const h=setup();h.respond({ok:true,data:{url:"https://attacker.com/pixel",jpeg:"AA==",width:8,height:8}});
  assert.deepEqual(await h.client.roomImage("room",image),{ok:true,jpeg:"AA==",width:8,height:8});assert.equal(h.calls[0][1],`/v1/rooms/room/images/${image}`);
  h.respond({ok:true,data:{jpeg:"<svg/>",width:8,height:8}});assert.equal((await h.client.roomImage("room",image)).ok,false);
  h.respond({ok:true,data:{message:{id:A,v:2,image:{id:image,width:8,height:8}}}});
  assert.equal((await h.client.sendImage("room",{jpeg:"AA==",caption:"Hi",receipt:"image_receipt_12345"})).messageId,A);
});

test("moderator image evidence uses a separate authenticated route and stays bounded",async()=>{
  const h=setup();h.respond({ok:true,data:{jpeg:"AA==",width:8,height:8,url:"https://attacker.com"}});
  assert.deepEqual(await h.client.modReportImage("rep_proof"),{ok:true,jpeg:"AA==",width:8,height:8});
  assert.equal(h.calls[0][1],"/v1/admin/reports/rep_proof/image");
  h.respond({ok:true,data:{jpeg:"A".repeat(131073),width:8,height:8}});assert.equal((await h.client.modReportImage("rep_proof")).ok,false);
  assert.equal((await h.client.modRemoveMessage("../report")).error,"bad-request");
  h.respond({ok:true,data:{ok:true}});assert.equal((await h.client.modRemoveMessage("rep_proof")).ok,true);
  assert.deepEqual(h.calls.at(-1),["POST","/v1/admin/reports/rep_proof/remove-message",{}]);
  assert.equal((await setup(false).client.modReportImage("rep_proof")).error,"unsupported");
});
