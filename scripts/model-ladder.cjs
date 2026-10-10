"use strict";
// How hard a model thinks, and when a stuck coding job moves to a stronger
// model. The owner's rules: every job starts with light thinking (2026-10-05),
// and a stuck job moves up a model tier first, at the same thinking level
// (2026-10-07). Thinking only goes harder at the top tier, and Max thinking
// waits for the owner unless they turned that ask off.
// When a harder step worked for a kind of job, the next job of that kind
// starts there (learnedStart reads the model ledger's settled attempts).
//
// Four levels, named for people (light, balanced, deep, max), each mapped to
// the word every route takes: Claude Code's --effort, Codex's
// model_reasoning_effort, OpenCode's --variant and the Responses API's
// reasoning.effort. A level a model does not take is fitted to the nearest
// one it does (fitEffort); a model that takes none gets none.
//
// The team's choices live in settings.agentThinking (a team field, so a
// project's own team can differ): mode "auto" | "light" | "balanced" | "deep",
// climb (step up when a job gets stuck), askMax (Max thinking waits for the
// owner) and explore (now and then try a model that has no results for that
// kind of job yet).
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

const LEVELS = Object.freeze(["light", "balanced", "deep", "max"]);
const MODES = Object.freeze(["auto", "light", "balanced", "deep"]);
const LEVEL_EFFORT = Object.freeze({ light: "low", balanced: "medium", deep: "high", max: "max" });
// Every effort word any route takes, weakest first.
const EFFORT_ORDER = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const DEFAULTS = Object.freeze({ mode: "auto", climb: true, askMax: true, explore: true });
// Claude Code 2.1.280's --effort; Haiku takes none. Codex's levels when its
// model cache does not list the model's own (codex models_cache.json lists
// low..max, and ultra for some, per model).
const CLAUDE_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
const CODEX_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh"]);

const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const indexOf = (level) => LEVELS.indexOf(level);

// The team's thinking choices with every default filled in.
function thinking(settings = {}) {
  const raw = record(settings?.agentThinking) ? settings.agentThinking : {};
  return {
    mode: MODES.includes(raw.mode) ? raw.mode : DEFAULTS.mode,
    climb: typeof raw.climb === "boolean" ? raw.climb : DEFAULTS.climb,
    askMax: typeof raw.askMax === "boolean" ? raw.askMax : DEFAULTS.askMax,
    explore: typeof raw.explore === "boolean" ? raw.explore : DEFAULTS.explore,
  };
}
// A saved agentThinking value, as agent-profiles validates a team: null when
// it is fine, otherwise the reason.
function validate(value) {
  if (!record(value)) return "Thinking settings must be an object.";
  for (const key of Object.keys(value)) if (!["mode", "climb", "askMax", "explore"].includes(key)) return `Unknown thinking setting: ${key}`;
  if (value.mode !== undefined && !MODES.includes(value.mode)) return "Thinking is auto, light, balanced or deep.";
  for (const key of ["climb", "askMax", "explore"]) if (value[key] !== undefined && typeof value[key] !== "boolean") return `${key} must be on or off.`;
  return null;
}

// The level an effort word means (and a level is itself).
function levelOf(effort) {
  if (LEVELS.includes(effort)) return effort;
  const at = EFFORT_ORDER.indexOf(effort);
  if (at < 0) return null;
  if (at <= EFFORT_ORDER.indexOf("low")) return "light";
  if (effort === "medium") return "balanced";
  if (effort === "high" || effort === "xhigh") return "deep";
  return "max";
}
const effortOf = (level) => LEVEL_EFFORT[levelOf(level)] ?? null;

// The effort words a coding CLI takes for one model. Codex's list comes from
// its own model cache when the host read one (`codexLevels`: model id ->
// efforts); OpenCode's from `opencode models <provider> --verbose`, whose
// variants differ per model (`opencodeVariants`: "provider/model" -> words).
// An OpenCode model whose variants are unknown gets none: a variant it does
// not have fails the run.
function cliEfforts(cli, model = "", { codexLevels = null, opencodeVariants = null } = {}) {
  const id = String(model ?? "").trim();
  if (cli === "claude") return /haiku/i.test(id) ? [] : [...CLAUDE_EFFORTS];
  if (cli === "codex") {
    const known = record(codexLevels) ? codexLevels[id.toLowerCase().replace(/^openai\//, "")] : null;
    return Array.isArray(known) && known.length ? EFFORT_ORDER.filter((effort) => known.includes(effort)) : [...CODEX_EFFORTS];
  }
  if (cli === "opencode") {
    const known = record(opencodeVariants) ? opencodeVariants[id] : null;
    return Array.isArray(known) ? EFFORT_ORDER.filter((effort) => known.includes(effort)) : [];
  }
  return [];
}

// The effort a route sends for a wanted one: the wanted word when the model
// takes it, else the nearest stronger word it takes (a step up must never
// read as a step down), else its strongest. "ultra" is only ever sent when it
// was asked for by name.
function fitEffort(supported = [], wanted = null) {
  const target = EFFORT_ORDER.includes(wanted) ? wanted : effortOf(wanted);
  if (!target) return null;
  const list = EFFORT_ORDER.filter((effort) => Array.isArray(supported) && supported.includes(effort) && (effort !== "ultra" || target === "ultra"));
  if (!list.length) return null;
  const at = EFFORT_ORDER.indexOf(target);
  return list.find((effort) => EFFORT_ORDER.indexOf(effort) >= at) ?? list[list.length - 1];
}

// The command-line words for an effort on one coding CLI. The effort is one of
// EFFORT_ORDER's fixed words, so nothing here needs quoting through cmd.exe.
function effortArgs(cli, effort) {
  if (!EFFORT_ORDER.includes(effort)) return [];
  if (cli === "claude") return CLAUDE_EFFORTS.includes(effort) ? ["--effort", effort] : [];
  if (cli === "codex") return ["-c", `model_reasoning_effort=${effort}`];
  if (cli === "opencode") return ["--variant", effort];
  return [];
}

// Where a job's thinking starts: the owner's own choice for that seat or
// worker first, then a fixed team mode, then (on Auto) what worked before for
// this kind of job, then light.
function startLevel({ mode = "auto", explicit = null, learned = null } = {}) {
  const own = levelOf(explicit);
  if (own) return { level: own, source: "owner" };
  if (mode !== "auto" && LEVELS.includes(mode)) return { level: mode, source: "team" };
  if (LEVELS.includes(learned) && learned !== "max") return { level: learned, source: "learned" };
  return { level: "light", source: "auto" };
}

// How the next attempt of one coding card runs, from how many of its attempts
// have missed (charged run failures plus failed checks). With "step up" off,
// every retry runs like the first. With it on, a miss moves the card to the
// next model tier up when one exists, at the same thinking level. Only at the
// top tier does Auto think one step harder per miss:
//   misses 0: start level                  1+: stronger model, same level
//   no stronger model left: 1: one step harder, 2: two, 3+: three
//   (Max only when the owner allowed it)
// A fixed team mode keeps its thinking and only moves the model. The card
// itself parks after its fifth charged failure (executor-core
// MAX_RUN_FAILURES), which is where the owner decides about Max or a heavier
// model by hand.
function builderStep({ mode = "auto", climb = true, askMax = true, misses = 0, start = "light", hasStronger = false } = {}) {
  const n = Math.max(0, Math.floor(Number(misses) || 0));
  const base = Math.max(0, indexOf(LEVELS.includes(start) ? start : "light"));
  if (!climb || n === 0) return { level: LEVELS[base], stronger: false, held: null, reason: null };
  // Escalation order (owner, 2026-10-07): a stuck card moves to the next model
  // tier up first, at the same thinking level. Thinking only goes harder once
  // there is no stronger model left to move to.
  const stronger = Boolean(hasStronger);
  const steps = mode !== "auto" || stronger ? 0 : Math.min(n, 3);
  const top = askMax ? indexOf("deep") : indexOf("max");
  const want = base + steps;
  const at = Math.min(want, Math.max(base, top));
  return {
    level: LEVELS[at],
    stronger,
    held: askMax && want > at && want >= indexOf("max") ? "max" : null,
    reason: stronger ? "stronger-model" : at > base ? "thinks-harder" : "retry",
  };
}

// What worked before for one model on one kind of job: the lowest level that
// keeps winning (two wins or more, at least half its settled attempts) when
// every lower level that has a record (three settled or more) mostly lost.
// Null when the record says light is fine or is too thin to say anything.
// Only attempts that name the effort they ran at count; older rows do not.
function learnedStart(observations = [], { provider, model, taskType } = {}, { window = 40 } = {}) {
  const rows = (Array.isArray(observations) ? observations : []).filter((row) => row && row.provider === provider && row.model === model && row.taskType === taskType
    && (row.outcome === "verified" || row.outcome === "failed") && levelOf(row.appliedEffort ?? row.requestedEffort));
  const recent = rows.slice(-Math.max(1, window));
  const tally = new Map(LEVELS.map((level) => [level, { wins: 0, losses: 0 }]));
  for (const row of recent) {
    const entry = tally.get(levelOf(row.appliedEffort ?? row.requestedEffort));
    if (row.outcome === "verified") entry.wins += 1; else entry.losses += 1;
  }
  let lowerFailed = false;
  for (const level of ["light", "balanced", "deep"]) {
    const { wins, losses } = tally.get(level);
    const settled = wins + losses;
    if (lowerFailed && wins >= 2 && wins / settled >= 0.5) return level;
    if (settled >= 3) {
      if (wins / settled >= 0.34) return null;
      lowerFailed = true;
    }
  }
  return null;
}

// The model a missed card stays on: the model its last attempt ran on, when the
// same CLI runs this attempt. Null when nothing needs pinning (no miss yet, the
// owner picked the model, another CLI runs it, or it already runs on that model).
function keptModel({ lastModel = "", lastCli = "", cli = "", currentModel = "", missed = false, ownerPick = false } = {}) {
  if (!missed || ownerPick || !lastModel || !lastCli || lastCli !== cli || currentModel === lastModel) return null;
  return lastModel;
}

// A stronger model in the same family, for a builder whose Heavy tier names
// nothing better: OpenCode Go's flash models step up to their full siblings,
// and Claude Code's aliases step up one size. Anything else has no built-in
// step; the owner's Heavy tier (Team › More settings) names one.
const STRONGER = Object.freeze({
  "opencode-go/deepseek-v4.1-flash": "opencode-go/deepseek-v4-pro",
  "opencode-go/deepseek-v4-flash": "opencode-go/deepseek-v4-pro",
  "opencode-go/glm-5.3-flash": "opencode-go/glm-5.3",
  haiku: "sonnet",
  sonnet: "opus",
});
function strongerSibling(model) {
  const id = String(model ?? "").trim().toLowerCase();
  return STRONGER[id] ?? null;
}

// `opencode models <provider> --verbose` prints each model's id on a line of
// its own, then its JSON; the JSON's `variants` keys are the reasoning words
// that model takes. Returns "provider/model" -> words; a model whose JSON does
// not parse is left out (unknown), one with no variants maps to [].
const OPENCODE_ID = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9~][A-Za-z0-9._:/~-]*$/;
function parseOpencodeModels(text) {
  const out = {};
  const lines = String(text ?? "").replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "").split(/\r?\n/);
  let id = null, body = [];
  const flush = () => {
    if (!id) return;
    try {
      const parsed = JSON.parse(body.join("\n"));
      out[id] = Object.keys(record(parsed?.variants) ? parsed.variants : {}).filter((word) => EFFORT_ORDER.includes(word));
    } catch { /* not this model's JSON: unknown, so no variant is sent */ }
  };
  for (const line of lines) {
    if (!/^\s/.test(line) && OPENCODE_ID.test(line.trim())) { flush(); id = line.trim(); body = []; }
    else if (id) body.push(line);
  }
  flush();
  return out;
}
// Codex's model cache (CODEX_HOME/models_cache.json) as model id -> the
// effort words it lists for that model.
function codexLevelsFrom(document) {
  const list = Array.isArray(document?.models) ? document.models : Array.isArray(document?.data) ? document.data : Array.isArray(document) ? document : [];
  const out = {};
  for (const model of list) {
    const id = String(model?.slug ?? model?.id ?? "").trim().toLowerCase();
    const levels = Array.isArray(model?.supported_reasoning_levels) ? model.supported_reasoning_levels.map((level) => level?.effort ?? level).filter((word) => EFFORT_ORDER.includes(word)) : [];
    if (id && levels.length) out[id] = levels;
  }
  return out;
}

// Plain words for a level, as the Team page and the attempt's label say it.
const WORDS = Object.freeze({ light: "light thinking", balanced: "balanced thinking", deep: "deep thinking", max: "max thinking" });
const wordsFor = (level) => WORDS[levelOf(level)] ?? "the model's own thinking";

module.exports = {
  LEVELS, MODES, LEVEL_EFFORT, EFFORT_ORDER, DEFAULTS, CLAUDE_EFFORTS, CODEX_EFFORTS,
  thinking, validate, levelOf, effortOf, cliEfforts, fitEffort, effortArgs, startLevel, builderStep, learnedStart, keptModel, strongerSibling, parseOpencodeModels, codexLevelsFrom, wordsFor,
};
