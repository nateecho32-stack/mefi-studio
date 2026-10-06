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

  // Reach this PC from Discord (main.cjs "Discord remote", docs/remote.md): a
  // DM with the Void Engine bot checks on this PC and talks to Mefi here. The
  // switch, this PC's name, which alerts go out, quiet hours and the digest
  // hour, and the PIN that Approve buttons ask for. The PIN goes to main once
  // and is never shown again. Nothing runs until the section is opened.
  const HOURS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
  function remoteSection(api) {
    const box = node("details", "pc-setup pc-remote");
    box.id = "pc-remote";
    const status = node("p", "muted pc-setup-status", "Check on this PC and talk to Mefi from a Discord DM.");
    status.id = "pc-remote-status";
    status.setAttribute("role", "status");
    const control = (label, input) => { const row = node("label", "pc-sync-follow"); row.append(input, node("span", "", label)); return row; };
    const tick = (id) => { const input = node("input"); input.type = "checkbox"; input.id = id; return input; };
    const onSwitch = tick("pc-remote-on");
    onSwitch.setAttribute("role", "switch");
    const nameInput = node("input", "pc-remote-name");
    nameInput.id = "pc-remote-name";
    nameInput.maxLength = 40;
    nameInput.setAttribute("aria-label", "This PC's name in Discord");
    const nameSave = node("button", "ghost pc-sync-run", "Save name");
    nameSave.type = "button";
    const nameRow = node("div", "pc-sync-actions");
    nameRow.append(nameInput, nameSave);
    const alerts = { needsYou: tick("pc-remote-needs"), failed: tick("pc-remote-failed"), stuck: tick("pc-remote-stuck"), done: tick("pc-remote-done") };
    const digest = node("select", "pc-remote-digest");
    digest.id = "pc-remote-digest";
    digest.setAttribute("aria-label", "Daily digest");
    digest.append(...[["", "No daily digest"], ...HOURS.map((hour, index) => [String(index), `Daily digest at ${hour}`])].map(([value, label]) => { const option = node("option", "", label); option.value = value; return option; }));
    const quietOn = tick("pc-remote-quiet");
    const quietFrom = node("select");
    const quietTo = node("select");
    quietFrom.setAttribute("aria-label", "Quiet from");
    quietTo.setAttribute("aria-label", "Quiet until");
    for (const select of [quietFrom, quietTo]) select.append(...HOURS.map((hour) => { const option = node("option", "", hour); option.value = hour; return option; }));
    quietFrom.value = "23:00";
    quietTo.value = "07:00";
    const quietRow = node("div", "pc-sync-actions");
    quietRow.append(control("Quiet hours", quietOn), quietFrom, node("span", "muted", "to"), quietTo);
    const pinStatus = node("p", "muted", "");
    pinStatus.id = "pc-remote-pin-status";
    const pinInput = node("input", "pc-remote-pin");
    pinInput.id = "pc-remote-pin";
    pinInput.type = "password";
    pinInput.inputMode = "numeric";
    pinInput.autocomplete = "off";
    pinInput.maxLength = 12;
    pinInput.placeholder = "New PIN (4-12 digits)";
    pinInput.setAttribute("aria-label", "New PIN, 4 to 12 digits");
    const pinSave = node("button", "ghost pc-sync-run", "Save PIN");
    pinSave.type = "button";
    pinSave.id = "pc-remote-pin-save";
    const pinClear = node("button", "ghost pc-sync-run", "Remove PIN");
    pinClear.type = "button";
    pinClear.id = "pc-remote-pin-clear";
    const unlock = node("button", "ghost pc-sync-run", "Unlock approvals");
    unlock.type = "button";
    unlock.id = "pc-remote-unlock";
    const pinRow = node("div", "pc-sync-actions");
    pinRow.append(pinInput, pinSave, pinClear, unlock);
    const pcs = node("ul", "pc-sync-list");
    pcs.id = "pc-remote-pcs";
    const log = node("ul", "pc-sync-list");
    log.id = "pc-remote-log";
    const details = node("div", "pc-remote-details");
    details.append(
      node("p", "pc-setup-links-head", "This PC in Discord"), nameRow,
      node("p", "pc-setup-links-head", "Alerts in your DMs"),
      control("Something needs you", alerts.needsYou), control("A task stopped", alerts.failed), control("Agents sit on work for 15 minutes", alerts.stuck), control("A task finished", alerts.done),
      digest, quietRow,
      node("p", "pc-setup-links-head", "Approving from Discord"), pinStatus, pinRow,
      node("p", "pc-setup-links-head", "Your PCs in Discord"), pcs,
      node("p", "pc-setup-links-head", "Last commands here"), log,
    );
    box.append(node("summary", "", "Reach this PC from Discord"), status, control("Answer my Discord DMs on this PC", onSwitch), details,
      node("p", "muted", "From Discord you can check on this PC, see what needs you, chat with Mefi and pause or resume agents. Tasks you start there wait for your OK. Permissions, keys and settings never change from Discord."));
    let busy = false, loaded = false;
    const when = (at) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const words = { status: "status", needs: "what needs you", made: "what is being made", digest: "digest", say: "a message to Mefi", pause: "pause", resume: "resume", button: "a button" };
    function paint(result) {
      if (!result?.ok) { status.textContent = result?.error === "unavailable" ? "The Discord remote is not in this build." : result?.error || "The Discord remote could not be read."; return; }
      const s = result.settings, hub = result.hub ?? {};
      onSwitch.checked = s.on;
      details.hidden = !s.on;
      if (document.activeElement !== nameInput) nameInput.value = s.name;
      for (const [key, input] of Object.entries(alerts)) input.checked = s.notify[key] === true;
      digest.value = s.notify.digestHour == null ? "" : String(s.notify.digestHour);
      quietOn.checked = Boolean(s.quiet);
      if (s.quiet) { quietFrom.value = s.quiet.from; quietTo.value = s.quiet.to; }
      quietFrom.disabled = quietTo.disabled = !s.quiet;
      pinStatus.textContent = s.locked ? "Locked after five wrong PINs. Approvals from Discord stay off until you unlock them." : s.pinSet ? "Approve buttons in Discord ask for your PIN. It is never posted in the chat." : "No PIN yet: approvals stay in Studio. Set one to approve from Discord.";
      pinClear.hidden = !s.pinSet;
      unlock.hidden = !s.locked;
      pinSave.textContent = s.pinSet ? "Change PIN" : "Save PIN";
      pcs.replaceChildren(...(hub.pcs ?? []).map((pc) => node("li", "", `${pc.name}${pc.since ? ` · since ${when(pc.since)}` : ""}`)));
      if (!pcs.children.length) pcs.append(node("li", "muted", "None yet. Each PC shows here once its remote is on and connected."));
      log.replaceChildren(...(result.log ?? []).map((row) => node("li", "", `${when(row.at)} · ${words[row.command] ?? row.command}${row.note ? ` · ${row.note}` : ""}`)));
      if (!log.children.length) log.append(node("li", "muted", "Nothing asked yet."));
      status.textContent = !s.on ? "Off. Turn it on to check on this PC and talk to Mefi from a Discord DM."
        : !result.linked ? "Sign in with Discord first, in Friends."
        : !hub.configured ? "This copy of Studio can't reach the room service."
        : hub.state === "ready" && !hub.remote ? "The room service doesn't carry the Discord remote yet. It comes back once the Void Engine bot is linked to it."
        : hub.state === "ready" && hub.on ? `On. DM the Void Engine bot, or use /studio status. This PC answers as ${s.name}.`
        : hub.state === "error" ? `${window.MefiFriendsFront?.hubState?.({ ...hub, linked: true })?.text || "The room service refused this PC."} Studio tries again every ten minutes.`
        : "Connecting to the room service…";
    }
    const guard = async (label, work) => {
      if (busy) return;
      busy = true;
      box.setAttribute("aria-busy", "true");
      if (label) status.textContent = label;
      try { await work(); } catch (error) { status.textContent = `That did not work: ${plain(error, "Studio did not answer.")}`; }
      busy = false;
      box.removeAttribute("aria-busy");
    };
    const save = (patch, label = "Saving…") => guard(label, async () => paint(await api.remoteSet(patch)));
    onSwitch.addEventListener("change", () => { void save({ on: onSwitch.checked }, onSwitch.checked ? "Turning the remote on…" : "Turning the remote off…"); });
    nameSave.addEventListener("click", () => { if (nameInput.value.trim()) void save({ name: nameInput.value.trim() }); });
    for (const [key, input] of Object.entries(alerts)) input.addEventListener("change", () => { void save({ notify: { [key]: input.checked } }); });
    digest.addEventListener("change", () => { void save({ notify: { digestHour: digest.value === "" ? null : Number(digest.value) } }); });
    const quiet = () => { void save({ quiet: quietOn.checked ? { from: quietFrom.value, to: quietTo.value } : null }); };
    quietOn.addEventListener("change", quiet);
    quietFrom.addEventListener("change", quiet);
    quietTo.addEventListener("change", quiet);
    const pin = (payload, label) => guard(label, async () => {
      const result = await api.remotePin(payload);
      pinInput.value = "";
      paint(result);
      if (result?.message) status.textContent = result.message;
      if (result?.ok === false && result.error) status.textContent = result.error;
    });
    pinSave.addEventListener("click", () => {
      const value = pinInput.value.trim();
      if (!/^\d{4,12}$/.test(value)) { status.textContent = "A PIN is 4 to 12 digits."; return; }
      void pin({ pin: value }, "Saving the PIN…");
    });
    const clearPin = () => { void pin({ clear: true }, "Removing the PIN…"); };
    if (window.MefiUi?.arm) window.MefiUi.arm(pinClear, { run: clearPin, armed: "Remove the PIN?" }); else pinClear.addEventListener("click", clearPin);
    unlock.addEventListener("click", () => { void pin({ unlock: true }, "Unlocking…"); });
    if (typeof api.onRemoteEvent === "function") api.onRemoteEvent((result) => { if (loaded) paint(result); });
    box.addEventListener("toggle", () => {
      if (!box.open || loaded) return;
      loaded = true;
      void guard("Reading the Discord remote…", async () => paint(await api.remoteStatus()));
    });
    return box;
  }

  function pairedSection(api) {
    const box = node("details", "pc-setup"); box.id = "pc-paired-workers";
    const status = node("p", "muted pc-setup-status", "Off until you start the coordinator or worker."); status.id = "paired-status"; status.setAttribute("role", "status");
    const controls = new Set(), jobRows = new Map(), workers = node("ul", "pc-sync-list"), jobs = node("div"), recovery = node("ul", "pc-sync-list");
    let busy = false, latest = null, timer = null, cursor = null;
    const field = (id, label, type = "text", value = "") => {
      const input = node("input", "pc-setup-repos"); input.id = id; input.type = type; input.value = value; input.autocomplete = "off";
      const wrapper = node("label", "pc-paired-field", label); wrapper.append(input); return { wrapper, input };
    };
    const button = (id, label, work) => { const result = node("button", "ghost pc-sync-run", label); result.id = id; result.type = "button"; result.addEventListener("click", () => { void act(work); }); controls.add(result); return result; };
    const port = field("paired-port", "Coordinator port", "number", "42240"); port.input.min = "1"; port.input.max = "65535";
    const address = field("paired-address", "HTTPS address other PCs will use (optional for loopback)", "url"); address.input.placeholder = "https://your-coordinator-address";
    const mode = node("select", "pc-setup-repos"); mode.id = "paired-mode"; mode.setAttribute("aria-label", "Coordinator connection");
    for (const [value, label] of [["loopback", "Loopback only"], ["https", "HTTPS on this PC's network interfaces"]]) { const option = node("option", "", label); option.value = value; mode.append(option); } mode.value = "loopback";
    const startCoordinator = button("paired-coordinator-start", "Start coordinator", () => api.pairedCoordinator("start", { port: Number(port.input.value), mode: mode.value, url: address.input.value }));
    const stopCoordinator = button("paired-coordinator-stop", "Stop coordinator", () => api.pairedCoordinator("stop"));
    const invite = button("paired-invite", "Pair another PC", async () => { const answer = await api.pairedInvite(); if (answer?.code && box.open) { invitation.input.value = answer.code; invitation.wrapper.hidden = copy.hidden = false; } return answer; });
    const enqueue = button("paired-enqueue", "Queue this project's saved commit", () => api.pairedEnqueue());
    const invitation = field("paired-invitation", "One-use pairing code (expires in five minutes)", "password"); invitation.input.readOnly = true; invitation.wrapper.hidden = true;
    const copy = button("paired-copy", "Copy pairing code", async () => { try { await navigator.clipboard.writeText(invitation.input.value); } catch { invitation.input.focus?.(); invitation.input.select?.(); throw new Error("Select the pairing code and copy it on this PC."); } return { ok: true }; }); copy.hidden = true;
    const code = field("paired-code", "Paste the coordinator's pairing code", "password");
    const pair = button("paired-pair", "Pair this PC", async () => { const answer = await api.pairedPair(code.input.value); if (answer?.ok && !answer.cancelled) code.input.value = ""; return answer; });
    const startWorker = button("paired-worker-start", "Start worker", () => api.pairedWorker("start"));
    const stopWorker = button("paired-worker-stop", "Stop worker", () => api.pairedWorker("stop"));
    const forget = button("paired-worker-forget", "Forget pairing", () => api.pairedWorker("forget"));
    // "Start by itself": what was running comes back after a restart or an
    // update. Main asks before turning one on; the box follows its answer.
    const auto = (id, role, label) => {
      const input = node("input"); input.id = id; input.type = "checkbox";
      input.addEventListener("change", () => { const on = input.checked; input.checked = !on; void act(() => api.pairedAuto(role, on)); });
      controls.add(input); const wrapper = node("label", "pc-paired-auto"); wrapper.append(input, node("span", "", label)); return { wrapper, input };
    };
    const coordinatorAuto = auto("paired-coordinator-auto", "coordinator", "Start by itself when Studio starts");
    const workerAuto = auto("paired-worker-auto", "worker", "Start by itself when Studio starts");
    const refreshButton = button("paired-refresh", "Refresh", async () => { cursor = null; return api.pairedStatus(); });
    const older = button("paired-older", "Older jobs", async () => { cursor = latest?.coordinator?.nextCursor ?? null; return api.pairedStatus({ before: cursor }); });
    const actions = (...buttons) => { const row = node("div", "pc-sync-actions"); row.append(...buttons); return row; };
    box.append(node("summary", "", "Paired repository checks"), status,
      node("p", "muted", "Make this PC the coordinator, or pair it as a worker. The first profile checks Studio at an exact saved commit in a fresh checkout. Your current changes stay here. What you start comes back by itself after Studio restarts or updates, and a worker reconnects by itself after a lost connection. PCs on different Studio versions keep working together; only one that is far behind is asked to update."),
      node("h5", "", "Coordinator"), port.wrapper, mode, address.wrapper, actions(startCoordinator, stopCoordinator, invite, enqueue), coordinatorAuto.wrapper, invitation.wrapper, actions(copy),
      node("h5", "", "This PC as a worker"), code.wrapper, actions(pair, startWorker, stopWorker, forget), workerAuto.wrapper, recovery,
      node("p", "muted", "Other PCs require trusted HTTPS, directly or through an existing reverse proxy. Certificate, network access and firewall setup are owner steps. A lost or uncertain assignment waits for recovery; it is never automatically run again."),
      node("h5", "", "Paired PCs"), workers, node("h5", "", "Recent jobs"), jobs, actions(refreshButton, older));
    function paintControls() {
      for (const control of controls) control.disabled = busy;
      const coordinator = latest?.coordinator, worker = latest?.worker;
      startCoordinator.disabled ||= Boolean(coordinator?.running); stopCoordinator.disabled ||= !coordinator?.running; invite.disabled ||= !coordinator?.running;
      startWorker.disabled ||= !worker?.paired || Boolean(worker?.running); stopWorker.disabled ||= !worker?.running; forget.disabled ||= !worker?.paired;
      pair.disabled ||= latest?.encryptionAvailable === false; older.disabled ||= !latest?.coordinator?.nextCursor;
      coordinatorAuto.input.checked = coordinator?.autoStart === true; workerAuto.input.checked = worker?.autoStart === true;
      workerAuto.input.disabled ||= !worker?.paired;
    }
    // "0.4.10" against "0.5.0"; anything unreadable compares equal.
    const behindOf = (a, b) => {
      const parse = (value) => (/^\d+\.\d+\.\d+/.exec(String(value ?? "")) ?? [""])[0].split(".").map(Number);
      const left = parse(a), right = parse(b);
      if (left.length < 3 || right.length < 3) return false;
      for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] < right[index];
      return false;
    };
    // The worker's connection in words: connected, trying again, or which PC
    // has to update first (scripts/link-compat.cjs decides; main says who).
    function workerLine(worker) {
      if (!worker?.paired) return "Worker not paired";
      if (!worker.running) return worker.resumeError ? `Worker did not start by itself: ${worker.resumeError}` : "Worker paired, stopped";
      const seconds = Number.isFinite(worker.retryInMs) ? Math.max(1, Math.round(worker.retryInMs / 1000)) : null;
      if (worker.link === "update") return worker.update === "coordinator" ? "The coordinator PC's Studio is too far behind. Update Studio there; this worker reconnects by itself." : "This PC's Studio is too far behind the coordinator's. Update Studio here; the worker reconnects by itself.";
      if (worker.link === "reconnecting") return `Worker lost ${worker.url}; reconnecting by itself${seconds ? ` (next try in ${seconds} s)` : ""}`;
      if (worker.link === "connected") return `Worker connected to ${worker.url}${worker.busy ? ", running a check" : ""}`;
      return `Worker connecting to ${worker.url}…`;
    }
    function paint(answer) {
      if (!answer?.ok) { status.textContent = answer?.error || "Paired workers did not answer."; return; }
      latest = answer; const coordinator = answer.coordinator, worker = answer.worker;
      for (const control of controls) if (control.id.startsWith("paired-revoke-") || control.id.startsWith("paired-recover-")) controls.delete(control);
      status.textContent = [coordinator?.running ? `Coordinator: ${coordinator.url}` : coordinator?.resumeError ? `Coordinator did not start by itself: ${coordinator.resumeError}` : "Coordinator off", workerLine(worker), worker?.running && worker?.link !== "update" ? worker?.error : null].filter(Boolean).join(" · ");
      workers.replaceChildren(...(coordinator?.workers ?? []).map(item => {
        const version = item.app ? ` · Studio ${item.app}${behindOf(item.app, answer.app) ? " (older, still connects)" : ""}` : "";
        const row = node("li", "", `${item.name}${version} · ${item.revoked ? "revoked" : item.repos.join(", ")}`); if (!item.revoked) row.append(button(`paired-revoke-${item.id}`, "Revoke", () => api.pairedRevoke(item.id))); return row;
      }));
      recovery.replaceChildren(...(worker?.uncertain ?? []).map(id => { const row = node("li", "", `Check ${id.slice(0, 8)} needs restart recovery. `); row.append(button(`paired-recover-${id}`, "Confirm previous check stopped", () => api.pairedWorker("recover", id))); return row; }));
      const visible = new Set((coordinator?.jobs ?? []).map(job => job.id));
      for (const [id, row] of jobRows) if (!visible.has(id)) { controls.delete(row.more); controls.delete(row.back); jobRows.delete(id); }
      jobs.replaceChildren(...(coordinator?.jobs ?? []).map(job => {
        let row = jobRows.get(job.id);
        if (!row) {
          row = { detail: node("details", "pc-setup"), summary: node("summary"), line: node("p", "muted"), recent: node("ul", "pc-sync-list"), history: node("ul", "pc-sync-list"), chunk: 0, offset: 0, exhausted: false };
          const loadHistory = async () => {
            const page = await api.pairedHistory(job.id, { chunk: row.chunk, offset: row.offset }); if (page?.ok === false) return page;
            row.history.replaceChildren(...(page.lines ?? []).map(line => node("li", "", line.text)));
            row.previous = page.previous; row.back.hidden = !row.previous;
            if (page.next != null) row.offset = page.next; else if (row.chunk < row.job.archiveChunks) { row.chunk++; row.offset = 0; } else { row.offset += (page.lines ?? []).length; row.exhausted = true; row.more.hidden = true; }
            return { ok: true };
          };
          row.more = button(`paired-history-${job.id}`, "Older progress", loadHistory);
          row.back = button(`paired-history-back-${job.id}`, "Previous progress page", async () => { if (!row.previous) return { ok: true }; row.chunk = row.previous.chunk; row.offset = row.previous.offset; row.exhausted = false; return loadHistory(); }); row.back.hidden = true;
          row.detail.append(row.summary, row.line, row.recent, row.more, row.back, row.history); jobRows.set(job.id, row);
        }
        if ((row.job?.archived ?? 0) < (job.archived ?? 0)) row.exhausted = false;
        row.job = job; row.summary.textContent = `${job.spec.repo} · ${job.spec.commit.slice(0, 8)} · ${job.state}`;
        row.line.textContent = job.result?.summary || (job.state === "uncertain" ? "Held until the assigned PC confirms its previous process stopped." : "Waiting for a paired worker or check result.");
        row.recent.replaceChildren(...(job.progress ?? []).slice(-3).map(line => node("li", "", line.text))); row.more.hidden = !job.archived || row.exhausted;
        return row.detail;
      })); paintControls();
    }
    async function refresh() { try { paint(await api.pairedStatus({ before: cursor })); } catch (error) { status.textContent = plain(error, "Paired workers did not answer."); } }
    async function act(work) {
      if (busy) return; busy = true; paintControls(); box.setAttribute("aria-busy", "true");
      try { const answer = await work(); if (answer?.ok === false) throw new Error(answer.error || "Paired worker action failed."); if (answer?.coordinator) paint(answer); else await refresh(); }
      catch (error) { status.textContent = plain(error, "Paired worker action failed."); }
      finally { busy = false; box.removeAttribute("aria-busy"); paintControls(); }
    }
    let pollGeneration = 0;
    const poll = async generation => { if (generation !== pollGeneration || !box.open || !box.isConnected) return; if (!busy && box.checkVisibility?.() !== false) await refresh(); if (generation === pollGeneration && box.open && box.isConnected) timer = setTimeout(() => poll(generation), 5000); };
    box.addEventListener("toggle", () => { clearTimeout(timer); const generation = ++pollGeneration; if (box.open) { void refresh(); timer = setTimeout(() => poll(generation), 5000); } else { invitation.input.value = ""; invitation.wrapper.hidden = copy.hidden = true; } });
    paintControls(); return box;
  }

  // A long report (a PC with many branches) reads as a few grouped lines; the
  // full list is one press away (Show all). Lines the groups do not know stay
  // as they are.
  const LONG_REPORT = 4;
  function brief(lines) {
    const groups = [
      [/^Worktree .+: \d+ uncommitted files?\.$/, (n) => `${n} other worktree${n === 1 ? " has" : "s have"} uncommitted work`],
      [/^Branch .+ on this PC: \d+ commits? not on main\.$/, (n) => `${n} branch${n === 1 ? "" : "es"} on this PC with commits not on main`],
      [/^Branch .+ on GitHub: \d+ commits? not on main\.$/, (n) => `${n} branch${n === 1 ? "" : "es"} on GitHub not merged into main`],
    ];
    const counts = groups.map(() => 0);
    const rest = [];
    for (const line of lines) {
      const at = groups.findIndex(([pattern]) => pattern.test(line));
      if (at >= 0) counts[at] += 1;
      else rest.push(line);
    }
    return [...rest, ...groups.flatMap(([, words], at) => (counts[at] ? [words(counts[at])] : []))];
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
    const summary = node("ul", "pc-sync-brief");
    summary.hidden = true;
    const toggle = node("button", "ghost pc-sync-toggle", "Show all");
    toggle.type = "button";
    toggle.id = "pc-sync-toggle";
    toggle.hidden = true;
    let showAll = false;
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
    root.append(title, status, summary, list, toggle, actions, meta, note);
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
    if (typeof api?.pairedStatus === "function") root.append(pairedSection(api));
    // Reach this PC from Discord (the remote section above).
    if (typeof api?.remoteStatus === "function") root.append(remoteSection(api));
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
      const long = details.length > LONG_REPORT;
      summary.replaceChildren(...(long ? brief(details) : []).map((line) => node("li", "", line)));
      summary.hidden = !long || showAll;
      list.hidden = !details.length || (long && !showAll);
      toggle.hidden = !long;
      toggle.textContent = showAll ? "Show less" : `Show all ${details.length}`;
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
    toggle.addEventListener("click", () => {
      showAll = !showAll;
      summary.hidden = showAll;
      list.hidden = !showAll;
      toggle.textContent = showAll ? "Show less" : `Show all ${list.children.length}`;
    });
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
