import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {createDom} from './fixtures/renderer-dom.mjs';
const source=await readFile(new URL('../renderer/commerce.js',import.meta.url),'utf8');
const shopSource=await readFile(new URL('../renderer/friends-shop.js',import.meta.url),'utf8');
const now=1_800_000_000_000,actor='123456789012345678',other='234567890123456789',orderId='cash_'+'a'.repeat(32),listingId='cashlist_'+'b'.repeat(32),version='c'.repeat(64);
const url='https://checkout.stripe.com/c/pay/test_example';
const countrySelect=e=>e.root.querySelectorAll("select").find(el=>el.getAttribute("aria-label")==="Declared country")??null;
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const flush=async()=>{for(let i=0;i<160;i++)await Promise.resolve();};
const order=()=>({dtoVersion:2,orderId,state:'quoted',listing:{id:listingId,version,name:'Moon friend',kind:'community-pack-license'},quote:{mode:'hosted-exclusive-v1',currency:'usd',minorUnit:2,amountIncrementMinor:1,saleMinor:1000,quantity:1,taxBehavior:'exclusive',taxStatus:'pending',taxMinor:null,buyerFeeMinor:0,totalMinor:null},commission:{basisPoints:700,amountMinor:70,basis:'subscriber',rounding:'nearest-minor-half-up',schedule:'commission-7-10-15-v2'},settlement:null,expiresAt:now+600000,receipt:null,needsReview:false,error:null});
const asset=()=>({type:'community-pack-license',id:'pack_'+'d'.repeat(16),name:'Moon palette',description:'A calm palette',preview:{kind:'palette',palette:{accent:'#abcdef',background:'#111111',surface:'#222222',text:'#ffffff'}}});
const listing=()=>({id:listingId,version,seller:{id:other,name:'Maker'},name:'Moon palette',kind:'community-pack-license',currency:'usd',minorUnit:2,amountIncrementMinor:1,saleMinor:1000,asset:asset()});
const seller=()=>({enabled:true,canList:true,canSell:true,fee:{state:'known',basisPoints:500},onboarding:{state:'ready',canStart:false},pricing:{currencies:[{code:'usd',minorUnit:2,amountIncrementMinor:1,minSaleMinor:50,maxSaleMinor:100000}]},reason:null});
function env({enabled=true,reply,storage=new Map(),storeFails=false,openReply,hubReply}={}){
  const dom=createDom(),calls=[],opened=[],focus=[],listeners=[],refreshes=[];let serial=0,clock=now;
  let state={state:'ready',shop:false,commerceOrders:enabled,commerceCatalog:enabled,commerceSeller:enabled,commerceOnboarding:enabled,user:{id:actor}};
  let currentOrder=order(),currentListing=listing(),sellerState=seller();
  const window={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(storeFails)throw Error('storage unavailable');storage.set(k,v);},removeItem:k=>storage.delete(k)},addEventListener:(e,fn)=>{if(e==='focus')focus.push(fn);},
    MefiCollectibles:{refresh:async()=>{refreshes.push('collectibles');return{ok:true};}},MefiShop:{refresh:async()=>{refreshes.push('shop');return{ok:true};}},
    mefiStudio:{hubStatus:async()=>await hubReply?.(clone(state))??{ok:true,status:clone(state)},onHubEvent:fn=>listeners.push(fn),hubCommerce:async(action,payload)=>{
      calls.push([action,clone(payload)]);const custom=await reply?.(action,payload);if(custom!==undefined)return custom;
      if(action==='listOrders')return{ok:true,orders:[],nextCursor:null};if(action==='catalog')return{ok:true,items:[clone(currentListing)],nextCursor:null};
      if(action==='listing')return{ok:true,listing:clone(currentListing)};if(action==='seller')return{ok:true,...clone(sellerState)};
      if(action==='sellerAssets')return{ok:true,items:payload.kind==='community-pack-license'?[{asset:asset(),eligibility:{canList:true,reason:null},listingId:null}]:[],nextCursor:null};
      if(action==='sellerListings')return{ok:true,items:[],nextCursor:null};if(action==='onboarding')return{ok:true,url:'https://connect.stripe.com/setup/example',expiresAt:now+600000,replayed:false};
      if(action==='createOrder')return{ok:true,...clone(currentOrder),replayed:false};if(action==='getOrder')return{ok:true,...clone(currentOrder)};
      if(action==='checkout')return{ok:true,...clone(currentOrder),state:'awaiting_payment',url};return{ok:false,error:'cash_unavailable'};
    },hubCommerceOpen:async(...args)=>{opened.push(args);return await openReply?.(...args)??{ok:true};}},};
  class Clock extends Date{static now(){return clock;}}
  const context=vm.createContext({window,document:dom.document,console,Date:Clock,URL,crypto:{randomUUID:()=>`cash_request_${++serial}`},setTimeout:()=>{throw Error('Cash UI must not poll or animate');},clearTimeout(){}});vm.runInContext(source,context);
  let root=window.MefiCommerce.card();dom.document.body.append(root);
  const button=label=>root.querySelectorAll('button').find(b=>b.textContent===label);
  return{...dom,window,context,get root(){return root;},calls,opened,storage,refreshes,button,
    setOrder:v=>{currentOrder=clone(v);},setListing:v=>{currentListing=clone(v);},setSeller:v=>{sellerState=clone(v);},advance:n=>{clock+=n;},returned:()=>focus.forEach(fn=>fn()),
    hear:v=>{state={...state,...v};listeners.forEach(fn=>fn({type:'status',status:clone(state)}));},
    remount:async()=>{root.dispose();root.remove();root=window.MefiCommerce.card();dom.document.body.append(root);await flush();},
  };
}
test('cash marketplace is reachable in Shop and stays closed without its capability',async()=>{
  assert.match(shopSource,/\["commerce", "Cash marketplace"\]/);assert.match(shopSource,/window\.MefiCommerce\.card\(\)/);
  const e=env({enabled:false});await flush();assert.match(e.root.textContent,/not available on this connection/);assert.deepEqual(e.calls,[]);assert.deepEqual(e.opened,[]);
});
test('cash marketplace loads server data without hidden purchases or provider links',async()=>{
  const e=env();await flush();assert.match(e.root.textContent,/Moon palette/);assert.match(e.root.textContent,/10\.00 USD/);
  assert.equal(e.calls.some(([a])=>['createOrder','checkout','publishListing'].includes(a)),false);assert.deepEqual(e.opened,[]);
});
test('cash review separates pending tax, item price, seller commission and verified settlement',async()=>{
  const e=env();await flush();await e.window.MefiCommerce.prepare(listing());assert.match(e.root.textContent,/Calculated at secure checkout/);assert.match(e.root.textContent,/7% · 0\.70 USD/);assert.doesNotMatch(e.root.textContent,/Confirmed quote total/);
  const paid=order();paid.state='review';paid.needsReview=true;paid.settlement={status:'verified',currency:'usd',minorUnit:2,amountIncrementMinor:1,saleMinor:1000,taxMinor:65,buyerFeeMinor:0,totalMinor:1065,verifiedAt:now};e.setOrder(paid);await e.button('Refresh this order').click();
  assert.match(e.root.textContent,/Verified payment: 10\.65 USD/);assert.match(e.root.textContent,/Delivery is still being resolved/);assert.equal(e.button('Continue to secure checkout'),undefined);assert.deepEqual(e.refreshes,[]);
});
test('cash checkout opens only after explicit matching review and saves no URL or local goods',async()=>{
  const e=env();await flush();await e.window.MefiCommerce.prepare(listing());assert.equal(e.opened.length,0);await e.button('Continue to secure checkout').click();
  assert.deepEqual(e.opened,[[orderId,url,actor]]);assert.equal([...e.storage.values()].some(v=>v.includes('stripe.com')),false);assert.deepEqual(e.refreshes,[]);
  e.returned();await flush();assert.equal(e.calls.filter(([a])=>a==='checkout').length,1);assert.equal(e.calls.filter(([a])=>a==='createOrder').length,1);
});
test('uncertain cash create reuses its durable original tuple after remount',async()=>{
  let attempts=0;const e=env({reply:(action)=>action==='createOrder'?(++attempts===1?{ok:false,error:'network'}:{ok:true,...order(),replayed:true}):undefined});await flush();await e.window.MefiCommerce.prepare(listing());
  const first=e.calls.find(([a])=>a==='createOrder')[1];assert.equal(e.storage.size,1);await e.remount();await e.button('My orders').click();await flush();
  const recover=e.root.querySelectorAll('button').find(b=>b.textContent.startsWith('Recover saved request'));assert.equal(recover.disabled,false);await recover.click();assert.equal(e.calls.filter(([a])=>a==='createOrder').length,1);assert.match(e.root.textContent,/Please wait/);e.advance(6000);await e.root.querySelectorAll('button').find(b=>b.textContent.startsWith('Recover saved request')).click();const calls=e.calls.filter(([a])=>a==='createOrder');assert.equal(calls.length,2);assert.deepEqual(calls[1][1],first);assert.equal(e.opened.length,0);
});
test('cash create cannot start when durable recovery storage fails',async()=>{
  const e=env({storeFails:true});await flush();await e.window.MefiCommerce.prepare(listing());assert.equal(e.calls.filter(([a])=>a==='createOrder').length,0);assert.match(e.root.textContent,/could not save the recovery reference/);
});
test('cash stale listing version is re-reviewed before reserving an order',async()=>{
  const e=env();await flush();await e.button('Review listing').click();const changed=listing();changed.version='e'.repeat(64);changed.saleMinor=2000;e.setListing(changed);await e.button('Review order and fees').click();
  assert.equal(e.calls.filter(([a])=>a==='createOrder').length,0);assert.match(e.root.textContent,/listing changed/);assert.match(e.root.textContent,/20\.00 USD/);
});
test('cash account changes discard delayed checkout URLs and old order state',async()=>{
  let finish;const e=env({reply:(a)=>a==='checkout'?new Promise(r=>{finish=r;}):undefined});await flush();await e.window.MefiCommerce.prepare(listing());const pending=e.button('Continue to secure checkout').click();await flush();e.hear({user:{id:other}});finish({ok:true,...order(),state:'awaiting_payment',url});await pending;await flush();assert.equal(e.opened.length,0);assert.doesNotMatch(e.root.textContent,new RegExp(orderId));
});
test('verified delivery only triggers fresh canonical collection reads, never grants from receipt',async()=>{
  const e=env();await flush();await e.window.MefiCommerce.prepare(listing());const paid=order();paid.state='fulfilled';paid.settlement={status:'verified',currency:'usd',minorUnit:2,amountIncrementMinor:1,saleMinor:1000,taxMinor:0,buyerFeeMinor:0,totalMinor:1000,verifiedAt:now};paid.receipt={orderId,kind:paid.listing.kind,reference:asset().id,version,deliveredAt:now};e.setOrder(paid);await e.button('Refresh this order').click();assert.deepEqual(e.refreshes,['collectibles','collectibles','shop','shop']);assert.match(e.root.textContent,/Delivered/);assert.equal(e.opened.length,0);
});
test('seller price conversion uses explicit minor units, integer math and configured bounds',async()=>{
  const e=env();await flush();const parse=e.window.MefiCommerce.parsePrice;const policy={minorUnit:3,amountIncrementMinor:1,minSaleMinor:1,maxSaleMinor:Number.MAX_SAFE_INTEGER};
  assert.equal(parse('123.456',policy),123456);assert.equal(parse('1.001',policy),1001);assert.equal(parse('1.0001',policy),null);assert.equal(parse('1e3',policy),null);assert.equal(parse('-1',policy),null);assert.equal(parse('9007199254740992',policy),null);assert.equal(parse('1.1',{...policy,minorUnit:0}),null);assert.equal(parse('0',policy),null);
});
test('seller unknown fee or missing currencies never defaults to a higher rate or opens publication',async()=>{
  const e=env();await flush();const raw=seller();raw.fee={state:'pending',basisPoints:null};raw.canList=false;raw.pricing.currencies=[];e.setSeller(raw);await e.button('Sell').click();await flush();assert.match(e.root.textContent,/verification pending/);assert.doesNotMatch(e.root.textContent,/15%/);assert.equal(e.calls.filter(([a])=>a==='publishListing').length,0);assert.deepEqual(e.opened,[]);
});
test('cash catalog continuation rejects repeated pages without silently losing earlier listings',async()=>{
  let count=0;const e=env({reply:a=>a==='catalog'?{ok:true,items:[listing()],nextCursor:++count===1?'first-page':'second-page'}:undefined});await flush();await e.button('More creations').click();assert.match(e.root.textContent,/repeated a marketplace page/);assert.match(e.root.textContent,/Moon palette/);assert.equal(e.button('More creations'),undefined);
});

test('seller onboarding is explicit, account-bound and browser returns only refresh readiness',async()=>{
  const e=env();await flush();const raw=seller();raw.canSell=false;raw.onboarding={state:'needed',canStart:true};e.setSeller(raw);await e.button('Sell').click();await flush();assert.equal(e.calls.some(([a])=>a==='onboarding'),false);
  await e.button('Set up seller payments').click();assert.deepEqual(e.opened,[['onboarding','https://connect.stripe.com/setup/example',actor]]);assert.equal([...e.storage.values()].some(v=>v.includes('stripe.com')),false);
  e.returned();await flush();assert.equal(e.calls.filter(([a])=>a==='onboarding').length,1);assert.match(e.root.textContent,/Seller setup pending/);assert.ok(e.button('Open a fresh setup link'));
});
test('unknown onboarding response retains the same request until explicit recovery',async()=>{
  let attempts=0;const e=env({reply:a=>a==='onboarding'?(++attempts===1?{ok:false,error:'network'}:{ok:true,url:'https://connect.stripe.com/setup/example',expiresAt:now+600000,replayed:true}):undefined});await flush();const raw=seller();raw.onboarding={state:'needed',canStart:true};e.setSeller(raw);await e.button('Sell').click();await flush();await e.button('Set up seller payments').click();const first=e.calls.find(([a])=>a==='onboarding')[1];
  e.advance(6000);await e.button('Refresh seller setup').click();await flush();await e.button('Continue existing setup').click();assert.deepEqual(e.calls.filter(([a])=>a==='onboarding')[1][1],first);assert.equal(e.opened.length,1);
});
test('explicit request resolution retains unknown tuples and only clears server-confirmed nonapplication',async()=>{
  let outcome='unknown';
  const e=env({reply:(action,payload)=>action==='createOrder'?{ok:false,error:'network'}:action==='retireOrderRequest'?(outcome==='unknown'?{ok:false,error:'network'}:{ok:true,outcome:'not-applied',requestId:payload.requestId}):undefined});
  await flush();await e.window.MefiCommerce.prepare(listing());e.hear({commerceRetireOrders:true});await flush();await e.button('My orders').click();await flush();
  const original=JSON.parse(e.storage.get('mefi.commerce.drafts.v2:'+actor));
  await e.button('Resolve saved request').click();assert.deepEqual(JSON.parse(e.storage.get('mefi.commerce.drafts.v2:'+actor)),original);
  outcome='clear';await e.button('Resolve saved request').click();assert.deepEqual(JSON.parse(e.storage.get('mefi.commerce.drafts.v2:'+actor)),{});
  assert.equal(e.calls.filter(([a])=>a==='createOrder').length,1);assert.equal(e.opened.length,0);
});
test('canonical cash seller ownership is preserved instead of hidden by a numeric-only client',async()=>{
  const canonical='studio:12345678-1234-4abc-8abc-123456789abc',e=env();await flush();e.hear({user:{id:canonical},actorProtocol:'accounts.canonical.1'});await flush();
  await e.window.MefiCommerce.prepare(listing());assert.ok(e.storage.has('mefi.commerce.drafts.v2:'+canonical));assert.equal(e.storage.has('mefi.commerce.drafts.v2:'+actor),false);
});
test("seller country requires an explicit choice and review; reads create no provider action", async () => {
  const setup = { countries: ["US", "CA"], declaredCountry: null, locked: false, canPrepare: true, reason: null };
  const e = env({ reply: (action, input) => action === "readSellerSetup" ? { ok: true, ...setup } : action === "prepareSellerSetup" ? (setup.declaredCountry = input.country, { ok: true, country: input.country, replayed: false }) : undefined });
  await flush(); e.hear({ commerceSellerSetup: true }); await flush(); await e.button("Sell").click(); await flush();
  const select = countrySelect(e);
  assert.equal(select.value, ""); assert.equal(e.button("Review country declaration").disabled, true);
  assert.equal(e.calls.some(([a]) => a === "prepareSellerSetup" || a === "onboarding"), false);
  select.value = "CA"; await select.trigger("change"); await e.button("Review country declaration").click();
  assert.match(e.root.textContent, /Save CA as your declared country/);
  await e.button("Confirm country declaration").click(); await flush();
  const mutation = e.calls.findIndex(([a]) => a === "prepareSellerSetup");
  assert.equal(e.calls[mutation][1].country, "CA");
  assert.equal(e.calls.slice(mutation + 1).some(([a]) => a === "readSellerSetup"), true);
  assert.match(e.root.textContent, /Current declared country: CA/);
  assert.deepEqual(e.opened, []);
});

test("unknown seller country save retains original tuple across remount and never enables onboarding", async () => {
  const setup = { countries: ["US"], declaredCountry: null, locked: false, canPrepare: true, reason: null };
  const e = env({ reply: action => action === "readSellerSetup" ? { ok: true, ...setup } : action === "prepareSellerSetup" ? { ok: false, error: "network" } : undefined });
  await flush(); e.hear({ commerceSellerSetup: true }); await flush(); await e.button("Sell").click(); await flush();
  const select = countrySelect(e); select.value = "US"; await select.trigger("change");
  await e.button("Review country declaration").click(); await e.button("Confirm country declaration").click(); await flush();
  const first = e.calls.find(([a]) => a === "prepareSellerSetup")[1];
  await e.remount(); await e.button("Sell").click(); await flush(); e.advance(6000);
  await e.button("Recover country declaration").click(); await flush();
  assert.deepEqual(e.calls.filter(([a]) => a === "prepareSellerSetup")[1][1], first);
  assert.ok(e.storage.has("mefi.commerce.drafts.v2:seller-country:" + actor));
  assert.equal(e.calls.some(([a]) => a === "onboarding"), false); assert.deepEqual(e.opened, []);
});

test("locked or empty country setup cannot offer editing or infer a default", async () => {
  let setup = { countries: [], declaredCountry: "US", locked: true, canPrepare: false, reason: "cash_seller_country_locked" };
  const e = env({ reply: action => action === "readSellerSetup" ? { ok: true, ...setup } : undefined });
  await flush(); e.hear({ commerceSellerSetup: true }); await flush(); await e.button("Sell").click(); await flush();
  assert.match(e.root.textContent, /Current declared country: US/); assert.equal(e.button("Review country declaration"), undefined);
  setup = { countries: [], declaredCountry: null, locked: false, canPrepare: false, reason: "cash_seller_setup_unavailable" };
  await e.button("Refresh seller setup").click(); await flush();
  assert.match(e.root.textContent, /No country has been declared/); assert.equal(countrySelect(e), null);
  assert.equal(e.calls.some(([a]) => a === "prepareSellerSetup"), false);
});
test("new schedule shows exact 5 percent commission and seller processing disclosure without invented cost", async () => {
  const e = env(); await flush(); const current = order(); current.commission = { ...current.commission, basisPoints: 500, amountMinor: 50, schedule: "commission-5-10-15-v3" };
  e.setOrder(current); await e.window.MefiCommerce.prepare(listing());
  assert.match(e.root.textContent, /5% · 0\.50 USD/);
  assert.match(e.root.textContent, /seller also pays the actual verified payment processing cost/);
  assert.doesNotMatch(e.root.textContent, /Net payout|Processing cost: 0/);
  const history = order(); history.quote.buyerFeeMinor = 25; e.setOrder(history); await e.button("Refresh this order").click();
  assert.match(e.root.textContent, /7% · 0\.70 USD/); assert.match(e.root.textContent, /0\.25 USD/);
  assert.doesNotMatch(e.root.textContent, /seller also pays the actual verified payment processing cost/);
});
test("server retry delay gates recovery at action time without polling or losing the original tuple", async () => {
  let attempts = 0;
  const e = env({ reply: action => action === "createOrder" ? (++attempts === 1 ? { ok: false, error: "cash_rate_limited", retryAfter: 30000 } : { ok: true, ...order(), replayed: true }) : undefined });
  await flush(); await e.window.MefiCommerce.prepare(listing()); await e.button("My orders").click(); await flush();
  const original = e.calls.find(([action]) => action === "createOrder")[1];
  const recover = () => e.root.querySelectorAll("button").find(button => button.textContent.startsWith("Recover saved request"));
  assert.equal(recover().disabled, false);
  e.advance(6000); await recover().click();
  assert.equal(attempts, 1); assert.match(e.root.textContent, /24 seconds/);
  e.advance(24000); await recover().click();
  assert.equal(attempts, 2); assert.deepEqual(e.calls.filter(([action]) => action === "createOrder")[1][1], original);
  assert.equal(e.opened.length, 0);
});

test("checkout continuation stays reachable while its handler enforces the retry deadline", async () => {
  let attempts = 0;
  const e = env({ reply: action => action === "checkout" ? (++attempts === 1 ? { ok: false, error: "network" } : { ok: true, ...order(), state: "awaiting_payment", url }) : undefined });
  await flush(); await e.window.MefiCommerce.prepare(listing());
  await e.button("Continue to secure checkout").click();
  assert.ok(e.button("Continue to secure checkout"));
  await e.button("Continue to secure checkout").click(); assert.equal(attempts, 1);
  assert.match(e.root.textContent, /Please wait/); assert.equal(e.opened.length, 0);
  e.advance(5000); await e.button("Continue to secure checkout").click();
  assert.equal(attempts, 2); assert.deepEqual(e.opened, [[orderId, url, actor]]);
  assert.equal(e.calls.filter(([action]) => action === "createOrder").length, 1);
});