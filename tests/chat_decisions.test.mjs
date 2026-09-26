import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import oversight from "../scripts/task-oversight.cjs";

const question = { id: "q", source: "issue", status: "open", context: { taskId: "t", issueKind: "scope", suggestion: { optionId: "narrow" } }, options: [
  { id: "narrow", label: "Keep it narrow", action: { kind: "issue", action: "narrow" } },
  { id: "instruct", label: "Answer it in one line", text: true, action: { kind: "issue", action: "instruct" } },
] };
const base = { taskIds: ["t"], tasks: [{ id: "t", title: "Export", origin: { by: "owner" } }], titles: { t: "Export" }, scopes: { t: "saved-scope" }, questions: [question], level: "auto", immediateQuestionId: "q" };
const answer = { kind: "answer", questionId: "q", optionId: "narrow" };

test("all chat modes keep ambiguity and owner wording gates while applying their approval policy", () => {
  for (const level of ["ask", "accept", "auto", "elevated"]) {
    const approved = oversight.validateChatActions([{ kind: "approve", taskId: "t" }], { ...base, level, text: "approve Export" });
    assert.equal(approved.run.length, level === "ask" ? 0 : 1);
    if (approved.run.length) assert.equal(approved.run[0].expectedScope, "saved-scope");
    for (const text of ["should we approve Export?", "don't approve Export", "approve something"]) assert.equal(oversight.validateChatActions([{ kind: "approve", taskId: "t" }], { ...base, level, text }).run.length, 0);
    assert.equal(oversight.validateChatActions([answer], { ...base, level, text: "keep it narrow" }).run.length, level === "ask" ? 0 : 1);
    for (const text of ["don't keep it narrow", "should we keep it narrow?", "if tests pass keep it narrow"]) assert.equal(oversight.validateChatActions([answer], { ...base, level, text }).run.length, 0);
  }
});

test("each elevated issue category remains on its card unless its switch is off", () => {
  for (const [issueKind, category] of [["permission", "grant"], ["risk", "risk"], ["capability", "pricier-model"], ["owner", "real-world"]]) {
    const q = { ...question, context: { ...question.context, issueKind } };
    for (const enabled of [true, false]) {
      const got = oversight.validateChatActions([answer], { ...base, questions: [q], elevated: { [category]: enabled }, text: "keep it narrow" });
      assert.equal(got.run.length, enabled ? 0 : 1, category);
    }
  }
});

test("a shown suggestion requires one immediate question and never supplies missing instructions", () => {
  for (const text of ["yes", "do that", "go with your pick", "do what you suggested"]) {
    assert.equal(oversight.validateChatActions([answer], { ...base, text }).run.length, 1);
    assert.equal(oversight.validateChatActions([answer], { ...base, text, immediateQuestionId: null }).run.length, 0);
  }
  const instruct = { ...answer, optionId: "instruct", text: "model invented this" };
  const got = oversight.validateChatActions([instruct], { ...base, text: "Answer it in one line: use the existing save path" });
  assert.equal(got.run[0].text, "use the existing save path");
  assert.equal(oversight.validateChatActions([instruct], { ...base, text: "Answer it in one line" }).run.length, 0);
  const duplicate = { ...question, id: "q2", context: { ...question.context, taskId: "t2" } };
  assert.equal(oversight.validateChatActions([answer], { ...base, questions: [question, duplicate], text: "keep it narrow" }).run.length, 0);
});

test("Undo selects only the owner-named decision or the latest active decision", () => {
  const decisions = [{ id: "decision_a" }, { id: "decision_b" }, { id: "decision_c", undone: 3 }];
  const check = (id, text) => oversight.validateChatActions([{ kind: "undo", ...(id ? { decisionId: id } : {}) }], { ...base, decisions, text });
  assert.equal(check(null, "undo that").run[0].decisionId, "decision_b");
  assert.equal(check("decision_a", "undo decision_a").run[0].decisionId, "decision_a");
  assert.equal(check("decision_a", "undo that").run.length, 0);
  for (const text of ["should we undo that?", "don't undo that", "if this fails undo that"]) assert.equal(check(null, text).run.length, 0);
});

test("inbox identities follow the saved brief and permit only promotion/start", () => {
  const request = { id: "r", title: "Export", prompt: "Export JSON", source: "agent", at: 1 };
  const digest = oversight.boardDigest({ requests: [request], tasks: [], now: 10 });
  const id = digest.inbox[0].id;
  assert.notEqual(id, oversight.requestId({ ...request, prompt: "Export and upload" }));
  assert.deepEqual(oversight.localChatActions("start Export", { digest }), [{ kind: "work_on", taskId: id }]);
  assert.equal(oversight.validateChatActions([{ kind: "approve", taskId: id }], { text: "approve Export", level: "auto", taskIds: [id], titles: { [id]: "Export" } }).run.length, 0);
});

test("decision context is packed immediately after Needs you before the larger board", () => {
  const packed = JSON.parse(oversight.packChatPayload({ message: "why?", did: [], needsYou: { total: 1 }, decisionContext: { mode: "auto", decisions: [{ reason: "Named checks failed" }] }, board: { ready: Array.from({ length: 60 }, (_, i) => ({ id: String(i), title: "x".repeat(100) })) } }, 1000));
  assert.deepEqual(Object.keys(packed).slice(0, 4), ["message", "did", "needsYou", "decisionContext"]);
  assert.equal(packed.decisionContext.decisions[0].reason, "Named checks failed");
});

test("host shared context contains bounded ledger, to-dos, desk answers and owner lines", async () => {
  const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const start = main.indexOf("async function assistantDecisionContext("), end = main.indexOf("async function assistantDecisionPreferences(", start);
  const env = vm.createContext({
    autonomySettings: { level: "auto", elevated: { grant: true } }, assistantDecisionPreferences: async () => [{ kind: "scope", verb: "narrow" }],
    agentBrain: { state: async () => ({ answers: { t: [{ answer: "Use the existing checker" }] } }) },
    assistantState: { decisions: Array.from({ length: 10 }, (_, id) => ({ id, reason: "Saved reason" })), todos: [{ id: "todo", text: "Plug in the device" }, { id: "done", doneAt: 1 }], messages: Array.from({ length: 7 }, (_, i) => ({ role: "user", text: `owner ${i}` })).concat({ role: "assistant", text: "ignore me" }) },
    assistantClip: (text, max) => String(text).slice(0, max),
  });
  vm.runInContext(main.slice(start, end), env);
  const got = await env.assistantDecisionContext("t");
  assert.equal(got.decisions.length, 8);
  assert.equal(got.decisions[0].id, 2);
  assert.equal(got.todos.length, 1);
  assert.equal(got.deskAnswers[0].answer, "Use the existing checker");
  assert.equal(got.ownerLines.length, 4);
  assert.equal(got.ownerLines[0], "owner 3");
});

test("the outer model gate recognizes an OpenRouter key and a companion-only local seat", async () => {
  const main = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  const env = vm.createContext({ AI_PROVIDERS: ["auto", "zen"], normalizeAutoProviders: () => [], roleProvider: () => "zen", keyAvailable: (settings, field) => Boolean(settings[field]) });
  vm.runInContext(main.slice(main.indexOf("function aiRouteConfigured("), main.indexOf("async function runAssistant(")), env);
  assert.equal(env.aiRouteConfigured({ aiProvider: "zen", openrouterApiKeyEncrypted: "fixture" }), true);
  assert.equal(env.aiRouteConfigured({ aiProvider: "zen", agentSeats: { companion: { provider: "lmstudio" } } }), true);
  assert.equal(env.aiRouteConfigured({ aiProvider: "zen" }), false);
});
