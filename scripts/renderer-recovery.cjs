"use strict";

// A renderer can disappear while Electron's window and tray remain alive.
// Keep this independent of Electron so its retry/quit races can be tested.
// Diagnostic records deliberately omit URLs, page titles and error messages.
const REASONS = new Set(["clean-exit", "abnormal-exit", "killed", "crashed", "oom", "launch-failed", "integrity-failure", "memory-eviction"]);

function attachRendererRecovery({
  window, load, log = () => {}, isQuitting = () => false, onBlocked = () => {},
  maxAttempts = 2, windowMs = 60000, delayMs = 500,
  now = Date.now, schedule = setTimeout, cancel = clearTimeout,
}) {
  if (!window?.webContents || typeof load !== "function") throw new TypeError("Renderer recovery needs a window and load function");
  const contents = window.webContents;
  const limit = Math.max(1, Number(maxAttempts) || 2);
  const interval = Math.max(1, Number(windowMs) || 60000);
  const delay = Math.max(0, Number(delayMs) || 0);
  let phase = "healthy";
  let timer = null;
  let attempts = [];
  let failure = null;
  let generation = 0;
  let notified = false;
  let disposed = false;
  let navigationFailed = false;
  let pendingManual = false;

  function unavailableReason() {
    if (disposed) return "disposed";
    if (isQuitting()) return "quitting";
    if (window.isDestroyed()) return "window-destroyed";
    if (contents.isDestroyed()) return "webcontents-destroyed";
    return null;
  }
  function unavailable() {
    return unavailableReason() !== null;
  }
  function prune() {
    attempts = attempts.filter((at) => now() - at < interval);
  }
  function record(event, fields = {}) {
    try { log({ component: "renderer-recovery", event, at: now(), ...fields }); } catch { /* logging cannot prevent recovery */ }
  }
  function clearPending(reason = null) {
    if (timer === null) return;
    cancel(timer);
    timer = null;
    // Every "scheduled" record must get a terminal follow-up: when a queued
    // reload is cancelled before its timer fires, log why it never ran. The
    // failure fields ride along so the skip stays linked to its trigger.
    if (reason) record("skipped", { manual: pendingManual, skipReason: reason, ...failure });
  }
  function status() {
    prune();
    return { state: phase, attempts: attempts.length, pending: timer !== null, failure: failure ? { ...failure } : null };
  }
  function block() {
    phase = "blocked";
    if (notified) return;
    notified = true;
    record("blocked", { attempts: attempts.length, ...failure });
    try {
      Promise.resolve(onBlocked({ retry, failure: { ...failure }, attempts: attempts.length })).catch(() => record("notification-failed"));
    } catch { record("notification-failed"); }
  }
  function queue(manual = false) {
    if (unavailable() || timer !== null || phase === "recovering") return false;
    prune();
    if (!manual && attempts.length >= limit) { block(); return false; }
    phase = "failed";
    const wait = manual ? 0 : delay * (attempts.length + 1);
    record("scheduled", { manual, delayMs: wait, ...failure });
    // Defer until Electron has finished handling render-process-gone.
    pendingManual = manual;
    timer = schedule(() => {
      timer = null;
      // The one-shot timer fires at most once per "scheduled" record, so an
      // unavailable world logs exactly one skip and cannot spam the log.
      const skipReason = unavailableReason();
      if (skipReason) {
        record("skipped", { manual, skipReason, ...failure });
        return;
      }
      if (!manual) attempts.push(now());
      phase = "recovering";
      navigationFailed = false;
      const current = ++generation;
      record("reload", { manual, attempts: attempts.length });
      try {
        Promise.resolve(load()).catch((error) => {
          if (current !== generation || unavailable()) return;
          fail({ reason: "reload-rejected", ...(Number.isInteger(error?.errno) ? { errorCode: error.errno } : {}) });
        });
      } catch (error) {
        if (current === generation) fail({ reason: "reload-rejected", ...(Number.isInteger(error?.errno) ? { errorCode: error.errno } : {}) });
      }
    }, wait);
    return true;
  }
  function fail(details) {
    if (unavailable()) return;
    generation += 1;
    failure = details;
    navigationFailed = true;
    phase = "failed";
    record("failure", details);
    queue();
  }
  function retry() {
    if (unavailable() || timer !== null || phase === "recovering") return false;
    if (phase === "healthy" && !contents.isCrashed?.()) return false;
    failure ??= { reason: "renderer-unavailable" };
    notified = false;
    return queue(true);
  }
  function onGone(_event, details = {}) {
    if (unavailable()) return;
    if (details.reason === "clean-exit") {
      generation += 1;
      clearPending("clean-exit");
      phase = "healthy";
      return;
    }
    fail({ reason: REASONS.has(details.reason) ? details.reason : "unknown", exitCode: Number.isInteger(details.exitCode) ? details.exitCode : null });
  }
  function onFailedLoad(_event, errorCode, _description, _url, isMainFrame) {
    if (!isMainFrame || errorCode === -3) return; // cancellation and iframe failures do not break Studio.
    fail({ reason: "main-frame-load-failed", errorCode: Number.isInteger(errorCode) ? errorCode : null });
  }
  function onLoaded() {
    // Chromium can finish loading its internal error page after did-fail-load.
    // Only a subsequent, successful document navigation counts as recovery.
    if (unavailable() || navigationFailed) return;
    generation += 1;
    clearPending();
    if (phase !== "healthy") record("recovered", { attempts: attempts.length });
    phase = "healthy";
    failure = null;
    notified = false;
    // Keep the rolling attempt history: briefly loading must not defeat the cap.
  }
  function onNavigation(details, _url, isInPlace, isMainFrame) {
    if ((details?.isMainFrame ?? isMainFrame) && !(details?.isSameDocument ?? isInPlace)) navigationFailed = false;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    clearPending("disposed");
    phase = "disposed";
    contents.removeListener("render-process-gone", onGone);
    contents.removeListener("did-fail-load", onFailedLoad);
    contents.removeListener("did-finish-load", onLoaded);
    contents.removeListener("did-start-navigation", onNavigation);
    contents.removeListener("destroyed", dispose);
    window.removeListener("closed", dispose);
  }
  contents.on("render-process-gone", onGone);
  contents.on("did-fail-load", onFailedLoad);
  contents.on("did-finish-load", onLoaded);
  contents.on("did-start-navigation", onNavigation);
  contents.on("destroyed", dispose);
  window.on("closed", dispose);
  return { retry, status, dispose };
}

module.exports = { attachRendererRecovery };
