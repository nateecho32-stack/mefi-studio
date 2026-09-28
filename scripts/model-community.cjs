// The community model feed the Void Engine Bot publishes (docs/model-community.md
// is the contract). Pure module: no Electron, no filesystem, no clock reads. The
// one network helper, fetchFeed, takes its fetch from the caller.
//
// Everything in the feed is untrusted text written by strangers. Validation
// keeps only what the contract allows and drops the rest row by row, so one bad
// row never costs the whole feed. What the router may see is narrower still
// (evidenceFor): documented claims that name something specific, observed
// claims at least two members reported, and ratings only where at least three
// carry an evidence note. Opinions and tips are for people, never for routing.
"use strict";

const FEED_URL = "https://nateecho32-stack.github.io/mefi-studio/data/model-community.json";
const FEED_SCHEMA = 1;
const FEED_TIMEOUT_MS = 20000;
const FEED_MAX_BYTES = 1024 * 1024;
const FEED_MAX_AGE_MS = 6 * 3600 * 1000;
const TASK_KINDS = Object.freeze(["planning", "structuring", "coding", "debugging", "writing", "commits", "tests", "setup", "review"]);
const LIMITS = Object.freeze({ models: 400, aliases: 8, claims: 40, tips: 20, documented: 20, probeIdeas: 10, text: 200, name: 80, url: 500, dropped: 50 });
// The router's share of one feed row, per task kind: enough to name what the
// community saw without crowding real candidates out of the judge's budget.
const ROUTING_LIMITS = Object.freeze({ documented: 2, observed: 3, text: 160 });
// Observed claims need this many distinct reporters; ratings need this many
// scores that carry an evidence note (the contract's routing thresholds).
const MIN_REPORTERS = 2;
const MIN_EVIDENCED_RATINGS = 3;
const ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// C0 and C1 controls, DEL, the Unicode line separators, zero-width marks and
// the bidi embeddings, overrides and isolates: a feed string is one line of
// plain text and reads the way it renders.
const CONTROL_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];
const CONTROL_CLASS = `[${CONTROL_RANGES.map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join("")}]`;
const CONTROLS = new RegExp(CONTROL_CLASS, "g");
const HAS_CONTROL = new RegExp(CONTROL_CLASS);

// Studio's provider names and the feed providers they read (the contract's
// mapping). A Studio provider missing here has no provider-scoped match.
const PROVIDER_MAP = Object.freeze({
  opencode: Object.freeze(["opencode-go"]),
  zai: Object.freeze(["zai", "zhipuai"]),
  zen: Object.freeze(["openai"]),
  codex: Object.freeze(["openai"]),
  claude: Object.freeze(["anthropic"]),
});

// Studio's task vocabulary (the ledger's taskType values) and the contract's
// task kinds they read. Explicit on purpose: a task not listed here gets no
// community evidence and no probe prior, never a guess. The routing keys come
// from main.cjs: builder attempts (`coding`, `coding-<intent>`), the planning
// service (`planning-<kind>`), the cluster advisors (`cluster-<role>`), the
// 0.4.0 seats (`seat-<seat>`), the Agent Brain head and setup assist, and the
// probes themselves (`probe-<kind>`). Chat, judge, relevance, ideas, overseer,
// analyzer and the cadence passes are none of the contract's kinds.
const TASK_KIND_MAP = Object.freeze({
  coding: Object.freeze(["coding"]),
  "coding-implement": Object.freeze(["coding"]),
  "coding-document": Object.freeze(["writing"]),
  "coding-analyze": Object.freeze(["review"]),
  // coding-explore is discovery (where does it live, how does it behave): none.
  "planning-interview": Object.freeze(["planning"]),
  "planning-questions": Object.freeze(["planning"]),
  "planning-question": Object.freeze(["planning"]),
  "planning-spec": Object.freeze(["planning"]),
  "planning-explore": Object.freeze(["planning"]),
  "cluster-planner": Object.freeze(["planning"]),
  "cluster-reviewer": Object.freeze(["review"]),
  "seat-lead": Object.freeze(["planning"]),
  "pipeline-draft": Object.freeze(["planning"]),
  "setup-assist": Object.freeze(["setup"]),
});
const WORK_INTENTS = Object.freeze(["implement", "document", "analyze", "explore"]);

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => object(value) && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
const list = (value) => Array.isArray(value) ? value : [];
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const slug = (value) => typeof value === "string" ? value.trim().toLowerCase().slice(0, 48).replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") : "";

/** One line of plain text, or null when it is empty or longer than `max`. */
function plainText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
  return text && text.length <= max ? text : null;
}

/** An https URL without credentials, or null. Nothing here fetches it. */
function httpsUrl(value) {
  if (typeof value !== "string" || !value || value.length > LIMITS.url || HAS_CONTROL.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

function isoTime(value) {
  if (typeof value !== "string" || value.length > 40) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
const day = (value) => typeof value === "string" && DATE.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
// 1-5 with one decimal, as the contract says; anything else is dropped.
function mean(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 5) return null;
  return Math.abs(Math.round(value * 10) - value * 10) < 1e-6 ? Math.round(value * 10) / 10 : null;
}
const kindOf = (value) => TASK_KINDS.includes(value) ? value : null;

function rating(value, { evidence = false } = {}) {
  if (!object(value)) return null;
  const n = count(own(value, "n")), average = mean(own(value, "mean"));
  if (!n || average === null) return null;
  if (!evidence) return { n, mean: average };
  const withEvidence = own(value, "withEvidence") === undefined ? 0 : count(own(value, "withEvidence"));
  return withEvidence === null || withEvidence > n ? null : { n, mean: average, withEvidence };
}

/**
 * Validate a parsed feed. A wrong schema (or no object at all) ignores the
 * whole feed; everything else is dropped row by row, with the reason kept in
 * `dropped` (at most LIMITS.dropped entries; `droppedCount` has the total).
 */
function validateFeed(json) {
  const dropped = [];
  let droppedCount = 0;
  const drop = (where, reason) => {
    droppedCount += 1;
    if (dropped.length < LIMITS.dropped) dropped.push(`${where}: ${reason}`);
  };
  if (!object(json) || own(json, "schema") !== FEED_SCHEMA) {
    drop("feed", object(json) ? "schema is not 1" : "not a JSON object");
    return { ok: false, feed: null, dropped, droppedCount, error: "The community feed is not schema 1." };
  }
  const source = object(own(json, "source")) ? {
    name: plainText(own(json.source, "name"), LIMITS.name),
    kind: slug(own(json.source, "kind")) || null,
    url: httpsUrl(own(json.source, "url")),
  } : null;
  const models = [];
  const keys = new Set();
  const rows = list(own(json, "models"));
  if (!Array.isArray(own(json, "models"))) drop("models", "missing");
  rows.forEach((row, index) => {
    const at = `models[${index}]`;
    if (index >= LIMITS.models) return drop(at, `over the ${LIMITS.models}-row limit`);
    if (!object(row)) return drop(at, "not an object");
    const provider = own(row, "provider"), id = own(row, "id");
    if (typeof provider !== "string" || typeof id !== "string" || !ID.test(provider) || !ID.test(id)) return drop(at, "provider or id breaks the id rule");
    if (own(row, "key") !== `${provider}/${id}`) return drop(at, "key is not provider/id");
    const key = `${provider}/${id}`.toLowerCase();
    if (keys.has(key)) return drop(at, "duplicate key");
    keys.add(key);
    const aliases = [];
    list(own(row, "aliases")).forEach((alias, aliasIndex) => {
      const where = `${at}.aliases[${aliasIndex}]`;
      if (aliasIndex >= LIMITS.aliases) return drop(where, `over the ${LIMITS.aliases}-alias limit`);
      const aliasProvider = own(alias, "provider"), aliasId = own(alias, "id");
      if (typeof aliasProvider !== "string" || typeof aliasId !== "string" || !ID.test(aliasProvider) || !ID.test(aliasId)) return drop(where, "breaks the id rule");
      aliases.push({ provider: aliasProvider, id: aliasId });
    });
    const name = own(row, "name") == null ? null : plainText(own(row, "name"), LIMITS.name);
    if (own(row, "name") != null && name === null) drop(`${at}.name`, "not plain text within 80 characters");
    const ratingsIn = own(row, "ratings");
    const overall = rating(own(ratingsIn, "overall"));
    if (own(ratingsIn, "overall") != null && !overall) drop(`${at}.ratings.overall`, "invalid count or mean");
    const byTask = {};
    const byTaskIn = own(ratingsIn, "byTask");
    if (object(byTaskIn)) {
      for (const kind of Object.keys(byTaskIn)) {
        if (!kindOf(kind)) { drop(`${at}.ratings.byTask`, "unknown task kind"); continue; }
        const value = rating(own(byTaskIn, kind), { evidence: true });
        if (value) byTask[kind] = value; else drop(`${at}.ratings.byTask.${kind}`, "invalid count, mean or evidence count");
      }
    }
    const documented = [];
    list(own(row, "documented")).forEach((entry, entryIndex) => {
      const where = `${at}.documented[${entryIndex}]`;
      if (entryIndex >= LIMITS.documented) return drop(where, `over the ${LIMITS.documented}-entry limit`);
      const taskKind = kindOf(own(entry, "taskKind"));
      const claim = plainText(own(entry, "claim"), LIMITS.text);
      const sourceIn = own(entry, "source");
      const url = httpsUrl(own(sourceIn, "url"));
      const title = plainText(own(sourceIn, "title"), LIMITS.name);
      if (!taskKind) return drop(where, "unknown task kind");
      if (!claim) return drop(where, "claim is not plain text within 200 characters");
      // A documented claim without its https source is not documented.
      if (!url) return drop(where, "source url is not https");
      documented.push({ taskKind, claim, specific: own(entry, "specific") === true, source: { title: title ?? "Release notes", url }, fetchedAt: isoTime(own(entry, "fetchedAt")) });
    });
    const claims = [];
    list(own(row, "claims")).forEach((entry, entryIndex) => {
      const where = `${at}.claims[${entryIndex}]`;
      if (entryIndex >= LIMITS.claims) return drop(where, `over the ${LIMITS.claims}-claim limit`);
      const taskKind = kindOf(own(entry, "taskKind"));
      const polarity = ["strength", "weakness"].includes(own(entry, "polarity")) ? entry.polarity : null;
      const tier = ["observed", "opinion"].includes(own(entry, "tier")) ? entry.tier : null;
      const text = plainText(own(entry, "text"), LIMITS.text);
      const reporters = count(own(entry, "reporters"));
      const withEvidence = own(entry, "withEvidence") === undefined ? 0 : count(own(entry, "withEvidence"));
      if (!taskKind) return drop(where, "unknown task kind");
      if (!polarity || !tier) return drop(where, "invalid polarity or tier");
      if (!text) return drop(where, "text is not plain text within 200 characters");
      if (reporters === null || withEvidence === null || withEvidence > reporters) return drop(where, "invalid reporter counts");
      claims.push({ taskKind, polarity, tier, text, reporters, withEvidence, firstSeen: day(own(entry, "firstSeen")), lastSeen: day(own(entry, "lastSeen")) });
    });
    const tips = [];
    list(own(row, "tips")).forEach((entry, entryIndex) => {
      const where = `${at}.tips[${entryIndex}]`;
      if (entryIndex >= LIMITS.tips) return drop(where, `over the ${LIMITS.tips}-tip limit`);
      const taskKind = kindOf(own(entry, "taskKind"));
      const text = plainText(own(entry, "text"), LIMITS.text);
      const votes = own(entry, "votes") === undefined ? 0 : count(own(entry, "votes"));
      if (!taskKind || !text || votes === null) return drop(where, "invalid task kind, text or votes");
      tips.push({ taskKind, text, votes });
    });
    const probeIdeas = [];
    list(own(row, "probeIdeas")).forEach((entry, entryIndex) => {
      const where = `${at}.probeIdeas[${entryIndex}]`;
      if (entryIndex >= LIMITS.probeIdeas) return drop(where, `over the ${LIMITS.probeIdeas}-idea limit`);
      const taskKind = kindOf(own(entry, "taskKind"));
      const idea = plainText(own(entry, "idea"), LIMITS.text);
      if (!taskKind || !idea) return drop(where, "invalid task kind or idea");
      probeIdeas.push({ taskKind, idea });
    });
    const forumThread = own(row, "forumThread") == null ? null : httpsUrl(own(row, "forumThread"));
    if (own(row, "forumThread") != null && !forumThread) drop(`${at}.forumThread`, "not an https URL");
    models.push({
      key: `${provider}/${id}`, provider, id, name: name ?? id, releaseDate: day(own(row, "releaseDate")), aliases, forumThread,
      ratings: { overall, byTask }, documented, claims, tips, probeIdeas,
    });
  });
  return {
    ok: true,
    feed: { schema: FEED_SCHEMA, generatedAt: isoTime(own(json, "generatedAt")), source, taskKinds: list(own(json, "taskKinds")).filter(kindOf), models },
    dropped, droppedCount,
  };
}

// A Studio model id as the feed spells ids: the routing prefixes Studio adds
// (opencode-go/, mefi-zai/, Zen's opencode/) come off; an OpenRouter-style
// vendor/id keeps its last segment.
function bareModel(model) {
  const text = typeof model === "string" ? model.trim().toLowerCase() : "";
  return text.replace(/^(opencode-go|mefi-zai|opencode|zen)\//, "").split("/").pop();
}

/**
 * Find the feed row for one of Studio's models: by id under a mapped provider
 * first, then by an alias under a mapped provider, then by an id or alias id
 * that exactly one row carries (the same model served by another host).
 * Returns { row, matchedBy } or null.
 */
function matchModel(feed, { provider, model } = {}) {
  const rows = list(feed?.models);
  const id = bareModel(model);
  if (!id || !ID.test(id)) return null;
  const mapped = PROVIDER_MAP[String(provider ?? "").toLowerCase()] ?? [];
  const inMap = (value) => mapped.includes(String(value).toLowerCase());
  const same = (value) => String(value).toLowerCase() === id;
  const byId = rows.find((row) => inMap(row.provider) && same(row.id));
  if (byId) return { row: byId, matchedBy: "id" };
  const byAlias = rows.find((row) => list(row.aliases).some((alias) => inMap(alias.provider) && same(alias.id)));
  if (byAlias) return { row: byAlias, matchedBy: "alias" };
  const anywhere = rows.filter((row) => same(row.id) || list(row.aliases).some((alias) => same(alias.id)));
  return anywhere.length === 1 ? { row: anywhere[0], matchedBy: "id-any-provider" } : null;
}

const shortText = (value) => value.length > ROUTING_LIMITS.text ? `${value.slice(0, ROUTING_LIMITS.text - 3)}...` : value;

/**
 * What the router may see from one feed row for one task kind, or null when
 * nothing qualifies. Opinions and tips never appear here.
 */
function evidenceFor(feedRow, taskKind) {
  if (!object(feedRow) || !kindOf(taskKind)) return null;
  const documented = list(feedRow.documented).filter((entry) => entry?.taskKind === taskKind && entry.specific === true)
    .slice(0, ROUTING_LIMITS.documented).map((entry) => ({ claim: shortText(entry.claim), source: entry.source?.title ?? "Release notes" }));
  const observed = list(feedRow.claims).filter((entry) => entry?.taskKind === taskKind && entry.tier === "observed" && count(entry.reporters) >= MIN_REPORTERS)
    .sort((a, b) => b.reporters - a.reporters || b.withEvidence - a.withEvidence)
    .slice(0, ROUTING_LIMITS.observed).map((entry) => ({ polarity: entry.polarity, text: shortText(entry.text), reporters: entry.reporters, withEvidence: entry.withEvidence }));
  const scored = own(own(feedRow.ratings, "byTask"), taskKind);
  const ratingOk = object(scored) && count(scored.withEvidence) >= MIN_EVIDENCED_RATINGS && mean(scored.mean) !== null;
  const rated = ratingOk ? { n: scored.n, mean: scored.mean, withEvidence: scored.withEvidence } : null;
  return documented.length || observed.length || rated ? { taskKind, documented, observed, rating: rated } : null;
}

/**
 * Studio's task vocabulary to the contract's task kinds. `intent` names the
 * classified work intent when the taskType is the unclassified `coding`.
 * `role` and `weight` never widen the map: the same task kind is routed at
 * every weight. An unmapped task returns [].
 */
function taskKindsFor({ taskType, role = null, weight = null, intent = null } = {}) {
  void role; void weight;
  const key = slug(taskType);
  const probe = /^probe-([a-z]+)$/.exec(key);
  if (probe) return kindOf(probe[1]) ? [probe[1]] : [];
  if (key === "coding" && WORK_INTENTS.includes(intent)) return taskKindsFor({ taskType: `coding-${intent}` });
  return [...(TASK_KIND_MAP[key] ?? [])];
}

/** Every matching kind's evidence for one Studio model, or null. */
function routingEvidence(feed, { provider, model, kinds = [] } = {}) {
  if (!feed || !list(kinds).length) return null;
  const match = matchModel(feed, { provider, model });
  if (!match) return null;
  const byKind = {};
  for (const kind of list(kinds)) {
    const evidence = evidenceFor(match.row, kind);
    if (evidence) byKind[kind] = { documented: evidence.documented, observed: evidence.observed, rating: evidence.rating };
  }
  if (!Object.keys(byKind).length) return null;
  return { source: "community-reports-not-measurements", feedKey: match.row.key, matchedBy: match.matchedBy, kinds: byKind };
}

// Read a response body up to `maxBytes`, cancelling the stream past it.
async function readCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, error: "The community feed is larger than 1 MB." };
  if (!response.body?.getReader) {
    const text = await response.text();
    return Buffer.byteLength(text) > maxBytes ? { ok: false, error: "The community feed is larger than 1 MB." } : { ok: true, text };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, error: "The community feed is larger than 1 MB." };
    }
    chunks.push(Buffer.from(value));
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

/**
 * One GET of the feed: https only (after redirects too), a timeout and a byte
 * cap. Returns { ok, notModified, json, etag } or { ok: false, error }.
 * Never throws.
 */
async function fetchFeed({ fetchImpl, url = FEED_URL, timeoutMs = FEED_TIMEOUT_MS, maxBytes = FEED_MAX_BYTES, etag = null } = {}) {
  if (typeof fetchImpl !== "function") return { ok: false, error: "No fetch is available." };
  if (!httpsUrl(url)) return { ok: false, error: "The community feed URL must be https." };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: "application/json", "user-agent": "mefi-studio (model-community)" };
    if (typeof etag === "string" && etag && etag.length < 200 && !/[\r\n]/.test(etag)) headers["if-none-match"] = etag;
    const response = await fetchImpl(url, { method: "GET", headers, redirect: "follow", signal: controller.signal, credentials: "omit" });
    if (response.url && !httpsUrl(response.url)) return { ok: false, error: "The community feed redirected away from https." };
    if (response.status === 304) return { ok: true, notModified: true, json: null, etag };
    if (response.status === 404) return { ok: false, missing: true, error: "No community feed is published yet." };
    if (!response.ok) return { ok: false, error: `The community feed answered HTTP ${response.status}.` };
    const body = await readCapped(response, maxBytes);
    if (!body.ok) return body;
    let json;
    try { json = JSON.parse(body.text); } catch { return { ok: false, error: "The community feed is not valid JSON." }; }
    const tag = response.headers?.get?.("etag");
    return { ok: true, notModified: false, json, etag: typeof tag === "string" && tag.length < 200 ? tag : null };
  } catch (error) {
    return { ok: false, error: controller.signal.aborted ? "The community feed timed out." : `The community feed could not be read: ${String(error?.message ?? error).slice(0, 120)}` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  FEED_URL, FEED_SCHEMA, FEED_TIMEOUT_MS, FEED_MAX_BYTES, FEED_MAX_AGE_MS, TASK_KINDS, LIMITS, ROUTING_LIMITS, MIN_REPORTERS, MIN_EVIDENCED_RATINGS,
  PROVIDER_MAP, TASK_KIND_MAP,
  plainText, httpsUrl, validateFeed, matchModel, evidenceFor, taskKindsFor, routingEvidence, fetchFeed,
};
