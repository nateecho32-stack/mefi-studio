// Apply one UI intent to the latest board, so reading or keeping an idea
// cannot replace a promotion or erase ideas that arrived in the meantime.
function applyIdeaAction(ideas, { action, ideaId, ideaIds } = {}, now = Date.now()) {
  const rows = Array.isArray(ideas) ? ideas : [];
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
// and results stay host-owned.
function applyRequestAction(requests, { action, requests: incoming, key } = {}, now = Date.now()) {
  const rows = Array.isArray(requests) ? requests : [];
  if (action === "add") {
    const added = (Array.isArray(incoming) ? incoming : [])
      .map((row) => ({
        ...(typeof row?.title === "string" && row.title.trim() ? { title: row.title.trim().slice(0, 200) } : {}),
        prompt: typeof row?.prompt === "string" ? row.prompt.trim().slice(0, 20000) : "",
        at: now,
        source: REQUEST_SOURCES.has(row?.source) ? row.source : "manual",
      }))
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
