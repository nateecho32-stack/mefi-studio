// Mefi's Studio AI+ — the Jev decision client (TypeSafe classifier over the
// AI Gateway).
//
// Jev answers CONSTRAINED questions (choice / score / yes-probability) over
// application state — it never writes prose into the workflow. This client is
// the narrow adapter from the advisory's plan: it resolves the gateway key,
// sends narrowly scoped questions, enforces timeouts and budgets, validates
// every answer against its question spec, and reports real token usage so
// callers can charge the global improvement budget (experience.spendBudget).
//
// Boundaries the rest of the studio enforces: an answer is a PROPOSAL. It can
// never suppress work, merge tasks, spawn agents, alter ownership, or settle
// verification — those stay with the board gateway and the receipt runner.
// Invalid or missing answers are errors, never guesses ("type-safe does not
// mean correct").
//
// Dependency-free on purpose: the gateway speaks the OpenAI chat-completions
// shape, so plain `fetch` replaces the `ai` SDK here. The key is resolved from
// AI_GATEWAY_API_KEY (headless/CLI) or the DPAPI-encrypted settings field
// (`gatewayApiKeyEncrypted`, set with `electron . --set-gateway-key`) — the
// key itself is never logged, never stored in a tracked file, and never sent
// anywhere but the configured gateway endpoint.
//
// CLI:
//   node scripts/decision-client.mjs --status   # key + config, no network
//   node scripts/decision-client.mjs --models   # list the gateway's models
//   node scripts/decision-client.mjs --probe    # one minimal classification
//
// The model id is pinned because thresholds are tuned against a pinned
// version. The AI Gateway serves Jev as `typesafe-ai/jev` (discovered via
// `--models`); the docs' versioned name is jev-1.13.0. Override with
// MEFI_JEV_MODEL when the pin moves. A changed model is a new experimental
// condition — never reuse old outcomes as if they measured the new one.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const JEVC_CLIENT_VERSION = 1;
export const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
export const DEFAULT_JEV_MODEL = "typesafe-ai/jev";
export const JEV_DOC_MODEL = "jev-1.13.0";
export const QUESTION_TYPES = Object.freeze(["choice", "score", "noul"]);

// SYSTEM ONE ONLY. The AI Gateway key is scoped to Jev — the constrained
// classifier — and to nothing else. Chat replies, briefs, overseer passes and
// build jobs ride the studio's own routes (z.ai GLM / OpenCode Go / Grok);
// they must never touch this key, and a model override that is not a Jev
// model is refused BEFORE any network call. (The gateway vendor's generic
// onboarding example — openai/gpt-5.5 through this key — is deliberately not
// followed: general generation through the classifier's key would blur who
// judged what, and every Jev answer is meant to stay a constrained,
// attributable, budget-metered proposal.)
export const JEV_MODEL_PATTERN = /(^|\/)jev(-|$)/i;

export function isJevModel(model) {
  return JEV_MODEL_PATTERN.test(String(model ?? ""));
}

function assertJevOnly(config) {
  if (!isJevModel(config.model)) {
    throw new Error(
      `the AI Gateway key is Jev-only (System One): "${config.model}" is refused. ` +
        `Set MEFI_JEV_MODEL to a Jev model id (e.g. ${DEFAULT_JEV_MODEL}) or unset it for the pin. ` +
        `Chat and build work belong on the studio's own model routes.`
    );
  }
}

const clipText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// ---- configuration (no secrets in the config itself) ----------------------------

export function gatewayConfig({ env = process.env } = {}) {
  const baseUrl = clipText(env.MEFI_AI_GATEWAY_BASE_URL, 200).replace(/\/+$/, "") || DEFAULT_GATEWAY_BASE_URL;
  const model = clipText(env.MEFI_JEV_MODEL, 80) || DEFAULT_JEV_MODEL;
  return {
    clientVersion: JEVC_CLIENT_VERSION,
    baseUrl,
    model,
    timeoutMs: clampNumber(env.MEFI_JEV_TIMEOUT_MS, 1000, 60000, 15000),
    maxStateChars: clampNumber(env.MEFI_JEV_MAX_STATE_CHARS, 200, 60000, 8000),
  };
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

// Env wins (headless, CI, the probe CLI); the DPAPI-encrypted settings field
// is the in-app path. `decrypt` is injected so this module stays Electron-free
// (main.cjs passes its safeStorage-backed decryptKey). Returns null when no
// key is configured — callers decide whether that is an error.
export function resolveApiKey({ env = process.env, settings = null, decrypt = null } = {}) {
  const fromEnv = clipText(env.AI_GATEWAY_API_KEY, 200);
  if (fromEnv) return { key: fromEnv, via: "env" };
  const encrypted = settings?.gatewayApiKeyEncrypted;
  if (encrypted && typeof decrypt === "function") {
    const key = decrypt(settings, "gatewayApiKeyEncrypted");
    if (key) return { key, via: "settings" };
  }
  return null;
}

// ---- question specs --------------------------------------------------------------
// One question the model answers. `prompt` must be self-contained: the model
// never sees the question id, so the texts under comparison are named inside
// the prompt itself (the TypeSafe contract, kept here).

export function validateQuestionSpec(question) {
  const errors = [];
  if (!question || typeof question !== "object") return { ok: false, errors: ["question must be an object"] };
  if (!clipText(question.id, 60)) errors.push("id required");
  if (!clipText(question.prompt, 4000)) errors.push("prompt required (self-contained: the model never sees the id)");
  if (!QUESTION_TYPES.includes(question.type)) errors.push(`type must be one of ${QUESTION_TYPES.join(", ")}`);
  if (question.type === "choice") {
    const options = (Array.isArray(question.options) ? question.options : []).map((option) => clipText(option, 60)).filter(Boolean);
    if (options.length < 2) errors.push("choice questions need at least two options");
    if (options.length !== new Set(options).size) errors.push("choice options must be unique");
  }
  if (question.type === "score" && !clipText(question.levels, 1000)) errors.push("score questions need a levels description");
  return { ok: errors.length === 0, errors };
}

// ---- the request -----------------------------------------------------------------
// The AI Gateway's evaluation generation API (the wire the `ai` SDK's
// gateway provider speaks — mirrored here so the studio stays
// zero-runtime-dependency):
//   POST {origin}/v4/ai/evaluation-model
//   headers: authorization · ai-evaluation-model-specification-version: 4
//            · ai-model-id: <the pinned Jev id>
//   body: { state, questions: { <id>: { type, instructions, criteria? } } }
// Choice criteria is an option→description map; boolean questions carry
// P(true) answers (our "noul"). The chat-completions endpoint is the wrong
// surface for Jev — the gateway rejects evaluation models there.

export function evaluationUrl(baseUrl) {
  const origin = new URL(baseUrl).origin;
  return `${origin}/v4/ai/evaluation-model`;
}

export function buildEvaluationRequest({ config, questions, state }) {
  const flatState = clipText(typeof state === "string" ? state : JSON.stringify(state), config.maxStateChars);
  const wireQuestions = {};
  for (const question of questions) {
    if (question.type === "choice") {
      wireQuestions[question.id] = {
        type: "choice",
        instructions: clipText(question.prompt, 4000),
        criteria: Object.fromEntries(question.options.map((option) => [option, option])),
      };
    } else if (question.type === "noul") {
      wireQuestions[question.id] = { type: "boolean", instructions: clipText(question.prompt, 4000) };
    } else {
      throw new Error(`question "${question.id}": score questions are not mapped to the evaluation wire yet (choice and noul are)`);
    }
  }
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
    body: { state: flatState, questions: wireQuestions },
  };
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
  const out = {};
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
      const choice = clipText(value.choice, 60);
      if (!spec.options.includes(choice)) {
        errors.push(`"${id}": choice "${choice || "(empty)"}" is not one of ${spec.options.join(" | ")}`);
        continue;
      }
      out[id] = { choice };
    } else if (spec.type === "noul") {
      if (value?.type !== "boolean") {
        errors.push(`"${id}": expected a boolean (probability) answer`);
        continue;
      }
      const probability = Number(value.probability);
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
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
  return { ok: errors.length === 0, answers: out, errors };
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
    return { ok: false, errors: `reply JSON did not parse: ${clipText(error.message, 120)}` };
  }
  const answers = parsed?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return { ok: false, errors: ['reply missing an "answers" object'] };
  const specs = new Map(questions.map((question) => [question.id, question]));
  const out = {};
  const errors = [];
  for (const [id, value] of Object.entries(answers)) {
    if (!specs.has(id)) {
      errors.push(`answer for unknown question "${id}"`);
      continue;
    }
    const spec = specs.get(id);
    if (spec.type === "choice") {
      const choice = clipText(value?.choice, 60);
      if (!spec.options.includes(choice)) {
        errors.push(`"${id}": choice "${choice || "(empty)"}" is not one of ${spec.options.join(" | ")}`);
        continue;
      }
      out[id] = { choice };
    } else if (spec.type === "score") {
      const score = Number(value?.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        errors.push(`"${id}": score must be a number 0-100`);
        continue;
      }
      out[id] = { score: Math.round(score) };
    } else {
      const probability = Number(value?.noul);
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        errors.push(`"${id}": noul must be a probability 0-1`);
        continue;
      }
      out[id] = { noul: probability };
    }
  }
  for (const question of questions) {
    if (!out[question.id]) errors.push(`"${question.id}": no answer given`);
  }
  return { ok: errors.length === 0, answers: out, errors };
}

// ---- the call ---------------------------------------------------------------------
// One HTTP call, hard timeout, no automatic retries (re-asking is cheap and
// explicit). Returns { ok, answers, usage, model, elapsedMs } or
// { ok: false, error, status? }. usage.modelCalls is always 1 on success so
// callers can charge the improvement budget ledger directly.

export async function classify({ questions, state, apiKey, config = null, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = config ?? gatewayConfig({ env });
  try {
    assertJevOnly(cfg);
  } catch (error) {
    return { ok: false, error: error.message, refused: "jev-only" };
  }
  const specs = (Array.isArray(questions) ? questions : []).map((question) => {
    const check = validateQuestionSpec(question);
    if (!check.ok) throw new Error(`invalid question spec: ${check.errors.join("; ")}`);
    return question;
  });
  if (!specs.length) throw new Error("classify: at least one question is required");
  if (!apiKey) return { ok: false, error: "no AI gateway key configured (set AI_GATEWAY_API_KEY, or run: electron . --set-gateway-key)" };
  let request;
  try {
    request = buildEvaluationRequest({ config: { ...cfg, apiKey }, questions: specs, state });
  } catch (error) {
    return { ok: false, error: error.message, elapsedMs: 0, model: cfg.model };
  }
  const started = Date.now();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), cfg.timeoutMs) : null;
  let response;
  try {
    response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller?.signal,
    });
  } catch (error) {
    return { ok: false, error: `gateway request failed: ${clipText(error.message, 160)}`, elapsedMs: Date.now() - started, model: cfg.model };
  } finally {
    if (timer) clearTimeout(timer);
  }
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // The body may echo the request; clip hard and never include the header.
    return { ok: false, error: `gateway HTTP ${response.status}: ${clipText(body, 300)}`, status: response.status, elapsedMs, model: cfg.model };
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    return { ok: false, error: `gateway reply was not JSON: ${clipText(error.message, 120)}`, elapsedMs, model: cfg.model };
  }
  const parsed = validateWireAnswers(payload?.answers, specs);
  if (!parsed.ok) return { ok: false, error: `unusable reply: ${parsed.errors.join("; ")}`, raw: clipText(JSON.stringify(payload?.answers ?? payload), 400), elapsedMs, model: cfg.model };
  const usage = payload?.usage ?? {};
  const token = (...fields) => {
    for (const field of fields) {
      const value = Number(usage?.[field]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  };
  return {
    ok: true,
    answers: parsed.answers,
    model: cfg.model,
    elapsedMs,
    usage: {
      modelCalls: 1,
      promptTokens: token("promptTokens", "prompt_tokens", "inputTokens", "input_tokens"),
      completionTokens: token("completionTokens", "completion_tokens", "outputTokens", "output_tokens"),
    },
  };
}

// ---- the gateway's model list (read-only, no tokens spent) ------------------------

export async function listModels({ apiKey, config = null, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const cfg = config ?? gatewayConfig({ env });
  try {
    assertJevOnly(cfg);
  } catch (error) {
    return { ok: false, error: error.message, refused: "jev-only" };
  }
  if (!apiKey) return { ok: false, error: "no AI gateway key configured" };
  let response;
  try {
    response = await fetchImpl(`${cfg.baseUrl}/models`, {
      headers: { authorization: `Bearer ${apiKey}`, "user-agent": `mefi-studio/${JEVC_CLIENT_VERSION} (jev decision client)` },
    });
  } catch (error) {
    return { ok: false, error: `gateway request failed: ${clipText(error.message, 160)}` };
  }
  if (!response.ok) return { ok: false, error: `gateway HTTP ${response.status}`, status: response.status };
  const payload = await response.json().catch(() => null);
  const ids = (Array.isArray(payload?.data) ? payload.data : []).map((row) => row?.id).filter((id) => typeof id === "string");
  return { ok: true, models: ids, jevCandidates: ids.filter((id) => /jev/i.test(id)) };
}

// ---- CLI ---------------------------------------------------------------------------

function maskKey(key) {
  return key.length > 12 ? `${key.slice(0, 4)}…${key.slice(-4)} (${key.length} chars)` : "(short key)";
}

export async function cli(argv = process.argv.slice(2), { env = process.env, settings = null, decrypt = null, fetchImpl = globalThis.fetch } = {}) {
  const config = gatewayConfig({ env });
  const resolved = resolveApiKey({ env, settings, decrypt });
  const wants = (flag) => argv.includes(flag);
  if (!wants("--status") && !wants("--models") && !wants("--probe")) {
    console.log("usage: node scripts/decision-client.mjs --status | --models | --probe");
    return 2;
  }
  console.log(`[jev] gateway: ${config.baseUrl}`);
  console.log(`[jev] model: ${config.model} (pinned; override with MEFI_JEV_MODEL)`);
  console.log("[jev] scope: this key talks to Jev ONLY (System One) — chat and build work ride the studio's own routes");
  if (!isJevModel(config.model)) console.error(`[jev] WARNING: "${config.model}" is not a Jev model — --models/--probe will refuse it`);
  console.log(`[jev] key: ${resolved ? `configured via ${resolved.via} — ${maskKey(resolved.key)}` : "NOT CONFIGURED"}`);
  if (!resolved) return 1;
  if (wants("--status")) return 0;
  if (wants("--models")) {
    const models = await listModels({ apiKey: resolved.key, config, fetchImpl });
    if (!models.ok) {
      console.error(`[jev] models list failed: ${models.error}`);
      return 1;
    }
    console.log(`[jev] ${models.models.length} model(s) on the gateway`);
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
