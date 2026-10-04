// Review: what an attempt changed, what the advisory checks said and how the preview looked before and
// after. It is the "Changes and checks" section of a task's Evidence tab (Tasks › a task › Evidence), below
// the task's own result and above its run history, with three panels:
//   Changed files  the files between the attempt's start and end picture, one file's diff on demand,
//                  Accept changes, Revert file and Revert attempt (two steps: "Revert all N");
//   Checks         lint, typecheck and, only when asked, build. Advisory: they never block Done;
//   Preview        the before and after shots of Studio's own preview, when it was running.
// The host does all of it (main.cjs "Attempt review": scripts/attempt-snapshots-host.cjs,
// advisory-checks-host.cjs, attempt-evidence-host.cjs); this page asks and shows, and never reads a file or
// runs a command itself. Nothing is read until the section is open. A finished attempt is read once and
// kept for a short while; a running one is read again every few seconds while the section is open and the
// window is showing; the host's review:changed pushes refresh what they name. A repaint redraws this
// section alone and puts the keyboard back where it was. The section's three switches (snapshots, advisory
// checks and their build, shots) are the owner's settings for what Studio keeps around each attempt.
//
// A second way to put it on screen (mount(host, { taskId, projectId, panel })): one panel of it, "changes", "checks"
// or "preview", in a box of its own with no tab row, for the v2 inspector (renderer/sessions.js), which has tabs
// of its own. Every view of a task shares that task's one record, so the attempt a person picked, what was read
// and what Accept and Revert answered are the same wherever they are shown, and a panel is read only while some
// view of it is on screen. counts() and onChange() tell a tab label what is in the list without opening it.
(function () {
  "use strict";
  const api = () => window.mefiStudio;

  const POLL_MS = 6000;
  const QUIET_MS = 400;
  const FRESH_MS = { changes: 15000, checks: 20000, evidence: 30000 };
  const FILES_SHOWN = 200;
  const DIFF_LINES = 400;
  const MAX_RECORDS = 40;
  const TABS = [["changes", "Changed files"], ["checks", "Checks"], ["preview", "Preview"]];
  // The only kind of picture the host sends; anything else is not drawn.
  const PNG_URL = "data:image/png;base64,";
  const STATUS_WORDS = { added: "Added", deleted: "Deleted", renamed: "Renamed" };
  const KIND_WORDS = { symlink: "Link", submodule: "Submodule" };
  const CHECK_MARKS = { ok: ["✓", "Passed"], warn: ["!", "Warnings"], bad: ["✕", "Failed"], skipped: ["–", "Not run"] };
  // key, short name, the switch's label and what it means
  const SWITCHES = [
    ["snapshots", "Before and after pictures", "Keep a before and after picture of each attempt", "It makes the changed-files list, Accept and Revert possible. It is kept in this project's git folder, only on this PC, and is never pushed."],
    ["advisory", "Advisory checks", "Run lint and typecheck after an attempt", "Advisory only: the result is shown here and never blocks Done. Builders can run the same checks while they work."],
    ["advisoryBuild", "The build check", "Include the build", "A build writes files into the project, so it is off unless you turn it on. Run always runs it when you ask."],
    ["shots", "Screenshots", "Take before and after screenshots of the preview", "Only when Studio's own preview is running. They stay on this PC and are never added to a problem report."],
  ];

  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
  const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
  const say = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : fallback);
  const toast = (text, tone = "good", options) => { try { window.MefiToast?.(text, tone, options); } catch { /* a toast is a courtesy */ } };
  const attached = (node) => Boolean(node) && node.isConnected !== false;
  const ago = (at) => {
    const ms = Date.now() - Number(at);
    if (!Number.isFinite(ms) || !at) return "";
    if (ms < 60000) return "just now";
    if (ms < 3600000) return `${Math.round(ms / 60000)} min ago`;
    if (ms < 48 * 3600000) return `${Math.round(ms / 3600000)} h ago`;
    return `${Math.round(ms / 86400000)} days ago`;
  };
  const byFocusKey = (body, key) => [...(body?.querySelectorAll?.("[data-focus-key]") ?? [])].find((node) => node.dataset?.focusKey === key) ?? null;
  const numbers = (additions, deletions) => { const box = el("span", "review-nums"); box.append(el("span", "review-add", `+${additions}`), document.createTextNode(" "), el("span", "review-del", `−${deletions}`)); return box; };

  // An environment variable that holds something off is the owner saying "not on this launch": the list of changed files
  // is then not drawn at all, and with all three held off there is no section.
  const changesHidden = (record) => record.changes?.available === false && record.changes?.reason === "off" && record.changes?.forced === true;
  const everythingForcedOff = (prefs) => Boolean(prefs?.forced?.snapshots && prefs?.forced?.advisory && prefs?.forced?.shots);
  const tabsOf = (record) => TABS.filter(([name]) => !(name === "changes" && changesHidden(record)));

  // What the page knows about each task it has shown, kept while the window lives.
  const records = new Map();
  const shared = { prefs: null, reading: null, settingsOpen: false };
  let uid = 0;
  let subscribed = false;
  const keyOf = (projectId, taskId) => `${projectId ?? ""}/${taskId}`;
  function recordFor(projectId, taskId) {
    const key = keyOf(projectId, taskId);
    let record = records.get(key);
    if (record) records.delete(key);
    else {
      uid += 1;
      record = { key, uid, projectId, taskId, tab: "changes", attempt: null, open: false, changes: null, checks: null, evidence: null, errors: {}, stamps: {}, reading: {}, diffs: new Map(), openFile: null, more: { files: 0, diff: 0 }, note: null, undo: null, busy: new Set(), view: null, views: new Map(), body: null, rev: 0, painted: -1, poll: 0, push: 0, pushed: new Set() };
    }
    records.set(key, record);
    if (records.size > MAX_RECORDS) { for (const [oldKey, old] of records) if (!old.views.size) { records.delete(oldKey); break; } }
    return record;
  }

  // ---- reading ----------------------------------------------------------------------------------
  const READERS = {
    changes: { method: "tasksChanges", fail: "The changed files could not be read." },
    checks: { method: "tasksChecks", fail: "The checks could not be read." },
    evidence: { method: "tasksEvidence", fail: "The screenshots could not be read." },
  };
  // The attempt the page means: the one the person chose, else the newest the host named.
  const chosen = (record) => record.attempt ?? record.changes?.attempt ?? record.checks?.attempt ?? record.evidence?.attempt ?? null;
  // What is on screen for a task: its fold (opened by the person) and any panels mounted on their own. Reading, polling
  // and the host's pushes all go by this, so nothing is read for a panel nobody sees.
  const shownOn = (record) => record.views.size > 0 && [...record.views.keys()].some(attached);
  const showing = (record) => (record.open && attached(record.view)) || shownOn(record);
  // The fold asks for its list (and its tab's data) as soon as it is open, whether or not its box is on the page yet: the Tasks
  // page builds a task's detail before it puts it in the document. Panels of their own are read only while they are on the page.
  function wants(record) {
    const names = new Set();
    if (record.open) { names.add("changes"); names.add(record.tab); }
    for (const [host, view] of record.views) if (attached(host)) names.add(view.tab);
    return names;
  }

  function read(record, what, { quiet = false, force = false } = {}) {
    const reader = READERS[what];
    if (!api()?.[reader.method]) { record.errors[what] = "This is part of the desktop app."; touch(record); return Promise.resolve(null); }
    // One read per question: a read for another attempt is not the answer to this one.
    if (record.reading[what] && record.reading[what].attempt === record.attempt) return record.reading[what].job;
    if (!force && record[what] && Date.now() - (record.stamps[what] ?? 0) < FRESH_MS[what]) return Promise.resolve(record[what]);
    if (!quiet || !record[what]) touch(record);
    const asked = record.attempt;
    const attempt = what === "changes" ? record.attempt : chosen(record);
    const payload = { taskId: record.taskId, projectId: record.projectId, ...(attempt ? { attempt } : {}) };
    const job = (async () => {
      let result = null;
      try { result = await api()[reader.method](payload); } catch (error) { result = { ok: false, error: say(error, reader.fail) }; }
      // The person chose another attempt while this was being read: it answers a question nobody asks now.
      if (record.attempt !== asked) return null;
      if (result?.ok) {
        record[what] = result;
        record.errors[what] = "";
        record.stamps[what] = Date.now();
        if (what === "changes") afterChanges(record);
      } else record.errors[what] = say(result?.error, reader.fail);
      return record[what];
    })().finally(() => { if (record.reading[what]?.job === job) delete record.reading[what]; touch(record); if (what === "changes") schedulePoll(record); });
    record.reading[what] = { attempt: asked, job };
    return job;
  }
  // A running attempt's diffs are stale as soon as they are read; an ended attempt's never change.
  function afterChanges(record) {
    const data = record.changes;
    if (data?.state === "ended") return;
    const open = record.openFile;
    record.diffs.clear();
    if (open && data?.files?.some((file) => file.path === open)) void loadDiff(record, open);
    else record.openFile = null;
  }
  function readPrefs(force = false) {
    if (!api()?.reviewPrefs) return Promise.resolve(null);
    if (shared.reading) return shared.reading;
    if (shared.prefs && !force) return Promise.resolve(shared.prefs);
    shared.reading = Promise.resolve().then(() => api().reviewPrefs({})).then((result) => { if (result?.ok) shared.prefs = result; return shared.prefs; }).catch(() => shared.prefs).finally(() => { shared.reading = null; touchAll(); });
    return shared.reading;
  }
  // What this record shows needs: the list always, and the current tab's own data.
  function wake(record, { force = false } = {}) {
    const names = wants(record);
    if (!record.open && !names.size) return;
    if (names.has("changes")) void read(record, "changes", { quiet: Boolean(record.changes), force });
    if (names.has("checks")) void read(record, "checks", { quiet: Boolean(record.checks), force });
    if (names.has("preview")) void read(record, "evidence", { quiet: Boolean(record.evidence), force });
    if (shared.settingsOpen) void readPrefs();
    schedulePoll(record);
  }
  function schedulePoll(record) {
    clearTimeout(record.poll);
    record.poll = 0;
    const data = record.changes;
    if (!showing(record) || !data || !(data.running || data.state === "running" || data.waiting)) return;
    record.poll = setTimeout(() => {
      record.poll = 0;
      if (!showing(record)) return;
      if (document.hidden) { schedulePoll(record); return; }
      void read(record, "changes", { quiet: true, force: true });
    }, POLL_MS);
    record.poll?.unref?.();
  }

  // ---- what the host tells us happened -----------------------------------------------------------------
  const RELOADS = { started: ["changes"], ended: ["changes"], dropped: ["changes"], revert: ["changes"], accept: ["changes"], shot: ["evidence"], checks: ["checks"] };
  function subscribe() {
    if (subscribed || typeof api()?.onReviewChanged !== "function") return;
    subscribed = true;
    api().onReviewChanged((event) => {
      if (!event || typeof event.taskId !== "string" || !RELOADS[event.what]) return;
      const record = records.get(keyOf(event.projectId, event.taskId)) ?? [...records.values()].find((item) => item.taskId === event.taskId && (!item.projectId || item.projectId === event.projectId));
      if (!record) return;
      if (event.attempt && chosen(record) && event.attempt !== chosen(record) && record.attempt) return;
      for (const what of RELOADS[event.what]) record.pushed.add(what);
      clearTimeout(record.push);
      record.push = setTimeout(() => {
        const names = [...record.pushed];
        record.pushed.clear();
        for (const what of names) {
          record.stamps[what] = 0;
          const seen = wants(record);
          const wanted = what === "changes" || (what === "checks" && seen.has("checks")) || (what === "evidence" && seen.has("preview"));
          if (wanted && showing(record)) void read(record, what, { quiet: true, force: true });
        }
      }, QUIET_MS);
      record.push?.unref?.();
    });
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------
  const paints = new Set();
  function touch(record) {
    record.rev += 1;
    if (paints.has(record)) return;
    paints.add(record);
    Promise.resolve().then(() => { paints.delete(record); paint(record); });
  }
  const touchAll = () => { for (const record of records.values()) if (record.body || record.views.size) touch(record); };
  // Who wants to know that a task's record moved (a tab label showing how many files changed).
  const watchers = new Set();
  const tell = (record) => { for (const callback of [...watchers]) { try { callback({ taskId: record.taskId, projectId: record.projectId }); } catch { /* one listener never stops another */ } } };

  function note(tone, text, choices = []) {
    const box = el("div", "review-note");
    box.dataset.tone = tone;
    box.setAttribute("role", tone === "bad" ? "alert" : "status");
    box.append(el("span", "", text));
    if (choices.length) {
      const row = el("span", "review-choices");
      for (const choice of choices) row.append(button(choice.label, choice.run, { primary: choice.primary, focus: choice.focus, disabled: choice.disabled }));
      box.append(row);
    }
    return box;
  }
  function button(label, run, { primary = false, disabled = false, title = "", focus = "", aria = "", armed = "" } = {}) {
    const node = el("button", `${primary ? "" : "ghost "}mini`, label);
    node.type = "button";
    node.disabled = Boolean(disabled);
    if (title) node.title = title;
    if (aria) node.setAttribute("aria-label", aria);
    if (focus) node.dataset.focusKey = focus;
    if (armed && window.MefiUi?.arm) window.MefiUi.arm(node, { run, armed });
    else node.addEventListener("click", run);
    return node;
  }
  const fine = (text) => el("p", "review-fine", text);
  const setNote = (record, tone, text, choices = []) => { record.note = { tone, text, choices }; touch(record); };

  function paint(record) {
    if (record.painted === record.rev) return;
    const body = record.body;
    if (body && attached(record.view)) {
      record.painted = record.rev;
      record.view.hidden = everythingForcedOff(shared.prefs);
      if (record.tab === "changes" && changesHidden(record)) { record.tab = "checks"; wake(record); }
      if (record.summary) record.summary.textContent = heading(record);
      if (!record.open) body.replaceChildren();
      else redraw(body, () => [tabs(record), panel(record), settings(record)]);
    }
    // The panels mounted on their own: one panel each, no tab row, the switches under it.
    for (const [host, view] of record.views) {
      if (!attached(host)) continue;
      record.painted = record.rev;
      redraw(view.body, () => [panel(record, view), settings(record)]);
    }
    if (record.views.size) tell(record);
  }
  // A repaint redraws one section alone and puts the keyboard back where it was.
  function redraw(body, make) {
    const held = body.contains?.(document.activeElement) ? document.activeElement?.dataset?.focusKey : "";
    body.replaceChildren(...make());
    if (held) {
      const again = byFocusKey(body, held);
      if (again && !again.disabled) again.focus?.({ preventScroll: true });
    }
  }
  function heading(record) {
    const data = record.changes;
    const count = data?.available !== false && data?.attempt ? data.totals?.files ?? data.files?.length ?? 0 : 0;
    return count ? `Changes and checks · ${plural(count, "file")} changed` : "Changes and checks";
  }

  function tabs(record) {
    const row = el("div", "review-tabs");
    row.setAttribute("role", "tablist");
    row.setAttribute("aria-label", "Review this attempt");
    const shown = tabsOf(record);
    shown.forEach(([name, label], index) => {
      const on = record.tab === name;
      const tab = el("button", "review-tab", label);
      tab.type = "button";
      tab.id = `review-tab-${record.uid}-${name}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.setAttribute("aria-controls", `review-panel-${record.uid}`);
      tab.tabIndex = on ? 0 : -1;
      tab.dataset.tab = name;
      tab.dataset.focusKey = `tab:${name}`;
      if (name === "changes" && record.changes?.available !== false && record.changes?.totals?.files) tab.append(document.createTextNode(" "), el("span", "review-count", record.changes.totals.files));
      tab.addEventListener("click", () => selectTab(record, name));
      tab.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "Home" ? -index : event.key === "End" ? shown.length - 1 - index : 0;
        if (!step) return;
        event.preventDefault?.();
        const next = shown[(index + step + shown.length) % shown.length][0];
        selectTab(record, next);
        byFocusKey(record.body, `tab:${next}`)?.focus?.();
      });
      row.append(tab);
    });
    return row;
  }
  function selectTab(record, name) {
    if (record.tab === name) return;
    record.tab = name;
    touch(record);
    wake(record);
  }

  // `view` is a panel mounted on its own ({ tab, labelledBy }): it has no tab row of ours to be labelled by.
  function panel(record, view = null) {
    const tab = view ? view.tab : record.tab;
    const box = el("div", "review-panel");
    box.id = view ? `review-panel-${record.uid}-${tab}` : `review-panel-${record.uid}`;
    box.setAttribute("role", "tabpanel");
    if (!view) box.setAttribute("aria-labelledby", `review-tab-${record.uid}-${record.tab}`);
    else if (view.labelledBy) box.setAttribute("aria-labelledby", view.labelledBy);
    else box.setAttribute("aria-label", TABS.find(([name]) => name === tab)?.[1] ?? "Review");
    // What Accept and Revert answered belongs to the list they act on.
    if (record.note && tab === "changes") box.append(note(record.note.tone, record.note.text, record.note.choices));
    if (tab === "changes") box.append(...changesPanel(record));
    else if (tab === "checks") box.append(...checksPanel(record));
    else box.append(...previewPanel(record));
    return box;
  }
  // A panel whose data has not arrived: what it is doing, or why it could not.
  const waiting = (record, what, label) => (record.errors[what] && !record[what] ? [note("bad", record.errors[what], [{ label: "Try again", run: () => { void read(record, what, { force: true }); } }])] : [el("p", "review-empty", label)]);

  // ---- Changed files -------------------------------------------------------------------------------------------------
  function changesPanel(record) {
    const data = record.changes;
    if (!data) return waiting(record, "changes", "Reading the changed files…");
    const out = [];
    if (record.errors.changes) out.push(note("warn", record.errors.changes));
    if (data.available === false) {
      out.push(el("p", "review-empty", data.note || "The changed files are not available for this project."));
      if (data.reason === "off" && data.forced) out.push(fine("It is switched off for this launch."));
      return out;
    }
    if (data.attempt == null || data.state === "none") {
      out.push(el("p", "review-empty", "No changes yet"), fine("Files appear here as the agent edits them. Attempts from before Studio kept this record have none."));
      return out;
    }
    out.push(picker(record, data));
    const files = Array.isArray(data.files) ? data.files : [];
    const everything = files.length > 0 && files.every((file) => file.state === "reverted");
    if (!files.length) out.push(el("p", "review-empty", "This attempt changed no files."));
    else if (everything) out.push(el("p", "review-empty", "Everything was reverted"), fine("The task was reopened. Nothing from that attempt is left in the folder."));
    if (files.length) {
      const head = el("div", "review-head");
      const total = data.totals?.files ?? files.length;
      head.append(el("strong", "review-totals", `${plural(total, "file")} changed`), numbers(data.totals?.additions ?? 0, data.totals?.deletions ?? 0));
      if (data.totals?.binary) head.append(el("span", "review-fine", `${plural(data.totals.binary, "binary file")}`));
      out.push(head, fine("Read from git, so it looks the same whichever builder did the work."));
    }
    const state = running(data) ? "A worker is still changing files here. This list updates as it works. Accept and revert wait until the task is paused or finished, so nothing changes under a running agent."
      : data.state === "unfinished" ? "This attempt never recorded its end, so the list compares the folder as it is now with how it started. Accept and revert are not offered for it."
        : data.waiting ? "A worker is changing files in this folder, so Accept and revert wait until it is paused or finished." : "";
    if (state) out.push(fine(state));
    if (data.overlap?.length) out.push(fine("Other workers were changing files in this folder at the same time, so some of these files may not be from this attempt."));
    if (data.skipped?.sentence) out.push(fine(data.skipped.sentence));
    if (files.length) {
      out.push(actions(record, data, files));
      out.push(fileList(record, data, files));
      if (data.more > 0) out.push(fine(`${plural(data.more, "more file")} changed, too many to list here. Accept and revert still cover the ones listed.`));
      out.push(fine("Files git ignores, such as node_modules, can't be restored. A revert keeps a copy of the folder first, so it can be undone."));
    }
    return out;
  }
  const running = (data) => data.running === true || data.state === "running";

  function picker(record, data) {
    const row = el("div", "review-picker");
    const attempts = Array.isArray(data.attempts) ? data.attempts : [];
    const words = (item) => `Attempt ${item.n} · ${item.running ? "working now" : item.ended ? ago(item.endedAt) || "finished" : "no end recorded"}${item.accepted ? " · accepted" : ""}`;
    if (attempts.length < 2) { row.append(el("span", "review-fine", attempts[0] ? words(attempts[0]) : `Attempt ${data.attempt}`)); return row; }
    const label = el("label", "review-picker-label", "Attempt");
    const select = el("select", "review-select");
    select.dataset.focusKey = "attempt";
    select.setAttribute("aria-label", "Attempt to review");
    for (const item of attempts) {
      const option = el("option", "", words(item));
      option.value = String(item.n);
      if (item.n === data.attempt) option.selected = true;
      select.append(option);
    }
    select.value = String(data.attempt);
    select.addEventListener("change", () => chooseAttempt(record, Number(select.value), attempts));
    label.append(select);
    row.append(label);
    return row;
  }
  function chooseAttempt(record, n, attempts) {
    if (!Number.isSafeInteger(n) || n === chosen(record)) return;
    const newest = Math.max(...attempts.map((item) => item.n));
    record.attempt = n === newest ? null : n;
    record.changes = record.checks = record.evidence = null;
    record.errors = {};
    record.stamps = {};
    record.diffs.clear();
    record.openFile = null;
    record.note = null;
    record.undo = null;
    record.more = { files: 0, diff: 0 };
    touch(record);
    wake(record, { force: true });
  }

  function actions(record, data, files) {
    const row = el("div", "review-actions");
    const busy = record.busy.size > 0;
    const count = data.totals?.files ?? files.length;
    if (data.accepted) {
      const chip = el("span", "review-chip", "✓ Accepted");
      chip.dataset.tone = "good";
      row.append(chip, button("Undo accept", () => { void accept(record, false); }, { disabled: busy, focus: "unaccept" }));
    } else row.append(button("Accept changes", () => { void accept(record, true); }, { primary: true, disabled: busy || !data.canAccept, focus: "accept", title: data.canAccept ? "Record that you accepted this attempt. It does not change the task's status." : "Accept waits until the task is paused or finished" }));
    const restorable = files.some((file) => file.state === "can-revert");
    row.append(button("Revert attempt", () => { void revert(record, { scope: "attempt" }); }, { disabled: busy || !data.canRevert, focus: "revert", armed: `Revert all ${count}`, title: data.canRevert ? "Put every file back as it was before this attempt and reopen the task" : restorable ? "Revert waits until the task is paused or finished" : "Nothing in this attempt can be put back" }));
    return row;
  }

  function fileList(record, data, files) {
    // Lists are plain blocks with list roles: the task pane styles every <ul> and <li> in it as flex rows.
    const list = el("div", "review-files");
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "Changed files");
    const shown = FILES_SHOWN + record.more.files;
    for (const file of files.slice(0, shown)) list.append(fileRow(record, data, file));
    if (files.length > shown) {
      const more = el("div", "review-file-more");
      more.setAttribute("role", "listitem");
      more.append(button(`Show ${Math.min(FILES_SHOWN, files.length - shown)} more files`, () => { record.more.files += FILES_SHOWN; touch(record); }, { focus: "more-files" }));
      list.append(more);
    }
    return list;
  }
  function fileRow(record, data, file) {
    const item = el("div", "review-file");
    item.setAttribute("role", "listitem");
    item.dataset.state = file.state || "";
    item.dataset.status = file.status || "";
    const open = record.openFile === file.path;
    const main = el("button", "review-file-main");
    main.type = "button";
    main.dataset.focusKey = `file:${file.path}`;
    main.setAttribute("aria-expanded", open ? "true" : "false");
    main.title = open ? "Hide the changes in this file" : "Show the changes in this file";
    if (file.dir) main.append(el("span", "review-file-dir", file.dir));
    main.append(el("strong", "review-file-name", file.name || file.path));
    if (file.oldPath) main.append(el("span", "review-file-dir", ` (was ${file.oldPath})`));
    const tags = el("span", "review-tags");
    const word = STATUS_WORDS[file.status] || KIND_WORDS[file.kind];
    if (word) { const chip = el("span", "review-chip", word); chip.dataset.tone = file.status === "deleted" ? "bad" : file.status === "added" ? "good" : "dim"; tags.append(chip); }
    if (file.state === "changed") { const chip = el("span", "review-chip", "Changed since"); chip.dataset.tone = "warn"; chip.title = "This file was edited after the attempt ended, so Studio will not overwrite it"; tags.append(chip); }
    if (file.state === "reverted") { const chip = el("span", "review-chip", "Back as before"); chip.dataset.tone = "dim"; tags.append(chip); }
    main.append(tags);
    main.append(file.binary ? el("span", "review-nums", "binary") : numbers(file.additions ?? 0, file.deletions ?? 0));
    main.addEventListener("click", () => { void toggleFile(record, file); });
    item.append(main);
    if (file.state === "can-revert") item.append(button("Revert", () => { void revert(record, { scope: "file", file }); }, { disabled: record.busy.size > 0 || !data.canRevert, focus: `revert-file:${file.path}`, title: data.canRevert ? "Revert this file" : "Revert waits until the task is paused or finished", aria: `Revert ${file.name || file.path}` }));
    if (open) item.append(diffView(record, file));
    return item;
  }

  // One file's diff, drawn as text (never as markup) and in pieces, so a big file does not make the page heavy.
  function diffView(record, file) {
    const box = el("div", "review-diff");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", `Changes in ${file.name || file.path}`);
    const read = record.diffs.get(file.path);
    if (!read || read.loading) { box.append(el("p", "review-fine", "Reading the changes…")); return box; }
    if (read.error) { box.append(note("bad", read.error)); return box; }
    const diff = read.result;
    if (diff.binary) { box.append(el("p", "review-fine", "A binary file: its contents are not shown.")); return box; }
    if (!diff.lines?.length) { box.append(el("p", "review-fine", file.kind === "symlink" ? "A link: only its target changed." : "There are no lines to show for this file.")); return box; }
    const shown = DIFF_LINES + record.more.diff;
    for (const line of diff.lines.slice(0, shown)) {
      const row = el("div", "review-diff-line");
      row.dataset.k = line.k;
      if (line.k === "h") { row.append(el("span", "review-code", line.t)); box.append(row); continue; }
      row.append(el("span", "review-ln", line.a ?? ""), el("span", "review-ln", line.b ?? ""), el("span", "review-mark-sign", line.k === "+" ? "+" : line.k === "-" ? "−" : " "), el("span", "review-code", line.t));
      box.append(row);
    }
    if (diff.lines.length > shown) box.append(button(`Show ${Math.min(DIFF_LINES, diff.lines.length - shown)} more lines`, () => { record.more.diff += DIFF_LINES; touch(record); }, { focus: "more-diff" }));
    else if (diff.truncated) box.append(el("p", "review-fine", "This file is long: only the first part of its changes is shown."));
    return box;
  }
  async function loadDiff(record, path) {
    const asked = chosen(record);
    record.diffs.set(path, { loading: true });
    touch(record);
    let result = null;
    try { result = await api()?.tasksDiff?.({ taskId: record.taskId, projectId: record.projectId, attempt: asked, path }); } catch (error) { result = { ok: false, error: say(error, "The changes could not be read.") }; }
    if (chosen(record) !== asked) return;
    record.diffs.set(path, result?.ok ? { result } : { error: say(result?.error, "The changes could not be read.") });
    touch(record);
  }
  async function toggleFile(record, file) {
    if (record.openFile === file.path) { record.openFile = null; touch(record); return; }
    record.openFile = file.path;
    record.more.diff = 0;
    const kept = record.diffs.get(file.path);
    if (kept && !kept.error && !kept.loading) { touch(record); return; }
    await loadDiff(record, file.path);
  }

  // ---- Accept and Revert -------------------------------------------------------------------------------------------------
  async function act(record, name, run) {
    if (record.busy.has(name)) return null;
    record.busy.add(name);
    touch(record);
    try { return await run(); } catch (error) { return { ok: false, error: say(error, "That did not work. Try again.") }; } finally { record.busy.delete(name); touch(record); }
  }
  async function accept(record, accepted) {
    const data = record.changes;
    if (!data?.attempt) return;
    const result = await act(record, "accept", () => api()?.tasksAccept?.({ taskId: record.taskId, projectId: record.projectId, attempt: data.attempt, accepted }));
    if (result === null) return;
    if (result?.ok) {
      record.note = null;
      if (accepted) toast(`Accepted ${plural(data.totals?.files ?? data.files?.length ?? 0, "file")}`, "good", { action: { label: "Undo", run: () => { void accept(record, false); } } });
      await read(record, "changes", { force: true, quiet: true });
    } else setNote(record, "bad", say(result?.error, "That could not be saved. Try again."));
  }
  async function revert(record, { scope, file = null, partial = false }) {
    const data = record.changes;
    if (!data?.attempt) return;
    record.note = null;
    const result = await act(record, scope === "file" ? `file:${file.path}` : "attempt", () => api()?.tasksRevert?.({ taskId: record.taskId, projectId: record.projectId, attempt: data.attempt, scope, ...(file ? { path: file.path } : {}), ...(partial ? { partial: true } : {}) }));
    if (result === null) return;
    if (!result?.ok) { refused(record, data, scope, result); return; }
    record.undo = result.receipt ? { receipt: result.receipt, attempt: data.attempt } : null;
    const count = result.reverted ?? 0;
    const undo = record.undo ? { label: "Undo", run: () => { void undoRevert(record); } } : null;
    if (!count) setNote(record, "good", result.note || "Those files are already as they were before the attempt.");
    else if (scope === "file") {
      const name = file.name || file.path;
      toast(`Reverted ${name}`, "good", undo ? { action: undo, duration: 10000 } : undefined);
      setNote(record, "good", `Put back ${name}. A copy of the folder as it was is kept.`, undo ? [{ label: "Undo", run: undo.run, focus: "undo" }] : []);
    } else {
      const reopened = result.reopened === true;
      const tail = reopened ? " The task is reopened." : result.reopenError ? ` The task could not be reopened: ${result.reopenError}` : "";
      toast(`Reverted ${plural(count, "file")}.${reopened ? " The task is reopened." : ""}`, reopened ? "good" : "warn", undo ? { action: undo, duration: 10000 } : undefined);
      setNote(record, reopened ? "good" : "warn", `Put back ${plural(count, "file")}.${tail}${result.note ? ` ${result.note}` : ""} A copy of the folder as it was is kept.`, undo ? [{ label: "Undo the revert", run: undo.run, focus: "undo" }] : []);
    }
    // The attempt's diffs are between its own two pictures, so a revert does not change them.
    await read(record, "changes", { force: true, quiet: true });
  }
  // Why a revert did not happen, in the host's own sentence, and the one safe way on when there is one.
  function refused(record, data, scope, result) {
    const text = say(result?.error, "That could not be reverted. Nothing was changed.");
    const left = (data.files ?? []).filter((file) => file.state === "can-revert").length;
    const choices = scope === "attempt" && result?.refused?.length && left > 0 ? [{ label: `Revert the ${plural(left, "unchanged file")}`, run: () => { void revert(record, { scope: "attempt", partial: true }); }, focus: "partial" }] : [];
    setNote(record, result?.busy ? "warn" : result?.refused?.length ? "warn" : "bad", text, choices);
    void read(record, "changes", { force: true, quiet: true });
  }
  async function undoRevert(record) {
    const saved = record.undo;
    if (!saved) return;
    const result = await act(record, "undo", () => api()?.tasksRevert?.({ taskId: record.taskId, projectId: record.projectId, attempt: saved.attempt, undo: saved.receipt }));
    if (result === null) return;
    if (result?.ok) {
      record.undo = null;
      toast("The files are back as the attempt left them. The task stays open.");
      setNote(record, "good", "The files are back as the attempt left them. The task stays open.");
      await read(record, "changes", { force: true, quiet: true });
    } else setNote(record, result?.refused?.length ? "warn" : "bad", say(result?.error, "That revert can no longer be undone."));
  }

  // ---- Checks ---------------------------------------------------------------------------------------------------------------
  function checksPanel(record) {
    const data = record.checks;
    if (!data) return waiting(record, "checks", "Reading the checks…");
    if (data.available === false) return [el("p", "review-empty", "Advisory checks are switched off on this PC."), ...(data.forced ? [fine("It is switched off for this launch.")] : [])];
    const out = [];
    if (record.errors.checks) out.push(note("warn", record.errors.checks));
    const head = el("div", "review-head");
    head.append(el("strong", "review-totals", "Advisory — never blocks Done"));
    if (data.at) head.append(el("span", "review-fine", `Last run ${ago(data.at)}`));
    out.push(head);
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      out.push(el("p", "review-empty", "No advisory checks found"), fine("Studio looks for lint, typecheck and build scripts in package.json, and for ruff, mypy, cargo check and go vet."));
      return out;
    }
    const runnable = new Set((data.detected ?? []).map((check) => check.id));
    const list = el("div", "review-checks");
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "Advisory checks");
    for (const result of results) {
      const item = el("div", "review-check");
      item.setAttribute("role", "listitem");
      item.dataset.status = result.status;
      const [mark, word] = CHECK_MARKS[result.status] ?? CHECK_MARKS.skipped;
      const badge = el("span", "review-mark", mark);
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", word);
      item.append(badge, el("strong", "review-check-label", result.label || result.id), el("span", "review-check-detail", result.detail || word));
      if (runnable.has(result.id)) {
        const running = record.busy.has(`check:${result.id}`);
        item.append(button(running ? "Running…" : "Run", () => { void runCheck(record, result.id); }, { disabled: running, focus: `run:${result.id}`, aria: `Run ${result.label || result.id}` }));
      }
      if (result.tail) {
        const tail = el("details", "review-tail");
        tail.append(el("summary", "", "Output"), el("pre", "", result.tail));
        item.append(tail);
      }
      list.append(item);
    }
    out.push(list, fine("Lint, typecheck and build results show up here. Builders can run them too while they work. A build writes files, so it only runs when you press Run."));
    return out;
  }
  async function runCheck(record, id) {
    const result = await act(record, `check:${id}`, () => api()?.tasksCheckRun?.({ taskId: record.taskId, projectId: record.projectId, attempt: chosen(record) ?? undefined, id }));
    if (result === null) return;
    if (result?.ok) {
      record.errors.checks = "";
      record.checks = { ...(record.checks ?? { ok: true, available: true }), results: result.results, at: Date.now(), attempt: result.attempt ?? record.checks?.attempt ?? null };
      record.stamps.checks = Date.now();
    } else record.errors.checks = say(result?.error, "That check could not be run.");
    touch(record);
  }

  // ---- Preview ---------------------------------------------------------------------------------------------------------------
  function previewPanel(record) {
    const data = record.evidence;
    if (!data) return waiting(record, "evidence", "Reading the screenshots…");
    const out = [];
    if (record.errors.evidence) out.push(note("warn", record.errors.evidence));
    if (data.enabled === false) out.push(fine(`Screenshots are switched off on this PC, so no new ones are taken.${data.forced ? " It is switched off for this launch." : ""}`));
    const grid = el("div", "review-shots");
    for (const phase of ["before", "after"]) {
      const shot = (data.shots ?? []).find((item) => item.phase === phase);
      const figure = el("figure", "review-shot");
      figure.dataset.phase = phase;
      const frame = el("div", "review-shot-frame");
      if (typeof shot?.dataUrl === "string" && shot.dataUrl.startsWith(PNG_URL)) {
        const image = el("img", "review-shot-image");
        image.src = shot.dataUrl;
        image.alt = phase === "before" ? "The project preview when the task started" : "The project preview when the task finished";
        image.width = shot.width || 1280;
        image.height = shot.height || 800;
        frame.append(image);
      } else frame.append(el("p", "review-empty", shot?.tooBig ? "This picture is too large to show here." : data.notes?.[phase] || (phase === "before" ? "No shot was taken when the task started." : "No shot was taken when the task finished.")));
      const caption = el("figcaption", "review-shot-caption");
      caption.append(el("strong", "", phase === "before" ? "Before" : "After"));
      if (shot) caption.append(el("span", "review-fine", data.notes?.[phase] || ""));
      figure.append(frame, caption);
      grid.append(figure);
    }
    out.push(grid, fine(data.privacy || "Screenshots stay on this PC. They can show secrets, so they are never added to a problem report."));
    return out;
  }

  // ---- the owner's three switches ----------------------------------------------------------------------------------------------
  function settings(record) {
    const box = el("details", "review-settings");
    box.open = shared.settingsOpen;
    box.append(el("summary", "", "What Studio keeps for each attempt"));
    box.addEventListener("toggle", () => {
      if (box.open === shared.settingsOpen) return;
      shared.settingsOpen = box.open;
      if (box.open) void readPrefs(true);
    });
    const prefs = shared.prefs;
    if (!prefs) { box.append(fine(api()?.reviewPrefs ? "Reading the settings…" : "These settings are part of the desktop app.")); return box; }
    box.append(fine("Each is on by default, and switching one off leaves the others running."));
    for (const [key, , label, hint] of SWITCHES) {
      const row = el("label", "switch review-switch");
      const input = el("input");
      input.type = "checkbox";
      const forced = prefs.forced?.[key] === true || (key === "advisoryBuild" && prefs.forced?.advisory === true);
      const needsChecks = key === "advisoryBuild" && prefs.saved?.advisory === false;
      input.checked = !forced && prefs.saved?.[key] === true;
      input.disabled = forced || needsChecks || record.busy.has("prefs");
      input.dataset.focusKey = `pref:${key}`;
      row.append(input, el("span", "track"), el("span", "", label));
      input.addEventListener("change", () => { void setPref(record, key, input.checked); });
      box.append(row, fine(forced ? `${hint} Switched off for this launch.` : needsChecks ? `${hint} It needs the checks above switched on.` : hint));
    }
    return box;
  }
  async function setPref(record, key, value) {
    const result = await act(record, "prefs", () => api()?.reviewPrefs?.({ [key]: value }));
    if (result === null) return;
    if (result?.ok) {
      shared.prefs = result;
      record.stamps = {};
      const name = SWITCHES.find((row) => row[0] === key)?.[1] ?? "That";
      toast(`${name} ${value ? "is on" : "is off"}.`);
      wake(record, { force: true });
    } else toast(say(result?.error, "That setting could not be saved."), "bad");
    touchAll();
  }

  // ---- mounting ---------------------------------------------------------------------------------------------------------------------
  // `fold` is the section's <details> (tasks.js detailFold); its summary is kept, the rest is this page's.
  function mount(fold, { taskId, projectId, panel: only = "", labelledBy = "" } = {}) {
    if (!fold || typeof taskId !== "string" || !taskId) return null;
    if (only) return mountPanel(fold, { taskId, projectId, tab: only, labelledBy });
    subscribe();
    const record = recordFor(projectId, taskId);
    clearTimeout(record.poll);
    record.view = fold;
    record.summary = fold.querySelector?.("summary") ?? null;
    record.body = el("div", "review");
    fold.append(record.body);
    record.open = fold.open === true;
    fold.addEventListener("toggle", () => {
      const open = fold.open === true;
      if (open === record.open) return;
      record.open = open;
      touch(record);
      if (open) wake(record); else clearTimeout(record.poll);
    });
    record.painted = -1;
    touch(record);
    if (!shared.prefs) void readPrefs();
    if (record.open) wake(record);
    return record;
  }

  // One panel on its own, in `host` (a box the caller owns): "changes", "checks" or "preview". It is drawn and read
  // for as long as it is on screen, shares the task's record with every other view of it, and is taken down with
  // the handle's unmount(). `labelledBy` is the id of the caller's tab that names it.
  function mountPanel(host, { taskId, projectId, tab, labelledBy = "" }) {
    if (!TABS.some(([name]) => name === tab)) return null;
    subscribe();
    const record = recordFor(projectId, taskId);
    record.views.get(host)?.body?.remove?.();
    const view = { tab, labelledBy, body: el("div", "review review-bare") };
    host.append(view.body);
    record.views.set(host, view);
    record.painted = -1;
    touch(record);
    if (!shared.prefs) void readPrefs();
    wake(record);
    return {
      record,
      unmount() {
        if (record.views.get(host) !== view) return;
        record.views.delete(host);
        view.body.remove?.();
        if (!showing(record)) clearTimeout(record.poll);
      },
    };
  }
  // What a task's list holds, for a tab label: null until the list has been read or where it is not available.
  function countsOf(taskId, projectId) {
    const record = records.get(keyOf(projectId, taskId));
    const data = record?.changes;
    if (!data || data.available === false || data.attempt == null || data.state === "none") return null;
    return { files: data.totals?.files ?? data.files?.length ?? 0, additions: data.totals?.additions ?? 0, deletions: data.totals?.deletions ?? 0, running: running(data), accepted: data.accepted === true };
  }

  window.MefiReview = {
    mount,
    counts: countsOf,
    // Told (with { taskId, projectId }) each time a task that has a panel on its own was drawn again; the way back is the return value.
    onChange: (callback) => { if (typeof callback !== "function") return () => {}; watchers.add(callback); return () => watchers.delete(callback); },
    // Read again now (after the owner changes a project's files by hand, say).
    refresh: (taskId) => { for (const record of records.values()) if (!taskId || record.taskId === taskId) { record.stamps = {}; wake(record, { force: true }); } },
    state: (taskId, projectId) => { const record = records.get(keyOf(projectId, taskId)); return record ? { tab: record.tab, attempt: chosen(record), open: record.open, changes: record.changes, checks: record.checks, evidence: record.evidence, errors: { ...record.errors } } : null; },
  };
})();
