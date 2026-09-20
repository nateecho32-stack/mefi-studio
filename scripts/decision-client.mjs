// Mefi's Studio AI+ — the Jev decision client (TypeSafe classifier over a
// chosen route: the Vercel AI Gateway or TypeSafe's own Jev API).
//
// Jev answers CONSTRAINED questions (choice / score / yes-probability) over
// application state — it never writes prose into the workflow. This client is
// the narrow adapter from the advisory's plan: it resolves the route and its
// key, sends narrowly scoped questions, enforces timeouts and budgets,
// validates every answer against its question spec, and reports real token
// usage so callers can charge the global improvement budget
// (experience.spendBudget).
//
// Boundaries the rest of the studio enforces: an answer is a PROPOSAL. It can
// never suppress work, merge tasks, spawn agents, alter ownership, or settle
// verification — those stay with the board gateway and the receipt runner.
// Invalid or missing answers are errors, never guesses ("type-safe does not
// mean correct").
//
// Dependency-free on purpose: plain `fetch` implements both wires below. Each
// route has its own credential and endpoint; a key is never sent to a route
// it was not saved for. Keys resolve from the route's env names (headless/CLI)
// or its DPAPI-encrypted settings field — the key itself is never logged,
// never stored in a tracked file, and never sent anywhere but the configured
// endpoint.
//
// Routes (settings.jevRoute, MEFI_JEV_ROUTE):
//   vercel   Vercel AI Gateway — POST {origin}/v4/ai/evaluation-model,
//            model id in the `ai-model-id` header (`typesafe-ai/jev`).
//            Key: AI_GATEWAY_API_KEY / MEFI_STUDIO_GATEWAY_KEY /
//            `gatewayApiKeyEncrypted` (electron . --set-gateway-key).
//   typesafe TypeSafe's Jev API directly — POST {base}/systemone, model in
//            the body (`jev-1.13.0`). Key: TYPESAFE_API_KEY /
//            MEFI_STUDIO_JEV_KEY / `jevApiKeyEncrypted`
//            (electron . --set-jev-key).
//
// CLI:
//   node scripts/decision-client.mjs --status   # route + key + config, no network
//   node scripts/decision-client.mjs --models   # list the route's models
//   node scripts/decision-client.mjs --probe    # one minimal classification
//
// The model id is pinned because thresholds are tuned against a pinned
// version. Override with MEFI_JEV_MODEL when the pin moves. A changed model is
// a new experimental condition — never reuse old outcomes as if they measured
// the new one.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const JEVC_CLIENT_VERSION = 3;
export const JEV_DOC_MODEL = "jev-1.13.0";

export const JEV_ROUTES = Object.freeze({
  vercel: Object.freeze({
    id: "vercel",
    label: "Vercel AI Gateway",
    protocol: "evaluation",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    model: "typesafe-ai/jev",
    settingsField: "gatewayApiKeyEncrypted",
    envKeys: Object.freeze(["AI_GATEWAY_API_KEY", "MEFI_STUDIO_GATEWAY_KEY"]),
    keyHint: "set AI_GATEWAY_API_KEY, or run: electron . --set-gateway-key",
  }),
  typesafe: Object.freeze({
    id: "typesafe",
    label: "TypeSafe Jev API",
    protocol: "systemone",
    baseUrl: "https://api.typesafe.ai/v1",
    model: JEV_DOC_MODEL,
    settingsField: "jevApiKeyEncrypted",
    envKeys: Object.freeze(["TYPESAFE_API_KEY", "MEFI_STUDIO_JEV_KEY"]),
    keyHint: "set TYPESAFE_API_KEY, or run: electron . --set-jev-key",
  }),
});
export const DEFAULT_JEV_ROUTE = "vercel";
export const DEFAULT_GATEWAY_BASE_URL = JEV_ROUTES.vercel.baseUrl;
export const DEFAULT_JEV_MODEL = JEV_ROUTES.vercel.model;
export const QUESTION_TYPES = Object.freeze(["choice", "score", "noul"]);

// SYSTEM ONE ONLY. The Jev key is scoped to Jev — the constrained classifier
// — and to nothing else. Chat replies, briefs, overseer passes and build jobs
// ride the studio's own routes (z.ai GLM / OpenCode Go / Grok); they must never
// touch this key, and a model override that is not a Jev model is refused
// BEFORE any network call. (The gateway vendor's generic onboarding example —
// openai/gpt-5.5 through this key — is deliberately not followed: general
// generation through the classifier's key would blur who judged what, and
// every Jev answer is meant to stay a constrained, attributable,
// budget-metered proposal.)
export const JEV_MODEL_PATTERN = /(^|\/)jev(-|$)/i;

export function isJevModel(model) {
  return JEV_MODEL_PATTERN.test(String(model ?? ""));
}

// ---- routes (no secrets in a route definition) -----------------------------------

export function isJevRoute(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(JEV_ROUTES, value.trim().toLowerCase());
}

export function normalizeJevRoute(value) {
  return isJevRoute(value) ? value.trim().toLowerCase() : DEFAULT_JEV_ROUTE;
}

// Env wins for headless/CI runs; the saved route is the in-app path. An
// unreadable env value falls through to the saved route, never to a guess.
export function resolveJevRoute(settings = null, env = process.env) {
  const fromEnv = String(env?.MEFI_JEV_ROUTE ?? "").trim();
  return normalizeJevRoute(isJevRoute(fromEnv) ? fromEnv : settings?.jevRoute);
}

function assertJevOnly(config) {
  if (!isJevModel(config.model)) {
    throw new Error(
      `the Jev key is Jev-only (System One): "${config.model}" is refused. ` +
        `Set MEFI_JEV_MODEL to a Jev model id (e.g. ${DEFAULT_JEV_MODEL}) or unset it for the pin. ` +
        `Chat and build work belong on the studio's own model routes.`
    );
  }
}

const clipText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ---- configuration (no secrets in the config itself) ----------------------------

export function gatewayConfig({ env = process.env, route = null } = {}) {
  const routeId = route == null || route === "" ? resolveJevRoute(null, env) : normalizeJevRoute(route);
  const preset = JEV_ROUTES[routeId];
  const baseUrl = clipText(env.MEFI_AI_GATEWAY_BASE_URL, 200).replace(/\/+$/, "") || preset.baseUrl;
  const model = clipText(env.MEFI_JEV_MODEL, 80) || preset.model;
  return {
    clientVersion: JEVC_CLIENT_VERSION,
    route: routeId,
    routeLabel: preset.label,
    protocol: preset.protocol,
    baseUrl,
    model,
    timeoutMs: clampNumber(env.MEFI_JEV_TIMEOUT_MS, 1000, 60000, 15000),
    maxStateChars: clampNumber(env.MEFI_JEV_MAX_STATE_CHARS, 200, 60000, 8000),
  };
}

function clampNumber(value, min, max, fallback) {
  if (value == null || (typeof value === "string" && !value.trim())) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

// Env wins (headless, CI, the probe CLI); the DPAPI-encrypted settings field
// is the in-app path. `decrypt` is injected so this module stays Electron-free
// (main.cjs passes its safeStorage-backed decryptKey). The route decides which
// credential is consulted — a gateway key is never sent to the Jev API and a
// Jev API key is never sent to the gateway. Returns null when no key is
// configured for the route — callers decide whether that is an error.
export function resolveApiKey({ env = process.env, settings = null, decrypt = null, route = null } = {}) {
  const preset = JEV_ROUTES[route == null || route === "" ? resolveJevRoute(null, env) : normalizeJevRoute(route)];
  for (const name of preset.envKeys) {
    const value = String(env?.[name] ?? "").trim();
    if (value) return { key: value, via: "env" };
  }
  const encrypted = settings?.[preset.settingsField];
  if (encrypted && typeof decrypt === "function") {
    try {
      const key = decrypt(settings, preset.settingsField);
      if (typeof key === "string" && key.trim()) return { key: key.trim(), via: "settings" };
    } catch {
      // An unreadable OS keystore means unconfigured, never an app-loop crash.
    }
  }
  return null;
}

// ---- question specs --------------------------------------------------------------
// One question the model answers. `prompt` must be self-contained: the model
// never sees the question id, so the texts under comparison are named inside
// the prompt itself (the TypeSafe contract, kept here).

export function validateQuestionSpec(question) {
  const errors = [];
  if (!question || typeof question !== "object" || Array.isArray(question)) return { ok: false, errors: ["question must be an object"] };
  const boundedString = (value, max) => typeof value === "string" && value.trim().length > 0 && value === value.trim() && value.length <= max;
  if (!boundedString(question.id, 60)) errors.push("id must be a nonempty string of at most 60 characters, without outer whitespace");
  if (!boundedString(question.prompt, 4000)) errors.push("prompt required, at most 4000 characters (self-contained: the model never sees the id)");
  if (!QUESTION_TYPES.includes(question.type)) errors.push(`type must be one of ${QUESTION_TYPES.join(", ")}`);
  if (question.type === "choice") {
    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length < 2) errors.push("choice questions need at least two options");
    if (options.length > 255) errors.push("choice questions allow at most 255 options");
    if (options.some((option) => !boundedString(option, 60))) errors.push("choice options must be nonempty strings of at most 60 characters, without outer whitespace");
    if (options.length !== new Set(options).size) errors.push("choice options must be unique");
  }
  if (question.type === "score" && !boundedString(question.levels, 1000)) errors.push("score questions need a levels description");
  return { ok: errors.length === 0, errors };
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) throw new Error("classify: at least one question is required");
  const ids = new Set();
  for (const question of questions) {
    const check = validateQuestionSpec(question);
    if (!check.ok) throw new Error(`invalid question spec: ${check.errors.join("; ")}`);
    if (ids.has(question.id)) throw new Error(`duplicate question id: "${question.id}"`);
    ids.add(question.id);
  }
  return questions;
}

// ---- the request -----------------------------------------------------------------
// Two wires, one contract: state plus id-keyed questions, nothing else. Which
// wire is built follows config.protocol (see JEV_ROUTES).
//
// Vercel AI Gateway (`evaluation`) — the wire the `ai` SDK's gateway provider
// speaks — mirrored here so the studio stays zero-runtime-dependency:
//   POST {origin}/v4/ai/evaluation-model
//   headers: authorization · ai-evaluation-model-specification-version: 4
//            · ai-model-id: <the pinned Jev id>
//   body: { state, questions: { <id>: { type, instructions, criteria? } } }
// Choice criteria is an option→description map; boolean questions carry
// P(true) answers (our "noul"). The chat-completions endpoint is the wrong
// surface for Jev — the gateway rejects evaluation models there.
//
// TypeSafe Jev API (`systemone`) — the direct route:
//   POST {baseUrl}/systemone
//   headers: authorization · content-type
//   body: { model, state, questions: { <id>: { type: "noul"|"choice", … } } }
// The direct API names the yes/no type "noul" on both request and response;
// the gateway adapts it to "boolean" with a `probability` answer.

export function evaluationUrl(baseUrl) {
  const origin = new URL(baseUrl).origin;
  return `${origin}/v4/ai/evaluation-model`;
}

export function systemoneUrl(baseUrl) {
  return `${new URL(baseUrl).href.replace(/\/+$/, "")}/systemone`;
}

function wireQuestionsOf(questions, { booleanNoul }) {
  const wireQuestions = Object.create(null);
  for (const question of questions) {
    if (question.type === "choice") {
      wireQuestions[question.id] = {
        type: "choice",
        instructions: clipText(question.prompt, 4000),
        criteria: Object.fromEntries(question.options.map((option) => [option, option])),
      };
    } else if (question.type === "noul") {
      wireQuestions[question.id] = { type: booleanNoul ? "boolean" : "noul", instructions: clipText(question.prompt, 4000) };
    } else {
      throw new Error(`question "${question.id}": score questions are not mapped to the ${booleanNoul ? "evaluation" : "Jev API"} wire yet (choice and noul are)`);
    }
  }
  return wireQuestions;
}

export function buildEvaluationRequest({ config, questions, state }) {
  validateQuestions(questions);
  const flatState = clipText(typeof state === "string" ? state : JSON.stringify(state), config.maxStateChars);
  return {
    url: evaluationUrl(config.baseUrl),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
      // The gateway protocol/auth headers its SDK client always sends.
      "ai-gateway-protocol-version": "0.0.1",
      "ai-gateway-auth-method": "api-key",
      "ai-evaluation-model-specification-version": "4",
      "ai-model-id": config.model,
      "user-agent": `mefi-studio/${JEVC_CLIENT_VERSION} (jev decision client)`,
    },
    body: { state: flatState, questions: Object.fromEntries(Object.entries(wireQuestionsOf(questions, { booleanNoul: true }))) },
  };
}

export function buildSystemoneRequest({ config, questions, state }) {
  validateQuestions(questions);
  const flatState = clipText(typeof state === "string" ? state : JSON.stringify(state), config.maxStateChars);
  return {
    url: systemoneUrl(config.baseUrl),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
      "user-agent": `mefi-studio/${JEVC_CLIENT_VERSION} (jev decision client)`,
    },
    body: { model: config.model, state: flatState, questions: Object.fromEntries(Object.entries(wireQuestionsOf(questions, { booleanNoul: false }))) },
  };
}

export function buildClassifyRequest(options) {
  return options.config.protocol === "systemone" ? buildSystemoneRequest(options) : buildEvaluationRequest(options);
}

// ---- response validation ---------------------------------------------------------
// Two reply surfaces, one strictness. The evaluation API returns structured
// `answers` (validated by validateWireAnswers); a language-model fallback (a
// non-Jev judge adapted through chat) answers in prose carrying our JSON
// contract (validated by parseAnswers). Both refuse unknown question ids,
// out-of-option choices, and out-of-range values — the caller sees a
// failure, never a creative reinterpretation.

export function validateWireAnswers(answers, questions) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return { ok: false, errors: ["reply missing an answers object"] };
  const specs = new Map(questions.map((question) => [question.id, question]));
  const out = Object.create(null);
  const errors = [];
  for (const [id, value] of Object.entries(answers)) {
    if (!specs.has(id)) {
      errors.push(`answer for unknown question "${id}"`);
      continue;
    }
    const spec = specs.get(id);
    if (spec.type === "choice") {
      if (value?.type !== "choice") {
        errors.push(`"${id}": expected a choice answer`);
        continue;
      }
      const choice = value.choice;
      if (typeof choice !== "string" || !spec.options.includes(choice)) {
        errors.push(`"${id}": choice "${choice || "(empty)"}" is not one of ${spec.options.join(" | ")}`);
        continue;
      }
      out[id] = { choice };
    } else if (spec.type === "noul") {
      // The gateway answers boolean/probability; TypeSafe's own API answers
      // noul/noul. Both must satisfy the same 0-1 range check.
      const probability = value?.type === "noul" ? value.noul : value?.type === "boolean" ? value.probability : null;
      if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        errors.push(`"${id}": probability must be 0-1`);
        continue;
      }
      out[id] = { noul: probability };
    } else {
      errors.push(`"${id}": score answers are not mapped to the evaluation wire yet`);
    }
  }
  for (const question of questions) {
    if (!out[question.id]) errors.push(`"${question.id}": no answer given`);
  }
  return { ok: errors.length === 0, answers: Object.fromEntries(Object.entries(out)), errors };
}

export function parseAnswers(rawText, questions) {
  const text = String(rawText ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, errors: ["the model reply contained no JSON object"] };
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return { ok: false, errors: [`reply JSON did not parse: ${clipText(error.message, 120)}`] };
  }
  const answers = parsed?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return { ok: false, errors: ['reply missing an "answers" object'] };
  const specs = new Map(questions.map((question) => [question.id, question]));
  const out = Object.create(null);
  const errors = [];
  for (const [id, value] of Object.entries(answers)) {
    if (!specs.has(id)) {
      errors.push(`answer for unknown question "${id}"`);
      continue;
    }
    const spec = specs.get(id);
    if (spec.type === "choice") {
      const choice = value?.choice;
      if (typeof choice !== "string" || !spec.options.includes(choice)) {
        errors.push(`"${id}": choice "${choice || "(empty)"}" is not one of ${spec.options.join(" | ")}`);
        continue;
      }
      out[id] = { choice };
    } else if (spec.type === "score") {
      const score = value?.score;
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) {
        errors.push(`"${id}": score must be a number 0-100`);
        continue;
      }
      out[id] = { score: Math.round(score) };
    } else {
      const probability = value?.noul;
      if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        errors.push(`"${id}": noul must be a probability 0-1`);
        continue;
      }
      out[id] = { noul: probability };
    }
  }
  for (const question of questions) {
    if (!out[question.id]) errors.push(`"${question.id}": no answer given`);
  }
  return { ok: errors.length === 0, answers: Object.fromEntries(Object.entries(out)), errors };
}

// ---- the call ---------------------------------------------------------------------
// One HTTP call, hard timeout, no automatic retries (re-asking is cheap and
// explicit). Returns { ok, answers, usage, model, elapsedMs } or
// { ok: false, error, status?, usage? }. Every attempted network call reports
// modelCalls: 1, including timeouts and invalid answers: rejected answers may
// still have consumed tokens and must not bypass the caller's budget.

const safeDiagnostic = (value, apiKey, max = 300) => {
  const text = String(value ?? "");
  return clipText(apiKey ? text.split(apiKey).join("[redacted]") : text, max);
};

function usageOf(usage = {}) {
  const token = (...fields) => {
    for (const field of fields) {
      const value = usage?.[field];
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
    }
    return null;
  };
  return {
    modelCalls: 1,
    promptTokens: token("inputTokens", "promptTokens", "prompt_tokens", "input_tokens"),
    completionTokens: token("outputTokens", "completionTokens", "completion_tokens", "output_tokens"),
  };
}

// The deadline covers both headers and body. Promise.race also settles when
// a custom transport ignores abort; fetch receives abort to release its socket.
async function withDeadline(timeoutMs, operation) {
  const ms = clampNumber(timeoutMs, 1, 60000, 15000);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function readGatewayResponse(response, apiKey) {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, error: `gateway HTTP ${response.status}: ${safeDiagnostic(body, apiKey)}`, status: response.status };
  }
  try {
    return { ok: true, payload: await response.json() };
  } catch (error) {
    return { ok: false, error: `gateway reply was not JSON: ${safeDiagnostic(error?.message, apiKey, 120)}` };
  }
}

export async function classify({ questions, state, apiKey, config = null, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = { ...gatewayConfig({ env }), ...config };
  try {
    assertJevOnly(cfg);
  } catch (error) {
    return { ok: false, error: error.message, refused: "jev-only" };
  }
  if (!apiKey) {
    const preset = JEV_ROUTES[normalizeJevRoute(cfg.route)];
    return { ok: false, error: `no Jev key configured for the ${preset.label} route (${preset.keyHint})` };
  }
  let request;
  try {
    request = buildClassifyRequest({ config: { ...cfg, apiKey }, questions, state });
  } catch (error) {
    return { ok: false, error: error.message, elapsedMs: 0, model: cfg.model };
  }
  const started = Date.now();
  let response;
  let attempted = false;
  try {
    response = await withDeadline(cfg.timeoutMs, async (signal) => {
      attempted = true;
      const raw = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal,
      });
      return readGatewayResponse(raw, apiKey);
    });
  } catch (error) {
    return { ok: false, error: `gateway request failed: ${safeDiagnostic(error?.message, apiKey, 160)}`, elapsedMs: Date.now() - started, model: cfg.model, ...(attempted ? { usage: usageOf() } : {}) };
  }
  const elapsedMs = Date.now() - started;
  if (!response.ok) return { ...response, elapsedMs, model: cfg.model, usage: usageOf() };
  const { payload } = response;
  const usage = usageOf(payload?.usage);
  const parsed = validateWireAnswers(payload?.answers, questions);
  if (!parsed.ok) return { ok: false, error: `unusable reply: ${safeDiagnostic(parsed.errors.join("; "), apiKey, 400)}`, elapsedMs, model: cfg.model, usage };
  return {
    ok: true,
    answers: parsed.answers,
    // TypeSafe's API reports the versioned model that answered; keep it when
    // it is Jev-shaped, otherwise report the configured pin.
    model: isJevModel(payload?.model) ? String(payload.model) : cfg.model,
    elapsedMs,
    usage,
  };
}

// ---- the gateway's model list (read-only, no tokens spent) ------------------------

export async function listModels({ apiKey, config = null, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = { ...gatewayConfig({ env }), ...config };
  try {
    assertJevOnly(cfg);
  } catch (error) {
    return { ok: false, error: error.message, refused: "jev-only" };
  }
  if (!apiKey) return { ok: false, error: "no AI gateway key configured" };
  let response;
  try {
    response = await withDeadline(cfg.timeoutMs, async (signal) => {
      const raw = await fetchImpl(`${cfg.baseUrl}/models`, {
        headers: { authorization: `Bearer ${apiKey}`, "user-agent": `mefi-studio/${JEVC_CLIENT_VERSION} (jev decision client)` },
        signal,
      });
      return readGatewayResponse(raw, apiKey);
    });
  } catch (error) {
    return { ok: false, error: `gateway request failed: ${safeDiagnostic(error?.message, apiKey, 160)}` };
  }
  if (!response.ok) return response;
  if (!Array.isArray(response.payload?.data)) return { ok: false, error: "gateway model catalog is missing a data array" };
  const ids = [...new Set(response.payload.data.map((row) => row?.id).filter((id) => typeof id === "string" && id.trim()))];
  return { ok: true, models: ids, jevCandidates: ids.filter(isJevModel) };
}

// ---- CLI ---------------------------------------------------------------------------

export async function cli(argv = process.argv.slice(2), { env = process.env, settings = null, decrypt = null, fetchImpl = globalThis.fetch } = {}) {
  const route = resolveJevRoute(settings, env);
  const config = gatewayConfig({ env, route });
  const resolved = resolveApiKey({ env, settings, decrypt, route });
  const wants = (flag) => argv.includes(flag);
  if (!wants("--status") && !wants("--models") && !wants("--probe")) {
    console.log("usage: node scripts/decision-client.mjs --status | --models | --probe");
    return 2;
  }
  console.log(`[jev] route: ${config.route} — ${config.routeLabel} (override with MEFI_JEV_ROUTE, or in Settings)`);
  console.log(`[jev] endpoint: ${config.protocol === "systemone" ? systemoneUrl(config.baseUrl) : evaluationUrl(config.baseUrl)}`);
  console.log(`[jev] model: ${config.model} (pinned; override with MEFI_JEV_MODEL)`);
  console.log("[jev] scope: this key talks to Jev ONLY (System One) — chat and build work ride the studio's own routes");
  if (!isJevModel(config.model)) console.error(`[jev] WARNING: "${config.model}" is not a Jev model — --models/--probe will refuse it`);
  console.log(`[jev] key: ${resolved ? `configured via ${resolved.via}` : "NOT CONFIGURED"}`);
  if (!resolved) return 1;
  if (wants("--status")) return 0;
  if (wants("--models")) {
    const models = await listModels({ apiKey: resolved.key, config, fetchImpl });
    if (!models.ok) {
      console.error(`[jev] models list failed: ${models.error}`);
      return 1;
    }
    console.log(`[jev] ${models.models.length} model(s) on the route`);
    console.log(`[jev] jev-shaped ids: ${models.jevCandidates.length ? models.jevCandidates.join(", ") : "(none found — check the model pin)"}`);
    return 0;
  }
  const { relationshipQuestion } = await import("./work-classification.mjs");
  const probe = relationshipQuestion({
    observation: { text: "Restore the tar torch catalog descriptions", source: "chat" },
    candidate: { title: "Restore tar torch and stick catalog descriptions", status: "open" },
  });
  const result = await classify({ questions: [probe.question], state: probe.stateContext, apiKey: resolved.key, config, fetchImpl });
  if (!result.ok) {
    console.error(`[jev] probe failed: ${result.error}`);
    return 1;
  }
  console.log(`[jev] probe answer: ${JSON.stringify(result.answers)}`);
  console.log(`[jev] usage: ${JSON.stringify(result.usage)} in ${result.elapsedMs}ms via ${result.model}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`[jev] failed: ${error.message}`);
      process.exit(2);
    }
  );
}
