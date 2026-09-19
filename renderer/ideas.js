// Mefi's Studio AI+ — Feature ideas: unread inbox + self-building feature graph.
(function () {
  "use strict";

  const state = { ideas: [], selected: null, view: "graph", clusterFilter: null };
  const el = {};
  let initialized = false;

  const unreadCount = () => state.ideas.filter((idea) => !idea.read).length;
  // #ideas-open binds straight to open(), so arg 0 can be a click Event.
  const optionsOf = (value) =>
    value && typeof value === "object" && typeof value.preventDefault !== "function" ? value : {};

  function save() {
    window.mefiStudio?.ideasSave?.(state.ideas);
    updateBadge();
    renderList();
    drawGraph();
  }

  function updateBadge() {
    const unread = unreadCount();
    // The id is guaranteed by the DOM contract; nav owns the element's hidden state.
    document.getElementById("ideas-badge").textContent = String(unread);
    el.unread.textContent = String(unread);
    window.MefiNav?.setBadge?.("ideas", unread);
  }

  async function load() {
    const result = await window.mefiStudio?.ideasList?.();
    state.ideas = result?.ideas ?? [];
    updateBadge();
    renderList();
    renderDetail();
    drawGraph();
  }

  function statusTag(idea) {
    const tag = document.createElement("span");
    tag.className = `src-tag ${idea.status === "done" ? "improver" : idea.status === "accepted" ? "" : idea.status === "keep" ? "collision" : ""}`;
    tag.textContent = idea.status.toUpperCase();
    return tag;
  }

  function renderList() {
    el.list.textContent = "";
    const ordered = [...state.ideas].sort((a, b) => Number(a.read) - Number(b.read) || b.at - a.at);
    const filtered = state.clusterFilter ? ordered.filter((idea) => (idea.tags ?? []).includes(state.clusterFilter)) : ordered;
    if (!filtered.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = state.clusterFilter ? `No ideas tagged "${state.clusterFilter}".` : "No ideas yet — press Scan chats.";
      el.list.append(li);
      return;
    }
    for (const idea of filtered.slice(0, 60)) {
      const li = document.createElement("li");
      li.classList.add("task-row");
      li.style.setProperty("--task-color", idea.read ? "rgba(201,168,106,0.25)" : "#e6c98d");
      if (idea.id === state.selected) li.classList.add("selected");
      li.append(statusTag(idea));
      li.append(document.createTextNode(` ${idea.title ?? idea.detail}`));
      const meta = document.createElement("div");
      meta.className = "who";
      meta.textContent = `${idea.source} · ${new Date(idea.at).toLocaleString()}${idea.read ? "" : " · unread"}`;
      li.append(meta);
      // Focusable because nav's claim() focuses "#ideas-list li".
      li.tabIndex = 0;
      li.addEventListener("click", () => select(idea.id));
      li.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          li.click();
        }
      });
      el.list.append(li);
    }
  }

  function select(id) {
    const idea = state.ideas.find((item) => item.id === id);
    if (!idea) return;
    state.selected = id;
    if (!idea.read) {
      idea.read = true;
      save();
    }
    renderList();
    renderDetail();
    drawGraph();
  }

  function renderDetail() {
    const idea = state.ideas.find((item) => item.id === state.selected);
    el.detail.textContent = "";
    if (!idea) {
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "Select an idea to read it, keep it, or mark it done.";
      el.detail.append(hint);
      return;
    }
    const title = document.createElement("p");
    title.textContent = idea.detail;
    el.detail.append(title);
    const tags = document.createElement("div");
    tags.className = "keyword-row";
    for (const tag of idea.tags ?? []) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        state.clusterFilter = state.clusterFilter === tag ? null : tag;
        renderList();
      });
      tags.append(chip);
    }
    el.detail.append(tags);
    const actions = document.createElement("div");
    actions.className = "row";
    const action = (label, handler) => {
      const button = document.createElement("button");
      button.className = "ghost";
      button.textContent = label;
      button.addEventListener("click", handler);
      actions.append(button);
    };
    action("Keep", () => {
      idea.status = "keep";
      save();
      renderDetail();
    });
    action("Done", () => {
      idea.status = "done";
      idea.read = true;
      save();
      renderDetail();
    });
    action("Make task", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const created = await window.MefiTasks?.addTask(idea.detail ?? idea.title);
      // Only a saved task accepts the idea, and an ideas broadcast during the
      // await replaces state.ideas, so mark the live entry, not the captured one.
      const live = created ? state.ideas.find((item) => item.id === idea.id) : null;
      if (!live) {
        button.disabled = false;
        return;
      }
      live.status = "accepted";
      save();
      renderDetail();
    });
    action("Delete", () => {
      state.ideas = state.ideas.filter((item) => item.id !== idea.id);
      state.selected = null;
      save();
      renderDetail();
    });
    el.detail.append(actions);
  }

  // ---------- feature graph ----------
  function cluster() {
    const clusters = [];
    const byTag = new Map();
    state.ideas.forEach((idea) => {
      for (const tag of idea.tags ?? []) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag).push(idea.id);
      }
    });
    const seen = new Set();
    for (const idea of state.ideas) {
      if (seen.has(idea.id)) continue;
      const group = [idea];
      seen.add(idea.id);
      const queue = [idea];
      while (queue.length) {
        const current = queue.pop();
        for (const tag of current.tags ?? []) {
          for (const id of byTag.get(tag) ?? []) {
            if (seen.has(id)) continue;
            seen.add(id);
            const next = state.ideas.find((item) => item.id === id);
            group.push(next);
            queue.push(next);
          }
        }
      }
      clusters.push(group);
    }
    return clusters;
  }

  function drawGraph() {
    if (el.canvas.hidden) return;
    const width = el.canvas.parentElement.clientWidth - 30;
    const height = 420;
    const dpr = window.devicePixelRatio || 1;
    el.canvas.width = width * dpr;
    el.canvas.height = height * dpr;
    el.canvas.style.width = width + "px";
    el.canvas.style.height = height + "px";
    const ctx = el.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, width, height);

    const clusters = cluster();
    const positions = new Map();
    const golden = Math.PI * (3 - Math.sqrt(5));
    clusters.forEach((group, clusterIndex) => {
      const clusterAngle = clusterIndex * golden;
      const clusterRadius = Math.min(width, height) * 0.32;
      const cx = width / 2 + Math.cos(clusterAngle) * clusterRadius;
      const cy = height / 2 + Math.sin(clusterAngle) * clusterRadius * 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, 26 + group.length * 2.4, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(201,168,106,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
      group.forEach((idea, ideaIndex) => {
        const angle = (ideaIndex / Math.max(1, group.length)) * Math.PI * 2;
        const radius = 30 + (ideaIndex % 3) * 26;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.85;
        positions.set(idea.id, { x, y, cx, cy });
      });
    });
    for (const idea of state.ideas) {
      const home = positions.get(idea.id);
      if (!home) continue;
      for (const tag of idea.tags ?? []) {
        const sibling = state.ideas.find((other) => other.id !== idea.id && (other.tags ?? []).includes(tag));
        const target = sibling ? positions.get(sibling.id) : null;
        if (target) {
          ctx.strokeStyle = "rgba(157,183,255,0.10)";
          ctx.beginPath();
          ctx.moveTo(home.x, home.y);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
        }
      }
    }
    for (const idea of state.ideas) {
      const point = positions.get(idea.id);
      if (!point) continue;
      const selected = idea.id === state.selected;
      const colour = idea.status === "done" ? "#57ff9a" : idea.status === "accepted" ? "#9db7ff" : idea.status === "keep" ? "#ffd479" : idea.read ? "#9a8f7d" : "#e6c98d";
      ctx.beginPath();
      ctx.arc(point.x, point.y, selected ? 7 : idea.read ? 4 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      if (selected) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 11, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(236,229,216,0.8)";
        ctx.stroke();
      }
      if (!idea.read) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(87,255,154,0.5)";
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(236,229,216,0.72)";
      ctx.font = "10px system-ui";
      ctx.fillText(String(idea.title ?? idea.detail ?? "").slice(0, 22), point.x + 8, point.y + 3);
    }
    el.canvas.onclick = (event) => {
      const rect = el.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let best = null;
      let bestDistance = 14;
      for (const [id, point] of positions) {
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < bestDistance) {
          best = id;
          bestDistance = distance;
        }
      }
      if (best) select(best);
    };
  }

  async function scan(ai) {
    el.status.textContent = ai ? "AI review…" : "scanning chats…";
    const result = await window.mefiStudio?.ideasScan?.(ai);
    if (!result?.ok) {
      el.status.textContent = result?.error ?? "scan failed";
      return;
    }
    state.ideas = result.ideas ?? state.ideas;
    updateBadge();
    renderList();
    drawGraph();
    // The pass writes its own summary line (ideas added, what the AI review
    // compacted); the composed fallback only covers older main processes.
    el.status.textContent = result.text || `+${result.added} ideas · ${result.scanned} lines considered${result.aiError ? ` · ${result.aiError}` : ""}`;
    if (result.added) window.MefiToast?.(`${result.added} new idea${result.added === 1 ? "" : "s"} captured`, "good");
  }

  function open(options) {
    window.MefiNav?.claim?.("ideas");
    const params = optionsOf(options);
    el.overlay.hidden = false;
    // load() is async; a deep-linked idea can only be selected once it exists.
    load().then(() => {
      if (typeof params.ideaId === "string" && params.ideaId) select(params.ideaId);
      el.list?.querySelector("li.selected")?.scrollIntoView({ block: "nearest" });
    });
  }

  function close() {
    if (el.overlay.hidden) return;
    el.overlay.hidden = true;
    window.MefiNav?.release?.("ideas");
  }

  function init() {
    if (initialized) return;
    initialized = true;
    for (const [key, id] of Object.entries({
      overlay: "ideas-overlay",
      list: "ideas-list",
      detail: "ideas-detail",
      canvas: "ideas-canvas",
      status: "ideas-hint",
      unread: "ideas-unread",
      view: "ideas-view",
      scan: "ideas-scan",
      ai: "ideas-ai",
      clean: "ideas-clean",
      close: "ideas-close",
      openButton: "ideas-open",
    })) {
      el[key] = document.getElementById(id);
    }
    el.openButton?.addEventListener("click", open);
    el.close?.addEventListener("click", close);
    el.overlay?.addEventListener("click", (event) => {
      if (event.target === el.overlay) close();
    });
    el.scan?.addEventListener("click", () => scan(false));
    el.ai?.addEventListener("click", () => scan(true));
    el.clean?.addEventListener("click", () => {
      state.ideas = state.ideas.filter((idea) => idea.status !== "done" && idea.status !== "accepted");
      save();
      el.status.textContent = "cleaned done/accepted ideas";
    });
    el.view?.addEventListener("click", () => {
      state.view = state.view === "graph" ? "list" : "graph";
      el.view.textContent = state.view === "graph" ? "Graph view" : "List view";
      // `hidden`, not display: it is what drawGraph()'s early return reads.
      el.canvas.hidden = state.view !== "graph";
      drawGraph();
    });
    window.mefiStudio?.onIdeas?.((ideas) => {
      state.ideas = Array.isArray(ideas) ? ideas : [];
      updateBadge();
      if (!el.overlay.hidden) {
        renderList();
        drawGraph();
      }
    });
  }

  window.MefiIdeas = { init, open, close, scan, select };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
