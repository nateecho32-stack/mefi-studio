"use strict";
// The Studio Daily's own pages: what the launch screen says about this PC
// beside the day's news (renderer/daily-paper.js "Since you were away").
// Pure rules; main.cjs ("The Studio Daily: since you were away") reads the
// catalog, the saved model list, each project's board and git, and hands
// them here.
//
//   modelSnapshot(catalog, lists)  the models Studio can route to, by source
//   rollModels(saved, current, day) new models since the last day seen, and
//                                   the record to save (one baseline a day,
//                                   so a reload shows the same drops)
//   projectDigest(...)             one project's changes since it was last
//                                   opened: finished tasks, open questions,
//                                   running work, new commits
//
// Nothing here reads or writes a file, a network or a clock of its own.

const SOURCES = Object.freeze({
  go: "OpenCode Go",
  zen: "Zen",
  claude: "Claude",
  zai: "z.ai",
  openrouter: "OpenRouter",
  chatgpt: "ChatGPT plan (Codex)",
});
const LIMITS = Object.freeze({ perSource: 6, drops: 14, recentDays: 14, finished: 3, commits: 3, projects: 6, title: 120 });
const DAY_MS = 24 * 3600 * 1000;

const text = (value, max = LIMITS.title) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const dateOf = (value) => {
  const at = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  return Number.isFinite(at) ? at : null;
};

// One row per model: id, name, release date (ISO day or null).
function rows(list, { roster = false } = {}) {
  const out = [];
  const seen = new Set();
  for (const model of Array.isArray(list) ? list : []) {
    if (!model || typeof model !== "object") continue;
    if (roster && model.onRoster === false) continue;
    const id = text(model.id, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const released = dateOf(model.releaseDate ?? model.release_date ?? (Number.isFinite(model.created) ? model.created * 1000 : null));
    out.push({ id, name: text(model.name || id), releaseDate: released === null ? null : new Date(released).toISOString().slice(0, 10) });
  }
  return out;
}

/**
 * The models Studio can route to, by source. `catalog` is data/models.json's
 * document (models = the Go roster, providerModels = claude/zen/zai); `lists`
 * may add { openrouter, chatgpt } arrays a host already holds. A source the
 * host does not know is absent, never empty.
 */
function modelSnapshot(catalog, lists = {}) {
  const snapshot = {};
  if (Array.isArray(catalog?.models)) snapshot.go = rows(catalog.models, { roster: true });
  for (const source of ["zen", "claude", "zai"]) {
    const list = catalog?.providerModels?.[source];
    if (Array.isArray(list)) snapshot[source] = rows(list);
  }
  for (const source of ["openrouter", "chatgpt"]) if (Array.isArray(lists?.[source])) snapshot[source] = rows(lists[source]);
  return snapshot;
}

const idsOf = (snapshot, source) => new Set((snapshot?.[source] ?? []).map((row) => row.id));
const validDay = (day) => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day);
const validSnapshot = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value)
  && Object.entries(value).every(([source, list]) => source in SOURCES && Array.isArray(list)));

function newest(list) {
  return list.sort((a, b) => String(b.releaseDate ?? "").localeCompare(String(a.releaseDate ?? "")) || a.name.localeCompare(b.name));
}

/**
 * New models since the day before `day`. `saved` is the last record ({ day,
 * baseline, current }) or null. The first visit has no baseline: it shows the
 * models released in the last two weeks instead, marked `firstVisit`. A
 * source the baseline did not have (a list that just became readable) adds
 * nothing, so a new provider never floods the page.
 */
function rollModels(saved, current, day) {
  if (!validDay(day) || !validSnapshot(current)) return { record: saved ?? null, drops: [], firstVisit: false };
  const usable = saved && validDay(saved.day) && validSnapshot(saved.current) ? saved : null;
  // The same day keeps its baseline (null on the first day: the recent list
  // all day); a new day compares with the last list seen.
  const baseline = !usable ? null : usable.day === day ? (validSnapshot(usable.baseline) ? usable.baseline : null) : usable.current;
  const record = { day, baseline, current };
  const drops = [];
  if (baseline) {
    for (const [source, list] of Object.entries(current)) {
      if (!Array.isArray(baseline[source])) continue;
      const before = idsOf(baseline, source);
      const fresh = newest(list.filter((row) => !before.has(row.id))).slice(0, LIMITS.perSource);
      for (const row of fresh) drops.push({ source, sourceName: SOURCES[source], ...row });
    }
  } else {
    const since = Date.parse(`${day}T00:00:00Z`) - LIMITS.recentDays * DAY_MS;
    for (const [source, list] of Object.entries(current)) {
      const recent = newest(list.filter((row) => row.releaseDate && Date.parse(`${row.releaseDate}T00:00:00Z`) >= since)).slice(0, LIMITS.perSource);
      for (const row of recent) drops.push({ source, sourceName: SOURCES[source], ...row });
    }
  }
  return { record, drops: newest(drops).slice(0, LIMITS.drops), firstVisit: !baseline };
}

/**
 * One project's changes since `since` (when it was last opened; null: never).
 * `tasks` is its board (eyes-tasks.json rows), `questions` its assistant's
 * questions, `git` { commits: [{ subject, at }], unpulled } from the host.
 */
function projectDigest({ project, since = null, tasks = [], questions = [], git = null } = {}) {
  const after = (at) => Number.isFinite(at) && (since === null || at > since);
  const done = (Array.isArray(tasks) ? tasks : []).filter((task) => task && (task.status === "done" || task.status === "completed") && after(Number(task.doneAt ?? task.updatedAt)));
  done.sort((a, b) => Number(b.doneAt ?? b.updatedAt) - Number(a.doneAt ?? a.updatedAt));
  const waiting = (Array.isArray(questions) ? questions : []).filter((question) => question?.status === "open");
  const running = (Array.isArray(tasks) ? tasks : []).filter((task) => task?.status === "running").length;
  const commits = Array.isArray(git?.commits) ? git.commits.filter((commit) => after(Number(commit?.at))) : [];
  return {
    id: text(project?.id, 200),
    name: text(project?.name || project?.id || "Project"),
    since,
    finished: { count: done.length, latest: done.slice(0, LIMITS.finished).map((task) => ({ id: text(task.id, 200), title: text(task.title || "Untitled task"), at: Number(task.doneAt ?? task.updatedAt) })) },
    waiting: { count: waiting.length, latest: waiting.slice(0, 2).map((question) => ({ id: text(question.id, 200), title: text(question.title || question.text || "A question") })) },
    running,
    commits: { count: commits.length, unpulled: Number.isFinite(git?.unpulled) ? git.unpulled : 0, latest: commits.slice(0, LIMITS.commits).map((commit) => ({ subject: text(commit.subject), at: Number(commit.at) })) },
    quiet: done.length === 0 && waiting.length === 0 && running === 0 && commits.length === 0 && !(git?.unpulled > 0),
  };
}

/** Which saved projects get a digest: available ones, most recently opened first. */
function recentProjects(list, limit = LIMITS.projects) {
  return (Array.isArray(list) ? list : [])
    .filter((project) => project && project.available !== false && typeof project.id === "string")
    .sort((a, b) => (Number(b.openedAt) || 0) - (Number(a.openedAt) || 0))
    .slice(0, limit);
}

module.exports = { SOURCES, LIMITS, modelSnapshot, rollModels, projectDigest, recentProjects };
