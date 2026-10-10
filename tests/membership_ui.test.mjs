import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createDom } from './fixtures/renderer-dom.mjs';

const source = await readFile(new URL('../renderer/membership.js', import.meta.url), 'utf8');
const shopSource = await readFile(new URL('../renderer/friends-shop.js', import.meta.url), 'utf8');
const creatorSource = await readFile(new URL('../renderer/collectibles.js', import.meta.url), 'utf8');
const now = 1_800_000_000_000, actor = '123456789012345678';
const checkout = 'https://checkout.stripe.com/c/pay/test_example', portal = 'https://billing.stripe.com/p/session/test_example';
const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const snapshot = () => ({ ok: true, now, membership: { active: false, kind: null, until: null, donor: true, everSupported: true, reason: 'not_subscribed' },
  offer: { version: 'a'.repeat(64), currency: 'usd', firstPeriodAmount: 700, renewalAmount: 1100, interval: 'month', referralApplied: false, taxMode: 'none' },
  actions: { checkout: true, portal: true }, pending: { checkout: 'none', requestId: null } });

function env({ enabled = true, data = snapshot(), reply, storage = new Map(), openReply, hubReply, withShop = false } = {}) {
  const dom = createDom(), listeners = [], focus = [], calls = [], opened = [], links = [];
  let state = clone(data), serial = 0, clock = now;
  let hub = { configured: true, linked: true, state: 'ready', billing: enabled, shop: false, user: { id: actor } };
  const window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    addEventListener: (event, run) => { if (event === 'focus') focus.push(run); },
    MefiCollectibles: { open: (view) => links.push(view) },
    mefiStudio: {
      hubStatus: async () => await hubReply?.(clone(hub)) ?? { ok: true, status: clone(hub) }, onHubEvent: (run) => listeners.push(run),
      hubBilling: async (action, payload) => { calls.push([action, clone(payload)]); return await reply?.(action, payload) ?? (action === 'status' ? clone(state) : { ok: true, url: action === 'checkout' ? checkout : portal }); },
      hubBillingOpen: async (action, url, userId) => { opened.push([action, url, userId]); return await openReply?.(action, url, userId) ?? { ok: true }; },
      hubShop: async () => ({ ok: false, error: 'unsupported' }),
    },
  };
  class Clock extends Date { static now() { return clock; } }
  const context = vm.createContext({ window, document: dom.document, console, URL, Date: Clock, crypto: { randomUUID: () => `billing_request_${++serial}` }, setTimeout: () => { throw new Error('membership must not poll or animate'); }, clearTimeout() {}, CustomEvent: class {} });
  vm.runInContext(source, context);
  if (withShop) vm.runInContext(shopSource, context);
  let root = withShop ? window.MefiShop.card({ view: 'membership' }) : window.MefiMembership.card();
  dom.document.body.append(root);
  const button = (label, within = root) => within.querySelectorAll('button').find((el) => el.textContent === label);
  return { ...dom, window, get root() { return root; }, calls, opened, links, storage, button,
    setData: (value) => { state = clone(value); }, advance: (ms) => { clock += ms; },
    refresh: () => window.MefiMembership.refresh(), returned: () => focus.forEach((run) => run()),
    hear: (value) => { hub = { ...hub, ...value }; listeners.forEach((run) => run({ type: 'status', status: clone(hub) })); },
    remount: async () => { root.dispose(); root.remove(); root = window.MefiMembership.card(); dom.document.body.append(root); await flush(); },
    another: async () => { const other = window.MefiMembership.card(); dom.document.body.append(other); await flush(); return other; },
  };
}

test('membership stays closed without billing capability and starts no hidden mutations', async () => {
  const e = env({ enabled: false }); await flush();
  assert.match(e.root.textContent, /not available on this connection/); assert.deepEqual(e.calls, []); assert.deepEqual(e.opened, []);
  assert.equal(e.button('Continue to secure checkout'), undefined);
});

test('membership presents server-selected prices, current access and Donor separately', async () => {
  const e = env(); await flush();
  assert.match(e.root.textContent, /Membership inactive/); assert.match(e.root.textContent, /Permanent Donor active/);
  assert.match(e.root.textContent, /\$7\.00 USD initial month/); assert.match(e.root.textContent, /\$11\.00 USD each month/);
  assert.equal(e.calls.some(([action]) => action !== 'status'), false);
  const free = snapshot(); free.membership = { active: true, kind: 'lifetime', until: null, donor: false, everSupported: true, reason: 'lifetime' }; free.offer = null; free.actions.checkout = false;
  e.setData(free); await e.refresh();
  assert.match(e.root.textContent, /Lifetime membership/); assert.match(e.root.textContent, /No monthly renewal or expiry/); assert.match(e.root.textContent, /Donor benefits inactive/);
  assert.equal(e.button('Continue to secure checkout'), undefined); assert.ok(e.button('Manage billing'));
});

test('intro expiry, referral pricing and tax are display facts and never local grants', async () => {
  const raw = snapshot(); raw.membership = { active: true, kind: 'intro', until: now - 1, donor: false, everSupported: true, reason: 'intro' }; raw.offer.referralApplied = true; raw.offer.taxMode = 'exclusive'; raw.actions.checkout = false;
  const e = env({ data: raw }); await flush();
  assert.match(e.root.textContent, /Intro access/); assert.match(e.root.textContent, /recorded term has elapsed/);
  assert.match(e.root.textContent, /Referral pricing is applied/); assert.match(e.root.textContent, /tax is added in checkout/);
  assert.equal(e.calls.filter(([action]) => action !== 'status').length, 0);
  e.setData(snapshot()); e.returned(); await flush();
  assert.match(e.root.textContent, /Membership inactive/); assert.deepEqual(e.opened, []);
});

test('checkout opens only on explicit action after a fresh matching offer and sends only requestId', async () => {
  const e = env(); await flush();
  assert.equal(e.opened.length, 0); await e.button('Continue to secure checkout').click();
  const calls = e.calls.filter(([action]) => action === 'checkout'); assert.equal(calls.length, 1); assert.deepEqual(Object.keys(calls[0][1]), ['requestId']);
  assert.deepEqual(e.opened, [['checkout', checkout, actor]]); assert.match(e.root.textContent, /Membership inactive/);
  assert.equal([...e.storage.values()].some((value) => value.includes('stripe.com')), false);
});

test('changed offers and stale buttons from a second mounted card cannot open checkout', async () => {
  const e = env(); await flush(); const other = await e.another(); const stale = e.button('Continue to secure checkout', other);
  const changed = snapshot(); changed.offer.version = 'b'.repeat(64); changed.offer.firstPeriodAmount = 900; e.setData(changed);
  await e.button('Continue to secure checkout').click();
  assert.match(e.root.textContent, /offer or pending checkout changed/); assert.equal(e.opened.length, 0);
  await stale.click(); assert.equal(e.calls.filter(([action]) => action === 'checkout').length, 0);
  assert.match(other.textContent, /\$9\.00 USD initial month/);
});

test('lost response retains the same request through remount and application reload', async () => {
  let purchases = 0;
  const e = env({ reply: (action) => action === 'checkout' && ++purchases === 1 ? { ok: false, error: 'network' } : undefined }); await flush();
  await e.button('Continue to secure checkout').click(); const first = e.calls.find(([action]) => action === 'checkout')[1];
  await e.remount(); e.advance(6000); await e.refresh();
  await e.button('Continue existing checkout').click();
  assert.deepEqual(e.calls.filter(([action]) => action === 'checkout').map(([, payload]) => payload), [first, first]);
  const saved = new Map([[`mefi.billing.requests.v1:${actor}`, JSON.stringify({ checkout: { id: first.requestId, phase: 'uncertain' } })]]);
  const reloaded = env({ storage: saved }); await flush(); await reloaded.button('Continue existing checkout').click();
  assert.deepEqual(reloaded.calls.find(([action]) => action === 'checkout')[1], first);
});

test('canonical pending checkout restores its original ID even without local history', async () => {
  const raw = snapshot(); raw.pending = { checkout: 'open', requestId: 'original_pending_request' };
  const e = env({ data: raw }); await flush(); await e.button('Continue existing checkout').click();
  assert.deepEqual(e.calls.find(([action]) => action === 'checkout')[1], { requestId: 'original_pending_request' });
});

test('same-account ready push during recovery hubStatus still completes one canonical read and reuses its ID', async () => {
  let reads = 0, release;
  const raw = snapshot(); raw.pending = { checkout: 'open', requestId: 'original_pending_request' };
  const e = env({ data: raw, hubReply: (hub) => ++reads === 2 ? new Promise((resolve) => { release = () => resolve({ ok: true, status: hub }); }) : undefined });
  await flush(); const initialStatusReads = e.calls.filter(([action]) => action === 'status').length;
  const pending = e.button('Continue existing checkout').click(); await flush();
  e.hear({ state: 'ready', billing: true }); release(); await pending; await flush();
  assert.equal(e.calls.filter(([action]) => action === 'status').length, initialStatusReads + 1);
  assert.deepEqual(e.calls.filter(([action]) => action === 'checkout').map(([, payload]) => payload), [{ requestId: 'original_pending_request' }]);
  assert.deepEqual(e.opened, [['checkout', checkout, actor]]);
});

test('account change during a recovery hubStatus read still cancels its original purchase', async () => {
  let reads = 0, release;
  const raw = snapshot(); raw.pending = { checkout: 'open', requestId: 'original_pending_request' };
  const e = env({ data: raw, hubReply: (hub) => ++reads === 2 ? new Promise((resolve) => { release = () => resolve({ ok: true, status: hub }); }) : undefined });
  await flush(); const pending = e.button('Continue existing checkout').click(); await flush();
  e.setData(snapshot()); e.hear({ user: { id: '234567890123456789' } }); await flush(); release(); await pending;
  assert.equal(e.calls.some(([action]) => action === 'checkout'), false); assert.deepEqual(e.opened, []);
});

test('actions.checkout false, expiring and payment review are never bypassed', async () => {
  for (const pending of ['open', 'expiring', 'payment_review']) {
    const raw = snapshot(); raw.actions.checkout = pending !== 'open'; raw.pending = { checkout: pending, requestId: 'original_pending_request' };
    const e = env({ data: raw }); await flush();
    assert.equal(e.button('Continue existing checkout'), undefined); assert.equal(e.button('Continue to secure checkout'), undefined);
    assert.equal(e.calls.filter(([action]) => action === 'checkout').length, 0);
    if (pending === 'payment_review') assert.match(e.root.textContent, /completed payment needs support review/);
  }
});

test('account changes reject delayed checkout results and never replay another account request', async () => {
  let release;
  const e = env({ reply: (action) => action === 'checkout' ? new Promise((resolve) => { release = resolve; }) : undefined }); await flush();
  const pending = e.button('Continue to secure checkout').click(); await flush();
  e.hear({ user: { id: '234567890123456789' } }); await flush(); release({ ok: true, url: checkout }); await pending;
  assert.equal(e.opened.length, 0); assert.equal(e.button('Continue existing checkout'), undefined);
  assert.ok(e.button('Continue to secure checkout'));
});

test('remount while checkout is pending settles every card without a late popup', async () => {
  let release;
  const raw = snapshot();
  const e = env({ reply: (action, payload) => { if (action === 'checkout') { raw.pending = { checkout: 'open', requestId: payload.requestId }; e.setData(raw); return new Promise((resolve) => { release = resolve; }); } } }); await flush();
  const pending = e.button('Continue to secure checkout').click(); await flush(); await e.remount();
  assert.equal(e.root.getAttribute('aria-busy'), 'true'); release({ ok: true, url: checkout }); await pending; await flush();
  assert.equal(e.root.getAttribute('aria-busy'), 'false'); assert.equal(e.opened.length, 0);
  assert.match(e.root.textContent, /Your request is ready/); assert.ok(e.button('Continue existing checkout'));
});

test('ambiguous portal failures use the same request and hostile URLs never open', async () => {
  let portals = 0;
  const e = env({ reply: (action) => action === 'portal' ? (++portals === 1 ? { ok: false, error: 'network' } : { ok: true, url: 'https://evil.test/portal' }) : undefined }); await flush();
  await e.button('Manage billing').click(); e.advance(6000); await e.refresh(); await e.button('Manage billing').click();
  const calls = e.calls.filter(([action]) => action === 'portal'); assert.equal(calls.length, 2); assert.deepEqual(calls[0][1], calls[1][1]); assert.deepEqual(e.opened, []);
  assert.doesNotMatch(e.root.textContent, /evil\.test/);
});

test('bounded rate-limit delay prevents mutation retries until explicit refresh after the wait', async () => {
  const e = env({ reply: (action) => action === 'checkout' ? { ok: false, error: 'billing_rate_limited', retryAfter: 60000 } : undefined }); await flush();
  await e.button('Continue to secure checkout').click(); await e.refresh();
  assert.equal(e.button('Continue existing checkout').disabled, true); await e.button('Continue existing checkout').click();
  assert.equal(e.calls.filter(([action]) => action === 'checkout').length, 1);
  e.advance(60001); await e.refresh(); assert.equal(e.button('Continue existing checkout').disabled, false);
});

test('unknown errors stay generic and a support-recovery failure stops checkout', async () => {
  const e = env({ reply: (action) => action === 'checkout' ? { ok: false, error: 'billing_request_recovery_required', message: 'private provider details' } : undefined }); await flush();
  await e.button('Continue to secure checkout').click(); assert.match(e.root.textContent, /needs support recovery/); assert.doesNotMatch(e.root.textContent, /private provider details/);
  assert.equal(e.button('Continue existing checkout'), undefined);
});

test('Shop membership remains accessible independently of Shop permission and creator entry is linked', async () => {
  const e = env({ withShop: true }); await flush();
  await e.root.querySelector('#friends-shop-membership').click(); await flush();
  assert.ok(e.root.querySelector('.membership')); assert.equal(e.root.querySelector('#friends-shop-view-membership').getAttribute('aria-selected'), 'true');
  assert.match(e.root.textContent, /Vibe Studio membership/);
  await e.button('Open Creator studio').click(); assert.deepEqual(e.links, ['creator']);
  assert.match(creatorSource, /btn\("View membership", \(\) => window\.MefiShop\?\.open\?\.\("membership"\)\)/);
});
