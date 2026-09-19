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

module.exports = { applyIdeaAction };
