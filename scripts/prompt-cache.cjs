// Cache-friendly provider calls. A provider bills a repeated prompt prefix as
// a cheap cache read when it can find it: OpenAI's models on Zen (the
// Responses API) route by `prompt_cache_key`, and OpenRouter caches Claude and
// Gemini prompts at a `cache_control` breakpoint. shape() adds the option a
// route takes to its request body, and refused() reads an HTTP 400 that names
// one, so a provider that will not take it has it off until Studio restarts.
// The prompts themselves are ordered for the cache elsewhere: the stable parts
// first, the new message last (executorCore.workerPrompt, agent-tools.cjs run,
// task-oversight packChatPayload). See docs/agent-tools.md.
//
// Pure module: no Electron, filesystem, network, processes, timers or clock
// reads. The session's refusals live in a Set the host owns.

"use strict";

const crypto = require("node:crypto");

// How much of the system prompt names the cache: enough to tell one kind of
// call from another, while a longer tail (skills) can differ.
const KEY_PREFIX_CHARS = 2048;
const OPTIONS = ["prompt_cache_key", "cache_control"];

// The kill switches: settings.ai.promptCache (on unless false) and the
// MEFI_STUDIO_PROMPT_CACHE=0 environment variable.
function enabled(settings, env = {}) {
  if (env?.MEFI_STUDIO_PROMPT_CACHE === "0") return false;
  return settings?.ai?.promptCache !== false;
}

// The option a route takes, or null: a Zen gpt-* model names its cache, an
// OpenRouter anthropic/* or google/gemini* model marks its system prompt.
function wanted(route) {
  const model = String(route?.model ?? "");
  if (route?.provider === "zen" && /^gpt-/i.test(model)) return "prompt_cache_key";
  if (route?.provider === "openrouter" && /^(?:anthropic\/|google\/gemini)/i.test(model)) return "cache_control";
  return null;
}

// A short, stable name for the cache one kind of call shares: the role, the
// model and the start of the system prompt, hashed, so no prompt text leaves
// in it.
function cacheKey({ role = "", model = "", system = "" } = {}) {
  const digest = crypto.createHash("sha256").update(`${role}\n${model}\n${String(system).slice(0, KEY_PREFIX_CHARS)}`).digest("hex");
  return `mefi-${digest.slice(0, 24)}`;
}

// Adds the route's option to a chat-completions request body, in place,
// unless this provider refused it this session (`refused`, "<provider>:
// <option>" entries). Returns the option added, or null.
function shape(body, { provider, model, role = "", refused = null } = {}) {
  const option = wanted({ provider, model });
  if (!option || !body || typeof body !== "object" || refused?.has?.(`${provider}:${option}`)) return null;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages.find((message) => message?.role === "system" && typeof message.content === "string");
  if (option === "prompt_cache_key") {
    body.prompt_cache_key = cacheKey({ role, model, system: system?.content ?? "" });
    return option;
  }
  if (!system || !system.content) return null;
  system.content = [{ type: "text", text: system.content, cache_control: { type: "ephemeral" } }];
  return option;
}

// Whether a failed call was the provider refusing the caching option this
// route sends (HTTP 400 naming it). If so it is off for that provider from
// now on (added to `refused`) and the caller sends the request again without
// it. Anything else, a 400 about something else included, is left alone.
function refused(refusedSet, route, result) {
  const option = wanted(route);
  if (!option || !refusedSet || result?.ok !== false) return false;
  const key = `${route.provider}:${option}`;
  if (refusedSet.has(key)) return false;
  const error = String(result.error ?? "");
  if (!/\bHTTP 400\b/.test(error) || !error.includes(option)) return false;
  refusedSet.add(key);
  return true;
}

module.exports = { enabled, wanted, cacheKey, shape, refused, OPTIONS, KEY_PREFIX_CHARS };
