import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import billing from '../scripts/billing-contract.cjs';
import hub from '../scripts/hub-client.cjs';
import nativeFixture from './fixtures/native-account-host.cjs';

const now = 1_800_000_000_000, user = { id: '123456789012345678', name: 'Member' };
const id = 'billing_request_123', checkout = 'https://checkout.stripe.com/c/pay/cs_test_example', portal = 'https://billing.stripe.com/p/session/test_example';
const status = () => ({ now, membership: { active: false, kind: null, until: null, everSupported: true, donor: true, reason: 'expired' },
  offer: { version: 'a'.repeat(64), currency: 'usd', firstPeriodAmount: 700, renewalAmount: 1100, interval: 'month', referralApplied: false, taxMode: 'none' },
  actions: { checkout: true, portal: true }, pending: { checkout: 'none', requestId: null } });

test('billing accepts three exact named requests and never price or account assertions', () => {
  assert.deepEqual(billing.request('status'), { method: 'GET', path: '/v1/billing/status' });
  for (const action of ['checkout', 'portal']) assert.deepEqual(billing.request(action, { requestId: id }), { method: 'POST', path: `/v1/billing/${action}`, body: { requestId: id } });
  for (const action of ['__proto__', 'webhook', 'refund', 'review', 'status/../checkout']) assert.equal(billing.request(action), null);
  for (const payload of [null, [], { account: user.id }, { requestId: 'short' }, { requestId: 'x'.repeat(81) }, { requestId: id, amount: 500 }, { requestId: id, origin: 'https://host.test' }, { requestId: id, offerVersion: 'a'.repeat(64) }]) assert.equal(billing.request('checkout', payload), null);
  assert.equal(billing.request('status', { account: user.id }), null);
});

test('billing status preserves exact authoritative facts including zero amounts and safe integer bounds', () => {
  const raw = status();
  assert.deepEqual(billing.response('status', raw), { ok: true, ...raw });
  raw.offer.firstPeriodAmount = 0; raw.offer.renewalAmount = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(billing.status(raw), raw);
  raw.membership.reason = 'future_bounded_reason'; assert.ok(billing.status(raw));
  raw.membership = { active: true, kind: 'lifetime', until: null, everSupported: true, donor: false, reason: 'lifetime' };
  raw.offer = null; raw.actions.checkout = false;
  assert.ok(billing.status(raw), 'free lifetime benefits do not imply Donor or a price');
});

test('malformed or expanded status responses fail closed without truncation', () => {
  const bad = [
    (v) => { v.ok = true; }, (v) => { v.enabled = true; }, (v) => { v.now = 0; },
    (v) => { v.membership.active = 'true'; }, (v) => { v.membership.kind = 'paid'; },
    (v) => { v.membership.providerId = 'private'; }, (v) => { v.membership.reason = 'Exception: secret'; },
    (v) => { v.offer.renewalAmount = Number.MAX_SAFE_INTEGER + 1; }, (v) => { v.offer.firstPeriodAmount = -1; },
    (v) => { v.offer.currency = 'USD'; }, (v) => { v.offer.version = 'A'.repeat(64); },
    (v) => { v.offer.taxMode = 'automatic'; }, (v) => { v.actions.checkout = 1; },
    (v) => { v.pending.requestId = id; }, (v) => { v.pending.checkout = 'paid'; },
    (v) => { v.pending.url = checkout; }, (v) => { delete v.membership.donor; },
  ];
  for (const mutate of bad) { const raw = status(); mutate(raw); assert.equal(billing.status(raw), null); }
});

test('every unresolved checkout state requires its original request ID', () => {
  for (const checkout of ['open', 'expiring', 'payment_review']) {
    const raw = status(); raw.pending = { checkout, requestId: id };
    assert.ok(billing.status(raw));
    for (const requestId of [null, undefined, '', 'short', 12345678]) {
      raw.pending.requestId = requestId; assert.equal(billing.status(raw), null, `${checkout} with ${requestId}`);
    }
  }
  const none = status(); assert.ok(billing.status(none));
  none.pending.requestId = id; assert.equal(billing.status(none), null);
});

test('only exact HTTPS Stripe origins and bounded URL-only successes cross the boundary', () => {
  assert.deepEqual(billing.response('checkout', { url: checkout }), { ok: true, url: checkout });
  assert.deepEqual(billing.response('portal', { url: portal }), { ok: true, url: portal });
  for (const url of [portal, 'http://checkout.stripe.com/pay', 'https://checkout.stripe.com.evil.test/pay', 'https://evil.test/?next=https://checkout.stripe.com', 'https://user:pass@checkout.stripe.com/pay', 'https://checkout.stripe.com:444/pay', 'https://checkout.stripe.com\\@evil.test', checkout + '\n', 'javascript:alert(1)', 'file:///checkout.stripe.com', checkout + 'x'.repeat(2048)]) assert.equal(billing.stripeUrl('checkout', url), null);
  assert.equal(billing.stripeUrl('checkout', checkout + 'é'.repeat(400)), null, 'normalization cannot expand past the URL bound');
  assert.equal(billing.response('checkout', { ok: true, url: checkout }), null);
  assert.equal(billing.response('checkout', { url: checkout, customerId: 'secret' }), null);
});

test('safe nested error codes and bounded Retry-After do not expose provider details', () => {
  assert.deepEqual(billing.error({ error: { code: 'billing_rate_limited' } }, '12'), { ok: false, error: 'billing_rate_limited', retryAfter: 12000 });
  for (const wait of ['-1', '1.5', '100000', '3601', 'tomorrow']) assert.equal(billing.error({ error: { code: 'stripe_unavailable' } }, wait).retryAfter, undefined);
  for (const raw of [{ error: 'private message' }, { error: { code: 'stripe_unavailable', message: 'secret' } }, { error: { code: 'Exception: private' } }, { error: { code: 'network' }, stack: 'private' }]) assert.deepEqual(billing.error(raw), { ok: false, error: 'unavailable' });
});

test('streamed billing replies stop at the transport bound before parsing', async () => {
  assert.deepEqual(await billing.readJson(new Response(JSON.stringify(status()))), status());
  let cancelled = false, reads = 0;
  const reply = { headers: new Headers(), body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(++reads === 1 ? billing.RESPONSE_BYTES : 1) }), cancel: async () => { cancelled = true; }, releaseLock() {} }) } };
  assert.equal(await billing.readJson(reply), null); assert.equal(reads, 2); assert.equal(cancelled, true);
  assert.equal(await billing.readJson(new Response('{}', { headers: { 'content-length': String(billing.RESPONSE_BYTES + 1) } })), null);
});

async function clientFixture({ features = ['billing.1'], url = 'https://hub.example.test', reply } = {}) {
  const calls = [], sockets = [];
  class Socket {
    constructor() { this.readyState = 0; sockets.push(this); }
    send() {} close() { this.readyState = 3; }
    receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  const client = hub.createHubClient({ url, WebSocket: Socket, now: () => now, getAccessToken: async () => ({ ok: true, token: 'discord_fixture' }),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {},
    fetch: async (url, init) => {
      const path = new URL(url).pathname; calls.push({ path, ...init, body: init.body ? JSON.parse(init.body) : undefined });
      if (path === '/v1/session') return new Response(JSON.stringify({ ok: true, session: 'fixture_session', expiresAt: now + 900000, user }));
      return await reply?.(path, init) ?? new Response(JSON.stringify(path.endsWith('/status') ? status() : { url: path.endsWith('/portal') ? portal : checkout }));
    },
  });
  await client.connect(); sockets[0].readyState = 1; sockets[0].onopen?.(); sockets[0].receive({ type: 'ready', user, protocol: 1, features });
  return { client, calls, sockets };
}

test('billing capability gates every HTTP action and HTTPS Origin is native-derived', async () => {
  const off = await clientFixture({ features: ['shop', 'collectibles.1'] });
  assert.equal(off.client.status().billing, false);
  for (const action of ['status', 'checkout', 'portal']) assert.equal((await off.client.billing(action, action === 'status' ? {} : { requestId: id })).error, 'unsupported');
  assert.equal(off.calls.length, 1);
  const h = await clientFixture(); assert.equal(h.client.status().billing, true);
  assert.equal((await h.client.billing('status')).membership.donor, true);
  assert.equal((await h.client.billing('checkout', { requestId: id })).url, checkout);
  const sent = h.calls.at(-1); assert.equal(sent.headers.Origin, 'https://hub.example.test'); assert.equal(sent.headers.Authorization, 'Bearer fixture_session');
  assert.deepEqual(sent.body, { requestId: id }); assert.equal(sent.redirect, 'error'); assert.equal(sent.cache, 'no-store');
  const local = await clientFixture({ url: 'http://127.0.0.1:8787' });
  assert.equal((await local.client.billing('checkout', { requestId: id })).error, 'billing_origin_required'); assert.equal(local.calls.length, 1);
});

test('billing status remains available with checkout disabled and no invented price or benefit', async () => {
  const raw = status(); raw.actions.checkout = false; raw.offer = null;
  const h = await clientFixture({ reply: () => new Response(JSON.stringify(raw)) });
  const result = await h.client.billing('status'); assert.equal(result.ok, true); assert.equal(result.offer, null); assert.equal(result.actions.checkout, false); assert.equal(result.actions.portal, true); assert.equal(result.membership.active, false);
});

test('nested billing refusals preserve retry delay but never renew and replay a purchase on 401', async () => {
  const h = await clientFixture({ reply: () => new Response(JSON.stringify({ error: { code: 'billing_rate_limited' } }), { status: 429, headers: { 'Retry-After': '20' } }) });
  assert.deepEqual(await h.client.billing('checkout', { requestId: id }), { ok: false, error: 'billing_rate_limited', retryAfter: 20000 });
  const denied = await clientFixture({ reply: () => new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 }) });
  assert.equal((await denied.client.billing('checkout', { requestId: id })).error, 'unauthorized'); assert.equal(denied.calls.length, 2, 'one session and one purchase, with no credential refresh or replay');
});

test('a late Checkout result after disconnection never crosses into the renderer', async () => {
  let settle;
  const h = await clientFixture({ reply: () => new Promise((resolve) => { settle = resolve; }) });
  const pending = h.client.billing('checkout', { requestId: id });
  h.sockets[0].onclose({ code: 1006 });
  settle(new Response(JSON.stringify({ url: checkout })));
  assert.deepEqual(await pending, { ok: false, error: 'stale_account' });
});

const main = await readFile(new URL('../main.cjs', import.meta.url), 'utf8');
const hostSource = main.slice(main.indexOf('const billingBrowserLinks = new Map();'), main.indexOf('async function hubShopAll()'));
test('native browser opening requires an issued URL, matching current actor, allowlist and unused ticket', async () => {
  const opened = []; let actor = user.id, enabled = true, returned = checkout;
  const client = { status: () => ({ state: 'ready', billing: enabled, user: { id: actor } }), billing: async () => ({ ok: true, url: returned }) };
  const context = vm.createContext({ require: () => billing, Map, Date, process: { env: {} }, hubInstance: () => client, shell: { openExternal: async (url) => { opened.push(url); } } });
  vm.runInContext(hostSource, context);
  assert.equal((await context.hubBillingOpen('checkout', checkout, actor)).ok, false);
  await context.hubBilling('checkout', { requestId: id });
  assert.equal((await context.hubBillingOpen('checkout', checkout.replace('example', 'other'), actor)).ok, false);
  assert.equal((await context.hubBillingOpen('portal', checkout, actor)).ok, false);
  assert.equal((await context.hubBillingOpen('checkout', checkout, 'another_actor')).ok, false);
  assert.equal((await context.hubBillingOpen('checkout', checkout, actor)).ok, true);
  assert.equal((await context.hubBillingOpen('checkout', checkout, actor)).ok, false, 'ticket is consumed');
  await context.hubBilling('checkout', { requestId: id }); actor = 'another_actor';
  assert.equal((await context.hubBillingOpen('checkout', checkout, actor)).ok, false);
  returned = 'https://evil.test/checkout'; assert.equal((await context.hubBilling('checkout', { requestId: id })).error, 'bad_response');
  enabled = false; assert.equal((await context.hubBilling('checkout', { requestId: id })).error, 'unsupported');
  assert.deepEqual(opened, [checkout]);
});

// Exercise the real Rooms hub callback as well as the browser boundary. This
// uses the same VM block seam as hub_host.test.mjs, with no app or network.
async function nativeHost() {
  const from = main.indexOf('// ---- Rooms hub: listen together and now playing');
  const to = main.indexOf('// ---- end of the rooms hub', from);
  assert.ok(from >= 0 && to > from);
  const opened = []; let clock = now, onEvent, failure = false;
  const current = { state: 'ready', billing: true, user };
  const client = { status: () => current, billing: async (action) => failure ? { ok: false, error: 'stripe_unavailable' } : { ok: true, url: action === 'portal' ? portal : checkout } };
  class Clock extends Date { static now() { return clock; } }
  const context = vm.createContext({ ...nativeFixture.nativeHostPorts(), Date: Clock, process: { env: {} }, community: {}, send() {}, logLine() {},
    require: (name) => name === './scripts/billing-contract.cjs' ? billing : nativeFixture.nativeModule(name),
    optionalHelper: (name) => name === './scripts/hub-client.cjs' ? {
      configuredUrl: () => 'https://hub.example.test', createHubClient: (options) => { onEvent = options.onEvent; return client; },
    } : name === './scripts/room-history.cjs' ? nativeFixture.nativeModule(name) : null,
    shell: { openExternal: async (url) => { opened.push(url); } },
  });
  vm.runInContext(`${main.slice(from, to)}\nthis.api = { hubBilling, hubBillingOpen, studioAccountReady };`, context);
  await context.api.studioAccountReady();
  return { api: context.api, opened, advance: (ms) => { clock += ms; }, fail: (value) => { failure = value; },
    hear: (type) => onEvent({ type, status: current }),
  };
}

test('native tickets require a successful issued response and expire at the five-minute boundary', async () => {
  const h = await nativeHost(); h.fail(true);
  assert.equal((await h.api.hubBilling('checkout', { requestId: id })).ok, false);
  assert.equal((await h.api.hubBillingOpen('checkout', checkout, user.id)).ok, false);
  h.fail(false); await h.api.hubBilling('checkout', { requestId: id }); h.advance(5 * 60000 - 1);
  assert.equal((await h.api.hubBillingOpen('checkout', checkout, user.id)).ok, true);
  await h.api.hubBilling('checkout', { requestId: id }); h.advance(5 * 60000);
  assert.equal((await h.api.hubBillingOpen('checkout', checkout, user.id)).ok, false);
  assert.deepEqual(h.opened, [checkout]);
});

test('real Hub status callback invalidates Checkout and Portal tickets even for the same account', async () => {
  const h = await nativeHost();
  await h.api.hubBilling('checkout', { requestId: id }); await h.api.hubBilling('portal', { requestId: id });
  h.hear('status');
  assert.equal((await h.api.hubBillingOpen('checkout', checkout, user.id)).ok, false);
  assert.equal((await h.api.hubBillingOpen('portal', portal, user.id)).ok, false);
  assert.deepEqual(h.opened, []);
  await h.api.hubBilling('portal', { requestId: id }); h.hear('credits');
  assert.equal((await h.api.hubBillingOpen('portal', portal, user.id)).ok, true, 'an unrelated event does not consume a newly issued ticket');
  assert.equal((await h.api.hubBillingOpen('portal', portal, user.id)).ok, false, 'the successful open consumes it');
  assert.deepEqual(h.opened, [portal]);
});

const preload = await readFile(new URL('../preload.cjs', import.meta.url), 'utf8');
test('sandboxed preload copies exact billing requests and uses the dedicated native URL channel', async () => {
  const calls = [];
  const context = vm.createContext({ require: (name) => {
    assert.equal(name, 'electron');
    return { contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
      ipcRenderer: { invoke: async (channel, payload) => { calls.push([channel, JSON.parse(JSON.stringify(payload))]); return { ok: true }; }, on() {}, send() {} }, webUtils: {} };
  } });
  vm.runInContext(preload, context);
  const bridge = context.mefiStudio;
  await bridge.hubBilling('status'); await bridge.hubBilling('checkout', { requestId: id });
  await bridge.hubBillingOpen('checkout', checkout, user.id);
  assert.deepEqual(calls, [['hub:billing', { action: 'status', payload: {} }], ['hub:billing', { action: 'checkout', payload: { requestId: id } }], ['hub:billing-open', { action: 'checkout', url: checkout, actorId: user.id }]]);
  assert.equal((await bridge.hubBilling('refund', {})).ok, false);
  assert.equal((await bridge.hubBilling('checkout', { requestId: 'x'.repeat(300) })).ok, false);
  assert.equal((await bridge.hubBillingOpen('checkout', 'x'.repeat(2049), user.id)).ok, false);
  await bridge.hubBilling('checkout', { requestId: id, amount: 500 });
  assert.equal(billing.request(calls.at(-1)[1].action, calls.at(-1)[1].payload), null, 'extra fields remain rejectable at the native boundary');
});
