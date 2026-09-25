// The public OpenRouter roster is separate from Studio's OpenCode Go catalog.
// Keep only text-in/text-out models that the assistant's chat wire can use.
const MODELS_URL = "https://openrouter.ai/api/v1/models?input_modalities=text&output_modalities=text";
const CACHE_MS = 15 * 60 * 1000;

function chatModels(payload) {
  if (!Array.isArray(payload?.data)) throw new Error("OpenRouter returned no model list");
  const models = payload.data.filter((entry) =>
    typeof entry?.id === "string" && entry.id.includes("/") && !entry.id.endsWith(":batch")
    && entry.architecture?.input_modalities?.includes("text")
    && entry.architecture?.output_modalities?.length === 1
    && entry.architecture.output_modalities[0] === "text"
  ).map((entry) => ({
    id: entry.id,
    name: String(entry.name || entry.id),
    context: Number.isFinite(entry.context_length) ? entry.context_length : null,
    free: entry.id === "openrouter/free" || (entry.pricing?.prompt === "0" && entry.pricing?.completion === "0"
      && (!entry.pricing?.request || entry.pricing.request === "0")),
  }));
  models.sort((a, b) => Number(b.id === "openrouter/free") - Number(a.id === "openrouter/free")
    || Number(b.free) - Number(a.free) || a.name.localeCompare(b.name));
  return models;
}

function createCatalog({ fetchImpl = fetch, now = Date.now } = {}) {
  let cache = null;
  let pending = null;
  return async function list({ refresh = false } = {}) {
    if (!refresh && cache && now() - cache.at < CACHE_MS) return { ok: true, models: cache.models, cached: true };
    if (pending) return pending;
    pending = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetchImpl(MODELS_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
        const models = chatModels(await response.json());
        cache = { at: now(), models };
        return { ok: true, models, cached: false };
      } catch (error) {
        return { ok: false, error: `Could not load OpenRouter models: ${error.message}`, models: cache?.models ?? [] };
      } finally {
        clearTimeout(timer);
        pending = null;
      }
    })();
    return pending;
  };
}

module.exports = { MODELS_URL, chatModels, createCatalog };
