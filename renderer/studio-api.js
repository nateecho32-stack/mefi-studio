// Other apps: Settings › Other apps (docs/studio-api.md).
//
// Two things live on this card. "Get help setting up" copies a prompt for
// Claude Code, Codex or another AI helper that says where Studio is on this PC
// and what to read; it needs nothing switched on, and the setup helper offers
// the same copy (MefiStudioApi.copyPrompt). "Let apps reach Studio" is the
// Studio API's switch: on, Claude Code, Codex, Cursor or the owner's scripts
// can see what Studio is doing, message Mefi and hand it tasks (which wait for
// the owner's OK). The card shows the commands that connect each app, saves the
// Claude Code skill, makes a new key and lists the last calls apps made. Notes
// an app sends (POST /v1/notify) show as a toast. Everything it says comes
// from the host (main.cjs "Other apps", scripts/studio-api.cjs); this file
// draws it. The key never reaches the page: it stays in the key file.
(function () {
  "use strict";
  const api = () => window.mefiStudio;
  const $ = (id) => document.getElementById(id);
  const state = { view: null, loading: false, again: false, prompt: "" };
  const reason = (error) => String(error?.message ?? error ?? "").slice(0, 160);
  const ROUTE_WORDS = { hello: "said hello", status: "looked at status", needs: "read what needs you", made: "read what was made", say: "messaged Mefi", task: "filed a task", notify: "left a note", pause: "paused agents", resume: "resumed agents", setup: "read setup info" };
  const clock = (at) => { try { return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const say = (id, text, bad = false) => { const line = $(id); if (line) { line.textContent = text || ""; line.classList.toggle("bad-text", bad); } };

  async function copy(text) {
    try {
      if (typeof api()?.shellCopy === "function") { await api().shellCopy(text); return true; }
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // ---- the setup prompt -------------------------------------------------------------------------
  async function readPrompt() {
    if (typeof api()?.studioApiPrompt !== "function") return null;
    const result = await api().studioApiPrompt();
    if (!result?.ok) return null;
    state.prompt = String(result.prompt ?? "");
    const box = $("apps-prompt");
    if (box) box.value = state.prompt;
    return state.prompt;
  }

  /** Copies the setup prompt; `status` names the line that reports it. Used by the setup helper too. */
  async function copyPrompt(status = "apps-prompt-status") {
    try {
      const prompt = await readPrompt();
      if (!prompt) { say(status, "The setup prompt is not available in this build.", true); return false; }
      if (await copy(prompt)) { say(status, "Copied. Paste it into Claude Code, Codex or another AI helper."); return true; }
      say(status, "It could not be copied. Show it, select it and copy it by hand.", true);
      return false;
    } catch (error) {
      say(status, `The setup prompt could not be made: ${reason(error)}`, true);
      return false;
    }
  }

  async function togglePrompt() {
    const box = $("apps-prompt");
    const button = $("apps-show-prompt");
    if (!box) return;
    if (box.hidden) await readPrompt();
    box.hidden = !box.hidden;
    if (button) { button.setAttribute("aria-expanded", String(!box.hidden)); button.textContent = box.hidden ? "Show it" : "Hide it"; }
  }

  // ---- the switch, the commands and the log ----------------------------------------------------------
  async function load() {
    if (typeof api()?.studioApiStatus !== "function") return null;
    if (state.loading) { state.again = true; return null; }
    state.loading = true;
    try {
      const view = await api().studioApiStatus();
      if (!view?.ok) { state.view = null; say("apps-state", view?.error === "unavailable" ? "Other apps are not available in this build." : view?.error || "", true); return null; }
      state.view = view;
      paint();
      return view;
    } catch (error) {
      say("apps-state", `Other apps could not be read: ${reason(error)}`, true);
      return null;
    } finally {
      state.loading = false;
      if (state.again) { state.again = false; void load(); }
    }
  }

  function connectRow(title, about, code, actions) {
    const row = node("div", "apps-connect-row");
    const head = node("div", "apps-connect-head");
    const words = node("span", "apps-connect-words");
    words.append(node("b", "", title), node("small", "", about));
    const buttons = node("span", "apps-connect-actions");
    for (const [label, run, primary] of actions) {
      const button = node("button", primary ? "mini" : "ghost mini", label);
      button.type = "button";
      button.addEventListener("click", () => { void run(button); });
      buttons.append(button);
    }
    head.append(words, buttons);
    row.append(head);
    if (code) { const pre = node("pre", "apps-code", code); pre.tabIndex = 0; row.append(pre); }
    return row;
  }

  const copyButton = (text) => ["Copy", async (button) => {
    const done = await copy(text);
    button.textContent = done ? "Copied" : "Copy failed";
    setTimeout(() => { button.textContent = "Copy"; }, 1600);
  }, true];

  async function saveSkill(button) {
    if (typeof api()?.studioApiSkill !== "function") return;
    button.disabled = true;
    try {
      const result = await api().studioApiSkill({ save: true });
      say("apps-state", result?.ok ? result.message || "Saved." : result?.error || "The skill was not saved.", !result?.ok);
    } catch (error) {
      say("apps-state", `The skill was not saved: ${reason(error)}`, true);
    } finally {
      button.disabled = false;
    }
  }
  async function copySkill(button) {
    const result = await api()?.studioApiSkill?.({ save: false });
    const done = result?.ok && await copy(result.text);
    button.textContent = done ? "Copied" : "Copy failed";
    setTimeout(() => { button.textContent = "Copy"; }, 1600);
  }

  function paint() {
    const view = state.view;
    if (!view) return;
    const on = view.settings?.on === true;
    const box = $("apps-on");
    if (box) { box.checked = on; box.disabled = view.killed === true; }
    const where = view.url ? view.url.replace(/^http:\/\//, "") : "";
    say("apps-state",
      view.killed ? "Closed for this session by MEFI_STUDIO_NO_APP_API."
        : view.error && on ? `Studio could not open the door for apps: ${view.error}`
        : on && view.running ? `On: apps on this PC reach Studio at ${where}. Connect them below.`
        : on ? "Opening…"
        : "Off: no app can reach Studio.",
      Boolean(view.error && on));
    const connect = $("apps-connect");
    if (connect) {
      connect.hidden = !(on && view.running);
      connect.replaceChildren();
      const commands = view.connect;
      if (commands && on && view.running) {
        connect.append(
          connectRow("Claude Code", "Run once in a terminal. New Claude Code sessions get Studio's tools.", commands.claudeCode, [copyButton(commands.claudeCode)]),
          connectRow("Codex", "Run once in a terminal. New Codex sessions get Studio's tools.", commands.codex, [copyButton(commands.codex)]),
          connectRow("Cursor, Claude Desktop, VS Code and other MCP apps", "Add this to the app's MCP servers.", commands.json, [copyButton(commands.json)]),
          connectRow("Claude Code skill", "Tells Claude Code when to use Studio and how, even without the tools.", "", [["Save to Claude Code", saveSkill, true], ["Copy", copySkill]]),
          connectRow("Scripts and the command line", "Add status, needs, made, say \"…\", task \"…\" or notify \"…\". --help lists them.", `${commands.cli?.bash ?? ""} status`, [copyButton(`${commands.cli?.bash ?? ""} status`)]),
        );
        if (commands.risky) connect.append(node("p", "muted", "Studio's folder has a character some terminals read as code. If a command fails, use the JSON instead."));
      }
    }
    const keys = $("apps-key-row");
    if (keys) keys.hidden = !(on && view.running);
    const log = $("apps-log");
    const head = $("apps-log-head");
    const rows = Array.isArray(view.log) ? view.log : [];
    if (log) {
      log.replaceChildren(...rows.slice(0, 12).map((row) => node("li", row.ok ? "" : "bad-text", `${clock(row.at)} · ${row.app} ${ROUTE_WORDS[row.route] ?? row.route}${row.ok ? "" : " (refused)"}`)));
      log.hidden = !rows.length;
    }
    if (head) head.hidden = !rows.length;
  }

  async function change(on) {
    if (typeof api()?.studioApiSet !== "function") return null;
    say("apps-state", on ? "Opening…" : "Closing…");
    try {
      const result = await api().studioApiSet({ on });
      if (result?.ok === false) { say("apps-state", result.error || "That did not change.", true); await load(); return null; }
      state.view = result;
      paint();
      return result;
    } catch (error) {
      say("apps-state", `That did not change: ${reason(error)}`, true);
      await load();
      return null;
    }
  }

  async function rekey() {
    if (typeof api()?.studioApiRekey !== "function") return;
    const result = await api().studioApiRekey();
    if (result?.ok === false) { say("apps-state", result.error || "No new key.", true); return; }
    state.view = result;
    paint();
    say("apps-state", result.message || "New key saved.");
  }

  // A note an app sent: a toast, named after the app.
  function notice(payload) {
    const app = String(payload?.app ?? "An app").slice(0, 40);
    const title = String(payload?.title ?? "").trim();
    const text = String(payload?.text ?? "").trim();
    if (!text) return;
    window.MefiToast?.(`${app}${title ? ` · ${title}` : ""}: ${text}`, payload?.level === "warn" ? "warn" : "info");
  }

  function init() {
    const card = $("settings-apps");
    if (typeof api()?.studioApiStatus !== "function") { if (card) card.hidden = true; return; }
    $("apps-copy-prompt")?.addEventListener("click", () => { void copyPrompt(); });
    $("apps-show-prompt")?.addEventListener("click", () => { void togglePrompt(); });
    $("apps-on")?.addEventListener("change", (event) => { void change(event.target.checked === true); });
    $("apps-rekey")?.addEventListener("click", () => { void rekey(); });
    $("apps-open-file")?.addEventListener("click", () => { if (state.view?.keyFile) void api().shellReveal?.(state.view.keyFile); });
    // Read when the card is opened, not at launch.
    card?.addEventListener("toggle", () => { if (card.open) void load(); });
    if (card?.open) void load();
    api().onStudioApiEvent?.((status) => { if (!status?.ok) return; state.view = status; paint(); });
    api().onStudioApiNotice?.((payload) => { try { notice(payload); } catch { /* a note that cannot show is not an error */ } });
  }

  window.MefiStudioApi = { load, change, copyPrompt, readPrompt, rekey, notice, state };
  init();
})();
