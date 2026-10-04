// The Studio Daily's "Since you were away" rules (scripts/front-page.cjs):
// which models count as new, how a day keeps its list, and what one project's
// digest says. Pure: no files, network or clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SOURCES, LIMITS, modelSnapshot, rollModels, projectDigest, recentProjects } = require("../scripts/front-page.cjs");

const catalog = {
  models: [
    { id: "glm-5.3", name: "GLM-5.3", onRoster: true, releaseDate: "2026-09-20" },
    { id: "kimi-k3", name: "Kimi K3", onRoster: true, releaseDate: "2026-09-01" },
    { id: "gone", name: "Gone", onRoster: false, releaseDate: "2026-10-01" },
  ],
  providerModels: {
    claude: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5", releaseDate: "2026-09-22" }],
    zen: [{ id: "gpt-6-luna", name: "GPT-6 Luna", releaseDate: "2026-09-22" }],
    zai: [{ id: "glm-5.3-flash", name: "GLM-5.3-Flash", releaseDate: "2026-08-26" }],
  },
};

test("a snapshot lists each source Studio can route to, and only the Go models on the roster", () => {
  const snapshot = modelSnapshot(catalog, { openrouter: [{ id: "x/y", name: "Y", created: Date.parse("2026-10-03") / 1000 }] });
  assert.deepEqual(Object.keys(snapshot).sort(), ["claude", "go", "openrouter", "zai", "zen"]);
  assert.deepEqual(snapshot.go.map((row) => row.id), ["glm-5.3", "kimi-k3"]);
  assert.deepEqual(snapshot.openrouter[0], { id: "x/y", name: "Y", releaseDate: "2026-10-03" });
  // A source the host does not know is absent, never an empty list.
  assert.equal("chatgpt" in snapshot, false);
  assert.deepEqual(modelSnapshot(null), {});
  assert.deepEqual(modelSnapshot({ models: [{ id: "a" }, { id: "a" }, null, { name: "no id" }] }).go, [{ id: "a", name: "a", releaseDate: null }]);
  for (const source of Object.keys(snapshot)) assert.ok(SOURCES[source], source);
});

test("the first day shows the last two weeks' releases, and keeps showing them all day", () => {
  const current = modelSnapshot(catalog);
  const first = rollModels(null, current, "2026-10-04");
  assert.equal(first.firstVisit, true);
  assert.deepEqual(first.drops.map((drop) => drop.id), ["claude-opus-5-5", "gpt-6-luna", "glm-5.3"]);
  assert.equal(first.drops[0].sourceName, "Claude");
  assert.equal(first.record.baseline, null);
  const again = rollModels(first.record, current, "2026-10-04");
  assert.deepEqual(again.drops, first.drops, "a reload the same day says the same");
});

test("a later day lists what is new since the last day seen, the same all day", () => {
  const before = modelSnapshot(catalog);
  const day1 = rollModels(null, before, "2026-10-03").record;
  const after = modelSnapshot({
    ...catalog,
    models: [...catalog.models, { id: "deepseek-v5", name: "DeepSeek V5", onRoster: true, releaseDate: "2026-10-04" }],
    providerModels: { ...catalog.providerModels, zen: [...catalog.providerModels.zen, { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", releaseDate: "2026-09-29" }] },
  });
  const day2 = rollModels(day1, after, "2026-10-04");
  assert.equal(day2.firstVisit, false);
  assert.deepEqual(day2.drops.map((drop) => [drop.source, drop.id]), [["go", "deepseek-v5"], ["zen", "gpt-6.1-sol"]]);
  // Later the same day: same baseline, same drops, even after the list is saved again.
  const reload = rollModels(day2.record, after, "2026-10-04");
  assert.deepEqual(reload.drops, day2.drops);
  // The next day the baseline moves on: nothing new.
  assert.deepEqual(rollModels(reload.record, after, "2026-10-05").drops, []);
});

test("a source that just became readable adds nothing, and the lists are capped", () => {
  const day1 = rollModels(null, modelSnapshot(catalog), "2026-10-03").record;
  const many = Array.from({ length: 40 }, (_, index) => ({ id: `or/${index}`, name: `OR ${index}`, created: 1790000000 + index }));
  const day2 = rollModels(day1, modelSnapshot(catalog, { openrouter: many }), "2026-10-04");
  assert.deepEqual(day2.drops, [], "OpenRouter's whole list is not news");
  const day3 = rollModels(day2.record, modelSnapshot(catalog, { openrouter: [...many, ...Array.from({ length: 10 }, (_, index) => ({ id: `or/new${index}`, name: `New ${index}`, created: 1791000000 + index }))] }), "2026-10-05");
  assert.equal(day3.drops.length, LIMITS.perSource);
  assert.ok(day3.drops.every((drop) => drop.id.startsWith("or/new")));
});

test("broken saved records and inputs never throw", () => {
  const current = modelSnapshot(catalog);
  for (const saved of [{}, { day: "nope" }, { day: "2026-10-03", current: "x" }, { day: "2026-10-03", current: { bogus: [] } }]) {
    assert.equal(rollModels(saved, current, "2026-10-04").firstVisit, true);
  }
  assert.deepEqual(rollModels(null, current, "not a day").drops, []);
  assert.deepEqual(rollModels(null, "x", "2026-10-04").drops, []);
});

test("a project's digest says what finished, what waits on you and what came in since it was opened", () => {
  const since = Date.parse("2026-10-03T12:00:00Z");
  const digest = projectDigest({
    project: { id: "p1", name: "Notes app" },
    since,
    tasks: [
      { id: "t1", title: "Pin favourite notes", status: "done", doneAt: since + 5000 },
      { id: "t2", title: "Old work", status: "done", doneAt: since - 5000 },
      { id: "t3", title: "Rename notes", status: "completed", updatedAt: since + 9000 },
      { id: "t4", title: "Search by tag", status: "running" },
      { id: "t5", title: "Later", status: "open" },
    ],
    questions: [{ id: "q1", status: "open", title: "Should the empty state show on search?" }, { id: "q2", status: "answered" }],
    git: { commits: [{ subject: "Add export", at: since + 1000 }, { subject: "Before", at: since - 1 }], unpulled: 2 },
  });
  assert.deepEqual(digest.finished, { count: 2, latest: [{ id: "t3", title: "Rename notes", at: since + 9000 }, { id: "t1", title: "Pin favourite notes", at: since + 5000 }] });
  assert.deepEqual(digest.waiting, { count: 1, latest: [{ id: "q1", title: "Should the empty state show on search?" }] });
  assert.equal(digest.running, 1);
  assert.deepEqual(digest.commits, { count: 1, unpulled: 2, latest: [{ subject: "Add export", at: since + 1000 }] });
  assert.equal(digest.quiet, false);
  const quiet = projectDigest({ project: { id: "p2" }, since, tasks: [{ status: "done", doneAt: since - 1 }] });
  assert.equal(quiet.quiet, true);
  assert.equal(quiet.name, "p2");
  // Never opened: everything counts.
  assert.equal(projectDigest({ project: { id: "p3" }, since: null, tasks: [{ status: "done", doneAt: 1 }] }).finished.count, 1);
  assert.doesNotThrow(() => projectDigest({}));
  assert.doesNotThrow(() => projectDigest({ tasks: "x", questions: null, git: { commits: "x" } }));
});

test("the projects with a digest are the available ones, most recently opened first", () => {
  const list = [
    { id: "a", openedAt: 10 }, { id: "b", openedAt: 30 }, { id: "c", available: false, openedAt: 50 }, { id: "d" }, null, { openedAt: 99 },
  ];
  assert.deepEqual(recentProjects(list).map((project) => project.id), ["b", "a", "d"]);
  assert.equal(recentProjects(Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, openedAt: index }))).length, LIMITS.projects);
});
