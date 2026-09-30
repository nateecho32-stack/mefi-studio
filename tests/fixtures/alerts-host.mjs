// A notifications host over stubs: a fake clock and timers, a Notification class
// that records what was shown and can be clicked, a window that records its
// flash and its taskbar count, an in-memory settings file, and a needs-you
// digest the test sets. The real rules (scripts/alerts.cjs), the real icon
// (scripts/badge-icon.cjs) and the real host (scripts/alerts-host.cjs) run.

import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const rules = require("../../scripts/alerts.cjs");
export const icon = require("../../scripts/badge-icon.cjs");
export const hostModule = require("../../scripts/alerts-host.cjs");

export const NOW = Date.UTC(2026, 8, 30, 15, 0, 0);
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
const tick = () => new Promise((resolve) => setImmediate(resolve));

export function world({ settings = {}, digest = { total: 0, items: [] }, looked = false, open = null, platform = "win32", env = {}, scale = 1, supported = true, hostOptions = {} } = {}) {
  const w = {
    now: NOW, logs: [], calls: [], shown: [], opened: [], shows: 0, remotePushes: 0, digestCalls: 0, reads: 0, writes: 0, settings, digest, looked, platform, scale, supported,
    openQuestions: open, // null: every question is open
    timers: [], timerSeq: 0, windowGone: false, failShow: false, failOverlay: false, minute: 15 * 60,
  };
  class FakeNotification extends EventEmitter {
    constructor(options) { super(); this.options = options; }
    show() { if (w.failShow) throw Object.assign(new Error("Could not show C:\\Users\\Nate\\toast"), { code: "E_FAIL" }); w.shown.push(this); }
    close() { this.emit("close", {}); }
    static isSupported() { return w.supported; }
  }
  const windowStub = {
    flashFrame: (on) => w.calls.push(["flash", on]),
    setOverlayIcon: (image, description) => {
      if (w.failOverlay) throw Object.assign(new Error("no icon at C:\\Users\\Nate"), { code: "EPERM" });
      w.calls.push(["overlay", image ? { width: image.buf.readUInt32BE(16), bytes: image.buf.length } : null, description]);
    },
  };
  const host = hostModule.createAlertsHost({
    rules, icon, Notification: FakeNotification, platform, env,
    nativeImage: { createFromBuffer: (buf) => ({ buf, isEmpty: () => false }), createFromPath: (file) => ({ file, isEmpty: () => false }) },
    iconPath: "/app/assets/icon-256.png",
    getWindow: () => (w.windowGone ? null : windowStub),
    isLooked: () => w.looked,
    showWindow: () => { w.shows += 1; w.calls.push(["showWindow"]); },
    send: (target) => { w.opened.push(target); w.calls.push(["send", target]); },
    readSettings: async () => { w.reads += 1; return structuredClone(w.settings); },
    updateSettings: async (mutate) => { const draft = structuredClone(w.settings); if (mutate(draft) !== false) { w.settings = draft; w.writes += 1; } },
    log: (line) => w.logs.push(line),
    digest: async () => { w.digestCalls += 1; const value = w.digest; if (w.digestGate) await w.digestGate; return value instanceof Error ? Promise.reject(value) : value; },
    questionOpen: (id) => (w.openQuestions ? w.openQuestions.has(id) : true),
    projectId: () => "project_a",
    scale: () => w.scale,
    remotePush: () => { w.remotePushes += 1; },
    now: () => w.now,
    minuteOfDay: () => w.minute,
    setTimer: (fn, ms) => { const timer = { id: (w.timerSeq += 1), at: w.now + ms, fn, unref() {} }; w.timers.push(timer); return timer; },
    clearTimer: (timer) => { const at = w.timers.indexOf(timer); if (at >= 0) w.timers.splice(at, 1); },
    ...hostOptions,
  });
  /** Moves the clock forward, running every timer that comes due on the way (and what they start). */
  async function advance(ms) {
    const target = w.now + ms;
    for (;;) {
      const next = w.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      w.timers.splice(w.timers.indexOf(next), 1);
      w.now = Math.max(w.now, next.at);
      next.fn();
      await tick();
      await tick();
    }
    w.now = target;
    await tick();
  }
  const overlays = () => w.calls.filter((call) => call[0] === "overlay");
  const flashes = () => w.calls.filter((call) => call[0] === "flash").map((call) => call[1]);
  const ask = (more = {}) => ({ id: "q1", status: "open", kind: "question", source: "assistant", title: "Should #Work and #work count as the same tag?", context: { taskId: "t1", taskTitle: "Search notes by tag" }, ...more });
  return { w, host, FakeNotification, advance, overlays, flashes, ask, tick };
}
