// Poll visibility guard: boot.js's shared poll guard must keep a hidden tab
// silent — no interval running means no fetch — and hide/show toggles must
// never stack intervals: a key holds at most one timer, so after any number
// of starts and window toggles exactly one interval is live again. nav.js's
// badge poll rides the same guard, so its wiring is asserted at source shape.
// The edge cases pin the timing contract around those toggles: rapid tab
// switches, resume cadence (no drift, no catch-up burst), and in-flight poll
// requests completing while hidden. The overlay polls ride the same guard —
// tasks.board, explorer.state and idle.js's Command refresh/idle timers — so
// their wiring is pinned at source shape too: every tick's hidden bail
// precedes its fetch, and show snaps the view back. The overlay ticks are
// also executed for real: each module's own tick source is extracted
// verbatim, compiled against stubs and driven through the guard on the same
// virtual clock, proving hidden silence, sheet gates, resume cadence and
// one-live-interval stacking safety for the shipped code, not a copy.
// overhead.js's task poll keeps its own backoff chain instead of the guard;
// its test fires visibilitychange for real and asserts zero fetch calls
// while hidden, with show snapping a fresh poll.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Evaluate boot.js with a stub document/window and counting fake timers, so
// the tests watch interval lifecycle without waiting on real milliseconds.
async function loadBoot() {
  const state = { hidden: false };
  const handlers = {};
  const live = new Set();
  let nextId = 1;
  const context = {
    window: {},
    document: {
      get hidden() {
        return state.hidden;
      },
      addEventListener(type, fn) {
        handlers[type] = fn;
      },
    },
    setInterval(fn, ms) {
      const id = nextId++;
      live.add(id);
      return id;
    },
    clearInterval(id) {
      live.delete(id);
    },
    setTimeout() {
      return nextId++;
    },
    clearTimeout() {},
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    console,
  };
  vm.createContext(context);
  const source = await readFile(path.join(STUDIO, "renderer", "boot.js"), "utf8");
  vm.runInContext(source, context);
  const boot = context.window.MefiBoot;
  assert.ok(boot, "boot.js must expose window.MefiBoot");
  return {
    boot,
    handlers,
    live,
    show() {
      state.hidden = false;
      handlers.visibilitychange();
    },
    hide() {
      state.hidden = true;
      handlers.visibilitychange();
    },
  };
}

test("a poll started while hidden sets no interval until the window shows", async () => {
  const env = await loadBoot();
  env.hide();
  env.boot.pollStart("k", () => {}, 1000);
  assert.equal(env.live.size, 0, "a hidden window must set no interval");
  assert.equal(env.boot.pollActive("k"), false);
  env.show();
  assert.equal(env.live.size, 1, "showing the window must start exactly one interval");
  assert.equal(env.boot.pollActive("k"), true);
});

test("a poll started while visible stops the moment the window hides", async () => {
  const env = await loadBoot();
  env.boot.pollStart("k", () => {}, 1000);
  assert.equal(env.live.size, 1);
  env.hide();
  assert.equal(env.live.size, 0, "a hidden tab must issue no fetches: no live interval");
  env.show();
  assert.equal(env.live.size, 1, "the interval must come back on show");
});

test("two starts and two hide/show toggles leave exactly one active interval", async () => {
  const env = await loadBoot();
  const key = "nav.badges";
  env.boot.pollStart(key, () => {}, 1000);
  env.boot.pollStart(key, () => {}, 1000);
  assert.equal(env.live.size, 1, "a second start must clear the first interval");
  env.hide();
  env.show();
  env.hide();
  env.show();
  assert.equal(env.live.size, 1, "two hide/show toggles must leave one active interval");
  assert.equal(env.boot.pollActive(key), true);
  env.boot.pollStop(key);
  assert.equal(env.live.size, 0, "pollStop must clear the interval");
});

test("each registered key holds its own single interval across toggles", async () => {
  const env = await loadBoot();
  env.boot.pollStart("nav.badges", () => {}, 1000);
  env.boot.pollStart("tasks.board", () => {}, 1000);
  assert.equal(env.live.size, 2);
  env.hide();
  assert.equal(env.live.size, 0);
  env.show();
  assert.equal(env.live.size, 2, "show must restore one interval per key");
});

test("a poll stopped while hidden stays stopped: show must not resurrect it", async () => {
  const env = await loadBoot();
  env.boot.pollStart("k", () => {}, 1000);
  env.hide();
  assert.equal(env.live.size, 0);
  env.boot.pollStop("k");
  assert.equal(env.boot.pollActive("k"), false, "stopping removes the key even while hidden");
  env.show();
  assert.equal(env.live.size, 0, "show restarts only registered polls: a stopped key must stay dead");
  assert.equal(env.boot.pollActive("k"), false);
  env.boot.pollStart("k", () => {}, 1000); // re-registering after the stop starts fresh
  assert.equal(env.boot.pollActive("k"), true);
  assert.equal(env.live.size, 1, "a re-registered key holds exactly one interval again");
});

test("nav.js rides the shared guard: pollStart for the badge poll, hidden-aware tick", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "nav.js"), "utf8");
  assert.match(source, /pollStart\("nav\.badges"/, "the badge poll must register under the shared guard");
  assert.match(source, /const badgeTick = \(\) => \{\s*\n\s*if \(!document\.hidden\) refreshBadges\(\);/, "the tick must bail while hidden");
  assert.match(source, /document\.addEventListener\("visibilitychange"/, "badges must snap back on show");
});

// ---- timing edge cases -----------------------------------------------------
// A deterministic timer clock: setInterval/setTimeout schedule on a virtual
// timeline and advance(ms) runs everything due, recording each tick. The
// timing tests prove the pause/resume contract without waiting real time.
function makeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map(); // id -> { at, fn, every }
  const ticks = []; // virtual timestamps of every fired interval callback
  const wrap = (fn) => () => {
    ticks.push(now);
    fn();
  };
  return {
    get now() {
      return now;
    },
    ticks,
    setInterval(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn: wrap(fn), every: ms });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + (ms || 0), fn, every: null });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(delta) {
      const end = now + delta;
      for (;;) {
        let due = null;
        for (const [id, t] of timers) {
          if (t.at <= end && (!due || t.at < due.at)) due = { id, t };
        }
        if (!due) break;
        now = Math.max(now, due.t.at);
        if (due.t.every != null) due.t.at = now + due.t.every;
        else timers.delete(due.id);
        due.t.fn();
      }
      now = end;
    },
  };
}

async function loadBootWithClock(clock) {
  const state = { hidden: false };
  const handlers = {};
  const live = new Set();
  const context = {
    window: {},
    document: {
      get hidden() {
        return state.hidden;
      },
      addEventListener(type, fn) {
        handlers[type] = fn;
      },
    },
    setInterval(fn, ms) {
      const id = clock.setInterval(fn, ms);
      live.add(id);
      return id;
    },
    clearInterval(id) {
      clock.clearInterval(id);
      live.delete(id);
    },
    setTimeout(fn, ms) {
      return clock.setTimeout(fn, ms);
    },
    clearTimeout(id) {
      clock.clearTimeout(id);
    },
    performance: { now: () => clock.now },
    requestAnimationFrame: () => 0,
    console,
  };
  vm.createContext(context);
  const source = await readFile(path.join(STUDIO, "renderer", "boot.js"), "utf8");
  vm.runInContext(source, context);
  const boot = context.window.MefiBoot;
  assert.ok(boot, "boot.js must expose window.MefiBoot");
  return {
    boot,
    handlers,
    live,
    state, // shared with extracted overlay ticks, so they read the same visibility the guard sees
    show() {
      state.hidden = false;
      handlers.visibilitychange();
    },
    hide() {
      state.hidden = true;
      handlers.visibilitychange();
    },
  };
}

test("rapid hide/show cycles never stack timers: hidden time stays silent, visible time ticks once per interval", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let calls = 0;
  const key = "nav.badges";
  const tick = () => ++calls;
  env.boot.pollStart(key, tick, 100);
  for (let cycle = 0; cycle < 25; cycle++) {
    env.hide();
    assert.equal(env.live.size, 0, `cycle ${cycle}: a hidden phase must hold no interval`);
    const before = clock.ticks.length;
    clock.advance(1000); // a full hidden second
    assert.equal(clock.ticks.length - before, 0, `cycle ${cycle}: hidden time must produce zero ticks`);
    if (cycle === 12) env.boot.pollStart(key, tick, 100); // re-register mid-hidden, like re-navigating
    env.show();
    assert.equal(env.live.size, 1, `cycle ${cycle}: show must restore exactly one interval`);
    clock.advance(1000);
    assert.equal(clock.ticks.length - before, 10, `cycle ${cycle}: one interval fires 10 times per visible second`);
  }
  assert.equal(calls, 250, "25 cycles x 10 ticks: stacked intervals would multiply the count");
});

test("resume sets a fresh full interval: hidden time drifts nothing and is never replayed as a catch-up burst", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let calls = 0;
  env.boot.pollStart("k", () => ++calls, 1000);
  clock.advance(3000);
  assert.equal(calls, 3, "three visible seconds tick three times");
  const idBefore = [...env.live][0];
  env.hide();
  clock.advance(60000); // a hidden minute
  assert.equal(calls, 3, "a hidden minute must produce zero ticks");
  env.show();
  const idAfter = [...env.live][0];
  assert.notEqual(idAfter, idBefore, "resume must set a fresh timer, not resurrect the stale id");
  clock.advance(999);
  assert.equal(calls, 3, "no catch-up burst: the hidden elapsed time is not replayed");
  clock.advance(1);
  assert.equal(calls, 4, "the first resumed tick lands exactly one interval after show");
  clock.advance(5000);
  assert.equal(calls, 9, "cadence stays exact after resume");
});

test("an in-flight poll request completing while hidden must not resurrect the paused timer", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let resolveRequest;
  let completedAt = null;
  env.boot.pollStart("eyes.log", () => {
    new Promise((resolve) => {
      resolveRequest = resolve;
    }).then(() => {
      completedAt = clock.now;
    });
  }, 1000);
  clock.advance(1000); // the tick fires; the request is now mid-flight
  assert.equal(completedAt, null);
  env.hide(); // the window hides while the request is in flight
  assert.equal(env.live.size, 0, "hiding mid-flight clears the interval");
  resolveRequest(); // the request completes while hidden
  await new Promise((resolve) => setImmediate(resolve)); // let the continuation run
  assert.equal(completedAt, 1000, "the in-flight completion lands while hidden");
  assert.equal(env.live.size, 0, "a completing request must not resurrect the paused timer");
  assert.equal(env.boot.pollActive("eyes.log"), false);
  env.show();
  assert.equal(env.live.size, 1, "show still restores exactly one interval");
  clock.advance(2000);
  assert.equal(clock.ticks.length, 3, "tick 1 pre-hide plus 2 post-resume ticks");
  assert.equal(clock.ticks[1], 2000, "the first resumed tick is one full interval after show");
  assert.equal(clock.ticks[2] - clock.ticks[1], 1000, "the resumed cadence stays exact");
});

test("eyes.js log tail: the hidden bail precedes the fetch, and show re-fires it", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "eyes.js"), "utf8");
  const tail = source.match(/async function refreshLog\(\) \{[\s\S]*?\n  \}/);
  assert.ok(tail, "refreshLog must exist");
  const bail = tail[0].indexOf("if (document.hidden) return;");
  const fetch = tail[0].indexOf("await window.mefiStudio.eyesLog");
  assert.ok(bail !== -1, "refreshLog must bail while hidden");
  assert.ok(fetch !== -1, "refreshLog must fetch through the bridge");
  assert.ok(bail < fetch, "the hidden bail must precede the fetch, so a tick never starts a fetch nobody can see");
  assert.match(
    source,
    /document\.addEventListener\("visibilitychange", \(\) => \{\s*\n\s*if \(!document\.hidden && state\.mode === "log"\) refreshLog\(\);/,
    "the visible log snaps back on show"
  );
  assert.match(source, /pollStart\("eyes\.log", refreshLog, 5000\)/, "the log poll rides the shared guard");
});

test("eyes.js log tail: the tick also gates on the eyes tab, so other tabs make no fetches", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "eyes.js"), "utf8");
  const tail = source.match(/async function refreshLog\(\) \{[\s\S]*?\n  \}/);
  assert.ok(tail, "refreshLog must exist");
  const bail = tail[0].indexOf("if (document.hidden) return;");
  const tabGate = tail[0].indexOf("els.tab?.hidden");
  const fetch = tail[0].indexOf("await window.mefiStudio.eyesLog");
  assert.ok(tabGate !== -1, "the tick must gate on the eyes tab being visible");
  assert.ok(bail !== -1 && bail < tabGate && tabGate < fetch, "the window bail and tab gate must both precede the fetch");
  // The shipped tick rides the shared guard on the same virtual clock: a
  // booklet/graph/studio tab in front must fetch nothing, in the window or
  // out of it, and returning to the eyes view resumes the exact cadence.
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let fetches = 0;
  const els = { tab: { hidden: true }, log: { textContent: "", scrollTop: 0, scrollHeight: 0 } };
  const refreshLog = compile(tail[0], {
    document: {
      get hidden() {
        return env.state.hidden;
      },
    },
    window: {
      mefiStudio: {
        eyesLog: async () => {
          fetches += 1;
          return { ok: true, text: "log" };
        },
      },
    },
    els,
  });
  env.boot.pollStart("eyes.log", refreshLog, 5000);
  clock.advance(10000); // visible window, but another tab is in front
  assert.equal(fetches, 0, "a log poll behind another tab must fetch nothing");
  els.tab.hidden = false;
  clock.advance(5000);
  assert.equal(fetches, 1, "returning to the eyes tab resumes one fetch per interval");
  env.hide();
  clock.advance(5000);
  assert.equal(fetches, 1, "a hidden window still fetches nothing");
  env.show();
  clock.advance(5000);
  assert.equal(fetches, 2, "show restores the exact cadence");
});

test("eyes.js log tail: one visibility toggle — hidden fetches nothing, show snaps exactly one immediate refresh, cadence resumes without duplicates", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "eyes.js"), "utf8");
  assert.equal(
    (source.match(/document\.addEventListener\("visibilitychange"/g) || []).length,
    1,
    "the log tail registers exactly one visibilitychange listener, so no toggle can double-fire refreshes"
  );
  const visibility = source.match(/document\.addEventListener\("visibilitychange", \(\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(visibility, "the log tail must handle visibility changes");
  const tail = source.match(/async function refreshLog\(\) \{[\s\S]*?\n  \}/);
  assert.ok(tail, "refreshLog must exist");
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let fetches = 0;
  const els = { tab: { hidden: false }, log: { textContent: "", scrollTop: 0, scrollHeight: 0 } };
  const state = { mode: "log" };
  const refreshLog = compile(tail[0], {
    document: {
      get hidden() {
        return env.state.hidden;
      },
    },
    window: {
      mefiStudio: {
        eyesLog: async () => {
          fetches += 1;
          return { ok: true, text: "log" };
        },
      },
    },
    els,
  });
  const onVisibility = compile(`() => {${visibility[1]}}`, {
    document: {
      get hidden() {
        return env.state.hidden;
      },
    },
    state,
    refreshLog,
  });
  env.boot.pollStart("eyes.log", refreshLog, 5000);
  clock.advance(10000); // baseline: two visible intervals
  assert.equal(fetches, 2, "the visible cadence fetches once per 5s interval");
  env.hide(); // the single visibility toggle the acceptance brief asks for
  const beforeHidden = fetches;
  clock.advance(12500); // 2.5 hidden intervals
  assert.equal(fetches - beforeHidden, 0, "a hidden window fetches nothing");
  env.show();
  onVisibility(); // the shipped show listener snaps the tail back immediately
  assert.equal(fetches - beforeHidden, 1, "show fires exactly one immediate refresh, never two");
  assert.equal(env.live.size, 1, "the guard resumes exactly one interval");
  clock.advance(15000); // three resumed intervals
  assert.equal(fetches, 6, "three visible intervals add three fetches: a doubled count would be a leaked second interval or listener");
});

test("eyes.js log tail: without the guard the fallback interval holds the same start/stop lifecycle", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "eyes.js"), "utf8");
  assert.match(source, /else fallbackLogTimer = setInterval\(refreshLog, 5000\)/, "browser mode falls back to a raw log interval");
  assert.match(source, /if \(fallbackLogTimer\) clearInterval\(fallbackLogTimer\);/, "every mode switch clears the fallback interval");
  const modeSource = source.match(/function setMode\(mode\) \{[\s\S]*?\n  \}/);
  assert.ok(modeSource, "setMode must exist");
  // window carries no MefiBoot, so the shipped setMode takes its fallback
  // branch; the lifecycle must match the guard's: one interval per entry,
  // cleared on every switch away, restarted exactly once on return.
  const live = new Set();
  let nextId = 1;
  let refreshes = 0;
  const setMode = compile(modeSource[0], {
    window: {},
    document: { querySelectorAll: () => [] },
    state: { mode: null },
    fallbackLogTimer: null, // the module's `let fallbackLogTimer = null;`
    els: { modePng: { hidden: true }, modeDiff: { hidden: true }, modeLog: { hidden: true } },
    refreshLog: () => {
      refreshes += 1;
    },
    drawPins: () => {},
    setInterval(fn, ms) {
      const id = nextId++;
      live.add(id);
      return id;
    },
    clearInterval(id) {
      live.delete(id);
    },
    requestAnimationFrame: () => 0,
  });
  setMode("log");
  assert.equal(live.size, 1, "log mode without the guard starts exactly one fallback interval");
  assert.equal(refreshes, 1, "entering log mode refreshes immediately");
  setMode("png");
  assert.equal(live.size, 0, "leaving log mode clears the fallback interval");
  setMode("log");
  assert.equal(live.size, 1, "returning to log mode starts exactly one fallback interval");
});

// ---- overlay polls ----------------------------------------------------------
// The remaining poll owners sit on overlays (tasks board, explorer, idle
// Command). The shared guard already stops their timers while hidden; these
// pins hold each tick's own hidden bail ahead of its fetch, and each show
// listener snapping the view back, so a future edit cannot silently move the
// fetch ahead of the bail.
test("profiler.js live capture: hiding tears down the sampling timers, recording-show restores them", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "profiler.js"), "utf8");
  // The profiler polls the host snapshot on its own 500ms interval while a
  // capture is live; instead of the shared guard it owns a stricter gate —
  // the whole sampling session (interval, rAF loop, observer) stops on hide
  // and restarts only if a capture is still recording.
  assert.equal(
    (source.match(/document\.addEventListener\("visibilitychange"/g) || []).length,
    1,
    "the profiler registers exactly one visibilitychange listener, so no toggle can double its restarts"
  );
  assert.match(
    source,
    /document\.addEventListener\("visibilitychange", \(\) => \{\s*if \(document\.hidden\) stopSampling\(\); else if \(core\.isRecording\(\)\) startSampling\(\); paint\(\);/,
    "hide must tear the sampling timers down and a visible recording must restore them"
  );
  const start = source.match(/function startSampling\(\) \{[\s\S]*?\n  \}/);
  assert.ok(start, "startSampling must exist");
  assert.match(start[0], /if \(!core\.isRecording\(\) \|\| document\.hidden\) return;/, "a hidden window must never start sampling");
  const stop = source.match(/function stopSampling\(\) \{[\s\S]*?\n  \}/);
  assert.ok(stop, "stopSampling must exist");
  assert.match(stop[0], /if \(raf\) cancelAnimationFrame\(raf\);/, "hiding must cancel the frame loop");
  assert.match(stop[0], /if \(timer\) clearInterval\(timer\);/, "hiding must clear the host-poll interval, so a hidden capture issues no IPC reads");
});


test("tasks.js board poll: the tick's hidden bail precedes load, and show reloads the board", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "tasks.js"), "utf8");
  assert.match(source, /pollStart\("tasks\.board", tasksTick, TASKS_POLL_MS\)/, "the board poll must register under the shared guard");
  assert.match(
    source,
    /const tasksTick = \(\) => \{\s*\n\s*if \(!window\.mefiStudio\?\.tasksList\) return;\s*\n\s*if \(!document\.hidden && !els\.overlay\.hidden\) load\(\);/,
    "the tick must bail while hidden before loading"
  );
  assert.match(
    source,
    /document\.addEventListener\("visibilitychange", \(\) => \{\s*\n\s*if \(!document\.hidden && !els\.overlay\.hidden\) tasksTick\(\);/,
    "the board must snap back on show"
  );
});

test("explorer.js state poll: the tick's hidden bail precedes load, and show reloads the explorer", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "explorer.js"), "utf8");
  assert.match(source, /pollStart\("explorer\.state", explorerTick, EXPLORER_POLL_MS\)/, "the explorer poll must register under the shared guard");
  assert.match(
    source,
    /const explorerTick = \(\) => \{\s*\n\s*if \(!window\.mefiStudio\?\.eyesState\) return;\s*\n\s*if \(document\.visibilityState === "visible" && !els\.overlay\.hidden\) load\(\);/,
    "the tick must bail while hidden before loading"
  );
  assert.match(
    source,
    /document\.addEventListener\("visibilitychange", \(\) => \{\s*\n\s*if \(!document\.hidden && !els\.overlay\.hidden\) explorerTick\(\);/,
    "the explorer must snap back on show"
  );
});

test("idle.js Command timers: the refresh tick and idle auto-enter both bail while hidden, and show snaps back", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "idle.js"), "utf8");
  const tick = source.match(/function tick\(\) \{[\s\S]*?\n  \}/);
  assert.ok(tick, "the Command refresh tick must exist");
  const bail = tick[0].indexOf("if (document.hidden) return;");
  const fetch = tick[0].indexOf("refreshCommandBacklog();");
  assert.ok(bail !== -1, "the refresh tick must bail while hidden");
  assert.ok(fetch !== -1, "the refresh tick must drive the fetches");
  assert.ok(bail < fetch, "the hidden bail must precede the fetches, so hidden time makes none");
  const arm = source.match(/function armIdleTimer\(\) \{[\s\S]*?\n  \}/);
  assert.ok(arm, "the idle auto-enter timer must exist");
  assert.match(
    arm[0],
    /if \(document\.hidden\) return;[\s\S]*?if \(Date\.now\(\) - state\.lastInput > IDLE_MS\) enter\(\);/,
    "a hidden window must never idle into Command"
  );
  const visibility = source.match(/document\.addEventListener\("visibilitychange", \(\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(visibility, "Command must handle visibility changes");
  const state = { active: true, lastInput: 0 };
  const document = { hidden: true };
  let ticks = 0, enters = 0, wakes = 0;
  const Date = { now: () => 600000 };
  const wakeAmbientZen = compile(source.match(/function wakeAmbientZen\([^]*?\n  \}/)[0], {
    state, Date, setAmbientZen: () => { wakes += 1; },
  });
  const onVisibility = compile(`() => {${visibility[1]}}`, {
    state, document, Date, IDLE_MS: 300000, wakeAmbientZen,
    tick: () => { ticks += 1; }, enter: () => { enters += 1; },
  });
  onVisibility();
  assert.equal(ticks, 0, "hiding must not refresh the view");
  document.hidden = false;
  onVisibility();
  assert.equal(ticks, 1, "showing active Command refreshes immediately");
  state.active = false; state.lastInput = 0;
  onVisibility();
  assert.equal(state.lastInput, Date.now(), "showing resets the quiet clock");
  assert.equal(enters, 0, "returning to another view does not force Command open");
  assert.equal(wakes, 3, "each visibility change leaves ambient Zen");
});

// ---- overlay poll timing ----------------------------------------------------
// The shape pins above hold the wiring; these tests drive the shipped tick
// code itself. extractFn lifts a function's source verbatim out of a renderer
// module and compile runs it against stubs, so what hides behind the guard is
// the module's own closure, not a re-implementation.
async function extractFn(file, pattern, label) {
  const source = await readFile(path.join(STUDIO, "renderer", file), "utf8");
  const match = source.match(pattern);
  assert.ok(match, `${label} must exist in renderer/${file}`);
  // `const tick = () => {...};` is a declaration with a trailing semicolon;
  // strip both so the parens in compile() wrap a callable expression.
  return match[0].trim().replace(/^const\s+\w+\s*=\s*/, "").replace(/;\s*$/, "");
}

function compile(fnSource, context) {
  return vm.runInNewContext(`(${fnSource})`, context);
}

const TASKS_TICK_SOURCE = /const tasksTick = \(\) => \{[\s\S]*?\n    \};/;
const EXPLORER_TICK_SOURCE = /const explorerTick = \(\) => \{[\s\S]*?\n    \};/;

test("tasks.board through the real tick: hidden time loads nothing, cycles never stack, visible time loads once per interval", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let loads = 0;
  const els = { overlay: { hidden: false } };
  const tasksTick = compile(await extractFn("tasks.js", TASKS_TICK_SOURCE, "the tasks board tick"), {
    window: { mefiStudio: { tasksList: async () => ({ tasks: [] }) } },
    document: {
      get hidden() {
        return env.state.hidden;
      },
    },
    els,
    load: () => {
      loads += 1;
    },
  });
  const MS = 15000;
  env.boot.pollStart("tasks.board", tasksTick, MS);
  assert.equal(env.live.size, 1);
  for (let cycle = 0; cycle < 6; cycle++) {
    env.hide();
    assert.equal(env.live.size, 0, `cycle ${cycle}: hiding must stop the board poll`);
    const silent = loads;
    clock.advance(MS * 3);
    assert.equal(loads - silent, 0, `cycle ${cycle}: hidden time must load nothing`);
    if (cycle === 3) env.boot.pollStart("tasks.board", tasksTick, MS); // re-register mid-hidden, like re-navigating
    env.show();
    assert.equal(env.live.size, 1, `cycle ${cycle}: show must hold exactly one interval`);
    const fresh = loads;
    clock.advance(MS * 2);
    assert.equal(loads - fresh, 2, `cycle ${cycle}: visible time loads once per interval, never stacked`);
  }
  assert.equal(loads, 12, "6 cycles x 2 visible loads: stacked intervals would multiply the count");
  els.overlay.hidden = true; // the sheet closed while the tab stayed visible
  const closed = loads;
  clock.advance(MS * 2);
  assert.equal(loads - closed, 0, "a closed sheet must gate the tick even while visible");
  els.overlay.hidden = false;
  clock.advance(MS);
  assert.equal(loads - closed, 1, "reopening the sheet resumes the cadence on the next tick");
});

test("tasks.board resume: a hidden stretch drifts nothing and is never replayed as a catch-up burst", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let loads = 0;
  const tasksTick = compile(await extractFn("tasks.js", TASKS_TICK_SOURCE, "the tasks board tick"), {
    window: { mefiStudio: { tasksList: async () => ({ tasks: [] }) } },
    document: {
      get hidden() {
        return env.state.hidden;
      },
    },
    els: { overlay: { hidden: false } },
    load: () => {
      loads += 1;
    },
  });
  const MS = 15000;
  env.boot.pollStart("tasks.board", tasksTick, MS);
  clock.advance(MS);
  assert.equal(loads, 1, "one visible interval loads once");
  const idBefore = [...env.live][0];
  env.hide();
  clock.advance(10 * 60 * 1000); // a hidden ten minutes
  assert.equal(loads, 1, "hidden time must not load");
  env.show();
  assert.notEqual([...env.live][0], idBefore, "resume must set a fresh timer, not resurrect the stale id");
  clock.advance(MS - 1);
  assert.equal(loads, 1, "no catch-up burst for the hidden elapsed time");
  clock.advance(1);
  assert.equal(loads, 2, "the first resumed load lands exactly one interval after show");
  clock.advance(MS * 3);
  assert.equal(loads, 5, "cadence stays exact after resume");
});

test("tasks.board: an in-flight load completing while hidden must not resurrect the paused timer", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let resolveLoad;
  let completedAt = null;
  let starts = 0;
  const tasksTick = compile(await extractFn("tasks.js", TASKS_TICK_SOURCE, "the tasks board tick"), {
    window: { mefiStudio: { tasksList: async () => ({ tasks: [] }) } },
    document: {
      get hidden() {
        return env.state.hidden;
      },
    },
    els: { overlay: { hidden: false } },
    load: () => {
      starts += 1;
      new Promise((resolve) => {
        resolveLoad = resolve;
      }).then(() => {
        completedAt = clock.now;
      });
    },
  });
  const MS = 15000;
  env.boot.pollStart("tasks.board", tasksTick, MS);
  clock.advance(MS); // the tick fires; the load is now mid-flight
  assert.equal(starts, 1);
  assert.equal(completedAt, null);
  env.hide();
  assert.equal(env.live.size, 0, "hiding mid-flight stops the board poll");
  resolveLoad(); // the load completes while hidden
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completedAt, MS, "the in-flight completion lands while hidden");
  assert.equal(env.live.size, 0, "a completing load must not resurrect the paused timer");
  assert.equal(env.boot.pollActive("tasks.board"), false);
  env.show();
  assert.equal(env.live.size, 1, "show restores exactly one interval");
  clock.advance(MS * 2);
  assert.equal(starts, 3, "one pre-hide tick plus two resumed ticks");
  assert.equal(clock.ticks[1], MS * 2, "the first resumed tick is one full interval after show");
  assert.equal(clock.ticks[2] - clock.ticks[1], MS, "the resumed cadence stays exact");
});

test("explorer.state through the real tick: visibility and sheet gates hold, rapid cycles never stack, resume stays exact", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let loads = 0;
  const bridge = { eyesState: async () => ({}) };
  const els = { overlay: { hidden: false } };
  const explorerTick = compile(await extractFn("explorer.js", EXPLORER_TICK_SOURCE, "the explorer tick"), {
    window: { mefiStudio: bridge },
    document: {
      get hidden() {
        return env.state.hidden;
      },
      get visibilityState() {
        return env.state.hidden ? "hidden" : "visible";
      },
    },
    els,
    load: () => {
      loads += 1;
    },
  });
  const MS = 5000;
  env.boot.pollStart("explorer.state", explorerTick, MS);
  clock.advance(MS);
  assert.equal(loads, 1, "visible with the sheet open loads once per interval");
  env.hide();
  clock.advance(MS * 4);
  assert.equal(loads, 1, "hidden time loads nothing");
  env.show();
  assert.equal(env.live.size, 1);
  env.hide();
  env.show();
  env.hide();
  env.show();
  assert.equal(env.live.size, 1, "rapid toggles leave exactly one interval");
  clock.advance(MS);
  assert.equal(loads, 2, "toggling drifts nothing: the cadence resumes exactly");
  bridge.eyesState = null; // the browser fallback with no store bridge
  clock.advance(MS * 2);
  assert.equal(loads, 2, "a missing bridge gates the tick before any load");
  bridge.eyesState = async () => ({});
  els.overlay.hidden = true;
  clock.advance(MS);
  assert.equal(loads, 2, "a closed sheet gates the tick while visible");
  els.overlay.hidden = false;
  env.hide();
  clock.advance(MS * 2);
  assert.equal(loads, 2, "hidden still loads nothing with the sheet open again");
  env.show();
  clock.advance(MS);
  assert.equal(loads, 3, "show resumes the exact cadence");
});

test("explorer.state resume: a hidden stretch drifts nothing and is never replayed as a catch-up burst", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let loads = 0;
  const explorerTick = compile(await extractFn("explorer.js", EXPLORER_TICK_SOURCE, "the explorer tick"), {
    window: { mefiStudio: { eyesState: async () => ({}) } },
    document: {
      get hidden() {
        return env.state.hidden;
      },
      get visibilityState() {
        return env.state.hidden ? "hidden" : "visible";
      },
    },
    els: { overlay: { hidden: false } },
    load: () => {
      loads += 1;
    },
  });
  const MS = 5000;
  env.boot.pollStart("explorer.state", explorerTick, MS);
  clock.advance(MS * 3);
  assert.equal(loads, 3, "three visible intervals load three times");
  const idBefore = [...env.live][0];
  env.hide();
  clock.advance(10 * 60 * 1000); // a hidden ten minutes
  assert.equal(loads, 3, "hidden time must not load");
  env.show();
  assert.notEqual([...env.live][0], idBefore, "resume must set a fresh timer, not resurrect the stale id");
  clock.advance(MS - 1);
  assert.equal(loads, 3, "no catch-up burst for the hidden elapsed time");
  clock.advance(1);
  assert.equal(loads, 4, "the first resumed load lands exactly one interval after show");
  clock.advance(MS * 3);
  assert.equal(loads, 7, "cadence stays exact after resume");
});

test("explorer.state: an in-flight eyesState read completing while hidden must not resurrect the paused timer", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  let resolveLoad;
  let completedAt = null;
  let starts = 0;
  const explorerTick = compile(await extractFn("explorer.js", EXPLORER_TICK_SOURCE, "the explorer tick"), {
    window: { mefiStudio: { eyesState: async () => ({}) } },
    document: {
      get hidden() {
        return env.state.hidden;
      },
      get visibilityState() {
        return env.state.hidden ? "hidden" : "visible";
      },
    },
    els: { overlay: { hidden: false } },
    load: () => {
      starts += 1;
      new Promise((resolve) => {
        resolveLoad = resolve;
      }).then(() => {
        completedAt = clock.now;
      });
    },
  });
  const MS = 5000;
  env.boot.pollStart("explorer.state", explorerTick, MS);
  clock.advance(MS); // the tick fires; the eyesState read is now mid-flight
  assert.equal(starts, 1);
  assert.equal(completedAt, null);
  env.hide();
  assert.equal(env.live.size, 0, "hiding mid-flight stops the explorer poll");
  resolveLoad(); // the read completes while hidden
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completedAt, MS, "the in-flight completion lands while hidden");
  assert.equal(env.live.size, 0, "a completing read must not resurrect the paused timer");
  assert.equal(env.boot.pollActive("explorer.state"), false);
  env.show();
  assert.equal(env.live.size, 1, "show restores exactly one interval");
  clock.advance(MS * 2);
  assert.equal(starts, 3, "one pre-hide tick plus two resumed ticks");
  assert.equal(clock.ticks[1], MS * 2, "the first resumed tick is one full interval after show");
  assert.equal(clock.ticks[2] - clock.ticks[1], MS, "the resumed cadence stays exact");
});

test("overhead.js task poll: visibilityState gates the fetch, visibilitychange hidden fetches nothing, show snaps a fresh poll", async () => {
  const source = await readFile(path.join(STUDIO, "renderer", "overhead.js"), "utf8");
  const poll = source.match(/async function poll\(\) \{[\s\S]*?\n  \}/);
  assert.ok(poll, "the overhead poll must exist");
  const vis = poll[0].indexOf("document.visibilityState");
  const fetch = poll[0].indexOf("await load();");
  assert.ok(vis !== -1 && fetch !== -1 && vis < fetch, "the poll must read document.visibilityState before its fetch");
  assert.match(
    source,
    /document\.addEventListener\("visibilitychange", \(\) => \{\s*\n\s*if \(document\.hidden \|\| !initialized \|\| el\.overlay\.hidden\) return;\s*\n\s*clearTimeout\(pollTimer\);\s*\n\s*poll\(\);/,
    "showing the app must snap a fresh poll immediately"
  );
  // The shipped chain, not a copy: poll, its scheduler and the
  // visibilitychange listener are lifted verbatim and driven on the same
  // virtual clock, so the zero-fetch-while-hidden contract is proven against
  // the code that ships.
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  let fetches = 0;
  const context = {
    initialized: true,
    el: { overlay: { hidden: false } },
    state: { nodes: [], edges: [], tasks: [] },
    document: {
      get hidden() {
        return env.state.hidden;
      },
      get visibilityState() {
        return env.state.hidden ? "hidden" : "visible";
      },
    },
    POLL_INTERVAL_MS: 5000,
    POLL_MAX_MS: 30000,
    pollDelay: 5000,
    pollTimer: null,
    clearTimeout: (id) => clock.clearTimeout(id),
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    load: () => {
      fetches += 1;
    },
  };
  const schedule = compile(source.match(/function schedulePoll\(\) \{[\s\S]*?\n  \}/)[0], context);
  context.schedulePoll = schedule;
  const onVisibility = compile(`() => {${source.match(/document\.addEventListener\("visibilitychange", \(\) => \{([\s\S]*?)\n    \}\);/)[1]}}`, context);
  context.poll = compile(poll[0], context);
  schedule();
  await flush();
  clock.advance(5000);
  await flush();
  assert.equal(fetches, 1, "a visible sheet fetches once per interval");
  env.hide();
  onVisibility(); // the shipped listener fires; its hidden branch must bail
  const atHide = fetches;
  clock.advance(10 * 60 * 1000); // ten hidden minutes of chained rechecks
  await flush();
  assert.equal(fetches - atHide, 0, "ten hidden minutes must make zero fetch calls");
  env.show();
  onVisibility();
  assert.equal(fetches - atHide, 1, "showing the app snaps exactly one fresh poll");
  await flush();
  clock.advance(10000);
  await flush();
  assert.equal(fetches - atHide, 2, "the visible cadence resumes once per interval");
});

test("idle.js through the real tick and auto-enter timer: hidden silence under rapid toggles, sheet gate, exact auto-enter", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  const state = { active: true, assistant: {}, ambient: false, popupAt: 0, feedDirty: false };
  const dataset = { sheet: "" };
  const calls = { backlog: 0, graph: 0, feed: 0 };
  const idleTick = compile(await extractFn("idle.js", /function tick\(\) \{[\s\S]*?\n  \}/, "the Command refresh tick"), {
    state,
    document: {
      get hidden() {
        return env.state.hidden;
      },
      body: { dataset },
    },
    Date: { now: () => clock.now },
    POPUP_MS: 30000,
    refreshCommandBacklog: () => {
      calls.backlog += 1;
    },
    refreshGraph: () => {
      calls.graph += 1;
    },
    checkCollisions: () => {},
    updateTelemetry: () => {},
    autopilotJobs: () => [],
    chatMode: () => false,
    renderFeed: () => {
      calls.feed += 1;
    },
    popup: () => {},
  });
  env.hide();
  for (let i = 0; i < 20; i++) idleTick();
  assert.equal(calls.backlog, 0, "hidden time makes no fetch work, however often the timer fires");
  for (let cycle = 0; cycle < 10; cycle++) {
    env.hide();
    idleTick();
    env.show();
  }
  assert.equal(calls.backlog, 0, "rapid toggles stay silent until a tick lands while visible");
  dataset.sheet = "tasks";
  idleTick();
  assert.equal(calls.backlog, 0, "a sheet over Command gates the tick even while visible");
  dataset.sheet = "";
  idleTick();
  assert.equal(calls.backlog, 1, "a visible, active, uncovered Command refreshes once per tick");
  assert.equal(calls.graph, 1);
  assert.equal(calls.feed, 1);

  // the quiet clock: the auto-enter timer bails while hidden and enters once, on time, while visible
  const IDLE_MS = 5 * 60 * 1000;
  let enters = 0;
  let zenChecks = 0;
  const idleState = { timers: {}, active: false, lastInput: 0 };
  const arm = compile(
    await extractFn("idle.js", /function armIdleTimer\(\) \{[\s\S]*?\n  \}/, "the idle auto-enter arm"),
    {
      state: idleState,
      document: {
        get hidden() {
          return env.state.hidden;
        },
      },
      Date: { now: () => clock.now },
      IDLE_MS,
      checkAmbientZen: () => { zenChecks += 1; },
      enter: () => {
        enters += 1;
        idleState.active = true; // the real enter() makes the window active again
      },
      setInterval: (fn, ms) => clock.setInterval(fn, ms),
      clearInterval: (id) => clock.clearInterval(id),
    },
  );
  arm();
  env.hide();
  clock.advance(IDLE_MS + 60000);
  assert.equal(enters, 0, "a hidden window never idles into Command");
  env.show();
  clock.advance(10000);
  assert.equal(enters, 1, "once shown, the long-quiet clock enters exactly once");
  clock.advance(60000);
  assert.equal(enters, 1, "the timer keeps firing but never re-enters once active");
  assert.ok(zenChecks > 0, "active Command uses its ambient Zen check instead of re-entering");
  const idleSource = await readFile(path.join(STUDIO, "renderer", "idle.js"), "utf8");
  assert.equal((idleSource.match(/^\s*armIdleTimer\(\);/gm) || []).length, 1, "the auto-enter timer is armed exactly once, so nothing can stack");
});

test("idle.js Command refresh rides its shipped interval: a hidden stretch makes no fetch work, show snaps once, cadence resumes exactly", async () => {
  const idleSource = await readFile(path.join(STUDIO, "renderer", "idle.js"), "utf8");
  assert.match(idleSource, /state\.timers\.refresh = setInterval\(tick, 4000\);/, "the refresh cadence must be the shipped 4s interval");
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  const state = { active: true, assistant: {}, ambient: false, popupAt: 0, feedDirty: false };
  const dataset = { sheet: "" };
  let refreshes = 0;
  const idleTick = compile(await extractFn("idle.js", /function tick\(\) \{[\s\S]*?\n  \}/, "the Command refresh tick"), {
    state,
    document: {
      get hidden() {
        return env.state.hidden;
      },
      body: { dataset },
    },
    Date: { now: () => clock.now },
    POPUP_MS: 30000,
    refreshCommandBacklog: () => {
      refreshes += 1;
    },
    refreshGraph: () => {},
    checkCollisions: () => {},
    updateTelemetry: () => {},
    autopilotJobs: () => [],
    chatMode: () => false,
    renderFeed: () => {},
    popup: () => {},
  });
  // enter() registers this exact interval; register it on the same virtual clock.
  clock.setInterval(idleTick, 4000);
  clock.advance(8000);
  assert.equal(refreshes, 2, "two visible intervals refresh twice");
  env.hide();
  clock.advance(60000); // the interval keeps firing the whole hidden minute
  assert.equal(clock.ticks.length, 17, "the shipped interval keeps its cadence while hidden");
  assert.equal(refreshes, 2, "a hidden minute makes zero refreshes");
  const visibility = idleSource.match(/document\.addEventListener\("visibilitychange", \(\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(visibility, "Command must handle visibility changes");
  const DateStub = { now: () => clock.now };
  const onVisibility = compile(`() => {${visibility[1]}}`, {
    state,
    document: {
      get hidden() {
        return env.state.hidden;
      },
    },
    Date: DateStub,
    IDLE_MS: 300000,
    wakeAmbientZen: compile(idleSource.match(/function wakeAmbientZen\([^]*?\n  \}/)[0], {
      state,
      Date: DateStub,
      setAmbientZen: () => false,
    }),
    tick: idleTick,
    enter: () => {},
  });
  env.show();
  onVisibility(); // the shipped listener fires; its active branch snaps the view
  assert.equal(refreshes, 3, "show snaps exactly one immediate refresh");
  clock.advance(3999);
  assert.equal(refreshes, 3, "no catch-up burst for the hidden stretch");
  clock.advance(1);
  assert.equal(refreshes, 4, "the first interval tick after show lands exactly one interval later");
  clock.advance(12000);
  assert.equal(refreshes, 7, "the visible cadence stays exact after resume");
});

test("idle.js Command refresh: an in-flight backlog read completing while hidden must not wake fetch work, and show resumes the exact cadence", async () => {
  const clock = makeClock();
  const env = await loadBootWithClock(clock);
  const idleSource = await readFile(path.join(STUDIO, "renderer", "idle.js"), "utf8");
  const state = {
    active: true,
    assistant: {},
    ambient: false,
    popupAt: 0,
    feedDirty: false,
    backlogReadPending: false,
    backlogReadAt: -10000,
    backlogRevision: 0,
    backlog: null,
    backlogError: null,
  };
  const dataset = { sheet: "" };
  let resolveRead;
  let fetches = 0;
  let feeds = 0;
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const backlogStatus = () => {
    fetches += 1;
    return new Promise((resolve) => {
      resolveRead = resolve;
    });
  };
  const refreshCommandBacklog = compile(
    await extractFn("idle.js", /async function refreshCommandBacklog\(force = false\) \{[\s\S]*?\n  \}/, "the Command backlog refresh"),
    {
      state,
      window: { mefiStudio: { backlogStatus } },
      Date: { now: () => clock.now },
      setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
      clearTimeout: (id) => clock.clearTimeout(id),
      renderFeed: () => {
        feeds += 1;
      },
    },
  );
  const idleTick = compile(await extractFn("idle.js", /function tick\(\) \{[\s\S]*?\n  \}/, "the Command refresh tick"), {
    state,
    document: {
      get hidden() {
        return env.state.hidden;
      },
      body: { dataset },
    },
    Date: { now: () => clock.now },
    POPUP_MS: 30000,
    refreshCommandBacklog,
    refreshGraph: () => {},
    checkCollisions: () => {},
    updateTelemetry: () => {},
    autopilotJobs: () => [],
    chatMode: () => false,
    renderFeed: () => {},
    popup: () => {},
  });
  clock.setInterval(idleTick, 4000);
  clock.advance(4000); // the tick fires; the backlog read is now mid-flight
  assert.equal(fetches, 1);
  env.hide();
  resolveRead({ ok: true, next: [] }); // the read completes while hidden
  await flush();
  assert.equal(state.backlogReadPending, false, "the in-flight gate must release while hidden");
  assert.equal(state.backlog?.ok, true, "the in-flight completion lands while hidden");
  clock.advance(60000); // a hidden minute with the gate released
  assert.equal(fetches, 1, "a stale completion must wake no further fetches while hidden");
  const visibility = idleSource.match(/document\.addEventListener\("visibilitychange", \(\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(visibility, "Command must handle visibility changes");
  const DateStub = { now: () => clock.now };
  const onVisibility = compile(`() => {${visibility[1]}}`, {
    state,
    document: {
      get hidden() {
        return env.state.hidden;
      },
    },
    Date: DateStub,
    IDLE_MS: 300000,
    wakeAmbientZen: compile(idleSource.match(/function wakeAmbientZen\([^]*?\n  \}/)[0], {
      state,
      Date: DateStub,
      setAmbientZen: () => false,
    }),
    tick: idleTick,
    enter: () => {},
  });
  env.show();
  onVisibility(); // the shipped listener fires; its active branch snaps the view
  await flush();
  assert.equal(fetches, 2, "show snaps exactly one fresh read once the gate is free");
  resolveRead({ ok: true, next: [] });
  await flush();
  clock.advance(4000);
  await flush();
  assert.equal(fetches, 3, "the visible cadence resumes once per interval");
  assert.ok(feeds >= 2, "completions keep feeding the view");
});
