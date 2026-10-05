"use strict";
// Which model does which kind of coding job, from the record. The report card
// reads the attempts Studio checked on this PC (verified wins and failed
// checks, per model and per kind of job: coding-implement, coding-explore...)
// and gives each a plain verdict. A weak kind of job gets a suggestion: a model
// with a good record on it, or one Studio can run that has none yet. Trying a
// suggestion sends the next few jobs of that kind to that model (a trial);
// once they are checked, Studio keeps the model for that kind of job only if
// it did clearly better, and otherwise sends the kind back to the usual model.
//
// The routes live in the team's settings.agentKinds:
//   { "coding-explore": { cli, model, by: "owner" | "studio",
//       trial: { size, from, baseline: { wins, losses } } | null,
//       kept: { at, wins, losses } | null } }
// main.cjs's "Which model does which kind of job" block reads the ledgers,
// routes a job by its kind and writes the decisions.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

const MIN_VERDICT = 5;       // checked attempts before a verdict
const MIN_SUGGEST = 8;       // checked attempts before a weak kind gets a suggestion
const TRIAL_SIZE = 5;        // jobs a trial sends to the new model
const CLIS = Object.freeze(["opencode", "claude", "codex", "grok", "antigravity"]);
const KIND = /^coding(?:-[a-z]{1,24})?$/;

const KIND_WORDS = Object.freeze({
  coding: "General coding",
  "coding-implement": "Building features",
  "coding-build": "Building",
  "coding-explore": "Exploring a codebase",
  "coding-analyze": "Analysing code",
  "coding-document": "Writing docs",
  "coding-fix": "Fixing bugs",
  "coding-debug": "Fixing bugs",
  "coding-test": "Writing tests",
  "coding-refactor": "Tidying code",
  "coding-review": "Reviewing code",
  "coding-design": "Design work",
  "coding-plan": "Planning",
});
function kindLabel(taskType) {
  const key = String(taskType ?? "");
  if (KIND_WORDS[key]) return KIND_WORDS[key];
  const intent = key.replace(/^coding-?/, "");
  return intent ? `${intent[0].toUpperCase()}${intent.slice(1)} jobs` : "General coding";
}

// Readable names for the models the ledger files. The ledger names a Go model
// by its bare roster id and a z.ai model without its prefix.
const NAMES = Object.freeze({
  "opus": "Opus", "sonnet": "Sonnet", "haiku": "Haiku",
  "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-haiku-4-5": "Haiku 4.5", "claude-fable-5-1": "Fable 5.1",
  "gpt-6-luna": "GPT-6 Luna", "gpt-6-sol": "GPT-6 Sol", "gpt-6.1-sol": "GPT-6.1 Sol",
  "deepseek-v4.1-flash": "DeepSeek V4.1 Flash", "deepseek-v4-flash": "DeepSeek V4 Flash", "deepseek-v4-pro": "DeepSeek V4 Pro",
  "glm-5.3": "GLM-5.3", "glm-5.3-flash": "GLM-5.3 Flash", "glm-5.2": "GLM-5.2",
});
function modelName(model, provider = "") {
  const raw = String(model ?? "").trim();
  const id = raw.replace(/^(?:opencode-go|mefi-zai|opencode|openai|anthropic)\//, "").toLowerCase();
  if (!id || /-default$/.test(id)) return provider ? `${providerName(provider)}'s default` : "Default model";
  if (NAMES[id]) return NAMES[id];
  return id.split(/[-_]/).filter(Boolean).map((part) => /^v?\d/.test(part) ? part.replace(/^v/, "V") : part[0].toUpperCase() + part.slice(1)).join(" ");
}
const PROVIDER_WORDS = Object.freeze({ opencode: "OpenCode", claude: "Claude Code", codex: "Codex", grok: "Grok", antigravity: "Antigravity", zai: "z.ai", zen: "OpenCode Zen", openrouter: "OpenRouter", chatgpt: "ChatGPT plan" });
const providerName = (provider) => PROVIDER_WORDS[provider] ?? String(provider ?? "");

function verdictOf(wins, losses) {
  const settled = wins + losses;
  if (settled < MIN_VERDICT) return "few";
  const rate = wins / settled;
  return rate >= 0.6 ? "good" : rate >= 0.4 ? "ok" : "weak";
}
const isCheckedAttempt = (row) => row && (row.source === "worker" || row.outcome) && (row.outcome === "verified" || row.outcome === "failed") && KIND.test(String(row.taskType ?? ""));

// Every checked coding attempt once, from every ledger on this PC (the same
// row can sit in the legacy shared ledger and a project's).
function uniqueAttempts(rows) {
  const seen = new Set(), out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isCheckedAttempt(row)) continue;
    const id = String(row.id ?? "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(row);
  }
  return out.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
}

// The report card: per model, per kind of job, wins and losses with a verdict,
// models with the most checked work first and each one's kinds best first.
function reportCard(rows) {
  const attempts = uniqueAttempts(rows);
  const models = new Map();
  for (const row of attempts) {
    const key = `${row.provider}::${row.model}`;
    if (!models.has(key)) models.set(key, { key, provider: row.provider, model: row.model, name: modelName(row.model, row.provider), wins: 0, losses: 0, kinds: new Map() });
    const entry = models.get(key);
    const kind = entry.kinds.get(row.taskType) ?? { taskType: row.taskType, label: kindLabel(row.taskType), wins: 0, losses: 0 };
    if (row.outcome === "verified") { entry.wins += 1; kind.wins += 1; } else { entry.losses += 1; kind.losses += 1; }
    entry.kinds.set(row.taskType, kind);
  }
  const rank = { good: 0, ok: 1, weak: 2, few: 3 };
  const list = [...models.values()].map((entry) => {
    const settled = entry.wins + entry.losses;
    const kinds = [...entry.kinds.values()].map((kind) => {
      const total = kind.wins + kind.losses;
      return { ...kind, settled: total, rate: total ? kind.wins / total : null, verdict: verdictOf(kind.wins, kind.losses) };
    }).sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.rate ?? -1) - (a.rate ?? -1) || b.settled - a.settled);
    return { key: entry.key, provider: entry.provider, model: entry.model, name: entry.name, wins: entry.wins, losses: entry.losses, settled, rate: settled ? entry.wins / settled : null, kinds };
  }).sort((a, b) => b.settled - a.settled || a.key.localeCompare(b.key));
  return { checked: attempts.length, from: attempts[0]?.at ?? null, to: attempts.at(-1)?.at ?? null, models: list };
}

// The moves the record suggests for the coding worker as it is now
// (`builder`: the provider and model the ledger files its runs under). For each
// kind of job it is weak at, with enough checked work to say so: a model that
// has a good record on that kind, else the first model Studio can run that has
// no record on it (`available`: [{ cli, model, provider, ledgerModel }], best
// first), so a trial finds out. Kinds already routed or on trial are left out.
function suggestions(card, { builder = null, available = [], routes = {} } = {}) {
  if (!builder) return [];
  const mine = card.models.find((entry) => entry.provider === builder.provider && entry.model === builder.model);
  if (!mine) return [];
  const out = [];
  for (const kind of mine.kinds) {
    if (kind.verdict !== "weak" || kind.settled < MIN_SUGGEST || routes?.[kind.taskType]) continue;
    const proven = card.models
      .filter((entry) => entry.key !== mine.key)
      .map((entry) => ({ entry, kind: entry.kinds.find((item) => item.taskType === kind.taskType) }))
      .filter(({ kind: other }) => other && other.verdict === "good")
      .sort((a, b) => b.kind.rate - a.kind.rate)
      .find(({ entry }) => available.some((option) => option.provider === entry.provider && option.ledgerModel === entry.model));
    const option = proven
      ? available.find((item) => item.provider === proven.entry.provider && item.ledgerModel === proven.entry.model)
      : available.find((item) => !(item.provider === builder.provider && item.ledgerModel === builder.model)
        && !card.models.some((entry) => entry.provider === item.provider && entry.model === item.ledgerModel && entry.kinds.some((other) => other.taskType === kind.taskType && other.settled >= MIN_VERDICT)));
    if (!option) continue;
    const to = { cli: option.cli, model: option.model, name: modelName(option.ledgerModel || option.model, option.provider) };
    const pct = Math.round(kind.rate * 100);
    out.push({
      id: `${kind.taskType}:${option.cli}:${option.model}`,
      taskType: kind.taskType, label: kind.label, to,
      text: `Send ${kind.label.toLowerCase()} jobs to ${to.name}${option.cli !== "opencode" ? ` on ${providerName(option.cli)}` : ""}.`,
      detail: proven
        ? `${mine.name} passes ${kind.wins} of ${kind.settled} of them (${pct}%); ${to.name} passed ${proven.kind.wins} of ${proven.kind.settled}. Studio tries it on the next ${TRIAL_SIZE} and keeps it only if it does better.`
        : `${mine.name} passes ${kind.wins} of ${kind.settled} of them (${pct}%). ${to.name} has no results on them yet, so Studio tries it on the next ${TRIAL_SIZE} and keeps it only if it does better.`,
    });
  }
  return out;
}

// One kind's route as the team saved it, cleaned; null when it is not usable.
function routeOf(value) {
  if (!value || typeof value !== "object" || !CLIS.includes(value.cli)) return null;
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (model && !/^[A-Za-z0-9 ._()/:-]{1,120}$/.test(model)) return null;
  const trial = value.trial && typeof value.trial === "object" ? {
    size: Math.max(1, Math.min(20, Math.floor(Number(value.trial.size) || TRIAL_SIZE))),
    from: Number(value.trial.from) || 0,
    baseline: { wins: Math.max(0, Math.floor(Number(value.trial.baseline?.wins) || 0)), losses: Math.max(0, Math.floor(Number(value.trial.baseline?.losses) || 0)) },
  } : null;
  const kept = value.kept && typeof value.kept === "object" ? { at: Number(value.kept.at) || 0, wins: Math.max(0, Math.floor(Number(value.kept.wins) || 0)), losses: Math.max(0, Math.floor(Number(value.kept.losses) || 0)) } : null;
  return { cli: value.cli, model, by: value.by === "studio" ? "studio" : "owner", trial, kept };
}
// A saved agentKinds value, as agent-profiles validates a team.
function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Kind routes must be an object.";
  const entries = Object.entries(value);
  if (entries.length > 16) return "Too many kind routes.";
  for (const [kind, route] of entries) {
    if (!KIND.test(kind)) return `Unknown kind of job: ${kind}`;
    if (!routeOf(route)) return `The route for ${kindLabel(kind).toLowerCase()} is not usable.`;
  }
  return null;
}

// How a trial stands: the checked attempts of this kind on the trial's model
// since it started. Done once `size` are checked; kept when the model passed
// at least half and clearly more often than the usual model had (the baseline
// at the start), with one win to spare on a small record.
// `provider` and `model` are how the ledger files the trial model's runs.
function trialState(route, rows, { taskType, provider, model } = {}) {
  const clean = routeOf(route);
  if (!clean?.trial) return null;
  let wins = 0, losses = 0;
  for (const row of uniqueAttempts(rows)) {
    if (row.taskType !== taskType || row.provider !== provider || row.model !== model || (Number(row.at) || 0) < clean.trial.from) continue;
    if (row.outcome === "verified") wins += 1; else losses += 1;
  }
  const settled = wins + losses;
  const before = clean.trial.baseline.wins + clean.trial.baseline.losses;
  const baseRate = before ? clean.trial.baseline.wins / before : 0.5;
  const rate = settled ? wins / settled : 0;
  const done = settled >= clean.trial.size;
  return { size: clean.trial.size, wins, losses, left: Math.max(0, clean.trial.size - settled), done, keep: done && rate >= 0.5 && rate >= baseRate + 0.15 };
}

// Whether Studio should start a trial on its own for this kind of job: the
// owner lets it try other models, it picks models by itself, the usual model is
// clearly weak there (ten checked or more, under a third passed), nothing is
// routed for that kind yet, and no other trial Studio started is running.
function autoTrialFor({ kind, card, builder, routes = {}, explore = true, selection = "jev", available = [] }) {
  if (!explore || selection === "fixed" || routes?.[kind]) return null;
  if (Object.values(routes || {}).some((route) => routeOf(route)?.by === "studio" && routeOf(route)?.trial)) return null;
  const suggestion = suggestions(card, { builder, available, routes }).find((item) => item.taskType === kind);
  if (!suggestion) return null;
  const mine = card.models.find((entry) => entry.provider === builder.provider && entry.model === builder.model);
  const record = mine?.kinds.find((item) => item.taskType === kind);
  if (!record || record.settled < 10 || record.rate >= 1 / 3) return null;
  return suggestion;
}

module.exports = { MIN_VERDICT, MIN_SUGGEST, TRIAL_SIZE, kindLabel, modelName, providerName, verdictOf, uniqueAttempts, reportCard, suggestions, routeOf, validate, trialState, autoTrialFor };
