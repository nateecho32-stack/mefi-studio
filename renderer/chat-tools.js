// The chat's skills and tools, at the message box (Vibe's box and Build's Today box). One chip says how Mefi
// answers, and opens:
//  - How Mefi answers: an answer style (Explain like I'm 5, Short answers, Teach me, Brainstorm, Poke holes,
//    Expert) or plain answers. The styles come with Studio (scripts/builtin-skills.cjs); ELI5 is the chat's
//    own until another is picked. A style changes how the chat says things, never what it does.
//  - Skills: whether the chat may load one of the project's skills by itself when a question fits it (the
//    use_skill tool), and how many it can choose from. A /name in the message uses any skill once.
//  - Tools: what the chat can reach (web search, reading web pages you link, project files) and the
//    connectors (Team › Connectors), each switched on or off for the chat here.
// The host owns every choice (main.cjs "Skills and connectors everywhere": chat:tools, skills:set-use,
// connectors:update); this module shows them and sends the owner's.
//
// used(message) draws the chips under a reply: the skills and tools that reply used (main.cjs chatUsed), for
// Vibe's conversation, Home's thread and a task session's.
(function () {
  "use strict";
  const api = () => window.mefiStudio;
  const SVG = "http://www.w3.org/2000/svg";
  const mounts = new Map();
  let current = null, flight = null, epoch = 0, sending = false;
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = String(text); return node; };
  const button = (text, action, cls = "") => { const node = el("button", cls, text); node.type = "button"; node.addEventListener("click", action); return node; };
  const glyph = (id) => {
    if (typeof document.createElementNS !== "function") return el("span", "glyph");
    const svg = document.createElementNS(SVG, "svg"); svg.setAttribute("class", "glyph"); svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG, "use"); use.setAttribute("href", `#${id}`); svg.append(use);
    return svg;
  };
  const plain = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : String(error?.message || fallback));
  const toast = (text, tone = "good") => window.MefiToast?.(text, tone);
  const styleOf = (name) => current?.styles?.find((style) => style.name === name) ?? null;
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  /** The chip's words: the style in force ("ELI5"), "Plain answers", or "Answer style" before the host answered. */
  function label() {
    if (!current) return "Answer style";
    const on = Array.isArray(current.style) ? current.style : [];
    return on.length ? on.map((name) => styleOf(name)?.short || styleOf(name)?.title || name).join(" + ") : "Plain answers";
  }
  function about() {
    if (!current) return "How Mefi answers, and the skills and tools the chat can use";
    const on = (current.style || []).map((name) => styleOf(name)?.title || name);
    return `${on.length ? `Mefi answers: ${on.join(" + ")}` : "Mefi gives plain answers"}. Skills and tools the chat can use.`;
  }

  async function refresh() {
    if (!api()?.chatTools) { paintAll(); return null; }
    if (flight) return flight;
    const mine = epoch;
    flight = (async () => {
      try {
        const result = await api().chatTools();
        if (mine === epoch && result?.ok) { current = result; window.dispatchEvent?.(new CustomEvent("mefi:chat-tools-changed", { detail: { style: current.style } })); }
      } catch { /* the chip keeps what it showed */ }
      paintAll();
      return current;
    })().finally(() => { flight = null; });
    return flight;
  }
  // One choice sent to the host; the chip and its menu repaint from what the host then says.
  async function change(call, done) {
    if (sending) return;
    sending = true;
    for (const root of mounts.keys()) root.setAttribute("aria-busy", "true");
    const mine = epoch;
    try {
      const result = await call();
      if (result?.ok === false) throw new Error(result.error || "That could not be saved.");
      await refresh();
      if (mine === epoch && done) toast(done(result));
    } catch (error) {
      toast(plain(error, "That could not be saved."), "bad");
    } finally {
      sending = false;
      for (const root of mounts.keys()) root.removeAttribute("aria-busy");
      paintAll();
    }
  }
  const setStyle = (name) => change(() => api().skillsSetUse({ style: name }), () => (name ? `Mefi now answers: ${styleOf(name)?.title || name}.` : "Mefi now gives plain answers."));
  const setAuto = (on) => change(() => api().skillsSetUse({ place: "chat", auto: on }), () => (on ? "The chat picks your skills by itself when they fit." : "The chat uses a skill only when you call it with /name."));
  const setConnector = (row, on) => change(() => api().connectorsUpdate({ id: row.id, places: on ? [...new Set([...(row.places || []), "chat"])] : (row.places || []).filter((place) => place !== "chat") }), () => `${row.title} is ${on ? "on" : "off"} for the chat.`);

  function closeAll(except = null) {
    for (const root of mounts.keys()) {
      if (root === except) continue;
      const menu = root.querySelector?.(".chat-tools-popover");
      if (menu && !menu.hidden) { menu.hidden = true; root.querySelector(".chat-tools-chip")?.setAttribute("aria-expanded", "false"); }
    }
  }
  function toggle(root) {
    const menu = root.querySelector(".chat-tools-popover"), chip = root.querySelector(".chat-tools-chip");
    if (!menu || !chip) return;
    const open = menu.hidden;
    closeAll(root);
    menu.hidden = !open;
    chip.setAttribute("aria-expanded", String(open));
    if (open) { void refresh(); menu.querySelector('[aria-checked="true"], button, input')?.focus?.(); }
  }
  function sw(checked, title, action, { disabled = false } = {}) {
    const input = el("input", "chat-tools-switch"); input.type = "checkbox"; input.checked = checked; input.disabled = disabled;
    input.setAttribute("role", "switch"); input.setAttribute("aria-label", title);
    input.addEventListener("change", () => action(input.checked));
    return input;
  }
  function menuParts(root) {
    const menu = el("div", "chat-tools-popover"); menu.hidden = true;
    menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", "How Mefi answers, skills and tools");
    // How Mefi answers.
    const styles = el("section", "chat-tools-section");
    styles.append(el("h3", "chat-tools-h", "How Mefi answers"));
    const group = el("div", "chat-tools-styles"); group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", "Answer style");
    const on = new Set(current?.style || []);
    const options = [{ name: null, title: "Plain answers", description: "Mefi's usual voice: the answer first, then the next step." }, ...(current?.styles || [])];
    for (const style of options) {
      const checked = style.name ? on.has(style.name) : on.size === 0;
      const pick = button("", () => { if (!checked) void setStyle(style.name); }, "chat-tools-style");
      pick.setAttribute("role", "radio"); pick.setAttribute("aria-checked", String(checked)); pick.dataset.style = style.name || "plain";
      pick.append(el("strong", "", style.title), el("small", "", style.description));
      group.append(pick);
    }
    styles.append(group);
    // Skills.
    const skills = el("section", "chat-tools-section");
    skills.append(el("h3", "chat-tools-h", "Skills"));
    const autoRow = el("label", "chat-tools-row");
    const picks = Array.isArray(current?.picks) ? current.picks : [];
    const words = el("span", "chat-tools-words");
    words.append(el("strong", "", "Use my skills when they fit"), el("small", "", picks.length ? `It can pick from ${plural(picks.length, "skill")}: ${picks.slice(0, 4).map((pick) => pick.name).join(", ")}${picks.length > 4 ? "…" : ""}.` : current?.auto === false ? "Off: a skill is used only when you call it." : "This project has no skills it can pick yet."));
    autoRow.append(words, sw(current?.auto !== false, "Use my skills when they fit", (value) => void setAuto(value), { disabled: !current }));
    skills.append(autoRow, el("p", "chat-tools-hint", "Type / in the box to use any skill for one message."));
    // Tools.
    const tools = el("section", "chat-tools-section");
    tools.append(el("h3", "chat-tools-h", "Tools"));
    const own = current?.tools || {};
    const builtIn = el("ul", "chat-tools-list");
    for (const [key, text] of [["webSearch", "Search the web"], ["webRead", "Read web pages you link"], ["projectRead", "Read project files"]]) {
      const item = el("li", `chat-tools-tool${own[key] ? " is-on" : ""}`, `${text}: ${own[key] ? "on" : "off"}`);
      builtIn.append(item);
    }
    tools.append(builtIn);
    const connectors = Array.isArray(current?.connectors) ? current.connectors : [];
    for (const row of connectors) {
      const line = el("label", "chat-tools-row");
      const ready = row.status === "ready";
      const what = el("span", "chat-tools-words");
      what.append(el("strong", "", row.title), el("small", "", ready ? `${plural(row.tools, "tool")}${row.tools ? "" : ": test it in Connectors to find them"}` : row.status === "off" ? "Switched off in Connectors" : "Waiting for your approval in Connectors"));
      // One that waits for approval is approved in Connectors first; switching it on here would promise a tool it can't give.
      line.append(what, sw(row.on, `Let the chat use ${row.title}`, (value) => void setConnector(row, value), { disabled: !current?.editable || sending || !ready && row.status !== "off" }));
      tools.append(line);
    }
    if (!connectors.length) tools.append(el("p", "chat-tools-hint", "Connectors add tools like a browser or GitHub. None yet."));
    const links = el("div", "chat-tools-links");
    links.append(
      button("Manage skills", () => { closeAll(); window.MefiNav?.go?.("skills"); }, "chat-tools-link"),
      button("Connectors", () => { closeAll(); window.MefiNav?.go?.("agents", { place: "connectors" }); }, "chat-tools-link"),
      button("Chat's tools in Team", () => { closeAll(); window.MefiNav?.go?.("agents", { place: "seats" }); }, "chat-tools-link"),
    );
    menu.append(styles, skills, tools, links);
    menu.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      menu.hidden = true; root.querySelector(".chat-tools-chip")?.setAttribute("aria-expanded", "false"); root.querySelector(".chat-tools-chip")?.focus?.();
    });
    return menu;
  }
  function paint(root, options = {}) {
    const before = root.querySelector?.(".chat-tools-popover");
    const wasOpen = Boolean(before && !before.hidden);
    const focused = root.contains?.(document.activeElement) ? document.activeElement?.dataset?.style ?? (document.activeElement?.classList?.contains?.("chat-tools-chip") ? "chip" : null) : null;
    root.replaceChildren();
    root.classList.add("chat-tools");
    const chip = button("", () => toggle(root), "chat-tools-chip");
    if (options.id) chip.id = options.id;
    chip.setAttribute("aria-haspopup", "dialog"); chip.setAttribute("aria-expanded", "false");
    chip.title = about();
    chip.append(glyph("g-spark"), el("span", "chat-tools-label", label()));
    const menu = menuParts(root);
    if (wasOpen) { menu.hidden = false; chip.setAttribute("aria-expanded", "true"); }
    root.append(chip, menu);
    if (focused === "chip") chip.focus?.({ preventScroll: true });
    else if (focused) root.querySelector(`[data-style="${focused}"]`)?.focus?.({ preventScroll: true });
  }
  function paintAll() {
    for (const [root, options] of mounts) { if (root.isConnected === false) mounts.delete(root); else paint(root, options); }
  }
  /** Put the chip in `root` (a span in a message box's row of controls). `options.id` names the chip. */
  function mount(root, options = {}) {
    if (!root) return;
    mounts.set(root, options);
    paint(root, options);
    if (!current) void refresh();
  }

  /** The chips under a reply: what it used. Null when it used nothing (or it is not a reply). */
  function used(message) {
    const list = message?.role === "assistant" && Array.isArray(message.used) ? message.used : [];
    if (!list.length) return null;
    const row = el("div", "chat-used");
    row.setAttribute("aria-label", "What this answer used");
    for (const item of list.slice(0, 8)) {
      if (!item?.label) continue;
      const chip = el("span", `chat-used-chip is-${item.kind === "skill" ? "skill" : "tool"}${item.ok === false ? " is-failed" : ""}`);
      const icon = item.kind === "skill" ? "g-skills" : String(item.name ?? "").startsWith("mcp__") ? "g-plug" : "g-search";
      chip.append(glyph(icon), el("span", "", `${item.label}${item.count > 1 ? ` ×${item.count}` : ""}`));
      chip.title = item.kind === "skill"
        ? (item.loaded ? `Mefi loaded the skill ${item.name} for this answer` : `On for the chat: ${item.name}`)
        : item.ok === false ? `${item.label}: it did not work` : item.label;
      row.append(chip);
    }
    return row.childNodes.length ? row : null;
  }

  // A click anywhere else closes an open menu, like every other menu.
  document.addEventListener?.("pointerdown", (event) => {
    for (const root of mounts.keys()) if (!root.contains?.(event.target)) {
      const menu = root.querySelector?.(".chat-tools-popover");
      if (menu && !menu.hidden) { menu.hidden = true; root.querySelector(".chat-tools-chip")?.setAttribute("aria-expanded", "false"); }
    }
  }, true);
  window.addEventListener?.("mefi:project-changed", () => { epoch++; current = null; void refresh(); });
  api()?.onSettingsChanged?.((data) => { if (data?.skills || data?.connectors || data?.agents) void refresh(); });

  window.MefiChatTools = { mount, refresh, used, label, state: () => current };
  window.MefiNav?.register?.({ id: "chat-style", kind: "action", section: "agents", group: "tools", label: "How Mefi answers", desc: "Explain like I'm 5, short answers, teach me, brainstorm, poke holes or expert", searchTerms: "eli5 explain like i'm five answer style tone chat skills simple plain short teach brainstorm critic expert", paletteGroup: "Chat", showIn: { palette: true }, run: () => { const root = [...mounts.keys()].find((node) => node.isConnected !== false && node.offsetParent !== null) ?? [...mounts.keys()][0]; if (root) toggle(root); else window.MefiNav?.go?.("skills"); } });
})();
