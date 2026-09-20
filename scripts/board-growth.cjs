// Bound speculative discovery against the durable board. Accepted work is
// never removed; manual requests, defect repairs and handoffs keep their path.
const GROWTH_BUFFER = 3;
const { buildScope } = require("./backlog.cjs");
const GROWTH_SOURCES = new Set(["grow", "grower", "improver", "overseer"]);
const rows = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const text = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const titleKey = (value) => text(value).toLowerCase().replace(/^overseer\s*:\s*/, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const obligationKey = (item) => {
  // Identity, source labels and empty containers change on promotion; actual
  // requirements, project, files, acceptance and references must still agree.
  const scope = { ...item, id: undefined, source: undefined, title: titleKey(item?.title), prompt: text(item?.prompt) };
  for (const [name, value] of Object.entries(scope)) {
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) delete scope[name];
  }
  return buildScope(scope);
};
const unresolved = (item) => !["done", "archived", "absorbed", "dismissed", "rejected"].includes(item?.status);
const isGrowth = (item) => GROWTH_SOURCES.has(item?.source) && !item?.handoffId && !item?.fromRun;

function represented(board, request) {
  if (!isGrowth(request) || !text(request?.prompt)) return false;
  const key = obligationKey(request);
  return rows(board?.tasks).flatMap((task) => [task, ...rows(task.members)])
    .some((task) => obligationKey(task) === key);
}

function summarize(board = {}) {
  const tasks = rows(board.tasks).filter(unresolved);
  const representedKeys = new Set(rows(board.tasks).flatMap((task) => [task, ...rows(task.members)]).map(obligationKey));
  const requests = rows(board.requests).filter((request) => {
    if (!unresolved(request) || request.absorbedInto) return false;
    const key = obligationKey(request);
    if (representedKeys.has(key)) return false;
    representedKeys.add(key);
    return true;
  });
  const outstanding = tasks.length + requests.length;
  const work = [...tasks, ...requests].sort((a, b) => Number(a.createdAt ?? a.at ?? 0) - Number(b.createdAt ?? b.at ?? 0));
  const existingWork = [];
  for (const item of work) {
    const next = { id: item.id ?? null, title: text(item.title).slice(0, 120), status: item.status || "queued", brief: text(item.prompt).slice(0, 180) };
    if (JSON.stringify([...existingWork, next]).length > 5500) break;
    existingWork.push(next);
  }
  return { outstanding, available: Math.max(0, GROWTH_BUFFER - outstanding), growthHeld: outstanding >= GROWTH_BUFFER,
    existingWork, omitted: outstanding - existingWork.length };
}

module.exports = { GROWTH_BUFFER, isGrowth, represented, summarize };
