"use strict";

// Your PCs vault shelves: what each shelf offers from this PC's stores, and
// what a received item may do here. Pure: main.cjs's "Your PCs vault" block
// reads the stores and carries out the plan; this module only shapes values.
//
// Nothing leaves without the owner choosing it (pc-vault.cjs seals, and
// share-review.cjs scrubs and checks, every item), and nothing received
// overwrites anything here:
// - insights and learned join this PC's learning at read time, as another
//   PC's evidence (modelLearning.aggregate, decisionMemory at the 0.3 weight
//   other projects get), and stop counting when the owner removes them;
// - brains, presets and recipes are added beside the owner's own under a
//   name that says where they came from;
// - Claude Code memory notes are written only where no note has that name;
// - ideas are added as new ideas, which never start work by themselves;
// - preferences are applied only when the owner asks, and only the portable
//   fields below.
// Project shelves are keyed by the GitHub repository, since a project's id
// is a hash of its folder and differs from PC to PC.
// Guarded by tests/vault_shelves.test.mjs.
const crypto = require("node:crypto");

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const PROJECT_SHELVES = Object.freeze(["brains", "recipes", "claude-memory", "work"]);
// Preferences that mean the same on every PC. Endpoints, windows, the
// machine block, the community link, sharing rules and every key stay here.
const SETTINGS_FIELDS = Object.freeze([
  "learning", "agentHabits", "agentEfforts", "agentSubtasks", "autonomy",
  "aiProvider", "aiRoleProviders", "aiModels", "aiModelsByProvider", "modelSelection",
  "aiSubscriptionFirst", "aiFallbackOpenCode", "aiAutoFallback",
  "executorCli", "executorModel", "executorModels", "executorTier", "executorTierModels",
]);
const MAX_ITEMS = 200;
const LIBRARY_MAX = 400;

const text = (value, max = 200) => (typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const count = (value) => Math.max(0, Math.floor(Number(value) || 0));
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const safeId = (value) => text(String(value ?? ""), 60).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
// A short, stable stand-in for owner/name that fits an item id.
const repoKey = (repo) => crypto.createHash("sha256").update(String(repo).toLowerCase()).digest("hex").slice(0, 10);
const itemId = (repo, kind, local) => `${repoKey(repo)}-${kind}-${safeId(local)}`.slice(0, 80);

// ---- what this PC offers ------------------------------------------------

// Wins and losses per model and kind of task, nothing else: no prompts, no
// task names, no timings tied to a project.
function insights(aggregate) {
  const models = (Array.isArray(aggregate?.models) ? aggregate.models : []).map((row) => ({
    provider: text(row?.provider, 60), model: text(row?.model, 120), wins: count(row?.wins), losses: count(row?.losses),
    taskStrengths: (Array.isArray(row?.taskStrengths) ? row.taskStrengths : []).map((task) => ({ taskType: text(task?.taskType, 60), wins: count(task?.wins), losses: count(task?.losses) }))
      .filter((task) => task.taskType && task.wins + task.losses > 0),
  })).filter((row) => row.provider && row.model && row.wins + row.losses > 0);
  return models.length ? [{ id: "models", title: `How ${models.length} model${models.length === 1 ? "" : "s"} did on this PC`, value: { models } }] : [];
}

// The owner's choices by kind, without the project they were made in.
function learned(rows) {
  const decisions = (Array.isArray(rows) ? rows : []).filter((row) => row && text(row.kind, 80) && text(row.verb, 80) && Number.isFinite(row.at)).slice(-1000)
    .map((row) => ({ at: row.at, kind: text(row.kind, 80), verb: text(row.verb, 80), ...(text(row.taskKind, 80) ? { taskKind: text(row.taskKind, 80) } : {}), ...(text(row.correction?.was, 80) ? { correction: { was: text(row.correction.was, 80) } } : {}) }));
  return decisions.length ? [{ id: "decisions", title: `${decisions.length} of your decisions`, value: { decisions } }] : [];
}

function presets(teams) {
  return (Array.isArray(teams?.presets) ? teams.presets : []).slice(0, MAX_ITEMS).filter((preset) => text(preset?.name, 80) && preset?.configuration && typeof preset.configuration === "object")
    .map((preset) => ({ id: `preset-${safeId(preset.id ?? preset.name)}`, title: text(preset.name, 80), value: { name: text(preset.name, 80), configuration: plain(preset.configuration) } }));
}

function brains(maps, repo) {
  if (!REPO.test(String(repo ?? ""))) return [];
  return (Array.isArray(maps) ? maps : []).filter((map) => map && !map.builtIn && Array.isArray(map.nodes) && map.nodes.length).slice(0, MAX_ITEMS)
    .map((map) => {
      const { active, builtIn, updatedAt, ...rest } = plain(map);
      return { id: itemId(repo, "brain", map.id), title: text(map.name, 80) || "Brain map", value: { repo, map: rest } };
    });
}

function recipes(list, repo) {
  if (!REPO.test(String(repo ?? ""))) return [];
  return (Array.isArray(list) ? list : []).filter((recipe) => recipe && !recipe.retired && Array.isArray(recipe.steps) && recipe.steps.length).slice(0, MAX_ITEMS)
    .map((recipe) => ({ id: itemId(repo, "recipe", recipe.id), title: text(recipe.name, 80) || "Recipe", value: { repo, recipe: {
      name: text(recipe.name, 80), shape: plain(recipe.shape), signature: text(recipe.signature, 400), steps: plain(recipe.steps),
      runs: count(recipe.runs), verified: count(recipe.verified), failed: count(recipe.failed), medianMs: Number.isFinite(recipe.medianMs) ? recipe.medianMs : null,
    } } }));
}

// Claude Code memory notes: `name.md` with front matter. The session id and
// timestamps are this PC's and stay here.
function memoryNote(raw) {
  const source = String(raw ?? "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source);
  const head = match ? match[1] : "", body = (match ? match[2] : source).trim();
  const field = (name) => { const found = new RegExp(`^${name}:\\s*(.*)$`, "m").exec(head); return found ? found[1].trim().replace(/^"(.*)"$/, "$1") : ""; };
  return { name: text(field("name"), 80), description: text(field("description"), 300), body: body.slice(0, 20000) };
}
function memoryText(note) {
  const quote = (value) => JSON.stringify(String(value ?? ""));
  return `---\nname: ${note.name}\ndescription: ${quote(note.description)}\nmetadata:\n  node_type: memory\n---\n\n${note.body}\n`;
}
function memory(files, repo) {
  if (!REPO.test(String(repo ?? ""))) return [];
  return (Array.isArray(files) ? files : []).filter((file) => /^[A-Za-z0-9._-]{1,80}\.md$/.test(String(file?.name ?? "")) && file.name !== "MEMORY.md").slice(0, MAX_ITEMS)
    .map((file) => {
      const note = memoryNote(file.text);
      const name = note.name || file.name.slice(0, -3);
      return { id: itemId(repo, "memory", file.name.slice(0, -3)), title: note.description ? `${name}: ${note.description}`.slice(0, 120) : name, value: { repo, file: file.name, note: { ...note, name } } };
    });
}

function preferences(settings) {
  const value = {};
  for (const field of SETTINGS_FIELDS) if (settings?.[field] !== undefined) value[field] = plain(settings[field]);
  return Object.keys(value).length ? [{ id: "preferences", title: "Studio preferences (no keys, no addresses)", value: { settings: value } }] : [];
}

// Ideas the owner kept, and open tasks, as ideas for the other PC.
function work({ ideas = [], tasks = [] } = {}, repo) {
  if (!REPO.test(String(repo ?? ""))) return [];
  const rows = [];
  for (const idea of Array.isArray(ideas) ? ideas : []) {
    if (!idea || !["new", "keep"].includes(idea.status)) continue;
    const title = text(idea.title, 200), detail = text(idea.detail ?? idea.text ?? idea.title, 16000);
    if (title && detail) rows.push({ id: itemId(repo, "idea", idea.id ?? title), title, value: { repo, kind: "idea", title, detail, intent: text(idea.intent, 20) || "improve" } });
  }
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || ["done", "dropped", "archived"].includes(task.status)) continue;
    const title = text(task.title ?? task.text, 200), detail = text(task.detail ?? task.prompt ?? task.text ?? task.title, 16000);
    if (title && detail) rows.push({ id: itemId(repo, "task", task.id ?? title), title, value: { repo, kind: "task", title, detail, intent: "improve" } });
  }
  return rows.slice(0, MAX_ITEMS);
}

// ---- what a received item may do here -------------------------------------

// A received item's name, from its value: the vault keeps values, not titles.
function titleOf(shelf, value = {}) {
  const models = Array.isArray(value.models) ? value.models.length : 0;
  const decisions = Array.isArray(value.decisions) ? value.decisions.length : 0;
  const named = {
    insights: models ? `How ${models} model${models === 1 ? "" : "s"} did` : "Model results",
    learned: decisions ? `${decisions} decisions` : "Decisions",
    presets: text(value.name, 80), brains: text(value.map?.name, 80), recipes: text(value.recipe?.name, 80),
    "claude-memory": text(value.note?.name, 80) || text(value.file, 80), work: text(value.title, 120),
    settings: "Studio preferences",
  }[shelf];
  return named || "Shared item";
}

// One plan per item: the step main carries out, or why it cannot. `repo` is
// the open project's GitHub repository; `names` lists names already in use
// per kind. `anyProject` is for a friend's share file, which names no
// repository: its brains, recipes and notes go to the open project.
function plan(shelf, item, { repo = null, names = {}, anyProject = false } = {}) {
  const value = item?.value ?? {};
  const from = text(item?.from, 60) || "another PC";
  if (PROJECT_SHELVES.includes(shelf) && !anyProject) {
    if (!REPO.test(String(value.repo ?? ""))) return { ok: false, error: "This item does not say which project it belongs to." };
    if (value.repo.toLowerCase() !== String(repo ?? "").toLowerCase()) return { ok: false, error: `This belongs to ${value.repo}. Open that project to use it.` };
  }
  const unique = (base, taken = []) => { let name = base; for (let n = 2; taken.includes(name); n += 1) name = `${base} (${n})`; return name; };
  switch (shelf) {
    case "insights": case "learned": return { ok: true, step: "learn" };
    case "presets": {
      if (!value.configuration || typeof value.configuration !== "object") return { ok: false, error: "This team setup is empty." };
      return { ok: true, step: "preset", preset: { name: unique(`${text(value.name, 60) || "Team"} (from ${from})`, names.presets), configuration: plain(value.configuration) } };
    }
    case "brains": {
      if (!value.map || !Array.isArray(value.map.nodes) || !value.map.nodes.length) return { ok: false, error: "This brain map has no nodes." };
      const name = unique(`${text(value.map.name, 60) || "Brain map"} (from ${from})`, names.brains);
      return { ok: true, step: "brain", map: { ...plain(value.map), id: `shared-${crypto.randomUUID().slice(0, 8)}`, name } };
    }
    case "recipes": {
      if (!value.recipe || !Array.isArray(value.recipe.steps) || !value.recipe.steps.length) return { ok: false, error: "This recipe has no steps." };
      return { ok: true, step: "recipe", recipe: { ...plain(value.recipe), name: unique(`${text(value.recipe.name, 60) || "Recipe"} (from ${from})`, names.recipes) } };
    }
    case "claude-memory": {
      if (!/^[A-Za-z0-9._-]{1,80}\.md$/.test(String(value.file ?? "")) || value.file === "MEMORY.md" || !value.note?.body) return { ok: false, error: "This note has no usable name or text." };
      if ((names.memory ?? []).includes(value.file)) return { ok: false, error: `A note called ${value.file} is already on this PC; it was left as it is.` };
      return { ok: true, step: "memory", file: value.file, text: memoryText({ name: text(value.note.name, 80) || value.file.slice(0, -3), description: text(value.note.description, 300), body: String(value.note.body).slice(0, 20000) }) };
    }
    case "work": {
      const title = text(value.title, 200), detail = text(value.detail, 16000);
      if (!title || !detail) return { ok: false, error: "This idea is empty." };
      return { ok: true, step: "idea", idea: { title, detail: `${detail}\n\n(Shared from ${from}.)`.slice(0, 16000), intent: ["modify", "experiment", "fix", "improve"].includes(value.intent) ? value.intent : "improve" } };
    }
    case "settings": {
      const settings = {};
      for (const field of SETTINGS_FIELDS) if (value.settings?.[field] !== undefined) settings[field] = plain(value.settings[field]);
      return Object.keys(settings).length ? { ok: true, step: "settings", settings } : { ok: false, error: "There are no preferences in this item." };
    }
    default: return { ok: false, error: "Unknown shelf." };
  }
}

// ---- the library: what the owner kept -------------------------------------

function library(raw) {
  const items = (Array.isArray(raw?.items) ? raw.items : []).filter((entry) => entry && typeof entry.shelf === "string" && typeof entry.id === "string").slice(0, LIBRARY_MAX);
  return { v: 1, items };
}
function keep(book, entry, now = Date.now()) {
  const current = library(book);
  const row = { shelf: entry.shelf, id: entry.id, from: text(entry.from, 60) || null, source: entry.source === "file" ? "file" : "vault", title: text(entry.title, 160) || entry.id, at: Number.isFinite(entry.at) ? entry.at : now, keptAt: now, value: plain(entry.value) };
  const items = [row, ...current.items.filter((item) => !(item.shelf === row.shelf && item.id === row.id && item.from === row.from))].slice(0, LIBRARY_MAX);
  return { v: 1, items };
}
function forget(book, { shelf, id, from = null }) {
  const current = library(book);
  return { v: 1, items: current.items.filter((item) => !(item.shelf === shelf && item.id === id && (from == null || item.from === from))) };
}
// Kept insights, as snapshots modelLearning.aggregate reads beside this PC's.
function learningSnapshots(book) {
  return library(book).items.filter((item) => item.shelf === "insights").map((item) => ({ models: insights(item.value)[0]?.value.models ?? [] }));
}
// Kept decisions, as rows with no project, so they weigh like another
// project's in decisionMemory.profile.
function learnedRows(book) {
  return library(book).items.filter((item) => item.shelf === "learned").flatMap((item) => (learned(item.value?.decisions)[0]?.value.decisions ?? []).map((row) => ({ ...row, projectId: null, source: "shared" })));
}

module.exports = {
  PROJECT_SHELVES, SETTINGS_FIELDS, repoKey, itemId,
  insights, learned, presets, brains, recipes, memory, memoryNote, memoryText, preferences, work,
  titleOf, plan, library, keep, forget, learningSnapshots, learnedRows,
};
