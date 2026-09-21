// The Jev decision client and its pure classification builders: bounded
// config, key resolution that never leaks, the AI Gateway's evaluation wire
// (Jev is an evaluation model — chat/completions is the wrong surface),
// strict answer validation (an out-of-contract reply is an error, never a
// guess), conservative interpretation (ambiguity keeps work separate), and a
// live half that requires MEFI_JEV_LIVE_TEST=1 and AI_GATEWAY_API_KEY.
//
// Run: node --test tests/   (or npm test)

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_JEV_MODEL,
  DEFAULT_JEV_ROUTE,
  JEV_ROUTES,
  buildClassifyRequest,
  buildEvaluationRequest,
  buildSystemoneRequest,
  classify,
  decisionsUrl,
  evaluationUrl,
  gatewayConfig,
  isJevModel,
  isJevRoute,
  listModels,
  normalizeJevRoute,
  parseAnswers,
  resolveApiKey,
  resolveJevRoute,
  systemoneUrl,
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
  assert.equal(defaults.route, "vercel");
  assert.equal(defaults.routeLabel, "Vercel AI Gateway");
  assert.equal(defaults.protocol, "evaluation");
  assert.equal(defaults.timeoutMs, 15000);
  const overridden = gatewayConfig({ env: { MEFI_JEV_MODEL: "typesafe-ai/jev-next", MEFI_AI_GATEWAY_BASE_URL: "https://proxy.example/v1/", MEFI_JEV_TIMEOUT_MS: "1" } });
  assert.equal(overridden.model, "typesafe-ai/jev-next");
  assert.equal(overridden.baseUrl, "https://proxy.example/v1", "trailing slash stripped");
  assert.equal(overridden.timeoutMs, 1000, "timeout clamps to its floor, never zero");
  assert.equal(gatewayConfig({ env: { MEFI_JEV_TIMEOUT_MS: "", MEFI_JEV_MAX_STATE_CHARS: " " } }).timeoutMs, 15000, "empty shell overrides retain defaults");
});

test("routes: every hosted Jev route has its own endpoint, model and env", () => {
  const direct = gatewayConfig({ env: {}, route: "typesafe" });
  assert.equal(direct.route, "typesafe");
  assert.equal(direct.routeLabel, "TypeSafe Jev API");
  assert.equal(direct.protocol, "systemone");
  assert.equal(direct.baseUrl, "https://api.typesafe.ai/v1");
  assert.equal(direct.model, "jev-1.13.0");
  const zen = gatewayConfig({ env: {}, route: "zen" });
  assert.equal(zen.routeLabel, "OpenCode Zen");
  assert.equal(zen.protocol, "systemone", "Zen serves the same systemone wire as TypeSafe");
  assert.equal(zen.baseUrl, "https://opencode.ai/zen/v1");
  assert.equal(zen.model, "jev-1.13");
  assert.equal(zen.modelsUrl, "https://opencode.ai/zen/v1/models");
  const openrouter = gatewayConfig({ env: {}, route: "openrouter" });
  assert.equal(openrouter.routeLabel, "OpenRouter");
  assert.equal(openrouter.protocol, "decisions", "OpenRouter serves Jev through its Decisions API");
  assert.equal(openrouter.baseUrl, "https://openrouter.ai/api/alpha");
  assert.equal(openrouter.model, "typesafe/jev-1.13");
  assert.equal(openrouter.modelsUrl, "https://openrouter.ai/api/v1/models", "the models list lives outside the alpha decisions path");
  assert.equal(gatewayConfig({ env: { MEFI_JEV_ROUTE: "typesafe" } }).route, "typesafe", "the env selects the route");
  assert.equal(gatewayConfig({ env: { MEFI_JEV_ROUTE: "typesafe" }, route: "vercel" }).route, "vercel", "an explicit route wins over the env");
  assert.equal(gatewayConfig({ env: { MEFI_JEV_ROUTE: "nope" } }).route, "vercel", "an unknown env route falls back, never guesses");
  assert.equal(gatewayConfig({ env: {}, route: "TYPESAFE" }).route, "typesafe", "route names are case-insensitive");
  assert.deepEqual(Object.keys(JEV_ROUTES).sort(), ["openrouter", "typesafe", "vercel", "zen"]);
  for (const [id, preset] of Object.entries(JEV_ROUTES)) {
    assert.equal(preset.id, id);
    assert.ok(isJevModel(preset.model), `${id}'s pinned model is Jev-shaped`);
    assert.ok(preset.envKeys.length > 0 && preset.keyHint.length > 0);
  }
});

test("route helpers keep the set closed and the default stable", () => {
  assert.equal(DEFAULT_JEV_ROUTE, "vercel");
  assert.equal(isJevRoute("vercel"), true);
  assert.equal(isJevRoute("typesafe"), true);
  assert.equal(isJevRoute("zen"), true);
  assert.equal(isJevRoute("openrouter"), true);
  assert.equal(isJevRoute(" TYPESAFE "), true);
  assert.equal(isJevRoute("vivgrid"), false);
  assert.equal(isJevRoute(""), false);
  assert.equal(normalizeJevRoute("nope"), "vercel");
  assert.equal(normalizeJevRoute("typesafe"), "typesafe");
  assert.equal(normalizeJevRoute("openrouter"), "openrouter");
  assert.equal(resolveJevRoute({ jevRoute: "typesafe" }, {}), "typesafe");
  assert.equal(resolveJevRoute({ jevRoute: "zen" }, {}), "zen");
  assert.equal(resolveJevRoute({ jevRoute: "typesafe" }, { MEFI_JEV_ROUTE: "vercel" }), "vercel");
  assert.equal(resolveJevRoute({ jevRoute: "garbage" }, {}), "vercel");
  assert.equal(resolveJevRoute(null, {}), "vercel");
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
  assert.deepEqual(resolveApiKey({ env: { MEFI_STUDIO_GATEWAY_KEY: " studio-key " } }), { key: "studio-key", via: "env" });
  assert.deepEqual(resolveApiKey({ env: { AI_GATEWAY_API_KEY: "api-key", MEFI_STUDIO_GATEWAY_KEY: "studio-key" } }), { key: "api-key", via: "env" });
  assert.equal(resolveApiKey({ env: {}, settings: { gatewayApiKeyEncrypted: "x" }, decrypt: () => { throw new Error("keystore locked"); } }), null);
  const longKey = "x".repeat(400);
  assert.equal(resolveApiKey({ env: { AI_GATEWAY_API_KEY: longKey } }).key, longKey, "credentials are never truncated");
});

test("key resolution follows the route: a key is never sent to the other endpoint", () => {
  const decrypt = (_settings, field) => ({
    gatewayApiKeyEncrypted: "gateway-key", jevApiKeyEncrypted: "typesafe-key",
    zenApiKeyEncrypted: "zen-key", openrouterApiKeyEncrypted: "openrouter-key",
  }[field] ?? null);
  assert.deepEqual(resolveApiKey({ env: { TYPESAFE_API_KEY: "env-typesafe" }, route: "typesafe" }), { key: "env-typesafe", via: "env" });
  assert.deepEqual(resolveApiKey({ env: { MEFI_STUDIO_JEV_KEY: " studio-jev " }, route: "typesafe" }), { key: "studio-jev", via: "env" });
  assert.deepEqual(resolveApiKey({ env: {}, settings: { jevApiKeyEncrypted: "x" }, decrypt, route: "typesafe" }), { key: "typesafe-key", via: "settings" });
  assert.deepEqual(resolveApiKey({ env: {}, settings: { gatewayApiKeyEncrypted: "x" }, decrypt, route: "vercel" }), { key: "gateway-key", via: "settings" });
  assert.deepEqual(resolveApiKey({ env: { OPENCODE_ZEN_API_KEY: "env-zen" }, route: "zen" }), { key: "env-zen", via: "env" });
  assert.deepEqual(resolveApiKey({ env: { MEFI_STUDIO_ZEN_KEY: " studio-zen " }, route: "zen" }), { key: "studio-zen", via: "env" });
  assert.deepEqual(resolveApiKey({ env: {}, settings: { zenApiKeyEncrypted: "x" }, decrypt, route: "zen" }), { key: "zen-key", via: "settings" });
  assert.deepEqual(resolveApiKey({ env: { OPENROUTER_API_KEY: "env-openrouter" }, route: "openrouter" }), { key: "env-openrouter", via: "env" });
  assert.deepEqual(resolveApiKey({ env: { MEFI_STUDIO_OPENROUTER_KEY: " studio-or " }, route: "openrouter" }), { key: "studio-or", via: "env" });
  assert.deepEqual(resolveApiKey({ env: {}, settings: { openrouterApiKeyEncrypted: "x" }, decrypt, route: "openrouter" }), { key: "openrouter-key", via: "settings" });
  assert.equal(resolveApiKey({ env: {}, settings: { gatewayApiKeyEncrypted: "x" }, decrypt, route: "typesafe" }), null, "the gateway key is not a Jev API key");
  assert.equal(resolveApiKey({ env: { AI_GATEWAY_API_KEY: "gateway-env" }, route: "typesafe" }), null, "gateway env keys never authorize the Jev API route");
  assert.equal(resolveApiKey({ env: { TYPESAFE_API_KEY: "typesafe-env" }, route: "vercel" }), null, "Jev API env keys never authorize the gateway route");
  assert.equal(resolveApiKey({ env: { OPENCODE_ZEN_API_KEY: "zen-env" }, route: "openrouter" }), null, "Zen keys never authorize OpenRouter");
  assert.equal(resolveApiKey({ env: { OPENROUTER_API_KEY: "or-env" }, route: "zen" }), null, "OpenRouter keys never authorize Zen");
  assert.equal(resolveApiKey({ env: {}, settings: { zenApiKeyEncrypted: "x" }, decrypt, route: "typesafe" }), null);
  assert.deepEqual(resolveApiKey({ env: { MEFI_JEV_ROUTE: "typesafe", TYPESAFE_API_KEY: "k" } }), { key: "k", via: "env" }, "the env route selects its own credential");
  assert.deepEqual(resolveApiKey({ env: { MEFI_JEV_ROUTE: "typesafe" }, settings: { jevApiKeyEncrypted: "x" }, decrypt }), { key: "typesafe-key", via: "settings" });
  assert.deepEqual(resolveApiKey({ env: { MEFI_JEV_ROUTE: "openrouter" }, settings: { openrouterApiKeyEncrypted: "x" }, decrypt }), { key: "openrouter-key", via: "settings" });
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
  const clipped = buildEvaluationRequest({ config: { ...config, maxStateChars: 100 }, questions: SPEC_ONE, state: "x".repeat(5000) });
  assert.ok(clipped.body.state.length <= 100);
  // score has no wire mapping yet — a clear error, not a mangled question
  assert.throws(
    () => buildEvaluationRequest({ config, questions: [{ id: "s", type: "score", prompt: "p", levels: "l" }], state: "s" }),
    /score questions are not mapped/
  );
});

test("buildSystemoneRequest: the Jev API wire names the model in the body and keeps noul", () => {
  const config = { ...gatewayConfig({ env: {}, route: "typesafe" }), apiKey: KEY };
  const request = buildSystemoneRequest({
    config,
    questions: [
      { id: "rel", type: "choice", prompt: "Compare A to B", options: ["same_obligation", "unrelated"] },
      { id: "worth", type: "noul", prompt: "Is it blocked?" },
    ],
    state: "state text",
  });
  assert.equal(request.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(request.headers.authorization, `Bearer ${KEY}`);
  assert.equal(request.headers["ai-model-id"], undefined, "no gateway protocol headers on the direct wire");
  assert.equal(request.headers["ai-evaluation-model-specification-version"], undefined);
  assert.equal(request.body.model, "jev-1.13.0", "the direct API names the model in the body");
  assert.deepEqual(request.body.questions.rel, { type: "choice", instructions: "Compare A to B", criteria: { same_obligation: "same_obligation", unrelated: "unrelated" } });
  assert.deepEqual(request.body.questions.worth, { type: "noul", instructions: "Is it blocked?" }, "the direct API names the yes/no type noul");
  assert.equal(Object.keys(request.body).sort().join(","), "model,questions,state");
  const clipped = buildSystemoneRequest({ config: { ...config, maxStateChars: 100 }, questions: SPEC_ONE, state: "x".repeat(5000) });
  assert.ok(clipped.body.state.length <= 100);
  assert.throws(
    () => buildSystemoneRequest({ config, questions: [{ id: "s", type: "score", prompt: "p", levels: "l" }], state: "s" }),
    /not mapped to the Jev API wire/
  );
  assert.equal(buildClassifyRequest({ config, questions: SPEC_ONE, state: "s" }).url, systemoneUrl(config.baseUrl));
  assert.equal(buildClassifyRequest({ config: { ...config, protocol: "evaluation" }, questions: SPEC_ONE, state: "s" }).url, evaluationUrl(config.baseUrl));
  assert.equal(systemoneUrl("https://proxy.example/v9"), "https://proxy.example/v9/systemone");
  assert.equal(systemoneUrl("https://proxy.example/"), "https://proxy.example/systemone");
});

test("Zen and OpenRouter reuse the direct wire at their own endpoints", () => {
  const zenConfig = { ...gatewayConfig({ env: {}, route: "zen" }), apiKey: KEY };
  const zen = buildClassifyRequest({
    config: zenConfig,
    questions: [{ id: "rel", type: "choice", prompt: "Compare A to B", options: ["same_obligation", "unrelated"] }],
    state: "state text",
  });
  assert.equal(zen.url, "https://opencode.ai/zen/v1/systemone");
  assert.equal(zen.body.model, "jev-1.13");
  assert.equal(zen.body.questions.rel.type, "choice");
  const openrouterConfig = { ...gatewayConfig({ env: {}, route: "openrouter" }), apiKey: KEY };
  const openrouter = buildClassifyRequest({
    config: openrouterConfig,
    questions: [{ id: "rel", type: "noul", prompt: "Is it blocked?" }],
    state: "state text",
  });
  assert.equal(openrouter.url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(openrouter.body.model, "typesafe/jev-1.13");
  assert.deepEqual(openrouter.body.questions.rel, { type: "noul", instructions: "Is it blocked?" });
  assert.equal(decisionsUrl("https://openrouter.ai/api/alpha"), "https://openrouter.ai/api/alpha/decisions");
  assert.equal(decisionsUrl("https://proxy.example/v9/"), "https://proxy.example/v9/decisions");
  assert.equal(buildClassifyRequest({ config: { ...zenConfig, protocol: "decisions" }, questions: SPEC_ONE, state: "s" }).url, decisionsUrl(zenConfig.baseUrl));
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
  // TypeSafe's own API answers the yes/no type as noul/noul — same range check.
  const direct = validateWireAnswers(
    { rel: { type: "choice", choice: "unrelated", confidence: 0.9 }, blocked: { type: "noul", noul: 0.75 } },
    specs
  );
  assert.equal(direct.ok, true);
  assert.deepEqual(direct.answers, { rel: { choice: "unrelated" }, blocked: { noul: 0.75 } });
  assert.equal(validateWireAnswers({ rel: { type: "choice", choice: "unrelated" }, blocked: { type: "noul", noul: 1.5 } }, specs).ok, false);
  assert.equal(validateWireAnswers({ rel: { type: "choice", choice: "unrelated" }, blocked: { noul: 0.5 } }, specs).ok, false, "an untyped answer is refused on both wires");
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

test("strict validation never converts missing values or strings into decisions", () => {
  const probabilitySpec = [{ id: "p", type: "noul", prompt: "Does the evidence prove completion?" }];
  for (const probability of [null, false, true, "0.5", "", [], {}, undefined, NaN, Infinity]) {
    assert.equal(validateWireAnswers({ p: { type: "boolean", probability } }, probabilitySpec).ok, false);
    assert.equal(parseAnswers(JSON.stringify({ answers: { p: { noul: probability } } }), probabilitySpec).ok, false);
  }
  for (const choice of [" same_obligation", "same_obligation ", null, 1]) {
    assert.equal(validateWireAnswers({ rel: { type: "choice", choice } }, SPEC_ONE).ok, false);
  }
  const scoreSpec = [{ id: "score", type: "score", prompt: "Assess relevance", levels: "0 absent; 100 certain" }];
  assert.equal(parseAnswers('{"answers":{"score":{"score":null}}}', scoreSpec).ok, false);
  assert.ok(Array.isArray(parseAnswers("{invalid json}", SPEC_ONE).errors));
});

test("invalid specs and duplicate ids are refused before spending a request", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("must not call"); };
  for (const questions of [
    [],
    [SPEC_ONE[0], SPEC_ONE[0]],
    [{ ...SPEC_ONE[0], id: 123 }],
    [{ ...SPEC_ONE[0], prompt: {} }],
    [{ ...SPEC_ONE[0], options: [1, 2] }],
    [{ ...SPEC_ONE[0], options: ["yes", "no", ""] }],
    [{ ...SPEC_ONE[0], options: [" yes", "no"] }],
    [{ ...SPEC_ONE[0], options: ["x".repeat(61), "no"] }],
  ]) {
    const result = await classify({ questions, state: "s", apiKey: KEY, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.usage, undefined);
  }
  assert.equal(calls, 0);
});

test("question ids that match object properties round-trip without inherited answers", async () => {
  const questions = ["__proto__", "constructor", "toString"].map((id) => ({ ...SPEC_ONE[0], id }));
  const answers = Object.fromEntries(questions.map(({ id }) => [id, { type: "choice", choice: "unrelated" }]));
  const result = await classify({
    questions, state: "s", apiKey: KEY,
    fetchImpl: async (url, options) => {
      assert.deepEqual(Object.keys(JSON.parse(options.body).questions), questions.map(({ id }) => id));
      return jevReply(answers);
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.answers), questions.map(({ id }) => id));
  assert.equal(validateWireAnswers({}, questions).ok, false);
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

test("classify routes through TypeSafe's Jev API and accepts its noul answers", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return okResponse({
      model: "jev-1.13.0",
      answers: {
        rel: { type: "choice", choice: "same_obligation", confidence: 0.8, probabilities: { same_obligation: 0.87, unrelated: 0.13 } },
        blocked: { type: "noul", noul: 0.25, confidence: 0.5 },
      },
      usage: { input_tokens: 120, output_tokens: 8 },
    });
  };
  const questions = [
    { id: "rel", type: "choice", prompt: "Compare A to B", options: ["same_obligation", "unrelated"] },
    { id: "blocked", type: "noul", prompt: "Is it blocked?" },
  ];
  const result = await classify({ questions, state: "state text", apiKey: KEY, config: gatewayConfig({ env: {}, route: "typesafe" }), fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.answers, { rel: { choice: "same_obligation" }, blocked: { noul: 0.25 } });
  assert.equal(result.model, "jev-1.13.0", "the versioned model that answered is reported");
  assert.deepEqual(result.usage, { modelCalls: 1, promptTokens: 120, completionTokens: 8 });
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].options.headers["ai-model-id"], undefined);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "jev-1.13.0");
  assert.equal(body.questions.blocked.type, "noul");
  // A versioned answer id outside the Jev family never replaces the pin.
  const stranger = await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, config: gatewayConfig({ env: {}, route: "typesafe" }),
    fetchImpl: async () => okResponse({ model: "gpt-5.5", answers: { rel: { type: "choice", choice: "unrelated" } }, usage: {} }) });
  assert.equal(stranger.ok, true);
  assert.equal(stranger.model, "jev-1.13.0");
});

test("classify reaches Zen and OpenRouter on their own wires and reports their model", async () => {
  for (const [route, url, model] of [
    ["zen", "https://opencode.ai/zen/v1/systemone", "jev-1.13"],
    ["openrouter", "https://openrouter.ai/api/alpha/decisions", "typesafe/jev-1.13"],
  ]) {
    const calls = [];
    const result = await classify({
      questions: [{ id: "rel", type: "noul", prompt: "Is it blocked?" }],
      state: "state text",
      apiKey: KEY,
      config: gatewayConfig({ env: {}, route }),
      fetchImpl: async (requestUrl, options) => {
        calls.push({ url: requestUrl, body: JSON.parse(options.body) });
        return okResponse({ model, answers: { rel: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 20, output_tokens: 0 } });
      },
    });
    assert.equal(result.ok, true, route);
    assert.equal(calls[0].url, url);
    assert.equal(calls[0].body.model, model);
    assert.deepEqual(result.answers, { rel: { noul: 0.5 } });
    assert.equal(result.model, model, "the answering model is reported per route");
    assert.deepEqual(result.usage, { modelCalls: 1, promptTokens: 20, completionTokens: 0 });
  }
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
  assert.match((await classify({ questions: SPEC_ONE, state: "s", apiKey: null, fetchImpl: okResponse })).error, /no Jev key configured/);
  const directMissing = await classify({ questions: SPEC_ONE, state: "s", apiKey: null, config: gatewayConfig({ env: {}, route: "typesafe" }), fetchImpl: okResponse });
  assert.match(directMissing.error, /no Jev key configured for the TypeSafe Jev API route/);
});

test("classify: the timeout aborts the request", async () => {
  let observedSignal;
  const slow = (url, options) =>
    new Promise((resolve, reject) => {
      observedSignal = options.signal;
      options.signal.addEventListener("abort", () => reject(new Error("This operation was aborted")));
    });
  const result = await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, config: { ...gatewayConfig({ env: {} }), timeoutMs: 50 }, fetchImpl: slow });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("gateway request failed"));
  assert.equal(observedSignal.aborted, true);
  assert.equal(result.usage.modelCalls, 1, "a timed-out attempt still consumes the call budget");
});

test("deadlines include stuck response bodies and transports that ignore abort", { timeout: 3000 }, async () => {
  for (const fetchImpl of [
    async () => new Promise(() => {}),
    async () => ({ ok: true, json: () => new Promise(() => {}) }),
    async () => ({ ok: false, status: 503, text: () => new Promise(() => {}) }),
  ]) {
    const result = await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, config: { timeoutMs: 20 }, fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.error, /timed out/);
    assert.equal(result.usage.modelCalls, 1);
    const catalog = await listModels({ apiKey: KEY, config: { timeoutMs: 20 }, fetchImpl });
    assert.equal(catalog.ok, false);
    assert.match(catalog.error, /timed out/);
  }
});

test("token usage follows the evaluation protocol and survives invalid answers", async () => {
  const result = await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, fetchImpl: async () => jevReply({}, { inputTokens: 120, outputTokens: 8 }) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.usage, { modelCalls: 1, promptTokens: 120, completionTokens: 8 });
  const missing = await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, fetchImpl: async () => jevReply({ rel: { type: "choice", choice: "unrelated" } }, { inputTokens: null, outputTokens: -2 }) });
  assert.deepEqual(missing.usage, { modelCalls: 1, promptTokens: null, completionTokens: null }, "missing/invalid counts stay unknown, never zero or negative");
});

test("gateway diagnostics redact credentials and do not return raw response bodies", async () => {
  for (const fetchImpl of [
    async () => { throw new Error(`network error ${KEY}`); },
    async () => ({ ok: false, status: 403, text: async () => `denied: ${KEY}` }),
    async () => ({ ok: true, json: async () => { throw new Error(`bad body ${KEY}`); } }),
    async () => jevReply({ rel: { type: "choice", choice: KEY } }),
  ]) {
    const result = await classify({ questions: SPEC_ONE, state: "s", apiKey: KEY, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(KEY), false);
    assert.equal(result.raw, undefined);
  }
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

test("listModels refuses malformed catalogs and flags only allowed Jev model ids", async () => {
  for (const body of [null, {}, { data: "invalid" }]) {
    assert.equal((await listModels({ apiKey: KEY, fetchImpl: async () => okResponse(body) })).ok, false);
  }
  const result = await listModels({ apiKey: KEY, fetchImpl: async () => okResponse({ data: [{ id: "typesafe-ai/jev" }, { id: "typesafe-ai/jev" }, { id: "other/jevish" }, {}] }) });
  assert.deepEqual(result.jevCandidates, ["typesafe-ai/jev"]);
  assert.deepEqual(result.models, ["typesafe-ai/jev", "other/jevish"]);
});

test("listModels follows the route's catalog URL", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return okResponse({ data: [{ id: "typesafe/jev-1.13" }, { id: "openai/gpt-5.5" }] });
  };
  const zen = await listModels({ apiKey: KEY, config: gatewayConfig({ env: {}, route: "zen" }), fetchImpl });
  assert.equal(urls[0], "https://opencode.ai/zen/v1/models");
  assert.deepEqual(zen.jevCandidates, ["typesafe/jev-1.13"]);
  const openrouter = await listModels({ apiKey: KEY, config: gatewayConfig({ env: {}, route: "openrouter" }), fetchImpl });
  assert.equal(urls[1], "https://openrouter.ai/api/v1/models", "the public OpenRouter catalog, not the alpha decisions path");
  assert.deepEqual(openrouter.jevCandidates, ["typesafe/jev-1.13"]);
  const overridden = gatewayConfig({ env: { MEFI_AI_GATEWAY_BASE_URL: "https://proxy.example/v1" }, route: "zen" });
  assert.equal(overridden.modelsUrl, "https://proxy.example/v1/models", "a base URL override moves the catalog with the route");
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
  assert.equal(retrieveCandidate({ title: "Fix scheduler startup", existing: [{ title: "scheduler scheduler scheduler" }] }), null, "repeated words cannot inflate overlap into a paid comparison");
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

test("the Jev keys follow the studio's keystore contract", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  assert.match(source, /--set-gateway-key/);
  assert.match(source, /gatewayApiKeyEncrypted/);
  assert.match(source, /MEFI_STUDIO_GATEWAY_KEY/);
  assert.match(source, /--set-jev-key/);
  assert.match(source, /jevApiKeyEncrypted/);
  assert.match(source, /MEFI_STUDIO_JEV_KEY/);
  assert.match(source, /--set-zen-key/);
  assert.match(source, /zenApiKeyEncrypted/);
  assert.match(source, /OPENCODE_ZEN_API_KEY/);
  assert.match(source, /--set-openrouter-key/);
  assert.match(source, /openrouterApiKeyEncrypted/);
  assert.match(source, /OPENROUTER_API_KEY/);
  assert.match(source, /refusing to store the key in plaintext/);
  // status only ever crosses IPC as a boolean
  assert.match(source, /Status only — a saved key never crosses IPC/);
});

// ---- shadow intake: proposals are recorded, never acted on -------------------------

test("the shadow intake stays observation-only and charges the constrained client", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  // hooked at the single admission point, after the gateway mutation, never awaited
  assert.match(source, /jevShadowIntake\(patch\.accepted\);/);
  assert.doesNotMatch(source, /await jevShadowIntake/);
  // operator kill switch and smoke silence
  assert.match(source, /settings\.jevShadow === false/);
  const hook = source.slice(source.indexOf("function jevShadowIntake"), source.indexOf("async function chargeJevCall"));
  assert.match(hook, /if \(SMOKE \|\| CAPTURE \|\| CLI_MODE\) return;/);
  assert.match(hook, /queue\.enqueue\(additions\)/);
  // Queue rate limits/retry behavior and retrieval are exercised in jev_loop.test.mjs.
  const intake = source.slice(source.indexOf("async function runJevIntake"), source.indexOf("async function jevStatus"));
  assert.match(intake, /loop\.planIntake\(additions/);
  assert.match(intake, /client\.classify\(\{ questions, state,/);
  assert.match(intake, /policyRecord\("jev-proposal"/);
  assert.doesNotMatch(intake, /mutateBoard|spawn\(/, "a classification proposal cannot modify or start work");
  // every call is charged to the global improvement budget, and the route it
  // rode names the provider the usage tracker records it under
  assert.match(intake, /chargeJevCall\(result, "jev-shadow-intake", route\)/);
});

// ---- live half: only with an exported key, skipped otherwise ------------------------

const liveKey = process.env.AI_GATEWAY_API_KEY;
const liveTest = process.env.MEFI_JEV_LIVE_TEST === "1" && liveKey ? test : test.skip;

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
