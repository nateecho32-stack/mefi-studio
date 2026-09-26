// Project and overall verified outcomes, combined without moving local ledgers.
// Pure module: no Electron, no filesystem, no network, no clock reads.
"use strict";
const rows = (value) => Array.isArray(value) ? value : [];
const count = (value) => Math.max(0, Number(value) || 0);
const key = (row) => `${row.provider}::${row.model}`;
function record(project = {}, global = {}, scope = "blend") {
  if (scope === "off") return { wins: 0, losses: 0, winProbability: 0.5, learningScope: scope };
  const get = (field) => scope === "project" ? count(project[field]) : scope === "global" ? count(global[field])
    : count(project[field]) + 0.3 * Math.max(0, count(global[field]) - count(project[field]));
  const wins = get("wins"), losses = get("losses");
  return { wins, losses, winProbability: (1 + wins) / (2 + wins + losses), learningScope: scope };
}
function aggregate(snapshots = []) {
  const models = new Map();
  for (const snapshot of rows(snapshots)) for (const model of rows(snapshot.models)) {
    const id = key(model);
    if (!models.has(id)) models.set(id, { provider: model.provider, model: model.model, wins: 0, losses: 0, taskStrengths: [] });
    const target = models.get(id);
    target.wins += count(model.wins); target.losses += count(model.losses);
    for (const task of rows(model.taskStrengths)) {
      let group = target.taskStrengths.find((row) => row.taskType === task.taskType);
      if (!group) { group = { taskType: task.taskType, wins: 0, losses: 0 }; target.taskStrengths.push(group); }
      group.wins += count(task.wins); group.losses += count(task.losses);
    }
  }
  return { models: [...models.values()] };
}
function blend({ project = {}, global = {}, scope = "blend", measured = project } = {}) {
  if (scope === "off") return { models: [] };
  const ids = new Set([...rows(project.models), ...rows(global.models)].map(key));
  return { models: [...ids].map((id) => {
    const local = rows(project.models).find((row) => key(row) === id) ?? {};
    const overall = rows(global.models).find((row) => key(row) === id) ?? {};
    const metrics = rows(measured.models).find((row) => key(row) === id) ?? {};
    const types = new Set([...rows(local.taskStrengths), ...rows(overall.taskStrengths)].map((row) => row.taskType));
    return { ...metrics, provider: local.provider ?? overall.provider, model: local.model ?? overall.model, ...record(local, overall, scope),
      taskStrengths: [...types].map((taskType) => ({ ...rows(metrics.taskStrengths).find((row) => row.taskType === taskType), taskType,
        ...record(rows(local.taskStrengths).find((row) => row.taskType === taskType), rows(overall.taskStrengths).find((row) => row.taskType === taskType), scope) })) };
  }) };
}
function skills(snapshot = {}) {
  return rows(snapshot.models).flatMap((model) => rows(model.taskStrengths).map((task) => ({ provider: model.provider, model: model.model, taskType: task.taskType,
    wins: count(task.wins), losses: count(task.losses), n: count(task.wins) + count(task.losses), p: (1 + count(task.wins)) / (2 + count(task.wins) + count(task.losses)) }))).filter((row) => row.n > 0).sort((a, b) => a.taskType.localeCompare(b.taskType) || b.p - a.p || b.n - a.n);
}
module.exports = { record, aggregate, blend, skills };
