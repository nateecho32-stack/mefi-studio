// Guard tests for scripts/vault-shelves.cjs, what each Your PCs vault shelf
// offers and what a received item may do: only counts leave as model results,
// decisions leave without their project, preferences leave without keys or
// addresses, and nothing received overwrites what this PC has.
//
// Run: node --test tests/vault_shelves.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const shelves = require("../scripts/vault-shelves.cjs");
const REPO = "owner/app";
const plain = (value) => JSON.parse(JSON.stringify(value));

test("model results leave as counts per model and kind of task, nothing else", () => {
  const [item, ...rest] = shelves.insights({ models: [
    { provider: "zai", model: "glm-5", wins: 8, losses: 2, taskStrengths: [{ taskType: "coding", wins: 6, losses: 1, recent: ["C:\\Users\\echor\\secret.txt"] }, { taskType: "review", wins: 0, losses: 0 }], recent: [{ prompt: "private" }] },
    { provider: "zen", model: "unused", wins: 0, losses: 0 },
  ] });
  assert.equal(rest.length, 0);
  assert.equal(item.id, "models");
  assert.deepEqual(plain(item.value), { models: [{ provider: "zai", model: "glm-5", wins: 8, losses: 2, taskStrengths: [{ taskType: "coding", wins: 6, losses: 1 }] }] });
  assert.deepEqual(shelves.insights({ models: [] }), [], "no evidence, nothing offered");
});

test("decisions leave without the project they were made in", () => {
  const [item] = shelves.learned([{ projectId: "project_abc", at: 5, kind: "retry", verb: "approve", source: "owner", taskKind: "build" }, { kind: "", verb: "x", at: 1 }]);
  assert.deepEqual(plain(item.value.decisions), [{ at: 5, kind: "retry", verb: "approve", taskKind: "build" }]);
});

test("brains and recipes are keyed by repository and skip what only this PC ships", () => {
  const maps = [{ id: "default", name: "Pipeline", builtIn: true, nodes: [{ id: "n" }] }, { id: "mine", name: "Reviewer", nodes: [{ id: "a" }], active: true, updatedAt: 9 }, { id: "empty", name: "Empty", nodes: [] }];
  const brains = shelves.brains(maps, REPO);
  assert.equal(brains.length, 1);
  assert.equal(brains[0].id, shelves.itemId(REPO, "brain", "mine"));
  assert.deepEqual(plain(brains[0].value), { repo: REPO, map: { id: "mine", name: "Reviewer", nodes: [{ id: "a" }] } }, "the active flag and timestamps stay here");
  assert.notEqual(shelves.itemId("owner/other", "brain", "mine"), brains[0].id, "another project's map is another item");
  assert.deepEqual(shelves.brains(maps, null), [], "a project not on GitHub has nothing to key by");
  const recipes = shelves.recipes([{ id: "r_1", name: "Ship", shape: { intent: "implement" }, signature: "sig", steps: [{ kind: "build" }], runs: 3, verified: 2, failed: 1, lastTaskId: "t9" }, { id: "r_2", retired: true, steps: [{ kind: "build" }] }], REPO);
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].value.recipe.lastTaskId, undefined);
});

test("memory notes lose this PC's session and time; the index stays", () => {
  const text = "---\nname: product-direction\ndescription: \"What the owner wants\"\nmetadata:\n  node_type: memory\n  originSessionId: 0a98f535-18aa\n  modified: 2026-09-27\n---\n\nBuild proper agent software.\n";
  const items = shelves.memory([{ name: "product-direction.md", text }, { name: "MEMORY.md", text: "index" }, { name: "../escape.md", text }], REPO);
  assert.equal(items.length, 1);
  assert.deepEqual(plain(items[0].value), { repo: REPO, file: "product-direction.md", note: { name: "product-direction", description: "What the owner wants", body: "Build proper agent software." } });
  const written = shelves.memoryText(items[0].value.note);
  assert.doesNotMatch(written, /originSessionId|modified/);
  assert.deepEqual(plain(shelves.memoryNote(written)), plain(items[0].value.note), "what is written reads back the same");
});

test("preferences carry only the portable fields: no keys, addresses, windows or sharing rules", () => {
  const [item] = shelves.preferences({ learning: { models: "blend" }, executorTier: "heavy", apiKeyEncrypted: "blob", zaiApiKeyEncrypted: "blob", customEndpoint: "http://10.0.0.5:8080/v1", lmStudioEndpoint: "http://127.0.0.1:1234", window: { x: 1 }, companionSharing: { everyone: "all" }, machine: {} });
  assert.deepEqual(Object.keys(item.value.settings).sort(), ["executorTier", "learning"]);
});

test("open work goes as ideas; finished work stays", () => {
  const items = shelves.work({ ideas: [{ id: "i1", title: "Dark mode", detail: "Add it", status: "keep" }, { id: "i2", title: "Old", detail: "x", status: "done" }], tasks: [{ id: "t1", title: "Fix login", prompt: "The login fails", status: "open" }, { id: "t2", title: "Done", status: "done" }] }, REPO);
  assert.deepEqual(items.map((item) => [item.value.kind, item.title]), [["idea", "Dark mode"], ["task", "Fix login"]]);
});

test("a received item is used only in its own project, beside what is here, under a name that says where it came from", () => {
  const brain = { from: "DESK", value: { repo: REPO, map: { id: "mine", name: "Reviewer", nodes: [{ id: "a" }] } } };
  assert.match(shelves.plan("brains", brain, { repo: "owner/other" }).error, /Open that project/);
  const planned = shelves.plan("brains", brain, { repo: "Owner/App", names: { brains: ["Reviewer (from DESK)"] } });
  assert.equal(planned.ok, true);
  assert.equal(planned.map.name, "Reviewer (from DESK) (2)");
  assert.notEqual(planned.map.id, "mine", "a new map, never one of this PC's");
  assert.equal(shelves.plan("brains", { value: { map: brain.value.map } }, { anyProject: true }).ok, true, "a friend's file names no project");
  const note = { from: "DESK", value: { repo: REPO, file: "notes.md", note: { name: "notes", description: "d", body: "b" } } };
  assert.match(shelves.plan("claude-memory", note, { repo: REPO, names: { memory: ["notes.md"] } }).error, /left as it is/);
  assert.equal(shelves.plan("claude-memory", note, { repo: REPO, names: { memory: [] } }).step, "memory");
  const idea = shelves.plan("work", { from: "LAPTOP", value: { repo: REPO, title: "Dark mode", detail: "Add it", intent: "sneaky" } }, { repo: REPO });
  assert.deepEqual([idea.step, idea.idea.intent], ["idea", "improve"]);
  assert.match(idea.idea.detail, /Shared from LAPTOP/);
  const prefs = shelves.plan("settings", { value: { settings: { learning: { models: "global" }, apiKeyEncrypted: "sneaked in" } } });
  assert.deepEqual(Object.keys(prefs.settings), ["learning"], "only portable fields are applied, whatever arrives");
  assert.equal(shelves.plan("insights", { value: {} }).step, "learn");
  assert.equal(shelves.plan("unknown", {}).ok, false);
});

test("a friend's preferences file changes only how agents behave and learn", () => {
  const settings = { learning: { models: "blend" }, agentHabits: { brief: "full" }, autonomy: { level: "elevated", elevated: { grant: false, risk: false } }, executorCli: "codex", aiProvider: "openrouter", aiModels: { heavy: "big-model" } };
  const friend = shelves.plan("settings", { source: "file", value: { settings } }, { anyProject: true });
  assert.deepEqual(Object.keys(friend.settings).sort(), ["agentHabits", "learning"], "no permission mode, builder, provider or model from a friend");
  const onlyPermissions = shelves.plan("settings", { source: "file", value: { settings: { autonomy: { level: "elevated" } } } }, { anyProject: true });
  assert.equal(onlyPermissions.ok, false);
  assert.match(onlyPermissions.error, /only change how your agents behave and learn/);
  const own = shelves.plan("settings", { source: "vault", value: { settings } });
  assert.deepEqual(Object.keys(own.settings).sort(), Object.keys(settings).sort(), "the owner's own PCs carry every portable field");
  // What a friend's file holds is what it can change, so the preview shows all of it.
  assert.deepEqual(Object.keys(shelves.friendValue("settings", { settings }).settings).sort(), ["agentHabits", "learning"]);
  const brain = { map: { name: "Helper", nodes: [{ id: "a" }] } };
  assert.equal(shelves.friendValue("brains", brain), brain);
});

test("preferences from another PC are checked like the controls that write them", () => {
  const allowed = { providers: ["auto", "zai", "claude"], clis: ["opencode", "codex"], tiers: ["auto", "heavy"] };
  const checked = shelves.checkedSettings({
    aiProvider: "made-up", executorCli: "codex", executorTier: "gigantic", modelSelection: "fixed",
    aiAutoFallback: "yes", aiSubscriptionFirst: true,
    aiRoleProviders: { heavy: "claude", routine: "made-up" },
    aiModels: { heavy: `  ${"m".repeat(200)}  `, weird: "x" },
    aiModelsByProvider: { zai: { routine: "glm" }, unknown: { routine: "x" } },
    executorModels: { opencode: "model-a", "bad key!": "x", codex: 7 },
    learning: { models: "blend" }, agentHabits: ["not", "an", "object"],
  }, allowed);
  assert.deepEqual(checked, {
    executorCli: "codex", modelSelection: "fixed", aiSubscriptionFirst: true,
    aiRoleProviders: { heavy: "claude" }, aiModels: { heavy: "m".repeat(120) },
    aiModelsByProvider: { zai: { routine: "glm" } }, executorModels: { opencode: "model-a" },
    learning: { models: "blend" },
  });
});

test("the permission mode from another PC never switches off an ask that needs the owner's confirmation", () => {
  const here = { level: "auto", elevated: { grant: true, risk: true, "drop-owned": true, "agent-filed": true, "pricier-model": true, "real-world": true } };
  const merged = shelves.permissionsFrom(here, { level: "elevated", elevated: { grant: false, risk: false, "pricier-model": false } });
  assert.equal(merged.level, "elevated", "the mode itself carries over");
  assert.equal(merged.elevated.grant, true);
  assert.equal(merged.elevated.risk, true);
  assert.equal(merged.elevated["pricier-model"], false, "asks without a warning follow the other PC");
  assert.deepEqual(merged.kept, ["Granting reach", "Irreversible changes"]);
  // An ask this PC already switched off stays off; an ask the other PC adds is added.
  const relaxed = shelves.permissionsFrom({ ...here, elevated: { ...here.elevated, grant: false } }, { level: "auto", elevated: { grant: false, "real-world": true } });
  assert.equal(relaxed.elevated.grant, false);
  assert.deepEqual(relaxed.kept, []);
  assert.equal(shelves.permissionsFrom(here, { level: "sideways" }).level, "auto", "an unknown mode falls back to the default");
});

test("the library keeps one copy per item and source, and feeds learning as another PC's evidence", () => {
  let book = shelves.library(null);
  book = shelves.keep(book, { shelf: "insights", id: "models", from: "DESK", value: { models: [{ provider: "zai", model: "glm-5", wins: 3, losses: 1, taskStrengths: [] }] } }, 10);
  book = shelves.keep(book, { shelf: "insights", id: "models", from: "DESK", value: { models: [{ provider: "zai", model: "glm-5", wins: 5, losses: 1, taskStrengths: [] }] } }, 20);
  book = shelves.keep(book, { shelf: "learned", id: "decisions", from: "LAPTOP", value: { decisions: [{ at: 1, kind: "retry", verb: "approve" }] } }, 30);
  assert.equal(book.items.length, 2, "a newer copy replaces the older one");
  assert.equal(shelves.learningSnapshots(book)[0].models[0].wins, 5);
  assert.deepEqual(plain(shelves.learnedRows(book)), [{ at: 1, kind: "retry", verb: "approve", projectId: null, source: "shared" }]);
  book = shelves.forget(book, { shelf: "insights", id: "models", from: "DESK" });
  assert.deepEqual(shelves.learningSnapshots(book), [], "removed, it stops counting");
  assert.equal(shelves.titleOf("insights", { models: [{}, {}] }), "How 2 models did");
});
