// The Void Engine community layer, renderer side: window.MefiCommunity is the
// member-perk gate the Style pickers ask, the weekly "join the Discord" card
// in the workspace, and the Settings › Community card. Every network call runs
// in main (scripts/discord-oauth.cjs behind the community:* IPC); this file
// only ever sees the public STATUS object, which never carries a token.
//
// The lock is honest and soft: scripts/community.cjs holds one documented fork
// switch, SELF_UNLOCKED, and every locked surface says so (FORK_COPY) next to
// a Copy agent prompt button. With no bridge (start:web, an older desktop
// build) nothing unlocks, the card never shows and Settings says linking needs
// the desktop app. The weekly card is quiet by construction: it waits for the
// boot gate, any open dialog, a new or unfinished walkthrough, recent typing
// and a hidden window, shows at most once a session, and main decides when it
// is due at all.
(function () {
  "use strict";
  const HINT_KEY = "mefiStudio.community.v1";
  // Duplicated from scripts/community.cjs, which the renderer cannot require;
  // tests/community_ui.test.mjs pins both sentences to it.
  const FORK_COPY = "Members of the Void Engine Discord unlock these. Studio is MIT-licensed: fork the project and unlock it yourself, or ask an agent to do it for you.";
  const AGENT_PROMPT = "In my fork of Mefi's Studio AI+, set SELF_UNLOCKED to true in scripts/community.cjs so the Void collection themes and node styles unlock without Discord, then run npm run check and npm test.";
  const PITCH = "Share what you're making, swap model setups, and hang out with other builders. Members unlock the Void collection: four themes and three node styles.";
  // A failed check retries after an hour, then six, then daily (scripts/community.cjs).
  const PRIVACY = "Linking reads your Discord id and name, and your roles and join date in the Void Engine server: when you link, about once a week (sooner after a failed check, then daily), and when you press Check now. Studio keeps them in its settings on this computer, with the sign-in encrypted in community-auth.json. Nothing about your projects is sent. Unlink revokes the sign-in and deletes both.";
  const PERK_COPY = { premium: "Void collection — 4 themes and 3 node styles" };
  // The Workspace theme select names a locked Void collection theme like this.
  const LOCKED_OPTION = (name) => `${name} · members`;
  // One name for the link action on every surface (the Style pickers' Void
  // boxes say the same); relinking after Discord asks is the same button.
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
    "not-configured": "Discord linking isn't set up in this build yet.",
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
  let hint = readHint();      // the boot hint, until the first STATUS lands
  let announced = null;       // the entitlement last dispatched as mefi-community-change
  let linkAnnounced = null;   // the link state last dispatched as mefi-community-status
  let rendered = [];          // [action, button] pairs from the last Settings render
  let initialized = false;
  let started = false;
  let shownThisSession = false;
  let lastKeyAt = -Infinity;
  let tries = 0;
  let timer = 0;
  let cardMode = null;        // "weekly" | "offer" while the inline card shows
  let busy = null;            // "link" | "check" | "unlink" while a host call runs
  let noteText = "";
  let noteLead = "";          // an offer's first sentence; the hint after it follows the link state
  let noteKey = "";           // the locked item the note names, marked in the showcase
  let showcaseBuilt = false;

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

  // ---- entitlement and the boot hint ------------------------------------------
  function readHint() {
    try {
      const value = JSON.parse(localStorage.getItem(HINT_KEY));
      return { premium: value?.premium === true, validUntil: Number.isFinite(value?.validUntil) ? value.validUntil : null };
    } catch { return { premium: false, validUntil: null }; }
  }
  function writeHint(entitlement) {
    hint = { premium: entitlement.premium, validUntil: entitlement.validUntil };
    try { localStorage.setItem(HINT_KEY, JSON.stringify(hint)); } catch {}
  }
  function entitlementOf(status) {
    const value = status?.entitlement || {};
    return {
      premium: value.premium === true,
      perks: Array.isArray(value.perks) ? value.perks.filter((perk) => typeof perk === "string") : [],
      validUntil: Number.isFinite(value.validUntil) ? value.validUntil : null,
      reason: typeof value.reason === "string" ? value.reason : null,
    };
  }
  // Before the first STATUS the boot hint answers for "premium" alone, so a
  // member's saved theme paints on launch instead of flashing the free one.
  function has(perk) {
    if (!desktop()) return false;
    if (last) return entitlementOf(last).perks.includes(perk);
    return perk === "premium" && hint.premium === true && (hint.validUntil == null || hint.validUntil > now());
  }
  function adopt(status) {
    if (!status || typeof status !== "object") return;
    last = status;
    const entitlement = entitlementOf(status);
    writeHint(entitlement);
    const signature = JSON.stringify(entitlement);
    if (signature !== announced) {
      announced = signature;
      try { window.dispatchEvent(new CustomEvent("mefi-community-change", { detail: entitlement })); } catch {}
    }
    // Whether linking is possible here (a client id, not linked yet, or asked
    // to link again) can change with the entitlement unchanged; the Style
    // pickers' Link buttons follow this one.
    const linkState = { configured: status.configured === true, linked: status.linked === true, state: typeof status.state === "string" ? status.state : null, linking: status.linking === true };
    const linkSignature = JSON.stringify(linkState);
    if (linkSignature !== linkAnnounced) {
      linkAnnounced = linkSignature;
      try { window.dispatchEvent(new CustomEvent("mefi-community-status", { detail: linkState })); } catch {}
    }
    if (cardMode === "weekly" && (entitlement.premium || status.prompt?.never)) hideCard();
    renderCard();
    renderSettings();
  }
  const refresh = () => call("communityStatus");

  // ---- actions -------------------------------------------------------------------
  function desktopOnly() {
    toast(`Linking the Void Engine Discord needs the desktop app. ${FORK_COPY}`, "info", { duration: 12000, action: { label: "Copy agent prompt", run: () => { void copyAgentPrompt(); } } });
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
      const message = entitlementOf(last).premium ? "Discord linked. The Void collection is unlocked." : "Discord linked.";
      statusLine(message); toast(message, "good");
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
  async function copyAgentPrompt() {
    let ok = false;
    try {
      const copy = bridge("shellCopy");
      if (copy) ok = (await copy(AGENT_PROMPT))?.ok !== false;
      else if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(AGENT_PROMPT); ok = true; }
    } catch { ok = false; }
    toast(ok ? "Agent prompt copied" : "Couldn't copy the agent prompt. Settings › Community shows it under “What the agent will change”.", ok ? "good" : "bad");
    return ok;
  }
  // Opens Style & sound at the Void collection's themes, with keyboard focus on
  // the one in use (else the first), after the sheet has claimed its focus.
  function chooseTheme() {
    try { window.MefiNav?.go?.("music"); } catch {}
    later(() => {
      try {
        const group = document.getElementById("music-premium-themes");
        const choice = group?.querySelector?.('[aria-pressed="true"]') ?? group?.firstElementChild;
        choice?.focus?.({ preventScroll: true });
        group?.scrollIntoView?.({ block: "center", behavior: noMotion() ? "auto" : "smooth" });
      } catch {}
    });
  }
  function never() {
    hideCard();
    void call("communityPrompt", "never");
    toast("Settings › Community has the link any time.", "info");
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
  // Where Settings cannot show it, the inline card in the workspace carries
  // the same explanation instead.
  function open(options = {}) {
    init();
    noteText = typeof options.note === "string" ? options.note : "";
    noteLead = noteText && typeof options.lead === "string" ? options.lead : "";
    noteKey = noteText && typeof options.key === "string" ? options.key : "";
    if (!desktop()) { desktopOnly(); return false; }
    const card = settingsCard();
    if (!card || typeof window.MefiNav?.go !== "function") {
      if (window.MefiWorkspace?.isActive?.() && showCard("offer", noteText)) return true;
      toast(noteText ? `${noteText} ${FORK_COPY}` : FORK_COPY, "info", { duration: 12000, action: { label: "Copy agent prompt", run: () => { void copyAgentPrompt(); } } });
      return false;
    }
    window.MefiNav.go("studio", { section: "settings-community" });
    card.open = true;
    renderSettings();
    later(() => { try { card.scrollIntoView?.({ block: "start", behavior: noMotion() ? "auto" : "smooth" }); } catch {} });
    return true;
  }
  // Explains a locked item without moving the view: the inline card while the
  // workspace shows, else a toast whose action opens Settings › Community. A
  // picker that changes on a keystroke (the Workspace theme select) asks for
  // this, so arrowing through its options never carries anyone away (WCAG 3.2.2).
  function explain(note, lead, key) {
    init();
    if (!desktop()) { desktopOnly(); return false; }
    if (window.MefiWorkspace?.isActive?.() && showCard("offer", note)) return true;
    toast(`${lead} ${FORK_COPY}`, "info", { duration: 12000, action: { label: "See the perks", run: () => open({ note, key, lead }) } });
    return true;
  }
  // How this account could unlock the item: link (or join first), and the
  // fork path the card shows below the note either way.
  function unlockHint() {
    if (last && last.configured === false) return "Build it yourself to use it (see below).";
    if (last?.linked === true && last.state === "not-member") return "Join the Void Engine Discord to use it, or build it yourself (see below).";
    return "Link your Discord membership to use it, or build it yourself (see below).";
  }
  // navigate:false keeps the user where they are (see explain); by default a
  // click on a locked button opens Settings › Community.
  function offer(item) {
    const { kind, key, name, navigate } = item && typeof item === "object" ? item : {};
    const label = String(name || key || "This item");
    const lead = kind === "nodeStyle" ? `The ${label} node style is part of the Void collection.` : `${label} is part of the Void collection.`;
    const note = `${lead} ${unlockHint()}`;
    const itemKey = typeof key === "string" ? key : "";
    return navigate === false ? explain(note, lead, itemKey) : open({ note, key: itemKey, lead });
  }
  // The Settings note as the account stands now: linking or joining changes
  // the hint after an offer's lead, and an unlocked collection needs no note.
  function currentNote(entitlement) {
    if (!noteText || entitlement.premium) return "";
    return noteLead ? `${noteLead} ${unlockHint()}` : noteText;
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
  function noteLine(element, text) {
    if (!element) return;
    element.textContent = text || "";
    element.hidden = !text;
  }
  function initials(name) {
    const words = String(name || "").trim().split(/[\s._-]+/).filter(Boolean);
    const letters = words.length > 1 ? words.slice(0, 2).map((word) => Array.from(word)[0]) : Array.from(words[0] || "").slice(0, 2);
    return letters.join("").toUpperCase() || "?";
  }
  function day(ms) {
    try { return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return new Date(ms).toISOString().slice(0, 10); }
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
  // ---- the Void collection, drawn from the Style pickers' own catalog ----------
  function catalog() {
    try {
      const value = window.MefiMusic?.premiumCatalog?.();
      return value && Array.isArray(value.themes) && Array.isArray(value.nodeStyles) ? value : null;
    } catch { return null; }
  }
  // The Workspace theme select (workspace.js) lists the Void collection in its
  // own optgroup. While it is locked each option says so; the options stay
  // enabled, since choosing one explains the lock in place. Unlocking brings the
  // plain names back. Only the labels change: the template's markup stays put.
  function labelThemeOptions(unlocked) {
    const select = $("workspace-accent");
    const themes = catalog()?.themes;
    if (!select || !themes?.length) return;
    const names = new Map(themes.map((theme) => [theme.key, theme.name]));
    for (const option of Array.from(select.options || [])) {
      const name = names.get(option.value);
      if (!name) continue;
      const label = unlocked ? name : LOCKED_OPTION(name);
      if (option.textContent !== label) option.textContent = label;
    }
  }
  // A two-tone swatch (music.css .void-swatch): the accent ring around the second hue.
  function swatch(theme) {
    const dot = node("span", "void-swatch");
    try { dot.style.setProperty("--swatch", theme.accent); dot.style.setProperty("--swatch-2", theme.accent2); } catch {}
    return dot;
  }
  function swatchCluster(className) {
    const themes = catalog()?.themes || [];
    if (!themes.length) return null;
    const cluster = node("span", className);
    cluster.setAttribute("aria-hidden", "true");
    for (const theme of themes) cluster.append(swatch(theme));
    return cluster;
  }
  // The strip at the top of Settings › Community: the four themes and three
  // node styles (the Style pickers' own preview art), built once.
  function buildShowcase() {
    const items = $("community-showcase-items");
    const list = catalog();
    if (showcaseBuilt || !items || !list) return;
    showcaseBuilt = true;
    const tile = (key, name, art) => {
      const item = node("span", "community-showcase-item");
      item.dataset.key = key;
      const frame = node("span", "community-showcase-art");
      frame.append(art);
      item.append(frame, node("span", "community-showcase-name", name));
      return item;
    };
    const themes = node("span", "community-showcase-group");
    for (const theme of list.themes) themes.append(tile(theme.key, theme.name, swatch(theme)));
    const styles = node("span", "community-showcase-group");
    for (const style of list.nodeStyles) {
      const art = node("span", `music-node-preview music-preview-${style.key}`);
      for (let index = 0; index < 3; index += 1) art.append(node("i"));
      styles.append(tile(style.key, style.name, art));
    }
    items.replaceChildren(themes, styles);
  }
  function renderShowcase(state, entitlement) {
    buildShowcase();
    const unlocked = entitlement.premium === true;
    const line = $("community-showcase-state");
    if (line) {
      line.textContent = state === "self" ? "Unlocked in this build" : unlocked ? "Unlocked with your Void Engine membership" : "For members of the Void Engine Discord";
      line.setAttribute("data-unlocked", String(unlocked));
    }
    const choose = $("community-choose");
    if (choose) choose.hidden = !unlocked;
    for (const item of $("community-showcase-items")?.querySelectorAll?.(".community-showcase-item") || []) {
      if (noteKey && !unlocked && item.dataset.key === noteKey) item.dataset.current = "true";
      else delete item.dataset.current;
    }
  }
  function perkList(entitlement) {
    const list = node("ul", "community-perks");
    for (const perk of ["premium", ...entitlement.perks.filter((item) => item !== "premium")]) {
      const on = entitlement.perks.includes(perk);
      const item = node("li", "", PERK_COPY[perk] || perk);
      const swatches = perk === "premium" ? swatchCluster("community-perk-swatches") : null;
      if (swatches) item.append(swatches);
      item.append(node("span", on ? "badge free" : "badge", on ? "On" : "Locked"));
      list.append(item);
    }
    return list;
  }
  // The fork path, kept quiet: the sentence, the copy button, and the prompt
  // itself behind a disclosure for anyone who wants to read it first.
  function forkBlock() {
    const block = node("div", "community-fork");
    block.append(node("span", "community-fork-title", "Build it yourself"), node("p", "community-fork-copy", FORK_COPY));
    const actions = node("div", "community-fork-actions");
    const prompt = node("details", "community-prompt");
    const code = node("pre", "community-prompt-code");
    code.append(node("code", "", AGENT_PROMPT));
    prompt.append(node("summary", "", "What the agent will change"), code);
    actions.append(button("Copy agent prompt", copyAgentPrompt, { className: "ghost mini", title: "Copy a prompt that unlocks the collection in your own fork" }), prompt);
    block.append(actions);
    return [block];
  }
  function view() {
    if (!desktop()) return "desktop";
    if (!last) return "loading";
    if (last.available === false) return "unavailable";
    if (last.selfUnlocked) return "self";
    if (last.linking || busy === "link") return "linking";
    if (!last.linked) return last.configured ? "unlinked" : "not-configured";
    return ["not-member", "relink", "offline", "session"].includes(last.state) ? last.state : "ok";
  }
  function linkedParts(state, entitlement) {
    const user = last.user || {};
    const shown = user.globalName || user.username || "Discord account";
    const who = node("div", "community-who");
    const names = node("div", "community-names");
    names.append(node("strong", "", shown));
    if (user.username) names.append(node("div", "muted", `@${user.username}`));
    who.append(node("span", "community-avatar", initials(shown)), names);
    const parts = [who];
    const roles = Array.isArray(last.roles) ? last.roles.length : 0;
    if (state !== "not-member") {
      const badges = node("div", "community-badges");
      badges.append(node("span", "badge free", "Member"));
      if (roles) badges.append(node("span", "badge", `${roles} role${roles === 1 ? "" : "s"}`));
      who.append(badges);
    }
    const until = entitlement.premium && entitlement.validUntil != null ? ` Perks stay on until ${day(entitlement.validUntil)}.` : "";
    if (state === "offline") parts.push(node("p", "community-callout", `Couldn't reach Discord.${until || " Studio tries again soon."}`));
    else if (state === "relink") parts.push(node("p", "community-callout", `Discord needs you to link again.${until}`));
    else if (state === "not-member") parts.push(node("p", "community-callout", "Your Discord account isn't in the Void Engine server."));
    else if (state === "session") parts.push(node("p", "muted community-aside", "This link lasts until Studio closes: secure storage isn't available on this computer."));
    parts.push(perkList(entitlement), node("p", "muted community-checked", checkedLine(last)));
    // One size per row (the small Settings buttons); the next step, if there is
    // one, is the primary, and Unlink stays a quiet secondary at the end.
    const checking = busy === "check";
    const checkNow = button(checking ? "Checking…" : "Check now", check, { className: "ghost mini", disabled: Boolean(busy), title: "Ask Discord again now", action: "check" });
    const unlinkButton = button("Unlink", unlink, { className: "ghost mini community-unlink", disabled: Boolean(busy), title: "Revoke Studio's sign-in and forget this account", action: "unlink" });
    if (state === "relink") parts.push(row(button(LINK_LABEL, link, { className: "primary mini", disabled: Boolean(busy), action: "link" }), unlinkButton));
    else if (state === "not-member") parts.push(row(button("Join the Discord", join, { className: "primary mini", title: "Open the Void Engine invite in your browser" }), checkNow, unlinkButton));
    else parts.push(row(checkNow, unlinkButton));
    if (!entitlement.premium) parts.push(...forkBlock());
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
  function renderSettings() {
    const body = $("community-settings-body");
    if (!body) return;
    const focused = focusedAction();
    rendered = [];
    const state = view();
    const entitlement = entitlementOf(last);
    let parts;
    if (state === "desktop") parts = [node("p", "", ERRORS.unavailable), node("p", "muted", PITCH), ...forkBlock()];
    else if (state === "loading") parts = [node("p", "muted", "Checking your Discord link…")];
    else if (state === "unavailable") parts = [node("p", "", "Community linking isn't available in this build."), ...forkBlock()];
    else if (state === "self") parts = [node("p", "", "This build unlocks the Void collection itself (SELF_UNLOCKED), so it needs no Discord link."), perkList(entitlement), row(button("Join the Discord", join, { className: "ghost mini", title: "Open the Void Engine invite in your browser" }))];
    else if (state === "linking") parts = [node("p", "community-waiting", "Waiting for Discord in your browser. Approve Studio there, then come back here."), row(button("Cancel", cancelLink))];
    else if (state === "unlinked") parts = [node("p", "", PITCH), row(button("Join the Discord", join), button(LINK_LABEL, link, { className: "primary", title: "Sign in with Discord in your browser" })), ...forkBlock()];
    else if (state === "not-configured") parts = [node("p", "", "Discord linking isn't set up in this build yet."), node("p", "muted", PITCH), row(button("Join the Discord", join)), ...forkBlock()];
    else parts = linkedParts(state, entitlement);
    body.replaceChildren(...parts);
    noteLine($("community-settings-note"), currentNote(entitlement));
    renderShowcase(state, entitlement);
    restoreFocus(focused);
  }

  // ---- the weekly card -----------------------------------------------------------
  function renderCard() {
    const linkButton = $("community-invite-link");
    if (linkButton) linkButton.hidden = last?.configured !== true || Boolean(last.linked && last.state !== "relink");
  }
  function showCard(mode, note = "") {
    const card = $("community-invitation");
    if (!card) return false;
    cardMode = mode;
    noteLine($("community-invite-note"), note);
    const copy = $("community-invite-copy");
    if (copy) copy.hidden = mode !== "offer";
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
  // an offer card (a locked item was clicked) only close it.
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
    return desktop() && !headless() && !shownThisSession && last?.available !== false && last?.prompt?.due === true && !entitlementOf(last).premium;
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
    toast("Build with others in the Void Engine Discord. Members unlock the Void collection: four themes and three node styles.", "info", {
      duration: 12000,
      action: { label: "See the perks", run: () => open() },
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
        label: "Void Engine Discord & perks",
        short: "Community",
        kind: "action",
        layer: null,
        group: "system",
        key: null,
        glyph: "g-community",
        badge: null,
        desc: "Join the Void Engine Discord, link your account and see the members' Void collection",
        searchTerms: "discord community void engine members perks themes node styles link unlock fork",
        showIn: { tabs: false, tools: false, dock: false, palette: true, help: false, footer: false },
        run: () => open(),
      });
    } catch {}
  }
  function init() {
    if (initialized) return;
    initialized = true;
    const fine = $("community-invite-fine");
    if (fine) fine.textContent = FORK_COPY;
    const privacy = $("community-privacy");
    if (privacy) privacy.textContent = PRIVACY;
    // The weekly card's emblem: the four themes' two-tone swatches.
    const emblem = $("community-invite-swatches");
    const swatches = emblem && catalog()?.themes;
    if (swatches?.length) { emblem.replaceChildren(...swatches.map(swatch)); emblem.hidden = false; }
    on("community-choose", () => chooseTheme());
    on("community-invite-join", () => { hideCard(); void join(); });
    on("community-invite-link", () => { hideCard(); void link(); });
    on("community-invite-copy", () => { void copyAgentPrompt(); });
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
    // The Workspace theme select follows the entitlement: from the boot hint
    // now, then from every change this module (or anything else) announces.
    labelThemeOptions(has("premium"));
    try { window.addEventListener("mefi-community-change", (event) => labelThemeOptions(typeof event?.detail?.premium === "boolean" ? event.detail.premium : has("premium"))); } catch {}
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
    FORK_COPY,
    AGENT_PROMPT,
    init,
    startup,
    has,
    status: () => last,
    refresh,
    offer,
    open,
    join,
    link,
    cancelLink,
    check,
    unlink,
    copyAgentPrompt,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
