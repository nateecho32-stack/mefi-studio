import assert from 'node:assert/strict';
import test from 'node:test';
import contract from '../scripts/collectibles-contract.cjs';

test('collectible action boundary cannot choose paths, entitlements or minted rarities', () => {
  assert.equal(contract.request('__proto__'), null);
  assert.equal(contract.request('buy', { listingId: '../admin', price: 0 }), null);
  assert.equal(contract.request('updateCreation', { definitionId: 'design', price: 250 }), null);
  assert.equal(contract.request('order', { maxPrice: NaN }), null);
  assert.deepEqual(contract.request('open', { crateId: 'pet', requestId: 'test_123456', price: 20, rarity: 'legendary', ownerId: 'forged' }), {
    method: 'POST', path: '/v1/collectibles/open', body: { crateId: 'pet', requestId: 'test_123456', price: 20 },
  });
  assert.equal(contract.request('stickers', { roomId: 'lobby' }).path, '/v1/rooms/lobby/stickers');
  assert.equal(contract.request('listItem', { instanceId: 'item_example', price: 10 }).path, '/v1/collectibles/listings');
});
