// Friends › Your PCs › My PCs (docs/my-pcs.md): the owner's PCs live — what
// each has free, what it runs, why it is not taking work — and pairing by the
// six numbers, sending work to a PC, the battery's Continue, Keep this PC on,
// the open project's switch, handoffs and lending this PC to a friend.
// Everything comes from main's "My PCs" block through pcs:* (pcsStatus with a
// watch lease while the section is open, onPcsEvent while it holds one); this
// file only lays it out. renderer/pc-sync.js mounts it at the top of the card.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const plain = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : (error?.name === "Error" && error.message) || fallback);
  const button = (label, id = null, cls = "ghost pc-sync-run") => { const el = node("button", cls, label); el.type = "button"; if (id) el.id = id; return el; };
  const WATCH_MS = 45_000;

  const gb = (mb) => (Number.isFinite(mb) ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : "?");
  const ago = (at, now) => {
    if (!Number.isFinite(at)) return "";
    const minutes = Math.max(0, Math.round((now - at) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
  };

  // One PC's readings in a line: CPU, memory, battery, slots.
  function meters(state) {
    if (!state) return "";
    const parts = [];
    if (Number.isFinite(state.cpu)) parts.push(`CPU ${state.cpu}%`);
    if (Number.isFinite(state.freeMB)) parts.push(`${gb(state.freeMB)} free${Number.isFinite(state.totalMB) ? ` of ${gb(state.totalMB)}` : ""}`);
    if (state.battery) parts.push(`Battery ${state.battery.level}%${state.battery.plugged ? ", plugged in" : ""}`);
    parts.push(`${state.slots?.running ?? 0} of ${state.slots?.max ?? 0} running`);
    if (state.stayOn === "always") parts.push("kept on");
    return parts.join(" · ");
  }

  function section(api = window.mefiStudio) {
    const box = node("details", "pc-setup pc-fleet");
    box.id = "pc-fleet";
    box.open = true;
    const status = node("p", "muted pc-setup-status", "Looking for your PCs…");
    status.id = "pc-fleet-status";
    status.setAttribute("role", "status");
    const stopBanner = node("div", "pc-fleet-stop");
    stopBanner.id = "pc-fleet-stop";
    stopBanner.hidden = true;
    const stopText = node("p", "", "");
    const go = button("Continue", "pc-fleet-continue", "primary pc-sync-run");
    stopBanner.append(stopText, go);
    const asks = node("ul", "pc-fleet-asks");
    asks.id = "pc-fleet-asks";
    const rows = node("ul", "pc-fleet-rows");
    rows.id = "pc-fleet-rows";
    // Sending work: a new task, or one of the open project's ready cards.
    const form = node("div", "pc-fleet-send");
    form.id = "pc-fleet-send";
    form.hidden = true;
    const formHead = node("p", "pc-setup-links-head", "");
    const pick = node("select", "pc-fleet-pick");
    pick.id = "pc-fleet-pick";
    pick.setAttribute("aria-label", "What to send");
    const titleInput = node("input", "pc-setup-repos");
    titleInput.id = "pc-fleet-title";
    titleInput.maxLength = 90;
    titleInput.placeholder = "What should it do?";
    titleInput.setAttribute("aria-label", "Task title");
    const brief = node("textarea", "pc-fleet-brief");
    brief.id = "pc-fleet-brief-input";
    brief.rows = 3;
    brief.maxLength = 6000;
    brief.placeholder = "Details (optional)";
    brief.setAttribute("aria-label", "Task details");
    const formActions = node("div", "pc-sync-actions");
    const send = button("Send", "pc-fleet-send-go", "primary pc-sync-run");
    const cancel = button("Cancel", "pc-fleet-send-cancel");
    formActions.append(send, cancel);
    form.append(formHead, pick, titleInput, brief, formActions);
    const moved = node("ul", "pc-sync-list");
    moved.id = "pc-fleet-moved";
    const movedHead = node("p", "pc-setup-links-head", "Out on other PCs");
    const sent = node("ul", "pc-sync-list");
    sent.id = "pc-fleet-sent";
    const sentHead = node("p", "pc-setup-links-head", "Sent from here");
    const waiting = node("ul", "pc-sync-list");
    waiting.id = "pc-fleet-waiting";
    const waitingHead = node("p", "pc-setup-links-head", "Friends' tasks waiting for your OK");
    // This PC.
    // Keep this PC on: awake with nothing running, while plugged in. Awake
    // while work runs stays the assistant's switch in Settings.
    const stay = node("input");
    stay.type = "checkbox";
    stay.id = "pc-fleet-stay";
    stay.setAttribute("role", "switch");
    const stayRow = node("label", "pc-sync-follow");
    stayRow.append(stay, node("span", "", "Keep this PC on so my other PCs can send it work (while plugged in)"));
    const nameInput = node("input", "pc-remote-name");
    nameInput.id = "pc-fleet-name";
    nameInput.maxLength = 40;
    nameInput.setAttribute("aria-label", "This PC's name");
    const nameSave = button("Save name", "pc-fleet-name-save");
    const nameRow = node("div", "pc-sync-actions");
    nameRow.append(nameInput, nameSave);
    const batteryRow = node("div", "pc-sync-actions pc-fleet-battery");
    batteryRow.id = "pc-fleet-battery";
    const number = (id, label, min, max) => { const input = node("input", "pc-fleet-number"); input.type = "number"; input.min = String(min); input.max = String(max); input.id = id; input.setAttribute("aria-label", label); return input; };
    const lowInput = number("pc-fleet-low", "Finish up at this battery level", 10, 50);
    const stopInput = number("pc-fleet-stop-at", "Stop at this battery level", 5, 30);
    const batterySave = button("Save", "pc-fleet-battery-save");
    batteryRow.append(node("span", "muted", "Finish up at"), lowInput, node("span", "muted", "% and stop at"), stopInput, node("span", "muted", "%"), batterySave);
    const share = node("input");
    share.type = "checkbox";
    share.id = "pc-fleet-share";
    const shareRow = node("label", "pc-sync-follow");
    const shareText = node("span", "", "My other PCs may take this project's work");
    shareRow.append(share, shareText);
    const shareNote = node("p", "muted", "");
    // Handoffs.
    const handoffs = node("ul", "pc-sync-list");
    handoffs.id = "pc-fleet-handoffs";
    const look = button("Check GitHub now", "pc-fleet-handoffs-look");
    // Lending.
    const lends = node("ul", "pc-sync-list");
    lends.id = "pc-fleet-lends";
    const findInput = node("input", "pc-setup-repos");
    findInput.id = "pc-fleet-lend-find";
    findInput.maxLength = 40;
    findInput.placeholder = "A friend's name";
    findInput.setAttribute("aria-label", "Find a friend to lend this PC to");
    const find = button("Find", "pc-fleet-lend-find-go");
    const found = node("ul", "pc-sync-list");
    found.id = "pc-fleet-lend-found";
    const findRow = node("div", "pc-sync-actions");
    findRow.append(findInput, find);
    const notes = node("ul", "pc-sync-list pc-fleet-notes");
    notes.id = "pc-fleet-notes";
    const head = (text) => node("p", "pc-setup-links-head", text);
    box.append(
      node("summary", "", "My PCs"), status, stopBanner, asks, rows, form,
      movedHead, moved, sentHead, sent, waitingHead, waiting,
      head("This PC"), nameRow, stayRow, batteryRow,
      head("This project"), shareRow, shareNote,
      head("Handoffs"), handoffs, look,
      head("Lend this PC to a friend"), node("p", "muted", "Someone you share a room with in Friends › Rooms. Their PCs can then send it work: each task waits for your OK unless you tick Run without asking, and runs with this PC's agents."), lends, findRow, found,
      head("Lately"), notes,
      node("p", "muted", "Your PCs see each other once each signs in to Friends with the same Discord account. Pair each one once by checking the six numbers on both screens; only paired PCs can send each other work. A PC never sees another's screen, files or keys."),
    );

    let busy = false, last = null, timer = null, sendTo = null;

    const guard = async (label, work) => {
      if (busy) return;
      busy = true;
      box.setAttribute("aria-busy", "true");
      if (label) status.textContent = label;
      try {
        const answer = await work();
        if (answer?.ok === false && answer.error) status.textContent = answer.error;
        else if (answer?.ok === false && answer.cancelled) status.textContent = "Left as it was.";
      } catch (error) {
        status.textContent = `That did not work: ${plain(error, "Studio did not answer.")}`;
      }
      busy = false;
      box.removeAttribute("aria-busy");
    };
    const refresh = async () => paint(await api.pcsStatus(true));

    function rowView(row, now, result) {
      const item = node("li", "pc-fleet-row");
      item.dataset.pc = row.id;
      const state = row.heard?.state ?? null;
      // This PC is busy while its battery holds new work or it is not taking any.
      const selfBusy = row.self && (result.power.stage !== "ok" || state?.accepting === false);
      item.dataset.state = !row.online ? "offline" : row.why || selfBusy ? "busy" : "free";
      const name = node("strong", "", row.name);
      const kind = row.self ? "This PC" : !row.mine ? `lent to you by ${row.owner?.name || "a friend"}` : row.kind === "laptop" ? "laptop" : "desktop";
      const top = node("div", "pc-fleet-head");
      top.append(name, node("span", "muted", ` · ${kind}`));
      item.append(top);
      if (row.online && state) item.append(node("div", "pc-fleet-meters", meters(state)));
      const why = row.self ? (result.power.stage !== "ok" ? result.power.words : state?.accepting ? "Taking work" : null)
        : !row.online ? `Offline${row.lastSeen ? ` since ${ago(row.lastSeen, now)}` : ""}`
        : row.keysChanged ? "Its keys changed: pair again before it can send or take work"
        : !row.paired ? "Not paired yet"
        : row.why || "Taking work";
      if (why) item.append(node("div", "pc-fleet-why", why));
      if (!row.self) {
        const actions = node("div", "pc-sync-actions");
        if (row.online && (!row.paired || row.keysChanged) && (row.mine || row.lends)) {
          const pair = button("Pair");
          pair.addEventListener("click", () => { void guard("Asking it to pair…", async () => { const answer = await api.pcsPair(row.id); await refresh(); if (answer?.ok) status.textContent = `Check that ${row.name} shows ${answer.numbers}, then choose Pair there.`; return answer; }); });
          actions.append(pair);
        }
        if (row.paired && row.online && (row.relation === "mine" || row.relation === "lender")) {
          const give = button("Send work here");
          give.addEventListener("click", () => openForm(row, result));
          actions.append(give);
        }
        if (row.paired) {
          const forget = button("Forget");
          const run = () => { void guard("Forgetting…", async () => { const answer = await api.pcsForget(row.id); await refresh(); return answer; }); };
          if (window.MefiUi?.arm) window.MefiUi.arm(forget, { run, armed: `Forget ${row.name}?` }); else forget.addEventListener("click", run);
          actions.append(forget);
        }
        if (actions.children.length) item.append(actions);
      }
      return item;
    }

    function openForm(row, result) {
      sendTo = row;
      form.hidden = false;
      formHead.textContent = `Send work to ${row.name}${result.project ? ` (${result.project.name})` : ""}`;
      const options = [["", "A new task"], ...(row.relation === "mine" ? (result.movable ?? []).map((task) => [task.id, `Move: ${task.title}`]) : [])];
      pick.replaceChildren(...options.map(([value, label]) => { const option = node("option", "", label); option.value = value; return option; }));
      pick.hidden = options.length < 2;
      titleInput.hidden = brief.hidden = false;
      titleInput.focus?.();
    }
    pick.addEventListener("change", () => { titleInput.hidden = brief.hidden = pick.value !== ""; });
    cancel.addEventListener("click", () => { form.hidden = true; sendTo = null; });
    send.addEventListener("click", () => {
      const row = sendTo;
      if (!row) return;
      if (pick.value) {
        void guard(`Offering it to ${row.name}…`, async () => {
          const answer = await api.pcsMove(pick.value, row.id);
          await refresh();
          if (answer?.ok) { form.hidden = true; status.textContent = `Offered to ${row.name}. It moves when ${row.name} has a free slot.`; }
          return answer;
        });
        return;
      }
      const title = titleInput.value.trim();
      if (!title) { status.textContent = "Give the task a title."; return; }
      void guard(`Sending it to ${row.name}…`, async () => {
        const answer = await api.pcsStart({ pcId: row.id, title, prompt: brief.value.trim() || title });
        await refresh();
        if (answer?.ok) { form.hidden = true; titleInput.value = ""; brief.value = ""; status.textContent = `Sent to ${row.name}.`; }
        return answer;
      });
    });

    function paint(result) {
      if (!result) return;
      last = result;
      if (!result.ok) { status.textContent = result.error === "unavailable" ? "My PCs is not in this build." : result.error || "My PCs could not be read."; return; }
      const now = Date.now();
      const others = result.rows.filter((row) => !row.self);
      const online = others.filter((row) => row.online).length;
      const relay = result.relay ?? {};
      status.textContent = !relay.linked ? "Sign in with Discord in Friends on each of your PCs to see them here."
        : relay.state === "ready" && !relay.carries ? "The relay does not carry My PCs yet. It does once it is updated."
        : relay.state !== "ready" ? "Connecting to the relay…"
        : !result.encryption ? "Windows cannot keep this PC's keys safe, so it cannot pair. Your other PCs still show here."
        : others.length ? `${others.length} other PC${others.length === 1 ? "" : "s"}, ${online} online.`
        : "No other PC yet. Sign in to Friends with the same Discord account on another PC.";
      stopBanner.hidden = result.power.stage !== "stopped";
      stopText.textContent = `Stopped at ${result.power.reading?.level ?? "low"}% battery. ${result.held ? `${result.held} task${result.held === 1 ? " was" : "s were"} stopped with progress saved and parked for your other PCs. ` : ""}Nothing runs here until you choose Continue.`;
      asks.replaceChildren(...(result.asks ?? []).map((ask) => {
        const item = node("li", "pc-fleet-ask");
        if (ask.dir === "out") {
          item.append(node("span", "", `Check that ${ask.name} shows ${ask.numbers}, then choose Pair there.`));
          return item;
        }
        item.append(node("span", "", `${ask.name} asks to pair${ask.relation === "borrow" ? " to use this PC" : ""}. Pair only if its screen shows ${ask.numbers}.`));
        const yes = button("Pair", null, "primary pc-sync-run");
        const no = button("Not mine");
        yes.addEventListener("click", () => { void guard("Pairing…", async () => { const answer = await api.pcsPairAnswer(ask.id, true); await refresh(); return answer; }); });
        no.addEventListener("click", () => { void guard("Saying no…", async () => { const answer = await api.pcsPairAnswer(ask.id, false); await refresh(); return answer; }); });
        item.append(yes, no);
        return item;
      }));
      rows.replaceChildren(...result.rows.map((row) => rowView(row, now, result)));
      moved.replaceChildren(...(result.moved ?? []).map((task) => {
        const item = node("li", "", `${task.title} · ${task.pending ? `offered to ${task.to}` : `on ${task.to}`}`);
        if (!task.pending) {
          const back = button("Bring back");
          back.addEventListener("click", () => {
            void guard("Asking for it back…", async () => {
              let answer = await api.pcsRecall(task.id, false);
              if (answer?.offline && window.confirm?.(answer.error)) answer = await api.pcsRecall(task.id, true);
              await refresh();
              return answer?.offline ? { ok: false, error: "Left on the other PC." } : answer;
            });
          });
          item.append(" ", back);
        }
        return item;
      }));
      movedHead.hidden = moved.hidden = !moved.children.length;
      const words = { sent: "sent", queued: "queued there", held: "waiting for their OK", refused: "not taken", done: "done", failed: "not finished", dropped: "dropped" };
      sent.replaceChildren(...(result.sent ?? []).map((row) => node("li", "", `${row.title} → ${row.toName} · ${words[row.status] ?? row.status}${row.error ? `: ${row.error}` : ""}`)));
      sentHead.hidden = sent.hidden = !sent.children.length;
      waiting.replaceChildren(...(result.waiting ?? []).map((task) => node("li", "", `${task.title} · from ${task.from}. Open it in Tasks and say "work on it" to run it here.`)));
      waitingHead.hidden = waiting.hidden = !waiting.children.length;
      if (document.activeElement !== nameInput) nameInput.value = result.me?.name ?? "";
      stay.checked = result.stayOn === "always";
      const laptop = result.power.reading && !result.power.reading.error;
      batteryRow.hidden = !laptop;
      if (document.activeElement !== lowInput) lowInput.value = String(result.power.lines.low);
      if (document.activeElement !== stopInput) stopInput.value = String(result.power.lines.stop);
      const project = result.project;
      share.disabled = !project?.github;
      share.checked = Boolean(project?.share);
      shareText.textContent = project ? `My other PCs may take ${project.name}'s work` : "Open a project to choose whether your other PCs may take its work";
      shareNote.textContent = !project ? "" : !project.github ? "This project has no GitHub repository, so its work stays on this PC."
        : `At most ${result.limits.movedPerProject} of its tasks are out on other PCs at once, and at most ${result.limits.parkedPerProject} handoffs wait on GitHub. Handoffs are branches of the project's repository, as visible as it is.`;
      const list = result.handoffs?.list ?? [];
      handoffs.replaceChildren(...list.map((row) => {
        const item = node("li", "", `${row.titles.join(", ")} · from ${row.mine ? "this PC" : row.pcName}${row.why === "battery" && Number.isFinite(row.level) ? ` at ${row.level}% battery` : ""} · ${ago(row.at, now)}`);
        if (!row.mine) {
          const take = button("Pick up");
          take.addEventListener("click", () => { void guard("Picking it up…", async () => { const answer = await api.pcsPickUp(row.branch, row.sha); await refresh(); if (answer?.ok) status.textContent = `Picked up: ${answer.tasks} task${answer.tasks === 1 ? "" : "s"} on this PC's board.`; return answer; }); });
          item.append(" ", take);
        }
        const drop = button("Drop");
        drop.addEventListener("click", () => { void guard("Dropping…", async () => { const answer = await api.pcsDrop(row.branch, row.sha); await refresh(); return answer; }); });
        item.append(" ", drop);
        return item;
      }));
      if (!handoffs.children.length) handoffs.append(node("li", "muted", result.handoffs?.error ? `GitHub could not be asked: ${result.handoffs.error}` : "None waiting."));
      lends.replaceChildren(...(result.lend ?? []).map((lend) => {
        const item = node("li", "pc-fleet-lend");
        const auto = node("input");
        auto.type = "checkbox";
        auto.checked = lend.auto === true;
        const autoLabel = node("label", "pc-sync-follow");
        autoLabel.append(auto, node("span", "", "Run without asking"));
        auto.addEventListener("change", () => { void save({ lend: result.lend.map((row) => (row.id === lend.id ? { ...row, auto: auto.checked } : row)) }); });
        const stop = button("Stop lending");
        stop.addEventListener("click", () => { void save({ lend: result.lend.filter((row) => row.id !== lend.id) }, `Stopping the lend to ${lend.name}…`); });
        item.append(node("span", "", lend.name), autoLabel, stop);
        return item;
      }));
      if (!lends.children.length) lends.append(node("li", "muted", "Not lent to anyone."));
      notes.replaceChildren(...(result.notes ?? []).map((note) => node("li", "", `${ago(note.at, now)} · ${note.text}`)));
      if (!notes.children.length) notes.append(node("li", "muted", "Nothing yet."));
    }

    const save = (patch, label = "Saving…") => guard(label, async () => { const answer = await api.pcsSet(patch); paint(answer); return answer; });
    go.addEventListener("click", () => { void guard("Starting again…", async () => { const answer = await api.pcsContinue(); await refresh(); if (answer?.ok && answer.elsewhere) status.textContent = `${answer.elsewhere} task${answer.elsewhere === 1 ? " is" : "s are"} on another PC now; the rest run here again.`; return answer; }); });
    stay.addEventListener("change", () => { void save({ stayOn: stay.checked ? "always" : "working" }); });
    nameSave.addEventListener("click", () => { if (nameInput.value.trim()) void save({ name: nameInput.value.trim() }); });
    batterySave.addEventListener("click", () => {
      const low = Number(lowInput.value), stop = Number(stopInput.value);
      if (!(stop < low)) { status.textContent = "The stop level must be below the finish-up level."; return; }
      void save({ battery: { low, stop } });
    });
    share.addEventListener("change", () => { if (last?.project) void save({ share: { projectId: last.project.id, on: share.checked } }); });
    look.addEventListener("click", () => { void guard("Asking GitHub…", async () => { paint(await api.pcsHandoffs()); }); });
    find.addEventListener("click", () => {
      const query = findInput.value.trim();
      if (!query || typeof api.hubRoom !== "function") return;
      void guard("Looking…", async () => {
        const answer = await api.hubRoom("searchMembers", query);
        const people = Array.isArray(answer?.members) ? answer.members : Array.isArray(answer?.people) ? answer.people : [];
        found.replaceChildren(...people.slice(0, 8).map((person) => {
          const item = node("li", "", person.name);
          const lend = button("Lend to them");
          lend.addEventListener("click", () => {
            const list = [...(last?.lend ?? []).filter((row) => row.id !== person.id), { id: person.id, name: person.name, auto: false }];
            found.replaceChildren();
            findInput.value = "";
            void save({ lend: list }, `Lending this PC to ${person.name}…`);
          });
          item.append(" ", lend);
          return item;
        }));
        if (!found.children.length) found.append(node("li", "muted", answer?.ok === false ? "Friends could not be searched just now." : "Nobody by that name."));
      });
    });
    if (typeof api?.onPcsEvent === "function") api.onPcsEvent((result) => { if (box.isConnected !== false && box.open) paint(result); });
    // The watch lease: renewed while the section is open and on the page.
    const watch = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (box.isConnected === false || !box.open) return;
      void refresh().catch(() => {});
      timer = setTimeout(watch, WATCH_MS);
    };
    box.addEventListener("toggle", watch);
    if (typeof api?.pcsStatus !== "function") {
      status.textContent = "My PCs works in the desktop app.";
      return box;
    }
    setTimeout(watch, 0);
    return box;
  }

  window.MefiPcFleet = { section, meters };
})();
