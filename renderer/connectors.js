// Team › Connectors: the MCP servers that give agents extra tools, like a browser or GitHub
// (docs/agent-tools.md "Connectors"). agents.js gives this module the place's pane; everything here is
// the host's (main.cjs "Skills and connectors everywhere", scripts/connectors.cjs):
//  - Your connectors: each one's state (needs approval, changed, off, ready), what it runs, its tools
//    (each can be turned off), where it is used (the chat, Studio's helper agents, the builders), the
//    settings it needs and whether a value is saved, Test, Remove and a switch.
//  - Add a connector: a name and the command (or an https:// address), the settings it needs with their
//    values (kept encrypted by Studio, never shown again), then the exact command to approve.
//  - Import from other apps: what Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Codex, OpenCode,
//    Gemini CLI and this project's own files already use. Nothing loads by itself: picked ones arrive
//    waiting for approval, and their saved values come along only when asked.
//  - Featured: a few well-known ones, each one command to read before it is approved.
//  - How many connector tools each kind of agent gets (sixteen at most) and Studio's own tools.
// Studio never starts a connector the owner has not approved, and a changed command waits again.
(function () {
  "use strict";
  const api = () => window.mefiStudio;
  const PLACES = [["chat", "Chat"], ["agents", "Agents"], ["builders", "Builders"]];
  const PLACE_ABOUT = { chat: "the conversation", agents: "planning, reviews and the desk", builders: "Claude Code, Codex and OpenCode" };
  const STATUS = { ready: ["Ready", "good"], "needs-approval": ["Needs your approval", "ask"], changed: ["Changed: approve again", "ask"], off: ["Off", "quiet"] };
  const LIMIT = 16;
  const state = { root: null, list: null, error: "", note: "", tone: "", busy: new Set(), adding: null, approving: null, importing: null, tests: {}, reading: null };
  const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = String(text); return node; };
  const button = (text, action, cls = "ghost") => { const node = el("button", cls, text); node.type = "button"; node.addEventListener("click", action); return node; };
  const plain = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : String(error?.message || fallback));
  const toast = (text, tone = "good") => window.MefiToast?.(text, tone);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  // An "i" circle where Studio has them (MefiUi.info), a tooltip where it does not yet.
  const info = (node, text) => { const circle = window.MefiUi?.info?.(text, { label: "About this" }); if (circle && typeof circle === "object" && "nodeType" in circle) node.append(circle); else node.title = text; return node; };
  const ago = (at) => { const minutes = Math.round((Date.now() - at) / 60000); return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`; };

  async function read() {
    if (!api()?.connectorsList) { state.error = "Connectors are set up in the desktop app."; paint(); return; }
    if (state.reading) return state.reading;
    state.reading = (async () => {
      try {
        const result = await api().connectorsList();
        if (result?.ok) { state.list = { ...result, servers: Array.isArray(result.servers) ? result.servers : [], featured: Array.isArray(result.featured) ? result.featured : [] }; state.error = ""; } else state.error = plain(result?.error, "The connectors could not be read.");
      } catch (error) { state.error = plain(error, "The connectors could not be read."); }
    })().finally(() => { state.reading = null; paint(); });
    return state.reading;
  }
  // One host call; the page repaints from what comes back, and says what happened.
  async function act(key, call, done, { quiet = false } = {}) {
    if (state.busy.has(key)) return null;
    state.busy.add(key); paint();
    try {
      const result = await call();
      if (result?.ok === false) throw new Error(result.error || "That could not be done.");
      if (done) { state.note = typeof done === "function" ? done(result) : done; state.tone = "good"; if (!quiet) toast(state.note); }
      return result;
    } catch (error) {
      state.note = plain(error, "That could not be done."); state.tone = "bad";
      if (!quiet) toast(state.note, "bad");
      return null;
    } finally {
      state.busy.delete(key);
      await read();
    }
  }
  const editable = () => state.list && !state.list.off;

  // ---- the pieces --------------------------------------------------------------------------------------------
  function card(title, detail, id) {
    const box = el("section", "agents-card connectors-card");
    if (id) box.id = id;
    const head = el("h3", "", title);
    box.append(head);
    if (detail) box.append(el("p", "muted", detail));
    return box;
  }
  function chip(text, tone = "") { const node = el("span", "connectors-chip", text); if (tone) node.dataset.tone = tone; return node; }
  function cmdbox(text) { const box = el("pre", "connectors-cmd"); box.textContent = text; return box; }
  function placeSwitches(row, { onChange } = {}) {
    const group = el("div", "connectors-places"); group.setAttribute("role", "group"); group.setAttribute("aria-label", `Where ${row.title} is used`);
    for (const [place, label] of PLACES) {
      const on = (row.places || []).includes(place);
      const pick = button(label, () => onChange?.(place, !on), "connectors-place");
      pick.setAttribute("aria-pressed", String(on)); pick.dataset.place = place;
      pick.title = `${on ? "Used" : "Not used"} by ${PLACE_ABOUT[place]}`;
      pick.disabled = !editable() || state.busy.has(row.id);
      group.append(pick);
    }
    return group;
  }
  function counts() {
    const used = { chat: 0, agents: 0, builders: 0 };
    for (const row of state.list?.servers || []) {
      if (row.status !== "ready") continue;
      const tools = row.tools.filter((tool) => !tool.off).length;
      for (const place of row.places || []) if (used[place] !== undefined) used[place] += tools;
    }
    return used;
  }

  function addPanel() {
    const draft = state.adding;
    if (!draft) return null;
    const panel = card("Add a connector", "A connector is a program on this PC (or an https:// address). Studio shows you exactly what it runs before it ever starts.", "connectors-add");
    const grid = el("div", "connectors-form");
    const field = (label, input, hint) => { const wrap = el("label", "connectors-field"); wrap.append(el("span", "connectors-label", label), input); if (hint) wrap.append(el("small", "muted", hint)); return wrap; };
    const name = el("input"); name.id = "connectors-add-name"; name.value = draft.name; name.placeholder = "github"; name.autocomplete = "off"; name.spellcheck = false;
    name.addEventListener("input", () => { draft.name = name.value; });
    const line = el("input", "connectors-mono"); line.id = "connectors-add-line"; line.value = draft.line; line.placeholder = "npx -y @playwright/mcp@latest   or   https://example.com/mcp"; line.autocomplete = "off"; line.spellcheck = false;
    line.addEventListener("input", () => { draft.line = line.value; });
    const keys = el("input", "connectors-mono"); keys.id = "connectors-add-keys"; keys.value = draft.keys; keys.placeholder = "GITHUB_PERSONAL_ACCESS_TOKEN"; keys.autocomplete = "off"; keys.spellcheck = false;
    keys.addEventListener("input", () => { draft.keys = keys.value; paintValues(); });
    const values = el("div", "connectors-values"); values.id = "connectors-add-values";
    function paintValues() {
      values.replaceChildren();
      for (const key of draft.keys.split(/[\s,]+/).filter(Boolean).slice(0, 8)) {
        const input = el("input", "connectors-mono"); input.type = "password"; input.autocomplete = "off"; input.placeholder = "Leave empty to use Windows' own setting";
        input.value = draft.values[key] ?? ""; input.setAttribute("aria-label", `Value for ${key}`);
        input.addEventListener("input", () => { draft.values[key] = input.value; });
        values.append(field(key, input));
      }
      if (values.childNodes.length) values.prepend(el("small", "muted", state.list?.secretsSafe ? "Values are kept encrypted by Studio on this PC and never shown again." : "This PC can't keep values safely in Studio: set them as Windows environment variables instead."));
    }
    paintValues();
    grid.append(field("Name", name, "Lowercase letters, numbers and dashes."), field("Command or address", line, "The way you would type it. Nothing runs until you approve it."), field("Settings it needs", keys, "Names only, like GITHUB_TOKEN. Leave empty if it needs none."), values);
    const where = el("div", "connectors-field");
    where.append(el("span", "connectors-label", "Who can use it"), placeSwitches({ title: "this connector", places: draft.places, id: "__new" }, { onChange: (place, on) => { draft.places = on ? [...draft.places, place] : draft.places.filter((item) => item !== place); paint(); } }));
    grid.append(where);
    const actions = el("div", "agents-actions");
    const save = button("Add it", () => void submitAdd(), "primary"); save.id = "connectors-add-save"; save.disabled = state.busy.has("add") || !editable();
    actions.append(save, button("Cancel", () => { state.adding = null; paint(); }));
    panel.append(grid, actions);
    return panel;
  }
  async function submitAdd() {
    const draft = state.adding;
    if (!draft) return;
    const line = draft.line.trim();
    const isUrl = /^https?:\/\//i.test(line);
    const envKeys = draft.keys.split(/[\s,]+/).filter(Boolean);
    const valuesGiven = Object.fromEntries(Object.entries(draft.values).filter(([key, value]) => envKeys.includes(key) && value));
    const payload = { name: draft.name.trim(), places: draft.places, ...(isUrl ? { url: line, ...(envKeys.length ? { headerKeys: { Authorization: envKeys[0] } } : {}) } : { line, envKeys }), ...(Object.keys(valuesGiven).length ? { values: valuesGiven } : {}) };
    const result = await act("add", () => api().connectorsAdd(payload), (done) => `${done.server?.title || payload.name} is added. Read its command, then approve it.`);
    if (result?.server) { state.adding = null; state.approving = result.server.id; paint(); }
  }

  function approvePanel() {
    const row = (state.list?.servers || []).find((item) => item.id === state.approving);
    if (!row) return null;
    const panel = card(`Approve ${row.title}`, "Studio never starts a connector you have not approved. Whenever an agent uses it, Studio runs exactly this on your PC:", "connectors-approve");
    panel.classList.add("connectors-approve");
    panel.append(cmdbox(row.line));
    const facts = el("ul", "connectors-facts");
    if (row.envKeys?.length || row.saved?.length) facts.append(el("li", "", `It gets these settings: ${[...new Set([...(row.envKeys || []), ...(row.saved || [])])].join(", ")}.`));
    if (row.standIns?.length) facts.append(el("li", "", `${row.standIns.join(", ")} comes from the GitHub sign-in Studio already has.`));
    if (row.source) facts.append(el("li", "", `From ${row.source}.`));
    facts.append(el("li", "", "If its command ever changes, Studio asks you again."));
    panel.append(facts);
    const actions = el("div", "agents-actions");
    const go = button("Approve and test", () => void approve(row), "primary"); go.id = "connectors-approve-go"; go.disabled = state.busy.has(row.id) || !editable();
    actions.append(go, button("Not now", () => { state.approving = null; paint(); }));
    panel.append(actions);
    return panel;
  }
  async function approve(row) {
    const result = await act(row.id, () => api().connectorsApprove({ id: row.id, fingerprint: row.fingerprint }), `${row.title} is approved.`, { quiet: true });
    if (!result) return;
    state.approving = null;
    await test(row);
  }
  async function test(row) {
    state.tests[row.id] = { run: true }; paint();
    const result = await act(row.id, () => api().connectorsTest(row.id), (done) => `${row.title} started in ${(done.ms / 1000).toFixed(1)} s and has ${plural(done.tools.length, "tool")}.`);
    state.tests[row.id] = result ? { ok: true, ms: result.ms, tools: result.tools, skipped: result.skipped || [] } : { ok: false, error: state.note };
    paint();
  }

  function importPanel() {
    const box = state.importing;
    if (!box) return null;
    const panel = card("Import from other apps", "Studio found these in the settings of other apps on this PC. Nothing loads by itself: pick the ones you want, and each still waits for your approval.", "connectors-import");
    if (box.loading) { panel.append(el("p", "muted", "Looking through other apps' settings…")); return panel; }
    if (box.error) { panel.append(el("p", "connectors-error", box.error)); }
    const list = el("ul", "connectors-import-list"); list.id = "connectors-import-list";
    const rows = box.candidates || [];
    for (const item of rows) {
      const row = el("li", "connectors-import-row"); row.dataset.key = item.key;
      const pick = el("input"); pick.type = "checkbox"; pick.checked = box.picked.has(item.key); pick.disabled = !item.supported || Boolean(item.added);
      pick.setAttribute("aria-label", `Import ${item.name}`);
      pick.addEventListener("change", () => { if (pick.checked) box.picked.add(item.key); else box.picked.delete(item.key); paint(); });
      const words = el("div", "connectors-words");
      words.append(el("strong", "", item.name), el("code", "connectors-mono", item.line), el("small", "muted", `${item.source}${item.alsoIn?.length ? `, also in ${item.alsoIn.length} more` : ""}`));
      if (item.added) words.append(el("small", "muted", `Already added as ${item.added}.`));
      else if (!item.supported) words.append(el("small", "connectors-error", item.why));
      else if (item.envKeys?.length) words.append(el("small", "muted", `Needs ${item.envKeys.join(", ")}${item.hasValues ? " (that app has a value saved)" : ""}.`));
      row.append(pick, words);
      list.append(row);
    }
    if (!rows.length) list.append(el("li", "muted", "No other app on this PC has connectors Studio can read."));
    panel.append(list);
    const any = rows.some((item) => item.hasValues && box.picked.has(item.key));
    const values = el("label", "connectors-row");
    const bring = el("input"); bring.type = "checkbox"; bring.id = "connectors-import-values"; bring.checked = box.values; bring.disabled = !any || !box.secretsSafe;
    bring.addEventListener("change", () => { box.values = bring.checked; });
    values.append(bring, el("span", "", box.secretsSafe ? "Bring their saved values (like a token) too, kept encrypted by Studio" : "This PC can't keep saved values safely, so they stay behind"));
    panel.append(values);
    const actions = el("div", "agents-actions");
    const go = button(box.picked.size ? `Import ${box.picked.size}` : "Import", () => void runImport(), "primary"); go.id = "connectors-import-go"; go.disabled = !box.picked.size || state.busy.has("import") || !editable();
    actions.append(go, button("Close", () => { state.importing = null; paint(); }));
    panel.append(actions);
    return panel;
  }
  async function openImport() {
    state.importing = { loading: true, picked: new Set(), values: false, candidates: [], secretsSafe: false };
    paint();
    try {
      const result = await api().connectorsCandidates();
      if (!state.importing) return;
      if (!result?.ok) throw new Error(result?.error || "Other apps' settings could not be read.");
      Object.assign(state.importing, { loading: false, candidates: result.candidates || [], secretsSafe: result.secretsSafe === true });
    } catch (error) { if (state.importing) Object.assign(state.importing, { loading: false, error: plain(error, "Other apps' settings could not be read.") }); }
    paint();
  }
  async function runImport() {
    const box = state.importing;
    if (!box?.picked.size) return;
    const result = await act("import", () => api().connectorsImport({ keys: [...box.picked], values: box.values }), (done) => `${plural(done.added.length, "connector")} added${done.skipped?.length ? `, ${done.skipped.length} left out` : ""}. Approve each one to use it.`);
    if (result) state.importing = null;
    paint();
  }

  function rowNode(row) {
    const item = el("li", "connectors-row-card"); item.dataset.id = row.id; item.dataset.status = row.status;
    const head = el("div", "connectors-row-head");
    const [statusText, tone] = STATUS[row.status] || [row.status, ""];
    head.append(el("strong", "connectors-title", row.title), chip(statusText, tone));
    if (row.tools.length) head.append(chip(plural(row.tools.filter((tool) => !tool.off).length, "tool")));
    if (row.transport === "http") head.append(chip("Online"));
    if (row.handWritten) head.append(info(chip("Written by hand"), "This one was added to the connectors file by hand, so it is trusted as it is."));
    const on = el("input", "connectors-switch"); on.type = "checkbox"; on.setAttribute("role", "switch"); on.checked = row.enabled; on.setAttribute("aria-label", `Use ${row.title}`);
    on.disabled = !editable() || state.busy.has(row.id) || row.status === "needs-approval";
    on.addEventListener("change", () => void act(row.id, () => api().connectorsUpdate({ id: row.id, enabled: on.checked }), `${row.title} is ${on.checked ? "on" : "off"}.`));
    head.append(on);
    item.append(head);
    if (row.description) item.append(el("p", "muted connectors-about", row.description));
    item.append(el("code", "connectors-mono connectors-line", row.line));
    // What a test found, or is finding.
    const tested = state.tests[row.id];
    if (tested?.run) item.append(el("p", "muted", "Starting it and asking for its tools…"));
    else if (tested && !tested.ok) item.append(el("p", "connectors-error", tested.error));
    else if (row.tested && !row.tested.ok) item.append(el("p", "connectors-error", `Last test ${ago(row.tested.at)}: ${row.tested.error}`));
    else if (row.tested?.ok) item.append(el("p", "muted", `Tested ${ago(row.tested.at)}: started in ${(row.tested.ms / 1000).toFixed(1)} s, ${plural(row.tested.found, "tool")}${row.tested.skipped ? `, ${row.tested.skipped} with names Studio can't use` : ""}.`));
    else if (row.status === "ready" && !row.tools.length) item.append(el("p", "muted", "Test it to find its tools."));
    // Its tools, each one can be turned off.
    if (row.tools.length) {
      const tools = el("div", "connectors-tools"); tools.setAttribute("role", "group"); tools.setAttribute("aria-label", `${row.title}'s tools`);
      for (const tool of row.tools) {
        const pick = button(tool.name, () => {
          const off = new Set(row.tools.filter((entry) => entry.off).map((entry) => entry.name));
          if (off.has(tool.name)) off.delete(tool.name); else off.add(tool.name);
          void act(row.id, () => api().connectorsUpdate({ id: row.id, off: [...off] }), `${tool.name} is ${off.has(tool.name) ? "off" : "on"}.`, { quiet: true });
        }, "connectors-tool");
        pick.setAttribute("aria-pressed", String(!tool.off)); pick.title = tool.description || tool.name; pick.disabled = !editable() || state.busy.has(row.id);
        tools.append(pick);
      }
      item.append(tools);
    }
    // Who can use it.
    const where = el("div", "connectors-where");
    where.append(el("span", "connectors-label", "Who can use it"), placeSwitches(row, { onChange: (place, value) => void act(row.id, () => api().connectorsUpdate({ id: row.id, places: value ? [...(row.places || []), place] : (row.places || []).filter((entry) => entry !== place) }), `${row.title} is ${value ? "on" : "off"} for ${PLACE_ABOUT[place]}.`, { quiet: true }) }));
    item.append(where);
    // The settings it needs.
    const needs = [...new Set([...(row.envKeys || []), ...Object.values(row.headerKeys || {})])];
    if (needs.length) {
      const settings = el("div", "connectors-settings");
      for (const key of needs) {
        const line = el("div", "connectors-setting");
        const saved = row.saved?.includes(key), stand = row.standIns?.includes(key), missing = row.missing?.includes(key);
        line.append(el("code", "connectors-mono", key), chip(saved ? "Saved in Studio" : stand ? "From Studio's GitHub sign-in" : missing ? "No value yet" : "From Windows", missing ? "ask" : ""));
        const value = el("input", "connectors-mono"); value.type = "password"; value.autocomplete = "off"; value.placeholder = saved ? "Replace the saved value" : "Paste a value"; value.setAttribute("aria-label", `Value for ${key}`);
        value.disabled = !editable() || !state.list?.secretsSafe;
        const keep = button("Save", () => { const text = value.value; if (!text) return; void act(row.id, () => api().connectorsSecret({ id: row.id, key, value: text }), `${key} is saved for ${row.title}.`); }, "ghost mini");
        keep.disabled = value.disabled;
        line.append(value, keep);
        if (saved) line.append(button("Forget", () => void act(row.id, () => api().connectorsSecret({ id: row.id, key, value: "" }), `${key} is forgotten.`), "ghost mini"));
        settings.append(line);
      }
      item.append(settings);
    }
    const actions = el("div", "agents-actions");
    if (row.status === "needs-approval" || row.status === "changed") {
      const review = button("Review and approve", () => { state.approving = row.id; paint(); $("connectors-approve")?.scrollIntoView?.({ block: "nearest" }); }, "primary"); review.dataset.action = "approve";
      actions.append(review);
    } else {
      const run = button(row.tools.length ? "Test again" : "Test", () => void test(row)); run.dataset.action = "test"; run.disabled = !editable() || state.busy.has(row.id);
      actions.append(run);
    }
    const removeAction = () => void act(row.id, () => api().connectorsRemove(row.id), `${row.title} is removed. Studio kept a copy of the file.`);
    const remove = window.MefiUi?.arm ? window.MefiUi.arm(button("Remove", () => {}), { run: removeAction, armed: `Remove ${row.title}?` }) : button("Remove", removeAction);
    remove.dataset.action = "remove"; remove.disabled = !editable() || state.busy.has(row.id);
    actions.append(remove);
    item.append(actions);
    return item;
  }

  function budget() {
    const box = el("div", "connectors-budget"); box.id = "connectors-budget";
    const used = counts();
    for (const [place, label] of PLACES) {
      const row = el("div", "connectors-meter"); row.dataset.place = place;
      const bar = el("div", "connectors-bar"); const fill = el("i"); fill.style.width = `${Math.min(100, (used[place] / LIMIT) * 100)}%`; bar.append(fill);
      if (used[place] > LIMIT) row.dataset.tone = "warn";
      row.append(el("span", "connectors-label", `${label} tools`), bar, el("span", "connectors-count", `${used[place]}/${LIMIT}`));
      box.append(row);
    }
    const over = PLACES.filter(([place]) => used[place] > LIMIT).map(([, label]) => label.toLowerCase());
    box.append(el("p", over.length ? "connectors-error" : "muted", over.length ? `Too many tools for ${over.join(" and ")}: an agent gets the first ${LIMIT} and the rest wait. Turn some tools or connectors off.` : `Each agent gets at most ${LIMIT} connector tools. Tools a team picks for one agent count first.`));
    return box;
  }
  function featured() {
    const box = el("div", "connectors-featured"); box.id = "connectors-featured";
    for (const entry of state.list?.featured || []) {
      const tile = el("article", "connectors-feature"); tile.dataset.id = entry.id;
      tile.append(el("strong", "", entry.title), el("p", "muted", entry.description), el("code", "connectors-mono", entry.line), el("small", "muted", `Needs ${entry.needs}.`));
      const add = entry.added ? chip("Added", "good") : button("Add", () => void act(entry.id, () => api().connectorsFeatured(entry.id), (done) => { state.approving = done.server?.id ?? null; return `${entry.title} is added. Read its command, then approve it.`; }));
      if (!entry.added) add.disabled = !editable() || state.busy.has(entry.id);
      tile.append(add);
      box.append(tile);
    }
    return box;
  }
  function ownTools() {
    const list = el("ul", "connectors-own"); list.id = "connectors-own";
    for (const [title, about] of [["Search the web", "Studio's own models can look things up. Builders use the search built into their CLI."], ["Read web pages you link", "Only links from your words or a search, never an address a model makes up."], ["Read, list and search project files", "Files up to 32 KB; keys, databases and other private files are never returned."], ["Load your skills", "Agents load one of your skills when a task fits it (Skills page: how each is used)."], ["Run project checks and read logs", "Builders only: lint, typecheck and the dev server's output. Advice, never a verdict."]]) {
      const item = el("li"); item.append(el("strong", "", title), el("small", "muted", about)); list.append(item);
    }
    list.append(el("li", "muted", "Grok and Antigravity can't receive connectors or Studio's tools; they keep their own."));
    return list;
  }
  const $ = (id) => document.getElementById(id);

  function paint() {
    const root = state.root;
    if (!root) return;
    const scroll = root.scrollTop;
    root.replaceChildren();
    const top = el("div", "connectors-top"); top.id = "connectors-top";
    const words = el("p", state.error ? "connectors-error" : "muted", state.error || (state.list ? `${plural(state.list.servers.length, "connector")} in ${state.list.file}.${state.list.off ? " Changing connectors is switched off on this PC." : ""}` : "Reading your connectors…"));
    words.id = "connectors-summary";
    const buttons = el("div", "agents-actions");
    const importer = button("Import from other apps", () => void openImport()); importer.id = "connectors-import-open"; importer.disabled = !editable();
    const adder = button("Add a connector", () => { state.adding = state.adding ?? { name: "", line: "", keys: "", values: {}, places: ["builders"] }; paint(); $("connectors-add-name")?.focus?.(); }, "primary"); adder.id = "connectors-add-open"; adder.disabled = !editable();
    buttons.append(importer, adder);
    top.append(words, buttons);
    root.append(top);
    if (state.note) { const note = el("p", `connectors-note${state.tone === "bad" ? " connectors-error" : ""}`, state.note); note.id = "connectors-note"; note.setAttribute("role", "status"); root.append(note); }
    for (const panel of [addPanel(), approvePanel(), importPanel()]) if (panel) root.append(panel);
    const yours = card("Your connectors", "Tools from MCP servers. Each is a program on this PC (or an address online), so each needs your approval first.", "connectors-yours");
    const rows = el("ul", "connectors-rows"); rows.id = "connectors-rows";
    for (const row of state.list?.servers || []) rows.append(rowNode(row));
    if (state.list && !state.list.servers.length) rows.append(el("li", "connectors-empty", "No connectors yet. Add one of the featured ones below, or import the ones you already use in another app."));
    if (state.list?.unreadable) rows.append(el("li", "connectors-error", `${plural(state.list.unreadable, "entry")} in the file can't be read as a connector and ${state.list.unreadable === 1 ? "is" : "are"} left as written.`));
    yours.append(rows, budget());
    const feature = card("Featured", "Well-known connectors. Adding one shows its command first; nothing runs until you approve it.", "connectors-featured-card");
    feature.append(featured());
    const own = card("Studio's own tools", "These come with Studio. Each agent's switches are in Seats and models (the + beside it).", "connectors-own-card");
    own.append(ownTools());
    root.append(yours, feature, own);
    root.scrollTop = scroll;
  }

  /** Fill Team's Connectors pane (agents.js buildConnectors) and read the list. */
  function mount(root) {
    if (!root) return;
    state.root = root;
    root.classList.add("connectors-page");
    paint();
    lastAsked = Date.now();
    void read();
  }
  // Team repaints often while a draft changes; the list is read again at most every two seconds from there.
  let lastAsked = 0;
  function refresh({ force = false } = {}) {
    if (!state.root) return null;
    if (!force && Date.now() - lastAsked < 2000) return state.reading;
    lastAsked = Date.now();
    return read();
  }
  window.MefiConnectors = { mount, refresh, state: () => state.list };
  api()?.onSettingsChanged?.((data) => { if (data?.connectors && state.root?.isConnected !== false && !state.busy.size) void read(); });
})();
