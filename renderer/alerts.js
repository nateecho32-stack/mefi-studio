// Notifications: Settings › General › Notifications, and the click that comes back.
//
// Studio tells Windows when something waits on you, and only while Studio is not
// the window you are looking at: a question, an approval, a permission, a task
// that failed after Mefi stopped retrying, and (when you ask) one that finished.
// It never sends one inside quiet hours (the Discord remote's own: change them
// here or in Friends and both follow), no more than twelve an hour, and in
// generic words unless you chose task titles, because Windows keeps
// notification text in its history. The taskbar button can flash and carry a
// count of what waits on you. The test button sends one on purpose and, because
// nothing is ever sent to the window you are looking at, waits for you to look
// away. Everything it says and decides comes from the host (main.cjs
// "Notifications", scripts/alerts.cjs): this file draws the choices and saves
// them, and opens what a clicked notification was about (alerts:open). The
// switch at the top and MEFI_STUDIO_NO_ALERTS=1 turn it all off.
(function () {
  "use strict";
  const api = () => window.mefiStudio;
  const $ = (id) => document.getElementById(id);
  const SWITCHES = ["on", "need", "fail", "done", "flash", "badge", "sound"];
  const state = { view: null, loading: false, again: false, testing: false };
  // The words of the two kinds of notification, as the card shows them.
  const SAMPLE = {
    generic: ["Something needs you", "A task is waiting for your answer."],
    titles: ["Something needs you", "Search notes by tag: Should #Work and #work count as the same tag?"],
  };
  const NOTES = {
    generic: "Windows keeps notification text in its history and can show it on the lock screen, so Studio says only that something needs you.",
    titles: "The notification names the task and the question. Anyone who can see your screen or your notification history can read it.",
  };
  const clock12 = (hhmm) => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm));
    return match ? `${Number(match[1]) % 12 || 12}:${match[2]} ${Number(match[1]) < 12 ? "AM" : "PM"}` : String(hhmm);
  };
  const say = (text, bad = false) => { const line = $("alerts-status"); if (line) { line.textContent = text; line.classList.toggle("bad-text", bad); } };
  const note = (text) => { const node = $("alerts-note"); if (node) { node.hidden = !text; node.textContent = text || ""; } };
  const reason = (error) => String(error?.message ?? error ?? "").slice(0, 160);

  // ---- reading and drawing the choices ---------------------------------------------------------
  async function load() {
    if (typeof api()?.alertsGet !== "function") return null;
    if (state.loading) { state.again = true; return null; }
    state.loading = true;
    try {
      const view = await api().alertsGet();
      if (!view?.ok) { state.view = null; note(view?.error || "Notifications are not available in this build."); return null; }
      state.view = view;
      paint();
      return view;
    } catch (error) {
      note(`Notifications could not be read: ${reason(error)}`);
      return null;
    } finally {
      state.loading = false;
      if (state.again) { state.again = false; void load(); }
    }
  }

  // A select that holds hours on the hour shows a saved half hour too, rather than a wrong one.
  function setHour(select, value) {
    if (!select) return;
    if (![...select.querySelectorAll("option")].some((option) => option.value === value)) {
      const extra = document.createElement("option");
      extra.value = value;
      extra.textContent = clock12(value);
      select.append(extra);
    }
    select.value = value;
  }

  function paint() {
    const view = state.view;
    if (!view) return;
    const off = view.killed === true;
    for (const key of SWITCHES) {
      const box = $(`alerts-${key}`);
      if (!box) continue;
      box.checked = view.prefs?.[key] === true;
      box.disabled = off;
    }
    $("alerts-rows")?.classList.toggle("is-dim", view.prefs?.on !== true);
    const quiet = $("alerts-quiet");
    if (quiet) { quiet.checked = view.quiet?.on === true; quiet.disabled = off; }
    const times = $("alerts-quiet-times");
    if (times) times.hidden = view.quiet?.on !== true;
    setHour($("alerts-quiet-from"), view.quiet?.from ?? "22:00");
    setHour($("alerts-quiet-to"), view.quiet?.to ?? "07:00");
    for (const id of ["alerts-quiet-from", "alerts-quiet-to"]) { const select = $(id); if (select) select.disabled = off; }
    const words = view.prefs?.titles === "titles" ? "titles" : "generic";
    for (const button of $("alerts-titles")?.querySelectorAll("button") ?? []) { button.setAttribute("aria-pressed", String(button.dataset.value === words)); button.disabled = off; }
    const titles = $("alerts-titles-note");
    if (titles) titles.textContent = NOTES[words];
    const sample = $("alerts-sample-title");
    if (sample) sample.textContent = SAMPLE[words][0];
    const body = $("alerts-sample-body");
    if (body) body.textContent = SAMPLE[words][1];
    const test = $("alerts-test");
    if (test) test.disabled = off || state.testing;
    note(off ? "Turned off for this session by MEFI_STUDIO_NO_ALERTS." : view.supported === false ? "Windows notifications are not available on this PC." : "");
  }

  // ---- changing them -------------------------------------------------------------------------------
  async function change(patch) {
    if (typeof api()?.alertsSet !== "function") return null;
    try {
      const result = await api().alertsSet(patch);
      if (result?.ok === false) { say(result.error || "That did not change.", true); await load(); return null; }
      state.view = result;
      paint();
      say("");
      return result;
    } catch (error) {
      say(`That did not change: ${reason(error)}`, true);
      await load();
      return null;
    }
  }

  // ---- the test --------------------------------------------------------------------------------------
  async function test() {
    if (state.testing || typeof api()?.alertsTest !== "function") return null;
    state.testing = true;
    const button = $("alerts-test");
    if (button) button.disabled = true;
    say("Sending… If Studio is in front, switch to another window: the test arrives as you do (Studio waits up to a minute).");
    try {
      const result = await api().alertsTest();
      if (result?.sent) say("Sent. If it did not appear, Windows may be holding notifications back (Focus assist or Do not disturb).");
      else if (result?.superseded) say("");
      else say(result?.why || result?.error || "The test was not sent.", result?.ok === false);
      return result;
    } catch (error) {
      say(`The test was not sent: ${reason(error)}`, true);
      return null;
    } finally {
      state.testing = false;
      if (button) button.disabled = state.view?.killed === true;
    }
  }

  // ---- the click on a notification (main has already brought Studio up) ---------------------------
  /** Opens what a clicked notification was about: its task, else Home, where what needs you is shown. The test just leaves Studio in front. */
  function openTarget(payload) {
    if (String(payload?.kind ?? "") === "test") return true;
    const nav = window.MefiNav;
    if (payload?.taskId && typeof nav?.go === "function") {
      nav.go("tasks", { taskId: String(payload.taskId), ...(payload.projectId ? { projectId: String(payload.projectId) } : {}), filter: "all" });
      return true;
    }
    if (window.MefiVibe?.landing?.() === "vibe" && typeof window.MefiVibe.enter === "function") { window.MefiVibe.enter(); return true; }
    if (typeof window.MefiWorkspace?.enter === "function") { window.MefiWorkspace.enter(); return true; }
    return false;
  }

  function init() {
    const card = $("settings-notifications");
    if (typeof api()?.alertsGet !== "function") { if (card) card.hidden = true; return; }
    for (const key of SWITCHES) $(`alerts-${key}`)?.addEventListener("change", (event) => { void change({ [key]: event.target.checked === true }); });
    $("alerts-quiet")?.addEventListener("change", (event) => { void change({ quiet: { on: event.target.checked === true } }); });
    for (const id of ["alerts-quiet-from", "alerts-quiet-to"]) {
      $(id)?.addEventListener("change", () => { void change({ quiet: { on: true, from: $("alerts-quiet-from")?.value, to: $("alerts-quiet-to")?.value } }); });
    }
    for (const button of $("alerts-titles")?.querySelectorAll("button") ?? []) button.addEventListener("click", () => { void change({ titles: button.dataset.value }); });
    $("alerts-test")?.addEventListener("click", () => { void test(); });
    // Read when the card is opened, not at launch.
    card?.addEventListener("toggle", () => { if (card.open) void load(); });
    if (card?.open) void load();
    // The quiet hours are the Discord remote's: a change made in Friends shows here without reopening the card.
    api().onRemoteEvent?.((status) => {
      if (!state.view || !status?.settings || !("quiet" in status.settings)) return;
      const quiet = status.settings.quiet;
      const next = quiet ? { on: true, from: quiet.from, to: quiet.to } : { ...state.view.quiet, on: false };
      if (JSON.stringify(next) === JSON.stringify(state.view.quiet)) return;
      state.view = { ...state.view, quiet: next };
      paint();
    });
    api().onAlertsOpen?.((payload) => { try { openTarget(payload); } catch { /* a click that goes nowhere is not an error */ } });
  }

  window.MefiAlerts = { load, change, test, openTarget, state };
  init();
})();
