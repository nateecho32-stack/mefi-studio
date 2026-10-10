import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createDom } from './fixtures/renderer-dom.mjs';

const cratesSource = await readFile(new URL('../renderer/collectible-crates.js', import.meta.url), 'utf8');
const collectionSource = await readFile(new URL('../renderer/collectibles.js', import.meta.url), 'utf8');
const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const now = 1_800_000_000_000;
const version = 'a'.repeat(64);
const pet = { id: 'pet_one', definitionId: 'design_1234567890abcdef', kind: 'pet', name: 'Test companion', rarity: 'common', stage: 'baby', visual: { body: 'cloud' }, unlockedSizes: ['tiny'], size: 'tiny', traits: [], ownerId: 'member1' };
const recipes = { ok: true, version: 1, topics: [{ id: 'test-garden', name: 'Fixture garden' }], tiers: [{ id: 'test-budget', name: 'Fixture budget', budget: 40, rewardCount: 2 }], recipes: [{ id: 'dynamic:test-garden:test-budget', topicId: 'test-garden', tierId: 'test-budget', budget: 40, count: 2, available: true }], now };
const quote = () => ({ id: `quote_${'a'.repeat(32)}`, recipeId: recipes.recipes[0].id, expiresAt: now + 300000, budget: 40, price: 30, unspentBudget: 10, count: 2, requiresOptIn: true, poolVersion: version, selection: 'uniform-without-replacement', slots: [{ index: 0, price: 15, poolId: 'price_15' }, { index: 1, price: 15, poolId: 'price_15' }], pools: [{ id: 'price_15', price: 15, candidates: [{ type: 'collectible', id: pet.definitionId, kind: 'pet', name: pet.name, makerId: 'member2', rarityWeights: { common: 9999, rare: 1 } }, { type: 'catalog-license', id: 'studio:fx-rain', kind: 'effect', name: 'Fixture rain', makerId: null }, { type: 'community-pack-license', id: 'pack_1234567890abcdef', kind: 'pack', name: 'Fixture pack', makerId: 'member2' }], selectionChance: { numerator: 1, denominator: 3 }, rarityWeightsTotal: { common: 9999, rare: 1 }, collectibleCount: 1, rarityDenominator: 30000, collectibleRarityDenominator: 10000 }], creatorShare: 0.75 });
const rewards = [{ type: 'collectible', item: pet, paid: 15 }, { type: 'community-pack-license', item: { id: 'pack_1234567890abcdef', kind: 'pack', name: 'Fixture pack', data: { unexpected: 'must not apply' } }, paid: 15 }];
const snapshot = () => ({ ok: true, inventory: [], catalog: [], creations: [], rarities: [], balance: 100, crates: [], listings: [], orders: [], notifications: [], entitlements: { canCreate: false, canSell: true }, now });
function env({ enabled = true, reply, recipeData = recipes, contributionData, shopRefresh } = {}) {
  const dom = createDom(), calls = [], listeners = [], messages = [], timers = [];
  let clock = now, serial = 0, collection = snapshot(), shopRefreshes = 0;
  const make = dom.document.createElement;
  dom.document.createElement = (tag) => { const el = make(tag); if (tag === 'dialog') { el.showModal = () => { el.open = true; }; el.close = () => { el.open = false; }; } return el; };
  dom.document.documentElement.dataset.motion = 'off';
  const status = { state: 'ready', collectibles: true, dynamicCrates: enabled, user: { id: 'member1' } };
  const window = { mefiStudio: {
    hubStatus: async () => ({ ok: true, status }), onHubEvent: (fn) => listeners.push(fn),
    hubCollectibles: async (action, payload) => {
      calls.push([action, copy(payload)]);
      const override = await reply?.(action, payload);
      if (override !== undefined) return override;
      if (action === 'list') return copy(collection);
      if (action === 'crateRecipes') return copy(recipeData);
      if (action === 'crateQuote') return payload.communityOptIn ? { ok: true, quote: quote(), replayed: false } : { ok: false, error: 'opt-in-required' };
      if (action === 'crateOpen') { collection.inventory = [copy(pet)]; return { ok: true, receiptId: 'receipt_one', quoteId: quote().id, paid: 30, balance: 70, rewards: copy(rewards), replayed: false }; }
      if (action === 'crateContributions') return copy(contributionData || { ok: true, topics: recipes.topics, items: [], next: null });
      return { ok: true };
    },
  }, MefiShop: { open: (view) => messages.push(view), refresh: async () => { shopRefreshes++; return await shopRefresh?.(shopRefreshes) ?? { ok: true }; } }, MefiPets: { state: () => ({ chosen: {} }), paintPreview: () => {} }, dispatchEvent: () => {} };
  class Clock extends Date { static now() { return clock; } }
  const ctx = vm.createContext({ window, document: dom.document, console, Date: Clock, crypto: { randomUUID: () => `fixture_request_${++serial}` }, CustomEvent: class {}, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  vm.runInContext(cratesSource, ctx); vm.runInContext(collectionSource, ctx);
  let root = window.MefiCollectibles.card(); dom.document.body.append(root);
  const button = (text) => root.querySelectorAll('button').find((el) => el.textContent === text);
  const tab = async (text) => { await button(text).click(); await flush(); };
  const dynamic = () => root.querySelector('.collectibles-dynamic');
  const prepare = async () => { await flush(); await tab('Crates'); await button('Explore topic crates').click(); };
  const include = async () => { const check = dynamic().querySelector('input'); check.checked = true; await check.trigger('change'); };
  const getQuote = async () => { await prepare(); await include(); await button('Get exact quote · no charge').click(); };
  const confirm = () => { const check = root.querySelector('.collectibles-quote input'); check.checked = true; void check.trigger('change'); };
  return { ...dom, get root() { return root; }, calls, window, button, tab, prepare, include, getQuote, confirm, messages, timers, shopRefreshes: () => shopRefreshes, advance: (ms) => { clock += ms; }, hear: (event) => listeners.forEach((fn) => fn(event)), mountAnother: async () => { const other = window.MefiCollectibles.card(); dom.document.body.append(other); await flush(); return other; }, remount: async () => { root.dispose(); root.remove(); root = window.MefiCollectibles.card(); dom.document.body.append(root); await flush(); }, api: window.MefiCollectibles };
}

test('older services show no topic controls and send no dynamic requests', async () => {
  const e = env({ enabled: false }); await flush(); await e.tab('Crates');
  assert.equal(e.button('Explore topic crates'), undefined);
  assert.deepEqual(e.calls.map(([action]) => action), ['list']);
});

test('an empty configured policy invents no topics, budgets or prices', async () => {
  const e = env({ recipeData: { ...recipes, topics: [], tiers: [], recipes: [] } }); await e.prepare();
  assert.match(e.root.textContent, /No topic crates yet/); assert.equal(e.button('Get exact quote · no charge'), undefined);
  assert.equal(e.calls.filter(([action]) => action === 'crateQuote').length, 0);
});

test('community consent precedes a quote, while exact price and original odds precede spending', async () => {
  const e = env(); await e.prepare(); await e.button('Get exact quote · no charge').click();
  assert.match(e.root.textContent, /explicit permission/); assert.equal(e.calls.some(([action]) => action === 'crateOpen'), false);
  await e.include(); await e.button('Get exact quote · no charge').click();
  assert.match(e.root.textContent, /2 rewards · 30 credits total · 10 credits/);
  assert.match(e.root.textContent, /1\/10000 \(0.01%\)/);
  assert.match(e.root.textContent, /1\/30000/); assert.doesNotMatch(e.root.textContent, /1\/30000 \(0%\)/);
  assert.match(e.root.textContent, /2\/3 chance of appearing/); assert.match(e.root.textContent, /Licenses have no rarity roll/);
  const details = e.root.querySelector('.collectibles-quote-details');
  assert.equal(details.querySelector('summary').textContent, 'See reward pool and exact odds');
  assert.equal(details.hasAttribute('open'), false, 'exact odds remain accessible in a collapsed native details control');
  assert.equal(e.button('Open 2 rewards · 30 credits').disabled, true, 'an unreviewed quote cannot be opened');
  await e.button('Open 2 rewards · 30 credits').click(); assert.equal(e.calls.some(([action]) => action === 'crateOpen'), false);
  e.confirm(); assert.equal(e.button('Open 2 rewards · 30 credits').disabled, false);
  const confirmation = e.root.querySelector('.collectibles-quote input');
  confirmation.checked = false; await confirmation.trigger('change');
  assert.equal(e.button('Open 2 rewards · 30 credits').disabled, true, 'withdrawing review disables spending again');
  e.confirm(); await e.button('Open 2 rewards · 30 credits').click();
  const sent = e.calls.find(([action]) => action === 'crateOpen')[1];
  assert.equal(sent.price, 30); assert.equal(sent.poolVersion, version); assert.equal(sent.communityOptIn, true);
  assert.equal(e.shopRefreshes(), 2); assert.equal(e.api.snapshot().inventory[0].id, pet.id);
  const reveal = e.root.querySelector('dialog'); assert.equal(reveal.open, true); assert.match(reveal.textContent, /Fixture pack/); assert.match(reveal.textContent, /license stays with your account/);
  assert.equal(reveal.querySelectorAll('canvas').length, 1, 'a Shop license is not rendered as a collectible pet');
  assert.equal(e.timers.length, 0, 'typed rewards respect reduced motion');
  await e.button('Open Shop ownership').click(); assert.deepEqual(e.messages, ['owned']);
});

test('lost opening reply recovers the same request after expiry, repaint and remount', async () => {
  let opens = 0;
  const e = env({ reply: (action) => { if (action === 'crateOpen' && ++opens === 1) return { ok: false, error: 'network' }; } });
  await e.getQuote(); e.confirm(); await e.button('Open 2 rewards · 30 credits').click();
  e.advance(600000); await e.api.refresh(); await e.remount(); await e.tab('Crates');
  assert.ok(e.button('Recover this opening')); await e.button('Recover this opening').click();
  const requests = e.calls.filter(([action]) => action === 'crateOpen').map(([, payload]) => payload);
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  assert.equal(e.calls.filter(([action]) => action === 'crateQuote').length, 1);
});

test('lost quote reply retries its request, and an expired unopened quote never spends', async () => {
  let quotes = 0;
  const e = env({ reply: (action) => { if (action === 'crateQuote' && ++quotes === 1) return { ok: false, error: 'network' }; } });
  await e.getQuote(); await e.tab('Nursery'); await e.tab('Crates'); await e.button('Recover quote').click();
  const requests = e.calls.filter(([action]) => action === 'crateQuote').map(([, payload]) => payload);
  assert.deepEqual(requests[0], requests[1]); e.advance(600000); e.confirm(); await e.button('Open 2 rewards · 30 credits').click();
  assert.equal(e.calls.some(([action]) => action === 'crateOpen'), false); assert.match(e.root.textContent, /quote expired/);
});

test('changed pools require a newly reviewed quote and never silently spend again', async () => {
  const e = env({ reply: (action) => action === 'crateOpen' ? { ok: false, error: 'pool-changed' } : undefined });
  await e.getQuote(); e.confirm(); await e.button('Open 2 rewards · 30 credits').click();
  assert.equal(e.calls.filter(([action]) => action === 'crateQuote').length, 1); assert.equal(e.button('Recover this opening'), undefined);
  await e.button('Get exact quote · no charge').click();
  const requests = e.calls.filter(([action]) => action === 'crateQuote').map(([, payload]) => payload);
  assert.notEqual(requests[0].requestId, requests[1].requestId); assert.equal(e.calls.filter(([action]) => action === 'crateOpen').length, 1);
});

test('a receipt with a different reward count stays recoverable and is never revealed or applied', async () => {
  let opens = 0;
  const e = env({ reply: (action) => action === 'crateOpen' && ++opens === 1 ? { ok: true, quoteId: quote().id, paid: 30, rewards: [copy(rewards[0])] } : undefined });
  await e.getQuote(); e.confirm(); await e.button('Open 2 rewards · 30 credits').click();
  assert.equal(e.shopRefreshes(), 0); assert.equal(e.root.querySelector('dialog').open, false); assert.match(e.root.textContent, /receipt did not match/);
  await e.button('Recover this opening').click();
  const requests = e.calls.filter(([action]) => action === 'crateOpen').map(([, payload]) => payload);
  assert.deepEqual(requests[0], requests[1]); assert.equal(e.shopRefreshes(), 2);
});

test('two mounted cards share updates, but an older confirmation cannot authorize a replacement quote', async () => {
  let quoted = 0;
  const laterQuote = { ...quote(), id: `quote_${'b'.repeat(32)}`, price: 20, unspentBudget: 20, poolVersion: 'b'.repeat(64), slots: [{ index: 0, price: 10, poolId: 'price_10' }, { index: 1, price: 10, poolId: 'price_10' }], pools: [{ ...quote().pools[0], id: 'price_10', price: 10 }] };
  const e = env({ reply: (action) => action === 'crateQuote' && ++quoted > 1 ? { ok: true, quote: copy(laterQuote), replayed: false } : undefined });
  await e.getQuote(); e.confirm(); const oldConfirmation = e.button('Open 2 rewards · 30 credits');
  const other = await e.mountAnother();
  const otherButton = (text) => other.querySelectorAll('button').find((el) => el.textContent === text);
  await otherButton('Discard quote').click();
  assert.equal(e.root.querySelector('.collectibles-quote'), null, 'discard propagates to the other mounted card');
  await otherButton('Get exact quote · no charge').click();
  assert.match(e.root.textContent, /20 credits total/); assert.equal(e.root.querySelector('.collectibles-quote input').checked, false);
  await oldConfirmation.click();
  assert.equal(e.calls.filter(([action]) => action === 'crateOpen').length, 0);
  assert.match(e.root.textContent, /quote changed in another view/);
  other.querySelector('.collectibles-quote input').checked = true;
  await otherButton('Open 2 rewards · 20 credits').click();
  const sent = e.calls.find(([action]) => action === 'crateOpen')[1];
  assert.equal(sent.quoteId, laterQuote.id); assert.equal(sent.price, 20); assert.equal(sent.poolVersion, laterQuote.poolVersion);
});

test('remounting during an opening re-enables exact recovery when the disposed sender settles', async () => {
  let finish, opens = 0;
  const e = env({ reply: (action) => action === 'crateOpen' && ++opens === 1 ? new Promise((resolve) => { finish = resolve; }) : undefined });
  await e.getQuote(); e.confirm(); const pending = e.button('Open 2 rewards · 30 credits').click(); await flush();
  await e.remount(); assert.equal(e.button('Recover this opening').disabled, true);
  finish({ ok: false, error: 'network' }); await pending; await flush();
  assert.equal(e.button('Recover this opening').disabled, false);
  await e.button('Recover this opening').click();
  const requests = e.calls.filter(([action]) => action === 'crateOpen').map(([, payload]) => payload);
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]); assert.equal(e.root.querySelector('dialog').open, true);
});

test('a pre-grant Shop read cannot finish ownership refresh before the post-grant read settles', async () => {
  let oldRead, freshRead;
  const prior = new Promise((resolve) => { oldRead = resolve; }), fresh = new Promise((resolve) => { freshRead = resolve; });
  const e = env({ shopRefresh: (call) => call <= 2 ? prior : fresh });
  const alreadyReading = e.window.MefiShop.refresh();
  await e.getQuote(); e.confirm(); const opening = e.button('Open 2 rewards · 30 credits').click(); await flush();
  assert.equal(e.shopRefreshes(), 2); assert.equal(e.root.querySelector('dialog').open, false);
  oldRead({ ok: true }); await alreadyReading; await flush();
  assert.equal(e.shopRefreshes(), 3); assert.equal(e.root.querySelector('dialog').open, false);
  assert.doesNotMatch(e.root.textContent, /Your ownership is refreshed/);
  freshRead({ ok: true }); await opening;
  assert.equal(e.root.querySelector('dialog').open, true); assert.match(e.root.textContent, /Your ownership is refreshed/);
});

test('failure of the fresh Shop read is reported even when the older read succeeded', async () => {
  const e = env({ shopRefresh: (call) => call === 1 ? { ok: true } : { ok: false, error: 'network' } });
  await e.getQuote(); e.confirm(); await e.button('Open 2 rewards · 30 credits').click();
  assert.doesNotMatch(e.root.textContent, /Your ownership is refreshed/);
  assert.match(e.root.textContent, /receipt is saved; reconnect to refresh ownership/);
  assert.equal(e.root.querySelector('dialog').open, true, 'the valid receipt can still be inspected without claiming ownership was refreshed');
});

test('disconnect fences a late opening receipt and another account cannot see its quote', async () => {
  let finish;
  const e = env({ reply: (action) => action === 'crateOpen' ? new Promise((resolve) => { finish = resolve; }) : undefined });
  await e.getQuote(); e.confirm(); const opening = e.button('Open 2 rewards · 30 credits').click(); await flush();
  e.hear({ type: 'status', status: { state: 'off' } });
  finish({ ok: true, rewards: copy(rewards), paid: 30 }); await opening;
  assert.equal(e.root.querySelector('dialog').open, false); assert.equal(e.shopRefreshes(), 0);
  e.hear({ type: 'status', status: { state: 'ready', collectibles: true, dynamicCrates: true, user: { id: 'member2' } } }); await flush();
  assert.equal(e.button('Recover this opening'), undefined);
});

test('former creators can separately withdraw dynamic permission without changing immutable terms', async () => {
  const definition = { type: 'collectible', id: pet.definitionId, kind: 'pet', name: pet.name, makerId: 'member1', price: 15, rarityWeights: { common: 9999, rare: 1 }, termsVersion: version, consent: { enabled: true, topics: ['test-garden'] } };
  const e = env({ contributionData: { ok: true, topics: recipes.topics, items: [definition], next: null } }); await flush(); await e.tab('Creator studio');
  assert.equal(e.button('Review creation'), undefined); await e.button('Manage topic crate permissions').click();
  assert.match(e.root.textContent, /separate creation-time community crate permission/); assert.match(e.root.textContent, /rare 0.01%/);
  await e.button('Save topic permission').click(); assert.equal(e.calls.some(([action]) => action === 'updateCrateContribution'), false);
  await e.button('Withdraw topic permission').click();
  assert.deepEqual(e.calls.find(([action]) => action === 'updateCrateContribution')[1], { type: 'collectible', id: pet.definitionId, enabled: false, topics: [], termsVersion: version });
  assert.equal(e.calls.some(([action]) => action === 'updateCreation'), false);
});

test('contribution permission confirms the current quoted terms and only renders forty rows at once', async () => {
  const items = Array.from({ length: 85 }, (_, index) => ({ type: 'community-pack-license', id: `pack_${String(index).padStart(16, '0')}`, kind: 'pack', name: `Fixture ${index}`, makerId: 'member1', price: 15, termsVersion: version, consent: { enabled: false, topics: [] } }));
  const e = env({ contributionData: { ok: true, topics: recipes.topics, items, next: null } }); await flush(); await e.tab('Creator studio'); await e.button('Manage topic crate permissions').click();
  assert.equal(e.root.querySelectorAll('.collectibles-contributions details').length, 40);
  const row = e.root.querySelector('.collectibles-contributions details'); for (const check of row.querySelectorAll('input')) check.checked = true;
  await e.button('Save topic permission').click();
  const sent = e.calls.find(([action]) => action === 'updateCrateContribution')[1]; assert.equal(sent.enabled, true); assert.deepEqual(sent.topics, ['test-garden']); assert.equal(sent.termsVersion, version);
  assert.equal(Object.hasOwn(sent, 'price'), false); assert.equal(Object.hasOwn(sent, 'rarityWeights'), false);
});

const creatorItem = (index) => ({ type: 'community-pack-license', id: `pack_${String(index).padStart(16, '0')}`, kind: 'pack', name: `History ${index}`,
  makerId: 'member1', price: 15, termsVersion: version, consent: { enabled: false, topics: [] } });
const creatorKey = (item) => `${item.type}:${item.id}`;
const creatorPage = (items, next = null) => ({ ok: true, topics: copy(recipes.topics), items: copy(items), next });
async function openCreator(e) { await flush(); await e.tab('Creator studio'); await e.button('Manage topic crate permissions').click(); }
async function showLoadedCreations(e) {
  let button;
  while ((button = e.root.querySelectorAll('button').find((entry) => entry.textContent.startsWith('Show more creations (')))) await button.click();
}

test('creator history loads server pages after the locally loaded rows are shown, without dropping older entries', async () => {
  const items = Array.from({ length: 131 }, (_, index) => creatorItem(index + 2000));
  const cursor = creatorKey(items[99]);
  const e = env({ reply: (action, payload) => action === 'crateContributions' ? payload.cursor ? creatorPage(items.slice(100)) : creatorPage(items.slice(0, 100), cursor) : undefined });
  await openCreator(e);
  assert.equal(e.root.querySelectorAll('.collectibles-contributions details').length, 40);
  assert.equal(e.button('Load more creations'), undefined);
  await showLoadedCreations(e);
  assert.equal(e.root.querySelectorAll('.collectibles-contributions details').length, 100);
  assert.equal(e.calls.filter(([action]) => action === 'crateContributions').length, 1, 'showing local rows does not refetch');
  await e.button('Load more creations').click();
  assert.equal(e.root.querySelectorAll('.collectibles-contributions details').length, 131);
  assert.match(e.root.textContent, /History 2130/);
  assert.equal(e.button('Load more creations'), undefined);
  assert.deepEqual(e.calls.filter(([action]) => action === 'crateContributions').map(([, payload]) => payload), [{ limit: 100 }, { cursor, limit: 100 }]);
});

test('editor reload and saved permission clear the pagination cursor and restart at the first page', async () => {
  const first = creatorItem(1), last = creatorItem(2), cursor = creatorKey(first);
  const e = env({ reply: (action, payload) => action === 'crateContributions' ? payload.cursor ? creatorPage([last]) : creatorPage([first], cursor) : undefined });
  await openCreator(e); await e.button('Load more creations').click();
  assert.match(e.root.textContent, /History 2/);
  await e.button('Refresh creation terms').click();
  assert.doesNotMatch(e.root.textContent, /History 2/);
  assert.deepEqual(e.calls.filter(([action]) => action === 'crateContributions').at(-1)[1], { limit: 100 });
  const row = e.root.querySelector('.collectibles-contributions details'); for (const check of row.querySelectorAll('input')) check.checked = true;
  await e.button('Save topic permission').click();
  assert.equal(e.button('Load more creations'), undefined);
  await e.button('Manage topic crate permissions').click();
  assert.deepEqual(e.calls.filter(([action]) => action === 'crateContributions').at(-1)[1], { limit: 100 });
  assert.doesNotMatch(e.root.textContent, /History 2/);
});

test('reconnecting the same actor drops the editor cursor and rejects a late page from its earlier identity', async () => {
  const first = creatorItem(1), last = creatorItem(2), cursor = creatorKey(first);
  let complete;
  const e = env({ reply: (action, payload) => action === 'crateContributions' ? payload.cursor ? new Promise((resolve) => { complete = resolve; }) : creatorPage([first], cursor) : undefined });
  await openCreator(e);
  const pending = e.button('Load more creations').click(); await flush();
  e.hear({ type: 'status', status: { state: 'off' } });
  e.hear({ type: 'status', status: { state: 'ready', collectibles: true, dynamicCrates: true, user: { id: 'member1' } } }); await flush();
  complete(creatorPage([last])); await pending; await flush();
  assert.equal(e.button('Load more creations'), undefined);
  assert.doesNotMatch(e.root.textContent, /History 2/);
  assert.equal(e.button('Manage topic crate permissions').disabled, false);
  await e.button('Manage topic crate permissions').click();
  assert.deepEqual(e.calls.filter(([action]) => action === 'crateContributions').at(-1)[1], { limit: 100 });
});

test('a remounted creator editor retries its pending page without accepting the disposed card response', async () => {
  const first = creatorItem(1), last = creatorItem(2), cursor = creatorKey(first);
  let complete, laterPages = 0;
  const e = env({ reply: (action, payload) => action === 'crateContributions'
    ? !payload.cursor ? creatorPage([first], cursor) : ++laterPages === 1 ? new Promise((resolve) => { complete = resolve; }) : creatorPage([last])
    : undefined });
  await openCreator(e);
  const pending = e.button('Load more creations').click(); await flush();
  await e.remount(); await e.tab('Creator studio');
  assert.equal(e.button('Load more creations').disabled, true);
  complete(creatorPage([last])); await pending; await flush();
  assert.equal(e.button('Load more creations').disabled, false);
  assert.doesNotMatch(e.root.textContent, /History 2/);
  await e.button('Load more creations').click();
  assert.match(e.root.textContent, /History 2/);
  const pages = e.calls.filter(([action, payload]) => action === 'crateContributions' && payload.cursor).map(([, payload]) => payload);
  assert.deepEqual(pages, [{ cursor, limit: 100 }, { cursor, limit: 100 }]);
});

test('duplicate or looping contribution pages require a fresh editor read instead of hiding entries', async () => {
  const first = creatorItem(1), cursor = creatorKey(first);
  for (const nextPage of [creatorPage([first]), creatorPage([creatorItem(2)], cursor)]) {
    const e = env({ reply: (action, payload) => action === 'crateContributions' ? payload.cursor ? nextPage : creatorPage([first], cursor) : undefined });
    await openCreator(e); await e.button('Load more creations').click();
    assert.match(e.root.textContent, /creation list changed while loading/);
    assert.equal(e.button('Load more creations'), undefined);
    assert.ok(e.button('Manage topic crate permissions'));
    assert.equal(e.calls.filter(([action]) => action === 'crateContributions').length, 2, 'does not silently refetch a changed page');
  }
});
