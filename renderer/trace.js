// Trace: Build's log viewer (Live › Trace). Studio's logs as channels — the
// studio log, the assistant's log, the run ledger, OpenCode's log and the
// window's own warnings — read through one set of controls: search, a tail,
// levels and sources to filter by, problems only, follow, newest first or
// last, copy and open the file. The host keeps and reads the channels
// (main.cjs trace:channels / trace:read, scripts/trace.cjs); this sheet asks
// again every two seconds while Follow is on and the sheet is in view. The
// studio log is also kept on disk (main.cjs "Log core"): Load older pages back
// through it, above the live tail, and pauses Follow so the pages stay put; a
// new channel or filter starts from the tail again.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`trace-${id}`);
  const api = () => window.mefiStudio;
  const FOLLOW_MS = 2000;
  const CHANNELS_MS = 10000;
  const LEVELS = [["all", "All"], ["error", "Errors"], ["warn", "Warnings"], ["info", "Info"]];
  const state = { channel: "studio", channels: [], tail: 250, text: "", problems: false, level: null, sources: [], newest: true, follow: true, result: null, timer: 0, reading: null, channelsAt: 0, signature: "", older: [], olderNext: null, olderDone: false, olderKey: "", loadingOlder: false };
  let initialized = false;
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const isOpen = () => Boolean($("overlay")) && !$("overlay").hidden;

  function size(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  function clock(at) {
    if (!Number.isFinite(Number(at)) || !at) return "";
    const date = new Date(Number(at));
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
  }

  // ---- reading ------------------------------------------------------------------------
  async function loadChannels() {
    if (!api()?.traceChannels) return;
    try {
      const result = await api().traceChannels();
      if (result?.ok && Array.isArray(result.channels)) { state.channels = result.channels; state.channelsAt = Date.now(); }
    } catch { /* the list keeps what it had */ }
    renderChannels();
  }
  async function read() {
    if (!api()?.traceRead) { status("Trace reads Studio's logs in the desktop app."); return; }
    // A channel or filter change mid-read reads once more afterwards: the
    // in-flight request carries the old settings and its result is dropped.
    if (state.reading) { state.again = true; return state.reading; }
    // The reset rides a chained finally, which always runs after this
    // assignment: an in-body finally ran first when traceRead threw before its
    // first await, and the settled promise then stood in for every read.
    resetOlderOnChange();
    state.reading = (async () => {
      try {
        const result = await api().traceRead(query());
        if (result?.channel && result.channel !== state.channel) return;
        state.result = result;
        render();
      } catch (error) {
        status(window.MefiUi?.plainError ? window.MefiUi.plainError(error, "The log could not be read.") : "The log could not be read.", "bad");
      }
    })().finally(() => {
      state.reading = null;
      if (state.again) { state.again = false; void read(); }
    });
    return state.reading;
  }
  function query(extra = {}) {
    return { channel: state.channel, tail: state.tail, text: state.text, problems: state.problems, level: state.level, sources: state.sources.length ? state.sources : null, ...extra };
  }
  // Older pages belong to one channel and one set of filters.
  function resetOlderOnChange() {
    const key = JSON.stringify([state.channel, state.tail, state.text, state.problems, state.level, state.sources]);
    if (key === state.olderKey) return;
    state.olderKey = key;
    state.older = [];
    state.olderNext = null;
    state.olderDone = false;
  }
  async function loadOlder() {
    if (state.loadingOlder || !api()?.traceRead) return;
    resetOlderOnChange();
    state.loadingOlder = true;
    // The pages would scroll away under a live re-read: Follow pauses.
    if (state.follow) { state.follow = false; $("follow").checked = false; schedule(); }
    const shown = [...state.older, ...(state.result?.rows || [])];
    const before = state.olderNext ?? (shown.length ? shown[0].at : Date.now());
    try {
      const result = await api().traceRead(query({ before }));
      if (result?.ok === false) { status(result.error || "Older lines could not be read.", "bad"); return; }
      state.older = [...(result?.rows || []), ...state.older];
      state.olderNext = result?.next ?? null;
      state.olderDone = result?.done !== false || !result?.next;
      state.signature = "";
      render();
    } catch (error) {
      status(window.MefiUi?.plainError ? window.MefiUi.plainError(error, "Older lines could not be read.") : "Older lines could not be read.", "bad");
    } finally {
      state.loadingOlder = false;
    }
  }
  function schedule() {
    clearTimeout(state.timer);
    state.timer = 0;
    if (!state.follow || !isOpen() || document.hidden) return;
    state.timer = setTimeout(async () => {
      state.timer = 0;
      await read();
      if (Date.now() - state.channelsAt > CHANNELS_MS) await loadChannels();
      schedule();
    }, FOLLOW_MS);
  }
  function status(text, tone = "") { $("status").textContent = text; $("status").dataset.tone = tone; }

  // ---- painting -------------------------------------------------------------------------
  function renderChannels() {
    const list = $("channel-list");
    // The list refreshes every few seconds; keep the keyboard on its channel.
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    list.replaceChildren();
    for (const channel of state.channels) {
      const item = el("li");
      const button = el("button", "trace-channel");
      button.type = "button";
      button.dataset.area = channel.area || "main";
      button.dataset.id = channel.id;
      if (channel.id === state.channel) button.setAttribute("aria-current", "true");
      button.title = channel.detail || channel.label;
      button.append(el("span", "trace-channel-name", channel.label), el("span", "trace-channel-size", channel.error ? "unreadable" : size(channel.size)));
      if (channel.errors) button.append(el("span", "trace-channel-badge is-error", String(channel.errors)));
      else if (channel.problems) button.append(el("span", "trace-channel-badge", String(channel.problems)));
      button.addEventListener("click", () => choose(channel.id));
      item.append(button);
      list.append(item);
    }
    // One mark sits behind the open channel and springs to the next one
    // (renderer/motion.js); the list is rebuilt, so the mark lives beside it.
    if (focused) [...list.querySelectorAll(".trace-channel")].find((item) => item.dataset.id === focused)?.focus({ preventScroll: true });
    const box = list.parentElement;
    let mark = box?.querySelector?.(".trace-channel-mark");
    if (box && !mark) { mark = el("span", "trace-channel-mark"); mark.setAttribute("aria-hidden", "true"); box.append(mark); }
    window.MefiMotion?.glide?.(mark, list.querySelector?.('.trace-channel[aria-current="true"]'));
    const current = state.channels.find((channel) => channel.id === state.channel);
    $("channel-detail").textContent = current?.error ? `${current.detail} It could not be read: ${current.error}` : current?.detail || "";
  }
  function chip(label, on, run, tone = "", key = label) {
    const button = el("button", `chip${on ? " on" : ""}${tone ? ` trace-chip-${tone}` : ""}`, label);
    button.type = "button";
    button.dataset.key = key;
    button.setAttribute("aria-pressed", String(on));
    button.addEventListener("click", run);
    return button;
  }
  // Follow re-reads every two seconds: the same chips update in place, so a
  // focused chip keeps focus and only a new set of sources rebuilds the row.
  function syncChips(host, chips) {
    const current = [...host.children];
    if (current.length !== chips.length || current.some((item, index) => item.dataset.key !== chips[index].dataset.key)) { host.replaceChildren(...chips); return; }
    current.forEach((item, index) => {
      item.textContent = chips[index].textContent;
      item.className = chips[index].className;
      item.setAttribute("aria-pressed", chips[index].getAttribute("aria-pressed"));
    });
  }
  function writeFailureNote(result) {
    const failures = (result.logWriteFailures || []).filter((row) => ["executor", "work-events"].includes(row.channel) && Number.isSafeInteger(row.count) && row.count > 0);
    return failures.length ? "History write failures this session: " + failures.map((row) => row.channel + " " + row.count + " (last " + clock(row.lastFailureAt) + ")").join("; ") : "";
  }
  function render() {
    const result = state.result;
    if (!result) return;
    if (result.ok === false) { status([result.error || "The log could not be read.", writeFailureNote(result)].filter(Boolean).join(" · "), "bad"); $("lines").replaceChildren(); return; }
    const counts = result.counts || { error: 0, warn: 0, info: 0 };
    const levels = $("levels");
    syncChips(levels, LEVELS.map(([key, label]) => {
      const count = key === "all" ? result.total || 0 : counts[key] || 0;
      return chip(`${label} ${count}`, key === "all" ? !state.level : state.level === key, () => { state.level = key === "all" || state.level === key ? null : key; void read(); }, key, key);
    }));
    const sources = $("sources");
    syncChips(sources, (result.sources || []).map(([name, count]) => chip(`${name} ${count}`, state.sources.includes(name), () => {
      state.sources = state.sources.includes(name) ? state.sources.filter((item) => item !== name) : [...state.sources, name];
      void read();
    }, "", name)));
    $("file").hidden = !result.file;
    $("older").hidden = !result.older || state.olderDone;
    const shown = [...state.older, ...(result.rows || [])];
    status(result.total ? `${(result.rows || []).length} of ${result.matched} matching line${result.matched === 1 ? "" : "s"} (${result.total} in this channel${result.dropped ? `, ${result.dropped} older lines rotated out` : ""})${state.older.length ? `, and ${state.older.length} older from the log on disk${state.olderDone ? " (the start of the log)" : ""}` : ""}` : "");
    const failureNote = writeFailureNote(result);
    if (failureNote) status([$("status").textContent, failureNote].filter(Boolean).join(" · "), "bad");
    const signature = JSON.stringify([state.channel, state.newest, shown.length, shown[0]?.at, shown[0]?.text, shown.at(-1)?.at, shown.at(-1)?.text, state.older.length]);
    if (signature === state.signature) return;
    state.signature = signature;
    const lines = $("lines");
    const pinned = state.newest ? lines.scrollTop < 40 : lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 40;
    const rows = state.newest ? [...shown].reverse() : shown;
    lines.replaceChildren(...rows.map((row) => {
      const item = el("li", `trace-line is-${row.level}`);
      item.append(el("time", "trace-time", clock(row.at)), el("span", "trace-level", row.level === "warn" ? "warn" : row.level), el("span", "trace-source", row.source), el("span", "trace-text", row.text));
      return item;
    }));
    // An empty channel says so where the lines would be, not only above them.
    if (!rows.length) lines.append(el("li", "trace-empty", result.total ? "No lines match these filters." : "Nothing logged here yet."));
    if (pinned) lines.scrollTop = state.newest ? 0 : lines.scrollHeight;
    // Another channel's log arrives with a short rise; a tail that grows
    // does not.
    if (state.painted !== state.channel) { state.painted = state.channel; window.MefiMotion?.enter?.(lines); }
  }
  function choose(id) {
    if (id === state.channel) return;
    state.channel = id;
    state.sources = [];
    state.level = null;
    state.result = null;
    state.signature = "";
    $("lines").replaceChildren();
    status("Reading…");
    renderChannels();
    void read();
  }

  // ---- the sheet ------------------------------------------------------------------------
  function open(params = {}) {
    init();
    if (typeof params?.channel === "string" && params.channel) { state.channel = params.channel; state.sources = []; state.level = null; }
    window.MefiNav?.claim?.("trace");
    $("overlay").hidden = false;
    state.signature = "";
    void loadChannels();
    void read().then(schedule);
    requestAnimationFrame(() => $("search")?.focus?.({ preventScroll: true }));
  }
  function close() {
    clearTimeout(state.timer);
    state.timer = 0;
    if (!isOpen()) return;
    $("overlay").hidden = true;
    window.MefiNav?.release?.("trace");
  }
  function init() {
    if (initialized || !$("overlay")) return;
    initialized = true;
    $("close").addEventListener("click", () => window.MefiNav?.close?.("trace") ?? close());
    $("refresh").addEventListener("click", () => { void loadChannels(); void read(); });
    let typing = 0;
    $("search").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => { state.text = $("search").value; void read(); }, 200); });
    $("tail").addEventListener("change", () => { state.tail = Number($("tail").value) || 250; void read(); });
    $("problems").addEventListener("change", () => { state.problems = $("problems").checked; void read(); });
    $("follow").addEventListener("change", () => { state.follow = $("follow").checked; schedule(); });
    $("order").addEventListener("click", () => { state.newest = !state.newest; $("order").textContent = state.newest ? "Newest first" : "Oldest first"; state.signature = ""; render(); });
    $("copy").addEventListener("click", async () => {
      const text = [...state.older, ...(state.result?.rows || [])].map((row) => `${clock(row.at)} ${row.level.toUpperCase()} [${row.source}] ${row.text}`).join("\n");
      const done = await api()?.shellCopy?.(text);
      window.MefiToast?.(done?.ok === false ? "The lines could not be copied." : "Copied the lines shown.", done?.ok === false ? "bad" : "good");
    });
    $("file").addEventListener("click", () => { if (state.result?.file) void api()?.shellReveal?.(state.result.file); });
    $("older").addEventListener("click", () => { void loadOlder(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && isOpen()) { void read(); schedule(); } });
  }

  window.MefiTrace = { open, close, isOpen, read, loadOlder, state: () => ({ older: state.older.length, olderDone: state.olderDone,  channel: state.channel, tail: state.tail, text: state.text, problems: state.problems, level: state.level, sources: [...state.sources], follow: state.follow, newest: state.newest }) };
  // nav.js holds Trace's record (Live, beside Activity) and calls open/close.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
