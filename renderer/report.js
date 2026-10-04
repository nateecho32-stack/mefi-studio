// Report a problem, and the prompt after a crash (Settings › System › Diagnostics).
//
// Studio builds a small report on this PC: a manifest, a one-line-per-task
// summary, the tail of its log, what the builders said and, when Studio
// closed unexpectedly, what it wrote down then. The owner reads every file
// here, can swap task titles for numbers, and only then saves it as a zip
// (the host asks where, because Documents may live in OneDrive, and shows the
// file in the file manager). Nothing is uploaded or sent: the owner attaches
// the file to a message themselves. What a report never holds is listed beside
// it. After a crash or a hang the next start shows one toast, "Studio closed
// unexpectedly", with Review the report and Dismiss; the host says it once per
// crash and MEFI_STUDIO_NO_CRASH_PROMPT=1 or the switch below silences it.
// Everything comes from main.cjs's "Report a problem" block
// (scripts/crash-report.cjs); this file draws it.
(function () {
  "use strict";
  const DISCORD_URL = "https://discord.gg/xgfKc5pVxG";
  const REPORT_SECTION = "settings-report";
  const api = () => window.mefiStudio;
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const state = { view: null, selected: "manifest.json", busy: false, loading: false, again: false };
  // What a crash row's kind means to a person.
  const WORDS = {
    "renderer-gone": "Studio's window crashed",
    "renderer-unresponsive": "Studio's window stopped responding",
    "main-exception": "Studio hit an internal error",
    "gpu-gone": "the graphics process was lost",
    "no-clean-exit": "Studio closed without saying goodbye",
    "update-rolled-back": "an update did not start and Studio went back",
  };
  const sentence = (kind) => { const text = WORDS[kind] ?? "Studio closed unexpectedly"; return `${text[0].toUpperCase()}${text.slice(1)}`; };
  const kb = (bytes) => `${bytes < 1024 ? Math.max(1, Math.round(bytes / 102.4) / 10) : Math.round(bytes / 1024)} KB`;
  const when = (at) => { try { return new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  const say = (text, bad = false) => { const line = $("report-status"); if (line) { line.textContent = text; line.classList.toggle("bad-text", bad); } };

  // ---- the options the two switches make ------------------------------------------------
  const options = () => ({ replaceTitles: $("report-replace")?.checked === true, includeCrash: $("report-crash-on")?.checked !== false });

  // ---- reading the report ----------------------------------------------------------------
  async function load() {
    if (typeof api()?.reportPreview !== "function") return null;
    if (state.loading) { state.again = true; return null; }
    state.loading = true;
    say("Building the report…");
    try {
      const view = await api().reportPreview(options());
      if (!view?.ok) { say(view?.error || "The report could not be built.", true); return null; }
      state.view = view;
      if (!view.files.some((file) => file.name === state.selected)) state.selected = view.files[0]?.name ?? "manifest.json";
      paint();
      say("");
      return view;
    } catch (error) {
      say(`The report could not be built: ${String(error?.message ?? error)}`, true);
      return null;
    } finally {
      state.loading = false;
      if (state.again) { state.again = false; void load(); }
    }
  }

  function paint() {
    const view = state.view;
    if (!view) return;
    const list = $("report-files");
    list.replaceChildren();
    for (const file of view.files) {
      const row = el("div", `report-file${file.name === state.selected ? " is-selected" : ""}`);
      row.setAttribute("role", "listitem");
      const words = el("div", "report-file-words");
      words.append(el("b", "report-file-name", file.name), el("small", "", `${file.about}${file.truncated ? " (older lines left out to keep it small)" : ""}`));
      const size = el("span", "report-file-size", kb(file.bytes));
      const show = el("button", "ghost mini", file.name === state.selected ? "Viewing" : "Preview");
      show.type = "button";
      show.disabled = file.name === state.selected;
      show.setAttribute("aria-label", `Preview ${file.name}`);
      show.addEventListener("click", () => { state.selected = file.name; paint(); });
      row.append(words, size, show);
      list.append(row);
    }
    $("report-total").textContent = `${view.files.length} files, ${kb(view.total)} in all. ${view.replaceTitles ? "Task titles are numbers." : "Task titles are as you wrote them."}`;
    const shown = view.files.find((file) => file.name === state.selected) ?? view.files[0];
    $("report-preview-name").textContent = shown?.name ?? "";
    $("report-pre").textContent = shown?.text ?? "";
    // The crash record: a switch only while there is one, and a line saying when.
    const crashSwitch = $("report-crash-switch");
    if (crashSwitch) {
      crashSwitch.hidden = !view.crash;
      $("report-crash-label").textContent = view.crash ? `Include the crash record · from ${when(view.crash.at)}` : "Include the crash record";
    }
    const crash = $("report-crash");
    if (crash) {
      crash.hidden = !view.crash;
      crash.textContent = view.crash ? `${sentence(view.crash.kind)} on ${when(view.crash.at)}. Studio wrote a small record; it is in this report unless you switch it off.` : "";
    }
    const prompt = $("report-prompt");
    if (prompt) { prompt.checked = view.prompt !== false; prompt.disabled = view.killed === true; }
    const note = $("report-prompt-note");
    if (note) { note.hidden = view.killed !== true; note.textContent = view.killed ? "Turned off for this session by MEFI_STUDIO_NO_CRASH_PROMPT." : ""; }
    const never = $("report-never");
    never.replaceChildren(...view.never.map((item) => { const row = el("li", "report-never-row"); row.append(el("b", "", item.name), el("small", "", ` ${item.why}`)); return row; }));
    $("report-save").disabled = state.busy;
  }

  // ---- saving it ------------------------------------------------------------------------------
  async function save() {
    const view = state.view;
    if (!view || state.busy) return;
    state.busy = true;
    $("report-save").disabled = true;
    say("Choose where to save it…");
    try {
      const result = await api().reportSave({ token: view.token });
      if (result?.ok) {
        const name = String(result.path ?? "").split(/[\\/]/).pop();
        say(`Saved ${name} (${kb(result.bytes)}) and showed it in your file manager. Nothing was uploaded.`);
        window.MefiToast?.(`Saved ${name}. Nothing was uploaded: attach it to a message yourself.`, "good");
      } else if (result?.canceled) say("Not saved.");
      else if (result?.stale) { say("That report is no longer held. Studio is building a fresh one: read it, then save again.", true); void load(); }
      else say(result?.error || "The report was not saved.", true);
    } catch (error) {
      say(`The report was not saved: ${String(error?.message ?? error)}`, true);
    } finally {
      state.busy = false;
      const button = $("report-save");
      if (button) button.disabled = !state.view;
    }
  }

  // ---- the prompt after a crash -------------------------------------------------------------------
  function openCard() {
    window.MefiNav?.go?.("studio", { section: REPORT_SECTION });
    setTimeout(() => { void load(); }, 0);
  }
  // The startup gate (#boot-layer) hides the page and sits above every toast, so
  // a toast made while it is up is neither seen nor clickable, and the host has
  // already said its once. The prompt waits for a visible window (one parked in
  // the tray at sign-in has nobody to tell yet) and for the gate; the wait after
  // the gate is a slow poll of one cheap read that stops. A launch that never
  // leaves the gate says nothing: the card in Settings still has the record.
  function whenVisible(run) {
    if (!document.hidden) { run(); return; }
    const wake = () => { if (document.hidden) return; document.removeEventListener("visibilitychange", wake); run(); };
    document.addEventListener("visibilitychange", wake);
  }
  const BOOT_POLL_MS = 1500;
  const BOOT_POLL_TRIES = 400;
  function booting() {
    const gate = $("boot-layer");
    if (!gate || gate.hidden) return false;
    if (typeof getComputedStyle !== "function") return true;
    try { return getComputedStyle(gate).display !== "none"; } catch { return true; }
  }
  function whenBooted(run, tries = 0) {
    if (!booting()) { run(); return; }
    if (tries < BOOT_POLL_TRIES) setTimeout(() => whenBooted(run, tries + 1), BOOT_POLL_MS);
  }
  /**
   * The host says the last session did not close: one toast, and either button
   * clears it. It is one short line because the toast lays its text beside two
   * buttons in 380 px; what happened and when is in the card it opens.
   */
  function crashed() {
    if (typeof window.MefiToast !== "function") return false;
    const clear = () => { void Promise.resolve(api()?.reportDismiss?.()).catch(() => {}); };
    window.MefiToast("Studio closed unexpectedly.", "warn", {
      duration: 30000,
      action: { label: "Review the report", run: () => { clear(); openCard(); } },
      secondary: { label: "Dismiss", run: clear },
    });
    return true;
  }

  function init() {
    const block = $(REPORT_SECTION);
    if (typeof api()?.reportPreview !== "function") { if (block) block.hidden = true; return; }
    $("report-save")?.addEventListener("click", () => { void save(); });
    $("report-refresh")?.addEventListener("click", () => { void load(); });
    $("report-replace")?.addEventListener("change", () => { void load(); });
    $("report-crash-on")?.addEventListener("change", () => { void load(); });
    $("report-prompt")?.addEventListener("change", async (event) => {
      const on = event.target.checked === true;
      const result = await Promise.resolve(api().reportSet?.({ prompt: on })).catch(() => null);
      say(result?.ok === false ? result.error || "That did not change." : on ? "Studio will say so after a crash or a hang." : "Studio will not say anything after a crash or a hang. The record is still kept.", result?.ok === false);
    });
    $("report-discord")?.addEventListener("click", () => {
      const opened = api()?.openExternal?.(DISCORD_URL);
      if (!opened) window.open?.(DISCORD_URL, "_blank", "noopener");
    });
    // The report is built when the card is opened, not at launch.
    const card = $("settings-diagnostics");
    card?.addEventListener("toggle", () => { if (card.open && !state.view) void load(); });
    if (card?.open) void load();
    api().onReportCrashed?.(() => whenVisible(() => whenBooted(crashed)));
    window.MefiNav?.register?.({
      id: "settings:report", label: "Settings › System › Report a problem", short: "Report a problem", kind: "action", layer: null, section: "settings", group: "system",
      glyph: "g-gauge", badge: null, desc: "Build a report you can read before you save it. Nothing is uploaded",
      searchTerms: "report a problem bug crash closed unexpectedly diagnostics zip support save log",
      showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
      run: openCard,
    });
  }

  window.MefiReport = { load, save, crashed, state, options };
  init();
})();
