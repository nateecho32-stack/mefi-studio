// Startup waits for actual local data and the initial view before exposing controls.
(function () {
  "use strict";

  const MIN_SHOW_MS = 250;
  const STEP_TIMEOUT_MS = 15000;
  const FADE_MS = 180;
  const boot = { active: false, phase: "idle", epoch: 0, steps: [], promise: Promise.resolve(true), resolve: null, onReady: null };
  const el = {};
  const locked = new Map();
  let startedAt = 0;
  let fadeTimer = 0;
  const reducedMotion = () => window.MefiNav?.noMotion?.() ?? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function state() {
    const steps = boot.steps.map(({ id, label, status }) => ({ id, label, status }));
    return { phase: boot.phase, steps, progress: steps.length ? Math.floor(steps.filter((step) => step.status === "ready").length / steps.length * 100) : 0 };
  }

  function paint() {
    const snapshot = state();
    if (el.progress) el.progress.value = snapshot.progress;
    if (el.count) el.count.textContent = snapshot.progress + "%";
    if (el.layer) {
      el.layer.setAttribute("aria-busy", String(boot.phase === "loading"));
      el.layer.dataset.phase = boot.phase;
    }
    const failed = boot.steps.filter((step) => step.status === "error");
    const loading = boot.steps.find((step) => step.status === "loading" || step.status === "pending");
    if (el.title) el.title.textContent = boot.phase === "error" ? "A little more setup is needed" : boot.phase === "ready" ? "Your studio is ready" : "Opening your studio";
    if (el.detail) el.detail.textContent = boot.phase === "error"
      ? "Couldn't finish " + failed.map((step) => step.label.toLowerCase()).join(", ") + ". Retry, or open with what's available."
      : boot.phase === "ready" ? "Everything is in place." : loading ? loading.label + "…" : "Preparing your workspace…";
    if (el.actions) el.actions.hidden = boot.phase !== "error";
    for (const step of boot.steps) if (step.row) {
      step.row.dataset.state = step.status;
      step.row.textContent = step.label + (step.status === "ready" ? " · Ready" : step.status === "error" ? " · Couldn't load" : "");
    }
  }

  function keyboard(event) {
    if (!boot.active) return;
    // Keep app shortcuts out of the gate; native activation of its error
    // buttons still works. Escape/click never claim pending work is ready.
    if (event.key === "F5" || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") return;
    event.stopImmediatePropagation();
    if (event.key === "Tab") {
      event.preventDefault();
      const buttons = boot.phase === "error" ? [el.retry, el.continue].filter(Boolean) : [];
      if (!buttons.length) el.layer?.focus({ preventScroll: true });
      else {
        const index = buttons.indexOf(document.activeElement);
        buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
      }
    } else if (event.key === "Escape" || !el.layer?.contains(event.target)) event.preventDefault();
  }

  function blockOutside(event) {
    if (!boot.active || el.layer?.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function lock() {
    document.documentElement?.setAttribute("data-starting", "");
    for (const node of document.body?.children ?? []) {
      if (node === el.layer || ["SCRIPT", "STYLE"].includes(node.tagName)) continue;
      locked.set(node, node.inert);
      node.inert = true;
    }
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("pointerdown", blockOutside, true);
    window.addEventListener("click", blockOutside, true);
    el.layer?.focus({ preventScroll: true });
  }

  function release(complete) {
    if (!boot.active) return;
    boot.active = false;
    boot.epoch++;
    clearTimeout(fadeTimer);
    for (const [node, previous] of locked) node.inert = previous;
    locked.clear();
    window.removeEventListener("keydown", keyboard, true);
    window.removeEventListener("pointerdown", blockOutside, true);
    window.removeEventListener("click", blockOutside, true);
    if (el.layer) { el.layer.hidden = true; el.layer.classList.remove("done"); }
    document.documentElement?.removeAttribute("data-starting");
    boot.phase = complete ? "complete" : "partial";
    try { boot.onReady?.(complete); } catch (error) { console.error("Startup handoff failed", error); }
    boot.resolve?.(complete);
    boot.resolve = null;
  }

  async function attempt(retry = false) {
    const epoch = ++boot.epoch;
    const isCurrent = () => boot.active && boot.epoch === epoch;
    if (retry) reads.clear(); // A timed-out shared read must not poison Retry.
    boot.phase = "loading";
    for (const step of boot.steps) step.status = "pending";
    paint();
    await Promise.all(boot.steps.map(async (step) => {
      step.status = "loading";
      paint();
      let timer;
      try {
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Startup step timed out")), STEP_TIMEOUT_MS); });
        const result = await Promise.race([Promise.resolve().then(() => step.load({ retry, isCurrent })), timeout]);
        if (result === false || result?.ok === false) throw new Error("Startup step unavailable");
        if (isCurrent()) step.status = "ready";
      } catch {
        if (isCurrent()) step.status = "error";
      } finally {
        clearTimeout(timer);
        if (isCurrent()) paint();
      }
    }));
    if (!isCurrent()) return;
    if (boot.steps.some((step) => step.status === "error")) {
      boot.phase = "error"; paint(); el.retry?.focus(); return;
    }
    // Give the populated initial view a layout/paint opportunity underneath
    // the loading screen, then reveal it. No decorative work holds the gate.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!isCurrent()) return;
    const minimum = reducedMotion() ? 0 : MIN_SHOW_MS;
    await delay(Math.max(0, minimum - (performance.now() - startedAt)));
    if (!isCurrent()) return;
    boot.phase = "ready"; paint();
    el.layer?.classList.add("done");
    fadeTimer = setTimeout(() => { if (isCurrent()) release(true); }, reducedMotion() ? 0 : FADE_MS);
  }

  function run(steps, onReady) {
    if (boot.active) return boot.promise;
    for (const name of ["layer", "title", "detail", "progress", "count", "steps", "actions", "retry", "continue"]) el[name] = document.getElementById("boot-" + name);
    boot.steps = steps.map((step) => ({ ...step, status: "pending", row: null }));
    boot.onReady = onReady;
    boot.active = true;
    boot.phase = "loading";
    startedAt = performance.now();
    boot.promise = new Promise((resolve) => { boot.resolve = resolve; });
    if (el.layer) { el.layer.hidden = false; el.layer.classList.remove("done"); }
    el.steps?.replaceChildren();
    for (const step of boot.steps) if (el.steps) {
      step.row = document.createElement("li");
      step.row.className = "boot-step";
      el.steps.append(step.row);
    }
    if (el.retry) el.retry.onclick = () => { if (boot.phase === "error") void attempt(true); };
    if (el.continue) el.continue.onclick = () => { if (boot.phase === "error") release(false); };
    lock();
    paint();
    // Start after DOM initialization, so readiness hooks refer to wired views.
    const start = () => { if (boot.active) void attempt(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    return boot.promise;
  }

  // Several surfaces open together. Share only their concurrent, read-only
  // IPC requests; release settled promises so later opens see current data.
  // Writes (including task edits) always use the bridge directly.
  const reads = new Map();
  const readMethods = new Set(["assistantStatus", "assistantState", "eyesState", "tasksList", "ideasList", "eyesRequestsRead", "eyesBriefingRead", "eyesCheckpointsRead", "prefsGet"]);
  function read(method, { fresh = false } = {}) {
    if (!readMethods.has(method)) return Promise.reject(new Error(`Not a shared read: ${method}`));
    if (!fresh && reads.has(method)) return reads.get(method);
    const pending = Promise.resolve().then(() => window.mefiStudio?.[method]?.());
    reads.set(method, pending);
    const release = () => {
      if (reads.get(method) === pending) reads.delete(method);
    };
    pending.then(release, release);
    return pending;
  }

  // ---- shared poll guard ---------------------------------------------------
  // Poll timers registered here are cleared the moment the window hides and
  // restarted the moment it shows, so a hidden tab issues no fetches and
  // hide/show toggles can never stack intervals: a key holds at most one
  // timer, every start clears before it sets, and the visibilitychange pass
  // only sets where none is running. (The boot's own beats are one-shot
  // timeouts and a rAF loop the browser already suspends while hidden.)
  const polls = new Map(); // key -> { fn, ms, timer }
  function pollStart(key, fn, ms) {
    pollStop(key);
    const poll = { fn, ms, timer: 0 };
    polls.set(key, poll);
    if (!document.hidden) poll.timer = setInterval(fn, ms);
    return key;
  }
  function pollStop(key) {
    const poll = polls.get(key);
    if (!poll) return;
    if (poll.timer) clearInterval(poll.timer);
    polls.delete(key);
  }
  document.addEventListener("visibilitychange", () => {
    for (const poll of polls.values()) {
      if (document.hidden) {
        if (poll.timer) clearInterval(poll.timer);
        poll.timer = 0;
      } else if (!poll.timer) {
        poll.timer = setInterval(poll.fn, poll.ms);
      }
    }
  });

  window.MefiBoot = { run, ready: () => boot.promise, state, read, isActive: () => boot.active, pollStart, pollStop, pollActive: (key) => Boolean(polls.get(key)?.timer) };
})();
