// Pure, bounded context previews. This module neither reads/writes saved state
// nor changes the executor prompt. Character-based token counts are estimates,
// not billing counts or guarantees about a provider's tokenizer.
const { dependencyState } = require("./backlog.cjs");

const DEFAULT_BUDGET_TOKENS = 6000;
const MIN_BUDGET_TOKENS = 128;
const MAX_BUDGET_TOKENS = 32000;
const ESTIMATE_METHOD = "Estimated tokens: 4 characters per token; not a model tokenizer.";
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const rows = (value) => Array.isArray(value) ? value : [];
const string = (value) => typeof value === "string" ? value : "";
const estimateTokens = (text) => Math.ceil(String(text).length / 4);
const hasValue = (value) => value != null && value !== "" && (!Array.isArray(value) || value.length > 0) && (!object(value) || Object.keys(value).length > 0);
const pick = (value, fields) => Object.fromEntries(fields.filter((field) => hasValue(value?.[field])).map((field) => [field, value[field]]));

// Bound serialization itself, not just its result. Old grouped briefs or
// notes may be large; nested histories must not expand a preview indefinitely.
function renderBounded(value, maxChars) {
  let text = "", truncated = false;
  const seen = new Set();
  const write = (part) => {
    const available = Math.max(0, maxChars - text.length);
    text += part.slice(0, available);
    if (part.length > available) truncated = true;
  };
  const visit = (item, depth = 0) => {
    if (text.length >= maxChars) { truncated = true; return; }
    if (typeof item === "string") { write(item); return; }
    if (item == null || ["number", "boolean", "bigint"].includes(typeof item)) { write(String(item)); return; }
    if (typeof item !== "object") { write("[Unsupported saved value]"); truncated = true; return; }
    if (seen.has(item) || depth >= 8) { write("[Nested source omitted]"); truncated = true; return; }
    seen.add(item);
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index += 1) {
        if (text.length >= maxChars || index >= 256) { truncated = true; break; }
        if (index) write("\n");
        write(`${index + 1}. `);
        visit(item[index], depth + 1);
      }
    } else {
      let count = 0;
      for (const key in item) {
        if (!Object.hasOwn(item, key) || !hasValue(item[key])) continue;
        if (text.length >= maxChars || count >= 64) { truncated = true; break; }
        if (count++) write("\n");
        write(`${key}: `);
        visit(item[key], depth + 1);
      }
    }
    seen.delete(item);
  };
  visit(value);
  return { text, truncated };
}

function newestNotes(folder, limit = 8) {
  // Keep a small sorted copy rather than sorting or trimming the saved array.
  const selected = [];
  for (const entry of rows(folder?.entries)) {
    if (!object(entry) || !string(entry.text).trim()) continue;
    const note = pick(entry, ["at", "kind", "role", "text", "cell", "superseded", "contradicts"]);
    const index = selected.findIndex((other) => (Number(other.at) || 0) < (Number(note.at) || 0));
    if (index < 0) selected.push(note);
    else selected.splice(index, 0, note);
    if (selected.length > limit) selected.pop();
  }
  return selected;
}

function buildContext(input = {}) {
  const { task, tasks = [], nodeFolder = null, budgetTokens = DEFAULT_BUDGET_TOKENS } = object(input) ? input : {};
  let requested = NaN;
  try { requested = Number(budgetTokens); } catch {}
  const budget = Math.min(MAX_BUDGET_TOKENS, Math.max(MIN_BUDGET_TOKENS, Number.isFinite(requested) ? Math.floor(requested) : DEFAULT_BUDGET_TOKENS));
  const base = { mode: "context-preview", budgetTokens: budget, estimateMethod: ESTIMATE_METHOD };
  if (!object(task) || !string(task.id).trim()) return { ...base, ok: false, error: "Choose a saved task to preview its context.", taskId: null, estimatedTokens: 0, truncated: false, sections: [], text: "" };

  const maxChars = budget * 4;
  const taskId = task.id;
  const sourceId = JSON.stringify(taskId.slice(0, 120));
  const hint = (fields) => `task ${sourceId}: ${fields}`;
  const current = pick(task, ["title", "id", "status", "prompt", "description", "details", "note", "ideaDetail"]);
  let identityExcerpt = false;
  for (const [field, cap] of [["title", 240], ["id", 160], ["status", 40]]) {
    if (typeof current[field] === "string" && current[field].length > cap) {
      current[field] = `${current[field].slice(0, cap)}…`;
      identityExcerpt = true;
    }
  }
  const memberSource = rows(task.members);
  const members = memberSource.slice(0, 256).map((member) => object(member)
    ? pick(member, ["id", "taskId", "title", "prompt", "description", "details", "detail", "ideaDetail", "note", "remaining", "dependsOn"])
    : member);
  const localTasks = rows(tasks).filter((candidate) => object(candidate) && (!task.projectId || !candidate.projectId || task.projectId === candidate.projectId));
  const byId = new Map(localTasks.map((candidate) => [candidate.id, candidate]));
  const prerequisites = dependencyState(task, localTasks);
  const dependencies = prerequisites.dependencies.map((dependency) => ({
    ...dependency,
    ...(byId.has(dependency.id) ? pick(byId.get(dependency.id), ["verification", "remaining", "lastRunError"]) : {}),
  }));
  const notes = newestNotes(nodeFolder);
  const definitions = [
    { kind: "brief", label: "Task and current requirements", value: current, source: hint("current brief and fields"), weight: 40, limited: identityExcerpt },
    { kind: "members", label: "Grouped task requirements", value: members, source: hint("members"), weight: 20, limited: memberSource.length > members.length },
    { kind: "obligations", label: "Unresolved work and handoff", value: pick(task, ["remaining", "blockers", "handoff", "context", "lastRunError"]), source: hint("remaining, blockers, handoff, context"), weight: 15 },
    { kind: "prerequisites", label: "Prerequisites and readiness", value: dependencies.length ? { readiness: prerequisites.reason || "All listed prerequisites are recorded as completed.", dependencies } : null, source: hint("dependsOn and linked current task records"), weight: 12 },
    { kind: "references", label: "References and file scope", value: pick(task, ["refs", "files", "file"]), source: hint("refs, files, file"), weight: 5 },
    { kind: "evidence", label: "Saved attempt evidence", value: pick(task, ["lastAttempt", "verification", "verificationReceiptId", "runFailures", "verifyAttempts", "doneAt"]), source: hint("lastAttempt and verification; saved reports are not new checks"), weight: 5 },
    { kind: "notes", label: "Recent node notes", value: notes, source: `node folder for task ${sourceId}: entries, newest first`, weight: 3, limited: rows(nodeFolder?.entries).filter((entry) => object(entry) && string(entry.text).trim()).length > notes.length },
  ];
  const header = `CONTEXT PREVIEW\n${ESTIMATE_METHOD}\n`;
  const footer = "\n\nSaved source is unchanged. Excerpts/omissions are listed per section.";
  let remaining = maxChars - header.length - footer.length;
  let weight = definitions.filter((definition) => hasValue(definition.value)).reduce((sum, definition) => sum + definition.weight, 0);
  const sections = [], chunks = [];
  for (const definition of definitions) {
    const section = { kind: definition.kind, label: definition.label, source: definition.source, text: "", estimatedTokens: 0, included: false };
    if (!hasValue(definition.value)) {
      section.reason = "No saved context for this section.";
      sections.push(section);
      continue;
    }
    const prefix = `\n${definition.label}\nSource: ${definition.source}\n`;
    // Weighted reservations protect requirements and unresolved work from a
    // very large brief. Unused room flows forward to the remaining sections.
    const allowance = Math.min(remaining, Math.max(prefix.length + 64, Math.floor(remaining * definition.weight / Math.max(1, weight))));
    weight -= definition.weight;
    const bodyCap = allowance - prefix.length;
    if (bodyCap < 64) {
      section.reason = `Omitted to fit the estimated token budget; full source: ${definition.source}.`;
      section.truncated = true;
    } else {
      const rendered = renderBounded(definition.value, bodyCap + 1);
      section.truncated = rendered.truncated || definition.limited === true || rendered.text.length > bodyCap;
      const suffix = "\n[Excerpt; see full source above.]";
      section.text = section.truncated ? rendered.text.slice(0, bodyCap - suffix.length) + suffix : rendered.text;
      section.estimatedTokens = estimateTokens(section.text);
      section.included = true;
      if (section.truncated) section.reason = `Excerpted to fit this preview; full source: ${definition.source}.`;
      const chunk = prefix + section.text + "\n";
      // The trailing separator is included in the budget, not added after it.
      if (chunk.length > remaining) section.text = section.text.slice(0, Math.max(0, section.text.length - (chunk.length - remaining)));
      const fitted = prefix + section.text + "\n";
      section.estimatedTokens = estimateTokens(section.text);
      chunks.push(fitted);
      remaining -= fitted.length;
    }
    sections.push(section);
  }
  const text = header + chunks.join("") + footer;
  return { ...base, ok: true, taskId, estimatedTokens: estimateTokens(text), truncated: sections.some((section) => section.truncated === true), sections, text };
}

module.exports = { buildContext, estimateTokens, DEFAULT_BUDGET_TOKENS, MIN_BUDGET_TOKENS, MAX_BUDGET_TOKENS, ESTIMATE_METHOD };
