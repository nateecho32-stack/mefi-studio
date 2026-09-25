// Mefi's Studio AI+ — Graph tab: value map, task-fit heatmap, pools, table.
// Classic script (no modules) so the built booklet stays file:// friendly.
(function () {
  "use strict";

  const fmt = {
    money(value, digits) {
      if (value == null) return "—";
      if (value === 0) return "Free";
      const places = digits ?? (value < 0.01 ? 5 : value < 1 ? 3 : 2);
      return "$" + value.toFixed(places).replace(/0+$/, "").replace(/\.$/, "");
    },
    int(value) {
      if (value == null) return "—";
      if (value === Infinity || value === "unlimited") return "∞";
      return Number(value).toLocaleString();
    },
    ctx(value) {
      if (value == null) return "—";
      if (value >= 1e6) return (value / 1e6).toFixed(value % 1e6 ? 1 : 0) + "M";
      if (value >= 1e3) return Math.round(value / 1e3) + "K";
      return String(value);
    },
    pool(value) {
      if (value == null) return "—";
      if (value === "unlimited") return "∞";
      return "$" + value;
    },
  };

  function privacyScore(model, scores) {
    if (!model.privacy) return scores.unknown;
    if (model.privacy.training) return scores.trains;
    if (model.privacy.retentionDays === 0) return scores["no-train-0day"];
    if (typeof model.privacy.retentionDays === "number") return scores["no-train-30day"];
    return scores.unknown;
  }

  function privacyLabel(model) {
    if (!model.privacy) return "unknown";
    if (model.privacy.training) return "trains on data";
    if (model.privacy.retentionDays === 0) return "0-day, no training";
    if (typeof model.privacy.retentionDays === "number") return model.privacy.retentionDays + "-day retention";
    return "no training";
  }

  function reqH5(model) {
    const value = model.usage?.requests?.h5;
    if (value === "unlimited") return Infinity;
    return typeof value === "number" ? value : null;
  }

  function eligible(doc, preset) {
    return doc.models.filter((model) => {
      if (model.legacy) return false;
      if (!model.pricing?.default) return false;
      if (preset?.requiresModality && !(model.capabilities?.modalities?.input ?? []).includes(preset.requiresModality)) return false;
      return (model.typicalCostUSD != null || model.usage?.unlimited) && reqH5(model) != null;
    });
  }

  function metricNorms(models) {
    const costs = models.map((m) => m.typicalCostUSD ?? 0);
    // Request headroom is compared on a log10 scale. An unlimited model sits
    // one decade above the roomiest finite model: a raw 1e9 became the whole
    // range and flattened every finite model's speed norm to ~0.
    const finiteLogs = models.map(reqH5).filter((r) => r !== Infinity).map((r) => Math.log10(Math.max(r, 1)));
    const unlimitedLog = (finiteLogs.length ? Math.max(...finiteLogs) : 0) + 1;
    const speedLog = (m) => {
      const r = reqH5(m);
      return r === Infinity ? unlimitedLog : Math.log10(Math.max(r, 1));
    };
    const speeds = models.map(speedLog);
    const costMin = Math.min(...costs);
    const costMax = Math.max(...costs);
    const speedMin = Math.min(...speeds);
    const speedMax = Math.max(...speeds);
    return {
      cost: (m) => {
        const v = m.typicalCostUSD ?? 0;
        if (costMax === costMin) return 1;
        return 1 - (v - costMin) / (costMax - costMin);
      },
      speed: (m) => {
        const v = speedLog(m);
        if (speedMax === speedMin) return 1;
        return (v - speedMin) / (speedMax - speedMin);
      },
      quality: (m) => (m.quality?.index != null ? Math.min(1, m.quality.index / 60) : 0),
      context: (m) => (m.limits?.context ? Math.min(1, Math.log2(m.limits.context) / Math.log2(1e6)) : 0),
      privacy: (m) => privacyScore(m, { "no-train-0day": 1, "no-train-30day": 0.75, trains: 0.25, unknown: 0.5 }),
    };
  }

  function whyFor(model, preset, norms) {
    const labels = {
      cost: () => `${fmt.money(model.typicalCostUSD)}/typical request`,
      speed: () => {
        const r = reqH5(model);
        return r === Infinity ? "unlimited requests" : `${fmt.int(r)} req/5h`;
      },
      quality: () => (model.quality?.index != null ? `AA II ${model.quality.index}` : "no published index"),
      context: () => `${fmt.ctx(model.limits?.context)} context`,
      privacy: () => privacyLabel(model),
    };
    const factors = Object.keys(preset.weights)
      .map((key) => ({ key, contribution: preset.weights[key] * norms[key](model) }))
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3)
      .map((f) => labels[f.key]());
    const caveats = [];
    if (model.quality?.index == null) caveats.push("unproven quality");
    if (model.privacy?.training) caveats.push("trains on your prompts");
    if (model.experimental) caveats.push("experimental");
    if (model.promo) caveats.push(model.promo);
    return factors.join(" · ") + (caveats.length ? ` — ${caveats.join(", ")}` : "");
  }

  function scoreModels(doc, presetId) {
    const preset = doc.taskPresets.find((p) => p.id === presetId) ?? doc.taskPresets[0];
    const pool = eligible(doc, preset);
    const norms = metricNorms(pool);
    const scored = pool.map((model) => {
      let score = 0;
      for (const [key, weight] of Object.entries(preset.weights)) {
        score += weight * norms[key](model);
      }
      return { model, score, why: whyFor(model, preset, norms), norms };
    });
    return { preset, ranked: scored.sort((a, b) => b.score - a.score) };
  }

  function prep(canvas, height) {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(320, canvas.parentElement.clientWidth - 30);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: width, h: height };
  }

  const PALETTE = ["#e6c98d", "#9db7ff", "#c9a8ff", "#57ff9a", "#ffb38a", "#86d1d6", "#f2a2e8", "#a8e6cf", "#ffd479", "#b8c0ff"];

  function drawValueMap(canvas, tip, doc) {
    const models = doc.models.filter((m) => m.quality?.index != null && m.typicalCostUSD != null);
    const { ctx, w, h } = prep(canvas, 460);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 56, r: 26, t: 26, b: 48 };
    const costs = models.map((m) => Math.max(m.typicalCostUSD, 0.00005));
    const xMin = Math.log10(Math.min(...costs)) - 0.15;
    const xMax = Math.log10(Math.max(...costs)) + 0.15;
    const yMin = 30;
    const yMax = 60;
    const X = (v) => pad.l + ((Math.log10(Math.max(v, 0.00005)) - xMin) / (xMax - xMin)) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (h - pad.t - pad.b);

    ctx.strokeStyle = "rgba(201, 168, 106, 0.12)";
    ctx.fillStyle = "#9a8f7d";
    ctx.font = "11px system-ui";
    for (let q = 30; q <= 60; q += 5) {
      const y = Y(q);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(String(q), 18, y + 4);
    }
    for (const c of [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1]) {
      if (Math.log10(c) < xMin || Math.log10(c) > xMax) continue;
      const x = X(c);
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, h - pad.b);
      ctx.stroke();
      ctx.fillText(fmt.money(c), x - 14, h - pad.b + 18);
    }
    ctx.fillText("$ / typical request (log)", w / 2 - 60, h - 12);
    ctx.save();
    ctx.translate(14, h / 2 + 40);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("AA Intelligence Index", 0, 0);
    ctx.restore();

    const reqs = models.map((m) => reqH5(m)).filter((v) => v != null && v !== Infinity);
    const rMax = Math.max(...reqs, 1);
    const vendors = [...new Set(models.map((m) => m.vendor))];
    const points = [];
    for (const model of models) {
      const x = X(model.typicalCostUSD);
      const y = Y(model.quality.index);
      const r = 5 + 16 * Math.sqrt(Math.min(1, (reqH5(model) === Infinity ? rMax : reqH5(model)) / rMax));
      const color = PALETTE[vendors.indexOf(model.vendor) % PALETTE.length];
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#050507";
      ctx.stroke();
      points.push({ x, y, r, model });
    }

    // Labels are placed in a second pass with collision avoidance; the best
    // models win a slot, everything else stays reachable through the tooltip.
    const placed = [];
    const overlaps = (rect) =>
      placed.some((p) => !(rect.x + rect.w < p.x || p.x + p.w < rect.x || rect.y + rect.h < p.y || p.y + p.h < rect.y));
    ctx.font = "11px system-ui";
    for (const point of [...points].sort((a, b) => b.model.quality.index - a.model.quality.index)) {
      const { x, y, r, model } = point;
      const width = ctx.measureText(model.name).width;
      const candidates = [
        [x + r + 3, y - 6],
        [x - r - 3 - width, y - 6],
        [x - width / 2, y - r - 14],
        [x - width / 2, y + r + 5],
      ];
      ctx.fillStyle = "#ece5d8";
      for (const [lx, ly] of candidates) {
        const rect = { x: lx - 1, y: ly - 1, w: width + 2, h: 15 };
        if (lx < pad.l || lx + width > w - pad.r || ly < pad.t - 10 || ly > h - pad.b) continue;
        if (overlaps(rect)) continue;
        placed.push(rect);
        ctx.fillText(model.name, lx, ly + 11);
        break;
      }
    }
    return points;
  }

  function drawHeatmap(canvas, doc) {
    const presets = doc.taskPresets;
    const perTask = presets.map((p) => ({ p, ranked: scoreModels(doc, p.id).ranked }));
    const best = new Map();
    for (const { p, ranked } of perTask) {
      ranked.slice(0, 10).forEach((entry, index) => {
        const current = best.get(entry.model.id) ?? { model: entry.model, score: 0, ranks: {} };
        current.score = Math.max(current.score, entry.score);
        current.ranks[p.id] = entry.score;
        best.set(entry.model.id, current);
      });
    }
    const rows = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 14);
    const { ctx, w, h } = prep(canvas, Math.max(240, 64 + rows.length * 28));
    ctx.clearRect(0, 0, w, h);
    const labelW = 190;
    const cellW = (w - labelW - 10) / presets.length;
    ctx.font = "11.5px system-ui";
    ctx.fillStyle = "#9a8f7d";
    ctx.textAlign = "left";
    presets.forEach((p, i) => {
      ctx.fillText(p.short ?? p.name, labelW + i * cellW + 8, 22);
    });
    rows.forEach((row, r) => {
      const y = 44 + r * 28;
      ctx.fillStyle = "#ece5d8";
      ctx.textAlign = "right";
      ctx.fillText(row.model.name, labelW - 8, y + 16);
      ctx.textAlign = "left";
      presets.forEach((p, i) => {
        const score = row.ranks[p.id];
        const x = labelW + i * cellW;
        if (score == null) {
          ctx.fillStyle = "#0b0b10";
          ctx.fillRect(x + 1, y, cellW - 2, 22);
          return;
        }
        ctx.fillStyle = `rgba(230, 201, 141, ${0.12 + score * 0.78})`;
        ctx.fillRect(x + 1, y, cellW - 2, 22);
        ctx.fillStyle = score > 0.55 ? "#0b0b10" : "#b3a98f";
        ctx.fillText(String(Math.round(score * 100)), x + 6, y + 15);
      });
    });
  }

  function drawPools(canvas, doc) {
    const rows = doc.models
      .filter((m) => !m.legacy && m.usage?.requests)
      .map((m) => {
        const month = m.usage.requests.month;
        return { model: m, month: month === "unlimited" ? Infinity : month };
      })
      .filter((row) => row.month != null && row.month > 0)
      .sort((a, b) => b.month - a.month)
      .slice(0, 22);
    const { ctx, w, h } = prep(canvas, Math.max(200, 30 + rows.length * 26));
    ctx.clearRect(0, 0, w, h);
    const labelW = 210;
    const valueW = 80;
    const barsW = w - labelW - valueW;
    const maxLog = Math.log10(Math.max(...rows.map((r) => (r.month === Infinity ? 300000 : r.month)), 1000));
    const minLog = Math.log10(100);
    ctx.font = "11.5px system-ui";
    rows.forEach((row, i) => {
      const y = 14 + i * 26;
      const isInf = row.month === Infinity;
      const log = isInf ? maxLog : Math.log10(Math.max(row.month, 100));
      const bw = Math.max(6, ((log - minLog) / (maxLog - minLog)) * barsW);
      ctx.fillStyle = "#ece5d8";
      ctx.textAlign = "right";
      ctx.fillText(row.model.name, labelW - 8, y + 13);
      ctx.textAlign = "left";
      const q = row.model.quality?.index;
      ctx.fillStyle = q != null ? `rgba(230, 201, 141, ${0.25 + Math.min(1, q / 60) * 0.7})` : "#2a2a32";
      ctx.beginPath();
      ctx.roundRect(labelW, y, bw, 17, 4);
      ctx.fill();
      ctx.fillStyle = "#9a8f7d";
      ctx.fillText(isInf ? "∞ unlimited" : fmt.int(row.month) + " req/mo", labelW + bw + 6, y + 13);
    });
  }

  function fillTable(doc, body, sortKey, sortDir) {
    const value = (m) => ({
      name: m.name,
      vendor: m.vendor,
      typicalCostUSD: m.typicalCostUSD,
      quality: m.quality?.index,
      requests5h: reqH5(m) === Infinity ? Number.MAX_SAFE_INTEGER : reqH5(m),
      monthlyCapUSD: m.monthlyCapUSD ?? (m.usage?.monthlyCapUSD === "unlimited" ? Number.MAX_SAFE_INTEGER : m.usage?.monthlyCapUSD),
      context: m.limits?.context,
      priceIn: m.pricing?.default?.input,
      priceOut: m.pricing?.default?.output,
      privacy: privacyLabel(m),
      endpoint: m.endpoint?.label ?? "—",
    })[sortKey];
    const rows = [...doc.models].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return va.localeCompare(vb) * sortDir;
      return (va - vb) * sortDir;
    });
    body.innerHTML = rows
      .map((m) => {
        const cap = m.usage?.monthlyCapUSD;
        return `<tr>
          <td><b>${m.name}</b>${m.onRoster ? "" : " <span class='muted'>(not on roster)</span>"}</td>
          <td>${m.vendor}</td>
          <td class="num">${fmt.money(m.typicalCostUSD)}</td>
          <td class="num">${m.quality?.index ?? "—"}</td>
          <td class="num">${fmt.int(reqH5(m) === Infinity ? "unlimited" : reqH5(m))}</td>
          <td class="num">${fmt.pool(cap)}</td>
          <td class="num">${fmt.ctx(m.limits?.context)}</td>
          <td class="num">${fmt.money(m.pricing?.default?.input)}</td>
          <td class="num">${fmt.money(m.pricing?.default?.output)}</td>
          <td>${privacyLabel(m)}</td>
          <td>${m.endpoint?.label ?? "—"}</td>
        </tr>`;
      })
      .join("");
  }

  function renderRank(rankEl, taskSelect, doc) {
    const { preset, ranked } = scoreModels(doc, taskSelect.value);
    document.getElementById("task-desc").textContent = preset.description;
    rankEl.innerHTML = ranked
      .slice(0, 6)
      .map(
        (entry, index) => `<li>
          <div class="rank-head"><span>${index + 1}. <b>${entry.model.name}</b></span><b>${Math.round(entry.score * 100)}</b></div>
          <div class="meter"><i style="width:${Math.round(entry.score * 100)}%"></i></div>
          <div class="why">${entry.why}</div>
        </li>`
      )
      .join("");
  }

  function mount(doc, options = {}) {
    let speeds = options.speeds ?? {};
    const mapCanvas = document.getElementById("map");
    const tip = document.getElementById("map-tip");
    const taskSelect = document.getElementById("task-select");
    const rankEl = document.getElementById("rank");
    const tableBody = document.getElementById("table-body");

    taskSelect.innerHTML = doc.taskPresets.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");

    let points = [];
    let tableSort = { key: "quality", dir: -1 };
    const sortHeaders = [...document.querySelectorAll("#table th")];
    function syncSortHeaders() {
      for (const header of sortHeaders) {
        const selected = header.dataset.k === tableSort.key;
        if (selected) header.setAttribute("aria-sort", tableSort.dir === 1 ? "ascending" : "descending");
        else header.removeAttribute("aria-sort");
        const button = header.querySelector("button");
        if (button) button.setAttribute("aria-label", `Sort by ${button.textContent}, ${selected && tableSort.dir === -1 ? "ascending" : "descending"}`);
      }
    }
    syncSortHeaders();

    function redraw() {
      // The catalog map sits inside a closed disclosure beneath Model Lab.
      // Its canvases and tables only need work when that surface is visible.
      const catalog = document.getElementById("model-lab-catalog");
      if (document.getElementById("tab-graph")?.hidden || (catalog && !catalog.open)) return;
      points = drawValueMap(mapCanvas, tip, doc);
      drawHeatmap(document.getElementById("heat"), doc);
      drawPools(document.getElementById("pools"), doc);
      fillTable(doc, tableBody, tableSort.key, tableSort.dir);
      renderRank(rankEl, taskSelect, doc);
    }

    mapCanvas.addEventListener("mousemove", (event) => {
      const rect = mapCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = points.find((p) => Math.hypot(p.x - x, p.y - y) <= p.r + 4);
      if (!hit) {
        tip.hidden = true;
        return;
      }
      const m = hit.model;
      const measured = speeds[m.id]?.tokensPerSecond;
      tip.innerHTML = `<b>${m.name}</b><br>${m.vendor} · ${fmt.money(m.typicalCostUSD)}/req · AA ${m.quality.index}${m.quality.indexVersion ? " " + m.quality.indexVersion : ""}<br>${fmt.int(reqH5(m) === Infinity ? "unlimited" : reqH5(m))} req/5h · ${fmt.ctx(m.limits?.context)} ctx<br>${privacyLabel(m)}${measured ? `<br>measured ${measured} t/s on your machine` : ""}`;
      tip.style.left = Math.min(window.innerWidth - 300, event.clientX + 14) + "px";
      tip.style.top = event.clientY + 12 + "px";
      tip.hidden = false;
    });
    mapCanvas.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });

    taskSelect.addEventListener("change", () => renderRank(rankEl, taskSelect, doc));
    document.getElementById("model-lab-catalog")?.addEventListener("toggle", (event) => { if (event.target.open) redraw(); });
    sortHeaders.forEach((th) => {
      th.querySelector("button")?.addEventListener("click", () => {
        const key = th.dataset.k;
        tableSort = { key, dir: tableSort.key === key ? -tableSort.dir : -1 };
        syncSortHeaders();
        fillTable(doc, tableBody, tableSort.key, tableSort.dir);
      });
    });

    return {
      redraw,
      setSpeeds: (next) => { speeds = next ?? {}; },
      setDoc: (next) => {
        doc = next;
        const selected = taskSelect.value;
        taskSelect.replaceChildren(...doc.taskPresets.map((preset) => {
          const option = document.createElement("option"); option.value = preset.id; option.textContent = preset.name; return option;
        }));
        if (doc.taskPresets.some((preset) => preset.id === selected)) taskSelect.value = selected;
      },
    };
  }

  window.MefiGraph = { mount, fmt, scoreModels, privacyLabel };
})();
