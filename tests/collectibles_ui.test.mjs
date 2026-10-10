import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createDom } from './fixtures/renderer-dom.mjs';

const source = await readFile(new URL('../renderer/collectibles.js', import.meta.url), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const pet = { id: 'pet_1', definitionId: 'emberling', kind: 'pet', name: 'Little Ember', visual: { body: 'dragon', primary: '#ffaa66', secondary: '#fff0aa', motif: 'stars' }, rarity: 'rare', growth: { stage: 'baby', careDays: 0 }, unlockedSizes: ['tiny'], size: 'tiny', ownerId: '123456789', tradeHoldUntil: 0, traits: [{ id: 'curious', name: 'Curious' }] };
const snapshot = () => ({ ok: true, balance: 80, inventory: [clone(pet)], catalog: [], creations: [], rarities: ['none', 'common', 'uncommon', 'rare', 'epic', 'legendary'].map((id) => ({ id, name: id === 'none' ? 'Original' : id, color: '#ffaa66' })), entitlements: { canCreate: true, canSetRarity: true, canSell: true }, crates: [{ id: 'pet', name: 'Companion cradle', kind: 'pet', price: 20, count: 1, odds: [{ rarity: 'rare', chance: 10 }, { rarity: 'common', chance: 90 }], requiresOptIn: false }, { id: 'community', name: 'Community discovery', kind: 'mixed', price: 25, count: 2, odds: [{ rarity: 'rare', chance: 100 }], requiresOptIn: true, poolVersion: 'pool1' }], listings: [], orders: [], notifications: [], now: Date.now() });
function env({ data = snapshot(), reply = null, motion = 'full', selected = null } = {}) {
  const dom = createDom(), calls = [], equips = [], events = [], timers = [], hubListeners = [];
  dom.document.documentElement.dataset.motion = motion;
  let next = clone(data), chosen = selected, requestIndex = 0;
  const create = dom.document.createElement;
  dom.document.createElement = (tag) => { const el = create(tag); if (tag === 'dialog') { el.showModal = () => { el.open = true; }; el.close = () => { el.open = false; }; } return el; };
  const window = { mefiStudio: { onHubEvent: (fn) => hubListeners.push(fn), hubCollectibles: async (action, payload) => { calls.push([action, clone(payload)]); if (action === 'list') return clone(next); return await reply?.(action, payload) ?? { ok: true, items: [clone(pet)] }; } }, MefiPets: { state: () => ({ chosen: { instanceId: chosen } }), suspendCollectible: () => equips.push('suspended'), equip: (item) => { equips.push(clone(item)); chosen = item?.id ?? null; }, paintPreview: () => {} }, dispatchEvent: (event) => events.push(event), MefiShop: { open: () => {} } };
  const ctx = vm.createContext({ window, document: dom.document, console, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {}, crypto: { randomUUID: () => `request-123456-${++requestIndex}` } });
  vm.runInContext(source, ctx);
  const root = window.MefiCollectibles.card(); dom.document.body.append(root);
  const findButton = (text, inside = root) => inside.querySelectorAll('button').find((el) => el.textContent === text);
  const field = (label) => root.querySelectorAll('label').find((el) => el.children[0]?.textContent === label)?.children[1];
  return { ...dom, root, calls, equips, events, timers, api: window.MefiCollectibles, hear: (event) => hubListeners.forEach((fn) => fn(event)), setData: (value) => { next = clone(value); }, button: findButton, field, tab: async (name) => { await findButton(name).click(); await flush(); } };
}

test('collection restores only the authoritative equipped instance and clears it when transferred', async () => {
  const e = env({ selected: pet.id }); await flush();
  assert.equal(e.equips.at(-1).id, pet.id);
  assert.match(e.root.textContent, /Curious/);
  const later = snapshot(); later.inventory = []; e.setData(later); await e.api.refresh();
  assert.equal(e.equips.at(-1), null);
  assert.equal(e.events.at(-1).type, 'mefi-collectibles-changed');
  assert.equal(e.events.at(-1).detail.balance, 80);
});

test('opening requires explicit spend confirmation and animation follows the returned items', async () => {
  const e = env(); await flush(); await e.tab('Crates');
  assert.match(e.root.textContent, /10%/);
  await e.button('Review opening · 20 credits').click();
  assert.equal(e.calls.filter(([a]) => a === 'open').length, 0);
  await e.button('Spend 20 credits').click(); await flush();
  assert.equal(e.calls.filter(([a]) => a === 'open').length, 1);
  assert.equal(e.calls.find(([a]) => a === 'open')[1].price, 20);
  const reveal = e.root.querySelector('dialog'); assert.equal(reveal.open, true); assert.equal(reveal.dataset.phase, 'opening');
  await e.button('Skip animation', reveal).click(); assert.equal(reveal.dataset.phase, 'revealed');
  assert.match(reveal.textContent, /Little Ember/);
});

test('uncertain opening retry preserves its request ID; repeated click cannot double spend', async () => {
  let finish;
  const e = env({ reply: async (action) => action === 'open' ? new Promise((resolve) => { finish = resolve; }) : { ok: true } }); await flush(); await e.tab('Crates');
  await e.button('Review opening · 20 credits').click(); const confirmation = e.button('Spend 20 credits');
  const first = confirmation.click(); await flush(); await confirmation.click();
  assert.equal(e.calls.filter(([a]) => a === 'open').length, 1);
  finish({ ok: false, error: 'network' }); await first;
  await e.button('Review opening · 20 credits').click(); const second = e.button('Spend 20 credits').click(); await flush();
  const opens = e.calls.filter(([a]) => a === 'open'); assert.equal(opens.length, 2); assert.equal(opens[0][1].requestId, opens[1][1].requestId);
  finish({ ok: true, items: [clone(pet)] }); await second;
});

test('community opening requires renewed opt-in to its specific published pool', async () => {
  const e = env(); await flush(); await e.tab('Crates');
  const source = e.field('Collection'); source.value = 'community'; await source.trigger('change');
  await e.button('Review opening · 25 credits').click(); assert.equal(e.root.querySelector('.collectibles-confirm').hidden, true);
  e.root.querySelector('input').checked = true;
  await e.button('Review opening · 25 credits').click(); await e.button('Spend 25 credits').click();
  const payload = e.calls.find(([a]) => a === 'open')[1]; assert.equal(payload.communityOptIn, true); assert.equal(payload.poolVersion, 'pool1');
});

test('reduced motion reveals immediately and closing the collection fences a pending result', async () => {
  const e = env({ motion: 'off' }); await flush(); await e.tab('Crates'); await e.button('Review opening · 20 credits').click(); await e.button('Spend 20 credits').click();
  assert.equal(e.root.querySelector('dialog').dataset.phase, 'revealed'); assert.equal(e.timers.length, 0);
  let resolve;
  const late = env({ reply: () => new Promise((done) => { resolve = done; }) }); await flush(); await late.tab('Crates'); await late.button('Review opening · 20 credits').click();
  const opening = late.button('Spend 20 credits').click(); await flush(); late.root.dispose(); resolve({ ok: true, items: [clone(pet)] }); await opening;
  assert.equal(late.root.querySelector('dialog').open, false);
});

test('creator confirms permanent price and exact odds and never equips or self-grants an item', async () => {
  const e = env({ reply: () => ({ ok: true, definition: { id: 'new' }, item: null }) }); await flush(); await e.tab('Creator studio');
  await e.button('Review creation').click(); assert.match(e.root.querySelector('.collectibles-confirm').textContent, /Permanent price: 0 credits/); assert.match(e.root.querySelector('.collectibles-confirm').textContent, /Original 100%/); assert.match(e.root.querySelector('.collectibles-confirm').textContent, /cannot be changed later/);
  await e.button('Create with these permanent terms').click();
  const creation = e.calls.find(([a]) => a === 'create')[1]; assert.deepEqual(creation.rarityWeights, { none: 10000 }); assert.equal(e.equips.length, 0);
  assert.match(e.root.textContent, /published price and chances/);
});

test('inactive creator keeps listing controls but cannot create; bound stickers have no trade controls', async () => {
  const data = snapshot(); data.entitlements.canCreate = false; data.creations = [{ id: 'design1', name: 'Old friend', price: 10, listed: true }]; data.inventory.push({ ...clone(pet), id: 'sticker1', kind: 'sticker', bound: true, visual: { asset: 'happy' } });
  const e = env({ data }); await flush(); await e.tab('Creator studio');
  assert.equal(e.button('Review creation'), undefined); await e.button('Take down').click(); assert.deepEqual(e.calls.find(([a]) => a === 'updateCreation')[1], { definitionId: 'design1', listed: false });
  await e.tab('Sticker book'); assert.equal(e.button('Review transfer'), undefined); assert.ok(e.button('Download image'));
  assert.match(e.root.textContent, /Base sticker · stays in your book/); assert.doesNotMatch(e.root.textContent, /Ready to trade/);
  assert.equal(e.root.querySelector('img').src, '../assets/stickers/studio-happy.png');
  const hostile = e.api.renderSticker({ name: '<img onerror=x>', visual: { asset: '../../secret', primary: 'url(http://evil)' } });
  assert.equal(hostile.querySelector('img'), null); assert.equal(hostile.style.color, '#8b7cf6');
});

test('market range and auto spending are confirmed without claiming a credit reservation', async () => {
  const e = env(); await flush(); await e.tab('Market');
  const minimum = e.field('Minimum rarity'), maximum = e.field('Maximum rarity'); minimum.value = 'legendary'; maximum.value = 'common';
  await e.button('Review order').click(); assert.equal(e.calls.filter(([a]) => a === 'order').length, 0); assert.match(e.root.textContent, /Minimum rarity cannot/);
  maximum.value = 'legendary'; e.field('When a match appears').value = 'auto'; await e.button('Review order').click();
  assert.match(e.root.querySelector('.collectibles-confirm').textContent, /up to 25 credits/); assert.match(e.root.querySelector('.collectibles-confirm').textContent, /No credits are reserved/); await e.button('Create auto-buy order').click();
  assert.equal(e.calls.find(([a]) => a === 'order')[1].mode, 'auto');
});

test('trade holds and saved care disable actions; sale dispatch cannot collide with inventory list', async () => {
  const data = snapshot(); data.inventory[0].tradeHoldUntil = Date.now() + 60000; data.inventory[0].caredToday = true;
  const e = env({ data }); await flush(); assert.equal(e.button('Review transfer').disabled, true); assert.equal(e.button('Review listing').disabled, true); assert.equal(e.button('Cared for today').disabled, true);
  data.inventory[0].tradeHoldUntil = 0; e.setData(data); await e.api.refresh();
  await e.button('Review listing').click(); await e.button('List for sale').click(); assert.ok(e.calls.some(([a]) => a === 'listItem'));
});

test('disconnect drops the live snapshot, fences late rewards and restores by ID on reconnect', async () => {
  let finish;
  const e = env({ selected: pet.id, reply: () => new Promise((resolve) => { finish = resolve; }) }); await flush();
  e.hear({ type: 'status', status: { state: 'ready', user: { id: 'member1' } } }); await flush();
  await e.tab('Crates'); await e.button('Review opening · 20 credits').click();
  const opening = e.button('Spend 20 credits').click(); await flush();
  e.hear({ type: 'status', status: { state: 'off' } });
  assert.equal(e.api.snapshot(), null); assert.equal(e.equips.at(-1), 'suspended');
  finish({ ok: true, items: [clone(pet)] }); await opening;
  assert.equal(e.root.querySelector('dialog').open, false);
  e.hear({ type: 'status', status: { state: 'ready', user: { id: 'member1' } } }); await flush();
  assert.equal(e.equips.at(-1).id, pet.id);
});

test('credit events refresh visible inventory and remove a sold equipped pet', async () => {
  const e = env({ selected: pet.id }); await flush(); const next = snapshot(); next.inventory = []; e.setData(next);
  e.hear({ type: 'credits', reason: 'sale' }); await flush();
  assert.equal(e.equips.at(-1), null); assert.equal(e.api.snapshot().inventory.length, 0);
});

test('market paging appends without duplicating listings and sends the opaque cursor unchanged', async () => {
  const data = snapshot(); data.marketNext = '123|listing_one'; data.listings = [{ id: 'listing_one', instanceId: 'other1', price: 30, item: pet }];
  const e = env({ data, reply: (action) => action === 'market' ? { ok: true, listings: [{ id: 'listing_one', instanceId: 'other1', price: 30, item: pet }, { id: 'listing_two', instanceId: 'other2', price: 40, item: { ...pet, name: 'Another Ember' } }], next: null } : { ok: true } });
  await flush(); await e.tab('Market'); await e.button('Load more listings').click();
  assert.deepEqual(e.calls.find(([a]) => a === 'market')[1], { cursor: '123|listing_one' });
  assert.equal(e.api.snapshot().listings.length, 2); assert.equal(e.button('Load more listings'), undefined); assert.match(e.root.textContent, /Another Ember/);
});

test('a lost Studio crate reply survives server poolVersion and inventory repaint without a second receipt', async () => {
  const data = snapshot(); data.crates[0].poolVersion = 'studio-v1';
  let opens = 0;
  const e = env({ data, reply: (action) => { if (action !== 'open') return { ok: true }; opens++; return opens === 1 ? { ok: false, error: 'network' } : { ok: true, items: [clone(pet)], replayed: true }; } });
  await flush(); await e.tab('Crates'); await e.button('Review opening · 20 credits').click(); await e.button('Spend 20 credits').click();
  await e.api.refresh(); await e.tab('Nursery'); await e.tab('Crates');
  await e.button('Review opening · 20 credits').click(); await e.button('Spend 20 credits').click();
  const requests = e.calls.filter(([a]) => a === 'open').map(([,p])=>p);
  assert.equal(requests.length, 2); assert.equal(requests[0].poolVersion, 'studio-v1'); assert.equal(requests[0].requestId, requests[1].requestId);
});

test('a lost creator purchase reply survives a market repaint and retries the same receipt', async () => {
  const data = snapshot(); data.catalog = [{ id: 'design1', kind: 'pet', name: 'Nova friend', price: 20, visual: pet.visual, rarityWeights: { common: 10000 }, listed: true, maker: { id: 'maker' } }];
  let buys = 0;
  const e = env({ data, reply: (action) => { if (action !== 'buyCreation') return { ok: true }; buys++; return buys === 1 ? { ok: false, error: 'network' } : { ok: true, item: clone(pet), replayed: true }; } });
  await flush(); await e.tab('Market'); await e.button('Review · 20 credits').click(); await e.button('Get · 20 credits').click();
  await e.api.refresh(); await e.tab('Nursery'); await e.tab('Market'); await e.button('Review · 20 credits').click(); await e.button('Get · 20 credits').click();
  const requests = e.calls.filter(([a]) => a === 'buyCreation').map(([,p])=>p);
  assert.equal(requests.length, 2); assert.equal(requests[0].requestId, requests[1].requestId);
});

test('inventory pages assemble before deciding whether an older equipped pet is still owned', async () => {
  const data = snapshot(); data.inventory = [{ ...clone(pet), id: 'newer_pet' }]; data.inventoryNext = 'older-page';
  let finish;
  const e = env({ data, selected: pet.id, reply: (action) => action === 'inventory' ? new Promise((resolve) => { finish = resolve; }) : { ok: true } });
  await flush(); assert.equal(e.equips.length, 0, 'a partial page must not unequip the older pet'); assert.equal(e.api.snapshot(), null);
  finish({ ok: true, inventory: [clone(pet)], next: null }); await flush();
  assert.equal(e.equips.at(-1).id, pet.id); assert.equal(e.api.snapshot().inventory.length, 2); assert.equal(e.api.snapshot().inventoryNext, null);
});

test('failed inventory pagination never accepts a partial collection or revokes equipment', async () => {
  const e = env({ selected: pet.id, reply: () => ({ ok: false, error: 'network' }) }); await flush();
  const data = snapshot(); data.inventory = []; data.inventoryNext = 'older-page'; e.setData(data);
  const before = e.equips.length; const answer = await e.api.refresh();
  assert.equal(answer.ok, false); assert.equal(e.equips.length, before); assert.equal(e.api.snapshot().inventory[0].id, pet.id);
});

test('catalog paging adds creator designs with a guarded opaque cursor', async () => {
  const data = snapshot(); data.catalogNext = 'older-designs';
  const e = env({ data, reply: (action) => action === 'catalog' ? { ok: true, catalog: [{ id: 'design42', kind: 'pet', name: 'Older friend', visual: pet.visual, price: 10, rarityWeights: { none: 10000 }, maker: { id: 'maker' }, listed: true }], next: null } : { ok: true } });
  await flush(); await e.tab('Market'); await e.button('Load more creator designs').click();
  assert.deepEqual(e.calls.find(([a])=>a==='catalog')[1], { cursor: 'older-designs' }); assert.match(e.root.textContent, /Older friend/); assert.equal(e.button('Load more creator designs'), undefined);
});

test('tiny community probabilities stay nonzero and approximate odds are marked only when rounded', async () => {
  const data = snapshot(); data.crates[0].odds = [{ rarity: 'legendary', chance: 0.000005 }, { rarity: 'epic', chance: 33.3333333333333 }, { rarity: 'common', chance: 60 }];
  const e = env({ data }); await flush(); await e.tab('Crates');
  const odds = e.root.querySelectorAll('.collectibles-odds dd').map((el)=>el.textContent);
  assert.match(odds[0], /^0[.,]000005%$/); assert.match(odds[1], /^≈ 33[.,]3333%$/); assert.equal(odds[2], '60%');
});

test('rarity names retain theme text contrast while their dots carry rarity color', async () => {
  const e = env(); await flush(); const badge = e.root.querySelector('.collectibles-rarity');
  assert.equal(badge.style.color, undefined); assert.match(badge.textContent, /rare/); assert.equal(badge.querySelector('.collectibles-rarity-dot').style.backgroundColor, '#ffaa66');
  assert.equal(badge.querySelector('.collectibles-rarity-dot').getAttribute('aria-hidden'), 'true');
});

test('custom sticker motifs are visible and PNG downloads use the same artwork as the book and room renderer', async () => {
  const sticker = { ...clone(pet), id: 'sticker_motif', kind: 'sticker', name: 'Star friend', visual: { ...pet.visual, glyph: 'heart', motif: 'stars' } };
  const data = snapshot(); data.inventory = [sticker];
  const e = env({ data }); await flush();
  const create = e.document.createElement, drawings = new Map(), encoded = [], links = [];
  e.document.createElement = (tag) => {
    const el = create(tag);
    if (tag === 'canvas') {
      const commands = [], ctx = {};
      for (const method of ['scale', 'beginPath', 'roundRect', 'fill', 'save', 'clip', 'moveTo', 'lineTo', 'stroke', 'closePath', 'restore', 'fillText']) ctx[method] = (...args) => commands.push([method, ...args]);
      for (const property of ['fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'textAlign', 'textBaseline', 'font']) Object.defineProperty(ctx, property, { set: (value) => commands.push([property, value]) });
      el.getContext = () => ctx;
      el.toDataURL = (type) => {
        const source = `data:image/png;base64,${Buffer.from(JSON.stringify(commands)).toString('base64')}`;
        encoded.push({ type, width: el.width, commands: clone(commands), source }); drawings.set(source, commands); return source;
      };
    }
    if (tag === 'a') el.click = () => links.push({ href: el.href, download: el.download });
    return el;
  };
  const picture = (motif, visual = {}) => {
    const art = e.api.renderSticker({ ...sticker, visual: { ...sticker.visual, motif, ...visual } });
    const image = art.querySelector('img'); assert.ok(image, 'custom stickers use the shared room/book artwork');
    assert.equal(art.querySelector('canvas'), null, 'a large sticker book never retains a canvas per instance');
    assert.equal(art.dataset.rarity, 'rare', 'the existing rarity frame remains independent of the artwork');
    return drawings.get(image.src).filter(([command]) => command !== 'scale');
  };
  const motifs = ['plain', 'stars', 'sparkles', 'stripes'].map((motif) => picture(motif));
  assert.equal(new Set(motifs.map((commands) => JSON.stringify(commands))).size, 4, 'all four selectable finishes produce different artwork');
  assert.equal(motifs[0].filter(([command]) => command === 'lineTo').length, 0, 'Original plain artwork has no added motif');
  assert.ok(motifs.slice(1).every((commands) => commands.some(([command]) => command === 'lineTo')), 'each patterned finish paints shapes');
  assert.ok(motifs[1].some(([command, value]) => command === 'fillStyle' && value === sticker.visual.primary));
  assert.ok(motifs[1].some(([command, value]) => command === 'fillStyle' && value === sticker.visual.secondary));
  assert.ok(motifs[1].some(([command, glyph]) => command === 'fillText' && glyph === '♥'));
  assert.deepEqual(picture('<svg onload=evil>'), motifs[0], 'unknown motifs fall back to plain shapes');
  const hostile = picture('plain', { glyph: '__proto__', primary: 'url(https://invalid.test)' });
  assert.ok(hostile.some(([command, glyph]) => command === 'fillText' && glyph === '✦'));
  assert.ok(hostile.some(([command, color]) => command === 'fillStyle' && color === '#8b7cf6'));
  const cachedCount = encoded.length; picture('stars'); assert.equal(encoded.length, cachedCount, 'duplicate artwork reuses its encoded preview');
  assert.ok(encoded.every((image) => image.width === 96), 'room/book previews use a small fixed raster');
  await e.tab('Sticker book');
  const book = drawings.get(e.root.querySelector('.collectibles-sticker img').src).filter(([command]) => command !== 'scale');
  assert.deepEqual(book, motifs[1], 'book and room helper retain the same saved motif');
  await e.button('Download image').click();
  const exported = encoded.at(-1); assert.equal(exported.type, 'image/png'); assert.equal(exported.width, 512);
  assert.deepEqual(exported.commands.filter(([command]) => command !== 'scale'), book, 'download preserves motif, palette and glyph at export resolution');
  assert.deepEqual(links[0], { href: exported.source, download: 'Star-friend.png' });
  assert.ok(e.calls.every(([action]) => action === 'list'), 'rendering and downloading do not claim or transfer ownership');
  const bundled = e.api.renderSticker({ ...sticker, visual: { asset: 'happy' } });
  assert.equal(bundled.querySelector('img').src, '../assets/stickers/studio-happy.png');
  assert.equal(bundled.querySelector('canvas'), null, 'bundled PNG originals are preserved');
  for (let index = 0; index < 65; index += 1) picture('plain', { primary: `#${index.toString(16).padStart(6, '0')}` });
  const afterEviction = encoded.length; picture('stars');
  assert.equal(encoded.length, afterEviction + 1, 'the bounded cache evicts old artwork rather than retaining every design');
});
