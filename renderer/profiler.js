// Live app profiler. Collect only on request; closing the sheet keeps capture running.
(function () {
  "use strict";
  const core = window.MefiPerformanceCore.create();
  const $ = (id) => document.getElementById(`profiler-${id}`);
  const api = () => window.mefiStudio;
  let host = null, hostState = "Host metrics require the desktop app.", busy = false, epoch = 0;
  let raf = 0, timer = 0, observer = null, longTasksSupported = false, pendingRead = null, lastRead = -Infinity;
  let initialized = false, samplingEpoch = 0;
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const number = (value, digits = 1) => finite(value) ? value.toFixed(digits) : "—";
  const ms = (value) => finite(value) ? `${number(value)} ms` : "—";
  const text = (id, value) => { const element = $(id); if (element) element.textContent = value; };
  const opened = () => Boolean($("overlay") && !$("overlay").hidden);
  async function bounded(promise) {
    let timeout;
    try { return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Host metrics timed out.")), 3000); })]); }
    finally { clearTimeout(timeout); }
  }
  async function readHost(force = false) {
    if (busy || !api()?.performanceSnapshot) return;
    if (pendingRead) return pendingRead;
    if (!force && performance.now() - lastRead < 1000) return;
    const current = epoch; lastRead = performance.now();
    const request = (async () => {
      try {
        const result = await bounded(api().performanceSnapshot());
        if (current !== epoch) return;
        if (!result?.ok) throw new Error("Host metrics unavailable.");
        host = result; hostState = "";
      } catch { if (current === epoch) hostState = "Host metrics unavailable; renderer capture is still available."; }
    })();
    pendingRead = request;
    try { await request; } finally { if (pendingRead === request) pendingRead = null; }
  }
  function stopSampling() {
    samplingEpoch++;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearInterval(timer);
    raf = 0; timer = 0;
    observer?.disconnect(); observer = null;
    core.suspend();
  }
  function startSampling() {
    stopSampling();
    if (!core.isRecording() || document.hidden) return;
    const sample = samplingEpoch;
    const frame = (at) => { if (!core.isRecording() || document.hidden) return; core.frame(at); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      try {
        observer = new PerformanceObserver((list) => {
          if (!core.isRecording() || document.hidden || sample !== samplingEpoch) return;
          for (const entry of list.getEntries()) core.longTask(entry.duration, entry.startTime);
        });
        observer.observe({ type: "longtask" }); longTasksSupported = true;
      } catch { observer = null; longTasksSupported = false; }
    }
    timer = setInterval(() => { void readHost(); paint(); }, 500);
  }
  async function control(action) {
    if (busy) return false;
    busy = true; epoch++; pendingRead = null; lastRead = -Infinity;
    stopSampling();
    // Stop immediately even if the host is busy. No late read can overwrite this capture.
    if (action === "stop") { core.stop(); stopSampling(); }
    paint();
    try {
      if (api()?.performanceControl) {
        try {
          const result = await bounded(api().performanceControl({ action }));
          if (!result?.ok) throw new Error("Host profiler unavailable.");
          host = result; hostState = "";
        } catch { host = null; hostState = "Host capture unavailable; renderer measurements remain available."; }
      }
      if (action === "start") core.start();
      if (action === "reset") core.reset();
      if (action !== "stop") startSampling();
      return true;
    } finally { busy = false; paint(); }
  }
  function snapshot() {
    return { schemaVersion: 1, renderer: core.snapshot(), host: host ? JSON.parse(JSON.stringify(host)) : null,
      coverage: { longTasksSupported, hostStatus: hostState || "available", frameCadence: "Visible renderer requestAnimationFrame intervals; not GPU time or Command draw FPS.",
        scopes: "Synchronous self time excludes nested measured scopes. Async and IPC timings include waiting; they are not CPU time.",
        retention: "Frame statistics cover the latest 900 intervals; scope p95 covers the latest 180 calls. Scope counts, means, self time and maxima cover this capture. Host limits are included separately.",
        privacy: "Static operation names and numeric measurements only; no task text, request payloads, file paths or credentials." } };
  }
  async function exportCapture() {
    if (busy || !core.snapshot().startedAt) return null;
    const current = epoch;
    if (core.isRecording()) await readHost(true);
    if (current !== epoch || busy) return null;
    const capture = snapshot();
    const url = URL.createObjectURL(new Blob([JSON.stringify(capture, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `studio-performance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    text("notice", "Capture exported as JSON. Record another run to compare after a fix.");
    return capture;
  }
  function cells(parent, values, header = false) {
    for (const value of values) { const cell = document.createElement(header ? "th" : "td"); cell.textContent = value; parent.append(cell); }
  }
  function table(id, rows, columns, empty) {
    const body = $(id); if (!body) return;
    const fragment = document.createDocumentFragment();
    for (const row of rows.slice(0, 15)) { const tr = document.createElement("tr"); cells(tr, columns(row)); fragment.append(tr); }
    if (!rows.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 8; td.textContent = empty; tr.append(td); fragment.append(tr); }
    body.replaceChildren(fragment);
  }
  function chart(data) {
    const canvas = $("chart"), ctx = canvas?.getContext("2d"); if (!ctx) return;
    const width = Math.max(200, canvas.clientWidth), height = 140, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== height * dpr) { canvas.width = Math.round(width * dpr); canvas.height = height * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const rows = data.frames.slice(-180), max = Math.max(66.7, ...rows.map((row) => row.durationMs));
    const color = getComputedStyle(canvas), ink = color.getPropertyValue("--gold-bright").trim() || "#dec084";
    const y = (value) => 120 - (value / max) * 100;
    ctx.strokeStyle = color.getPropertyValue("--hairline-strong").trim() || "#555";
    ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, y(data.budgetMs)); ctx.lineTo(width, y(data.budgetMs)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color.getPropertyValue("--muted").trim() || "#aaa"; ctx.font = "11px system-ui";
    ctx.fillText(`${number(max, 0)} ms`, 4, 12); ctx.fillText(`${number(data.budgetMs)} ms budget`, 4, y(data.budgetMs) - 5);
    if (rows.length) {
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.beginPath();
      rows.forEach((row, index) => { const x = index * width / Math.max(1, rows.length - 1); if (!index) ctx.moveTo(x, y(row.durationMs)); else ctx.lineTo(x, y(row.durationMs)); }); ctx.stroke();
    } else ctx.fillText("Frame history appears while recording in a visible window.", 12, Math.min(112, y(data.budgetMs) + 22));
  }
  function paint() {
    const active = core.isRecording();
    const hud = $("hud");
    if (hud) { hud.hidden = !active || opened(); hud.textContent = "● Recording performance · Open"; }
    if (!opened()) return;
    const data = core.snapshot(), stats = data.frameStats, latest = host?.samples?.at(-1);
    text("status", busy ? "Updating capture…" : active ? `Recording · ${number(data.elapsedMs / 1000, 0)}s${document.hidden ? " · renderer suspended while hidden" : ""}` : data.startedAt ? `Capture stopped · ${number(data.elapsedMs / 1000, 1)}s` : "Ready to record");
    $("start").disabled = busy || active; $("stop").disabled = busy || !active;
    $("reset").disabled = busy || !data.startedAt; $("export").disabled = busy || !data.startedAt;
    text("host-status", hostState || "Host sampling every second · CPU covers Studio processes, not external coding workers.");
    const metrics = [ ["UI cadence", finite(stats.fps) ? `${number(stats.fps, 0)} fps` : "—"], ["Frame p95", ms(stats.p95Ms)],
      ["Worst frame", ms(stats.maxMs)], ["Hitches ≥50 ms", String(data.hitchCount)], ["Long tasks", longTasksSupported ? String(data.longTaskCount) : "Unavailable"],
      ["Host lag", ms(latest?.hostLagMs)], ["Studio CPU", finite(latest?.cpuPercent) ? `${number(latest.cpuPercent)}%` : "—"],
      ["Host memory", finite(latest?.rssMB) ? `${number(latest.rssMB, 0)} MB` : "—"] ];
    const fragment = document.createDocumentFragment();
    for (const [label, value] of metrics) { const card = document.createElement("div"), title = document.createElement("span"), metric = document.createElement("strong"); title.textContent = label; metric.textContent = value; card.append(title, metric); fragment.append(card); }
    $("metrics").replaceChildren(fragment);
    text("frames-note", `${stats.count} recent UI intervals · ${stats.overBudget} over budget (+10% tolerance). Command intentionally draws at about 30 fps; UI cadence measures browser callbacks, not GPU rendering.`);
    chart(data);
    table("spans", data.spans, (row) => [row.name, row.count, ms(row.selfMs), ms(row.selfMeanMs), ms(row.meanMs), ms(row.p95Ms), ms(row.maxMs)], "No measured rendering work yet. Start recording, close this panel and use Command or the node tree.");
    table("ipc", [...(host?.spans || [])].sort((a, b) => b.totalMs - a.totalMs), (row) => [row.name, row.count, ms(row.meanMs), ms(row.p95Ms), ms(row.maxMs), row.errors], "Host requests appear during a desktop capture.");
    table("processes", latest?.processes || [], (row) => [row.type, finite(row.cpuPercent) ? `${number(row.cpuPercent)}%` : "—", finite(row.memoryMB) ? `${number(row.memoryMB, 0)} MB` : "—"], "Waiting for process measurements.");
    const events = [...data.incidents.map((row) => ({ ...row, source: "Renderer" })), ...(host?.incidents || []).map((row) => ({ ...row, source: "Host" }))].sort((a, b) => b.at - a.at).slice(0, 20);
    const items = events.map((row) => {
      const li = document.createElement("li");
      const nearby = row.recentScopes?.length ? ` · nearby: ${row.recentScopes.map((scope) => `${scope.name} ${ms(scope.durationMs)}`).join(", ")}` : "";
      li.textContent = `+${number(row.at / 1000, 1)}s · ${row.source} · ${row.name || row.kind} · ${ms(row.durationMs)}${nearby}`; return li;
    });
    if (!items.length) { const li = document.createElement("li"); li.textContent = "No hitches captured yet. Frame gaps and long tasks ≥50 ms, slow host requests and host lag appear here."; items.push(li); }
    $("incidents").replaceChildren(...items);
    text("limits", `Bounded history: ${data.limits.frames} UI intervals, ${data.limits.durations} timings per scope, ${data.limits.incidents} renderer incidents. ${data.droppedScopes} scope samples dropped at the name limit. Recent p95; capture-wide counts, means, self time and maxima.`);
  }
  function open() { init(); window.MefiNav?.claim?.("profiler"); $("overlay").hidden = false; paint(); }
  function close() { if (!$("overlay")) return; $("overlay").hidden = true; window.MefiNav?.release?.("profiler"); paint(); }
  function init() {
    if (initialized || !$("overlay")) return;
    initialized = true;
    $("start").addEventListener("click", () => { text("notice", "Recording continues when you close this panel. Reproduce the slowdown, then stop and export."); void control("start"); });
    $("stop").addEventListener("click", () => void control("stop"));
    $("reset").addEventListener("click", () => void control("reset"));
    $("export").addEventListener("click", () => void exportCapture());
    $("close").addEventListener("click", close);
    $("hud").addEventListener("click", () => window.MefiNav ? window.MefiNav.go("profiler") : open());
    $("budget").addEventListener("change", (event) => { core.setBudget(Number(event.target.value)); paint(); });
    $("overlay").addEventListener("click", (event) => { if (event.target === $("overlay")) close(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopSampling(); else if (core.isRecording()) startSampling(); paint(); });
    window.addEventListener("pagehide", () => { core.stop(); stopSampling(); });
    window.addEventListener("resize", () => { if (opened()) paint(); });
    if (api()?.performanceSnapshot) hostState = "Host measurements start with a capture.";
  }
  window.MefiProfiler = { open, close, start: () => control("start"), stop: () => control("stop"), reset: () => control("reset"), snapshot,
    begin: core.begin, end: core.end, measure: core.measure, measureAsync: core.measureAsync, exportCapture };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
