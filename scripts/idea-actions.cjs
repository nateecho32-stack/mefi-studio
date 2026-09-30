const { OWNER_REQUEST_SOURCES, requestTitle } = require("./work-admission.cjs");
const { createHash } = require("node:crypto");
const { normalizePath } = require("./project-map.cjs");
const { place } = require("./board-trash.cjs");

// Apply one UI intent to the latest board, so reading or keeping an idea
// cannot replace a promotion or erase ideas that arrived in the meantime.
function applyIdeaAction(ideas, payload = {}, now = Date.now()) {
  const { action, ideaId, ideaIds } = payload;
  const rows = Array.isArray(ideas) ? ideas : [];
  if (action === "add") {
    const clean = (value, max) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "";
    if (typeof payload.detail === "string" && payload.detail.trim().length > 16000) return { ok: false, error: "Shorten the idea to 16,000 characters before saving; no text was saved." };
    const title = clean(payload.title, 200), detail = clean(payload.detail, 16000);
    if (!title || !detail) return { ok: false, error: "Give the idea a title and describe the change." };
    const files = [...new Set((Array.isArray(payload.files) ? payload.files : []).slice(0, 30).map(file => normalizePath(file)).filter(Boolean))];
    const intent = ["modify", "experiment", "fix", "improve"].includes(payload.intent) ? payload.intent : "improve";
    const systemId = clean(payload.systemId, 120), systemName = clean(payload.systemName, 180);
    // The owner's own idea (Search's "idea ...") says so with source "owner",
    // and reads "From you"; everything else here is Mefi's suggestion from chat.
    const owner = payload.source === "owner";
    const id = `${owner ? "idea_owner_" : "idea_mefi_"}${createHash("sha256").update(JSON.stringify([title, detail, [...files].sort(), intent, systemId])).digest("hex").slice(0, 24)}`;
    const existing = rows.find(row => row.id === id);
    if (existing) return { ok: true, idea: existing, ideas: rows, added: false };
    // Chat notes are excluded from automatic admission until the owner
    // chooses Keep or Build. Saving a suggestion must not launch a worker.
    // The owner's own idea is already read: they wrote it.
    const idea = { id, title, detail, files, intent, ...(systemId ? { systemId, systemName } : {}), ...(owner ? { source: "owner", suggestedBy: "owner", status: "new", read: true } : { source: "chat", suggestedBy: "mefi", status: "new", read: false }), at: now, updatedAt: now };
    return { ok: true, idea, ideas: [idea, ...rows], added: true };
  }
  // Put a deleted idea back (main.cjs "Board trash"): the host hands over the
  // record it kept, never the caller. It returns to the place it left and is
  // refused, saying so, when an idea with its id is in the list again.
  if (action === "restore") {
    const record = payload.record;
    if (!record || typeof record !== "object" || Array.isArray(record) || typeof record.id !== "string" || !record.id) return { ok: false, error: "That idea cannot be put back." };
    const out = place(rows, { kind: "idea", record, index: payload.index, afterId: payload.afterId });
    return out.ok ? { ok: true, ideas: out.rows } : { ok: false, error: out.error, exists: out.exists === true };
  }
  if (action === "clean") {
    const ids = new Set(Array.isArray(ideaIds) ? ideaIds : []);
    return { ok: true, ideas: rows.filter((idea) => !(ids.has(idea.id) && idea.status === "done")) };
  }
  if (!["read", "keep", "done", "delete"].includes(action)) return { ok: false, error: "Choose an idea action." };
  const current = rows.find((idea) => idea.id === ideaId);
  if (!current) return { ok: false, error: "This idea is no longer available. Reload the ideas list." };
  if (action === "delete") return { ok: true, ideas: rows.filter((idea) => idea.id !== ideaId) };
  const patch = action === "read" ? { read: true } : action === "done" ? { read: true, status: "done" }
    : { status: current.taskId ? current.status : "keep" };
  return { ok: true, ideas: rows.map((idea) => idea.id === ideaId ? { ...idea, ...patch, updatedAt: now } : idea) };
}

// Inbox requests carry no id; a request is its (at, title, prompt) identity.
const requestKey = (row) => `${Number(row?.at) || 0}\u0000${String(row?.title ?? "")}\u0000${String(row?.prompt ?? "")}`;
const REQUEST_SOURCES = new Set(["manual", "expand", "improver", "grow"]);

// The request inbox gets the same treatment: an add or a remove from a view
// applies to the latest rows, so a request a worker has claimed, or one the
// scheduler promoted to a task meanwhile, is never undone by an older copy.
// Added rows keep only what a person or a draft supplies; claims, approvals
// and results stay host-owned. A typed ask with no title is titled from its
// first line, since promotion (the only way a request reaches a worker) needs
// one, and the owner's own rows carry origin by "owner" so their cards rank in
// the owner band instead of below every roster-filed request.
function applyRequestAction(requests, { action, requests: incoming, key } = {}, now = Date.now()) {
  const rows = Array.isArray(requests) ? requests : [];
  if (action === "add") {
    const added = (Array.isArray(incoming) ? incoming : [])
      .map((row) => {
        const prompt = typeof row?.prompt === "string" ? row.prompt.trim().slice(0, 20000) : "";
        const title = typeof row?.title === "string" && row.title.trim() ? row.title.trim().slice(0, 200) : requestTitle({ prompt });
        const source = REQUEST_SOURCES.has(row?.source) ? row.source : "manual";
        return {
          ...(title ? { title } : {}),
          prompt,
          at: now,
          source,
          ...(OWNER_REQUEST_SOURCES.has(source) ? { origin: { kind: "request", by: "owner" } } : {}),
        };
      })
      .filter((row) => row.prompt);
    if (!added.length) return { ok: false, error: "Write a request first." };
    return { ok: true, requests: [...added, ...rows], added: added.length };
  }
  if (action === "remove") {
    const index = rows.findIndex((row) => requestKey(row) === requestKey(key));
    if (index < 0) return { ok: false, error: "This request is no longer in the inbox. It may have started or become a task." };
    const row = rows[index];
    if (row.runId || row.lease || ["active", "running", "verifying"].includes(row.status)) return { ok: false, error: "A worker holds this request. Stop it or let it finish before removing it." };
    return { ok: true, requests: rows.filter((_, position) => position !== index) };
  }
  return { ok: false, error: "Choose a request action." };
}

module.exports = { applyIdeaAction, applyRequestAction };
