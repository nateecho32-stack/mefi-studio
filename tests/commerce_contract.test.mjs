import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import contract from '../scripts/commerce-contract.cjs';
import listings from '../scripts/commerce-listings-contract.cjs';
import hub from '../scripts/hub-client.cjs';

const now=1_800_000_000_000, actor='123456789012345678', other='234567890123456789';
const orderId='cash_'+'a'.repeat(32), listingId='cashlist_'+'b'.repeat(32), version='c'.repeat(64), requestId='purchase_request_123';
const url='https://checkout.stripe.com/c/pay/cs_test_example';
const order=()=>({dtoVersion:2,orderId,state:'quoted',listing:{id:listingId,version,name:'Moon friend',kind:'collectible-instance'},
  quote:{mode:'hosted-exclusive-v1',currency:'usd',minorUnit:2,amountIncrementMinor:1,saleMinor:1000,quantity:1,taxBehavior:'exclusive',taxStatus:'pending',taxMinor:null,buyerFeeMinor:0,totalMinor:null},
  commission:{basisPoints:700,amountMinor:70,basis:'subscriber',rounding:'nearest-minor-half-up',schedule:'commission-7-10-15-v2'},settlement:null,
  expiresAt:now+600000,receipt:null,needsReview:false,error:null});
const item=()=>({kind:'pet',name:'Moon friend',blurb:'A curious moon dragon',visual:{body:'dragon',primary:'#abcdef',secondary:'#123456',motif:'stars'},bound:false,
  id:'item_'+'a'.repeat(16),definitionId:'moon-dragon',rarity:'rare',quality:89,traits:[{id:'curious',name:'Curious',acquiredAt:now-1000}],bornAt:now-86400000,careDays:2,stage:'baby',
  growth:{stage:'baby',ageDays:1,careDays:2,nextStageDays:3,sizes:['tiny','small']},sizes:['tiny','small'],unlockedSizes:['tiny','small'],size:'small',ownerId:other,tradeHoldUntil:0,listingId:null,caredToday:false});
const listing=()=>({id:listingId,version,seller:{id:other,name:'Maker'},name:'Moon friend',kind:'collectible-instance',currency:'usd',minorUnit:2,amountIncrementMinor:1,saleMinor:1000,asset:{type:'collectible-instance',item:item()}});
const seller=()=>({enabled:true,canList:true,canSell:true,fee:{state:'known',basisPoints:500},onboarding:{state:'ready',canStart:false},pricing:{currencies:[{code:'usd',minorUnit:2,amountIncrementMinor:1,minSaleMinor:50,maxSaleMinor:1000000}]},reason:null});

test('cash requests expose only pinned routes and exact actor-free identities',()=>{
  assert.deepEqual(contract.request('createOrder',{listingId,listingVersion:version,requestId}),{method:'POST',path:'/v1/commerce/orders',body:{listingId,listingVersion:version,requestId}});
  assert.deepEqual(contract.request('getOrder',{orderId}),{method:'GET',path:'/v1/commerce/orders/'+orderId});
  assert.deepEqual(contract.request('listOrders',{scope:'pending',limit:1,cursor:'a'.repeat(48)}),{method:'GET',path:'/v1/commerce/orders?scope=pending&limit=1&cursor='+'a'.repeat(48)});
  for(const payload of [{listingId,listingVersion:version,requestId,accountId:actor},{listingId,listingVersion:version,requestId,saleMinor:1},{listingId,listingVersion:version,requestId,rarity:'legendary'}])assert.equal(contract.request('createOrder',payload),null);
  assert.equal(contract.request('webhook',{}),null);assert.equal(contract.request('listOrders',{scope:'history',limit:26,cursor:null}),null);
});
test('version two keeps pending hosted tax null and separately accepts verified settlement',()=>{
  const raw=order();assert.deepEqual(contract.response('getOrder',raw,{orderId}),{ok:true,...raw});
  for(const mutate of [v=>delete v.dtoVersion,v=>v.dtoVersion=1,v=>v.quote.taxMinor=0,v=>v.quote.totalMinor=1000,v=>v.quote.quantity=2,v=>v.commission.amountMinor=71,v=>v.providerId='secret']){const bad=order();mutate(bad);assert.equal(contract.order(bad),null);}
  raw.settlement={status:'verified',currency:'usd',minorUnit:2,amountIncrementMinor:1,saleMinor:1000,taxMinor:65,buyerFeeMinor:0,totalMinor:1065,verifiedAt:now};raw.state='review';raw.needsReview=true;raw.error='cash_review_required';assert.ok(contract.order(raw));assert.equal(raw.quote.totalMinor,null);
  raw.settlement.totalMinor=1000;assert.equal(contract.order(raw),null);
});
test('historical fixed quotes remain exact and receipts cannot claim hosted delivery without settlement',()=>{
  const raw=order();raw.state='fulfilled';raw.receipt={orderId,kind:raw.listing.kind,reference:item().id,version,deliveredAt:now};assert.equal(contract.order(raw),null);
  raw.quote={mode:'fixed-gross-v1',currency:'usd',minorUnit:2,amountIncrementMinor:1,saleMinor:1000,quantity:1,taxBehavior:'exclusive',taxStatus:'fixed',taxMinor:65,buyerFeeMinor:10,totalMinor:1075};assert.ok(contract.order(raw));
  raw.receipt.reference='ch_secret';assert.equal(contract.order(raw),null);raw.receipt.reference=item().id;raw.quote.taxMinor=null;assert.equal(contract.order(raw),null);
});
test('cash order replies are bound to original request and bounded history pages',()=>{
  const raw=order();assert.equal(contract.response('getOrder',raw,{orderId:'cash_'+'d'.repeat(32)}),null);
  assert.ok(contract.response('createOrder',{...raw,replayed:true},{listingId,listingVersion:version,requestId}));
  assert.equal(contract.response('createOrder',{...raw,replayed:true},{listingId,listingVersion:'e'.repeat(64),requestId}),null);
  const input={scope:'pending',limit:1,cursor:'1'.repeat(48)};
  assert.ok(contract.response('listOrders',{orders:[raw],nextCursor:'2'.repeat(48)},input));
  assert.equal(contract.response('listOrders',{orders:[raw],nextCursor:input.cursor},input),null);
  assert.equal(contract.response('listOrders',{orders:[raw,raw],nextCursor:null},input),null);
  raw.state='closed';assert.equal(contract.response('listOrders',{orders:[raw],nextCursor:null},input),null);
});
test('cash checkout URLs reject alternate hosts, credentials, whitespace and normalization overflow',()=>{
  assert.equal(contract.stripeUrl(url),url);
  for(const bad of ['http://checkout.stripe.com/x','https://checkout.stripe.com.evil.test/x','https://x@checkout.stripe.com/x','https://checkout.stripe.com:444/x',url+'#secret','https://checkout.stripe.com/\nfoo',url+'é'.repeat(1500)])assert.equal(contract.stripeUrl(bad),null);
  const raw={...order(),url,state:'awaiting_payment'};assert.ok(contract.order(raw,'checkout'));raw.state='review';assert.equal(contract.order(raw,'checkout'),null);
});
test('strict cash collectible previews preserve exact identity and reject new code or visual authority',()=>{
  assert.deepEqual(listings.collectible(item()),item());assert.deepEqual(listings.listing(listing()),listing());
  const mutations=[v=>v.visual.url='https://example.test/x',v=>v.visual.motif='script',v=>v.growth.stage='adult',v=>v.unlockedSizes=['large'],v=>v.traits[0].name='Legendary',v=>v.ownerId='forged',v=>v.quality=101,v=>v.bound=true];
  for(const mutate of mutations){const raw=listing();mutate(raw.asset.item);assert.equal(listings.listing(raw),null);}
  const raw=listing();raw.asset.item.ownerId=actor;assert.equal(listings.listing(raw),null);
});
test('cash catalog pagination permits filtered nonfinal short or empty pages but rejects repeated tokens',()=>{
  const input={cursor:'old-token'};assert.ok(listings.response('catalog',{items:[],nextCursor:'next-token'},input));
  assert.ok(listings.response('catalog',{items:[listing()],nextCursor:'next-token'},input));
  assert.equal(listings.response('catalog',{items:[listing()],nextCursor:'old-token'},input),null);
  assert.equal(listings.response('catalog',{items:[listing(),listing()],nextCursor:null},input),null);
});
test('seller pricing requires configured currencies and never invents unknown fee eligibility',()=>{
  assert.deepEqual(listings.seller(seller()),seller());const raw=seller();raw.fee={state:'pending',basisPoints:null};raw.canList=false;raw.pricing.currencies=[];assert.ok(listings.seller(raw));
  raw.fee.basisPoints=1500;assert.equal(listings.seller(raw),null);raw.fee.basisPoints=null;raw.canList=true;assert.equal(listings.seller(raw),null);
  const bad=seller();bad.pricing.currencies[0].minorUnit=4;assert.equal(listings.seller(bad),null);
});
test('member publishing cannot set catalog licenses, entitlement, owner, rarity or mutable credit odds',()=>{
  const input={assetType:'collectible-instance',assetId:item().id,currency:'usd',saleMinor:1000,requestId};assert.ok(listings.request('publishListing',input));
  for(const extra of ['ownerId','rarity','creditPrice','rarityWeights','connectedAccountId'])assert.equal(listings.request('publishListing',{...input,[extra]:'bad'}),null);
  assert.equal(listings.request('publishListing',{...input,assetType:'catalog-license',assetId:'studio:dragon'}),null);
  assert.deepEqual(listings.request('unlistListing',{listingId,listingVersion:version,requestId}),{method:'DELETE',path:'/v1/commerce/listings/'+listingId,body:{listingVersion:version,requestId}});
});

async function fixture({features=['commerce.orders.2'],reply,address='https://hub.example.test'}={}){
  const calls=[],sockets=[];class Socket{constructor(){this.readyState=0;sockets.push(this);}send(){}close(){this.readyState=3;}receive(v){this.onmessage?.({data:JSON.stringify(v)});}}
  const user={id:actor,name:'Buyer'};
  const client=hub.createHubClient({url:address,WebSocket:Socket,now:()=>now,getAccessToken:async()=>({ok:true,token:'discord_fixture'}),setTimeout:()=>1,clearTimeout(){},setInterval:()=>2,clearInterval(){},fetch:async(url,init)=>{
    const parsed=new URL(url);calls.push({url, ...init});if(parsed.pathname==='/v1/session')return new Response(JSON.stringify({ok:true,session:'fixture',expiresAt:now+900000,user}));
    return await reply?.(parsed,init)??new Response(JSON.stringify(order()));
  }});await client.connect();sockets[0].readyState=1;sockets[0].onopen?.();sockets[0].receive({type:'ready',user,protocol:1,features});return{client,calls,sockets};
}
test('cash capabilities are independent and every mutation has native HTTPS Origin',async()=>{
  const h=await fixture({features:['commerce.catalog.1'],reply:()=>new Response(JSON.stringify({items:[listing()],nextCursor:null}))});assert.equal(h.client.status().commerceCatalog,true);assert.equal(h.client.status().commerceOrders,false);
  assert.equal((await h.client.commerce('createOrder',{listingId,listingVersion:version,requestId})).error,'unsupported');assert.equal(h.calls.length,1);assert.equal((await h.client.commerce('catalog',{cursor:null})).items.length,1);
  const on=await fixture({reply:()=>new Response(JSON.stringify({...order(),replayed:false}))});assert.equal((await on.client.commerce('createOrder',{listingId,listingVersion:version,requestId})).ok,true);const sent=on.calls.at(-1);assert.equal(sent.headers.Origin,'https://hub.example.test');assert.equal(sent.redirect,'error');assert.equal(sent.cache,'no-store');assert.deepEqual(JSON.parse(sent.body),{listingId,listingVersion:version,requestId});
  const local=await fixture({address:'http://127.0.0.1:8787'});assert.equal((await local.client.commerce('getOrder',{orderId})).error,'cash_origin_required');assert.equal(local.calls.length,1);
});
test('cash GET validation snapshots requested cursor and limit before awaited HTTP',async()=>{
  let finish;const h=await fixture({reply:()=>new Promise(r=>{finish=r;})});const p={scope:'pending',limit:1,cursor:'a'.repeat(48)};
  const pending=h.client.commerce('listOrders',p);p.limit=25;p.cursor=null;finish(new Response(JSON.stringify({orders:[order()],nextCursor:'a'.repeat(48)})));assert.equal((await pending).error,'bad_response');
});
test('cash 401 never renews or automatically replays a mutation and stale sessions discard results',async()=>{
  const denied=await fixture({reply:()=>new Response(JSON.stringify({error:{code:'unauthorized'}}),{status:401})});assert.equal((await denied.client.commerce('checkout',{orderId})).error,'unauthorized');assert.equal(denied.calls.length,2);
  let finish;const h=await fixture({reply:()=>new Promise(r=>{finish=r;})});const pending=h.client.commerce('getOrder',{orderId});h.sockets[0].onclose({code:1006});finish(new Response(JSON.stringify(order())));assert.equal((await pending).error,'stale_account');
});
test('cash streamed replies are bounded before parsing and errors never expose provider prose',async()=>{
  let cancelled=false;const raw={headers:new Headers(),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(contract.RESPONSE_BYTES+1)}),cancel:async()=>{cancelled=true;},releaseLock(){}})}};assert.equal(await contract.readJson(raw),null);assert.equal(cancelled,true);
  assert.deepEqual(contract.error({error:{code:'cash_rate_limited'}},'30'),{ok:false,error:'cash_rate_limited',retryAfter:30000});assert.equal(contract.error({error:{code:'cash_unavailable',message:'private'}}).error,'cash_unavailable');
});
const main=await readFile(new URL('../main.cjs',import.meta.url),'utf8');const hostSource=main.slice(main.indexOf('const commerceBrowserLinks = new Map();'),main.indexOf('async function hubShopAll()'));
test('native cash checkout requires a matching account/order and one unused issued ticket',async()=>{
  const opened=[];let who=actor;const client={status:()=>({state:'ready',commerceOrders:true,user:{id:who}}),commerce:async()=>({...order(),ok:true,state:'awaiting_payment',url})};
  const context=vm.createContext({require:()=>contract,process:{env:{}},Date,Map,hubInstance:()=>client,shell:{openExternal:async value=>opened.push(value)}});vm.runInContext(hostSource,context);
  assert.equal((await context.hubCommerceOpen(orderId,url,actor)).ok,false);
  await context.hubCommerce('checkout',{orderId});assert.equal((await context.hubCommerceOpen('cash_'+'d'.repeat(32),url,actor)).ok,false);assert.equal((await context.hubCommerceOpen(orderId,url,other)).ok,false);
  assert.equal((await context.hubCommerceOpen(orderId,url,actor)).ok,true);assert.equal((await context.hubCommerceOpen(orderId,url,actor)).ok,false);assert.deepEqual(opened,[url]);
  await context.hubCommerce('checkout',{orderId});who=other;assert.equal((await context.hubCommerceOpen(orderId,url,actor)).ok,false);
});
test('onboarding has its own capability, exact body, Connect hostname and safe reply',()=>{
  assert.equal(contract.capability('onboarding'),'commerce.onboarding.1');assert.deepEqual(contract.request('onboarding',{requestId}),{method:'POST',path:'/v1/commerce/onboarding',body:{requestId}});
  assert.equal(contract.request('onboarding',{requestId,country:'US'}),null);assert.equal(contract.request('onboarding',{requestId,accountId:actor}),null);
  const raw={url:'https://connect.stripe.com/setup/example',expiresAt:now+600000,replayed:false};assert.ok(contract.response('onboarding',raw,{requestId}));
  assert.equal(contract.response('onboarding',{...raw,url},{requestId}),null);assert.equal(contract.response('onboarding',{...raw,connectedAccountId:'acct_secret'},{requestId}),null);assert.equal(contract.onboardingUrl('https://connect.stripe.com.evil.test/setup'),null);
});
test('cash currency precision and increments are exact server facts in both quote and settlement',()=>{
  const raw=order();raw.quote.currency='jpy';raw.quote.minorUnit=0;raw.quote.amountIncrementMinor=10;assert.ok(contract.order(raw));raw.quote.buyerFeeMinor=1;assert.equal(contract.order(raw),null);
  raw.quote.buyerFeeMinor=0;raw.settlement={status:'verified',currency:'jpy',minorUnit:0,amountIncrementMinor:10,saleMinor:1000,taxMinor:11,buyerFeeMinor:0,totalMinor:1011,verifiedAt:now};assert.equal(contract.order(raw),null);
  raw.settlement.taxMinor=10;raw.settlement.totalMinor=1010;assert.ok(contract.order(raw));raw.settlement.minorUnit=2;assert.equal(contract.order(raw),null);
  delete raw.quote.minorUnit;assert.equal(contract.order(raw),null);
});
test('seller responses cannot substitute another account ownership projection',()=>{
  const own={...listing(),status:'listed',reason:null};assert.equal(contract.response('sellerListings',{items:[own],nextCursor:null},{cursor:null},actor),null);
  const assetView={asset:listing().asset,eligibility:{canList:true,reason:null},listingId:null};assert.equal(contract.response('sellerAssets',{items:[assetView],nextCursor:null},{kind:'collectible-instance',cursor:null},actor),null);
  assert.ok(contract.response('sellerListings',{items:[own],nextCursor:null},{cursor:null},other));
});
test('native Connect setup has a distinct single-use account-bound ticket and expiry',async()=>{
  const opened=[];let expires=now+1000;const connect='https://connect.stripe.com/setup/example';class Clock extends Date{static now(){return now;}}
  const client={status:()=>({state:'ready',commerceOrders:true,commerceOnboarding:true,user:{id:actor}}),commerce:async()=>({ok:true,url:connect,expiresAt:expires,replayed:false})};
  const c=vm.createContext({require:()=>contract,process:{env:{}},Date:Clock,Map,hubInstance:()=>client,shell:{openExternal:async u=>opened.push(u)}});vm.runInContext(hostSource,c);
  assert.equal((await c.hubCommerceOpen('onboarding',connect,actor)).ok,false);await c.hubCommerce('onboarding',{requestId});assert.equal((await c.hubCommerceOpen(orderId,connect,actor)).ok,false);assert.equal((await c.hubCommerceOpen('onboarding',connect,actor)).ok,true);assert.equal((await c.hubCommerceOpen('onboarding',connect,actor)).ok,false);
  expires=now;assert.equal((await c.hubCommerce('onboarding',{requestId})).error,'onboarding_link_expired');assert.deepEqual(opened,[connect]);
});
test('retirement is independently negotiated and only exact not-applied proof releases a request',()=>{
  const input={listingId,listingVersion:version,requestId};
  assert.equal(contract.capability('retireOrderRequest'),'commerce.orders.retire.1');
  assert.deepEqual(contract.request('retireOrderRequest',input),{method:'POST',path:'/v1/commerce/orders/retire',body:input});
  assert.equal(contract.response('retireOrderRequest',{outcome:'not-applied',requestId},input).ok,true);
  assert.equal(contract.response('retireOrderRequest',{outcome:'not-applied',requestId:'different_request'},input),null);
  assert.equal(contract.response('retireOrderRequest',{outcome:'not-applied',requestId,url:'https://checkout.stripe.com'},input),null);
  assert.equal(contract.response('retireOrderRequest',{outcome:'applied',order:order()},input).order.orderId,orderId);
  assert.equal(contract.response('retireOrderRequest',{outcome:'applied',order:{...order(),replayed:true}},input),null);
});
test("seller country setup is independent, actor-free and validates original declaration receipts", async () => {
  const input = { country: "US", requestId };
  assert.equal(contract.capability("readSellerSetup"), "commerce.seller-setup.1");
  assert.equal(contract.statusKey("prepareSellerSetup"), "commerceSellerSetup");
  assert.deepEqual(contract.request("readSellerSetup", {}), { method: "GET", path: "/v1/commerce/seller/setup" });
  assert.deepEqual(contract.request("prepareSellerSetup", input), { method: "POST", path: "/v1/commerce/seller/setup", body: input });
  for (const extra of ["actor", "connectedAccountId", "email", "bank", "verified"]) assert.equal(contract.request("prepareSellerSetup", { ...input, [extra]: "bad" }), null);
  assert.equal(contract.request("prepareSellerSetup", { ...input, country: "us" }), null);
  assert.equal(contract.response("prepareSellerSetup", { country: "US", replayed: true }, input).ok, true);
  assert.equal(contract.response("prepareSellerSetup", { country: "CA", replayed: true }, input), null);
  const absent = await fixture(); assert.equal((await absent.client.commerce("readSellerSetup", {})).error, "unsupported");
  const live = await fixture({ features: ["commerce.seller-setup.1"], reply: () => new Response(JSON.stringify({ country: "US", replayed: false })) });
  assert.equal((await live.client.commerce("prepareSellerSetup", input)).ok, true);
  assert.equal(live.calls.at(-1).headers.Origin, "https://hub.example.test");
  assert.equal(live.client.status().commerceOrders, false);
});

test("seller setup preserves removed historical countries but rejects contradictory availability", () => {
  const raw = { countries: ["CA"], declaredCountry: "US", locked: true, canPrepare: false, reason: "cash_seller_country_locked" };
  assert.equal(contract.response("readSellerSetup", raw, {}).declaredCountry, "US");
  for (const patch of [{ canPrepare: true }, { countries: ["CA", "CA"] }, { countries: ["ca"] }, { declaredCountry: "USA" }, { reason: "provider_secret" }, { locked: "yes" }]) assert.equal(contract.response("readSellerSetup", { ...raw, ...patch }, {}), null);
  assert.equal(contract.response("readSellerSetup", { ...raw, locked: false, canPrepare: true, countries: [] }, {}), null);
  assert.ok(contract.response("readSellerSetup", { countries: [], declaredCountry: null, locked: false, canPrepare: false, reason: "cash_seller_setup_unavailable" }, {}));
});
test("new 5/10/15 orders require zero buyer surcharge and preserve historical fee schedules", () => {
  const raw = order(); raw.commission.schedule = "commission-5-10-15-v3"; raw.commission.basisPoints = 500; raw.commission.amountMinor = 50;
  assert.ok(contract.order(raw)); raw.quote.buyerFeeMinor = 25; assert.equal(contract.order(raw), null);
  raw.quote.buyerFeeMinor = 0; raw.commission.basisPoints = 700; raw.commission.amountMinor = 70; assert.equal(contract.order(raw), null);
  raw.commission.schedule = "commission-7-10-15-v2"; raw.quote.buyerFeeMinor = 25; assert.ok(contract.order(raw));
  raw.commission.schedule = "legacy-3-8-10"; raw.commission.basisPoints = 300; raw.commission.amountMinor = 30; assert.ok(contract.order(raw));
  raw.commission.schedule = "commission-5-10-15-v3"; raw.commission.basis = "qualified-inviter"; raw.commission.basisPoints = 1000; raw.commission.amountMinor = 100; raw.quote.buyerFeeMinor = 0; assert.ok(contract.order(raw));
  const eligible = seller(); eligible.fee.basisPoints = 500; assert.ok(listings.seller(eligible)); eligible.fee.basisPoints = 700; assert.equal(listings.seller(eligible), null);
});
