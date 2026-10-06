// Startup marks, the page's half (main's is scripts/startup-marks.cjs): when
// this script began, DOMContentLoaded, each launch-gate step's start and
// settle, and the gate's release, in ms since this page's timeOrigin. The
// build puts this file first, so "script" is the moment the booklet's inline
// code began to run, after the file was read and compiled. booklet.js hands
// MefiBoot to wrapBoot() and runs the gate through what it returns; boot.js
// knows nothing of it. After the release the marks go to main once
// (startup:marks) with Chromium's own timings (the file's arrival, first
// paint, the load event), for Trace's [startup] line and --startup-report.
// A page opened with ?marks=0 (main's MEFI_STUDIO_STARTUP_MARKS=0) takes no
// marks and wraps nothing. A mark never stops or delays the launch.
(function () {
  "use strict";
  const off = /[?&]marks=0(?:&|$)/.test(String(window.location?.search || ""));
  const clock = () => performance.now();
  const round = (value) => Math.round(value * 10) / 10;
  const marks = {};
  const steps = [];
  let sent = false;

  function mark(name) {
    if (off || Object.prototype.hasOwnProperty.call(marks, name)) return;
    try { marks[name] = round(clock()); } catch { /* no clock, no mark */ }
  }
  mark("script");
  if (!off) document.addEventListener?.("DOMContentLoaded", () => mark("dcl"), { once: true });

  // What Chromium kept on its own: the booklet file's arrival, the paints and
  // the load event, when they have happened.
  function timings() {
    const found = {};
    try {
      const nav = performance.getEntriesByType?.("navigation")?.[0];
      if (nav?.responseEnd > 0) found.html = round(nav.responseEnd);
      if (nav?.domContentLoadedEventStart > 0) found.dcl = round(nav.domContentLoadedEventStart);
      if (nav?.loadEventEnd > 0) found.load = round(nav.loadEventEnd);
      for (const entry of performance.getEntriesByType?.("paint") ?? []) found[entry.name] = round(entry.startTime);
    } catch { /* a timeline this build does not keep */ }
    return found;
  }

  function snapshot(complete = true) {
    return { origin: performance.timeOrigin, marks: { ...timings(), ...marks }, steps: steps.map((step) => ({ ...step })), complete: complete !== false };
  }

  function send(complete) {
    if (off || sent) return;
    sent = true;
    try { Promise.resolve(window.mefiStudio?.startupMarks?.(snapshot(complete))).catch(() => {}); } catch { /* an older host has no startup:marks */ }
  }

  // A step's load, timed: the latest attempt's start and settle, how it
  // settled (boot.js's own rule: false or { ok: false } is a failure), and
  // how many tries. The load's own result goes back to boot.js untouched.
  function timed(step) {
    if (!step || typeof step.load !== "function") return step;
    const record = { id: String(step.id ?? ""), start: null, end: null, ok: null, tries: 0 };
    steps.push(record);
    const load = step.load;
    return { ...step, load(context) {
      try { record.start = round(clock()); record.end = null; record.ok = null; record.tries += 1; } catch { /* untimed */ }
      const settle = (ok) => { try { record.end = round(clock()); record.ok = ok; } catch { /* untimed */ } };
      let result;
      try {
        result = load.call(this, context);
      } catch (error) {
        settle(false);
        throw error;
      }
      Promise.resolve(result).then((value) => settle(value !== false && value?.ok !== false), () => settle(false));
      return result;
    } };
  }

  // MefiBoot with run() timing the steps, the launch choice and the release.
  function wrapBoot(boot) {
    if (off || !boot || typeof boot.run !== "function") return boot;
    return {
      run(list, onReady, options) {
        mark("gate");
        let wrapped = list, ready = onReady, chosen = options;
        try {
          if (Array.isArray(list)) wrapped = list.map(timed);
          if (typeof onReady === "function") {
            ready = function (complete, choice) {
              mark("release");
              try {
                return onReady.call(this, complete, choice);
              } finally {
                setTimeout(() => send(complete), 0);
              }
            };
          }
          if (typeof options?.choose === "function") {
            const choose = options.choose;
            chosen = { ...options, choose(context) {
              mark("choose");
              let result;
              try {
                result = choose.call(this, context);
              } catch (error) {
                mark("chosen");
                throw error;
              }
              Promise.resolve(result).then(() => mark("chosen"), () => mark("chosen"));
              return result;
            } };
          }
        } catch {
          wrapped = list; ready = onReady; chosen = options;
        }
        return boot.run(wrapped, ready, chosen);
      },
    };
  }

  window.MefiStartupMarks = { mark, wrapBoot, snapshot, send, enabled: () => !off };
})();
