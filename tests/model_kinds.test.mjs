import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Which model does which kind of coding job (scripts/model-kinds.cjs): the
// report card's verdicts from checked attempts, the suggestions it makes for a
// weak kind of job, the routes a team saves, and how a trial is judged.
const require = createRequire(import.meta.url);
const kinds = require("../scripts/model-kinds.cjs");

let serial = 0;
const attempt = (model, taskType, outcome, extra = {}) => ({ id: `obs_${serial += 1}`, provider: "opencode", model, taskType, source: "worker", outcome, at: 1000 + serial, ...extra });
const many = (count, ...args) => Array.from({ length: count }, () => attempt(...args));
// Shaped like the owner's own record on 2026-10-05 (DeepSeek V4.1 Flash only).
const flashRecord = () => [
  ...many(52, "deepseek-v4.1-flash", "coding-implement", "verified"), ...many(25, "deepseek-v4.1-flash", "coding-implement", "failed"),
  ...many(8, "deepseek-v4.1-flash", "coding-explore", "verified"), ...many(36, "deepseek-v4.1-flash", "coding-explore", "failed"),
  ...many(15, "deepseek-v4.1-flash", "coding-analyze", "verified"), ...many(34, "deepseek-v4.1-flash", "coding-analyze", "failed"),
  ...many(3, "deepseek-v4.1-flash", "coding-document", "verified"),
];
const builder = { provider: "opencode", model: "deepseek-v4.1-flash" };
const available = [
  { cli: "claude", model: "opus", provider: "claude", ledgerModel: "opus" },
  { cli: "opencode", model: "opencode-go/deepseek-v4-pro", provider: "opencode", ledgerModel: "deepseek-v4-pro" },
];

test("kinds of job and models read in plain words", () => {
  assert.equal(kinds.kindLabel("coding-explore"), "Exploring a codebase");
  assert.equal(kinds.kindLabel("coding"), "General coding");
  assert.equal(kinds.kindLabel("coding-migrate"), "Migrate jobs");
  assert.equal(kinds.modelName("deepseek-v4.1-flash"), "DeepSeek V4.1 Flash");
  assert.equal(kinds.modelName("opencode-go/deepseek-v4-pro"), "DeepSeek V4 Pro");
  assert.equal(kinds.modelName("claude-opus-5-5"), "Opus 5.5");
  assert.equal(kinds.modelName("kimi-k3-turbo"), "Kimi K3 Turbo");
  assert.equal(kinds.modelName("opencode-default", "opencode"), "OpenCode's default");
});

test("the report card gives each kind of job a verdict, best first, and counts each attempt once", () => {
  const rows = flashRecord();
  const card = kinds.reportCard([...rows, rows[0], { ...rows[1], outcome: undefined, id: "unsettled" }, { id: "chat", provider: "zen", model: "gpt-6-luna", taskType: "routine", source: "request", outcome: "verified" }]);
  assert.equal(card.checked, 173);
  assert.equal(card.models.length, 1);
  const [flash] = card.models;
  assert.equal(flash.name, "DeepSeek V4.1 Flash");
  assert.deepEqual(flash.kinds.map((kind) => [kind.label, kind.wins, kind.settled, kind.verdict]), [
    ["Building features", 52, 77, "good"],
    ["Analysing code", 15, 49, "weak"],
    ["Exploring a codebase", 8, 44, "weak"],
    ["Writing docs", 3, 3, "few"],
  ]);
  assert.deepEqual(kinds.reportCard([]), { checked: 0, from: null, to: null, models: [] });
});

test("a weak kind gets a model with a good record on it, else one with no record yet", () => {
  const card = kinds.reportCard(flashRecord());
  const first = kinds.suggestions(card, { builder, available });
  assert.deepEqual(first.map((item) => [item.taskType, item.to.cli, item.to.model, item.to.name]), [["coding-analyze", "claude", "opus", "Opus"], ["coding-explore", "claude", "opus", "Opus"]]);
  assert.match(first[1].text, /^Send exploring a codebase jobs to Opus on Claude Code\.$/);
  assert.match(first[1].detail, /passes 8 of 44 of them \(18%\)\. Opus has no results on them yet/);
  const proven = kinds.reportCard([...flashRecord(), ...many(6, "deepseek-v4-pro", "coding-explore", "verified"), ...many(1, "deepseek-v4-pro", "coding-explore", "failed")]);
  const explore = kinds.suggestions(proven, { builder, available }).find((item) => item.taskType === "coding-explore");
  assert.deepEqual([explore.to.model, explore.to.name], ["opencode-go/deepseek-v4-pro", "DeepSeek V4 Pro"], "a model with a good record on that kind comes first");
  assert.match(explore.detail, /DeepSeek V4 Pro passed 6 of 7/);
  assert.deepEqual(kinds.suggestions(card, { builder, available, routes: { "coding-explore": { cli: "claude", model: "opus" } } }).map((item) => item.taskType), ["coding-analyze"], "a routed kind is left alone");
  assert.deepEqual(kinds.suggestions(card, { builder, available: [] }), [], "nothing to run, nothing to suggest");
  assert.deepEqual(kinds.suggestions(card, { builder: { provider: "claude", model: "opus" }, available }), [], "no record for the worker, no suggestion");
});

test("saved kind routes are cleaned and checked", () => {
  assert.equal(kinds.validate({ "coding-explore": { cli: "claude", model: "opus", trial: { size: 5, from: 10, baseline: { wins: 8, losses: 36 } } } }), null);
  assert.match(kinds.validate({ planning: { cli: "claude" } }), /Unknown kind of job/);
  assert.match(kinds.validate({ "coding-explore": { cli: "vim" } }), /not usable/);
  assert.match(kinds.validate({ "coding-explore": { cli: "claude", model: "opus && calc" } }), /not usable/);
  assert.match(kinds.validate([]), /must be an object/);
  assert.deepEqual(kinds.routeOf({ cli: "claude", model: " opus ", by: "robot", trial: { size: 99 } }), { cli: "claude", model: "opus", by: "owner", trial: { size: 20, from: 0, baseline: { wins: 0, losses: 0 } }, kept: null });
});

test("a trial is kept only when the new model did clearly better", () => {
  const route = { cli: "claude", model: "opus", trial: { size: 5, from: 5000, baseline: { wins: 8, losses: 36 } } };
  const key = { taskType: "coding-explore", provider: "claude", model: "opus" };
  const on = (outcome, at = 6000) => ({ id: `t_${serial += 1}`, provider: "claude", model: "opus", taskType: "coding-explore", source: "worker", outcome, at });
  assert.deepEqual(kinds.trialState(route, [on("verified"), on("failed")], key), { size: 5, wins: 1, losses: 1, left: 3, done: false, keep: false });
  assert.equal(kinds.trialState(route, [on("verified"), on("verified"), on("verified"), on("failed"), on("failed")], key).keep, true, "3 of 5 beats 8 of 44");
  assert.equal(kinds.trialState(route, [on("verified"), on("failed"), on("failed"), on("failed"), on("failed")], key).keep, false);
  assert.equal(kinds.trialState(route, [on("verified", 100), on("verified", 100)], key).left, 5, "attempts from before the trial do not count");
  const fair = { ...route, trial: { ...route.trial, baseline: { wins: 6, losses: 4 } } };
  assert.equal(kinds.trialState(fair, [on("verified"), on("verified"), on("verified"), on("verified"), on("failed")], key).keep, true, "80% beats 60% by more than the margin");
  const strong = { ...route, trial: { ...route.trial, baseline: { wins: 7, losses: 3 } } };
  assert.equal(kinds.trialState(strong, [on("verified"), on("verified"), on("verified"), on("verified"), on("failed")], key).keep, false, "80% is not clearly better than 70%");
  assert.equal(kinds.trialState({ cli: "claude", model: "opus" }, [], key), null, "a kept route has no trial");
});

test("Studio starts a trial on its own only for a clearly weak kind, one at a time, when allowed", () => {
  const card = kinds.reportCard(flashRecord());
  const base = { card, builder, available, explore: true, selection: "jev", routes: {} };
  assert.equal(kinds.autoTrialFor({ ...base, kind: "coding-explore" })?.to.model, "opus", "8 of 44 is clearly weak");
  assert.equal(kinds.autoTrialFor({ ...base, kind: "coding-analyze" })?.to.model, "opus", "15 of 49 is under a third");
  assert.equal(kinds.autoTrialFor({ ...base, kind: "coding-implement" }), null, "a good kind is left alone");
  assert.equal(kinds.autoTrialFor({ ...base, kind: "coding-explore", explore: false }), null);
  assert.equal(kinds.autoTrialFor({ ...base, kind: "coding-explore", selection: "fixed" }), null);
  assert.equal(kinds.autoTrialFor({ ...base, kind: "coding-explore", routes: { "coding-analyze": { cli: "claude", model: "opus", by: "studio", trial: { size: 5, from: 1 } } } }), null, "one Studio trial at a time");
  assert.equal(kinds.autoTrialFor({ ...base, kind: "coding-explore", routes: { "coding-analyze": { cli: "claude", model: "opus", by: "owner", trial: { size: 5, from: 1 } } } })?.to.model, "opus", "the owner's own trials do not count against it");
});
