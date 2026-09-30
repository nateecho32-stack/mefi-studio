"use strict";

// Recently deleted: the board's trash. When the owner deletes a task or an idea
// the whole record goes here first, with who deleted it, when, and where it
// sat, so a delete can be undone from a toast at once or from the Recently
// deleted list later. Kept 30 days and at most 50 items, oldest dropped first,
// one list per project.
//
// Pure module: no Electron, no filesystem, no network, no clock reads (time is
// injected). The host (main.cjs "Board trash") owns the file: it reads and
// writes it through the `read` and `write` that `createTrashStore` is given,
// and it keeps a record here BEFORE the board write that removes it, so a
// crash between the two can leave a copy on both sides but never on neither.
//
// A restore puts the record back under its own id at the place it left. It
// never overwrites: when a card with that id is on the board again the restore
// says so and the deleted copy stays here.

const FORMAT = 1;
const KEPT_DAYS = 30;
const KEPT_MS = KEPT_DAYS * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 50;
const KINDS = Object.freeze(["task", "idea"]);
const TITLE_MAX = 120;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => (typeof value === "string" ? value : "");
const clip = (value, max) => {
  const flat = text(value).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};
const firstLine = (value) => text(value).split(/\r?\n/).find((line) => line.trim()) ?? "";

// What the list calls a record: its title, else the first line of its brief.
function titleOf(kind, record) {
  const row = isObject(record) ? record : {};
  const own = kind === "idea" ? row.title || firstLine(row.detail) : row.title || firstLine(row.prompt);
  return clip(own, TITLE_MAX) || (kind === "idea" ? "Untitled idea" : "Untitled task");
}

function empty() {
  return { version: FORMAT, items: [] };
}

// One stored item, or null when it is not one. The title is derived from the
// record, never trusted from the file.
function itemFrom(raw) {
  if (!isObject(raw) || !KINDS.includes(raw.kind) || !isObject(raw.record)) return null;
  const id = text(raw.record.id);
  const deletedAt = Number(raw.deletedAt);
  if (!id || !Number.isFinite(deletedAt) || deletedAt <= 0) return null;
  return {
    kind: raw.kind,
    id,
    title: titleOf(raw.kind, raw.record),
    deletedAt,
    by: clip(raw.by, 40) || "owner",
    via: clip(raw.via, 60),
    index: Number.isInteger(raw.index) && raw.index >= 0 ? raw.index : 0,
    afterId: text(raw.afterId) || null,
    record: raw.record,
  };
}

// Newest first, one item per card (the newest deletion of an id wins), nothing
// older than KEPT_DAYS, at most MAX_ITEMS. `dropped` says what fell out and why,
// so the host can log it; nothing is dropped for any other reason.
function prune(items, now) {
  const ordered = items
    .map((item, at) => ({ item, at }))
    .sort((a, b) => b.item.deletedAt - a.item.deletedAt || a.at - b.at)
    .map((entry) => entry.item);
  const seen = new Set();
  const kept = [];
  const dropped = [];
  for (const item of ordered) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) { dropped.push({ item, why: "replaced" }); continue; }
    seen.add(key);
    if (Number.isFinite(now) && now - item.deletedAt > KEPT_MS) { dropped.push({ item, why: "expired" }); continue; }
    if (kept.length >= MAX_ITEMS) { dropped.push({ item, why: "overflow" }); continue; }
    kept.push(item);
  }
  return { items: kept, dropped };
}

// The stored document (its text or parsed) as a state. Nothing here throws on a
// damaged file: it reads as empty and says `damaged`, so the host can set the
// bytes aside before it writes over them. A document from a NEWER format is the
// one thing that does throw: writing over it would lose what that build kept.
function read(raw, now) {
  let doc = raw;
  if (typeof raw === "string") {
    try { doc = JSON.parse(raw); } catch { return { state: empty(), damaged: raw.trim().length > 0, dropped: [], skipped: 0 }; }
  }
  if (doc === null || doc === undefined) return { state: empty(), damaged: false, dropped: [], skipped: 0 };
  if (isObject(doc) && Number.isInteger(doc.version) && doc.version > FORMAT) throw new Error("Recently deleted was written by a newer Studio. Update Studio before deleting anything.");
  if (!isObject(doc) || doc.version !== FORMAT || !Array.isArray(doc.items)) return { state: empty(), damaged: true, dropped: [], skipped: 0 };
  const items = doc.items.map(itemFrom).filter(Boolean);
  const pruned = prune(items, now);
  return { state: { version: FORMAT, items: pruned.items }, damaged: false, dropped: pruned.dropped, skipped: doc.items.length - items.length };
}

// Keep records that are about to leave the board. Each entry: { kind, record,
// by, via, index, afterId } (see removed()). `kept` are the ones now in the
// list; `dropped` is everything the list lost doing it (an older deletion of
// the same card, expired items, the oldest items past the cap).
function keep(state, entries, now) {
  const added = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const item = itemFrom({ ...(isObject(entry) ? entry : {}), deletedAt: now });
    if (item) added.push(item);
  }
  const pruned = prune([...added, ...(state?.items ?? [])], now);
  return { state: { version: FORMAT, items: pruned.items }, kept: added.filter((item) => pruned.items.includes(item)), dropped: pruned.dropped };
}

function find(state, kind, id) {
  return (state?.items ?? []).find((item) => item.kind === kind && item.id === id) ?? null;
}

function remove(state, kind, id) {
  const item = find(state, kind, id);
  if (!item) return { state, item: null };
  return { state: { version: FORMAT, items: state.items.filter((row) => row !== item) }, item };
}

// The rows a mutation removed: those of `before` whose id is not in `after`,
// each with where it sat (its index and the id of the row before it), ready
// for keep(). Rows without an id are not cards and are never kept here.
function removed(kind, before, after, meta = {}) {
  const now = new Set((Array.isArray(after) ? after : []).map((row) => (isObject(row) ? row.id : undefined)).filter((id) => typeof id === "string" && id));
  const rows = Array.isArray(before) ? before : [];
  const out = [];
  let previous = null;
  rows.forEach((row, index) => {
    const id = isObject(row) ? text(row.id) : "";
    if (!id) return;
    if (!now.has(id)) out.push({ kind, record: row, index, afterId: previous, ...meta });
    previous = id;
  });
  return out;
}

// Put a kept record back into `rows` (the board's tasks or ideas, latest). Its
// place is right after the row that preceded it when that row is still there,
// else the index it had, held inside the list. Refuses when a row with its id
// is there already: the copy here is left alone and the answer says so.
function place(rows, item) {
  const list = Array.isArray(rows) ? rows : [];
  const id = item?.record?.id;
  if (typeof id !== "string" || !id) return { ok: false, error: "That record cannot be put back." };
  if (list.some((row) => isObject(row) && row.id === id)) {
    const where = item.kind === "idea" ? "in your ideas" : "on the board";
    return { ok: false, exists: true, error: `“${item.title || titleOf(item.kind, item.record)}” is already ${where} again, so the deleted copy was not put over it. It stays in Recently deleted.` };
  }
  const after = item.afterId ? list.findIndex((row) => isObject(row) && row.id === item.afterId) : -1;
  const index = after >= 0 ? after + 1 : Math.min(Math.max(0, Number(item.index) || 0), list.length);
  return { ok: true, index, rows: [...list.slice(0, index), item.record, ...list.slice(index)] };
}

// What the "Recently deleted" list shows: the kept items newest first, each
// with when it goes and whether a restore would be refused right now (a card
// with its id is on the board again). `exists(kind, id)` says that; without it
// every item is offered. The records themselves stay on the host side.
function list(state, { now, exists = null, kinds = null } = {}) {
  const wanted = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
  return (state?.items ?? []).filter((item) => !wanted || wanted.has(item.kind)).map((item) => {
    const present = typeof exists === "function" && Boolean(exists(item.kind, item.id));
    return {
      kind: item.kind,
      id: item.id,
      title: item.title,
      status: text(item.record.status) || null,
      deletedAt: item.deletedAt,
      expiresAt: item.deletedAt + KEPT_MS,
      by: item.by,
      via: item.via,
      restorable: !present,
      ...(present ? { reason: "already-there" } : {}),
    };
  });
}

// The file's owner, without the file: `read()` answers the stored document (its
// text, a parsed value, or null when there is none) and `write(document)`
// replaces it atomically; `now()` is the clock. Calls run one at a time, and a
// failed read or write rejects the call, so a caller that keeps a record before
// removing it learns at once that it could not. `setAside(text)`, when given,
// is called with the bytes of a file that could not be read before the next
// write replaces them.
function createTrashStore({ read: readDocument, write: writeDocument, now, setAside = null } = {}) {
  if (typeof readDocument !== "function" || typeof writeDocument !== "function" || typeof now !== "function") throw new TypeError("A trash store needs read, write and now.");
  let chain = Promise.resolve();
  const serial = (task) => {
    const run = chain.then(task, task);
    chain = run.then(() => {}, () => {});
    return run;
  };
  const load = async () => {
    const raw = await readDocument();
    const loaded = read(raw, now());
    return { ...loaded, raw };
  };
  return {
    // Keep `entries` (see removed()). Resolves { kept, dropped } once the
    // write has landed.
    keep: (entries) => serial(async () => {
      const loaded = await load();
      if (loaded.damaged && typeof setAside === "function") await setAside(typeof loaded.raw === "string" ? loaded.raw : JSON.stringify(loaded.raw));
      const out = keep(loaded.state, entries, now());
      if (out.kept.length || out.dropped.length || loaded.dropped.length) await writeDocument(out.state);
      return { kept: out.kept.map(({ record: _record, ...rest }) => rest), dropped: [...loaded.dropped, ...out.dropped].map(({ item, why }) => ({ kind: item.kind, id: item.id, why })) };
    }),
    // The item with its record, or null.
    find: (kind, id) => serial(async () => find((await load()).state, kind, id)),
    // Take one item out (a restore that landed, or the owner's own discard).
    // Resolves the item it removed, or null when it was not there.
    remove: (kind, id) => serial(async () => {
      const loaded = await load();
      const out = remove(loaded.state, kind, id);
      if (out.item) await writeDocument(out.state);
      return out.item;
    }),
    // The list for the page (see list()).
    list: (options = {}) => serial(async () => list((await load()).state, { ...options, now: now() })),
  };
}

module.exports = { FORMAT, KEPT_DAYS, KEPT_MS, MAX_ITEMS, KINDS, titleOf, empty, read, prune, keep, find, remove, removed, place, list, createTrashStore };
