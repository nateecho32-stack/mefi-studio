"use strict";
// Account-scoped local chat. Legacy bytes are never assigned to a guessed owner.
// A queued write captures the old actor's path and snapshot before switching.
const { createHash } = require("node:crypto");
const { ACTOR_PROTOCOL, actorId, isDiscordSubject } = require("./actor-contract.cjs");
function scopeOf(identity) {
  if (!identity) return null;
  if (identity.actorProtocol === ACTOR_PROTOCOL && actorId(identity.id)) return "actor-" + createHash("sha256").update(identity.id).digest("hex");
  return identity.actorProtocol == null && isDiscordSubject(identity.id) ? "legacy" : null;
}
const fileName = (scope) => scope === "legacy" ? "room-history.json" : typeof scope === "string" && /^actor-[a-f0-9]{64}$/.test(scope) ? "room-history-" + scope + ".json" : null;
function createHistoryScopes({ create, load, save, onError = () => {} }) {
  let active = null, revision = 0;
  const pending = new Map(), writes = new Map();
  function persist() {
    if (!active || !active.store.takeDirty()) return Promise.resolve();
    const scope = active.scope, snapshot = JSON.parse(JSON.stringify(active.store.dump()));
    pending.set(scope, snapshot);
    const operation = (writes.get(scope) ?? Promise.resolve()).catch(() => {}).then(() => save(fileName(scope), snapshot));
    writes.set(scope, operation);
    operation.then(() => { if (pending.get(scope) === snapshot) pending.delete(scope); }, () => { try { onError(); } catch {} })
      .finally(() => { if (writes.get(scope) === operation) writes.delete(scope); });
    return operation.catch(() => {});
  }
  function select(identity) {
    const scope = scopeOf(identity);
    if (scope === (active?.scope ?? null)) return;
    void persist(); revision++;
    active = scope ? { scope, store: create() } : null;
    if (active) {
      try { const data = pending.get(scope) ?? load(fileName(scope)); if (data) active.store.load(data); } catch { /* Unreadable history stays preserved on disk. */ }
    }
  }
  return Object.freeze({ select, persist, current: () => active?.store ?? null, token: () => revision, isCurrent: (token) => token === revision,
    flush: async () => { await persist(); await Promise.allSettled([...writes.values()]); } });
}
module.exports = { scopeOf, fileName, createHistoryScopes };