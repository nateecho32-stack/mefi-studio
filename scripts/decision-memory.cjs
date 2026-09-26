// Recency-weighted owner preferences; automatic choices never teach themselves.
// Pure module: no Electron, no filesystem, no network, no clock reads.
"use strict";
const SCOPES = Object.freeze(["blend", "project", "global"]);
const HALF_LIFE = 90 * 86400000;
const rows = (value) => Array.isArray(value) ? value : [];
const word = (value) => typeof value === "string" ? value.trim().slice(0, 80) : "";
function settings(value = {}) {
  return { decisions: { enabled: value.decisions?.enabled !== false, scope: SCOPES.includes(value.decisions?.scope) ? value.decisions.scope : "blend" },
    models: SCOPES.includes(value.models) || value.models === "off" ? value.models : "blend" };
}
function normalize(input) {
  return rows(input).filter((row) => row && word(row.kind) && word(row.verb) && Number.isFinite(row.at)).slice(-1000).map((row) => ({
    projectId: word(row.projectId) || null, at: row.at, kind: word(row.kind), verb: word(row.verb), source: word(row.source) || null,
    taskKind: word(row.taskKind) || null, ...(row.correction?.was ? { correction: { was: word(row.correction.was) } } : {}),
  }));
}
function profile({ rows: input = [], projectId = null, scope = "blend", now = null } = {}) {
  if (!SCOPES.includes(scope)) scope = "blend";
  const history = normalize(input), latest = now ?? Math.max(0, ...history.map((row) => row.at));
  const groups = new Map();
  for (const row of history) {
    const local = Boolean(projectId && row.projectId === projectId);
    if (scope === "project" && !local) continue;
    const weight = (scope === "blend" && !local ? 0.3 : 1) * Math.pow(0.5, Math.max(0, latest - row.at) / HALF_LIFE);
    if (!groups.has(row.kind)) groups.set(row.kind, { kind: row.kind, scope, n: 0, weights: new Map(), counts: new Map() });
    const group = groups.get(row.kind);
    const add = (verb, value) => group.weights.set(verb, (group.weights.get(verb) ?? 0) + value);
    if (row.verb === "undo" && row.correction?.was) { add(row.correction.was, -2 * weight); continue; }
    group.n++;
    group.counts.set(row.verb, (group.counts.get(row.verb) ?? 0) + 1);
    add(row.verb, weight * (row.correction ? 2 : 1));
  }
  return [...groups.values()].map(({ weights, counts, ...group }) => {
    const entries = [...weights].map(([verb, weight]) => ({ verb, weight: Math.max(0, weight), count: counts.get(verb) ?? 0 })).filter((row) => row.weight > 0);
    const total = entries.reduce((sum, row) => sum + row.weight, 0);
    return { ...group, total, verbs: entries.map((row) => ({ ...row, share: row.weight / total })).sort((a, b) => b.share - a.share || a.verb.localeCompare(b.verb)) };
  }).filter((group) => group.verbs.length).sort((a, b) => b.n - a.n || a.kind.localeCompare(b.kind));
}
const verbOf = (option) => option?.action?.action ?? option?.action?.choice ?? option?.id;
function advise(kind, options, preferences) {
  const group = rows(preferences).find((row) => row.kind === kind);
  const best = group?.verbs[0];
  if (!best || !rows(options).some((option) => verbOf(option) === best.verb)) return null;
  return { verb: best.verb, share: best.share, n: group.n, count: best.count, scope: group.scope };
}
function confidence(value, option, learned) {
  const current = Math.max(0, Math.min(1, Number(value) || 0));
  return learned?.share >= 0.7 && learned.n >= 4 && verbOf(option) === learned.verb ? Math.min(1, current + 0.15) : current;
}
function forget(input, { projectId = null, scope = "project", kind = null, verb = null, all = false } = {}) {
  return normalize(input).filter((row) => {
    const inScope = scope === "global" || Boolean(projectId && row.projectId === projectId);
    if (!inScope) return true;
    return !(all || row.kind === kind && (!verb || row.verb === verb || row.correction?.was === verb));
  });
}
module.exports = { SCOPES, HALF_LIFE, settings, normalize, profile, advise, confidence, forget, verbOf };
