"use strict";
// Process-local metadata only. No record contents, paths, errors or disk writes.
const CHANNELS = Object.freeze(["executor", "work-events"]);
const MAX_COUNT = 1000000;
function createHealth({ now = Date.now, maxCount = MAX_COUNT } = {}) {
  const cap = Number.isSafeInteger(maxCount) && maxCount > 0 ? Math.min(maxCount, MAX_COUNT) : MAX_COUNT;
  const rows = new Map(CHANNELS.map(channel => [channel, { channel, count: 0, lastFailureAt: null }]));
  function failure(channel) {
    const row = rows.get(channel);
    if (!row) return;
    row.count = Math.min(cap, row.count + 1);
    try { const at = now(); if (Number.isFinite(at) && at > 0) row.lastFailureAt = at; } catch {}
  }
  return { failure, snapshot: () => CHANNELS.map(channel => ({ ...rows.get(channel) })) };
}
const health = createHealth();
module.exports = { CHANNELS, MAX_COUNT, createHealth, ...health };
