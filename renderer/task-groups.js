// Read-only graph relationships. Grouping a picture never changes task
// ownership, scheduling, prerequisites, status, or the saved board.
(() => {
  "use strict";
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const idOf = (value) => typeof value === "string" ? value.trim() : "";
  const rows = (value) => Array.isArray(value) ? value : [];
  const sameProject = (a, b) => {
    if (a?.projectId && b?.projectId && a.projectId !== b.projectId) return false;
    const key = (value) => String(value || "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
    return !a?.projectPath || !b?.projectPath || key(a.projectPath) === key(b.projectPath);
  };

  function groupTasks(tasks, { plans = [] } = {}) {
    const byId = new Map();
    for (const task of rows(tasks)) if (object(task) && idOf(task.id) && !byId.has(task.id)) byId.set(task.id, task);
    const groups = new Map();
    const assigned = new Map();
    const ensure = (task) => {
      if (!groups.has(task.id)) groups.set(task.id, { id: task.id, kind: "task-plan", planId: task.id, title: String(task.title || "Grouped work"), task, readOnly: false, members: [] });
      return groups.get(task.id);
    };
    const add = (group, task, snapshot = null, canonical = true) => {
      const id = idOf(task?.id);
      if (!id || id === group.id || assigned.has(id)) return;
      let cursor = group.id;
      const seen = new Set();
      while (cursor && !seen.has(cursor)) { if (cursor === id) return; seen.add(cursor); cursor = assigned.get(cursor); }
      assigned.set(id, group.id);
      group.members.push({ id, task, snapshot, canonical, readOnly: true });
    };
    // The current ownership link wins over a stale membership snapshot.
    for (const task of byId.values()) {
      const parent = byId.get(idOf(task.absorbedInto));
      if (parent && parent !== task) add(ensure(parent), task);
    }
    const parentTasks = [...byId.values()].filter((task) => rows(task.members).length).sort((a, b) => a.id.localeCompare(b.id));
    for (const parent of parentTasks) {
      const group = ensure(parent);
      for (const snapshot of rows(parent.members)) {
        if (!object(snapshot) || !idOf(snapshot.id)) continue;
        const canonical = byId.get(snapshot.id);
        // A task that now belongs to another plan cannot be stolen back by
        // this older plan's snapshot. Missing rows remain recoverable here.
        if (canonical?.absorbedInto && canonical.absorbedInto !== parent.id) continue;
        if (assigned.get(snapshot.id) === parent.id) {
          const member = group.members.find((entry) => entry.id === snapshot.id);
          if (member && !member.snapshot) member.snapshot = snapshot;
        } else add(group, canonical || snapshot, snapshot, Boolean(canonical));
      }
    }
    // Delegated builders are real tasks, so preserve each child's status and
    // keep the parent as the final integration step instead of absorbing it.
    for (const task of byId.values()) {
      const parent = byId.get(idOf(task.delegatedFrom?.parentTaskId || task.parentTaskId));
      if (!parent || !sameProject(parent, task) || !task.delegatedFrom && !rows(parent.delegation?.childTaskIds).includes(task.id)) continue;
      const group = ensure(parent);
      if (!rows(parent.members).length) group.kind = "task-delegation";
      add(group, task);
    }
    const planById = new Map(rows(plans).filter(object).map((plan) => [idOf(plan.id), plan]));
    for (const task of byId.values()) {
      const planId = idOf(task.planningId);
      if (!planId || assigned.has(task.id) || groups.has(task.id)) continue;
      const id = `planning:${planId}`;
      if (!groups.has(id)) groups.set(id, { id, kind: "approved-plan", planId, title: String(planById.get(planId)?.title || task.planningTitle || "Project plan"), task: null, readOnly: true, members: [] });
      add(groups.get(id), task);
    }
    // A lone approved-plan task adds no useful hierarchy. Explicit durable
    // task groups stay visible even after all but one member has finished.
    return [...groups.values()].filter((group) => group.members.length && (group.kind !== "approved-plan" || group.members.length > 1)).map((group) => {
      const order = new Map();
      rows(group.task?.members).forEach((member, index) => { if (!order.has(idOf(member?.id))) order.set(idOf(member?.id), index); });
      group.members.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.id.localeCompare(b.id));
      return group;
    }).sort((a, b) => a.id.localeCompare(b.id));
  }

  function graphTasks(tasks, { groups = groupTasks(tasks), runningIds = new Set(), expanded = new Set(), limit = 12, childLimit = 12 } = {}) {
    const live = (task) => ["open", "active", "awaiting_verification"].includes(task?.status);
    const urgent = (task) => runningIds.has(task.id) || ["active", "awaiting_verification"].includes(task.status);
    const rank = (task) => runningIds.has(task.id) ? 0 : urgent(task) ? 1 : task.workPin || task.pinnedAt ? 2 : 3;
    const visibleGroups = groups.filter((group) => live(group.task) || group.members.some((member) => live(member.task)));
    const children = new Set(visibleGroups.flatMap((group) => group.members.map((member) => member.id)));
    const grouped = new Set(visibleGroups.map((group) => group.id));
    const top = rows(tasks).filter((task) => live(task) && !children.has(task.id) && !grouped.has(task.id)).map((task) => ({ task }));
    for (const group of visibleGroups) {
      const task = group.task || { id: group.id, title: group.title, status: "open", updatedAt: Math.max(0, ...group.members.map((member) => Number(member.task.updatedAt) || 0)) };
      top.push({ task, taskGroup: group, readOnly: group.readOnly || !live(task), rank: Math.min(rank(task), ...group.members.filter((member) => live(member.task)).map((member) => rank(member.task))) });
    }
    top.sort((a, b) => (a.rank ?? rank(a.task)) - (b.rank ?? rank(b.task)) || (b.task.updatedAt ?? b.task.createdAt ?? 0) - (a.task.updatedAt ?? a.task.createdAt ?? 0) || a.task.id.localeCompare(b.task.id));
    const result = top.slice(0, Math.max(1, limit));
    let remaining = Math.max(0, childLimit);
    let urgentRemaining = 24;
    const included = new Set(result.map((entry) => entry.task.id));
    for (const parent of [...result]) {
      if (!parent.taskGroup) continue;
      // Active children stay visible even when their group is collapsed.
      // Other children share a small budget; the card always lists them all.
      const members = [...parent.taskGroup.members].sort((a, b) => rank(a.task) - rank(b.task));
      for (const member of members) {
        if (included.has(member.id) || !urgent(member.task) && (!expanded.has(parent.taskGroup.id) || remaining <= 0)) continue;
        if (urgent(member.task) && !runningIds.has(member.id)) { if (urgentRemaining <= 0) continue; urgentRemaining -= 1; }
        if (!urgent(member.task)) remaining -= 1;
        included.add(member.id);
        result.push({ task: member.task, member, readOnly: true, groupParentId: `task:${parent.task.id}` });
      }
    }
    return result;
  }

  // A goal-level board: explicit plans and conversation follow-ups share a
  // card, but the underlying task records and scheduling stay untouched.
  function overviewGroups(tasks, { plans = [] } = {}) {
    const byId = new Map(rows(tasks).filter((task) => object(task) && idOf(task.id)).map((task) => [task.id, task]));
    const result = new Map(), owner = new Map();
    const add = (group, task, { canonical = true, snapshot = null } = {}) => {
      if (!idOf(task?.id) || owner.has(task.id)) return;
      owner.set(task.id, group);
      group.members.push({ id: task.id, task, canonical, snapshot, readOnly: !canonical });
    };
    for (const plan of rows(plans).filter((plan) => object(plan) && idOf(plan.id))) {
      const group = { id: `planning:${plan.id}`, kind: "approved-plan", planId: plan.id, title: String(plan.title || "Project plan"), plan, task: null, readOnly: true, members: [] };
      result.set(group.id, group);
      const ids = new Set(rows(plan.taskIds).map(idOf));
      for (const task of byId.values()) if (sameProject(plan, task) && (task.planningId === plan.id || ids.has(task.id))) add(group, task);
      for (const id of ids) if (id && !byId.has(id)) add(group, { id, title: "Saved step unavailable", status: "unknown", unavailable: true }, { canonical: false });
    }
    for (const task of byId.values()) {
      if (!task.planningId || owner.has(task.id)) continue;
      const id = `planning:${task.planningId}`;
      // Keep task progress visible even while the planning list is unavailable.
      let group = result.get(id);
      if (!group) {
        group = { id, kind: "approved-plan", planId: task.planningId, title: String(task.planningTitle || "Project plan"), task: null, readOnly: true, members: [] };
        result.set(id, group);
      }
      if (sameProject(group.plan, task)) add(group, task);
    }
    for (const explicit of groupTasks([...byId.values()], { plans })) {
      if (!explicit.task) continue;
      let group = owner.get(explicit.task.id);
      if (!group) {
        group = { ...explicit, members: [] };
        result.set(group.id, group);
        // An executable grouped plan is the aggregate, not another child step.
        owner.set(explicit.task.id, group);
      }
      for (const member of explicit.members) if (sameProject(explicit.task, member.task)) add(group, member.task, member);
    }
    const rootOf = (task) => {
      let current = task;
      const chain = [], seen = new Set();
      while (current && !owner.has(current.id)) {
        if (seen.has(current.id)) return chain.slice(chain.findIndex((row) => row.id === current.id)).sort((a, b) => a.id.localeCompare(b.id))[0];
        seen.add(current.id); chain.push(current);
        const parent = byId.get(idOf(current.parentTaskId));
        if (!parent || !sameProject(current, parent)) return current;
        current = parent;
      }
      return current || task;
    };
    for (const task of byId.values()) {
      if (owner.has(task.id)) continue;
      const root = rootOf(task);
      let group = owner.get(root.id);
      if (!group) {
        group = { id: root.id, kind: "task", title: String(root.title || "Untitled work"), task: root, readOnly: false, members: [] };
        result.set(group.id, group);
        add(group, root);
      }
      add(group, task);
      if (group.kind === "task" && group.members.length > 1) group.kind = "task-thread";
    }
    // Parents listed after their children must land on the same root card.
    // Preserve all explicit membership order and append conversation follow-ups.
    return [...result.values()];
  }

  window.MefiTaskGroups = { groupTasks, graphTasks, overviewGroups };
})();
