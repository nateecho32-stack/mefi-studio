import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { scanIdeas } from "../scripts/reference.mjs";
import { advanceCursor, mergeIdeas } from "../scripts/assistant.mjs";
const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const start = source.indexOf("async function scanIdeasInternal(");
const code = source.slice(start, source.indexOf("async function analyzerAi(", start));
const feature = (index, at = 100 + index) => ({ id: `part_${String(index).padStart(3, "0")}`, at, sessionId: "session", text: `We should improve unique feature number ${index} for this project.` });
function fixture({ chats = [feature(1, 100)], ideas = [], tasks = [] } = {}) {
  let cursor = { chat: { lastAt: 1, lastId: "before" } };
  let reviewed = [], payloads = [], fail = false, reply = '{"ideas":[],"taskGroups":[]}', boardWrites = 0;
  const board = { tasks, ideas, requests: [] };
  const context = vm.createContext({ Date, INGEST_PATH: "cursor", IDEAS_PATH: "ideas", TASKS_PATH: "tasks",
    assistantCache: {}, assistantState: { prefs: {} }, autopilot: { jobs: [] }, ASSISTANT_IDEAS_SYSTEM: "fixture",
    assistantLog() {},
    getEyes: async () => ({ readJson: async (file) => structuredClone(file === "cursor" ? cursor : board[file] ?? []),
      listChatTexts: ({ after }) => chats.filter((chat) => chat.at > after.at || (chat.at === after.at && chat.id > after.id)).slice(0, 400),
      writeJson: async (_file, value) => { cursor = structuredClone(value); } }),
    getReference: async () => ({ scanIdeas }),
    assistantFetch: async (_system, text) => { payloads.push(text); reviewed.push(JSON.parse(text)); return fail ? { ok: false, error: "offline" } : { ok: true, text: reply }; },
    assistantModule: { mergeIdeas: (existing, additions) => ({ ideas: [...existing, ...additions], added: additions.length }), advanceCursor },
    mutateBoard: async (mutator) => { boardWrites += 1; return mutator(board); },
  });
  vm.runInContext(code, context);
  return { context, cursor: () => cursor, reviewed: () => reviewed, payloads: () => payloads, writes: () => boardWrites, setFail: (value) => { fail = value; }, setReply: (value) => { reply = value; } };
}
test("keyless scans preserve chat for later curation without minting raw work", async () => {
  const f = fixture();
  const preview = await f.context.scanIdeasInternal(false);
  assert.equal(preview.pendingReview, true);
  assert.equal(preview.added, 0);
  assert.equal(f.cursor().chat.lastAt, 1);
  assert.equal(f.writes(), 0);
  assert.equal(f.reviewed().length, 0);
  const result = await f.context.scanIdeasInternal(true);
  assert.equal(result.aiError, null);
  assert.equal(f.reviewed()[0].candidates[0].title, feature(1).text);
  assert.equal(f.cursor().chat.lastAt, 100);
  assert.equal((await f.context.scanIdeasInternal(false)).newMaterial, false);
});
test("failed AI curation stays pending across an intervening keyless scan", async () => {
  const f = fixture();
  f.setFail(true);
  await f.context.scanIdeasInternal(true);
  await f.context.scanIdeasInternal(false);
  assert.equal(f.cursor().chat.lastAt, 1);
  f.setFail(false);
  await f.context.scanIdeasInternal(true);
  assert.equal(f.reviewed().length, 2);
  assert.equal(f.reviewed()[1].candidates.length, 1);
  assert.equal(f.cursor().chat.lastId, "part_001");
});

test("candidate overflow continues on later scans without skipping rows beyond either extractor cap", async () => {
  const chats = Array.from({ length: 85 }, (_, index) => feature(index + 1));
  const f = fixture({ chats });
  const first = await f.context.scanIdeasInternal(true);
  assert.equal(first.pendingReview, true);
  assert.ok(f.cursor().chat.lastAt < chats.at(-1).at);
  for (let pass = 0; pass < 8 && f.cursor().chat.lastAt < chats.at(-1).at; pass++) await f.context.scanIdeasInternal(true);
  const reviewed = f.reviewed().flatMap((payload) => payload.candidates.map((idea) => idea.detail));
  assert.deepEqual(reviewed, chats.map((chat) => chat.text));
  assert.ok(f.reviewed().every((payload) => payload.candidates.length <= 40));
  assert.equal(f.cursor().chat.lastAt, chats.at(-1).at);
  assert.equal((await f.context.scanIdeasInternal(false)).newMaterial, false);
});

test("a row crossing the candidate boundary is reviewed whole on the next pass, including equal timestamps", async () => {
  const chats = Array.from({ length: 39 }, (_, index) => feature(index + 1, 100));
  const combined = { ...feature(40, 100), text: `${feature(40).text}\n${feature(41).text}` };
  chats.push(combined, feature(42, 101));
  const f = fixture({ chats });
  await f.context.scanIdeasInternal(true);
  assert.equal(f.reviewed()[0].candidates.length, 39);
  assert.equal(f.cursor().chat.lastId, "part_039", "cursor must stop before a partially fitting source row");
  await f.context.scanIdeasInternal(true);
  assert.deepEqual(f.reviewed()[1].candidates.map((idea) => idea.detail), [feature(40).text, feature(41).text, feature(42).text]);
  assert.equal(f.cursor().chat.lastId, "part_042");
});

test("oversized first source row remains pending without an unreviewed cursor or model spend", async () => {
  const f = fixture({ chats: [{ ...feature(1), text: Array.from({ length: 65 }, (_, index) => feature(index + 1).text).join("\n") }] });
  const result = await f.context.scanIdeasInternal(true);
  assert.equal(result.ok, false);
  assert.equal(result.pendingReview, true);
  assert.match(result.error, /exceeds.*budget/);
  assert.equal(f.cursor().chat.lastAt, 1);
  assert.equal(f.reviewed().length, 0);
  assert.equal(f.writes(), 0);
});

test("long board context and candidate text stay valid bounded JSON without losing the remaining source window", async () => {
  const chats = Array.from({ length: 35 }, (_, index) => ({ ...feature(index + 1), text: `${feature(index + 1).text} ${"detailed ".repeat(16)}`.trim() }));
  const f = fixture({ chats,
    ideas: Array.from({ length: 60 }, (_, index) => ({ title: `${index} ${"earlier idea ".repeat(20)}` })),
    tasks: Array.from({ length: 40 }, (_, index) => ({ id: `task_${index}`, status: "open", title: "A long prior task ".repeat(10), prompt: "Saved task detail ".repeat(20) })),
  });
  for (let pass = 0; pass < 8 && f.cursor().chat.lastAt < chats.at(-1).at; pass++) await f.context.scanIdeasInternal(true);
  assert.ok(f.payloads().every((payload) => payload.length <= 12000));
  assert.deepEqual(f.reviewed().flatMap((payload) => payload.candidates.map((idea) => idea.detail)), chats.map((chat) => chat.text));
  assert.equal(f.cursor().chat.lastAt, chats.at(-1).at);
});

test("valid JSON without an ideas array is not a successful review and cannot consume chat", async () => {
  const f = fixture();
  f.setReply('{"error":"Review unavailable"}');
  const result = await f.context.scanIdeasInternal(true);
  assert.equal(result.pendingReview, true);
  assert.equal(result.aiError, "could not parse AI ideas");
  assert.equal(f.cursor().chat.lastAt, 1);
});

test("scanIdeas filters chat narration so the review never sees extraction artifacts", () => {
  const noise = [
    "Python contracts pass. Let me find the exact registered Lua checks next.",
    "Now update my TESTRUNS row and add the missing row for the concurrent session's check.",
    "I'll start by exploring the codebase to understand the existing systems before planning this multi-part feature.",
    "All green (49 tests). Adding capture shots for Tasks and Reference, then running the sweep.",
    "What's left, needs polish, or still needs more work?",
  ];
  const genuine = "Local coop has no per-player equipment system at all, so bare P2 is consistent — we should add shared backpack references.";
  const chat = { id: "part_001", at: 100, sessionId: "session", text: [...noise, genuine].join("\n") };
  const candidates = scanIdeas([chat]);
  assert.deepEqual(candidates.map((idea) => idea.detail), [genuine], "only the genuine proposal survives the gate");
});

test("mergeIdeas rejects narration the model relents and mints anyway", () => {
  const existing = [{ id: "idea_keep", title: "Keep existing work", detail: "A real obligation already saved." }];
  const fromModel = [
    { title: "It passes", detail: "All green (49 tests). Adding capture shots next." },
    { title: "What's left?", detail: "Checking what needs polish or still needs more work?" },
    { title: "Real proposal", detail: "The exporter should batch PNG writes so the sweep does not thrash the disk." },
  ];
  const { ideas, added, rejected } = mergeIdeas(existing, fromModel);
  assert.equal(added, 1);
  assert.equal(rejected, 2);
  assert.deepEqual(ideas.map((idea) => idea.title), ["Real proposal", "Keep existing work"]);
});
