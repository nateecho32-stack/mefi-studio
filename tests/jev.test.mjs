// The Jev decision client and its pure classification builders: bounded
// config, key resolution that never leaks, the AI Gateway's evaluation wire
// (Jev is an evaluation model — chat/completions is the wrong surface),
// strict answer validation (an out-of-contract reply is an error, never a
// guess), conservative interpretation (ambiguity keeps work separate), and a
// live half that only runs when AI_GATEWAY_API_KEY is exported.
//
// Run: node --test tests/   (or npm test)

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_JEV_MODEL,
  buildEvaluationRequest,
  classify,
  evaluationUrl,
  gatewayConfig,
  isJevModel,
  listModels,
  parseAnswers,
  resolveApiKey,
  validateQuestionSpec,
  validateWireAnswers,
} from "../scripts/decision-client.mjs";
import {
  MESSAGE_KINDS,
  RELATIONSHIP_OPTIONS,
  interpretMessageKind,
  interpretRelationship,
  messageKindQuestion,
  relationshipQuestion,
  retrieveCandidate,
} from "../scripts/work-classification.mjs";

const KEY = "vck_test_key_0123456789";
const okResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const jevReply = (answers, usage = {}) => okResponse({ answers, usage });

// ---- config ---------------------------------------------------------------------

test("gateway config: defaults, env overrides, clamps", () => {
  const defaults = gatewayConfig({ env: {} });
  assert.equal(defaults.model, DEFAULT_JEV_MODEL);
  assert.equal(defaults.baseUrl, "https://ai-gateway.vercel.sh/v1");
  assert.equal(defaults.timeoutMs, 15000);
  const overridden = gatewayConfig({ env: { MEFI_JEV_MODEL: "typesafe-ai/jev-next", MEFI_AI_GATEWAY_BASE_URL: "https://proxy.example/v1/", MEFI_JEV_TIMEOUT_MS: "1" } });
  assert.equal(overridden.model, "typesafe-ai/jev-next");
  assert.equal(overridden.baseUrl, "https://proxy.example/v1", "trailing slash stripped");
  assert.equal(overridden.timeoutMs, 1000, "timeout clamps to its floor, never zero");
});

test("evaluationUrl resolves against the gateway origin (v4/ai/evaluation-model)", () => {
  assert.equal(evaluationUrl("https://ai-gateway.vercel.sh/v1"), "https://ai-gateway.vercel.sh/v4/ai/evaluation-model");
  assert.equal(evaluationUrl("https://proxy.example/v9"), "https://proxy.example/v4/ai/evaluation-model");
});

test("key resolution: env wins, then the encrypted settings field, then null", () => {
  const decrypt = (settings, field) => (field === "gatewayApiKeyEncrypted" ? "stored-key" : null);
  assert.deepEqual(resolveApiKey({ env: { AI_GATEWAY_API_KEY: "env-key" }, settings: { gatewayApiKeyEncrypted: "x" }, decrypt }), { key: "env-key", via: "env" });
  assert.deepEqual(resolveApiKey({ env: {}, settings: { gatewayApiKeyEncrypted: "x" }, decrypt }), { key: "stored-key", via: "settings" });
  assert.equal(resolveApiKey({ env: {}, settings: null, decrypt }), null);
  // no decrypt injected (plain-node CLI): the settings path is unusable, not a crash
  assert.equal(resolveApiKey({ env: {}, settings: { gatewayApiKeyEncrypted: "x" } }), null);
});

// ---- question specs ---------------------------------------------------------------

test("question specs: choices need unique options, every type needs a self-contained prompt", () => {
  assert.equal(validateQuestionSpec({ id: "q", type: "choice", prompt: "Compare X to Y", options: ["a", "b"] }).ok, true);
  assert.equal(validateQuestionSpec({ id: "q", type: "choice", prompt: "p", options: ["a", "a"] }).ok, false, "duplicate options refused");
  assert.equal(validateQuestionSpec({ id: "q", type: "choice", prompt: "p", options: ["only"] }).ok, false);
  assert.equal(validateQuestionSpec({ id: "q", type: "vibes", prompt: "p" }).ok, false);
  assert.equal(validateQuestionSpec({ id: "q", type: "score", prompt: "p", levels: "0 none … 100 perfect" }).ok, true);
  assert.equal(validateQuestionSpec({ id: "q", type: "score", prompt: "p" }).ok, false, "score needs level definitions");
  assert.equal(validateQuestionSpec({ id: "q", type: "choice", options: ["a", "b"] }).ok, false, "a prompt is required — the model never sees the id");
});

// ---- the evaluation wire ------------------------------------------------------------

test("buildEvaluationRequest: id-keyed questions, criteria maps, noul becomes boolean, model rides the header", () => {
  const config = { ...gatewayConfig({ env: {} }), apiKey: KEY };
  const request = buildEvaluationRequest({
    config,
    questions: [
      { id: "rel", type: "choice", prompt: "Compare A to B", options: ["same_obligation", "unrelated"] },
      { id: "worth", type: "noul", prompt: "Is it blocked?" },
    ],
    state: "state text",
  });
  assert.equal(request.url, evaluationUrl(config.baseUrl));
  assert.equal(request.headers.authorization, `Bearer ${KEY}`);
  assert.equal(request.headers["ai-model-id"], DEFAULT_JEV_MODEL, "the model id rides the header, not the body");
  assert.equal(request.headers["ai-evaluation-model-specification-version"], "4");
  assert.deepEqual(request.body.questions.rel, { type: "choice", instructions: "Compare A to B", criteria: { same_obligation: "same_obligation", unrelated: "unrelated" } });
  assert.deepEqual(request.body.questions.worth, { type: "boolean", instructions: "Is it blocked?" });
  assert.equal(Object.keys(request.body).sort().join(","), "questions,state", "no model, no temperature — just state and questions");
  // oversized state is clipped instead of shipping the world
  const clipped = buildEvaluationRequest({ config: { ...config, maxStateChars: 100 }, questions: [], state: "x".repeat(5000) });
  assert.ok(clipped.body.state.length <= 100);
  // score has no wire mapping yet — a clear error, not a mangled question
  assert.throws(
    () => buildEvaluationRequest({ config, questions: [{ id: "s", type: "score", prompt: "p", levels: "l" }], state: "s" }),
    /score questions are not mapped/
  );
});

test("validateWireAnswers validates strictly against the question specs", () => {
  const specs = [
    { id: "rel", type: "choice", prompt: "p", options: ["same_obligation", "unrelated"] },
    { id: "blocked", type: "noul", prompt: "p" },
  ];
  const good = validateWireAnswers(
    { rel: { type: "choice", choice: "same_obligation" }, blocked: { type: "boolean", probability: 0.25 } },
    specs
  );
  assert.equal(good.ok, true);
  assert.deepEqual(good.answers, { rel: { choice: "same_obligation" }, blocked: { noul: 0.25 } });
  const bad = validateWireAnswers({ rel: { type: "choice", choice: "vibes" }, blocked: { type: "boolean", probability: 1.5 }, extra: { type: "choice", choice: "same_obligation" } }, specs);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((line) => line.includes("not one of")));
  assert.ok(bad.errors.some((line) => line.includes("0-1")));
  assert.ok(bad.errors.some((line) => line.includes('unknown question "extra"')));
  const incomplete = validateWireAnswers({ rel: { type: "choice", choice: "unrelated" } }, specs);
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.errors.some((line) => line.includes('"blocked": no answer given')));
  assert.equal(validateWireAnswers(null, specs).ok, false);
  // wrong answer type for the question type is refused
  assert.ok(validateWireAnswers({ rel: { type: "boolean", probability: 0.5 }, blocked: { type: "boolean", probability: 0.5 } }, specs).errors.some((line) => line.includes('"rel"')));
});

test("parseAnswers still validates the prose JSON contract (language-model fallbacks)", () => {
  const SPEC = [{ id: "rel", type: "choice", prompt: "p", options: ["same_obligation", "unrelated"] }];
  const reply = `Here is my analysis:\n\`\`\`json\n{"answers": {"rel": {"choice": "same_obligation"}}}\n\`\`\`\nDone.`;
  assert.deepEqual(parseAnswers(reply, SPEC).answers, { rel: { choice: "same_obligation" } });
  assert.equal(parseAnswers("no json at all", SPEC).ok, false);
  assert.equal(parseAnswers('{"answers": {"made_up": {"choice": "same_obligation"}}}', SPEC).ok, false);
  assert.equal(parseAnswers('{"answers": {"rel": {"choice": "vibes"}}}', SPEC).ok, false, "out-of-option choices are refused, not clamped");
});

// ---- classify against stub fetch -----------------------------------------------------

test("classify: happy path hits the evaluation endpoint and returns chargeable usage", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jevReply({ rel: { type: "choice", choice: "same_obligation" } }, { promptTokens: 120, completionTokens: 8 });
  };
  const result = await classify({ questions: [{ id: "rel", type: "choice", prompt: "Compare A to B", options: ["same_obligation", "unrelated"] }], state: "state text", apiKey: KEY, fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.answers, { rel: { choice: "same_obligation" } });
  assert.deepEqual(result.usage, { modelCalls: 1, promptTokens: 120, completionTokens: 8 }, "usage is chargeable to the improvement budget");
  assert.equal(calls[0].url, evaluationUrl(gatewayConfig({ env: {} }).baseUrl));
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0].options.body);
  assert.ok(body.state.includes("state text"));
});

test("classify: transport, HTTP, and unusable-reply failures never invent answers", async () => {
  const networkDown = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.equal((await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, fetchImpl: networkDown })).ok, false);
  const httpError = async () => ({ ok: false, status: 403, text: async () => "customer_verification_required", json: async () => ({}) });
  const denied = await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, fetchImpl: httpError });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  const empty = async () => jevReply({});
  const unusable = await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, fetchImpl: empty });
  assert.equal(unusable.ok, false, "a reply with no answers is an error, never a guess");
  assert.match(unusable.error, /no answer given/);
  assert.equal((await classify({ questions: SPEC_ONE, state: "s", apiKey: null, fetchImpl: okResponse })).error.includes("no AI gateway key"), true);
});

test("classify: the timeout aborts the request", async () => {
  const slow = (url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("This operation was aborted")));
      setTimeout(() => resolve(jevReply({})), 5000);
    });
  const result = await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, config: { ...gatewayConfig({ env: {} }), timeoutMs: 50 }, fetchImpl: slow });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("gateway request failed"));
});

test("listModels reads the gateway catalog and flags jev-shaped ids", async () => {
  const fetchImpl = async (url, options) => {
    assert.ok(url.endsWith("/models"));
    assert.equal(options.headers.authorization, `Bearer ${KEY}`);
    return okResponse({ data: [{ id: "openai/gpt-5.5" }, { id: "typesafe-ai/jev" }] });
  };
  const result = await listModels({ apiKey: KEY, fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.jevCandidates, ["typesafe-ai/jev"]);
});

const SPEC_ONE = [{ id: "rel", type: "choice", prompt: "Compare A to B", options: ["same_obligation", "unrelated"] }];

// ---- SYSTEM ONE ONLY: the gateway key talks to Jev and nothing else -------------

test("the gateway route is Jev-only: a non-Jev model is refused before any network call", async () => {
  assert.equal(isJevModel("typesafe-ai/jev"), true);
  assert.equal(isJevModel("jev-1.13.0"), true);
  assert.equal(isJevModel("typesafe-ai/jev-1.14"), true);
  assert.equal(isJevModel("openai/gpt-5.5"), false, "the vendor onboarding example must never ride this key");
  assert.equal(isJevModel("zai/glm-5.3"), false);
  const noNetwork = async () => {
    throw new Error("network must not be touched");
  };
  const refused = await classify({
    questions: SPEC_ONE,
    state: "s",
    apiKey: KEY,
    config: { ...gatewayConfig({ env: {} }), model: "openai/gpt-5.5" },
    fetchImpl: noNetwork,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.refused, "jev-only");
  assert.match(refused.error, /Jev-only/);
  assert.equal((await listModels({ apiKey: KEY, config: { ...gatewayConfig({ env: {} }), model: "openai/gpt-5.5" }, fetchImpl: noNetwork })).refused, "jev-only");
  const calls = [];
  const through = async (url, options) => {
    calls.push({ url, modelId: options.headers["ai-model-id"], body: JSON.parse(options.body) });
    return jevReply({ rel: { type: "choice", choice: "same_obligation" } }, {});
  };
  assert.equal((await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, fetchImpl: through })).ok, true, "the pinned default is a Jev model and goes through");
  assert.equal(calls[0].modelId, DEFAULT_JEV_MODEL);
  assert.equal(calls[0].url, evaluationUrl(gatewayConfig({ env: {} }).baseUrl));
});

// ---- the pure builders: self-contained questions, conservative interpretation -----

test("the relationship question names BOTH sides in its text (the model never sees ids)", () => {
  const { question, stateContext } = relationshipQuestion({
    observation: { text: "Restore the tar torch catalog descriptions", source: "chat" },
    candidate: { title: "Restore tar torch and stick catalog descriptions", status: "open", remaining: ["a regression test"] },
  });
  assert.ok(question.prompt.includes("Restore the tar torch catalog descriptions"));
  assert.ok(question.prompt.includes("Restore tar torch and stick catalog descriptions"));
  assert.deepEqual([...question.options].sort(), [...RELATIONSHIP_OPTIONS].sort());
  assert.ok(stateContext.includes("a regression test"));
});

// ---- retrieval: only overlapping work is worth a classification call -------------

test("retrieveCandidate picks the best overlap and refuses near-zero-overlap comparisons", () => {
  const existing = [
    { kind: "task", title: "Register V5 storeys in the world carve" },
    { kind: "task", title: "Restore the tar torch catalog descriptions in the world" },
  ];
  const hit = retrieveCandidate({ title: "Restore tar torch and stick catalog descriptions!", existing });
  assert.ok(hit, "enough shared words to bother classifying");
  assert.equal(hit.item.title, "Restore the tar torch catalog descriptions in the world");
  assert.ok(hit.overlap >= 2);
  assert.equal(retrieveCandidate({ title: "Golf scorecard tracking", existing }), null, "no overlap: no call, no comparison");
  assert.equal(retrieveCandidate({ title: "Restore tar torch catalog", existing: [{ title: "Completely different topic here" }] }), null);
  // the strongest candidate wins even when several clear the floor
  const best = retrieveCandidate({
    title: "Restore tar torch catalog descriptions",
    existing: [{ title: "Restore tar torch catalog descriptions now" }, { title: "Restore tar torch descriptions somewhere" }],
  });
  assert.equal(best.item.title, "Restore tar torch catalog descriptions now");
  assert.equal(retrieveCandidate({ title: "", existing }), null);
  assert.equal(retrieveCandidate({ title: "Fix the auditor", existing: "not-a-list" }), null);
});

test("interpretation is conservative: only exact matches attach; ambiguity holds for review", () => {
  assert.equal(interpretRelationship({ choice: "same_obligation" }).action, "attach-observation");
  assert.equal(interpretRelationship({ choice: "same_obligation" }).mergesRecords, false, "attaching evidence never merges records");
  assert.equal(interpretRelationship({ choice: "adds_scope" }).action, "propose-linked-follow-up");
  assert.equal(interpretRelationship({ choice: "related_but_distinct" }).action, "keep-separate");
  assert.equal(interpretRelationship({ choice: "unrelated" }).action, "keep-separate");
  assert.equal(interpretRelationship({ choice: "conflicts_with_existing" }).action, "flag-conflict");
  assert.equal(interpretRelationship({ choice: "insufficient_context" }).action, "hold-for-review");
  assert.equal(interpretRelationship({}).action, "hold-for-review", "a missing/invalid answer never becomes an action");
});

test("message classification routes claims to verification — a claim is not evidence", () => {
  const { question } = messageKindQuestion({ text: "I fixed the auditor", source: "builder" });
  assert.ok(question.prompt.includes("I fixed the auditor"));
  assert.deepEqual([...question.options].sort(), [...MESSAGE_KINDS].sort());
  assert.equal(interpretMessageKind({ choice: "claimed_resolution" }).action, "route-to-verification");
  assert.equal(interpretMessageKind({ choice: "progress" }).action, "journal");
  assert.equal(interpretMessageKind({ choice: "explicit_request" }).action, "admit-request");
  assert.equal(interpretMessageKind({ choice: "nonsense" }).action, "hold-for-review");
});

// ---- the wiring keeps the key off disk and out of logs -----------------------------

test("the gateway key follows the studio's keystore contract", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  assert.match(source, /--set-gateway-key/);
  assert.match(source, /gatewayApiKeyEncrypted/);
  assert.match(source, /MEFI_STUDIO_GATEWAY_KEY/);
  assert.match(source, /refusing to store the key in plaintext/);
  // status only ever crosses IPC as a boolean
  assert.match(source, /Status only — a saved key never crosses IPC/);
});

// ---- shadow intake: proposals are recorded, never acted on -------------------------

test("the shadow intake is observation-only: fire-and-forget, kill-switched, capped, budget-charged", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  // hooked at the single admission point, after the gateway mutation, never awaited
  assert.match(source, /jevShadowIntake\(additions\);/);
  assert.doesNotMatch(source, /await jevShadowIntake/);
  // operator kill switch and smoke silence
  assert.match(source, /settings\.jevShadow === false/);
  const intake = source.slice(source.indexOf("function jevShadowIntake"), source.indexOf("function policyActionDescriptor"));
  assert.match(intake, /if \(SMOKE \|\| CAPTURE \|\| CLI_MODE\) return;/);
  // rate limiting, per-pass cap, failure backoff
  assert.match(intake, /JEV_SHADOW_MIN_INTERVAL_MS/);
  assert.match(intake, /comparisons\.length >= JEV_SHADOW_MAX_PROPOSALS/);
  assert.match(intake, /jevShadowBackedOffUntil = Date\.now\(\) \+ JEV_SHADOW_BACKOFF_MS/);
  // retrieval before any call; one batched call; recorded as experience events
  assert.match(intake, /retrieveCandidate\(/);
  assert.match(intake, /client\.classify\(\{ questions, state: stateContext/);
  assert.match(intake, /policyRecord\("jev-proposal"/);
  // every call is charged to the global improvement budget
  assert.match(intake, /purpose: "jev-shadow-intake"/);
});

// ---- live half: only with an exported key, skipped otherwise ------------------------

const liveKey = process.env.AI_GATEWAY_API_KEY;
const liveTest = liveKey ? test : test.skip;

liveTest("live: the gateway resolves the pinned Jev model (no card = a named billing error)", async () => {
  const result = await classify({
    questions: SPEC_ONE,
    state: "observation: fix the thing\ncandidate: fix the thing",
    apiKey: liveKey,
  });
  if (!result.ok) {
    // A billing/verification gate is a NAMED account state, not a setup failure.
    assert.match(result.error, /HTTP \d{3}/);
    return;
  }
  assert.equal(result.ok, true);
  assert.equal(typeof result.answers.rel.choice, "string");
});
