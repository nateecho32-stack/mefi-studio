// Versioned, credential-free agent teams. Pure transformations: the host owns
// its existing serialized settings transaction and captures one team per run.
"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
const addons = require("./agent-addons.cjs");
const runtime = new AsyncLocalStorage();
const FIELDS = Object.freeze(["aiProvider", "aiRoleProviders", "aiModels", "aiModelsByProvider", "aiAutoProviders", "aiAutoFallback", "aiFallbackOpenCode", "aiSubscriptionFirst", "modelSelection", "executorCli", "executorModel", "executorModels", "executorTier", "executorTierModels", "agentSeats", "agentSubtasks", "agentSkills", "agentBrain", "agentEfforts", "agentMode", "agentReporting"]);
const PROVIDERS = Object.freeze(["auto", "zai", "opencode", "zen", "openrouter", "grok", "claude", "codex", "antigravity", "lmstudio", "custom"]);
const CLIS = Object.freeze(["opencode", "grok", "claude", "codex", "antigravity"]);
const EFFORTS = Object.freeze(["minimal", "low", "medium", "high", "xhigh", "max"]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
function extract(settings = {}) {
  return Object.fromEntries(FIELDS.filter((key) => settings[key] !== undefined).map((key) => [key, clone(settings[key])]));
}
function store(settings = {}) {
  const source = record(settings.agentTeams) ? settings.agentTeams : {};
  return { version: 1, revision: Number(source.revision) || 0, projects: record(source.projects) ? clone(source.projects) : {}, presets: Array.isArray(source.presets) ? clone(source.presets) : [] };
}
function effective(settings, projectId, snapshot) {
  const selected = snapshot?.configuration ?? store(settings).projects[projectId]?.configuration;
  if (!selected) return { ...settings };
  const result = { ...settings };
  for (const field of FIELDS) delete result[field];
  return { ...result, ...extract(selected) };
}
function capabilities(provider, model = "") {
  const id = String(model).toLowerCase().replace(/^openai\//, "");
  const extended = /^gpt-6-/.test(id);
  const reasoning = (provider === "zen" || provider === "openrouter" && /^openai\//i.test(model)) && (extended || /^(gpt-5(?:[.-]|$)|o[134](?:-|$))/.test(id));
  return { efforts: reasoning ? extended ? [...EFFORTS] : ["low", "medium", "high"] : [], fast: provider === "zen" && extended, note: reasoning ? "Reasoning is sent to the selected model." : "Effort is managed by this provider or CLI." };
}
function validate(configuration) {
  if (!record(configuration)) return "A team configuration is required.";
  for (const field of Object.keys(configuration)) if (!FIELDS.includes(field)) return `Unknown team setting: ${field}`;
  if (configuration.aiProvider !== undefined && !PROVIDERS.includes(configuration.aiProvider)) return "Unknown assistant provider.";
  if (configuration.executorCli !== undefined && !CLIS.includes(configuration.executorCli)) return "Unknown builder CLI.";
  if (configuration.modelSelection !== undefined && !["fixed", "jev"].includes(configuration.modelSelection)) return "Choose fixed or automatic model selection.";
  if (configuration.executorTier !== undefined && !["auto", "free", "fast", "heavy"].includes(configuration.executorTier)) return "Unknown builder tier.";
  if (configuration.agentMode !== undefined && !["swarm", "cluster"].includes(configuration.agentMode)) return "Unknown coordination mode.";
  if (configuration.agentReporting !== undefined && !["compact", "detailed"].includes(configuration.agentReporting)) return "Choose compact or detailed reporting.";
  if (configuration.aiAutoProviders !== undefined && (!Array.isArray(configuration.aiAutoProviders) || !configuration.aiAutoProviders.length || configuration.aiAutoProviders.some((id) => !PROVIDERS.includes(id) || id === "auto"))) return "Choose at least one valid fallback provider.";
  for (const field of ["aiAutoFallback", "aiFallbackOpenCode", "aiSubscriptionFirst"]) if (configuration[field] !== undefined && typeof configuration[field] !== "boolean") return `${field} must be on or off.`;
  for (const field of ["aiRoleProviders", "aiModels", "aiModelsByProvider", "executorModels", "executorTierModels", "agentSeats", "agentBrain", "agentEfforts"]) if (configuration[field] !== undefined && !record(configuration[field])) return `Invalid ${field}.`;
  for (const [role, provider] of Object.entries(configuration.aiRoleProviders || {})) if (!["routine", "heavy"].includes(role) || provider && !PROVIDERS.includes(provider)) return "Unknown role provider.";
  for (const [role, effort] of Object.entries(configuration.agentEfforts || {})) {
    if (!["routine", "heavy"].includes(role) || effort && !EFFORTS.includes(effort)) return "Unknown reasoning effort.";
    const provider = configuration.aiRoleProviders?.[role] || configuration.aiProvider || "auto";
    const model = configuration.aiModelsByProvider?.[provider]?.[role] || configuration.aiModels?.[role] || "";
    if (effort && !capabilities(provider, model).efforts.includes(effort)) return `Reasoning effort is not supported by the ${role} route.`;
  }
  for (const [seat, choice] of Object.entries(configuration.agentSeats || {})) {
    if (!["lead", "desk", "companion", "scout", "overseer"].includes(seat) || !record(choice)) return "Unknown agent seat.";
    if (choice.provider !== undefined && !PROVIDERS.includes(choice.provider)) return "Unknown seat provider.";
    if (["grok", "codex", "antigravity"].includes(choice.provider)) return "This coding CLI cannot make text-only seat calls. Choose it for the coding worker instead.";
    if (choice.effort && !EFFORTS.includes(choice.effort)) return "Unknown seat effort.";
    if (choice.fast !== undefined && typeof choice.fast !== "boolean") return "Fast mode must be on or off.";
    if (choice.model !== undefined && (typeof choice.model !== "string" || !/^[A-Za-z0-9._:/-]{0,120}$/.test(choice.model))) return "Invalid seat model id.";
    if (choice.modelsByProvider !== undefined && (!record(choice.modelsByProvider) || Object.entries(choice.modelsByProvider).some(([provider, model]) => !PROVIDERS.includes(provider) || typeof model !== "string" || !/^[A-Za-z0-9._:/-]{0,120}$/.test(model)))) return "Invalid saved seat models.";
    if (choice.fast && !capabilities(choice.provider || "zen", choice.model || "gpt-6-sol").fast) return "Fast mode is unavailable for this seat model.";
    if (choice.effort && choice.provider !== "auto" && !capabilities(choice.provider || "zen", choice.model || "gpt-6-sol").efforts.includes(choice.effort)) return "Reasoning effort is unavailable for this seat model.";
  }
  if (configuration.agentSubtasks !== undefined) {
    const choice = configuration.agentSubtasks;
    if (!record(choice) || !["auto", ...CLIS].includes(choice.cli ?? "auto")) return "Unknown subtask builder.";
    if (choice.model !== undefined && (typeof choice.model !== "string" || !/^[A-Za-z0-9._:/-]{0,120}$/.test(choice.model))) return "Invalid subtask model id.";
  }
  for (const [key, enabled] of Object.entries(configuration.agentBrain || {})) if (!["deskTool", "nestedDelegation", "headDrafts", "contextScout"].includes(key) || typeof enabled !== "boolean") return "Unknown delegation switch.";
  if (configuration.agentSkills !== undefined) { const error = addons.validate(configuration.agentSkills); if (error) return error; }
  // Bound user strings and forbid nested prototype-shaped input. No credentials,
  // queue switches, endpoints or arbitrary settings can ride a team snapshot.
  const inspect = (value, depth = 0) => {
    if (depth > 5) return false;
    if (typeof value === "string") return value.length <= 160 && !/[\u0000-\u001f]/.test(value);
    if (Array.isArray(value)) return value.length <= 32 && value.every((item) => inspect(item, depth + 1));
    if (record(value)) return Object.keys(value).length <= 40 && Object.entries(value).every(([key, item]) => !["__proto__", "prototype", "constructor"].includes(key) && inspect(item, depth + 1));
    return typeof value === "boolean" || value === null;
  };
  return inspect(configuration) ? null : "Invalid team configuration.";
}
function view(settings, projectId) {
  const saved = store(settings), project = saved.projects[projectId];
  return { ok: true, projectId, revision: saved.revision, inherited: !project, name: project?.name || "Studio defaults", configuration: extract(effective(settings, projectId)), defaults: extract(settings), presets: saved.presets.map((preset) => ({ ...preset, configuration: extract(preset.configuration) })), providers: [...PROVIDERS], clis: [...CLIS], efforts: [...EFFORTS] };
}
function mutate(settings, request, { id, projectId } = {}) {
  const saved = store(settings);
  if (request.revision !== saved.revision) return { ok: false, stale: true, error: "Agent settings changed. Reload the saved version or keep your draft and try again." };
  const action = request.action;
  const name = String(request.name || "My team").trim().slice(0, 80) || "My team";
  if (["save", "preset-save"].includes(action)) {
    const error = validate(request.configuration);
    if (error) return { ok: false, error };
  }
  if (action === "save") {
    if (request.scope === "defaults") {
      for (const field of FIELDS) delete settings[field];
      Object.assign(settings, extract(request.configuration));
    } else {
      if (!projectId || projectId === "project_none") return { ok: false, error: "Choose a project before saving its team." };
      saved.projects[projectId] = { name, configuration: extract(request.configuration) };
    }
  } else if (action === "inherit") {
    delete saved.projects[projectId];
  } else if (action === "preset-save") {
    const at = saved.presets.findIndex((preset) => preset.id === request.id);
    if (request.id && at < 0) return { ok: false, error: "That preset no longer exists." };
    const preset = { id: at < 0 ? id : saved.presets[at].id, name, configuration: extract(request.configuration) };
    if (!preset.id) return { ok: false, error: "A preset identity is required." };
    if (at < 0) saved.presets.push(preset); else saved.presets[at] = preset;
  } else if (action === "preset-delete") {
    saved.presets = saved.presets.filter((preset) => preset.id !== request.id);
  } else if (action === "apply") {
    const preset = saved.presets.find((item) => item.id === request.id);
    if (!preset) return { ok: false, error: "That preset no longer exists." };
    if (!projectId || projectId === "project_none") return { ok: false, error: "Choose a project before applying a team." };
    saved.projects[projectId] = { name: preset.name, configuration: extract(preset.configuration) };
  } else return { ok: false, error: "Unknown team action." };
  saved.revision += 1; settings.agentTeams = saved;
  return view(settings, projectId);
}
function capture(settings, projectId) {
  const state = view(settings, projectId);
  state.configuration.agentMode ||= settings.ui?.autopilot?.mode === "cluster" ? "cluster" : "swarm";
  return { projectId, revision: state.revision, name: state.name, configuration: clone(state.configuration) };
}
// Legacy setup/workflow entry points use this same scoped copy. Non-team
// fields (credentials, endpoints, operational gates) remain device settings.
function update(settings, projectId, mutate) {
  const value = effective(settings, projectId);
  // Mutation callbacks may edit nested values. Keep the original transaction
  // untouched when validation or the caller rejects the draft.
  const next = clone(value);
  const refusal = mutate(next);
  if (refusal === false || refusal?.ok === false) return refusal;
  const saved = store(settings), configuration = extract(next);
  for (const [key, item] of Object.entries(next)) if (!FIELDS.includes(key) && key !== "agentTeams") settings[key] = item;
  if (projectId && projectId !== "project_none") saved.projects[projectId] = { name: saved.projects[projectId]?.name || "Project team", configuration };
  else { for (const field of FIELDS) delete settings[field]; Object.assign(settings, configuration); }
  saved.revision += 1; settings.agentTeams = saved;
  return null;
}
function run(snapshot, callback) { return runtime.run({ snapshot: clone(snapshot) }, callback); }
function current() { return runtime.getStore()?.snapshot || null; }
// Dispatch owns a fresh context. Before any attempt/model call, a resumed
// task replaces that context with the credential-free checkpoint it captured.
function resume(snapshot, projectId) {
  if (!runtime.getStore() || snapshot?.projectId !== projectId || validate(snapshot.configuration)) return false;
  runtime.getStore().snapshot = clone(snapshot);
  return true;
}
module.exports = { FIELDS, PROVIDERS, CLIS, EFFORTS, extract, effective, capabilities, validate, view, mutate, capture, update, run, current, resume };
