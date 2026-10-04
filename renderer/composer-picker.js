// @ # / suggestions in a message box (Home's composer; renderer/workspace.js binds
// it). Typing @ offers this project's files, # its tasks and / its skills, in a popup
// that answers the keyboard first (arrows to move, Enter or Tab to pick, Esc to close)
// and stays out of plain typing: an @ inside an email address or a word, a # after a
// letter, a / inside a path or a URL open nothing. What a message points at shows as
// chips under the box.
//
// Files come from the host (project:files: names only, never contents), skills from
// agents:skills, tasks from what the page already holds. The grammar of a mention is
// the one scripts/mentions.cjs reads on the host; tests/composer_picker.test.mjs holds
// the two together. Settings key settings.ui.composerPicker (on unless it says false)
// switches the popup and the chips off, and the host then ignores mentions too.
(() => {
  "use strict";
  const PICK_MAX = 8;
  const DEBOUNCE_MS = 90;
  const SKILLS_FRESH_MS = 8000;
  const bindings = new WeakMap();

  // ---- the grammar (pure) ---------------------------------------------------------

  /** The @, # or / the caret is in, when it starts a word: { trigger, query, start, end }, or null. */
  function detectTrigger(value, caret) {
    const text = String(value ?? "");
    const at = Number.isInteger(caret) ? Math.max(0, Math.min(caret, text.length)) : text.length;
    const match = /(^|\s)([@#/])([^\s]*)$/.exec(text.slice(0, at));
    if (!match) return null;
    const trigger = match[2], query = match[3];
    if (query.length > 80) return null;
    // A skill's name is letters, digits and dashes: a / followed by anything else is a path or an address.
    if (trigger === "/" && !/^[a-z0-9-]*$/i.test(query)) return null;
    return { trigger, query, start: at - query.length - 1, end: at };
  }

  /**
   * How well `query` matches `text`: null for no match, higher is better. A substring beats a scattering;
   * earlier and shorter win. Letters that only appear in order somewhere in the text count when `scatter` is on.
   */
  function fuzzy(query, text, { scatter = false } = {}) {
    const q = String(query ?? "").toLowerCase(), t = String(text ?? "").toLowerCase();
    if (!q) return 1;
    const at = t.indexOf(q);
    if (at >= 0) return 1000 - at + (at === 0 ? 200 : 0) - t.length / 100;
    if (!scatter) return null;
    let last = -1, gaps = 0;
    for (const ch of q) {
      const next = t.indexOf(ch, last + 1);
      if (next < 0) return null;
      if (last >= 0) gaps += next - last - 1;
      last = next;
    }
    return 500 - gaps - t.length / 100;
  }

  /** The best `limit` items for `query`, matched on `item.label` (a leading / or # is not part of the name). */
  function rank(items, query, limit = PICK_MAX, options = {}) {
    const scored = [];
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const score = fuzzy(String(query ?? "").replace(/^"/, ""), String(item.label ?? "").replace(/^[/#]/, ""), options);
      if (score !== null) scored.push({ item, score, index });
    });
    return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map((entry) => entry.item);
  }

  // A path with a space, or a bare name with no . or / in it (Makefile, LICENSE), is quoted: a bare @word is only a file when it looks like a path.
  const fileText = (path) => (/\s/.test(path) || !/[/.\\]/.test(path) ? `@"${path}"` : `@${path}`);
  const taskText = (title) => `#"${String(title ?? "").replace(/["\n\r]+/g, "'").trim().slice(0, 120)}"`;
  const skillText = (name) => `/${name}`;

  /** The text with the pick put in place of what was typed, and where the caret goes. */
  function insertMention(value, pick, insert) {
    const text = String(value ?? "");
    const spaced = text[pick.end] === " " ? "" : " ";
    return { value: `${text.slice(0, pick.start)}${insert}${spaced}${text.slice(pick.end)}`, caret: pick.start + insert.length + 1 };
  }

  /**
   * What a message points at, in order: a file (@path or @"a path with spaces", only when it looks like a path),
   * a task (#"its title") and a skill (/name, only one of `skills`). The same reading as scripts/mentions.cjs.
   */
  function parseMentions(text, { skills = [] } = {}) {
    const source = String(text ?? "");
    const found = [];
    for (const match of source.matchAll(/(^|\s)@(?:"([^"\n]{1,300})"|([^\s"]{1,300}))/g)) {
      const path = (match[2] ?? match[3] ?? "").replace(/[.,;:!?)\]}'"]+$/, "");
      if (path && (match[2] !== undefined || /[/.\\]/.test(path))) found.push({ at: match.index + match[1].length, kind: "file", text: path });
    }
    for (const match of source.matchAll(/(^|\s)#"([^"\n]{1,200})"/g)) found.push({ at: match.index + match[1].length, kind: "task", text: match[2] });
    const known = new Set(skills);
    for (const match of source.matchAll(/(^|\s)\/([a-z0-9][a-z0-9-]{0,63})(?=$|[\s.,;:!?)\]}])/g)) if (known.has(match[2])) found.push({ at: match.index + match[1].length, kind: "skill", text: match[2] });
    const seen = new Set();
    return found.sort((a, b) => a.at - b.at).filter((row) => { const key = `${row.kind}:${row.text}`; if (seen.has(key)) return false; seen.add(key); return true; }).map(({ kind, text: label }) => ({ kind, text: label }));
  }

  // ---- one box ------------------------------------------------------------------------

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const api = () => window.mefiStudio;
  const TITLES = { "@": "Project files", "#": "Tasks", "/": "Skills" };
  const IDS = { "@": "composer-picker-files", "#": "composer-picker-tasks", "/": "composer-picker-skills" };

  /**
   * Bind a message box. `options`:
   *   scope()    a value that changes when the box's project does (the skills list is read again then)
   *   blocked()  true while the box can not take input
   *   tasks()    the page's tasks ({ id, title, status }) for #
   *   mode()     "chat" or "task": what the message becomes, for what a chip says will happen to it
   *   on         false to start with the popup and chips off (setPicker switches them later)
   * Returns { refresh, setPicker, close, isOpen }.
   */
  function bind(input, options = {}) {
    if (!input) return null;
    if (bindings.has(input)) return bindings.get(input);
    const state = { on: options.on !== false, scope: options.scope?.() };
    const blocked = () => input.disabled || input.readOnly || options.blocked?.() === true;

    const chips = el("div", "composer-mentions");
    chips.hidden = true;
    if (typeof input.insertAdjacentElement === "function") input.insertAdjacentElement("afterend", chips);
    else if (input.parentNode?.insertBefore) input.parentNode.insertBefore(chips, input.nextSibling ?? null);

    const pick = { open: false, trigger: "", query: "", items: [], index: 0, request: 0, timer: null, pending: 0 };
    const popup = el("div", "composer-picker");
    popup.setAttribute("role", "listbox");
    popup.hidden = true;
    if (state.on) input.setAttribute?.("aria-autocomplete", "list");

    const skills = { at: 0, list: null, pending: null };
    const listSkills = async () => {
      if (skills.list && Date.now() - skills.at < SKILLS_FRESH_MS) return skills.list;
      if (!api()?.agentsSkills) return [];
      skills.pending ??= Promise.resolve(api().agentsSkills())
        .then((result) => { skills.list = Array.isArray(result?.skills) ? result.skills : []; skills.at = Date.now(); return skills.list; })
        .catch(() => skills.list ?? [])
        .finally(() => { skills.pending = null; });
      return skills.pending;
    };

    function place() {
      // Outside the composer, whose frosted, clipped box would cut a popup off: fixed to the page, above the box.
      const box = input.getBoundingClientRect?.();
      if (!box || !popup.style) return;
      popup.style.left = `${Math.max(8, Math.round(box.left))}px`;
      popup.style.width = `${Math.max(240, Math.min(480, Math.round(box.width)))}px`;
      popup.style.bottom = `${Math.max(8, Math.round((window.innerHeight || 800) - box.top + 6))}px`;
    }
    function draw() {
      popup.replaceChildren();
      if (!pick.open || !pick.items.length) { popup.hidden = true; input.removeAttribute?.("aria-activedescendant"); input.removeAttribute?.("aria-controls"); return; }
      popup.setAttribute("aria-label", TITLES[pick.trigger] || "Suggestions");
      popup.id = IDS[pick.trigger] || "composer-picker";
      popup.append(el("div", "composer-picker-head", `${TITLES[pick.trigger]} — keep typing to filter`));
      pick.items.forEach((item, index) => {
        const option = el("button", `composer-picker-item${index === pick.index ? " current" : ""}`);
        option.type = "button"; option.id = `composer-pick-${index}`;
        option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(index === pick.index));
        option.dataset.index = String(index);
        option.append(el("b", "", item.label), ...(item.meta ? [el("small", "", item.meta)] : []));
        // Pressing must not move focus out of the box, or the caret and the typing are lost.
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => choose(index));
        popup.append(option);
      });
      const foot = el("div", "composer-picker-foot");
      foot.append(el("span", "", "↑ ↓ move"), el("span", "", "Enter or Tab insert"), el("span", "", "Esc close"));
      popup.append(foot);
      popup.hidden = false;
      input.setAttribute?.("aria-controls", popup.id);
      input.setAttribute?.("aria-activedescendant", `composer-pick-${pick.index}`);
      place();
      // Arrowing past the end of a long list keeps the chosen row in view.
      popup.querySelector?.(".composer-picker-item.current")?.scrollIntoView?.({ block: "nearest" });
    }
    function close() {
      if (pick.timer) { clearTimeout(pick.timer); pick.timer = null; }
      pick.request += 1; pick.pending = 0; pick.open = false; pick.items = []; pick.index = 0;
      draw();
    }
    async function refill() {
      const found = detectTrigger(input.value, input.selectionStart);
      // A selection is not a word being typed.
      const selecting = input.selectionEnd !== undefined && input.selectionStart !== input.selectionEnd;
      if (!found || !state.on || blocked() || selecting) { if (pick.open) close(); return; }
      const request = ++pick.request;
      pick.pending = request;
      const changed = found.trigger !== pick.trigger;
      pick.trigger = found.trigger; pick.query = found.query;
      let items = [];
      try {
        if (found.trigger === "@") {
          const result = await api()?.projectFiles?.({ query: found.query.replace(/^"/, ""), limit: PICK_MAX });
          items = (Array.isArray(result?.files) ? result.files : []).filter((file) => file && typeof file.path === "string" && file.path).slice(0, PICK_MAX)
            .map((file) => ({ label: file.name || file.path.split("/").pop(), meta: file.dir ?? file.path.split("/").slice(0, -1).join("/"), insert: fileText(file.path) }));
        } else if (found.trigger === "#") {
          const all = (options.tasks?.() || []).filter((task) => task && typeof task.title === "string" && task.title.trim())
            .map((task) => ({ label: task.title, meta: task.status ? String(task.status).replace(/_/g, " ") : "", insert: taskText(task.title) }));
          items = rank(all, found.query);
        } else {
          const all = (await listSkills()).map((skill) => ({ label: `/${skill.name}`, meta: skill.description || "", insert: skillText(skill.name) }));
          items = rank(all, found.query);
        }
      } catch { items = []; }
      // A newer keystroke or a closed popup wins over this answer.
      if (request !== pick.request) return;
      pick.pending = 0;
      pick.open = items.length > 0;
      pick.items = items;
      if (changed || pick.index >= items.length) pick.index = 0;
      draw();
    }
    function refillSoon() {
      if (pick.timer) clearTimeout(pick.timer);
      const found = detectTrigger(input.value, input.selectionStart);
      if (!found) { pick.timer = null; if (pick.open) close(); return; }
      // Tasks and skills are local and answer at once; files ask the host, a few keystrokes at a time.
      if (found.trigger !== "@") { pick.timer = null; void refill(); return; }
      pick.timer = setTimeout(() => { pick.timer = null; void refill(); }, DEBOUNCE_MS);
    }
    function choose(index) {
      const item = pick.items[index];
      // Where the word is NOW: a key typed since the list was drawn moved it.
      const now = detectTrigger(input.value, input.selectionStart);
      if (!item || !now || now.trigger !== pick.trigger) { close(); return; }
      const done = insertMention(input.value, now, item.insert);
      input.value = done.value;
      input.setSelectionRange?.(done.caret, done.caret);
      close();
      input.focus?.();
      input.dispatchEvent?.(new Event("input", { bubbles: true }));
      showChips();
    }
    input.addEventListener("keydown", (event) => {
      // Esc while a question is still out calls it back (the key itself is not taken: nothing is showing).
      if (event.key === "Escape" && pick.pending && !pick.open) { close(); return; }
      if (!pick.open || !pick.items.length || event.isComposing) return;
      const n = pick.items.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); event.stopImmediatePropagation?.();
        pick.index = (pick.index + (event.key === "ArrowDown" ? 1 : n - 1)) % n;
        draw();
      } else if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault(); event.stopImmediatePropagation?.();
        choose(pick.index);
      } else if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
        close();
      }
    }, true);
    input.addEventListener("input", () => { refillSoon(); showChips(); });
    input.addEventListener("click", refillSoon);
    input.addEventListener("keyup", (event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) refillSoon(); });
    input.addEventListener("blur", () => setTimeout(() => { if (pick.open && !popup.contains?.(document.activeElement)) close(); }, 160));
    if (typeof document !== "undefined" && document.body?.append) document.body.append(popup);
    window.addEventListener?.("resize", () => { if (pick.open) place(); });

    // ---- what the message points at
    let shown = "";
    const TITLES_BY_MODE = {
      chat: { file: "A project file Studio names to the model; its contents are not sent unless the model may read files.", task: "A task Studio names to the model.", skill: "This skill's instructions are sent with your message." },
      task: { file: "Written into the task as you typed it, so a builder can open it.", task: "Written into the task as you typed it.", skill: "Written into the task as you typed it. A skill's instructions are added to chat messages only." },
    };
    function showChips() {
      const list = state.on ? parseMentions(input.value, { skills: (skills.list || []).map((skill) => skill.name) }) : [];
      const mode = options.mode?.() === "task" ? "task" : "chat";
      const signature = JSON.stringify([mode, list]);
      if (signature === shown) return;
      shown = signature;
      chips.replaceChildren();
      chips.hidden = !list.length;
      if (!list.length) return;
      chips.append(el("span", "composer-mentions-label", "Sent with this message"));
      for (const mention of list.slice(0, 12)) {
        const chip = el("span", `composer-mention ${mention.kind}`, mention.kind === "skill" ? `/${mention.text}` : mention.kind === "task" ? `#${mention.text}` : `@${mention.text}`);
        chip.title = TITLES_BY_MODE[mode][mention.kind];
        chips.append(chip);
      }
    }
    const warm = () => { if (state.on) void listSkills().then(showChips); };
    warm();

    const controller = {
      /** After the box's project changed: the skills list is read again, and an open popup is closed. */
      refresh: () => {
        const now = options.scope?.();
        if (now !== state.scope) { state.scope = now; close(); skills.list = null; skills.at = 0; shown = ""; warm(); }
        showChips();
      },
      /** Switch the popup and the chips on or off (the settings key composerPicker). */
      setPicker: (on) => {
        state.on = on !== false;
        if (state.on) input.setAttribute?.("aria-autocomplete", "list"); else { close(); input.removeAttribute?.("aria-autocomplete"); }
        shown = ""; showChips(); warm();
      },
      close,
      isOpen: () => pick.open,
    };
    bindings.set(input, controller);
    return controller;
  }

  // The settings key behind the switch: settings.ui.composerPicker, on unless it says false.
  const pickerPreference = (prefs) => prefs?.composerPicker !== false;

  window.MefiComposerPicker = { bind, get: (input) => bindings.get(input) ?? null, pickerPreference, detectTrigger, fuzzy, rank, insertMention, parseMentions, fileText, taskText, skillText, PICK_MAX };
})();
