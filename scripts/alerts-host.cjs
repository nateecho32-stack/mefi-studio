"use strict";
// Mefi's Studio AI+ — the host half of Windows notifications, the taskbar flash
// and the count on the taskbar icon: the one object main.cjs's "Notifications"
// block builds and calls from a few guarded hooks. scripts/alerts.cjs decides
// what may be said and when; this module does the watching, waiting, showing
// and remembering in between, with every collaborator passed in (like
// scripts/report-host.cjs), so a test can run it against stubs.
//
//   the hooks      question() and tasks() hear what main already knows: an
//                  assistant question was asked, a task was parked, waits for
//                  its approval or finished. They only queue it.
//   the settle     a queued thing waits SETTLE_MS (20 s) and is told only if it
//                  is still waiting: a question the assistant answers by itself
//                  in a moment never pings. Everything due in one look is
//                  grouped by kind, so three questions are one notification.
//   the look       poke() asks for a look a moment from now (never two inside
//                  ten seconds, one every minute at least): it reads the
//                  needs-you digest, draws the count on the taskbar icon,
//                  and tells what is due. Hooks only set a timer, so a busy
//                  board never runs this per write.
//   the showing    decide() says yes or why not; a yes makes one Notification,
//                  flashes the taskbar until Studio is focused, and is
//                  remembered for the dedupe and the twelve an hour. A click
//                  brings the window up and pushes alerts:open { kind, id, taskId,
//                  projectId, count? }: count only when it told several.
//   the test       test() sends the test notification; while Studio is in
//                  front it waits (up to a minute) for the owner to look
//                  away, because a notification is never sent to a window
//                  being looked at.
//
// Nothing here touches the network. A failure anywhere is logged by code (never
// by message, which can carry a path) and swallowed: it never stops the app.
// Guarded by tests/alerts_host.test.mjs.

const LOOK_DELAY_MS = 2000;
const LOOK_GAP_MS = 10 * 1000;
const REFRESH_MS = 60 * 1000;
const TEST_WAIT_MS = 60 * 1000;
const PENDING_MAX = 200;
const LIVE_MAX = 20;
/** How long the choices are trusted before a look reads them again (they are read at once when a thing is about to be told). */
const RELOAD_MS = 5 * 60 * 1000;

const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const oneLine = (value, max) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
};
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);
// A log line names a failure by code: an fs or Electron message can carry a path, and with it the person's user name.
const why = (error) => String(error?.code ?? error?.name ?? "error").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "error";

function createAlertsHost({
  rules, icon = null, Notification = null, nativeImage = null, iconPath = "", platform = process.platform, env = {},
  getWindow = () => null, isLooked = () => false, showWindow = () => {}, send = () => {},
  readSettings = async () => ({}), updateSettings = async () => {}, log = () => {},
  digest = async () => null, questionOpen = () => true, projectId = () => null, scale = () => 1, remotePush = () => {},
  now = () => Date.now(), minuteOfDay = null, setTimer = setTimeout, clearTimer = clearTimeout,
  settleMs = rules.SETTLE_MS, lookDelayMs = LOOK_DELAY_MS, lookGapMs = LOOK_GAP_MS, refreshMs = REFRESH_MS, testWaitMs = TEST_WAIT_MS, reloadMs = RELOAD_MS,
} = {}) {
  const say = (line) => { try { log(line); } catch { /* logging never stops an alert */ } };
  const killed = () => env.MEFI_STUDIO_NO_ALERTS === "1";
  const minute = () => (typeof minuteOfDay === "function" ? minuteOfDay() : (() => { const date = new Date(now()); return date.getHours() * 60 + date.getMinutes(); })());
  const supported = () => Boolean(Notification) && (typeof Notification.isSupported !== "function" || Notification.isSupported() === true);

  let prefs = rules.normalizePrefs(null);
  let quietSaved = null; // settings.remote.quiet as saved: the Discord remote's own hours
  let loaded = false, loadedAt = -Infinity;
  let memory = { sent: [], recent: {} };
  const pending = new Map(); // "<kind>:<id>" -> { kind, id, source, title, detail, taskId, projectId, at }
  let waiting = 0; // what waits on the owner, from the last digest
  let badgeKey = null;
  let timer = null, timerAt = 0, lastLookAt = -Infinity, looking = null, again = false;
  let testWait = null; // { resolve, timer } while the test waits for the owner to look away
  const live = []; // notifications kept referenced until they close, so a click still finds them
  let closed = false;

  // ---- settings ----------------------------------------------------------------------------------
  async function load() {
    let saved = {};
    try { saved = (await readSettings()) ?? {}; } catch { saved = {}; }
    prefs = rules.normalizePrefs(saved.alerts);
    quietSaved = object(saved.remote) ? saved.remote.quiet ?? null : null;
    loaded = true;
    loadedAt = now();
    return saved;
  }
  /** Whether anything is worth doing: alerts not killed, not closed, and (once the choices are read) the master switch on. */
  const active = () => !closed && !killed() && (!loaded || prefs.on);
  const flagOn = (kind) => ({ need: prefs.need, perm: prefs.need, fail: prefs.fail, done: prefs.done }[kind] === true);

  // ---- the window: flash and count ----------------------------------------------------------------
  function flash(on) {
    const win = getWindow();
    try { if (win && typeof win.flashFrame === "function") win.flashFrame(on === true); } catch (error) { say(`[alerts] could not flash the taskbar (${why(error)})`); }
  }
  function applyBadge() {
    const n = rules.badgeFor(waiting, prefs, { killed: killed() });
    const win = getWindow();
    if (!win || platform !== "win32" || typeof win.setOverlayIcon !== "function") return;
    if (!n && badgeKey === null) return; // nothing drawn, nothing to clear
    const size = Number(scale()) >= 1.5 ? 32 : 16;
    const key = `${n}:${size}`;
    if (key === badgeKey) return;
    try {
      const overlay = n && icon && nativeImage ? icon.overlay(n, { size }) : null;
      const image = overlay ? nativeImage.createFromBuffer(overlay.png) : null;
      win.setOverlayIcon(image && !(typeof image.isEmpty === "function" && image.isEmpty()) ? image : null, overlay ? overlay.description : "");
      badgeKey = key;
    } catch (error) {
      say(`[alerts] could not set the taskbar count (${why(error)})`);
    }
  }

  // ---- showing one ----------------------------------------------------------------------------------
  const context = () => ({ now: now(), minuteOfDay: minute(), focused: isLooked() === true, killed: killed(), quiet: quietSaved, sent: memory.sent, recent: memory.recent, waiting });

  /**
   * What a click goes to: the first thing the notification told. When it told
   * several (a burst is one notification) `count` says how many, so the page can
   * open the Inbox instead of one task; a single thing carries no count.
   */
  function targetOf(notify, group) {
    const first = (group?.items ?? []).find((item) => String(item.id) === notify.open?.id) ?? null;
    const told = Number(notify.count) || 0;
    return { kind: notify.kind, id: notify.open?.id ?? null, taskId: first?.taskId ?? null, projectId: first?.projectId ?? null, ...(told > 1 ? { count: told } : {}) };
  }
  function open(target) {
    try { showWindow(); } catch (error) { say(`[alerts] could not bring Studio up (${why(error)})`); }
    flash(false);
    try { send(target); } catch (error) { say(`[alerts] could not say what was clicked (${why(error)})`); }
  }
  function forget(notification) {
    const at = live.indexOf(notification);
    if (at >= 0) live.splice(at, 1);
  }
  /** Makes the Windows notification and, when it was shown, flashes, remembers it and says so in the log. */
  function deliver(decision, group) {
    const notify = decision.notify;
    if (!supported()) return false;
    const target = targetOf(notify, group);
    try {
      const options = { title: notify.title, body: notify.body, silent: notify.silent === true };
      if (iconPath && nativeImage?.createFromPath) { const image = nativeImage.createFromPath(iconPath); if (image && !(typeof image.isEmpty === "function" && image.isEmpty())) options.icon = image; }
      const notification = new Notification(options);
      notification.on("click", () => open(target));
      notification.on("close", () => forget(notification));
      notification.on("failed", (_event, error) => say(`[alerts] Windows could not show it (${why(typeof error === "object" ? error : { code: String(error ?? "") })})`));
      live.push(notification);
      while (live.length > LIVE_MAX) live.shift();
      notification.show();
    } catch (error) {
      say(`[alerts] could not show a notification (${why(error)})`);
      return false;
    }
    memory = rules.remember(memory, notify, now());
    if (decision.flash) flash(true);
    say(`[alerts] told Windows: ${notify.kind} (${notify.count})`);
    return true;
  }

  // ---- looking ----------------------------------------------------------------------------------------
  function arm(delay) {
    const at = now() + delay;
    if (timer && timerAt <= at) return;
    if (timer) clearTimer(timer);
    timerAt = at;
    timer = setTimer(() => { timer = null; timerAt = 0; void look(); }, Math.max(0, delay));
    timer?.unref?.();
  }
  /** Asks for a look soon: never two inside `lookGapMs`, so a board that changes every second still costs one digest in ten. */
  function poke(delay = lookDelayMs) {
    if (!active()) return;
    // A look that is reading now may have read before this change: it looks once more when it is done.
    if (looking) { again = true; return; }
    arm(Math.max(delay, lastLookAt + lookGapMs - now(), 0));
  }
  function rearm() {
    if (!active()) return;
    const due = rules.settle([...pending.values()], now(), settleMs);
    arm(due.next != null ? Math.min(refreshMs, Math.max(1000, due.next + 50)) : refreshMs);
  }
  const stillWaiting = (item, digestNow) => {
    if (item.source === "question") return questionOpen(item.questionId ?? item.id, item) !== false;
    if (item.kind === "done" || !item.taskId || !digestNow) return true;
    if ((digestNow.items ?? []).some((row) => row.taskId === item.taskId)) return true;
    return count(digestNow.total) > (digestNow.items ?? []).length; // the digest lists a dozen: one more may be out of sight
  };
  async function flush(digestNow) {
    const { due } = rules.settle([...pending.values()], now(), settleMs);
    for (const item of due) pending.delete(keyOf(item));
    const relevant = due.filter((item) => stillWaiting(item, digestNow));
    for (const group of rules.groups(relevant)) {
      const decision = rules.decide({ kind: group.kind, items: group.items }, prefs, context());
      if (decision.notify) deliver(decision, group);
    }
  }
  function look() {
    if (looking) return looking;
    looking = (async () => {
      try {
        lastLookAt = now();
        // The settings file is read when something is about to be told (the quiet hours may have been changed from the Friends card) and every few minutes, not at every look.
        if (!loaded || pending.size || now() - loadedAt >= reloadMs) await load();
        if (!active()) { pending.clear(); applyBadge(); return; }
        const digestNow = await Promise.resolve(digest(now())).catch(() => null);
        if (digestNow && Number.isFinite(Number(digestNow.total))) waiting = count(digestNow.total);
        applyBadge();
        await flush(digestNow);
      } catch (error) {
        say(`[alerts] look failed (${why(error)})`);
      } finally {
        looking = null;
        if (again) { again = false; poke(); }
        rearm();
      }
    })();
    return looking;
  }

  // ---- the hooks (queue only) ---------------------------------------------------------------------------
  // A thing is waiting once per kind and source: two questions about one task are two waits, but one thing to tell (they share an id).
  const keyOf = (item) => `${item.kind}:${item.source}:${item.questionId ?? item.id}`;
  function enqueue(item) {
    if (!active() || (loaded && !flagOn(item.kind))) return false;
    const key = keyOf(item);
    if (pending.has(key)) return false;
    pending.set(key, { ...item, at: now() });
    while (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value);
    poke(settleMs);
    return true;
  }
  /** An assistant question was asked (or changed): the queue may hold a new thing for the owner. */
  function question(asked) {
    const kind = rules.kindOfQuestion(asked);
    if (!kind || asked?.id == null) { poke(); return false; }
    const context = object(asked.context) ? asked.context : {};
    const task = oneLine(context.taskTitle, 120);
    const taskId = context.taskId ? String(context.taskId) : null;
    // Told by its task when it has one: a parked task and the question asked about it are one thing to tell, and a click opens the task.
    return enqueue({
      kind, id: taskId ?? String(asked.id), questionId: String(asked.id), source: "question",
      title: task || oneLine(asked.title, 120), detail: task ? oneLine(asked.title, 160) : "",
      taskId, projectId: projectId(),
    });
  }
  /** The board moved: the events of the tasks the owner cares about and the cards that need the owner (task-oversight taskEvents). */
  function tasks(events, attention, forProject = null) {
    let queued = false;
    for (const event of [...(Array.isArray(events) ? events : []), ...(Array.isArray(attention) ? attention : [])]) {
      const kind = rules.kindOfTaskEvent(event?.kind);
      if (!kind || event?.taskId == null) continue;
      queued = enqueue({ kind, id: String(event.taskId), source: "task", title: oneLine(event.title, 120), detail: "", taskId: String(event.taskId), projectId: forProject ?? projectId() }) || queued;
    }
    poke();
    return queued;
  }

  // ---- the bridge -------------------------------------------------------------------------------------------
  async function state() {
    await load();
    return rules.view({ prefs, quiet: quietSaved, killed: killed(), supported: supported(), waiting, sent: memory.sent, now: now(), platform });
  }

  /** alerts:set: the choices (validated here, never trusted), and the quiet hours, which are the Discord remote's. */
  async function set(patch) {
    const input = object(patch) ? patch : {};
    let quietChanged = false;
    await updateSettings((saved) => {
      let changed = false;
      const next = rules.applyPatch(saved.alerts, input);
      if (JSON.stringify(rules.normalizePrefs(saved.alerts)) !== JSON.stringify(next)) { saved.alerts = next; changed = true; }
      if (input.quiet !== undefined) {
        // The quiet hours are the Discord remote's (settings.remote.quiet): one clock, two readers.
        const remote = object(saved.remote) ? saved.remote : {};
        const quiet = rules.quietPatch(remote.quiet, input.quiet);
        if (quiet !== undefined && JSON.stringify(quiet) !== JSON.stringify(rules.normalizeQuiet(remote.quiet))) {
          saved.remote = { ...remote, quiet };
          quietChanged = true;
          changed = true;
        }
      }
      if (!changed) return false;
    });
    await load();
    if (!active()) { pending.clear(); flash(false); cancelWait({ ok: true, sent: false, why: "Notifications were turned off." }); }
    applyBadge();
    if (active()) poke();
    if (quietChanged) { try { remotePush(); } catch { /* the Friends card catches up at its next read */ } }
    return state();
  }

  const decideTest = () => rules.decide({ kind: "test", items: [] }, prefs, context());
  function cancelWait(result) {
    if (!testWait) return;
    const wait = testWait;
    testWait = null;
    try { clearTimer(wait.timer); } catch { /* already fired */ }
    wait.resolve(result);
  }
  function sendTest() {
    const decision = decideTest();
    if (!decision.notify) return { ok: true, sent: false, why: decision.why };
    const shown = deliver(decision, { items: [] });
    return shown ? { ok: true, sent: true, why: "" } : { ok: false, sent: false, why: "Windows could not show it." };
  }
  /**
   * alerts:test. Sends the test notification; Studio being in front is the one
   * thing that holds it back, so then it waits for the owner to look away (up
   * to `testWaitMs`) and answers when it has sent it or stopped waiting.
   */
  async function test() {
    if (killed()) return { ok: false, killed: true, sent: false, why: rules.decide({ kind: "test", items: [] }, prefs, { killed: true }).why };
    cancelWait({ ok: true, sent: false, superseded: true, why: "Another test replaced this one." });
    await load();
    const decision = decideTest();
    if (decision.notify || !context().focused || !prefs.on) return sendTest();
    return new Promise((resolve) => {
      testWait = { resolve, timer: setTimer(() => cancelWait({ ok: true, sent: false, waited: true, why: "Studio stayed in front, so no test notification was sent." }), testWaitMs) };
      testWait.timer?.unref?.();
    });
  }

  // ---- the window's own events ------------------------------------------------------------------------------
  /** Studio came to the front: the flash has done its job. */
  function focus() { flash(false); }
  /** Studio lost the front, was hidden or minimized: a test that was waiting for that can go. */
  function away() {
    if (!testWait || context().focused) return;
    cancelWait(sendTest());
  }
  /** A new window: its taskbar button has no count yet. */
  function windowMade() { badgeKey = null; applyBadge(); }

  async function start() {
    await load();
    if (active()) poke(3000);
  }
  function close() {
    closed = true;
    if (timer) { try { clearTimer(timer); } catch { /* already fired */ } timer = null; }
    cancelWait({ ok: true, sent: false, why: "Studio is closing." });
    pending.clear();
  }

  return { start, close, state, set, test, question, tasks, poke, look, focus, away, windowMade };
}

module.exports = { createAlertsHost, LOOK_DELAY_MS, LOOK_GAP_MS, REFRESH_MS, TEST_WAIT_MS, RELOAD_MS };
