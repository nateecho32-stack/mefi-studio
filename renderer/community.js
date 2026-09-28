// The Void Engine community layer, renderer side: window.MefiCommunity, the
// weekly "join the Discord" card in the workspace, and the Settings ›
// Community card. Every network call runs in main (scripts/discord-oauth.cjs
// behind the community:* IPC); this file only ever sees the public STATUS
// object, which never carries a token.
//
// The Discord link is optional and unlocks nothing: every theme and node
// style is free for everyone. Listen together and the rooms hub use the link
// (renderer/together.js follows mefi-community-status). With no bridge
// (start:web, an older desktop build) the card never shows and Settings says
// linking needs the desktop app. The weekly card is quiet by construction: it
// waits for the boot gate, any open dialog, a new or unfinished walkthrough,
// recent typing and a hidden window, shows at most once a session and never
// to a linked member, and main decides when it is due at all.
(function () {
  "use strict";
  // The boot hint the retired Void collection lock kept; cleared once at init.
  const OLD_HINT_KEY = "mefiStudio.community.v1";
  // The weekly card's title and pitch (the template carries the same words).
  const TITLE = "Build with others in the Void Engine Discord.";
  const PITCH = "Share what you're building, swap model setups, and listen together with other builders.";
  // A failed check retries after an hour, then six, then daily (scripts/community.cjs).
  const PRIVACY = "Linking reads your Discord id and name, and your roles and join date in the Void Engine server: when you link, about once a week (sooner after a failed check, then daily), and when you press Check now. Studio keeps them in its settings on this computer, with the sign-in encrypted in community-auth.json. Nothing about your projects is sent. Unlink revokes the sign-in and deletes both.";
  // What the link is for, now that it unlocks nothing.
  const USES = "Listen together uses this link to find your Void Engine rooms.";
  // One name for the link action on every surface; relinking after Discord
  // asks is the same button.
  const LINK_LABEL = "Link my Discord";
  const ERRORS = {
    canceled: "Linking canceled.",
    busy: "Studio is still linking or unlinking. Try again in a moment.",
    storage: "Studio couldn't finish deleting its saved sign-in. Try Unlink again.",
    timeout: "Discord didn't answer within five minutes. Try again when you're ready.",
    "port-busy": "Studio couldn't open its local sign-in port (53134 to 53136 are all in use). Close whatever holds them and try again.",
    state: "The sign-in reply didn't match this request, so Studio ignored it. Try again.",
    auth: "Discord declined the sign-in. Choose Link my Discord to try again.",
    network: "Couldn't reach Discord. Check your connection and try again.",
    "not-member": "Your Discord account isn't in the Void Engine server yet. Join, then choose Check now.",
    "rate-limit": "Discord asked Studio to slow down. Try again in a few minutes.",
    "not-configured": "Discord linking isn't set up on this PC yet. Add the link app ID in Settings › General › Community › Connection details.",
    throttled: "Checked a moment ago. Try again in a minute.",
    unavailable: "Linking the Void Engine Discord needs the desktop app.",
  };
  const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
  const KEY_QUIET_MS = 45000;
  const FIRST_TRY_MS = 4000;
  const RETRY_MS = 5000;
  const BOOT_RETRY_MS = 1500;
  const RETRY_LIMIT = 120;
  const RECHECK_MS = 6 * HOUR;
  const $ = (id) => document.getElementById(id);
  const now = () => Date.now();

  let last = null;            // the newest STATUS from main
  let linkAnnounced = null;   // the link state last dispatched as mefi-community-status
  let rendered = [];          // [action, button] pairs from the last Settings render
  let initialized = false;
  let started = false;
  let shownThisSession = false;
  let lastKeyAt = -Infinity;
  let tries = 0;
  let timer = 0;
  let cardMode = null;        // "weekly" | "open" while the inline card shows
  let busy = null;            // "link" | "check" | "unlink" while a host call runs

  // ---- the host ----------------------------------------------------------------
  // The only doors out. A missing method answers {ok:false} instead of throwing.
  function bridge(name) {
    try {
      const api = window.mefiStudio;
      const fn = api?.[name];
      return typeof fn === "function" ? (...args) => fn.apply(api, args) : null;
    } catch { return null; }
  }
  const desktop = () => Boolean(bridge("communityStatus"));
  async function call(name, ...args) {
    const fn = bridge(name);
    if (!fn) return { ok: false, error: "unavailable" };
    try {
      const result = await fn(...args);
      if (result?.status && typeof result.status === "object") adopt(result.status);
      return result && typeof result === "object" ? result : { ok: false, error: "unavailable" };
    } catch (error) {
      return { ok: false, error: "failed", message: error?.message || "" };
    }
  }
  function headless() {
    try {
      const query = new URLSearchParams(window.location?.search || "");
      return query.get("capture") === "1" || query.get("smoke") === "1";
    } catch { return false; }
  }
  function toast(message, kind = "info", options) {
    try { if (typeof window.MefiToast === "function") window.MefiToast(message, kind, options); } catch {}
  }
  function noMotion() {
    try { if (typeof window.MefiNav?.noMotion === "function") return Boolean(window.MefiNav.noMotion()); } catch {}
    try { return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches); } catch { return false; }
  }
  function later(fn) {
    try { if (typeof requestAnimationFrame === "function") { requestAnimationFrame(fn); return; } } catch {}
    setTimeout(fn, 0);
  }

  // ---- the status ----------------------------------------------------------------
  function adopt(status) {
    if (!status || typeof status !== "object") return;
    last = status;
    // Whether linking is possible here (a client id, not linked yet, or asked
    // to link again) and whether the account is a member. Listen together
    // (together.js) re-reads the hub when this changes.
    const linkState = { configured: status.configured === true, linked: status.linked === true, member: status.member === true, state: typeof status.state === "string" ? status.state : null, linking: status.linking === true };
    const linkSignature = JSON.stringify(linkState);
    if (linkSignature !== linkAnnounced) {
      linkAnnounced = linkSignature;
      try { window.dispatchEvent(new CustomEvent("mefi-community-status", { detail: linkState })); } catch {}
    }
    if (cardMode === "weekly" && (status.member === true || status.prompt?.never)) hideCard();
    renderCard();
    renderSettings();
  }
  const refresh = () => call("communityStatus");

  // ---- actions -------------------------------------------------------------------
  function desktopOnly() {
    toast(ERRORS.unavailable, "info");
  }
  async function join() {
    if (!bridge("communityOpen")) { desktopOnly(); return { ok: false, error: "unavailable" }; }
    const opened = await call("communityOpen", "invite");
    await call("communityPrompt", "joined");
    if (!opened.ok) statusLine(ERRORS[opened.error] || "Studio couldn't open the invite.");
    return opened;
  }
  async function link() {
    if (!bridge("communityLink")) { desktopOnly(); return { ok: false, error: "unavailable" }; }
    if (busy) return { ok: false, error: "busy" };
    busy = "link"; statusLine(""); renderSettings();
    const result = await call("communityLink");
    busy = null;
    if (result.ok) {
      statusLine("Discord linked."); toast("Discord linked.", "good");
    } else if (result.error === "not-member") {
      statusLine(ERRORS["not-member"]);
      toast("Linked, but your Discord account isn't in the Void Engine server yet.", "info", { duration: 12000, action: { label: "Join the Discord", run: () => { void join(); } } });
    } else if (result.error === "canceled") {
      statusLine(ERRORS.canceled);
    } else {
      const message = ERRORS[result.error] || `Linking didn't finish (${result.error || "unknown error"}).`;
      statusLine(message); toast(message, "bad");
    }
    renderSettings();
    return result;
  }
  const cancelLink = () => call("communityLinkCancel");
  async function check() {
    if (busy) return { ok: false, error: "busy" };
    busy = "check"; renderSettings();
    const result = await call("communityCheck");
    busy = null;
    // Main drops a check's answer ("canceled") when a link or unlink landed
    // meanwhile; that is not the linking-canceled story.
    const failed = result.error === "canceled" ? "The link changed during the check, so Studio set that answer aside. Choose Check now to ask again."
      : ERRORS[result.error] || `The check didn't finish (${result.error || "unknown error"}).`;
    statusLine(result.ok ? "Checked just now." : failed);
    renderSettings();
    return result;
  }
  async function unlink() {
    if (busy) return { ok: false, error: "busy" };
    busy = "unlink"; renderSettings();
    const result = await call("communityUnlink");
    busy = null;
    statusLine(result.ok ? "Discord unlinked. Studio deleted its sign-in and stopped checking." : ERRORS[result.error] || `Unlinking didn't finish (${result.error || "unknown error"}).`);
    renderSettings();
    return result;
  }
  function never() {
    hideCard();
    void call("communityPrompt", "never");
    toast("Settings › General › Community has the link any time.", "info");
  }

  // ---- Settings › Community --------------------------------------------------------
  function settingsCard() {
    const card = $("settings-community");
    if (!card || card.closest?.("#studio-desktop[hidden]")) return null;
    return card;
  }
  // Opens Settings at the Community card: the section param deep-links it
  // (Settings opens and scrolls to the card itself), and the card is opened
  // and scrolled here too, for a Settings that does not read the param yet.
  // Where Settings cannot show it, the inline card in the workspace stands in,
  // else a toast that can open the invite.
  function open() {
    init();
    if (!desktop()) { desktopOnly(); return false; }
    const card = settingsCard();
    if (!card || typeof window.MefiNav?.go !== "function") {
      if (window.MefiWorkspace?.isActive?.() && showCard("open")) return true;
      toast(`${TITLE} ${PITCH}`, "info", { duration: 12000, action: { label: "Join the Discord", run: () => { void join(); } } });
      return false;
    }
    window.MefiNav.go("studio", { section: "settings-community" });
    card.open = true;
    renderSettings();
    later(() => { try { card.scrollIntoView?.({ block: "start", behavior: noMotion() ? "auto" : "smooth" }); } catch {} });
    return true;
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  // Settings buttons carry an action name so a rebuild can hand keyboard focus
  // back to the control the user pressed. Busy controls use aria-disabled, not
  // disabled, so they stay focusable while their label says what is running.
  function button(label, run, { className = "ghost", disabled = false, title = "", action = "" } = {}) {
    const element = node("button", className, label);
    element.type = "button";
    if (disabled) element.setAttribute("aria-disabled", "true");
    if (title) element.title = title;
    element.addEventListener("click", () => { if (!disabled) void run(); });
    rendered.push([action || label, element]);
    return element;
  }
  function row(...children) {
    const element = node("div", "row tight");
    element.append(...children.filter(Boolean));
    return element;
  }
  function statusLine(text) {
    const line = $("community-settings-status");
    if (line) line.textContent = text;
  }
  function initials(name) {
    const words = String(name || "").trim().split(/[\s._-]+/).filter(Boolean);
    const letters = words.length > 1 ? words.slice(0, 2).map((word) => Array.from(word)[0]) : Array.from(words[0] || "").slice(0, 2);
    return letters.join("").toUpperCase() || "?";
  }
  function span(ms) {
    const abs = Math.abs(ms);
    for (const [size, unit] of [[DAY, "day"], [HOUR, "hour"], [MINUTE, "minute"]]) {
      if (abs >= size) { const count = Math.round(abs / size); return `${count} ${unit}${count === 1 ? "" : "s"}`; }
    }
    return "";
  }
  function checkedLine(status) {
    const checked = Number.isFinite(status.checkedAt) ? status.checkedAt : null;
    const next = Number.isFinite(status.nextCheckAt) ? status.nextCheckAt : null;
    const was = checked == null ? "not yet" : now() - checked < MINUTE ? "just now" : `${span(now() - checked)} ago`;
    const will = next == null ? "not scheduled" : next - now() < MINUTE ? "soon" : `in ${span(next - now())}`;
    return `Last checked ${was} · next check ${will}`;
  }
  function view() {
    if (!desktop()) return "desktop";
    if (!last) return "loading";
    if (last.available === false) return "unavailable";
    if (last.linking || busy === "link") return "linking";
    if (!last.linked) return last.configured ? "unlinked" : "not-configured";
    return ["not-member", "relink", "offline", "session"].includes(last.state) ? last.state : "ok";
  }
  function linkedParts(state) {
    const user = last.user || {};
    const shown = user.globalName || user.username || "Discord account";
    const who = node("div", "community-who");
    const names = node("div", "community-names");
    names.append(node("strong", "", shown));
    if (user.username) names.append(node("div", "muted", `@${user.username}`));
    who.append(node("span", "community-avatar", initials(shown)), names);
    const parts = [who];
    const roles = Array.isArray(last.roles) ? last.roles.length : 0;
    if (last.member === true) {
      const badges = node("div", "community-badges");
      badges.append(node("span", "badge free", "Member"));
      if (roles) badges.append(node("span", "badge", `${roles} role${roles === 1 ? "" : "s"}`));
      who.append(badges);
    }
    if (state === "offline") parts.push(node("p", "community-callout", "Couldn't reach Discord. Studio tries again soon."));
    else if (state === "relink") parts.push(node("p", "community-callout", "Discord needs you to link again."));
    else if (state === "not-member") parts.push(node("p", "community-callout", "Your Discord account isn't in the Void Engine server."));
    else if (state === "session") parts.push(node("p", "muted community-aside", "This link lasts until Studio closes: secure storage isn't available on this computer."));
    parts.push(node("p", "muted community-aside", USES), node("p", "muted community-checked", checkedLine(last)));
    // One size per row (the small Settings buttons); the next step, if there is
    // one, is the primary, and Unlink stays a quiet secondary at the end.
    const checking = busy === "check";
    const checkNow = button(checking ? "Checking…" : "Check now", check, { className: "ghost mini", disabled: Boolean(busy), title: "Ask Discord again now", action: "check" });
    const unlinkButton = button("Unlink", unlink, { className: "ghost mini community-unlink", disabled: Boolean(busy), title: "Revoke Studio's sign-in and forget this account", action: "unlink" });
    if (state === "relink") parts.push(row(button(LINK_LABEL, link, { className: "primary mini", disabled: Boolean(busy), action: "link" }), unlinkButton));
    else if (state === "not-member") parts.push(row(button("Join the Discord", join, { className: "primary mini", title: "Open the Void Engine invite in your browser" }), checkNow, unlinkButton));
    else parts.push(row(checkNow, unlinkButton));
    return parts;
  }
  // The button of the last render that holds keyboard focus, by action name.
  function focusedAction() {
    let active = null;
    try { active = document.activeElement; } catch { return null; }
    if (!active) return null;
    const pair = rendered.find(([, element]) => element === active);
    return pair ? pair[0] : null;
  }
  // After a rebuild, focus goes back where it was: the same control, else the
  // card's first live control (Link becomes Cancel while linking), else the
  // status line. Nothing moves when focus was somewhere else.
  function restoreFocus(action) {
    if (action == null) return;
    const live = rendered.filter(([, element]) => element.getAttribute?.("aria-disabled") !== "true");
    const target = rendered.find(([name]) => name === action)?.[1] ?? live[0]?.[1] ?? rendered[0]?.[1] ?? $("community-settings-status");
    if (!target) return;
    try {
      if (target.id === "community-settings-status") target.setAttribute("tabindex", "-1");
      target.focus?.({ preventScroll: true });
    } catch {}
  }
  // ---- connection details --------------------------------------------------------
  // The two public values that connect Studio to the Void Engine: the Mefi
  // Studio Link application id (what Link my Discord signs in with) and the
  // rooms hub's address (Rooms, Friends and Listen together). Main saves them in
  // settings (community:setup) and uses them at once; the environment variables
  // of a maintainer's test setup still win. Built once beside the card body, so
  // a status repaint never wipes what is being typed.
  let setupBox = null;
  let setupTouched = false;
  function setupField(label, id, placeholder) {
    const wrap = node("label", "community-setup-field");
    const input = node("input");
    input.id = id;
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = placeholder;
    wrap.append(node("span", "", label), input);
    return { wrap, input };
  }
  function setupSection() {
    const body = $("community-settings-body");
    if (setupBox || !body || !bridge("communitySetup")) return;
    setupBox = node("details", "community-setup");
    setupBox.id = "community-setup";
    const client = setupField("Link app ID", "community-setup-client", "17 to 20 digits");
    client.input.inputMode = "numeric";
    const hub = setupField("Rooms hub address", "community-setup-hub", "https://hub.example.com");
    const env = node("p", "muted community-setup-env");
    env.id = "community-setup-env";
    env.hidden = true;
    const result = node("p", "muted community-setup-status");
    result.id = "community-setup-status";
    result.setAttribute("role", "status");
    const save = node("button", "primary mini", "Save");
    save.type = "button";
    save.id = "community-setup-save";
    const paint = (setup) => {
      if (!setup?.ok && !setup?.errors) return;
      if (document.activeElement !== client.input) client.input.value = setup.clientId || "";
      if (document.activeElement !== hub.input) hub.input.value = setup.hubUrl || "";
      const overridden = [setup.environment?.clientId ? "MEFI_STUDIO_DISCORD_CLIENT_ID" : "", setup.environment?.hubUrl ? "MEFI_STUDIO_HUB_URL" : ""].filter(Boolean);
      env.textContent = overridden.length ? `${overridden.join(" and ")} ${overridden.length > 1 ? "are" : "is"} set on this PC and ${overridden.length > 1 ? "win" : "wins"} over what is saved here.` : "";
      env.hidden = !overridden.length;
    };
    save.addEventListener("click", async () => {
      save.disabled = true;
      result.textContent = "Saving…";
      const saved = await call("communitySetup", { clientId: client.input.value, hubUrl: hub.input.value });
      save.disabled = false;
      if (saved?.error === "invalid") {
        result.textContent = [saved.errors?.clientId, saved.errors?.hubUrl].filter(Boolean).join(" ");
        return;
      }
      if (!saved?.ok) { result.textContent = "Studio couldn't save these. Try again."; return; }
      paint(saved);
      const link = saved.linkReady ? "Link my Discord is ready above." : "Add the link app ID to link Discord.";
      const reach = saved.health == null ? (saved.hubReady ? "" : "Add the hub address for Rooms and Friends.")
        : saved.health.ok ? `The hub answered${saved.health.paused ? ", but it is paused for now" : ""}.` : saved.health.error;
      result.textContent = `Saved. ${link} ${reach}`.trim();
    });
    setupBox.addEventListener("toggle", () => { if (setupBox.open) setupTouched = true; });
    setupBox.append(
      node("summary", "", "Connection details"),
      node("p", "muted", "Studio reaches the Void Engine through two public values: the Mefi Studio Link Application ID (Discord Developer Portal) and the rooms hub's address. Set them once on each PC; they apply at once."),
      client.wrap, hub.wrap, env, row(save), result,
    );
    body.after(setupBox);
    void call("communitySetup").then(paint);
  }
  function renderSettings() {
    const body = $("community-settings-body");
    if (!body) return;
    setupSection();
    const focused = focusedAction();
    rendered = [];
    const state = view();
    let parts;
    if (state === "desktop") parts = [node("p", "", ERRORS.unavailable), node("p", "muted", PITCH)];
    else if (state === "loading") parts = [node("p", "muted", "Checking your Discord link…")];
    else if (state === "unavailable") parts = [node("p", "", "Community linking isn't available in this build."), node("p", "muted", PITCH)];
    else if (state === "linking") parts = [node("p", "community-waiting", "Waiting for Discord in your browser. Approve Studio there, then come back here."), row(button("Cancel", cancelLink))];
    else if (state === "unlinked") parts = [node("p", "", PITCH), node("p", "muted community-aside", USES), row(button("Join the Discord", join), button(LINK_LABEL, link, { className: "primary", title: "Sign in with Discord in your browser" }))];
    else if (state === "not-configured") parts = [node("p", "", "Discord linking isn't set up on this PC yet. Add the link app ID under Connection details below."), node("p", "muted", PITCH), row(button("Join the Discord", join))];
    else parts = linkedParts(state);
    body.replaceChildren(...parts);
    // Not set up yet: open the details, unless the owner has handled them.
    if (setupBox && !setupTouched && state === "not-configured") setupBox.open = true;
    restoreFocus(focused);
  }

  // ---- the weekly card -----------------------------------------------------------
  function renderCard() {
    const linkButton = $("community-invite-link");
    if (linkButton) linkButton.hidden = last?.configured !== true || Boolean(last.linked && last.state !== "relink");
  }
  function showCard(mode) {
    const card = $("community-invitation");
    if (!card) return false;
    cardMode = mode;
    renderCard();
    try { card.classList?.toggle?.("community-enter", !noMotion()); } catch {}
    card.hidden = false;
    return true;
  }
  function hideCard() {
    const card = $("community-invitation");
    if (card) card.hidden = true;
    cardMode = null;
  }
  // Not now and Escape snooze the weekly card for a week; the same buttons on
  // a card opened by hand (Community, where Settings cannot show) only close it.
  function dismissCard(action) {
    const mode = cardMode;
    hideCard();
    if (mode === "weekly" && action) void call("communityPrompt", action);
  }
  function booting() {
    const gate = $("boot-layer");
    if (!gate || gate.hidden) return false;
    if (typeof getComputedStyle !== "function") return true;
    try { return getComputedStyle(gate).display !== "none"; } catch { return true; }
  }
  function eligible() {
    return desktop() && !headless() && !shownThisSession && last?.available !== false && last?.prompt?.due === true && last.member !== true;
  }
  function quiet() {
    if (headless() || !desktop() || booting()) return false;
    if (window.MefiNav?.state?.transient != null) return false;
    const guide = window.MefiOnboarding?.status?.();
    if (guide === "new" || guide === "reading") return false;
    // Never stacked under the walkthrough's own invitation, whatever its status says.
    const guideCard = $("walkthrough-invitation");
    if (guideCard && !guideCard.hidden) return false;
    if (now() - lastKeyAt < KEY_QUIET_MS) return false;
    return (document.visibilityState ?? "visible") === "visible";
  }
  function present() {
    shownThisSession = true;
    if (window.MefiWorkspace?.isActive?.() && showCard("weekly")) { void call("communityPrompt", "shown"); return; }
    if (typeof window.MefiToast !== "function") return;
    toast(`${TITLE} ${PITCH}`, "info", {
      duration: 12000,
      action: { label: "Open Community", run: () => open() },
    });
    void call("communityPrompt", "shown");
  }
  // Bounded like nav.js keyHint: a busy moment retries every few seconds for
  // about ten minutes, then waits for the next visibility change or poll.
  function attempt() {
    timer = 0;
    if (!eligible()) return;
    if (!quiet()) {
      if (tries++ < RETRY_LIMIT) timer = setTimeout(attempt, booting() ? BOOT_RETRY_MS : RETRY_MS);
      return;
    }
    present();
  }
  function schedule(delay = FIRST_TRY_MS) {
    if (timer || !eligible()) return;
    tries = 0;
    timer = setTimeout(attempt, delay);
  }
  // A window left open for days still meets the card: the six-hour poll and
  // every return to the window re-read the status (a local read, no network).
  function recheck() {
    if (shownThisSession || headless() || !desktop()) return;
    void refresh().then(() => schedule());
  }

  // ---- wiring ---------------------------------------------------------------------
  function on(id, run) {
    $(id)?.addEventListener("click", run);
  }
  function register() {
    try {
      window.MefiNav?.register?.({
        id: "community",
        label: "Void Engine Discord",
        short: "Community",
        kind: "action",
        layer: null,
        group: "system",
        key: null,
        glyph: "g-community",
        badge: null,
        desc: "Join the Void Engine Discord and link your account for Listen together",
        searchTerms: "discord community void engine members link rooms listen together share builds",
        showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
        run: () => open(),
      });
    } catch {}
  }
  function init() {
    if (initialized) return;
    initialized = true;
    try { localStorage.removeItem(OLD_HINT_KEY); } catch {}
    const privacy = $("community-privacy");
    if (privacy) privacy.textContent = PRIVACY;
    on("community-invite-join", () => { hideCard(); void join(); });
    on("community-invite-link", () => { hideCard(); void link(); });
    on("community-invite-later", () => dismissCard("snooze"));
    on("community-invite-never", () => never());
    on("workspace-community", () => open());
    $("community-invitation")?.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !cardMode) return;
      event.preventDefault?.(); event.stopPropagation?.();
      dismissCard("snooze");
    });
    $("settings-community")?.addEventListener("toggle", () => {
      if ($("settings-community").open && desktop()) void refresh();
    });
    try { window.addEventListener("keydown", () => { lastKeyAt = now(); }, true); } catch {}
    register();
    renderSettings();
  }
  // Called once from booklet.js's boot callback, after the walkthrough's own
  // startup. Diagnostic (capture/smoke) and bridge-less launches stop here.
  function startup() {
    init();
    if (started) return;
    started = true;
    if (headless() || !desktop()) return;
    try { bridge("onCommunityEvent")?.((status) => { adopt(status); schedule(); }); } catch {}
    void refresh().then(() => schedule());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") recheck(); });
    if (typeof window.MefiBoot?.pollStart === "function") window.MefiBoot.pollStart("community.prompt", recheck, RECHECK_MS);
  }

  window.MefiCommunity = {
    init,
    startup,
    status: () => last,
    refresh,
    open,
    join,
    link,
    cancelLink,
    check,
    unlink,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
