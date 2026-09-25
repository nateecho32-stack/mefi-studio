"use strict";
// A read-only model roster. Credentials stay in the host and redirects cannot
// forward them to a different service. No inference request is made here.
async function list({ endpoint, apiKey, fetchImpl = fetch }) {
  if (!endpoint) return { ok: false, models: [], error: "Connect this provider first, or enter a model ID." };
  const url = endpoint.replace(/\/(?:chat\/completions|responses)\/?$/i, "/models");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: "error", headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
    if (!response.ok) throw new Error(`Model list HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) throw new Error("This provider did not return a model list");
    const models = payload.data.filter((row) => typeof row?.id === "string" && /^[A-Za-z0-9._:/-]{1,120}$/.test(row.id)).slice(0, 2000).map((row) => ({ id: row.id, name: String(row.name || row.id).slice(0, 160) }));
    return { ok: true, models: [...new Map(models.map((row) => [row.id, row])).values()].sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (error) {
    return { ok: false, models: [], error: error.name === "AbortError" ? "Model list timed out. You can still enter a model ID." : `${error.message}. You can still enter a model ID.` };
  } finally { clearTimeout(timer); }
}
module.exports = { list };
