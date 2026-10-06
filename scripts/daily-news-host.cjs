"use strict";
// The Studio Daily's host side: fetches the news wires once a local day,
// keeps the edition as JSON under `dir`, and hands it to the launch screen
// (main.cjs "news:edition", renderer/daily-paper.js). Every dependency is
// injected, so tests/daily_news.test.mjs drives it with a fake clock and a
// fake fetch. Rules:
//   - enabled() false (Settings › General "Daily news on the launch screen"
//     off): no network at all, and edition() answers { ok: false, disabled }.
//   - one build per local calendar day; refresh asks for another. Concurrent
//     callers share one build. Every wire is fetched in parallel with its own
//     timeout and size cap, and a wire that fails never fails the paper.
//   - offline with an older paper on disk: that paper, marked stale. Offline
//     with none: an empty paper (lead null) carrying Studio's own items.
//   - edit(system, user, { timeoutMs }), when given, may improve the paper
//     after it is printed (scripts/daily-news.cjs applyEditor); the edited
//     paper is saved and pushed through onChange, never waited for. The
//     editor is given up on after editTimeoutMs, and told so, so a model
//     call behind it can stop then too.
//   - start() checks at least hourly and refreshes once a day after 06:00 on
//     the local clock while Studio runs; stop() ends that.
const path = require("node:path");
const news = require("./daily-news.cjs");

const MB = 1024 * 1024;
const HOUR = 3600000;
const MORNING_HOUR = 6;

function createDailyNews({
  fetch: fetchImpl = globalThis.fetch,
  readFile, writeFile, mkdir, dir,
  now = Date.now,
  log = () => {},
  version = "0",
  enabled = () => true,
  edit = null,
  extraItems = null,
  sources = news.DEFAULT_SOURCES,
  timeoutMs = 8000,
  maxBytes = MB,
  editTimeoutMs = 60000,
  retryMs = 15 * 60000,
  refreshFloorMs = 60000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const file = dir ? path.join(dir, "edition.json") : null;
  const listeners = new Set();
  let current = null;
  let loading = null;
  let building = null;
  let builtAt = 0;
  let failedAt = 0;
  let timer = null;
  let running = false;

  const say = (line) => { try { log(`[news] ${line}`); } catch {} };
  async function isEnabled() {
    try { return (await enabled()) !== false; } catch { return false; }
  }
  // A timer the fetch cannot outlive: the signal aborts it, and the race
  // settles even when a fetch ignores its signal.
  function deadline(ms, onExpire) {
    let handle = null;
    const promise = new Promise((_, reject) => {
      handle = setTimer(() => { onExpire?.(); reject(new Error("timed out")); }, ms);
    });
    promise.catch(() => {});
    return { promise, cancel: () => clearTimer(handle) };
  }
  async function readCapped(response, limit) {
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > limit) throw new Error("response too large");
    const body = response.body;
    if (body && typeof body.getReader === "function") {
      const reader = body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel().catch(() => {}); throw new Error("response too large"); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return new TextDecoder("utf-8").decode(bytes);
    }
    const text = await response.text();
    if (Buffer.byteLength(String(text)) > limit) throw new Error("response too large");
    return String(text);
  }
  async function fetchSource(source) {
    const base = { id: source.id, name: source.name };
    const controller = new AbortController();
    const limit = deadline(timeoutMs, () => controller.abort());
    try {
      const read = (async () => {
        const json = source.format === "hn" || source.format === "github-releases";
        const response = await fetchImpl(source.url, {
          headers: { "User-Agent": `MefiStudio/${version}`, Accept: json ? "application/json" : "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8" },
          signal: controller.signal, redirect: "follow",
        });
        if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "error"}`);
        return readCapped(response, source.maxBytes ?? maxBytes);
      })();
      const text = await Promise.race([read, limit.promise]);
      const items = news.parseFeed(text, source);
      return { ...base, ok: true, count: items.length, items };
    } catch (error) {
      const reason = controller.signal.aborted ? "timed out" : String(error?.message ?? error).slice(0, 120);
      say(`${source.id} unavailable: ${reason}`);
      return { ...base, ok: false, count: 0, items: [], error: reason };
    } finally { limit.cancel(); }
  }
  async function studioItems() {
    if (typeof extraItems !== "function") return [];
    const limit = deadline(timeoutMs);
    try {
      const list = await Promise.race([Promise.resolve().then(() => extraItems()), limit.promise]);
      return Array.isArray(list) ? list.slice(0, 40).map(news.normalizeItem).filter(Boolean) : [];
    } catch (error) {
      say(`studio items unavailable: ${error?.message ?? error}`);
      return [];
    } finally { limit.cancel(); }
  }
  function load() {
    loading ??= (async () => {
      if (!file || typeof readFile !== "function") return;
      try {
        const saved = JSON.parse(await readFile(file, "utf8"));
        if (!current && news.isEdition(saved)) current = saved;
      } catch {}
    })();
    return loading;
  }
  async function save(paper) {
    if (!file || typeof writeFile !== "function") return;
    try {
      if (typeof mkdir === "function") await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(paper), "utf8");
    } catch (error) { say(`could not save the edition: ${error?.message ?? error}`); }
  }
  function emit(paper) {
    for (const listener of [...listeners]) { try { listener(paper); } catch (error) { say(`listener failed: ${error?.message ?? error}`); } }
  }
  // Offline: the last paper, marked stale when it is from an earlier day;
  // with none, an empty paper that still carries Studio's own wire.
  function offline(extra, status) {
    const today = news.localDate(now());
    if (current) return { ok: true, edition: current.date === today ? current : { ...current, stale: true }, offline: true };
    const empty = news.composeEdition({ items: [], extra, now: now(), sources, status });
    return { ok: true, edition: { ...empty, offline: true }, offline: true };
  }
  async function polish(paper) {
    const limit = deadline(editTimeoutMs);
    try {
      const { system, user } = news.editorPrompt(paper);
      const reply = await Promise.race([Promise.resolve().then(() => edit(system, user, { timeoutMs: editTimeoutMs })), limit.promise]);
      if (current !== paper || !(await isEnabled())) return;
      if (typeof reply !== "string" || !reply.trim()) return;
      const edited = news.applyEditor(paper, reply);
      if (edited === paper) { say("the editor's reply did not pass the checks; the heuristic paper stays"); return; }
      current = edited;
      await save(edited);
      emit(edited);
    } catch (error) { say(`editor skipped: ${error?.message ?? error}`); }
    finally { limit.cancel(); }
  }
  async function print() {
    const at = now();
    const [results, extra] = await Promise.all([Promise.all(sources.map(fetchSource)), studioItems()]);
    // Switched off while the wires were out: nothing is kept or shown.
    if (!(await isEnabled())) return { ok: false, disabled: true };
    const status = results.map(({ id, name, ok, count, error }) => ({ id, name, ok, count, ...(error ? { error } : {}) }));
    const items = results.flatMap((result) => result.items);
    if (!results.some((result) => result.ok && result.items.length)) {
      failedAt = at;
      say("no wire answered; the paper waits");
      return offline(extra, status);
    }
    const paper = news.composeEdition({ items, extra, now: at, sources, status });
    current = paper;
    builtAt = at;
    failedAt = 0;
    say(`printed ${paper.date}: ${status.filter((entry) => entry.ok).length}/${status.length} wires, lead "${paper.lead?.title ?? "none"}"`);
    await save(paper);
    emit(paper);
    if (typeof edit === "function" && paper.lead) void polish(paper);
    return { ok: true, edition: paper };
  }
  function build() {
    building ??= print()
      .catch((error) => { say(`build failed: ${error?.message ?? error}`); failedAt = now(); return offline([], []); })
      .finally(() => { building = null; });
    return building;
  }
  async function edition({ refresh = false } = {}) {
    if (!(await isEnabled())) return { ok: false, disabled: true };
    await load();
    const today = news.localDate(now());
    if (building) return building;
    if (current?.date === today) {
      // A second Refresh inside a minute gets the paper just printed.
      if (!refresh || now() - builtAt < refreshFloorMs) return { ok: true, edition: current };
    } else if (!refresh && failedAt && now() - failedAt < retryMs) return offline(await studioItems(), []);
    return build();
  }

  // ---- the morning refresh ----
  const freshToday = () => current?.date === news.localDate(now()) && current.generatedAt >= news.morningOf(now(), MORNING_HOUR);
  function schedule() {
    clearTimer(timer);
    const at = now();
    const morning = news.morningOf(at, MORNING_HOUR);
    const next = at < morning ? morning : news.morningOf(at + 24 * HOUR, MORNING_HOUR);
    // Hourly at most, so a PC that slept through 06:00 still gets its paper.
    timer = setTimer(tick, Math.max(1000, Math.min(HOUR, next - at + 1000)));
    timer?.unref?.();
  }
  async function tick() {
    timer = null;
    if (!running) return;
    try {
      if (await isEnabled()) {
        await load();
        if (now() >= news.morningOf(now(), MORNING_HOUR) && !freshToday() && !(failedAt && now() - failedAt < retryMs)) await build();
      }
    } catch (error) { say(`morning refresh failed: ${error?.message ?? error}`); }
    finally { if (running) schedule(); }
  }
  function start() {
    if (running) return;
    running = true;
    schedule();
  }
  function stop() {
    running = false;
    clearTimer(timer);
    timer = null;
  }
  function onChange(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { edition, onChange, start, stop, current: () => current };
}

module.exports = { createDailyNews };
