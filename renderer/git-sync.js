// Git sync: the one Push and Pull control. A status chip (in Vibe's project
// cluster, and at the tail of the section bar on every other page) says where
// the open project stands against GitHub in one word; pressing it opens a
// popover with one plain sentence, the numbers and ONE button that fits the
// state. The words, tone and glyph of every state come from the host's chip
// model (scripts/git-link.cjs through main's git:* channels); this file only
// draws that model and names the action a button stands for, never a command,
// a URL or a path. Save and push (the files, one commit, only what is ticked),
// Publish, Link to a repository and Sign in are dialogs opened from the
// popover, and window.MefiGitSync.showSave / showPublish / showLink /
// showSignIn open them for other surfaces. The chip never pushes on its own:
// a direct outward action asks a second time first (a light two-step), Save
// and push never commits without the dialog, and a public repository needs the
// name typed back. Routine changes are announced through one persistent status
// region and only a failure that blocks work through the alert. Hidden in Zen
// and in the classic shell (git-sync.css). tests/git_sync_ui.test.mjs pins it
// in a vm with a fake bridge (tests/fixtures/git-sync-bridge.cjs).
(function () {
  "use strict";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const api = () => window.mefiStudio;
  const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
  const TONES = new Set(["neutral", "good", "info", "warn", "bad"]);
  const BUSY_KINDS = new Set(["saving", "pushing", "pulling", "publishing", "checking"]);
  const CHECK_EVERY = 60000;   // "Check now" refreshes at most once a minute
  const POLL_MS = 2000;        // the sign-in dialog looks for the account this often
  const ARM_MS = 3000;         // a pressed-once button waits this long for its second press
  const EXIT_MS = 220;         // a closing dialog keeps its place until its fade ends
  const ONEDRIVE_KEY = "mefiStudio.git.oneDriveNote";

  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = String(text); return node; };
  const svgNode = (tag, attrs = {}) => { const node = document.createElementNS(SVG_NS, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value)); return node; };
  const button = (text, cls, onClick) => { const node = el("button", cls, text); node.type = "button"; if (onClick) node.addEventListener("click", onClick); return node; };
  const plain = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : (error?.name === "Error" && error.message) || fallback);
  const toast = (text, kind = "info", options) => { try { window.MefiToast?.(text, kind, options); } catch { /* a toast is a courtesy */ } };
  const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const css = (node, name, value) => { if (node.style?.setProperty) node.style.setProperty(name, value); else if (node.style) node.style[name] = value; };
  const still = () => { try { return document.documentElement?.dataset?.motion === "off" || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches); } catch { return false; } };
  const visible = (node) => Boolean(node) && node.isConnected !== false && !node.closest?.("[hidden]") && (node.getClientRects?.().length ?? 1) > 0;

  // ---- glyphs ---------------------------------------------------------------
  // 16px, currentColor, 1.5 stroke, round caps and joins, no fill (the boards'
  // kit, section 3): one drawing per state id, the way the host names them. A
  // few share a drawing on purpose (success is in-sync, error is the triangle).
  const P = (d, extra = {}) => ["path", { d, ...extra }];
  const C = (cx, cy, r, extra = {}) => ["circle", { cx, cy, r, ...extra }];
  const R = (x, y, width, height, rx) => ["rect", { x, y, width, height, rx }];
  const CLOUD = "M4.5 13a2.9 2.9 0 0 1-.5-5.75 4.1 4.1 0 0 1 7.9-.55A3.15 3.15 0 0 1 11.5 13z";
  const FOLDER = "M2 12.5v-8a1 1 0 0 1 1-1h3.2l1.5 1.7H13a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z";
  const DASHED = { pathLength: 40, "stroke-dasharray": "3 2" };
  const ARC = P("M8 1.4A6.6 6.6 0 1 1 1.4 8", { class: "gs-arc" });
  const REFRESH = [P("M13 8a5 5 0 0 1-8.7 3.4M3 8a5 5 0 0 1 8.7-3.4M12.2 2.2v2.6H9.6M3.8 13.8v-2.6h2.6")];
  const RING_CHECK = [C(8, 8, 6), P("M5.3 8.2 7.2 10l3.5-3.7")];
  const TRIANGLE = [P("M8 2.4 14.4 13.4H1.6z"), P("M8 6.4v3.2M8 11.4h.01")];
  const GLYPHS = {
    "not-repo": [P(FOLDER, DASHED)],
    "no-commits": [P("M1.5 8h3.5"), C(8, 8, 3), P("M11.6 8h.01M14.2 8h.01")],
    "no-remote": [P(CLOUD, DASHED)],
    "other-remote": [P("M6.7 8.7a3.3 3.3 0 0 0 5 .35l2-2a3.3 3.3 0 0 0-4.7-4.7l-1.15 1.15"), P("M9.3 7.3a3.3 3.3 0 0 0-5-.35l-2 2a3.3 3.3 0 0 0 4.7 4.7l1.15-1.15")],
    "signed-out": [P("M8 7.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM2.8 14c.4-2.6 2.4-3.8 5.2-3.8s4.8 1.2 5.2 3.8")],
    checking: REFRESH,
    "in-sync": RING_CHECK,
    ahead: [P("M8 12.5V4M4.8 7.2 8 4l3.2 3.2")],
    behind: [P("M8 3.5V12M4.8 8.8 8 12l3.2-3.2")],
    diverged: [P("M5 13V3M2.6 5.4 5 3l2.4 2.4M11 3v10M8.6 10.6 11 13l2.4-2.4")],
    uncommitted: [P("M4 2.5h5l3 3v8H4zM9 2.5v3h3"), C(8, 10, .75)],
    "other-branch": [C(4, 3.2, 1.4), C(4, 12.8, 1.4), C(12, 5.4, 1.4), P("M4 4.6v6.8M12 6.8c0 2.4-1.6 3.7-8 3.7")],
    "no-upstream": [P(CLOUD), P("M8 11V7.4M6.2 9 8 7.2 9.8 9")],
    offline: [P(CLOUD), P("M2.5 2.5l11 11")],
    "fetch-failed": [P(CLOUD), P("M8 6.6v2.4M8 10.9h.01")],
    "agents-working": [R(1.75, 4.5, 12.5, 7, 3.5), C(5, 8, .6), C(8, 8, .6), C(11, 8, .6)],
    saving: [ARC, P("M5.2 4.4h3.4l2.2 2.2v5H5.2zM8.6 4.4v2.2h2.2"), C(8, 9.3, .55)],
    pushing: [ARC, P("M8 10.8V5.4M5.9 7.5 8 5.4l2.1 2.1")],
    pulling: [ARC, P("M8 5.2v5.4M5.9 8.5 8 10.6l2.1-2.1")],
    publishing: [P(CLOUD, { class: "gs-march", pathLength: 100, "stroke-dasharray": "70 30" }), P("M8 11V7.4M6.2 9 8 7.2 9.8 9")],
    "check-failed": [P("M3 3h10v10H3zM6 6l4 4M10 6l-4 4")],
    "lost-work": [P("M8 1.8 13 3.6v4c0 3-2 5.2-5 6.6-3-1.4-5-3.6-5-6.6v-4z"), P("M5.8 8h4.4")],
    conflict: [P("M3 4h3c3 0 4 8 7 8M3 12h3c3 0 4-8 7-8")],
    "push-refused": [C(8, 8, 6), P("M5 8h6")],
    "blocked-secret": [C(11.5, 5.5, 2.3), P("M9.2 5.5H2.5M3.6 5.5v2.2"), P("M2.5 2.5 13.5 13.5")],
    "too-large": [C(8, 3.7, 1.5), P("M5.2 7.2h5.6l1.7 6.3h-9z")],
    "folder-missing": [P(FOLDER), P("M2.5 2.5l11 11")],
    unknown: [C(8, 8, 6, { "stroke-dasharray": "0.01 3.14" })],
    "pull-refused": [P("M8 3.5V10M4.8 6.8 8 10l3.2-3.2M4.5 13h7")],
    error: TRIANGLE,
    // Small marks the popover and the dialogs draw (not states).
    branch: [P("M4.5 2.5v8.5"), C(4.5, 12.5, 1.5), C(11.5, 4.2, 1.5), P("M11.5 5.7a6.3 6.3 0 0 1-5.5 6.8")],
    upload: [P("M5 11a2.6 2.6 0 0 1-.3-5.1 3.6 3.6 0 0 1 6.9-.6A2.8 2.8 0 0 1 11.5 11"), P("M8 13.5v-6M5.9 9.6 8 7.5l2.1 2.1")],
    download: [P("M5 11a2.6 2.6 0 0 1-.3-5.1 3.6 3.6 0 0 1 6.9-.6A2.8 2.8 0 0 1 11.5 11"), P("M8 7.5v6M5.9 11.4 8 13.5l2.1-2.1")],
    external: [P("M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3")],
    close: [P("M4 4l8 8M12 4l-8 8")],
    check: [P("M3.5 8.5 6.5 11.5 12.5 4.5")],
    pending: [C(8, 8, 5.5)],
    failed: [C(8, 8, 6), P("M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4")],
    refresh: REFRESH,
    spinner: [C(8, 8, 6.25, { opacity: .25 }), P("M8 1.75A6.25 6.25 0 0 1 14.25 8")],
    info: [C(8, 8, 6), P("M8 7.2v3.8M8 4.9h.01")],
    lock: [R(3.5, 7, 9, 6.5, 1.5), P("M5.5 7V5a2.5 2.5 0 0 1 5 0v2")],
    globe: [C(8, 8, 6), P("M2 8h12M8 2c1.7 1.7 2.6 3.7 2.6 6S9.7 12.3 8 14c-1.7-1.7-2.6-3.7-2.6-6S6.3 3.7 8 2z")],
    folder: [P(FOLDER)],
    edit: [P("M3 13l.7-3 7.3-7.3a1.5 1.5 0 0 1 2.1 2.1L5.8 12.1z"), P("M9.7 4.3l2 2")],
    plus: [P("M8 3v10M3 8h10")],
    trash: [P("M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5")],
    search: [C(7, 7, 4.5), P("M10.4 10.4 13.5 13.5")],
  };
  GLYPHS.success = GLYPHS["in-sync"];
  const SPINNING = new Set(["checking", "spinner"]);
  function glyph(name, extra = "") {
    const key = Object.hasOwn(GLYPHS, name) ? name : "unknown";
    const node = svgNode("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: `gs-glyph${SPINNING.has(key) ? " gs-spin" : ""}${extra ? ` ${extra}` : ""}`, "data-glyph": key });
    for (const [tag, attrs] of GLYPHS[key]) node.append(svgNode(tag, attrs));
    return node;
  }

  // ---- the model ----------------------------------------------------------
  // What the host sends is copied into a known shape: text stays text, a tone
  // outside the five is neutral, a repository must look like owner/name.
  function clean(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
    const text = (value, max = 400) => (typeof value === "string" ? value.slice(0, max) : "");
    const number = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
    const action = (row) => (row && typeof row.id === "string" && row.id && typeof row.label === "string" ? { id: text(row.id, 40), label: text(row.label, 90), confirm: row.confirm === true, disabled: row.disabled === true, why: text(row.why, 240) } : null);
    return {
      id: text(raw.id, 40), label: text(raw.label, 60) || text(raw.id, 40), short: text(raw.short, 12), tone: TONES.has(raw.tone) ? raw.tone : "neutral", glyph: text(raw.glyph, 40) || text(raw.id, 40),
      sentence: text(raw.sentence, 1400),
      // Which project this model is about (the host adds it): actions drawn from it name it, and the host refuses them after a switch.
      projectId: text(raw.projectId, 120),
      details: Array.isArray(raw.details) ? raw.details.filter((line) => typeof line === "string").slice(0, 60).map((line) => line.slice(0, 400)) : [],
      branch: text(raw.branch, 120), repo: REPO.test(String(raw.repo ?? "")) ? raw.repo : "",
      checkedAt: Number.isFinite(raw.checkedAt) && raw.checkedAt > 0 ? raw.checkedAt : null,
      counts: { ahead: number(raw.counts?.ahead), behind: number(raw.counts?.behind), dirty: number(raw.counts?.dirty) },
      primary: action(raw.primary), secondary: action(raw.secondary),
      busy: BUSY_KINDS.has(raw.busy) ? raw.busy : null,
      // Optional: a host that reports the stages of a long operation as it goes.
      stages: Array.isArray(raw.stages) ? raw.stages.slice(0, 8).filter((stage) => stage && typeof stage.label === "string").map((stage) => ({ label: text(stage.label, 120), state: ["done", "active", "waiting", "failed"].includes(stage.state) ? stage.state : "waiting" })) : null,
    };
  }
  const state = { model: null, inflight: null, last: null, lastCheck: 0, project: { id: null, name: "" }, epoch: 0 };
  // Pressing a button answers at once even when the host is slow to say so:
  // while this window's own call is out, the chip shows that working state.
  const BUSY_VIEW = {
    saving: ["Saving…", "info", "Saving on this PC."],
    pushing: ["Pushing…", "info", "Pushing to GitHub."],
    pulling: ["Pulling…", "info", "Getting what GitHub has."],
    publishing: ["Publishing…", "info", "Creating the repository and uploading the project."],
    checking: ["Checking…", "neutral", "Looking at GitHub. Nothing is being changed."],
  };
  function view() {
    const base = state.model;
    if (!base || !state.inflight || base.busy === state.inflight) return base;
    const [label, tone, sentence] = BUSY_VIEW[state.inflight];
    return { ...base, id: state.inflight, label, tone, glyph: state.inflight, sentence, details: [], primary: null, secondary: null, busy: state.inflight, stages: null };
  }
  const projectName = () => state.project.name || "this project";
  // The project an action was drawn for: the chip's model says, else the one open now. The host refuses the call
  // if another project is open by the time it arrives.
  const boundTo = () => { const id = state.model?.projectId || state.project.id; return typeof id === "string" && id ? { projectId: id } : {}; };
  // What the chip shows when it has no room for words: the host's own short, else the count of what is waiting.
  const countOf = (model) => (/^\d+$/.test(model.short) ? Number(model.short) : model.id === "ahead" ? model.counts.ahead : model.id === "behind" ? model.counts.behind : model.id === "uncommitted" ? model.counts.dirty : 0);
  function ago(at, now = Date.now()) {
    const seconds = Math.max(0, Math.round((now - at) / 1000));
    if (seconds < 45) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes <= 1 ? "1 minute ago" : `${minutes} minutes ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  const size = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : bytes >= 1e3 ? `${Math.round(bytes / 1e3)} KB` : `${bytes} B`);
  const wordsIn = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

  // ---- the live regions (the only announcers: dialogs keep their own note) ----
  let layerEl = null, statusEl = null, alertEl = null;
  function layer() {
    if (layerEl) return layerEl;
    layerEl = el("div", "gs-layer");
    layerEl.id = "git-sync-layer";
    statusEl = el("p", "sr-only");
    statusEl.id = "git-sync-status";
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");
    alertEl = el("p", "sr-only");
    alertEl.id = "git-sync-alert";
    alertEl.setAttribute("role", "alert");
    alertEl.setAttribute("aria-live", "assertive");
    layerEl.append(statusEl, alertEl);
    document.body.append(layerEl);
    return layerEl;
  }
  function announce(text, { alert = false } = {}) {
    layer();
    const region = alert ? alertEl : statusEl;
    region.textContent = "";
    region.textContent = String(text ?? "");
  }

  // ---- chips ---------------------------------------------------------------
  const mounts = [];
  function makeMount(host, variant) {
    const slot = el("span", "gs-slot");
    slot.dataset.variant = variant;
    slot.hidden = true;
    const chip = button("", "gs-chip");
    chip.setAttribute("aria-haspopup", "dialog");
    chip.setAttribute("aria-expanded", "false");
    chip.setAttribute("aria-controls", "git-sync-pop");
    const label = el("span", "gs-chip-label");
    const badge = el("span", "gs-chip-badge");
    badge.setAttribute("aria-hidden", "true");
    badge.hidden = true;
    chip.append(label, badge);
    slot.append(chip);
    const entry = { host, slot, chip, label, badge, variant, sig: "", glyphNode: null };
    chip.addEventListener("click", () => { if (pop.open && pop.opener === chip) close(); else openFrom(chip); });
    chip.addEventListener("keydown", popKeys);
    return entry;
  }
  const kids = (host) => Array.from(host.children ?? []);
  // Whether the chip already sits where it goes: nav.js asks on every repaint of
  // the bar, so this is the cheap answer (no list is built in a browser).
  function inPlace({ host, slot }, after) {
    if (slot.parentNode !== host) return false;
    if (after && after.parentNode === host) return (slot.previousElementSibling ?? kids(host)[kids(host).indexOf(slot) - 1]) === after;
    return (host.lastElementChild ?? kids(host).at(-1)) === slot;
  }
  function place(entry, options) {
    const { host, slot } = entry;
    const after = options.after;
    if (after && after.parentNode === host) {
      const list = kids(host);
      host.insertBefore(slot, list[list.indexOf(after) + 1] ?? null);
    } else host.append(slot);
  }
  // A surface hands over the place its chip goes (nav.js: the tail of the
  // section bar; vibe.js: right after New app). Calling again is harmless, and
  // it puts the chip back when the bar was rebuilt around it.
  function mount(host, options = {}) {
    if (!host || typeof host.append !== "function") return null;
    let entry = mounts.find((item) => item.host === host);
    if (entry && inPlace(entry, options.after)) return entry.slot;
    layer();
    const fresh = !entry;
    if (fresh) { entry = makeMount(host, ["vibe", "list"].includes(options.variant) ? options.variant : "bar"); mounts.push(entry); }
    place(entry, options);
    if (fresh) paintMount(entry, view());
    return entry.slot;
  }
  function paintMount(entry, model) {
    const on = Boolean(model);
    if (entry.slot.hidden !== !on) entry.slot.hidden = !on;
    if (!on) { entry.sig = ""; return; }
    const badge = countOf(model);
    // A session list's head (the 0.5 frame) carries the branch in the chip, before the state: "main | 3 changes".
    const branch = entry.variant === "list" ? model.branch : "";
    const sig = `${model.id}|${model.label}|${model.tone}|${model.glyph}|${badge}|${branch}`;
    if (entry.sig === sig) return;
    entry.sig = sig;
    const { chip } = entry;
    chip.dataset.state = model.id;
    chip.dataset.tone = model.tone;
    // The name says what the chip is (its words alone, "2 to push", do not) and still holds the visible label.
    chip.setAttribute("aria-label", `GitHub sync: ${branch ? `${branch}, ` : ""}${model.label}`);
    chip.title = `GitHub sync: ${branch ? `${branch} · ` : ""}${model.label}`;
    entry.label.textContent = model.label;
    entry.badge.textContent = String(badge);
    entry.badge.hidden = !badge || entry.variant === "list";
    entry.glyphNode = glyph(glyphFor(model));
    if (branch) {
      const name = el("span", "gs-chip-branch");
      name.append(glyph("other-branch"), el("span", "gs-chip-branch-name", branch));
      chip.replaceChildren(name, el("i", "gs-chip-sep"), entry.glyphNode, entry.label, entry.badge);
    } else chip.replaceChildren(entry.glyphNode, entry.label, entry.badge);
  }
  function paintAll() {
    const model = view();
    for (const entry of mounts) paintMount(entry, model);
    announceChange(model);
    if (pop.open) paintPop();
  }
  // Each change is read out once: the new label, never on the first look.
  let announced = null;
  function announceChange(model) {
    const key = model ? `${model.id}|${model.label}` : "";
    if (key === announced) return;
    const first = announced === null;
    announced = key;
    if (!first && model) announce(`GitHub sync: ${model.label}`);
  }

  // ---- what a button stands for -------------------------------------------
  // The direct moves that ask twice when the host marks them (confirm): the ones
  // that send something off this PC or change its history. A dialog opener never does.
  const ARMED = new Set(["push", "push-branch", "pull", "pull-anyway", "rebase"]);
  const PRIMARY_GLYPH = { push: "upload", "push-branch": "upload", publish: "upload", "save-and-push": "upload", pull: "download", "pull-anyway": "download", check: "refresh", retry: "refresh" };
  const LINES_SHOWN = 3;
  const EXPANDING = /^(show|details?$|more$)/;
  const CLOSING = /^(not-now|publish-later|later|wait|dismiss|done)/;
  const LEAVING = /^leave/;
  const openRepo = (repo) => {
    if (!REPO.test(String(repo ?? ""))) return;
    const url = `https://github.com/${repo}`;
    if (typeof api()?.openExternal === "function") Promise.resolve(api().openExternal(url)).catch(() => {});
    else window.open?.(url, "_blank", "noopener");
  };
  // Ask Mefi: the one existing door that stages a message for Mefi is Vibe's
  // brief (an editable draft the owner reads and sends), so that is what these
  // open, and only when it is there.
  const canAsk = () => typeof window.MefiVibe?.composeEvolution === "function";
  function askMefi(model) {
    const lines = [model.sentence, ...model.details.slice(0, 8)].filter(Boolean).join("\n");
    close({ restore: false });
    return Boolean(window.MefiVibe?.composeEvolution?.({ intent: "fix", title: model.label ? `GitHub sync: ${model.label}` : "GitHub sync", prompt: lines }));
  }
  // Every action id the host can name that this window has a door for; the rest
  // (Start a branch, Add permission, Open the folder, Remove from list ...) are
  // left undrawn until a door exists, never drawn dead.
  const DOORS = new Set(["push", "push-branch", "pull", "pull-anyway", "rebase", "check", "retry", "publish", "setup-git", "sign-in", "install-gh", "install-git", "save-and-push", "save", "save-first", "link", "open-github", "find-folder"]);
  const known = (id) => DOORS.has(id) || EXPANDING.test(id) || CLOSING.test(id) || LEAVING.test(id) || (/^ask/.test(id) && canAsk());
  // The state's own glyph, or its id's drawing when the host names none.
  const glyphFor = (model) => (Object.hasOwn(GLYPHS, model.glyph) ? model.glyph : model.id);

  // One remote operation at a time: a second press while one is out does nothing.
  async function remote(kind, call, name = kind) {
    if (state.inflight) return null;
    state.inflight = kind;
    state.last = name;
    paintAll();
    let result;
    try { result = await call(); } catch (error) { result = { ok: false, error: plain(error, "Studio did not answer.") }; }
    state.inflight = null;
    if (result?.model) state.model = clean(result.model) ?? state.model;
    paintAll();
    return result ?? { ok: false };
  }
  // A second operation while one is out is refused, not queued behind a dialog that waits.
  const STILL_BUSY = "Another GitHub action is still running. Try again in a moment.";
  const RESULT_TEXT = { push: "Pushed to GitHub.", pull: "Pulled from GitHub.", rebase: "Put your commits on top of GitHub's." };
  // Results come back as toasts; a failure that blocks work also goes to the alert.
  function report(name, result) {
    const model = state.model;
    if (result?.ok === false) {
      const text = wordsIn(result?.error) || model?.sentence || "That did not work. Nothing was changed.";
      toast(text, model?.tone === "warn" ? "warn" : "bad");
      announce(text, { alert: true });
      return;
    }
    if (name === "check") return;
    const text = model?.id === "success" && model.sentence ? model.sentence : RESULT_TEXT[name] ?? "Done.";
    toast(text, "good", model?.repo && name === "push" ? { action: { label: "Open on GitHub", run: () => openRepo(model.repo) } } : undefined);
  }
  async function check({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - Math.max(state.lastCheck, state.model?.checkedAt ?? 0) < CHECK_EVERY) return null;
    if (typeof api()?.gitCheck !== "function") return null;
    state.lastCheck = now;
    // Check now wakes up again when the minute is over.
    setTimeout(() => { if (pop.open) { pop.sig = ""; paintPop(); } }, CHECK_EVERY + 500);
    const result = await remote("checking", () => api().gitCheck(boundTo()), "check");
    report("check", result);
    return result;
  }
  async function perform(id) {
    const model = state.model;
    if (EXPANDING.test(id)) { pop.expanded = !pop.expanded; pop.sig = ""; paintPop(); return null; }
    if (CLOSING.test(id)) { close(); return null; }
    if (LEAVING.test(id)) return handOff(() => showSave({ push: true }));
    if (/^ask/.test(id)) { askMefi(model ?? { sentence: "", details: [], label: "" }); return null; }
    const call = (name, ...args) => (typeof api()?.[name] === "function" ? api()[name](...args) : Promise.resolve({ ok: false, error: "That works in the desktop app." }));
    switch (id) {
      case "push": case "push-branch": return finish("push", await remote("pushing", () => call("gitPush", boundTo()), "push"));
      case "pull": return finish("pull", await remote("pulling", () => call("gitPull", boundTo()), "pull"));
      case "pull-anyway": return finish("pull", await remote("pulling", () => call("gitPull", { anyway: true, ...boundTo() }), "pull"));
      case "rebase": return finish("rebase", await remote("pushing", () => call("gitRebase", boundTo()), "rebase"));
      case "check": return check({ force: true });
      case "retry": return state.last && state.last !== "check" ? perform(state.last) : check({ force: true });
      case "open-github": openRepo(model?.repo); return null;
      case "find-folder": return finish("folder", await remote("checking", () => call("projectsAdd"), "check"));
      case "install-gh": case "install-git": {
        const started = await call("pcSetupAction", id);
        toast(started?.ok ? wordsIn(started.message) : wordsIn(started?.error) || "The setup window did not open.", started?.ok ? "info" : "warn");
        return started;
      }
      case "publish": case "setup-git": return handOff(() => showPublish());
      case "sign-in": return handOff(() => showSignIn());
      case "save-and-push": return handOff(() => showSave({ push: true }));
      case "save": case "save-first": return handOff(() => showSave({ push: false }));
      case "link": return handOff(() => showLink());
      default: return check({ force: true });
    }
  }
  const finish = (name, result) => { if (result) report(name, result); return result; };
  // A dialog opened from the popover: the popover steps aside and focus comes
  // back to the chip when the dialog closes.
  let returnTo = null;
  function handOff(open) { returnTo = pop.opener; close({ restore: false }); return open(); }

  // ---- the popover ----------------------------------------------------------
  const pop = { root: null, opener: null, open: false, sig: "", expanded: false, armed: null, armTimer: 0, tick: 0, checked: null, painting: false, listening: false };
  function popRoot() {
    if (pop.root) return pop.root;
    const root = el("section", "gs-pop");
    root.id = "git-sync-pop";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "GitHub sync");
    root.tabIndex = -1;
    root.hidden = true;
    root.addEventListener("keydown", popKeys);
    root.addEventListener("focusout", (event) => {
      if (pop.painting || !pop.open) return;
      const next = event.relatedTarget;
      if (next && (root.contains(next) || pop.opener?.contains(next))) return;
      // Focus moved on to something else on purpose: let the popover go without
      // taking the focus back from it.
      setTimeout(() => {
        const at = document.activeElement;
        if (pop.open && at && at !== document.body && !root.contains(at) && !pop.opener?.contains(at)) close({ restore: false });
      }, 0);
    });
    layer().append(root);
    pop.root = root;
    return root;
  }
  function popKeys(event) {
    if (!pop.open) return;
    if (event.key === "Tab") { tabOut(event); return; }
    if (event.key !== "Escape") {
      // Enter, Space and the arrows mean nothing on the popover itself, and Command behind it would read them as its selected node's.
      if (pop.root?.contains?.(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Enter" || event.key === " " || /^(?:Arrow|Home$|End$|Page)/.test(String(event.key)))) event.stopPropagation?.();
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    if (pop.armed) { disarm(); pop.sig = ""; paintPop(); return; }
    close();
  }
  // The popover is the last thing in the page (it is fixed, so where it sits in the tree does not show), so a Tab past
  // either end would land far from the chip. Tab leaves by way of the chip instead: Shift+Tab from the top goes back to
  // it, and Tab from the bottom carries on from it to whatever follows.
  function tabOut(event) {
    const root = pop.root;
    const at = document.activeElement;
    if (!root || !root.contains?.(at)) return;
    const items = focusables(root);
    const backward = event.shiftKey === true;
    if (items.length && !(backward ? at === root || at === items[0] : at === items.at(-1))) return;
    close();
    if (backward) event.preventDefault?.();
  }
  function firstChip() { return mounts.find((entry) => !entry.slot.hidden && visible(entry.chip))?.chip ?? null; }
  function openFrom(chip) {
    if (!view() || !chip) return false;
    if (pop.open && pop.opener && pop.opener !== chip) pop.opener.setAttribute("aria-expanded", "false");
    pop.opener = chip;
    pop.expanded = false;
    pop.sig = "";
    disarm();
    const root = popRoot();
    pop.open = true;
    paintPop();
    root.hidden = false;
    chip.setAttribute("aria-expanded", "true");
    position();
    root.focus?.({ preventScroll: true });
    listen(true);
    // The local half of the picture is cheap to read again.
    void refresh();
    return true;
  }
  function open() { return openFrom(firstChip()); }
  function close({ restore = true } = {}) {
    if (!pop.open) return false;
    pop.open = false;
    disarm();
    listen(false);
    const opener = pop.opener;
    pop.root.hidden = true;
    opener?.setAttribute("aria-expanded", "false");
    if (restore && opener?.isConnected !== false) opener?.focus?.({ preventScroll: true });
    return true;
  }
  const away = (event) => { if (pop.open && !pop.root.contains(event.target) && !pop.opener?.contains(event.target)) close({ restore: false }); };
  const blurred = () => close({ restore: false });
  function listen(on) {
    if (on === pop.listening) return;
    pop.listening = on;
    const act = on ? "addEventListener" : "removeEventListener";
    document[act]?.("pointerdown", away, true);
    window[act]?.("blur", blurred);
    window[act]?.("resize", position);
    clearInterval(pop.tick);
    pop.tick = on ? setInterval(() => { paintPop(); footerTick(); }, 30000) : 0;
  }
  function position() {
    if (!pop.open || !pop.opener) return;
    const root = pop.root;
    const box = pop.opener.getBoundingClientRect();
    // What it wants first: a height capped for an earlier place must not decide this one.
    css(root, "max-height", "");
    // The layout size, not the drawn one: the popover opens through a scale.
    const rect = root.getBoundingClientRect();
    const width = root.offsetWidth || rect.width || 340, height = root.offsetHeight || rect.height || 0;
    // Layout v2 keeps it inside the free area (nav.js usable()); v1 is the window.
    const area = window.MefiNav?.layout?.on?.() ? window.MefiNav.usable() : null;
    const wide = area ? area.right : window.innerWidth || 1920, tall = area ? area.bottom : window.innerHeight || 1080;
    const edge = area ? area.left : 0, roof = area ? area.top : 0;
    const right = box.left + box.width / 2 > (edge + wide) / 2;
    const left = Math.max(edge + 12, Math.min(right ? box.right - width : box.left, wide - width - 12));
    const flip = box.bottom + 8 + height > tall - 12 && box.top - 8 - height >= roof + 12;
    const top = flip ? box.top - 8 - height : box.bottom + 8;
    css(root, "left", `${Math.round(left)}px`);
    css(root, "top", `${Math.max(roof + 8, Math.round(top))}px`);
    // A long list (Show more) scrolls inside the room that is left, so the footer never ends up below the window.
    css(root, "max-height", `${Math.max(160, Math.floor(tall - Math.max(roof + 8, top) - 12))}px`);
    css(root, "--gs-from", `${flip ? "bottom" : "top"} ${right ? "right" : "left"}`);
  }
  function disarm() {
    clearTimeout(pop.armTimer);
    pop.armTimer = 0;
    pop.armed = null;
  }
  const bar = () => el("div", "gs-foot-row");
  const link = (text, onClick, extra = "") => button(text, `gs-link${extra ? ` ${extra}` : ""}`, onClick);

  // The numbers under the sentence, as the boards draw them.
  function facts(model) {
    const rows = [];
    const { ahead, behind, dirty } = model.counts;
    const branch = model.branch || "this branch";
    if (model.id === "in-sync") rows.push(["Not pushed", "Nothing"]);
    if (ahead && model.id !== "diverged") rows.push(["Not pushed", `${count(ahead, "commit")} on ${branch}`]);
    if (behind && model.id !== "diverged") rows.push(["Not pulled", `${count(behind, "commit")} on ${branch}`]);
    if (dirty) rows.push(["Not saved", `${count(dirty, "file")} on this PC`]);
    if (model.repo) rows.push(["On GitHub", model.repo, true]);
    else if (model.id === "no-remote") rows.push(["On GitHub", "Not linked yet"]);
    return rows;
  }
  // The hints the boards set apart from the detail lines. The host words them
  // too (in details), so a copy of one is not shown twice.
  const HINT_TOP = { "signed-out": "You sign in on GitHub's own page. Studio never asks for your password.", uncommitted: "Uncommitted files stay on this PC unless you save them." };
  const HINT_BELOW = { "no-remote": "You choose the name and who can see it next. Private is the default.", diverged: "Both sets of work stay. If the same lines clash, nothing is changed." };
  // Detail lines that only say again what the numbers above them do.
  const SAID_ABOVE = [/^\d+ commits? on .+ not (?:pushed|pulled) yet\.$/, /^\d+ commits? on (?:this PC not on GitHub|GitHub not on this PC)\.$/, /^\d+ uncommitted files? in this checkout\.$/];
  const NO_FOOT_CHECK = new Set(["not-repo", "no-commits", "no-remote", "other-remote", "signed-out", "folder-missing", "unknown"]);
  const linesOf = (model) => model.details.filter((line) => line !== HINT_TOP[model.id] && line !== HINT_BELOW[model.id] && !SAID_ABOVE.some((pattern) => pattern.test(line)));

  const STAGE_MARK = { done: "success", active: "spinner", waiting: "pending", step: "pending", failed: "failed" };
  const STAGE_WORD = { done: "done", active: "in progress", waiting: "waiting", step: "", failed: "failed" };
  function stageList(stages, label) {
    const list = el("ol", "gs-stages");
    list.setAttribute("aria-label", label);
    for (const stage of stages) {
      const row = el("li", "gs-stage");
      row.dataset.state = stage.state;
      row.append(glyph(STAGE_MARK[stage.state], `gs-mark-${stage.state}`), el("span", "gs-stage-label", stage.label));
      if (STAGE_WORD[stage.state]) row.append(el("span", "sr-only", STAGE_WORD[stage.state]));
      list.append(row);
    }
    return list;
  }
  // The steps a working state goes through: the host's own (stages), else the
  // lines it lists, drawn as a plain list because nothing says how far it got.
  const stepsOf = (model) => (model.stages?.length ? model.stages : model.details.map((label) => ({ label, state: "step" })));

  // A button that asks twice when the host marks it as one to confirm: the
  // first press arms it (the words under it say so), the second sends. Time,
  // Esc and leaving the button disarm it.
  function press(node, action, slot, run) {
    const key = `${slot}:${action.id}`;
    node.addEventListener("click", () => {
      if (action.disabled) return;
      if (action.confirm && ARMED.has(action.id) && pop.armed !== key) {
        pop.armed = key;
        clearTimeout(pop.armTimer);
        pop.armTimer = setTimeout(() => { if (pop.armed === key) { disarm(); pop.sig = ""; paintPop(); } }, ARM_MS);
        announce(`Press again to ${action.label.charAt(0).toLowerCase()}${action.label.slice(1)}.`);
        pop.sig = "";
        paintPop();
        return;
      }
      disarm();
      run();
    });
    node.addEventListener("blur", () => { if (pop.armed === key && !pop.painting) { disarm(); pop.sig = ""; paintPop(); } });
    // Held by the host: it stays in the tab order and says why (aria-disabled, as the boards draw it) rather than dropping out of it.
    if (action.disabled) { node.setAttribute("aria-disabled", "true"); node.classList.add("gs-held"); }
    const armed = pop.armed === key;
    node.classList.toggle("gs-armed", armed);
    if (armed) node.setAttribute("aria-pressed", "true");
    return armed;
  }

  function buildPop(model) {
    const nodes = [];
    // Title row: branch, the state as a small static chip, close.
    const head = el("header", "gs-pop-head");
    const chipLike = el("span", "gs-chip gs-chip-static");
    chipLike.dataset.state = model.id;
    chipLike.dataset.tone = model.tone;
    chipLike.append(glyph(glyphFor(model)), el("span", "gs-chip-label", model.label));
    const shut = button("", "gs-icon", () => close());
    shut.append(glyph("close"));
    shut.setAttribute("aria-label", "Close");
    shut.title = "Close (Esc)";
    shut.dataset.role = "close";
    const tail = el("span", "gs-pop-tail");
    tail.append(chipLike, shut);
    head.append(glyph("branch", "gs-muted-glyph"), el("span", "gs-branch", model.branch || projectName()), tail);
    nodes.push(head);

    const body = el("div", "gs-pop-body");
    const steps = model.busy ? stepsOf(model) : [];
    // A working state that lists its steps shows them instead of running them together as a sentence.
    if (!steps.length) {
      const lead = el("div", "gs-lead");
      if (model.id === "success") lead.append(glyph("success", "gs-good"));
      lead.append(el("p", "gs-sentence", model.sentence || model.label));
      body.append(lead);
    } else body.append(stageList(steps, model.busy === "publishing" ? "Publish progress" : "Push progress"));
    if (HINT_TOP[model.id]) body.append(el("p", "gs-hint", HINT_TOP[model.id]));

    const lines = model.busy ? [] : linesOf(model);
    if (!model.busy) {
      if (model.id === "diverged" && (model.counts.ahead || model.counts.behind)) {
        const split = el("div", "gs-split");
        for (const [who, n, words] of [["This PC", model.counts.ahead, "not on GitHub"], ["GitHub", model.counts.behind, "not on this PC"]]) {
          const cell = el("div", "gs-cell");
          cell.append(el("span", "gs-cell-who", who), el("strong", "", count(n, "commit")), el("span", "gs-cell-words", words));
          split.append(cell);
        }
        body.append(split);
      }
      const rows = facts(model);
      if (rows.length) {
        const list = el("dl", "gs-facts");
        for (const [term, value, isMono] of rows) list.append(el("dt", "", term), isMono ? el("dd", "gs-mono", value) : el("dd", "", value));
        body.append(list);
      }
      // The first three detail lines show; a long list (a checkout with a dozen
      // worktrees) waits behind "Show N more", or the state's own Show button.
      if (lines.length) {
        const shown = pop.expanded ? lines : lines.slice(0, LINES_SHOWN);
        const list = el("ul", model.tone === "bad" ? "gs-lines gs-output" : "gs-lines");
        for (const line of shown) list.append(el("li", "", line));
        body.append(list);
        if (!pop.expanded && lines.length > LINES_SHOWN && !EXPANDING.test(model.secondary?.id ?? "")) body.append(link(`Show ${lines.length - LINES_SHOWN} more`, () => { pop.expanded = true; pop.sig = ""; paintPop(); }, "gs-more"));
      }
    }

    // One primary, one text secondary.
    const actions = el("div", "gs-actions");
    const primary = model.primary && known(model.primary.id) ? model.primary : null;
    if (model.busy) {
      const working = button("", "primary gs-primary", null);
      // Held, not disabled: the button that was pressed keeps the focus while it works (a disabled one would drop it to the popover).
      working.setAttribute("aria-disabled", "true");
      working.classList.add("gs-held");
      working.append(glyph("spinner"), el("span", "", model.label));
      working.dataset.role = "primary";
      actions.append(working);
    } else if (primary) {
      const action = button("", "primary gs-primary", null);
      const mark = PRIMARY_GLYPH[primary.id];
      if (mark) action.append(glyph(mark));
      action.append(el("span", "", primary.label));
      action.dataset.role = "primary";
      action.dataset.action = primary.id;
      if (primary.why) action.title = primary.why;
      const armed = press(action, primary, "primary", () => { void perform(primary.id); });
      actions.append(action);
      if (armed) actions.append(el("p", "gs-hint gs-armed-note", "Press again to confirm. Nothing is sent until you do."));
      else if (primary.disabled && primary.why) {
        const why = el("p", "gs-hint", primary.why);
        why.id = "git-sync-why";
        action.setAttribute("aria-describedby", why.id);
        actions.append(why);
      }
      else if (HINT_BELOW[model.id]) actions.append(el("p", "gs-hint", HINT_BELOW[model.id]));
    }
    const second = model.secondary;
    // A Show button with nothing more to show, or a button for a door this
    // build does not have, is left out rather than drawn dead.
    if (second && known(second.id) && !(EXPANDING.test(second.id) && lines.length <= LINES_SHOWN)) {
      const item = link(EXPANDING.test(second.id) && pop.expanded ? "Show less" : second.label, null);
      item.dataset.role = "secondary";
      item.dataset.action = second.id;
      const armedSecond = press(item, second, "secondary", () => { void perform(second.id); });
      actions.append(item);
      if (armedSecond) actions.append(el("p", "gs-hint gs-armed-note", "Press again to confirm. Nothing is sent until you do."));
    }
    if (actions.children.length) body.append(actions);
    nodes.push(body);

    // Footer: when it was last looked at, Check now, and the two doors out.
    const foot = el("footer", "gs-pop-foot");
    const first = bar();
    const linked = Boolean(model.repo) && !NO_FOOT_CHECK.has(model.id);
    if (model.checkedAt && linked) {
      pop.checked = el("span", "gs-when", `Last checked ${ago(model.checkedAt)}`);
      first.append(pop.checked);
      if (!model.busy && primary?.id !== "check") {
        first.append(el("span", "gs-sep", "·"));
        const recent = Date.now() - Math.max(state.lastCheck, model.checkedAt) < CHECK_EVERY;
        const now = link("Check now", () => { void check(); });
        now.dataset.role = "check-now";
        if (recent) { now.setAttribute("aria-disabled", "true"); now.title = "Checked a moment ago"; }
        first.append(now);
      }
    } else pop.checked = null;
    const doors = bar();
    if (linked && second?.id !== "open-github" && primary?.id !== "open-github") {
      const anchor = el("a", "gs-link", "Open on GitHub");
      anchor.href = `https://github.com/${model.repo}`;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      anchor.dataset.role = "open-github";
      anchor.addEventListener("click", (event) => { event.preventDefault?.(); openRepo(model.repo); });
      doors.append(anchor, el("span", "gs-sep", "·"));
    }
    const friends = link("Details in Friends › Your PCs", openFriends);
    friends.dataset.role = "friends";
    doors.append(friends);
    if (first.children.length) foot.append(first);
    foot.append(doors);
    // A state that is working shows its steps and nothing under them.
    if (!model.busy) nodes.push(foot);
    return nodes;
  }
  // Friends' hub holds the full card; its stage is where the section opens.
  function openFriends() {
    close({ restore: false });
    if (window.MefiCompanionHub?.open?.()) document.querySelector?.('[data-hub-section="friends"]')?.click?.();
  }
  function footerTick() {
    const model = state.model;
    if (pop.open && pop.checked && model?.checkedAt) pop.checked.textContent = `Last checked ${ago(model.checkedAt)}`;
  }
  function paintPop() {
    if (!pop.open) return;
    const model = view();
    if (!model || !visible(pop.opener)) { close({ restore: false }); return; }
    const sig = JSON.stringify([model, pop.expanded, pop.armed, Math.floor((Date.now() - Math.max(state.lastCheck, model.checkedAt ?? 0)) / CHECK_EVERY) > 0]);
    if (sig === pop.sig) { footerTick(); return; }
    pop.sig = sig;
    const root = pop.root;
    const held = root.contains(document.activeElement) ? document.activeElement?.dataset?.role ?? null : null;
    pop.painting = true;
    root.setAttribute("aria-label", `GitHub sync for ${projectName()}`);
    root.dataset.tone = model.tone;
    root.replaceChildren(...buildPop(model));
    if (held) {
      const again = Array.from(root.querySelectorAll("[data-role]")).find((node) => node.dataset.role === held && !node.disabled);
      if (again) again.focus?.({ preventScroll: true }); else root.focus?.({ preventScroll: true });
    }
    pop.painting = false;
    position();
  }

  // ---- reading the host -------------------------------------------------------
  async function refresh() {
    if (typeof api()?.gitState !== "function") return;
    const epoch = state.epoch;
    let answer = null;
    try { answer = await api().gitState(); } catch { answer = null; }
    if (epoch !== state.epoch || state.inflight) return;
    state.model = answer?.ok && answer.model ? clean(answer.model) : null;
    paintAll();
  }
  function accept(raw) {
    if (state.inflight) { const model = clean(raw); if (model) state.model = model; return; }
    state.model = clean(raw);
    paintAll();
  }
  async function readProject() {
    if (typeof api()?.projectsList !== "function") return;
    try {
      const list = await api().projectsList();
      const found = list?.projects?.find?.((item) => item.id === list.activeId);
      state.project = { id: found?.id ?? null, name: String(found?.name ?? "").slice(0, 120) };
    } catch { /* the name is only a label */ }
  }
  function forget() {
    state.epoch += 1;
    state.model = null;
    state.lastCheck = 0;
    state.last = null;
    announced = null;
    close({ restore: false });
    for (const name of [...dialogs.keys()]) dialogs.get(name)?.close({ canceled: true, silent: true });
    paintAll();
    void readProject();
    void refresh();
  }

  // ---- dialogs ------------------------------------------------------------------
  const dialogs = new Map();
  const stack = [];
  const FOCUSABLE = "button, input, select, textarea, a[href]";
  function focusables(root) {
    // A NodeList has no filter: it is copied to an array first.
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((node) => !node.disabled && node.tabIndex !== -1 && visible(node));
  }
  // A modal dialog on the shared overlay and sheet (styles.css "presence"): a
  // scrim, the sheet rising on the spring, Escape and Close, Tab kept inside,
  // and the focus back where it came from. done resolves with what the dialog
  // ended with, so a surface that opened it can wait.
  function dialog({ key, label, eyebrow, title, width = 480 }) {
    if (dialogs.has(key)) return null;
    const below = stack.at(-1) ?? null;
    if (below) { below.overlay.inert = true; below.lastFocus = document.activeElement; }
    const overlay = el("div", "overlay gs-overlay");
    const sheet = el("section", "sheet gs-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", label);
    sheet.tabIndex = -1;
    css(sheet, "--gs-w", `${width}px`);
    const head = el("header", "gs-dialog-head");
    const words = el("div", "gs-dialog-words");
    words.append(el("span", "gs-eyebrow", eyebrow), el("h2", "", title));
    const x = button("", "gs-icon", () => dlg.request());
    x.append(glyph("close"));
    x.setAttribute("aria-label", "Close");
    head.append(words, x);
    const body = el("div", "gs-dialog-body");
    const foot = el("footer", "gs-dialog-foot");
    const note = el("p", "gs-dialog-note");
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    note.setAttribute("aria-atomic", "true");
    const buttons = el("div", "gs-dialog-buttons");
    foot.append(note, buttons);
    sheet.append(head, body, foot);
    overlay.append(sheet);
    let resolve = () => {};
    const done = new Promise((settle) => { resolve = settle; });
    const from = returnTo ?? document.activeElement;
    returnTo = null;
    const dlg = {
      key, overlay, sheet, body, buttons, note, closeButton: x, done, closed: false, busy: false, lastFocus: null, exits: [],
      // The X, Escape and Cancel ask; a dialog in the middle of a host call waits.
      request(result = { canceled: true }) { if (!dlg.busy) dlg.close(result); },
      // A failure is read out once, by this note turning assertive (a live region outside a modal dialog is not always
      // heard, and a second one would say it twice); anything else is a polite status.
      say(text, { busy = false, alert = false } = {}) {
        const kind = alert ? "alert" : busy ? "busy" : "info";
        if (note.dataset.text === text && note.dataset.kind === kind) return;
        note.setAttribute("role", alert ? "alert" : "status");
        note.setAttribute("aria-live", alert ? "assertive" : "polite");
        note.dataset.text = text;
        note.replaceChildren();
        if (busy) note.append(glyph("spinner"));
        note.append(el("span", "", text));
        note.dataset.kind = kind;
      },
      // The footer's buttons are swapped as a dialog goes on; one that had the focus hands it to the last of the new
      // ones (or the dialog), so it never falls to the page behind.
      setButtons(...nodes) {
        const had = buttons.contains?.(document.activeElement);
        buttons.replaceChildren(...nodes);
        if (had) (nodes.at(-1) ?? sheet).focus?.({ preventScroll: true });
      },
      lock(on) { dlg.busy = on; x.disabled = on; sheet.setAttribute("aria-busy", String(on)); },
      onClose(fn) { dlg.exits.push(fn); },
      close(result = { canceled: true }) {
        if (dlg.closed) return;
        dlg.closed = true;
        for (const fn of dlg.exits) { try { fn(); } catch { /* a cleanup must not keep the dialog open */ } }
        dialogs.delete(key);
        stack.splice(stack.indexOf(dlg), 1);
        overlay.hidden = true;
        const gone = () => overlay.remove();
        if (still()) gone(); else setTimeout(gone, EXIT_MS);
        const under = stack.at(-1);
        if (under) { under.overlay.inert = false; (under.lastFocus?.isConnected !== false ? under.lastFocus : under.sheet)?.focus?.({ preventScroll: true }); }
        else if (!result?.silent && from?.isConnected !== false) from?.focus?.({ preventScroll: true });
        resolve(result);
      },
    };
    sheet.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault?.(); event.stopPropagation?.(); dlg.request(); return; }
      if (event.key === "Tab") {
        const items = focusables(sheet);
        if (!items.length) { event.preventDefault?.(); return; }
        const first = items[0], last = items.at(-1), at = document.activeElement;
        if (event.shiftKey && (at === first || at === sheet)) { event.preventDefault?.(); last.focus?.(); }
        else if (!event.shiftKey && at === last) { event.preventDefault?.(); first.focus?.(); }
        return;
      }
      // Nothing but the chords reaches the page behind a dialog that has the floor: not its letter shortcuts, and not Enter, Space or
      // the arrows either (Command reads them as its selected node's when the focus is on the dialog itself). A button still
      // answers Enter and Space: stopping a key's travel leaves what the browser does with it alone.
      if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation?.();
    });
    dialogs.set(key, dlg);
    stack.push(dlg);
    layer().append(overlay);
    sheet.focus?.({ preventScroll: true });
    return dlg;
  }
  const strip = (tone, mark, text, ...extra) => {
    const node = el("div", "gs-strip");
    node.dataset.tone = tone;
    node.append(glyph(mark), el("span", "gs-strip-text", text), ...extra);
    return node;
  };
  const field = (labelText, control, hint) => {
    const wrap = el("label", "gs-field");
    wrap.append(el("span", "gs-field-label", labelText), control);
    if (hint) wrap.append(el("span", "gs-field-hint", hint));
    return wrap;
  };
  const input = (value = "", placeholder = "") => { const node = el("input", "gs-input"); node.type = "text"; node.value = value; if (placeholder) node.placeholder = placeholder; node.autocomplete = "off"; node.spellcheck = false; return node; };
  // A radio group of buttons (roving tabindex, arrows move and choose), the
  // segmented control the boards use for visibility and licence.
  function radios(label, items, current, onPick, cls = "") {
    const group = el("div", `gs-seg${cls ? ` ${cls}` : ""}`);
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", label);
    const buttons = items.map(([id, content]) => {
      const item = el("button", "gs-seg-item");
      item.type = "button";
      item.setAttribute("role", "radio");
      item.dataset.value = id;
      item.append(content);
      item.addEventListener("click", () => onPick(id));
      item.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault?.();
        const at = Math.min(buttons.length - 1, Math.max(0, buttons.indexOf(item) + step));
        buttons[at].focus?.();
        onPick(buttons[at].dataset.value);
      });
      return item;
    });
    const sync = (value) => { for (const item of buttons) { const on = item.dataset.value === value; item.setAttribute("aria-checked", String(on)); item.tabIndex = on ? 0 : -1; } };
    group.append(...buttons);
    sync(current);
    return { group, sync, buttons };
  }

  // ---- Save and push ---------------------------------------------------------------
  const KIND = { changed: ["edit", "Changed"], new: ["plus", "New"], deleted: ["trash", "Deleted"] };
  const NONE_TICKED = "Tick at least one file to save.";
  async function showSave(options = {}) {
    const wantPush = options.push !== false;
    const bound = boundTo();
    const dlg = dialog({ key: "save", label: "Save and push", eyebrow: projectName(), title: "Save and push", width: 820 });
    if (!dlg) return dialogs.get("save").done;
    dlg.body.append(el("p", "gs-muted", "Looking at your changes…"));
    let preview = null;
    try { preview = typeof api()?.gitSavePreview === "function" ? await api().gitSavePreview(bound) : { ok: false, error: "Saving works in the desktop app." }; } catch (error) { preview = { ok: false, error: plain(error, "Studio could not look at your changes.") }; }
    if (dlg.closed) return dlg.done;
    if (!preview?.ok) {
      const failure = strip("bad", "error", wordsIn(preview?.error) || "Studio could not look at your changes.");
      failure.setAttribute("role", "alert");
      dlg.body.replaceChildren(failure);
      dlg.buttons.replaceChildren(button("Close", "ghost", () => dlg.request()));
      dlg.closeButton.focus?.();
      return dlg.done;
    }
    const files = (Array.isArray(preview.files) ? preview.files : []).filter((file) => file && typeof file.path === "string").slice(0, 400);
    const on = files.map((file) => file.include !== false && !file.blocked);
    const branch = String(preview.branch || state.model?.branch || "this branch").slice(0, 120);
    const repo = state.model?.repo ?? "";
    let ack = false, typed = "";
    const refusal = preview.refusal && typeof preview.refusal.text === "string" ? wordsIn(preview.refusal.text) : "";
    const builders = preview.builders === true;
    const ticked = () => on.filter(Boolean).length;
    // The default message follows the number of files ticked.
    const stem = /^(.*?)(\d+) files?$/.exec(String(preview.message ?? ""));
    const fallback = (n) => (stem ? `${stem[1]}${count(n, "file")}` : String(preview.message || `Studio save: ${count(n, "file")}`));

    const intro = el("p", "gs-muted", `Studio saves the files you keep ticked as one commit on ${branch}, then pushes it to GitHub. Files you leave out stay on this PC.`);
    const list = el("dl", "gs-facts gs-facts-wide");
    list.append(el("dt", "", "Branch"), el("dd", "gs-mono", branch));
    if (repo) list.append(el("dt", "", "On GitHub"), el("dd", "gs-mono", repo));
    const total = el("span", "gs-tally");
    const rows = el("ul", "gs-files");
    const boxes = [];
    files.forEach((file, index) => {
      const item = el("li", "gs-file-item");
      const label_ = el("label", "gs-file");
      // The wrapping label names the box: what happened to the file, its path and its size.
      const box = el("input");
      box.type = "checkbox";
      box.checked = on[index];
      box.disabled = Boolean(file.blocked);
      box.addEventListener("change", () => { on[index] = box.checked; refresh_(); });
      boxes.push(box);
      const [mark, word] = KIND[file.status] ?? KIND.changed;
      const kind = el("span", "gs-file-kind");
      kind.append(glyph(mark), el("span", "", word));
      const bytes = Number(file.bytes);
      label_.append(box, kind, el("span", "gs-file-path", file.path), el("span", "gs-file-size", bytes >= 1e6 ? size(bytes) : ""));
      item.append(label_);
      // Why a row is held or flagged is what its box is described by, so a disabled box says why it is disabled.
      const describe = (note) => {
        const words = note.querySelector(".gs-strip-text");
        if (words) { words.id = `git-sync-file-note-${index}`; box.setAttribute("aria-describedby", words.id); }
        return note;
      };
      if (file.blocked) {
        item.dataset.tone = "bad";
        // The host words each stop ("Stopped: a private key in a.key."); a secret also says where it goes.
        const said = wordsIn(file.blocked.text) || `Stopped: ${wordsIn(file.blocked.label) || "something private"} in ${file.path}.`;
        item.append(describe(strip("bad", "blocked-secret", file.blocked.kind === "too-large" ? said : `${said} It stays out of this save.`)));
      } else if (file.warn) {
        item.dataset.tone = "warn";
        const leave = button("Leave it out", "ghost mini", () => { on[index] = false; box.checked = false; refresh_(); });
        leave.setAttribute("aria-label", `Leave it out: ${file.path}`);
        item.append(describe(strip("warn", "too-large", wordsIn(file.warn.text) || `${file.path}: ${wordsIn(file.warn.label) || "look before saving"}.`, leave)));
      }
      rows.append(item);
    });
    const message = input("", "");
    message.id = "git-sync-message";
    message.setAttribute("aria-label", "Message");
    const messageHint = el("p", "gs-field-hint");
    const notes = el("div", "gs-notes");
    // Who the commit is by: git's own name, else the signed-in account's (said in words), else nobody (the host refuses).
    const who = preview.identity && typeof preview.identity === "object" ? preview.identity : { ok: true };
    const nobody = who.ok === false;
    if (nobody) {
      const signIn = button("Sign in to GitHub", "ghost mini", async () => { const got = await showSignIn(); if (got?.ok && !dlg.closed) { dlg.close({ canceled: true, silent: true }); void showSave({ push: wantPush }); } });
      notes.append(strip("warn", "signed-out", "Git does not know who you are on this PC. Sign in to GitHub, or set your name and email in Git.", signIn));
    } else if (who.fromAccount === true) notes.append(strip("info", "info", `Git does not know who you are on this PC yet. Studio will save as ${wordsIn(who.name) || "your GitHub account"}, from your GitHub sign-in.`));
    let agents = null;
    if (builders) {
      const tick = el("input");
      tick.type = "checkbox";
      tick.addEventListener("change", () => { ack = tick.checked; refresh_(); });
      const confirmLabel = el("label", "gs-ack");
      confirmLabel.append(tick, el("span", "", "Save now anyway"));
      agents = strip("warn", "agents-working", "Agents are still changing files in this project. Save now anyway?");
      agents.append(confirmLabel);
      notes.append(agents);
    }
    if (refusal) notes.append(strip("bad", "error", refusal));
    if (files.length === 0) notes.append(strip("info", "info", "There is nothing to save. Every file matches the last save."));

    const cancel = button("Cancel", "ghost", () => dlg.request());
    const saveOnly = button("Save only", "ghost", () => void submit(false));
    const savePush = button("", "primary", () => void submit(true));
    savePush.dataset.role = "primary";
    const primaryOff = () => ticked() === 0 || Boolean(refusal) || nobody || (builders && !ack);
    function refresh_() {
      const n = ticked();
      total.textContent = `${n} of ${files.length} ticked`;
      message.placeholder = fallback(n);
      messageHint.replaceChildren(el("span", "", "If you leave it empty, Studio uses "), el("span", "gs-mono", fallback(n)));
      savePush.replaceChildren(glyph("upload"), el("span", "", n ? `Save and push ${count(n, "file")}` : "Save and push"));
      savePush.disabled = saveOnly.disabled = primaryOff();
      // Why the buttons are held when nothing is ticked (the other holds have a strip of their own).
      if (n === 0 && files.length && !refusal && !nobody) dlg.say(NONE_TICKED);
      else if (dlg.note.dataset.text === NONE_TICKED) dlg.say("");
    }
    async function submit(pushIt) {
      if (dlg.busy || primaryOff()) return;
      const paths = files.filter((file, index) => on[index]).map((file) => file.path);
      typed = message.value.trim();
      dlg.lock(true);
      for (const control of [cancel, saveOnly, savePush, message, ...boxes]) control.disabled = true;
      dlg.say(`Saving ${count(paths.length, "file")} on this PC.${pushIt ? "" : " Nothing will be pushed."}`, { busy: true });
      const result = await remote("saving", () => api().gitSave({ paths, message: typed || fallback(paths.length), push: pushIt, ...bound, ...(builders && ack ? { ignoreBuilders: true } : {}) }), pushIt ? "push" : "save");
      dlg.lock(false);
      for (const control of [cancel, message]) control.disabled = false;
      boxes.forEach((box, index) => { box.disabled = Boolean(files[index].blocked); });
      refresh_();
      if (result?.ok) {
        const saved = Number.isFinite(result.files) && result.files > 0 ? result.files : paths.length;
        dlg.close({ ok: true, saved, pushed: result.pushed === true, sha: result.sha ?? null });
        const model = state.model;
        if (pushIt && result.pushed === false) toast(`Saved ${count(saved, "file")} on this PC, but nothing was pushed.${model?.sentence ? ` ${model.sentence}` : ""}`, "warn");
        else if (pushIt) toast(`Saved ${count(saved, "file")} and pushed to GitHub.`, "good", model?.repo ? { action: { label: "Open on GitHub", run: () => openRepo(model.repo) } } : undefined);
        else toast(`Saved ${count(saved, "file")} on this PC.`, "good");
        return;
      }
      dlg.say(result === null ? STILL_BUSY : wordsIn(result?.error) || "Studio could not save those files. Nothing was changed.", { alert: true });
    }
    dlg.body.replaceChildren(intro, list);
    const filesHead = el("div", "gs-section-head");
    filesHead.append(el("h3", "gs-eyebrow", "Files to save"), total);
    const filesSection = el("section", "gs-section");
    filesSection.setAttribute("aria-label", "Files to save");
    filesSection.append(filesHead, rows);
    const messageRow = el("div", "gs-message");
    const messageLabel = el("label", "gs-field-label", "Message");
    messageLabel.htmlFor = "git-sync-message";
    messageRow.append(messageLabel, message, messageHint);
    dlg.body.append(filesSection, messageRow, notes);
    dlg.buttons.replaceChildren(cancel, saveOnly, savePush);
    refresh_();
    // The focus lands on the message, not on a button that commits: a second Enter pressed at once, before the files were read, saves
    // nothing. (Unless the reader has already moved on inside the dialog while the preview loaded.)
    const at = document.activeElement;
    if (!at || at === dlg.sheet || !dlg.sheet.contains?.(at)) message.focus?.({ preventScroll: true });
    return dlg.done;
  }

  // ---- Publish ------------------------------------------------------------------------
  const slugOf = (text) => String(text ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  // The Publish preview's file rows are { path, bytes, warn?, blocked? } (scripts/git-actions.cjs),
  // shown as a folder each with a count, the way the boards draw them; warn and blocked are
  // { path, kind, label, text }, the text being the host's own sentence.
  const topOf = (path) => { const parts = String(path ?? "").split(/[\\/]/); return parts.length > 1 ? `${parts[0]}/` : "Top level"; };
  function groupFiles(items) {
    const groups = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const key = topOf(typeof item === "string" ? item : item?.path);
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return [...groups.entries()].slice(0, 12);
  }
  const rowsOf = (items) => (Array.isArray(items) ? items : []).filter((item) => item && typeof item === "object").slice(0, 12).map((item) => ({ path: String(item.path ?? ""), label: wordsIn(item.label), text: wordsIn(item.text), bytes: Number(item.bytes) || 0 }));
  const seenOneDrive = () => { try { return localStorage.getItem(ONEDRIVE_KEY) === "1"; } catch { return false; } };
  const markOneDrive = () => { try { localStorage.setItem(ONEDRIVE_KEY, "1"); } catch { /* the note may show again */ } };

  async function showPublish(options = {}) {
    const bound = boundTo();
    const dlg = dialog({ key: "publish", label: `Publish ${projectName()} to GitHub`, eyebrow: projectName(), title: "Publish to GitHub", width: 760 });
    if (!dlg) return dialogs.get("publish").done;
    const s = { owner: "", account: "", orgs: [], name: slugOf(options.name ?? state.project.name), vis: "private", typed: "", desc: "", gitignore: true, license: "none", preview: null, seq: 0, timer: 0, oneDrive: false, sawOneDrive: false };
    dlg.onClose(() => clearTimeout(s.timer));
    dlg.body.append(el("p", "gs-muted", "Looking at this project…"));
    const call = (name, ...args) => (typeof api()?.[name] === "function" ? api()[name](...args) : Promise.resolve({ ok: false, error: "Publishing works in the desktop app." }));
    let owners;
    try { owners = await call("gitOwners"); } catch (error) { owners = { ok: false, error: plain(error, "Studio could not read your GitHub account.") }; }
    if (dlg.closed) return dlg.done;
    if (!owners?.ok || !owners.account) return signedOut(owners);
    s.account = String(owners.account);
    s.owner = s.account;
    s.orgs = (Array.isArray(owners.orgs) ? owners.orgs : []).filter((org) => typeof org === "string" && /^[A-Za-z0-9-]{1,39}$/.test(org)).slice(0, 40);
    return form();

    // Signed out: publishing waits for the sign-in dialog.
    function signedOut(answer) {
      dlg.body.replaceChildren(strip("warn", "signed-out", wordsIn(answer?.error) || "Sign in to GitHub first."), el("p", "gs-muted", "You sign in on GitHub's own page. Studio never asks for your password."));
      const signIn = button("Sign in to GitHub", "primary", async () => {
        const got = await showSignIn();
        if (dlg.closed) return;
        if (got?.ok) { dlg.body.replaceChildren(el("p", "gs-muted", "Looking at this project…")); dlg.buttons.replaceChildren(); void showPublishAgain(); }
      });
      dlg.buttons.replaceChildren(button("Not now", "ghost", () => dlg.request()), signIn);
      signIn.focus?.({ preventScroll: true });
      return dlg.done;
    }
    async function showPublishAgain() {
      let again;
      try { again = await call("gitOwners"); } catch { again = null; }
      if (dlg.closed) return;
      if (!again?.ok || !again.account) { signedOut(again); return; }
      s.account = String(again.account); s.owner = s.account;
      s.orgs = (Array.isArray(again.orgs) ? again.orgs : []).filter((org) => typeof org === "string").slice(0, 40);
      form();
    }

    function form() {
      const nameInput = input(s.name);
      const nameField = field("Name", nameInput);
      const ownerBox = s.orgs.length ? el("select", "gs-input") : input(s.owner);
      if (s.orgs.length) { for (const who of [s.account, ...s.orgs]) { const option = el("option", "", who); option.value = who; ownerBox.append(option); } ownerBox.value = s.owner; }
      else ownerBox.readOnly = true;
      ownerBox.setAttribute("aria-label", "Owner");
      const ownerField = field("Owner", ownerBox);
      const pair = el("div", "gs-pair");
      pair.append(ownerField, el("span", "gs-slash", "/"), nameField);
      const creates = el("div", "gs-creates");
      const createsName = el("span", "gs-mono gs-creates-name");
      creates.append(glyph("upload", "gs-muted-glyph"), el("span", "", "Creates"), createsName);
      const nameNote = el("p", "gs-field-hint");
      nameNote.hidden = true;
      const nameBox = el("div", "gs-name-box");
      nameBox.append(pair, creates, nameNote);

      const privateLabel = el("span", "gs-seg-body");
      privateLabel.append(glyph("lock"), (() => { const t = el("span", "gs-seg-text"); const top = el("span", "gs-seg-title"); top.append(el("span", "", "Private"), el("span", "gs-tag", "Default")); t.append(top, el("span", "gs-seg-sub", "Only you and people you add can see it.")); return t; })());
      const publicLabel = el("span", "gs-seg-body");
      publicLabel.append(glyph("globe"), (() => { const t = el("span", "gs-seg-text"); t.append(el("span", "gs-seg-title", "Public"), el("span", "gs-seg-sub", "Anyone on GitHub can see it, including its history.")); return t; })());
      const vis = radios("Visibility", [["private", privateLabel], ["public", publicLabel]], s.vis, (value) => { s.vis = value; s.typed = value === "public" ? s.typed : ""; update(); }, "gs-seg-stack");
      const typedInput = input("");
      typedInput.addEventListener("input", () => { s.typed = typedInput.value; update(); });
      const typedLabel = el("span", "gs-field-label");
      const typedName = el("span", "gs-mono");
      typedLabel.append(el("span", "", "Type "), typedName, el("span", "", " to make it public"));
      const typedWrap = el("label", "gs-field");
      typedWrap.append(typedLabel, typedInput);
      const typedStatus = el("p", "gs-inline-status");
      typedStatus.setAttribute("role", "status");
      const publicBox = el("div", "gs-public");
      publicBox.hidden = true;
      publicBox.append(strip("warn", "globe", "Public means anyone on GitHub can see this project's files, its history, the README and the LICENSE."), typedWrap, typedStatus);
      const visBox = el("div", "gs-group");
      visBox.append(el("span", "gs-field-label", "Visibility"), vis.group, publicBox);

      const descInput = input("", "What is this project?");
      descInput.addEventListener("input", () => { s.desc = descInput.value.slice(0, 350); });
      const descLabel = el("span", "gs-field-label");
      descLabel.append(el("span", "", "Description "), el("span", "gs-optional", "· Optional"));
      const descField = el("label", "gs-field");
      descField.append(descLabel, descInput);

      const boxMark = el("span", "gs-box");
      boxMark.setAttribute("aria-hidden", "true");
      boxMark.append(glyph("check"));
      const ignoreToggle = el("button", "gs-check");
      ignoreToggle.type = "button";
      ignoreToggle.setAttribute("role", "checkbox");
      ignoreToggle.append(boxMark, el("span", "", "Keep build folders and secrets out of Git"));
      ignoreToggle.addEventListener("click", () => { s.gitignore = !s.gitignore; schedule(); });
      const ignoreGroup = el("div", "gs-group");
      ignoreGroup.append(el("span", "gs-field-label gs-mono", ".gitignore"), ignoreToggle, el("span", "gs-field-hint", "Studio writes this file before the first commit."));

      const licenses = radios("License", [["none", el("span", "", "None")], ["mit", el("span", "", "MIT")], ["apache-2.0", el("span", "", "Apache-2.0")]], s.license, (value) => { s.license = value; update(); }, "gs-seg-row");
      const licenseHint = el("span", "gs-field-hint");
      const licenseGroup = el("div", "gs-group");
      licenseGroup.append(el("span", "gs-field-label", "License"), licenses.group, licenseHint);

      const left = el("div", "gs-col");
      left.append(nameBox, visBox, descField, ignoreGroup, licenseGroup);
      const filesTitle = el("h3", "gs-files-title", "Files that will be included");
      const filesTotal = el("span", "gs-muted");
      const filesHead = el("div", "gs-section-head");
      filesHead.append(filesTitle, filesTotal);
      const groupList = el("ul", "gs-groups");
      const filesNotes = el("div", "gs-notes");
      const right = el("section", "gs-col");
      right.setAttribute("aria-label", "Files that will be included");
      right.append(filesHead, groupList, filesNotes);
      const grid = el("div", "gs-publish-grid");
      grid.append(left, right);
      const advisories = el("div", "gs-notes");
      dlg.body.replaceChildren(grid, advisories);

      const cancel = button("Not now", "ghost", () => dlg.request());
      const go = button("", "primary", () => void publish());
      go.dataset.role = "primary";
      dlg.buttons.replaceChildren(cancel, go);

      // The name is taken: linking to what is there ends this dialog.
      const linkInstead = () => { void showLink().then((got) => { if (got?.ok && !dlg.closed) dlg.close({ ok: true, repo: got.repo, linked: true }); }); };
      const finalName = () => slugOf(s.preview?.sanitized ?? s.name);
      const repo = () => `${s.owner}/${finalName()}`;
      const blocked = () => rowsOf(s.preview?.blocked);
      const stop = () => (s.preview?.publishIssue && typeof s.preview.publishIssue.text === "string" ? wordsIn(s.preview.publishIssue.text) : "");
      const can = () => Boolean(s.preview) && s.preview.ok !== false && finalName().length > 0 && s.preview?.valid !== false && s.preview?.taken !== true && !s.preview?.needsSignIn && blocked().length === 0 && !stop() && (s.vis !== "public" || s.typed.trim() === repo());
      // Everything the dialog shows follows from s and s.preview.
      function update() {
        const name = finalName();
        createsName.textContent = name ? repo() : "";
        typedName.textContent = repo();
        nameNote.hidden = !(name && wordsIn(s.name) !== name);
        nameNote.textContent = nameNote.hidden ? "" : "Spaces and symbols become hyphens.";
        if (s.preview?.taken === true) {
          const offer = (Array.isArray(s.preview.suggestions) ? s.preview.suggestions.map(slugOf).filter(Boolean).slice(0, 2) : []);
          if (!offer.length && name) offer.push(`${name}-2`);
          nameNote.hidden = false;
          nameNote.replaceChildren(el("span", "", `${repo()} already exists. Link to it, or pick another name. `), link("Link to it", linkInstead), ...offer.flatMap((other) => [el("span", "", " "), link(`Use ${other}`, () => { s.name = other; nameInput.value = other; schedule(); })]));
        } else if (s.preview?.valid === false) {
          nameNote.hidden = false;
          nameNote.textContent = wordsIn(s.preview.issue) || "That name is not one GitHub allows.";
        } else if (s.preview?.taken === null) {
          nameNote.hidden = false;
          nameNote.textContent = "Studio could not check whether that name is free. It finds out when it publishes.";
        }
        vis.sync(s.vis);
        publicBox.hidden = s.vis !== "public";
        const matched = s.vis === "public" && name.length > 0 && s.typed.trim() === repo();
        typedStatus.replaceChildren(...(matched ? [glyph("success", "gs-good"), el("span", "", "Matches. You can publish now.")] : []));
        ignoreToggle.setAttribute("aria-checked", String(s.gitignore));
        licenses.sync(s.license);
        licenseHint.textContent = s.license === "none" ? "No LICENSE file is added." : "Adds a LICENSE file with your name and this year.";
        paintFiles();
        go.replaceChildren(glyph("upload"), el("span", "", s.vis === "public" ? "Publish public repository" : "Publish private repository"));
        go.disabled = !can();
        dlg.say(status(), { busy: !s.preview });
      }
      function status() {
        if (!s.preview) return "Checking the name…";
        if (!finalName()) return "Give the project a GitHub name.";
        if (s.preview.valid === false) return wordsIn(s.preview.issue) || "That name is not one GitHub allows.";
        if (s.preview.taken === true) return "That name is taken.";
        if (stop()) return stop();
        if (blocked().length) return `Stopped: ${blocked()[0].path || "a file"} cannot go to GitHub. Move it out of the project, then look again.`;
        if (s.vis === "public" && s.typed.trim() !== repo()) return "Type the name to make it public.";
        return s.vis === "public" ? "Public. Anyone on GitHub can see it." : "Private. Only you can see it.";
      }
      function paintFiles() {
        const p = s.preview;
        groupList.replaceChildren();
        filesNotes.replaceChildren();
        advisories.replaceChildren();
        if (!p) { filesTotal.textContent = ""; return; }
        const groups = groupFiles(p.files);
        const shown = groups.reduce((sum, [, n]) => sum + n, 0);
        const total = Number.isFinite(p.total) && p.total >= shown ? p.total : shown;
        filesTotal.textContent = count(total, "file");
        for (const [name, n] of groups) { const row = el("li", "gs-group-row"); row.append(glyph("folder", "gs-muted-glyph"), el("span", "gs-mono gs-grow", name), el("span", "gs-muted", count(n, "file"))); groupList.append(row); }
        if (total > shown) groupList.append(el("li", "gs-group-row gs-muted", `Showing ${shown} of ${total} files.`));
        filesNotes.append(el("p", "gs-hint", s.gitignore ? "Kept out: node_modules, dist and .env files." : "Nothing is kept out. Build folders and secrets can be included."));
        for (const item of rowsOf(p.warn)) filesNotes.append(strip("warn", "too-large", item.text || `${item.path}: ${item.label || size(item.bytes)}.`));
        for (const item of blocked()) filesNotes.append(strip("bad", "blocked-secret", item.text || `Stopped: ${item.label || "something private"}${item.path ? ` in ${item.path}` : ""}.`));
        if (blocked().length) { const again = button("Look again", "ghost mini", () => schedule(true)); filesNotes.append(again); }
        if (p.renameBranch) filesNotes.append(el("p", "gs-hint", "Studio renames this project's first branch to main before it uploads."));
        if (p.oneDrive && !seenOneDrive() && !s.oneDriveDismissed) {
          const dismiss = button("", "gs-icon", () => { s.oneDriveDismissed = true; markOneDrive(); paintFiles(); });
          dismiss.append(glyph("close"));
          dismiss.setAttribute("aria-label", "Dismiss");
          advisories.append(strip("warn", "info", "This folder syncs with OneDrive. Git works, but OneDrive can lock or duplicate .git files.", dismiss));
          if (!s.sawOneDrive) { s.sawOneDrive = true; }
        }
        if (stop()) advisories.append(strip("bad", "error", stop()));
        else if (p.weakDrive) advisories.append(strip("warn", "info", "This drive cannot keep a Git project reliably. Move the project to an NTFS drive first."));
        if (p.needsSignIn) advisories.append(strip("warn", "signed-out", "Sign in to GitHub first.", button("Sign in to GitHub", "ghost mini", async () => { const got = await showSignIn(); if (got?.ok && !dlg.closed) schedule(true); })));
      }
      // The host looks at the name (taken, valid, what is in it) a moment after
      // the last key; an older answer never overwrites a newer question.
      function schedule(now = false) {
        clearTimeout(s.timer);
        s.preview = now ? s.preview : null;
        update();
        const run = async () => {
          const ask = ++s.seq;
          let answer;
          try { answer = await call("gitPublishPreview", { owner: s.owner, name: s.name, gitignore: s.gitignore, license: s.license, ...bound }); } catch (error) { answer = { ok: false, error: plain(error, "Studio could not look at this project.") }; }
          if (dlg.closed || ask !== s.seq) return;
          s.preview = answer && typeof answer === "object" ? answer : { ok: false };
          if (s.preview.ok === false && s.preview.error) dlg.say(wordsIn(s.preview.error), { alert: true });
          update();
        };
        if (now) void run(); else s.timer = setTimeout(run, 320);
      }
      nameInput.addEventListener("input", () => { s.name = nameInput.value; schedule(); });
      ownerBox.addEventListener?.("change", () => { s.owner = ownerBox.value; schedule(); });

      async function publish() {
        if (!can() || dlg.busy) return;
        const expected = [...(s.preview?.needsFirstCommit ? ["Saving a first commit"] : []), `Creating ${repo()}`, "Uploading"];
        dlg.lock(true);
        working(expected);
        const result = await remote("publishing", () => call("gitPublish", { ...bound, owner: s.owner, name: finalName(), visibility: s.vis, description: s.desc.trim(), gitignore: s.gitignore, license: s.license, ...(s.vis === "public" ? { confirmPublic: s.typed.trim() } : {}) }), "publish");
        dlg.lock(false);
        if (dlg.closed) return;
        if (result?.ok) done(result);
        else if (result === null) { void form(); dlg.say(STILL_BUSY, { alert: true }); }
        else failed(result);
      }
      function working(expected) {
        const box = el("div", "gs-progress");
        box.append(el("p", "gs-lead-line", "Publishing…"), el("p", "gs-muted", "A first upload of a large project can take a few minutes."));
        const steps = state.model?.busy === "publishing" && stepsOf(state.model).length ? stepsOf(state.model) : expected.map((label) => ({ label, state: "step" }));
        box.append(stageList(steps, "Publish progress"));
        dlg.body.replaceChildren(box);
        dlg.setButtons();
        dlg.say("Publishing…", { busy: true });
      }
      function done(result) {
        const target = String(result.repo ?? repo());
        const box = el("div", "gs-done");
        const line = el("p", "gs-lead-line");
        line.append(glyph("success", "gs-good"), el("span", "", "Published "), el("span", "gs-mono", target), el("span", "", "."));
        box.append(line, el("p", "gs-muted", state.model?.sentence || "This PC matches GitHub."), el("p", "gs-muted", s.vis === "public" ? "Public. Anyone on GitHub can see it." : "Private. Only you can see it."));
        dlg.body.replaceChildren(box);
        const open_ = button("", "primary", () => openRepo(target));
        open_.append(glyph("external"), el("span", "", "Open on GitHub"));
        dlg.buttons.replaceChildren(button("Done", "ghost", () => dlg.close({ ok: true, repo: target, url: `https://github.com/${target}` })), open_);
        dlg.say(`Published ${target}.`);
        toast(`Published ${target}.`, "good", { action: { label: "Open on GitHub", run: () => openRepo(target) } });
        open_.focus?.({ preventScroll: true });
      }
      function failed(result) {
        const kind = String(result?.kind ?? "");
        const text = wordsIn(result?.error) || "Studio could not publish this project. Nothing was changed.";
        // The host's own steps, each done or the one it stopped at; none when it stopped before the first.
        const steps = Array.isArray(result?.steps) ? result.steps.slice(0, 8).map((row) => ({ label: wordsIn(row.label).slice(0, 120), state: row.ok ? "done" : "failed" })) : [];
        const box = el("div", "gs-done");
        const offline = /offline/i.test(kind) || /you're offline|could not reach/i.test(text);
        const exists = /taken|exist/i.test(kind) || /already exists/i.test(text);
        const signIn = /not-signed-in|forbidden/i.test(kind);
        const words = offline ? "You're offline. Nothing was created." : exists ? `${repo()} already exists. Link to it, or pick another name.` : text;
        const line = el("p", "gs-lead-line");
        line.append(glyph(offline ? "offline" : "failed", "gs-bad"), el("span", "", words));
        box.setAttribute("role", "alert");
        box.append(line);
        if (steps.length) box.append(stageList(steps, "Publish progress, stopped"));
        dlg.body.replaceChildren(box);
        const again = () => { dlg.body.replaceChildren(el("p", "gs-muted", "Looking at this project…")); void form(); };
        const buttons = [button("Close", "ghost", () => dlg.request())];
        if (exists) {
          buttons.push(button("Link to it", "ghost", linkInstead));
          buttons.push(button(`Use ${finalName()}-2`, "primary", () => { s.name = `${finalName()}-2`; s.preview = null; again(); }));
        } else if (signIn) buttons.push(button("Sign in again", "primary", async () => { const got = await showSignIn(); if (got?.ok && !dlg.closed) again(); }));
        else buttons.push(button("Try again", "primary", again));
        dlg.buttons.replaceChildren(...buttons);
        Array.from(dlg.buttons.children).at(-1)?.focus?.({ preventScroll: true });
      }
      schedule(true);
      update();
      nameInput.focus?.({ preventScroll: true });
      return dlg.done;
    }
  }

  // ---- Link to a repository -------------------------------------------------------------
  const LINK_WORDS = {
    unrelated: "That repository has a different history from this project, so Studio did not link them.",
    "not-listed": "That repository is not on your GitHub list. Choose one from the list.",
    exists: "This project is already linked to a repository.",
  };
  async function showLink() {
    const bound = boundTo();
    const dlg = dialog({ key: "link", label: "Link to a GitHub repository", eyebrow: projectName(), title: "Link to a repository", width: 520 });
    if (!dlg) return dialogs.get("link").done;
    dlg.body.append(el("p", "gs-muted", "Getting your repositories…"));
    let answer;
    try { answer = typeof api()?.gitLinkRepos === "function" ? await api().gitLinkRepos() : { ok: false, error: "Linking works in the desktop app." }; } catch (error) { answer = { ok: false, error: plain(error, "Your repositories could not be listed.") }; }
    if (dlg.closed) return dlg.done;
    const repos = (Array.isArray(answer?.repos) ? answer.repos : []).filter((row) => REPO.test(String(row?.repo ?? ""))).slice(0, 200);
    if (!answer?.ok || !repos.length) {
      const notice = strip(answer?.ok ? "info" : "warn", answer?.ok ? "info" : "signed-out", answer?.ok ? "Your GitHub account has no repositories yet. Publish this project instead." : wordsIn(answer?.error) || "Your repositories could not be listed. Sign in to GitHub first.");
      if (!answer?.ok) notice.setAttribute("role", "alert");
      dlg.body.replaceChildren(notice);
      dlg.buttons.replaceChildren(button("Close", "ghost", () => dlg.request()));
      dlg.closeButton.focus?.({ preventScroll: true });
      return dlg.done;
    }
    let chosen = "", filter = "";
    const finder = input("", "Find a repository");
    finder.type = "search";
    finder.setAttribute("aria-label", "Find a repository");
    const list = el("div", "gs-repos");
    list.setAttribute("role", "radiogroup");
    list.setAttribute("aria-label", "Your repositories");
    const go = button("", "primary", () => void link_());
    go.dataset.role = "primary";
    function paint() {
      const shown = repos.filter((row) => !filter || row.repo.toLowerCase().includes(filter));
      // One tab stop for the group: the chosen repository, or the first one showing when a filter has hidden it.
      const stop = shown.some((row) => row.repo === chosen) ? chosen : shown[0]?.repo;
      list.replaceChildren(...shown.map((row, index) => {
        const item = el("button", "gs-repo");
        item.type = "button";
        item.setAttribute("role", "radio");
        item.setAttribute("aria-checked", String(row.repo === chosen));
        item.tabIndex = row.repo === stop ? 0 : -1;
        item.dataset.repo = row.repo;
        const top = el("span", "gs-repo-top");
        top.append(el("span", "gs-mono gs-grow", row.repo), el("span", "gs-tag", row.private ? "Private" : "Public"));
        item.append(top);
        const about = wordsIn(row.description).slice(0, 140);
        if (about) item.append(el("span", "gs-repo-about", about));
        item.addEventListener("click", () => { chosen = row.repo; paint(); });
        item.addEventListener("keydown", (event) => {
          const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
          if (!step) return;
          event.preventDefault?.();
          const at = Math.min(shown.length - 1, Math.max(0, index + step));
          chosen = shown[at].repo;
          paint();
          Array.from(list.querySelectorAll("[data-repo]")).find((node) => node.dataset.repo === chosen)?.focus?.();
        });
        return item;
      }));
      if (!shown.length) list.replaceChildren(el("p", "gs-muted", "No repository matches that."));
      go.replaceChildren(glyph("external"), el("span", "", "Link this project"));
      go.disabled = !chosen;
    }
    finder.addEventListener("input", () => { filter = finder.value.trim().toLowerCase(); paint(); });
    async function link_() {
      if (!chosen || dlg.busy) return;
      dlg.lock(true);
      go.disabled = true;
      dlg.say(`Linking to ${chosen}…`, { busy: true });
      const target = chosen;
      const result = await remote("checking", () => api().gitLink(target, bound), "link");
      dlg.lock(false);
      if (result?.ok) { dlg.close({ ok: true, repo: target }); toast(`Linked to ${target}.`, "good", { action: { label: "Open on GitHub", run: () => openRepo(target) } }); return; }
      go.disabled = false;
      dlg.say(LINK_WORDS[result?.kind] || wordsIn(result?.error) || "Studio could not link that repository. Nothing was changed.", { alert: true });
    }
    dlg.body.replaceChildren(el("p", "gs-muted", "Choose the repository this project already belongs to. Studio checks that its history matches before it links them."), ...(repos.length > 8 ? [finder] : []), list);
    dlg.buttons.replaceChildren(button("Cancel", "ghost", () => dlg.request()), go);
    paint();
    (list.querySelector("[tabindex='0']") ?? dlg.sheet).focus?.({ preventScroll: true });
    return dlg.done;
  }

  // ---- Sign in ---------------------------------------------------------------------------
  // The setup window does the sign-in (Studio never sees a password or a
  // token); this dialog says so, looks for the account every two seconds while
  // it is open, and stops when it closes.
  function showSignIn() {
    const dlg = dialog({ key: "signin", label: "Sign in to GitHub", eyebrow: "GitHub", title: "Sign in to GitHub", width: 440 });
    if (!dlg) return dialogs.get("signin").done;
    const lead = el("p", "gs-lead-line");
    const waiting = el("p", "gs-inline-status");
    waiting.setAttribute("role", "status");
    const safe = el("p", "gs-muted gs-safe");
    safe.append(glyph("lock", "gs-muted-glyph"), el("span", "", "Studio never sees your password or token."));
    dlg.body.append(lead, waiting, safe);
    const wait = (text, busy = true) => { waiting.replaceChildren(...(busy ? [glyph("spinner")] : []), el("span", "", text)); };
    let timer = 0, looking = false, launched = false;
    const stop = () => { clearInterval(timer); timer = 0; };
    dlg.onClose(stop);
    const ask = (name, ...args) => (typeof api()?.[name] === "function" ? Promise.resolve(api()[name](...args)) : Promise.resolve(null));
    function signedIn(account) {
      stop();
      toast(`Signed in as ${account}.`, "good");
      announce(`Signed in as ${account}.`);
      try { window.dispatchEvent?.(new CustomEvent("mefi:github-account", { detail: { account } })); } catch { /* a listener is optional */ }
      dlg.close({ ok: true, account });
      void refresh();
    }
    function missing(tool) {
      const isGh = tool === "gh";
      lead.textContent = isGh ? "GitHub CLI is not installed on this PC." : "Git is not installed.";
      wait("Studio also checks by itself once it is installed.", true);
      const install = button("Install it", "primary", async () => {
        install.disabled = true;
        const started = await ask("pcSetupAction", isGh ? "install-gh" : "install-git");
        lead.textContent = started?.ok ? wordsIn(started.message) : wordsIn(started?.error) || "The setup window did not open.";
        install.disabled = false;
      });
      dlg.setButtons(button("Cancel", "ghost", () => dlg.request()), install);
    }
    async function look(manual = false) {
      if (looking || dlg.closed) return;
      looking = true;
      let answer = null;
      try { answer = await ask("githubAccount"); } catch { answer = null; }
      looking = false;
      if (dlg.closed) return;
      if (!answer?.ok) { if (manual) dlg.say("Studio could not check just now. It tries again by itself.", { alert: false }); return; }
      if (answer.account) { signedIn(String(answer.account)); return; }
      if (answer.gitInstalled === false) { missing("git"); return; }
      if (answer.ghInstalled === false) { missing("gh"); return; }
      if (!launched) await launch();
      else if (manual) dlg.say("Not signed in yet. Finish in the setup window, then choose Check again.");
    }
    async function launch() {
      launched = true;
      const started = await ask("pcSetupAction", "github-login");
      if (dlg.closed) return;
      if (started && started.ok === false) {
        // Not tried again on its own (a window that is already open would be asked for every two seconds): the way on is the button.
        lead.textContent = wordsIn(started.error) || "The setup window did not open.";
        wait("Studio still checks for your account by itself.", false);
        const retry = button("Try again", "primary", () => { launched = false; void launch(); });
        retry.dataset.role = "primary";
        dlg.setButtons(button("Cancel", "ghost", () => dlg.request()), retry);
        return;
      }
      lead.textContent = wordsIn(started?.message) || "Finish in the setup window, then choose Check again.";
      wait("Waiting for GitHub… Studio also checks by itself.");
      buttonsReady();
    }
    function buttonsReady() {
      const again = button("", "primary", () => void look(true));
      again.append(glyph("refresh"), el("span", "", "Check again"));
      again.dataset.role = "primary";
      dlg.setButtons(button("Cancel", "ghost", () => dlg.request()), again);
    }
    lead.textContent = "Opening the setup window…";
    wait("Looking for your GitHub account…");
    buttonsReady();
    timer = setInterval(() => { void look(false); }, POLL_MS);
    void look(false);
    return dlg.done;
  }

  // ---- start ----------------------------------------------------------------------------------
  // A bar that lost its chip when it was rebuilt gets it back on the next
  // navigation; a project switch forgets the old answer and looks again.
  function start() {
    try { layer(); } catch { /* no body yet: the first mount makes it */ }
    const bridge = api();
    if (typeof bridge?.onGitState === "function") bridge.onGitState((raw) => accept(raw));
    if (typeof bridge?.onProjects === "function") bridge.onProjects((payload) => { const found = payload?.projects?.find?.((item) => item.id === payload.activeId); if (found) state.project = { id: found.id, name: String(found.name ?? "").slice(0, 120) }; });
    // The bar may have been drawn before this file loaded; nav.js asks again on every repaint.
    const bar = document.getElementById?.("app-local-nav");
    if (bar) mount(bar, { variant: "bar" });
    window.addEventListener?.("mefi:project-changed", forget);
    window.addEventListener?.("mefi:nav", () => close({ restore: false }));
    // Zen (a class on body) and the classic shell (an attribute on html) hide the chip by style alone, so an open popover has to notice.
    if (typeof MutationObserver === "function") {
      const hidden = new MutationObserver(() => { if (pop.open && !visible(pop.opener)) close({ restore: false }); });
      if (document.body) hidden.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      if (document.documentElement) hidden.observe(document.documentElement, { attributes: true, attributeFilter: ["data-shell"] });
    }
    document.addEventListener?.("visibilitychange", () => { if (!document.hidden) void refresh(); });
    void readProject();
    void refresh();
  }

  window.MefiGitSync = {
    mount,
    model: () => { const model = view(); return model ? JSON.parse(JSON.stringify(model)) : null; },
    open,
    close: (options) => close(options),
    refresh,
    showSave,
    showPublish,
    showLink,
    showSignIn,
  };
  start();
})();
