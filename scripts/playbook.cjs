// Playbook: recipes of pipeline shapes that worked (M6 of
// docs/roadmap-0.4.0.md). The archivist files each settled task's pipeline
// here; runs with the same work shape and step signature group into one
// recipe that keeps its runs, verdicts and median time. The head agent picks
// a recipe the way model-routing.mjs picks a builder: a win probability from
// verified outcomes, with bounded exploration, and the owner may pin, rename,
// edit or retire any recipe.
//
// Pure module: no Electron, no filesystem, no clock reads (time is injected),
// no randomness (a caller that wants exploration passes its own random).
// main.cjs keeps data/playbook.json per project.

"use strict";

const { STEP_KINDS, LIMITS, signature: signatureOf } = require("./pipelines.cjs");

const MAX_RECIPES = 60;
const MAX_DURATIONS = 20;
const MAX_NAME = 60;
// A recipe that loses about two runs in three, once it has had a fair try,
// stops being picked: the Beta posterior's mean is under a third.
const FAILING_P = 0.34;
const FAILING_RUNS = 3;
const ACTIONS = ["pin", "unpin", "rename", "retire", "restore", "edit-steps", "delete"];
const MAX_SIGNATURE = 200;
const MAX_READ = 500;

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clip = (value, max) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
const stamp = (value) => Number.isFinite(value) ? value : null;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const word = (value) => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z][a-z-]{0,23}$/.test(text) ? text : null;
};
const shapeOf = (shape) => ({ intent: word(shape?.intent), complexity: word(shape?.complexity) });
const sameShape = (a, b) => a.intent === b.intent && a.complexity === b.complexity;

// FNV-1a: small, stable across runs and machines, and enough to key 60 recipes.
function hash(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}
const recipeId = (shape, signature) => `r_${hash(`${shape.intent ?? ""}|${shape.complexity ?? ""}|${signature}`)}`;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

// Recipe steps as the archivist files them: kinds from the pipeline catalog,
// index parents that point backwards. Returns the clean list or the first
// problem in plain words.
function checkSteps(steps) {
  if (!Array.isArray(steps) || !steps.length || steps.length > LIMITS.maxSteps) {
    return { steps: null, error: `A recipe needs 1 to ${LIMITS.maxSteps} steps.` };
  }
  const clean = [];
  for (const [index, row] of steps.entries()) {
    if (!object(row)) return { steps: null, error: `Step ${index + 1} is not a step.` };
    const kind = typeof row.kind === "string" ? row.kind.trim().toLowerCase() : "";
    if (!Object.prototype.hasOwnProperty.call(STEP_KINDS, kind)) {
      return { steps: null, error: `Step ${index + 1} has an unknown kind "${clip(String(row.kind ?? ""), 40)}".` };
    }
    const parents = row.parents == null ? (index ? [index - 1] : []) : row.parents;
    if (!Array.isArray(parents) || parents.some((value) => !Number.isInteger(value) || value < 0 || value >= index)) {
      return { steps: null, error: `Step ${index + 1} waits on a step that does not come before it.` };
    }
    clean.push({ kind, title: clip(row.title, LIMITS.maxTitle) || STEP_KINDS[kind].label, parents: [...new Set(parents)] });
  }
  return { steps: clean, error: null };
}

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
function defaultName(shape, signature) {
  const bucket = /build\*(1|2-3|4\+)/.exec(signature)?.[1];
  return [
    shape.intent ? capital(shape.intent) : "Any work",
    ...(shape.complexity ? [shape.complexity] : []),
    bucket === "1" ? "1 build" : bucket ? `${bucket} builds` : "no build",
  ].join(" · ").slice(0, MAX_NAME);
}

function normalizeRecipe(raw) {
  if (!object(raw) || typeof raw.id !== "string" || !/^r_[0-9a-z]{1,16}$/.test(raw.id)) return null;
  const { steps } = checkSteps(raw.steps);
  if (!steps) return null;
  const shape = shapeOf(raw.shape);
  const signature = clip(raw.signature, MAX_SIGNATURE) || signatureOf(steps);
  const verified = count(raw.verified), failed = count(raw.failed);
  const durations = (Array.isArray(raw.durations) ? raw.durations : [])
    .filter((value) => Number.isFinite(value) && value >= 0).map(Math.round).slice(-MAX_DURATIONS);
  return {
    id: raw.id, name: clip(raw.name, MAX_NAME) || defaultName(shape, signature), shape, signature, steps,
    runs: Math.max(count(raw.runs), verified + failed), verified, failed, durations, medianMs: median(durations),
    pinned: raw.pinned === true, retired: raw.retired === true,
    createdAt: stamp(raw.createdAt), updatedAt: stamp(raw.updatedAt), lastTaskId: clip(raw.lastTaskId, 200) || null,
  };
}

// Over the cap, the least useful recipe goes: retired before live, fewest
// runs, then the one untouched longest. Pinned ones go only if nothing else
// can, and the recipe just recorded never does.
function evict(recipes, keepId = null) {
  const list = [...recipes];
  const rank = (recipe) => recipe.pinned ? 2 : recipe.retired ? 0 : 1;
  const worse = (a, b) => rank(a) - rank(b) || a.runs - b.runs || (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
  while (list.length > MAX_RECIPES) {
    let victim = -1;
    list.forEach((recipe, index) => {
      if (recipe.id !== keepId && (victim < 0 || worse(recipe, list[victim]) < 0)) victim = index;
    });
    if (victim < 0) break;
    list.splice(victim, 1);
  }
  return list;
}

function emptyPlaybook() {
  return { v: 1, recipes: [] };
}

/** Anything read from disk, made safe: malformed recipes dropped, caps held. */
function normalizePlaybook(raw) {
  const seen = new Set();
  const recipes = [];
  for (const item of (Array.isArray(raw?.recipes) ? raw.recipes : []).slice(0, MAX_READ)) {
    const recipe = normalizeRecipe(item);
    if (!recipe || seen.has(recipe.id)) continue;
    seen.add(recipe.id);
    recipes.push(recipe);
  }
  return { v: 1, recipes: evict(recipes) };
}

/**
 * Files one settled task's pipeline. The recipe is found by work shape and
 * step signature, or made; a verified run adds its time and becomes the
 * recipe's steps, a failed one only counts against it.
 */
function record(playbook, { steps = null, signature = null, shape = null, verdict = null, durationMs = null, taskId = null, now = null, name = null } = {}) {
  const book = normalizePlaybook(playbook);
  if (verdict !== "verified" && verdict !== "failed") return book;
  const clean = checkSteps(steps).steps;
  const key = clip(signature, MAX_SIGNATURE) || (clean ? signatureOf(clean) : "");
  if (!key) return book;
  const kind = shapeOf(shape);
  const won = verdict === "verified";
  const at = stamp(now);
  const spent = won && Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : null;
  const lastTaskId = clip(typeof taskId === "number" ? String(taskId) : taskId, 200) || null;
  // By shape and signature, not by id: an edited recipe keeps its id while its
  // signature moves, and must go on collecting the runs that match it.
  const index = book.recipes.findIndex((recipe) => recipe.signature === key && sameShape(recipe.shape, kind));
  if (index < 0) {
    if (!clean) return book;
    let id = recipeId(kind, key);
    for (let next = 2; book.recipes.some((recipe) => recipe.id === id); next += 1) id = recipeId(kind, `${key}#${next}`);
    const durations = spent === null ? [] : [spent];
    const recipe = {
      id, name: clip(name, MAX_NAME) || defaultName(kind, key), shape: kind, signature: key, steps: clean,
      runs: 1, verified: won ? 1 : 0, failed: won ? 0 : 1, durations, medianMs: median(durations),
      pinned: false, retired: false, createdAt: at, updatedAt: at, lastTaskId,
    };
    return { v: 1, recipes: evict([...book.recipes, recipe], id) };
  }
  const old = book.recipes[index];
  const durations = spent === null ? old.durations : [...old.durations, spent].slice(-MAX_DURATIONS);
  const recipe = {
    ...old, steps: won && clean ? clean : old.steps,
    runs: old.runs + 1, verified: old.verified + (won ? 1 : 0), failed: old.failed + (won ? 0 : 1),
    durations, medianMs: median(durations), updatedAt: at ?? old.updatedAt, lastTaskId: lastTaskId ?? old.lastTaskId,
  };
  return { v: 1, recipes: book.recipes.map((item, position) => position === index ? recipe : item) };
}

/** The posterior mean under a uniform prior: (wins + 1) / (runs + 2). */
function winProbability(recipe) {
  const verified = count(recipe?.verified), failed = count(recipe?.failed);
  return (verified + 1) / (verified + failed + 2);
}

const failing = (recipe) => recipe.runs >= FAILING_RUNS && winProbability(recipe) < FAILING_P;
const better = (a, b) => winProbability(b) - winProbability(a) || b.runs - a.runs || (b.updatedAt ?? 0) - (a.updatedAt ?? 0);

function chooseFrom(list, { random, explore, minRuns }) {
  if (!list.length) return null;
  const pinned = list.filter((recipe) => recipe.pinned).sort(better)[0];
  if (pinned) return { recipe: pinned, p: winProbability(pinned), reason: "pinned" };
  const usable = list.filter((recipe) => !failing(recipe));
  if (!usable.length) return null;
  const fresh = usable.filter((recipe) => recipe.runs < minRuns);
  if (fresh.length && typeof random === "function" && random() < explore) {
    const chosen = [...fresh].sort((a, b) => a.runs - b.runs || better(a, b))[0];
    return { recipe: chosen, p: winProbability(chosen), reason: "explore" };
  }
  const chosen = [...usable].sort(better)[0];
  return { recipe: chosen, p: winProbability(chosen), reason: "best" };
}

/**
 * The recipe a new task of this shape should start from, or null. Recipes of
 * the same intent and complexity are tried before the rest of that intent.
 */
function pick(playbook, shape, { random = null, explore = 0.1, minRuns = 3 } = {}) {
  const book = normalizePlaybook(playbook);
  const kind = shapeOf(shape);
  const live = book.recipes.filter((recipe) => !recipe.retired && recipe.shape.intent === kind.intent);
  const options = { random, explore: Number.isFinite(explore) ? explore : 0.1, minRuns: Number.isFinite(minRuns) ? minRuns : 3 };
  for (const tier of [live.filter((recipe) => recipe.shape.complexity === kind.complexity), live.filter((recipe) => recipe.shape.complexity !== kind.complexity)]) {
    const choice = chooseFrom(tier, options);
    if (choice) return choice;
  }
  return null;
}

/** The owner's edits to one recipe. Refusals say why in plain words. */
function act(playbook, { action = null, id = null, name = null, steps = null } = {}) {
  const book = normalizePlaybook(playbook);
  const refuse = (error) => ({ ok: false, playbook: book, error });
  if (!ACTIONS.includes(action)) {
    return refuse(`A recipe cannot "${clip(String(action ?? ""), 40)}". It can be pinned, unpinned, renamed, retired, restored, edited or deleted.`);
  }
  const index = book.recipes.findIndex((recipe) => recipe.id === id);
  if (index < 0) return refuse("No recipe in this Playbook has that id.");
  const current = book.recipes[index];
  const done = (fields) => ({ ok: true, playbook: { v: 1, recipes: book.recipes.map((recipe, position) => position === index ? { ...recipe, ...fields } : recipe) }, error: null });
  switch (action) {
    // A pinned recipe is one the owner wants used, so pinning brings it back.
    case "pin": return done({ pinned: true, retired: false });
    case "unpin": return done({ pinned: false });
    case "retire": return done({ retired: true, pinned: false });
    case "restore": return done({ retired: false });
    case "rename": {
      const clean = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "";
      if (!clean || clean.length > MAX_NAME) return refuse(`A recipe name needs 1 to ${MAX_NAME} characters.`);
      return done({ name: clean });
    }
    case "edit-steps": {
      const checked = checkSteps(steps);
      if (!checked.steps) return refuse(checked.error);
      const signature = signatureOf(checked.steps);
      if (book.recipes.some((recipe, position) => position !== index && recipe.signature === signature && sameShape(recipe.shape, current.shape))) {
        return refuse("Another recipe for this work shape already has these steps.");
      }
      return done({ steps: checked.steps, signature });
    }
    case "delete":
      return { ok: true, playbook: { v: 1, recipes: book.recipes.filter((_, position) => position !== index) }, error: null };
    default:
      return refuse("That action is not available.");
  }
}

const thicknessOf = (runs) => runs <= 1 ? 1 : runs <= 3 ? 2 : runs <= 7 ? 3 : runs <= 15 ? 4 : 5;

/** The Playbook view's shelf: live recipes first, pinned and most used leading. */
function shelf(playbook) {
  const book = normalizePlaybook(playbook);
  return [...book.recipes]
    .sort((a, b) => Number(a.retired) - Number(b.retired) || Number(b.pinned) - Number(a.pinned) || b.runs - a.runs)
    .map((recipe) => {
      const settled = recipe.verified + recipe.failed;
      const verifiedRate = settled ? Math.round((recipe.verified / settled) * 1000) / 1000 : null;
      const tone = recipe.runs < FAILING_RUNS || verifiedRate === null ? "new"
        : verifiedRate >= 0.75 ? "good" : verifiedRate >= 0.5 ? "mixed" : "poor";
      return {
        id: recipe.id, name: recipe.name, runs: recipe.runs, verifiedRate, medianMs: recipe.medianMs,
        thickness: thicknessOf(recipe.runs), tone, pinned: recipe.pinned, retired: recipe.retired, signature: recipe.signature,
      };
    });
}

module.exports = {
  emptyPlaybook, normalizePlaybook, record, winProbability, pick, act, shelf,
};
