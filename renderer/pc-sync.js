// Friends › Your PCs: whether the open project on this PC matches its default
// branch on GitHub, what has not reached GitHub yet, and Sync this PC. The
// words come from scripts/sync.mjs through main's sync:status, sync:run and
// sync:event; this file only lays them out. Opening the card looks (a fetch
// that moves no branch). Only the buttons pull and push: Sync this PC, and Put
// my commits on top of GitHub's when both sides moved and nothing is
// uncommitted. A push waits for the project's own check. badge() is what the
// Friends bubble shows: work only this PC holds, plus commits waiting on
// GitHub, plus a GitHub that could not be checked. renderer/companion-hub.js
// mounts the card in the Friends section and draws the badge; the card holds
// Set up this PC and renderer/pc-vault.js's two sharing sections.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const bridge = () => window.mefiStudio;
  // A failure in words (MefiUi.plainError, studio-ui.js); unit suites load
  // this file alone, where a plain Error's own message stands in.
  const plain = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : (error?.name === "Error" && error.message) || fallback);
  // The last answer from any source (a card, a sync, the background look), so
  // reopening Friends paints at once while it re-checks.
  let last = null;
  const listeners = new Set();

  const kinds = (result) => (Array.isArray(result?.problems) ? result.problems.map((item) => item?.kind) : []);
  function stateOf(result) {
    if (!result || result.ok === false) return "problem";
    if (result.state?.behind || result.pending?.length) return "pending";
    if (kinds(result).includes("offline")) return "offline";
    return "clean";
  }

  function badge(result = last) {
    if (!result) return 0;
    const risk = Number.isFinite(result.risk) ? result.risk : 0;
    const unchecked = kinds(result).some((kind) => kind === "fetch-failed" || kind === "error") ? 1 : 0;
    return risk + (result.state?.behind ? 1 : 0) + unchecked;
  }

  function remember(result) {
    if (!result || typeof result !== "object") return;
    last = result;
    for (const fn of listeners) { try { fn(result); } catch {} }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  const api = bridge();
  if (typeof api?.onSyncEvent === "function") api.onSyncEvent(remember);
  // A new project gets a fresh look, so the badge never speaks for the last one.
  window.addEventListener?.("mefi:project-changed", () => {
    last = null;
    for (const fn of listeners) { try { fn(null); } catch {} }
    if (typeof bridge()?.syncStatus === "function") bridge().syncStatus().then(remember, () => {});
  });

  // Set up this PC (scripts/pc-setup.cjs through main's pc-setup:*): a
  // checklist of what this PC needs to share projects through GitHub, one
  // button per missing piece (each opens a visible setup window), and Get a
  // project from GitHub, which clones from the account's own list into a
  // folder main's dialog asks for. Nothing runs until the section is opened.
  function setupSection(api) {
    const box = node("details", "pc-setup");
    box.id = "pc-setup";
    const status = node("p", "muted pc-setup-status", "Checks Git, your GitHub sign-in and this project.");
    status.id = "pc-setup-status";
    status.setAttribute("role", "status");
    const checks = node("ul", "pc-sync-list pc-setup-list");
    const steps = node("div", "pc-sync-actions");
    steps.hidden = true;
    const again = node("button", "ghost pc-sync-run", "Check again");
    again.type = "button";
    again.id = "pc-setup-check";
    const get = node("button", "ghost pc-sync-run", "Get a project from GitHub");
    get.type = "button";
    get.id = "pc-setup-get";
    get.disabled = true;
    const tools = node("div", "pc-sync-actions");
    tools.append(again, get);
    const picker = node("div", "pc-sync-actions pc-setup-clone");
    picker.hidden = true;
    const select = node("select", "pc-setup-repos");
    select.id = "pc-setup-repos";
    select.setAttribute("aria-label", "Your GitHub repositories");
    const clone = node("button", "ghost pc-sync-run", "Choose a folder and get it");
    clone.type = "button";
    clone.id = "pc-setup-clone";
    picker.append(select, clone);
    // What links this PC to your others and to friends: the vault, the
    // Discord link and the rooms hub, each with the place that finishes it.
    const linksHead = node("p", "pc-setup-links-head", "Linking this PC");
    linksHead.hidden = true;
    const links = node("ul", "pc-sync-list pc-setup-links");
    links.id = "pc-setup-links";
    const openLink = (action) => {
      if (action === "vault") {
        const vault = document.getElementById("pc-vault");
        if (vault) { vault.open = true; vault.scrollIntoView?.({ block: "nearest" }); }
        return;
      }
      window.MefiCompanionHub?.close?.({ immediate: true, restore: false });
      window.MefiNav?.go?.("community");
    };
    box.append(node("summary", "", "Set up this PC"), status, checks, steps, tools, picker, linksHead, links);
    let busy = false, loaded = false, signedIn = false;
    const line = (done, text) => node("li", "", `${done ? "✓" : "•"} ${text}`);
    const paint = (result) => {
      if (!result?.ok) { status.textContent = result?.error || "This PC could not be checked."; return; }
      status.textContent = result.ready ? "This PC is ready to share projects through GitHub." : "A few things to finish on this PC:";
      const project = result.project ?? {};
      checks.replaceChildren(
        ...result.tools.map((tool) => line(tool.installed, tool.installed ? `${tool.name} ${tool.version}` : `${tool.name} is not installed`)),
        line(Boolean(result.account), result.account ? `Signed in to GitHub as ${result.account}` : "Not signed in to GitHub"),
        ...(project.root ? [line(Boolean(project.github), project.github ? `This project is on GitHub (${project.github})` : "This project is not on GitHub")] : []),
        ...(project.hook ? [line(true, "Claude Code sessions in this project sync when they start")] : []),
        ...result.notes.map((text) => line(false, text)),
      );
      steps.replaceChildren(...result.steps.map((step) => {
        const button = node("button", "ghost pc-sync-run", step.label);
        button.type = "button";
        button.dataset.step = step.id;
        button.title = step.why;
        button.addEventListener("click", () => { void act(step.id); });
        return button;
      }));
      steps.hidden = !result.steps.length;
      const linking = Array.isArray(result.links) ? result.links : [];
      links.replaceChildren(...linking.map((item) => {
        const row = line(item.done === true, String(item.label ?? ""));
        row.dataset.link = String(item.id ?? "");
        if (item.done !== true) {
          const go = node("button", "ghost mini", item.action === "vault" ? "Open" : "Open Settings");
          go.type = "button";
          go.addEventListener("click", () => openLink(item.action));
          row.append(go);
        }
        return row;
      }));
      linksHead.hidden = !linking.length;
      signedIn = Boolean(result.account);
    };
    const guard = async (label, work) => {
      if (busy) return;
      busy = true;
      again.disabled = get.disabled = clone.disabled = true;
      box.setAttribute("aria-busy", "true");
      if (label) status.textContent = label;
      try { await work(); } catch (error) { status.textContent = `Setup could not run: ${plain(error, "Studio did not answer.")}`; }
      busy = false;
      again.disabled = clone.disabled = false;
      // Listing repositories needs a GitHub sign-in this PC has shown.
      get.disabled = !signedIn;
      box.removeAttribute("aria-busy");
    };
    const check = () => guard("Checking this PC…", async () => { loaded = true; paint(await api.pcSetupStatus()); });
    const act = (id) => guard(null, async () => {
      const result = await api.pcSetupAction(id);
      status.textContent = result?.ok ? result.message : result?.error || "The setup window did not open.";
    });
    again.addEventListener("click", () => { void check(); });
    get.addEventListener("click", () => {
      void guard("Listing your GitHub repositories…", async () => {
        const result = await api.pcSetupRepos();
        if (!result?.ok) { status.textContent = result?.error || "Your repositories could not be listed."; return; }
        select.replaceChildren(...result.repos.map((row) => {
          const option = node("option", "", `${row.repo}${row.private ? " (private)" : ""}`);
          option.value = row.repo;
          return option;
        }));
        select.value = result.repos[0]?.repo ?? "";
        picker.hidden = !result.repos.length;
        status.textContent = result.repos.length ? "Pick a repository, then choose where to put it on this PC." : "Your GitHub account has no repositories yet.";
      });
    });
    clone.addEventListener("click", () => {
      const repo = select.value;
      if (!repo) return;
      void guard(`Getting ${repo}… this can take a few minutes.`, async () => {
        const result = await api.pcSetupClone(repo);
        if (result?.canceled) { status.textContent = "No folder chosen, so nothing was downloaded."; return; }
        status.textContent = result?.ok ? `Got ${repo} into ${result.folder} and opened it. If it has packages, install them from the checklist.` : result?.error || "The project could not be downloaded.";
        if (result?.ok) { picker.hidden = true; paint(await api.pcSetupStatus()); }
      });
    });
    box.addEventListener("toggle", () => { if (box.open && !loaded) void check(); });
    return box;
  }

  function card() {
    const root = node("section", "pc-sync");
    root.setAttribute("aria-labelledby", "pc-sync-title");
    const title = node("h4", "pc-sync-title", "Your PCs");
    title.id = "pc-sync-title";
    const status = node("p", "pc-sync-status", "Checking GitHub…");
    status.id = "pc-sync-status";
    status.setAttribute("role", "status");
    const list = node("ul", "pc-sync-list");
    list.hidden = true;
    const actions = node("div", "pc-sync-actions");
    const run = node("button", "ghost pc-sync-run", "Sync this PC");
    run.type = "button";
    run.id = "pc-sync-run";
    const rebase = node("button", "ghost pc-sync-run", "Put my commits on top of GitHub's");
    rebase.type = "button";
    rebase.id = "pc-sync-rebase";
    rebase.hidden = true;
    actions.append(run, rebase);
    const meta = node("p", "muted pc-sync-meta");
    meta.hidden = true;
    const note = node("p", "muted", "Sync pulls what your other PCs pushed and pushes this PC's commits after the project's check passes. It never overwrites uncommitted work or force-pushes.");
    root.append(title, status, list, actions, meta, note);
    const api = bridge();
    // Keep this PC up to date: main checks GitHub every minute and, when this
    // PC has nothing of its own in the way, pulls what the other PCs pushed.
    if (typeof api?.syncFollow === "function") {
      const follow = node("label", "pc-sync-follow");
      const tick = node("input");
      tick.type = "checkbox";
      tick.id = "pc-sync-follow";
      tick.checked = true;
      follow.append(tick, node("span", "", "Keep this PC up to date: bring in other PCs' pushes within a minute, when nothing here is in the way"));
      tick.addEventListener("change", () => { void Promise.resolve(api.syncFollow(tick.checked)).then((answer) => { if (answer?.ok) tick.checked = answer.on !== false; }).catch(() => {}); });
      void Promise.resolve(api.syncFollow()).then((answer) => { if (answer?.ok) tick.checked = answer.on !== false; }).catch(() => {});
      root.append(follow);
    }
    if (typeof api?.pcSetupStatus === "function") root.append(setupSection(api));
    // Share between my PCs and Share with friends (renderer/pc-vault.js).
    if (window.MefiPcVault) root.append(window.MefiPcVault.section(), window.MefiPcVault.shareSection());
    if (typeof api?.syncStatus !== "function" || typeof api?.syncRun !== "function") {
      status.textContent = "Syncing your PCs works in the desktop app.";
      actions.hidden = true;
      note.hidden = true;
      root.dataset.state = "unavailable";
      return root;
    }
    let busy = false;
    const show = (result) => {
      if (!result) return;
      root.dataset.state = stateOf(result);
      status.textContent = result.headline || "Sync did not answer. Try again.";
      const details = Array.isArray(result.lines) ? result.lines.slice(1) : [];
      list.replaceChildren(...details.map((line) => node("li", "", line)));
      list.hidden = !details.length;
      const linked = result.state?.repo !== false && result.state?.remote !== false;
      run.hidden = !linked;
      rebase.hidden = !linked || result.canRebase !== true;
      const when = Number.isFinite(result.checkedAt) ? new Date(result.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
      const device = typeof result.state?.device === "string" && result.state.device ? result.state.device : "This PC";
      meta.textContent = when ? `${device} · checked ${when}` : "";
      meta.hidden = !linked || !when;
    };
    const ask = async (mode) => {
      if (busy) return;
      busy = true;
      run.disabled = rebase.disabled = true;
      if (mode === "sync") run.textContent = "Syncing…";
      if (mode === "rebase") rebase.textContent = "Putting your commits on top…";
      root.setAttribute("aria-busy", "true");
      if (mode !== "look" || !last) status.textContent = mode === "look" ? "Checking GitHub…" : "Syncing with GitHub…";
      let result;
      try {
        result = await (mode === "look" ? api.syncStatus() : api.syncRun({ rebase: mode === "rebase" }));
      } catch (error) {
        result = { ok: false, headline: `Sync could not run: ${plain(error, "Studio did not answer.")}`, lines: [] };
      }
      remember(result);
      busy = false;
      run.disabled = rebase.disabled = false;
      run.textContent = "Sync this PC";
      rebase.textContent = "Put my commits on top of GitHub's";
      root.removeAttribute("aria-busy");
      show(result);
    };
    run.addEventListener("click", () => { void ask("sync"); });
    rebase.addEventListener("click", () => { void ask("rebase"); });
    // A background look that lands while the card is open repaints it; a card
    // that has left the page stops listening.
    const off = subscribe((result) => {
      if (root.isConnected === false) { off(); return; }
      if (!busy) show(result);
    });
    if (last) show(last);
    void ask("look");
    return root;
  }

  window.MefiPcSync = { card, badge, subscribe, last: () => last };
})();
