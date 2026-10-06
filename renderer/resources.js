// Resources (Team › Resources): this PC's apps, and what Studio may do to them
// so its agents get the machine while they build. Studio can slow an app down,
// pause it, give its memory back to Windows, ask it to close or end it, by your
// hand (Manual) or by itself while agents build (Auto). The host decides and
// acts (main.cjs "the resource manager for other apps", scripts/resource-host.cjs
// and scripts/resource-rules.cjs, with the Windows helper
// scripts/resource-helper.cs); this page shows what it sees and sends one action
// at a time, naming an app by its key, never a process number.
//
// While on screen it holds a watch lease and the host pushes a fresh picture
// every two seconds. Rows are patched in place (MefiPatch.morph) and every
// control works through one delegated listener, so a menu you have open or the
// button under the pointer stays where it is. Auto mode's actions also arrive
// as toasts while the page is closed (How auto mode decides › Tell me).
(function () {
  "use strict";
  const $ = (id) => document.getElementById(`resources-${id}`);
  const api = () => window.mefiStudio;
  const LEASE_RENEW_MS = 30000;
  const ARM_MS = 4000;
  const TOP = 12;
  const TOAST_GAP_MS = 8000;
  const state = {
    view: null, error: "", reading: null, busy: new Set(), notes: new Map(), armed: null,
    all: false, filter: "", sort: "memory", lease: 0, toasts: [], toastTimer: 0,
  };
  let initialized = false;

  const RULE_WORDS = Object.freeze({ auto: "Auto decides", leave: "Leave it alone", slow: "Slow it while building", pause: "Pause it while building", close: "Close it while building" });
  const RULE_TITLES = Object.freeze({
    auto: "Auto mode slows it down while agents build if it is heavy and you are not using it, and gives its memory back when building runs short.",
    leave: "Auto mode never touches it. Your own buttons still work.",
    slow: "Auto mode slows it down whenever agents build, heavy or not.",
    pause: "Auto mode pauses it whenever agents build (unless you are using it) and lets it run again when they finish.",
    close: "Auto mode asks it to close when agents start building. It may ask you to save first; Studio does not open it again.",
  });
  const OP_WORDS = Object.freeze({ slow: "Slow down", pause: "Pause", trim: "Free memory", close: "Close", end: "End", restore: "Put back" });
  const OP_TITLES = Object.freeze({
    slow: "Lowest priority and efficiency mode: it keeps working, but gets the CPU only when the agents leave some.",
    pause: "Freezes it and gives its memory back to Windows. It carries on where it was when you put it back or switch to it.",
    trim: "Hands its memory back to Windows without stopping it. It takes back what it needs as you use it.",
    close: "Asks it to close, as its own close button would. It may ask you to save first.",
    end: "Stops it at once. Anything unsaved in it is lost.",
    restore: "Back to how it was before Studio touched it.",
  });
  const BY_WORDS = Object.freeze({ you: "you", auto: "auto", studio: "Studio" });

  // ---- small helpers -------------------------------------------------------------------
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const isOpen = () => Boolean($("overlay")) && !$("overlay").hidden;
  const say = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : (typeof error === "string" && error) || fallback);
  const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
  function size(megabytes) {
    const value = Math.max(0, Number(megabytes) || 0);
    if (value < 1024) return `${Math.round(value)} MB`;
    return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} GB`;
  }
  const percent = (value) => (Number.isFinite(value) ? `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%` : "–");
  function ago(at) {
    const seconds = Math.max(0, Math.round((Date.now() - Number(at)) / 1000));
    if (seconds < 45) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : new Date(Number(at)).toLocaleDateString();
  }
  function toast(text, kind = "info", options) { try { window.MefiToast?.(text, kind, options); } catch { /* no toasts in this window */ } }

  // ---- reading -------------------------------------------------------------------------
  async function read({ quiet = false } = {}) {
    if (!api()?.resourcesState) { state.error = "The resource manager runs in the desktop app."; render(); return null; }
    if (state.reading) return state.reading;
    if (!quiet && !state.view) render();
    state.reading = (async () => {
      try {
        const view = await api().resourcesState();
        if (view?.ok) { state.view = view; state.error = ""; }
        else state.error = say(view?.error, "Studio could not look at this PC.");
      } catch (error) {
        state.error = say(error, "Studio could not look at this PC.");
      }
    })().finally(() => { state.reading = null; render(); });
    return state.reading;
  }
  function onPush(view) {
    if (!view?.ok) return;
    state.view = view;
    state.error = "";
    if (isOpen()) render();
  }
  async function lease(on) {
    try { await api()?.resourcesWatch?.({ id: "resources-page", on }); } catch { /* a lease lapses by itself */ }
  }

  // ---- what a row says -------------------------------------------------------------------
  // The chips on one app: what it is doing now and what Studio holds on it.
  function chips(app) {
    const out = [];
    if (app.foreground) out.push({ text: "In use", tone: "info", title: "The app in front of you. Auto mode leaves it alone." });
    if (app.hold?.pause || app.paused === "all") out.push({ text: `Paused${app.hold?.pause ? ` by ${BY_WORDS[app.hold.pause.by] ?? "Studio"}` : ""}`, tone: "warn", title: "Frozen and its memory handed back. Switching to it or Put back lets it run again." });
    else if (app.paused === "some") out.push({ text: "Partly paused", tone: "warn" });
    if (app.hold?.slow || app.slowed === "all") out.push({ text: `Slowed${app.hold?.slow ? ` by ${BY_WORDS[app.hold.slow.by] ?? "Studio"}` : ""}`, tone: "gold", title: "Lowest priority and efficiency mode." });
    else if (app.slowed === "some") out.push({ text: "Partly slowed", tone: "gold" });
    if (app.frozen && !app.hold?.pause) out.push({ text: "Suspended by Windows", tone: "dim", title: "Windows paused it in the background itself." });
    if (app.protected) out.push({ text: "Left alone", tone: "dim", title: app.protected.why });
    return out;
  }

  function rowNode(app, top) {
    const busy = state.busy.has(app.key);
    const item = el("li", "resources-row");
    item.dataset.key = app.key;
    if (app.protected) item.dataset.tone = "dim";
    else if (app.hold?.pause) item.dataset.tone = "warn";
    else if (app.hold?.slow) item.dataset.tone = "gold";
    else if (app.foreground) item.dataset.tone = "info";
    if (busy) item.setAttribute("aria-busy", "true");

    const main = el("div", "resources-main");
    const title = el("div", "resources-title");
    title.append(el("strong", "resources-name", app.name));
    if (app.kindLabel) title.append(el("span", "resources-kind", app.kindLabel));
    if (app.count > 1) title.append(el("span", "resources-count", plural(app.count, "process", "processes")));
    for (const chip of chips(app)) {
      const node = el("span", "resources-chip", chip.text);
      node.dataset.tone = chip.tone;
      if (chip.title) node.title = chip.title;
      title.append(node);
    }
    main.append(title);
    if (app.title && app.title !== app.name) {
      const line = el("div", "resources-window", app.title);
      line.title = app.title;
      main.append(line);
    }
    if (app.protected) main.append(el("p", "resources-why", app.protected.why));
    else if (app.kept) main.append(el("p", "resources-why", `${plural(app.kept, "of its processes", "of its processes")} left alone: ${app.keptWhy}`));
    const note = state.notes.get(app.key);
    if (note) {
      const box = el("p", "resources-note", note.text);
      box.dataset.tone = note.tone;
      box.setAttribute("role", note.tone === "bad" ? "alert" : "status");
      main.append(box);
    }

    const numbers = el("div", "resources-numbers");
    const cpu = el("span", "resources-cpu", percent(app.cpu));
    cpu.title = "Share of the whole PC's CPU";
    const mem = el("span", "resources-mem", size(app.memMB));
    mem.title = "Memory it holds (private working set)";
    const bar = el("span", "resources-bar");
    bar.setAttribute("aria-hidden", "true");
    const fill = el("i");
    fill.style.width = `${Math.min(100, Math.round((app.memMB / Math.max(1, top)) * 100))}%`;
    bar.append(fill);
    numbers.append(cpu, mem, bar);

    const side = el("div", "resources-side");
    if (!app.protected) {
      const rule = el("label", "resources-rule");
      rule.title = RULE_TITLES[app.rule] ?? "";
      rule.append(el("span", "resources-rule-label", "In auto mode"));
      const select = el("select", "resources-rule-pick");
      select.dataset.rule = app.key;
      select.disabled = busy;
      select.setAttribute("aria-label", `What auto mode does with ${app.name}`);
      for (const [value, words] of Object.entries(RULE_WORDS)) {
        const option = el("option", "", words);
        option.value = value;
        // The attribute, not just the property: MefiPatch carries a choice by its markup.
        if ((app.ruleSet ? app.rule : "auto") === value) { option.setAttribute("selected", ""); option.selected = true; }
        select.append(option);
      }
      // A kind Studio leaves alone by default says so in the closed menu too.
      if (!app.ruleSet && app.rule === "leave") select.options[0].textContent = "Auto decides (leave it alone)";
      rule.append(select);
      side.append(rule);
      const buttons = el("div", "resources-buttons");
      const add = (op, { disabled = false, primary = false, title = OP_TITLES[op] } = {}) => {
        const armed = state.armed && state.armed.key === app.key && state.armed.op === op;
        const button = el("button", `${primary ? "" : "ghost "}mini${op === "end" ? " resources-danger" : ""}`, armed ? `${OP_WORDS[op]}: click again` : OP_WORDS[op]);
        button.type = "button";
        button.dataset.op = op;
        button.disabled = busy || disabled;
        button.title = title;
        if (armed) button.dataset.armed = "";
        buttons.append(button);
      };
      const held = Boolean(app.hold?.slow || app.hold?.pause || app.paused !== "none" || app.slowed !== "none");
      if (held) add("restore", { primary: true });
      if (!app.hold?.slow && app.slowed !== "all") add("slow");
      if (!app.hold?.pause && app.paused !== "all") add("pause", { disabled: app.foreground, title: app.foreground ? "It is the app in front of you: pausing it would freeze it while you use it." : OP_TITLES.pause });
      add("trim");
      add("close");
      add("end");
      side.append(buttons);
    }
    item.append(main, numbers, side);
    return item;
  }

  // ---- painting --------------------------------------------------------------------------
  function meters(view) {
    const box = $("meters");
    const machine = view?.machine;
    const cards = [];
    const card = (label, value, detail, tone, fill) => {
      const node = el("div", "resources-meter");
      node.dataset.key = label;
      if (tone) node.dataset.tone = tone;
      node.append(el("span", "resources-meter-label", label), el("strong", "resources-meter-value", value));
      if (Number.isFinite(fill)) {
        const bar = el("span", "resources-bar");
        bar.setAttribute("aria-hidden", "true");
        const inner = el("i");
        inner.style.width = `${Math.max(0, Math.min(100, Math.round(fill)))}%`;
        bar.append(inner);
        node.append(bar);
      }
      if (detail) node.append(el("span", "resources-meter-detail", detail));
      cards.push(node);
    };
    if (machine) {
      card("CPU", percent(machine.cpu), "the whole PC", machine.cpu >= 90 ? "bad" : machine.cpu >= 70 ? "warn" : "", machine.cpu);
      const used = machine.totalMB - machine.freeMB;
      card("Memory", `${size(used)} of ${size(machine.totalMB)}`, `${size(machine.freeMB)} free`, machine.usedPct >= 92 ? "bad" : machine.usedPct >= 80 ? "warn" : "", machine.usedPct);
    }
    if (view?.studio) card("Studio and its agents", size(view.studio.memMB), `${percent(view.studio.cpu)} CPU`);
    if (view?.building) {
      const building = view.building;
      card("Agents", building.active ? (building.running ? `${plural(building.running, "building", "building")}` : "Waiting") : "Idle",
        building.waiting ? "work is waiting for the machine" : building.active ? "Studio is building" : "nothing is building", building.waiting ? "warn" : building.active ? "info" : "");
    }
    morph(box, cards);
  }

  function suggestion(view) {
    const box = $("suggest");
    const short = view?.short;
    const offers = (view?.suggest ?? []).filter((entry) => entry && entry.key);
    if (!short || view?.mode !== "auto" || !offers.length) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    const nodes = [el("p", "resources-suggest-text", `Building is short of memory: ${size(short.freeMB)} free, ${size(short.wantMB)} wanted. Auto mode only pauses the apps you allow; these would help most.`)];
    for (const offer of offers) {
      const line = el("div", "resources-suggest-row");
      line.dataset.key = offer.key;
      line.append(el("span", "resources-suggest-name", `${offer.name} · about ${size(offer.freesMB)}`));
      const now = el("button", "mini", "Pause it now");
      now.type = "button";
      now.dataset.op = "pause";
      now.title = OP_TITLES.pause;
      const always = el("button", "ghost mini", "Always pause it while building");
      always.type = "button";
      always.dataset.setRule = "pause";
      always.title = RULE_TITLES.pause;
      line.append(now, always);
      nodes.push(line);
    }
    morph(box, nodes);
  }

  function leftAlone(view) {
    const box = $("left");
    const parts = [];
    if (view?.studio?.count) parts.push(`Studio and its agents: ${size(view.studio.memMB)} in ${plural(view.studio.count, "process", "processes")}`);
    if (view?.windows?.count) parts.push(`Windows and its services: ${size(view.windows.memMB)} in ${plural(view.windows.count, "process", "processes")}`);
    if (view?.kept?.count) parts.push(`${plural(view.kept.count, "process", "processes")} Studio cannot name`);
    box.hidden = !parts.length;
    box.replaceChildren(el("h3", "resources-left-title", "Never touched"), el("p", "resources-left-text", `${parts.join(" · ")}. Studio never slows, pauses or closes itself, its agents, Windows, another person's apps, what Studio was started from, console windows or security software.`));
  }

  function settingsCard(view) {
    const prefs = view?.prefs;
    const box = $("settings-body");
    if (!prefs) { box.replaceChildren(); return; }
    const rows = [];
    const pick = (key, label, help, options, value) => {
      const row = el("label", "resources-setting");
      const words = el("span", "resources-setting-words");
      words.append(el("b", "", label), el("small", "", help));
      const select = el("select", "resources-setting-pick");
      select.dataset.pref = key;
      select.id = `resources-pref-${key}`;
      const values = options.some(([option]) => option === value) ? options : [...options, [value, String(value)]];
      for (const [option, text] of values) {
        const node = el("option", "", text);
        node.value = String(option);
        if (option === value) { node.setAttribute("selected", ""); node.selected = true; }
        select.append(node);
      }
      row.append(words, select);
      rows.push(row);
    };
    const toggle = (key, label, help, value) => {
      const row = el("label", "switch resources-switch");
      const box = el("input");
      box.type = "checkbox";
      box.dataset.pref = key;
      box.id = `resources-pref-${key}`;
      if (value === true) box.setAttribute("checked", "");
      box.checked = value === true;
      const words = el("span", "resources-setting-words");
      words.append(el("b", "", label), el("small", "", help));
      row.append(box, el("span", "track"), words);
      rows.push(row);
    };
    pick("keepFreeMB", "Memory to keep free for building", "Below this, building is short of memory: auto mode gives background apps' memory back and suggests what to pause.", [[1024, "1 GB"], [1536, "1.5 GB"], [2048, "2 GB"], [3072, "3 GB"], [4096, "4 GB"], [6144, "6 GB"], [8192, "8 GB"]], prefs.keepFreeMB);
    pick("heavyMemMB", "An app is heavy from", "Heavy apps you are not using are slowed down while agents build.", [[250, "250 MB of memory"], [500, "500 MB of memory"], [1000, "1 GB of memory"], [2000, "2 GB of memory"]], prefs.heavyMemMB);
    pick("heavyCpuPct", "or from", "Its share of the whole PC's CPU.", [[5, "5% CPU"], [10, "10% CPU"], [20, "20% CPU"], [35, "35% CPU"]], prefs.heavyCpuPct);
    pick("restoreAfterSec", "Put everything back", "After the last agent finishes building.", [[0, "Right away"], [60, "After 1 minute"], [300, "After 5 minutes"], [900, "After 15 minutes"]], prefs.restoreAfterSec);
    toggle("trimWhenShort", "Give memory back when building runs short", "Background apps hand their memory to Windows; they take it back as you use them.", prefs.trimWhenShort);
    toggle("notify", "Tell me when auto mode acts", "A small note in the corner, with Put back.", prefs.notify);
    morph(box, rows);
  }

  function logList(view) {
    const box = $("log");
    const entries = view?.log ?? [];
    if (!entries.length) { box.replaceChildren(el("li", "resources-log-empty", "Nothing yet. What Studio does to an app shows up here.")); return; }
    morph(box, entries.map((entry) => {
      const item = el("li", "resources-log-row");
      item.dataset.key = `${entry.at}:${entry.text}`;
      if (entry.ok === false) item.dataset.tone = "bad";
      item.append(el("span", "resources-log-when", ago(entry.at)), el("span", "resources-log-who", BY_WORDS[entry.by] ?? "Studio"), el("span", "resources-log-text", entry.text));
      return item;
    }));
  }

  // Rows patched in place where MefiPatch is bundled; replaced outright elsewhere (fake DOMs).
  function morph(host, nodes) {
    const fragment = document.createDocumentFragment();
    for (const node of nodes) fragment.append(node);
    if (window.MefiPatch?.morph) window.MefiPatch.morph(host, fragment);
    else host.replaceChildren(...fragment.childNodes);
  }

  function visibleApps(view) {
    const query = state.filter.trim().toLowerCase();
    let apps = (view?.apps ?? []).slice();
    if (state.sort === "cpu") apps.sort((a, b) => b.cpu - a.cpu || b.memMB - a.memMB);
    else if (state.sort === "name") apps.sort((a, b) => a.name.localeCompare(b.name));
    // Protected apps sit under the ones Studio may touch.
    apps.sort((a, b) => Number(Boolean(a.protected)) - Number(Boolean(b.protected)));
    if (query) apps = apps.filter((app) => [app.name, app.key, app.title ?? "", app.kindLabel ?? ""].some((text) => String(text).toLowerCase().includes(query)));
    const total = apps.length;
    const held = (app) => app.hold?.slow || app.hold?.pause || app.foreground;
    if (!state.all && !query) apps = apps.filter((app, index) => index < TOP || held(app));
    return { apps, total };
  }

  function render() {
    const overlay = $("overlay");
    if (!overlay || !isOpen()) return;
    const view = state.view;
    const headline = $("headline");
    headline.textContent = state.error && !view ? state.error : !view ? "Looking at this PC…" : view.headline;
    headline.dataset.tone = state.error || view?.error ? "bad" : view?.short ? "warn" : "";
    const supported = view ? view.supported !== false : true;
    $("tools").hidden = !supported;
    $("settings").hidden = !supported;
    const problem = $("problem");
    problem.hidden = !(view?.error);
    problem.textContent = view?.error ? `The resource helper had a problem: ${view.error}` : "";
    for (const mode of ["manual", "auto"]) {
      const button = $(`mode-${mode}`);
      const on = (view?.mode ?? "manual") === mode;
      button.setAttribute("aria-checked", on ? "true" : "false");
      button.tabIndex = on ? 0 : -1;
      button.disabled = !supported || state.busy.has("mode");
    }
    $("mode-note").textContent = (view?.mode ?? "manual") === "auto"
      ? "While agents build, Studio slows heavy apps you are not using, gives memory back when building runs short, and pauses or closes only the apps you allow below. Everything goes back when they finish."
      : "Studio changes nothing by itself. Use the buttons on each app, or Make room now for one round of what auto mode would do.";
    const held = (view?.apps ?? []).some((app) => app.hold?.slow || app.hold?.pause);
    $("restore").disabled = !held || state.busy.has("all");
    $("focus").disabled = !supported || state.busy.has("all");
    if (!view) { $("list").replaceChildren(); return; }
    meters(view);
    suggestion(view);
    const { apps, total } = visibleApps(view);
    const top = Math.max(1, ...((view.apps ?? []).map((app) => app.memMB)));
    if (!supported) morph($("list"), []);
    else if (!apps.length) morph($("list"), [el("li", "resources-empty", state.filter ? "No app matches." : "Studio sees no other apps yet.")]);
    else morph($("list"), apps.map((app) => rowNode(app, top)));
    const more = $("more");
    more.hidden = Boolean(state.filter) || total <= TOP;
    more.textContent = state.all ? "Show the top apps" : `Show all ${total} apps`;
    more.setAttribute("aria-expanded", state.all ? "true" : "false");
    for (const sort of ["memory", "cpu", "name"]) $(`sort-${sort}`)?.setAttribute("aria-pressed", state.sort === sort ? "true" : "false");
    leftAlone(view);
    settingsCard(view);
    logList(view);
  }

  // ---- acting --------------------------------------------------------------------------
  function note(key, text, tone) {
    if (text) state.notes.set(key, { text, tone }); else state.notes.delete(key);
    clearTimeout(note.timers?.get(key));
    note.timers = note.timers ?? new Map();
    if (text) note.timers.set(key, setTimeout(() => { state.notes.delete(key); render(); }, 9000));
  }

  async function act(key, op) {
    if (!api()?.resourcesAct || state.busy.has(key)) return;
    if (op === "end" && !(state.armed && state.armed.key === key && state.armed.op === "end" && Date.now() < state.armed.until)) {
      state.armed = { key, op, until: Date.now() + ARM_MS };
      render();
      setTimeout(() => { if (state.armed?.key === key && Date.now() >= state.armed.until) { state.armed = null; render(); } }, ARM_MS + 50);
      return;
    }
    state.armed = null;
    state.busy.add(key);
    render();
    let result;
    try { result = await api().resourcesAct(key, op); }
    catch (error) { result = { ok: false, error: say(error, "That did not work. Try again.") }; }
    state.busy.delete(key);
    note(key, result?.ok ? result.text : say(result?.error, "That did not work. Try again."), result?.ok ? "good" : "bad");
    await read({ quiet: true });
  }

  async function setPref(patch, busyKey = null) {
    if (!api()?.resourcesSet) return;
    if (busyKey) state.busy.add(busyKey);
    render();
    let result;
    try { result = await api().resourcesSet(patch); }
    catch (error) { result = { ok: false, error: say(error, "That setting could not be saved.") }; }
    if (busyKey) state.busy.delete(busyKey);
    if (!result?.ok) toast(say(result?.error, "That setting could not be saved."), "bad");
    await read({ quiet: true });
  }

  async function everything(what) {
    if (state.busy.has("all")) return;
    state.busy.add("all");
    render();
    let result;
    try { result = what === "focus" ? await api()?.resourcesAct?.("", "focus") : await api()?.resourcesRestoreAll?.(); }
    catch (error) { result = { ok: false, error: say(error, "That did not work. Try again.") }; }
    state.busy.delete("all");
    if (result?.ok) toast(what === "focus" ? result.text || "Made room." : result.restored ? `Put back ${plural(result.restored, "process", "processes")}.` : "Nothing was held.", "good");
    else toast(say(result?.error, "That did not work. Try again."), "bad");
    await read({ quiet: true });
  }

  // ---- auto mode's toasts (page open or not) ----------------------------------------------
  // Several actions in one tick become one note; a note at most every few seconds.
  function heard(entry) {
    if (!entry || entry.by !== "auto" || entry.notify === false) return;
    state.toasts.push(entry);
    if (state.toastTimer) return;
    const wait = Math.max(400, TOAST_GAP_MS - (Date.now() - (heard.last ?? 0)));
    state.toastTimer = setTimeout(() => {
      state.toastTimer = 0;
      heard.last = Date.now();
      const batch = state.toasts.splice(0);
      if (!batch.length || isOpen()) return;
      const first = batch[0];
      const text = batch.length === 1 ? `Auto mode: ${first.text}` : `Auto mode made room: ${batch.slice(0, 2).map((entry) => entry.text).join("; ")}${batch.length > 2 ? ` and ${batch.length - 2} more` : ""}.`;
      const keys = [...new Set(batch.map((entry) => entry.key).filter(Boolean))];
      toast(text, "info", {
        action: { label: "Open", run: () => window.MefiNav?.go?.("resources") },
        secondary: keys.length === 1 ? { label: "Put back", run: () => { void api()?.resourcesAct?.(keys[0], "restore"); } } : null,
      });
    }, wait);
  }

  // ---- the sheet -------------------------------------------------------------------------
  function renew() {
    clearInterval(state.lease);
    state.lease = setInterval(() => { if (isOpen() && !document.hidden) void lease(true); }, LEASE_RENEW_MS);
  }
  function open(params = {}) {
    init();
    window.MefiNav?.claim?.("resources");
    $("overlay").hidden = false;
    void lease(true);
    renew();
    void read({ quiet: Boolean(state.view) });
    render();
    if (params?.focus !== false) requestAnimationFrame(() => $(`mode-${state.view?.mode ?? "manual"}`)?.focus?.({ preventScroll: true }));
  }
  function close() {
    clearInterval(state.lease);
    state.lease = 0;
    if (!isOpen()) return;
    $("overlay").hidden = true;
    state.armed = null;
    void lease(false);
    window.MefiNav?.release?.("resources");
  }

  function init() {
    if (initialized || !$("overlay")) return;
    initialized = true;
    $("close").addEventListener("click", () => window.MefiNav?.close?.("resources") ?? close());
    $("focus").addEventListener("click", () => { void everything("focus"); });
    $("restore").addEventListener("click", () => { void everything("restore"); });
    $("more").addEventListener("click", () => { state.all = !state.all; render(); });
    $("filter").addEventListener("input", (event) => { state.filter = String(event.target.value || ""); render(); });
    for (const sort of ["memory", "cpu", "name"]) $(`sort-${sort}`)?.addEventListener("click", () => { state.sort = sort; render(); });
    // Manual | Auto as one radio group: click, or the arrow keys.
    const modes = $("modes");
    modes.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-mode]");
      if (!button || button.disabled || button.getAttribute("aria-checked") === "true") return;
      void setPref({ mode: button.dataset.mode }, "mode");
    });
    modes.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const next = (state.view?.mode ?? "manual") === "auto" ? "manual" : "auto";
      $(`mode-${next}`)?.focus?.();
      void setPref({ mode: next }, "mode");
    });
    // Every row control through one listener, so a patched row keeps working.
    const body = $("body");
    body.addEventListener("click", (event) => {
      const button = event.target.closest?.("button[data-op], button[data-set-rule]");
      if (!button || button.disabled) return;
      const row = button.closest("[data-key]");
      const key = row?.dataset.key;
      if (!key) return;
      if (button.dataset.setRule) void setPref({ rule: { app: key, value: button.dataset.setRule } }, key);
      else void act(key, button.dataset.op);
    });
    body.addEventListener("change", (event) => {
      const target = event.target;
      if (target?.dataset?.rule) { void setPref({ rule: { app: target.dataset.rule, value: target.value } }, target.dataset.rule); return; }
      const pref = target?.dataset?.pref;
      if (!pref) return;
      void setPref({ [pref]: target.type === "checkbox" ? target.checked === true : Number(target.value) });
    });
    api()?.onResources?.((view) => onPush(view));
    document.addEventListener("visibilitychange", () => { if (!document.hidden && isOpen()) { void lease(true); void read({ quiet: true }); } });
  }

  // Toasts listen from the start: auto mode acts while the page is closed.
  function listen() {
    api()?.onResourcesActed?.((entry) => heard(entry));
  }

  window.MefiResources = {
    open,
    close,
    isOpen,
    refresh: () => read(),
    focusNow: () => everything("focus"),
    restoreAll: () => everything("restore"),
    state: () => ({ view: state.view, error: state.error }),
  };
  // nav.js holds the record (Team, beside Fleet) and calls open/close.
  const boot = () => { init(); listen(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
