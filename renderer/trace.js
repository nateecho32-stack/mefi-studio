// Trace: Build's log viewer (Live › Trace). Studio's logs as channels — the
// studio log, the assistant's log, the run ledger, OpenCode's log and the
// window's own warnings — read through one set of controls: search, a tail,
// levels and sources to filter by, problems only, follow, newest first or
// last, copy and open the file. The host keeps and reads the channels
// (main.cjs trace:channels / trace:read, scripts/trace.cjs); this sheet asks
// again every two seconds while Follow is on and the sheet is in view.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`trace-${id}`);
  const api = () => window.mefiStudio;
  const FOLLOW_MS = 2000;
  const CHANNELS_MS = 10000;
  const LEVELS = [["all", "All"], ["error", "Errors"], ["warn", "Warnings"], ["info", "Info"]];
  const state = { channel: "studio", channels: [], tail: 250, text: "", problems: false, level: null, sources: [], newest: true, follow: true, result: null, timer: 0, reading: null, channelsAt: 0, signature: "" };
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
    if (state.reading) return state.reading;
    state.reading = (async () => {
      try {
        const result = await api().traceRead({ channel: state.channel, tail: state.tail, text: state.text, problems: state.problems, level: state.level, sources: state.sources.length ? state.sources : null });
        if (result?.channel && result.channel !== state.channel) return;
        state.result = result;
        render();
      } catch (error) {
        status(error?.message || "The log could not be read.", "bad");
      } finally { state.reading = null; }
    })();
    return state.reading;
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
    list.replaceChildren();
    for (const channel of state.channels) {
      const item = el("li");
      const button = el("button", "trace-channel");
      button.type = "button";
      button.dataset.area = channel.area || "main";
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
    const box = list.parentElement;
    let mark = box?.querySelector?.(".trace-channel-mark");
    if (box && !mark) { mark = el("span", "trace-channel-mark"); mark.setAttribute("aria-hidden", "true"); box.append(mark); }
    window.MefiMotion?.glide?.(mark, list.querySelector?.('.trace-channel[aria-current="true"]'));
    const current = state.channels.find((channel) => channel.id === state.channel);
    $("channel-detail").textContent = current?.error ? `${current.detail} It could not be read: ${current.error}` : current?.detail || "";
  }
  function chip(label, on, run, tone = "") {
    const button = el("button", `chip${on ? " on" : ""}${tone ? ` trace-chip-${tone}` : ""}`, label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(on));
    button.addEventListener("click", run);
    return button;
  }
  function render() {
    const result = state.result;
    if (!result) return;
    if (result.ok === false) { status(result.error || "The log could not be read.", "bad"); $("lines").replaceChildren(); return; }
    const counts = result.counts || { error: 0, warn: 0, info: 0 };
    const levels = $("levels");
    levels.replaceChildren(...LEVELS.map(([key, label]) => {
      const count = key === "all" ? result.total : counts[key] || 0;
      return chip(`${label} ${count}`, key === "all" ? !state.level : state.level === key, () => { state.level = key === "all" || state.level === key ? null : key; void read(); }, key);
    }));
    const sources = $("sources");
    sources.replaceChildren(...(result.sources || []).map(([name, count]) => chip(`${name} ${count}`, state.sources.includes(name), () => {
      state.sources = state.sources.includes(name) ? state.sources.filter((item) => item !== name) : [...state.sources, name];
      void read();
    })));
    $("file").hidden = !result.file;
    const shown = result.rows || [];
    status(result.total ? `${shown.length} of ${result.matched} matching line${result.matched === 1 ? "" : "s"} (${result.total} in this channel${result.dropped ? `, ${result.dropped} older lines rotated out` : ""})` : "Nothing logged here yet.");
    const signature = JSON.stringify([state.channel, state.newest, shown.length, shown[0]?.at, shown[0]?.text, shown.at(-1)?.at, shown.at(-1)?.text]);
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
      const text = (state.result?.rows || []).map((row) => `${clock(row.at)} ${row.level.toUpperCase()} [${row.source}] ${row.text}`).join("\n");
      const done = await api()?.shellCopy?.(text);
      window.MefiToast?.(done?.ok === false ? "The lines could not be copied." : "Copied the lines shown.", done?.ok === false ? "bad" : "good");
    });
    $("file").addEventListener("click", () => { if (state.result?.file) void api()?.shellReveal?.(state.result.file); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && isOpen()) { void read(); schedule(); } });
  }

  window.MefiTrace = { open, close, isOpen, read, state: () => ({ channel: state.channel, tail: state.tail, text: state.text, problems: state.problems, level: state.level, sources: [...state.sources], follow: state.follow, newest: state.newest }) };
  // nav.js holds Trace's record (Live, beside Activity) and calls open/close.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
