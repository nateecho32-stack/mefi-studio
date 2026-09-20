// Bounded, opt-in measurements. No task text, DOM content or request payloads.
(function () {
  "use strict";
  function create({ now = () => performance.now(), wallNow = () => Date.now() } = {}) {
    const limits = { frames: 900, scopes: 64, durations: 180, incidents: 60, hitchMs: 50 };
    const ring = (limit) => ({ values: [], cursor: 0, limit });
    const push = (buffer, value) => {
      if (buffer.values.length < buffer.limit) buffer.values.push(value);
      else { buffer.values[buffer.cursor] = value; buffer.cursor = (buffer.cursor + 1) % buffer.limit; }
    };
    const values = (buffer) => buffer.values.slice(buffer.cursor).concat(buffer.values.slice(0, buffer.cursor));
    const percentile = (list, fraction) => list.length ? [...list].sort((a, b) => a - b)[Math.ceil(list.length * fraction) - 1] : null;
    let recording = false, generation = 0, origin = 0, startedAt = null, elapsedMs = 0;
    let lastFrame = null, budgetMs = 1000 / 30, frames, incidents, scopes, stack, droppedScopes, frameCount, hitchCount, longTaskCount;
    function clear() {
      generation++; origin = now(); startedAt = wallNow(); elapsedMs = 0; lastFrame = null;
      frames = ring(limits.frames); incidents = ring(limits.incidents); scopes = new Map(); stack = [];
      droppedScopes = 0; frameCount = 0; hitchCount = 0; longTaskCount = 0;
    }
    clear(); startedAt = null;
    function incident(kind, name, durationMs, at = now() - origin, extra = {}) {
      push(incidents, { at: Math.max(0, at), kind, name, durationMs, ...extra });
    }
    function record(name, durationMs, selfMs, error = false) {
      let scope = scopes.get(name);
      if (!scope) {
        if (scopes.size >= limits.scopes) { droppedScopes++; return; }
        scope = { name, count: 0, totalMs: 0, selfMs: 0, maxMs: 0, errors: 0, durations: ring(limits.durations), lastAt: 0, lastMs: 0 };
        scopes.set(name, scope);
      }
      scope.count++; scope.totalMs += durationMs; scope.selfMs += selfMs;
      scope.maxMs = Math.max(scope.maxMs, durationMs); scope.errors += Number(error);
      scope.lastAt = now() - origin; scope.lastMs = durationMs; push(scope.durations, durationMs);
      if (durationMs >= limits.hitchMs) incident("scope", name, durationMs);
    }
    function begin(name) {
      if (!recording || !/^[a-zA-Z][\w.:-]{0,63}$/.test(name)) return null;
      const token = { name, start: now(), children: 0, generation, ended: false };
      stack.push(token); return token;
    }
    function end(token, error = false) {
      if (!token || token.ended || token.generation !== generation || !recording) return;
      token.ended = true;
      const index = stack.lastIndexOf(token);
      if (index < 0) return;
      // Misordered callers cannot attribute an unfinished child to a parent.
      // Discard this subtree rather than report misleading self time.
      if (index !== stack.length - 1) { stack.splice(index); return; }
      stack.splice(index, 1);
      const duration = Math.max(0, now() - token.start);
      if (index > 0) stack[index - 1].children += duration;
      record(token.name, duration, Math.max(0, duration - token.children), error);
    }
    function measure(name, fn) {
      const token = begin(name); let failed = true;
      try { const result = fn(); failed = false; return result; } finally { end(token, failed); }
    }
    async function measureAsync(name, fn) {
      const active = recording, epoch = generation, start = active ? now() : 0; let failed = true;
      try { const result = await fn(); failed = false; return result; }
      finally {
        // Async elapsed time includes waiting and must never enter the sync self-time stack.
        if (active && recording && epoch === generation && /^[a-zA-Z][\w.:-]{0,63}$/.test(name)) {
          record(name, Math.max(0, now() - start), 0, failed);
        }
      }
    }
    function frame(at = now()) {
      if (!recording || !Number.isFinite(at)) return;
      if (lastFrame !== null && at > lastFrame) {
        const durationMs = at - lastFrame;
        push(frames, { at: at - origin, durationMs }); frameCount++;
        if (durationMs >= limits.hitchMs) {
          hitchCount++;
          const recentScopes = [...scopes.values()].filter((row) => at - origin - row.lastAt < durationMs + 10)
            .sort((a, b) => b.lastMs - a.lastMs).slice(0, 4).map((row) => ({ name: row.name, durationMs: row.lastMs }));
          incident("frame", "UI frame gap", durationMs, at - origin, { recentScopes });
        }
      }
      lastFrame = at;
    }
    function longTask(durationMs, startTime = now()) {
      if (!recording || !Number.isFinite(durationMs) || durationMs < 50 || startTime < origin) return;
      longTaskCount++; incident("long-task", "Renderer main thread", durationMs, startTime - origin);
    }
    function snapshot() {
      const frameRows = values(frames).map((row) => ({ ...row })), durations = frameRows.map((row) => row.durationMs);
      const meanMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
      return { recording, startedAt, elapsedMs: recording ? now() - origin : elapsedMs, budgetMs, limits: { ...limits }, droppedScopes,
        frameCount, hitchCount, longTaskCount, frames: frameRows,
        frameStats: { count: durations.length, meanMs, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95),
          maxMs: durations.length ? Math.max(...durations) : null, fps: meanMs ? 1000 / meanMs : null,
          overBudget: durations.filter((value) => value > budgetMs * 1.1).length },
        spans: [...scopes.values()].map((row) => ({ name: row.name, count: row.count, totalMs: row.totalMs, selfMs: row.selfMs,
          meanMs: row.totalMs / row.count, selfMeanMs: row.selfMs / row.count, p95Ms: percentile(row.durations.values, 0.95), maxMs: row.maxMs, errors: row.errors }))
          .sort((a, b) => b.selfMs - a.selfMs),
        incidents: values(incidents).map((row) => ({ ...row, ...(row.recentScopes ? { recentScopes: row.recentScopes.map((scope) => ({ ...scope })) } : {}) })) };
    }
    return { begin, end, measure, measureAsync, frame, longTask, snapshot,
      start() { clear(); recording = true; },
      stop() { if (recording) elapsedMs = now() - origin; recording = false; generation++; stack = []; lastFrame = null; },
      reset() { clear(); if (!recording) startedAt = null; }, suspend() { lastFrame = null; generation++; stack = []; },
      setBudget(value) { if (value === 30 || value === 60) budgetMs = 1000 / value; },
      isRecording: () => recording };
  }
  window.MefiPerformanceCore = { create };
})();
