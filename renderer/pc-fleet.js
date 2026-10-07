// Friends › Your PCs, the PCs themselves (docs/my-pcs.md). Connect another PC
// comes first: three plain steps (open Studio on the other PC, sign in to
// Friends with the same Discord account on both, press Pair and compare the
// six numbers) that follow what main reports, folded to one button once a PC
// of the owner's is paired. Then My PCs, the owner's PCs live — what each has
// free, what it runs, why it is not taking work — with Pair, Send work here,
// Forget and Rename, pairing asks with the six numbers, the battery stop's
// Continue, cards out on other PCs, the open project's switch and handoffs.
// Then two folded groups: Power and battery (Keep this PC on, the battery
// lines) and Lend this PC to a friend. Everything comes from main's "My PCs"
// block through pcs:* (pcsStatus with a watch lease while the card is on the
// page, onPcsEvent while it holds one); this file only lays it out. Signing in
// goes the way Friends' own sign-in card does (friends-front.js gate:
// MefiCommunity.link, then hubConnect). section() returns all of it;
// renderer/pc-sync.js mounts the walkthrough and the list at the top of the
// Your PCs card and moves the two groups (section().parts) below its GitHub one.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const plain = (error, fallback) => (window.MefiUi?.plainError ? window.MefiUi.plainError(error, fallback) : (error?.name === "Error" && error.message) || fallback);
  const button = (label, id = null, cls = "ghost pc-sync-run") => { const el = node("button", cls, label); el.type = "button"; if (id) el.id = id; return el; };
  const WATCH_MS = 45_000;
  // Where Studio is downloaded: the releases page renderer/demo-panel.js links too.
  const DOWNLOAD_URL = "https://github.com/nateecho32-stack/mefi-studio/releases/latest";
  const DOWNLOAD_SHOWN = "github.com/nateecho32-stack/mefi-studio/releases";
  // Connect another PC, opened or folded by the owner's own press (null until
  // they press it). It lasts while Studio runs, so Your PCs opened again looks
  // the way it was left; without a press it is open until a PC of theirs is
  // paired. pairedBefore is what the last answer said about that, so a card
  // built again folds the same way before its own first answer arrives.
  let walkChoice = null, pairedBefore = null;

  const gb = (mb) => (Number.isFinite(mb) ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : "?");
  const ago = (at, now) => {
    if (!Number.isFinite(at)) return "";
    const minutes = Math.max(0, Math.round((now - at) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
  };
  const names = (rows) => {
    const list = rows.map((row) => row.name);
    return list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
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

  // Where Connect another PC stands, from one pcs:status answer: the step the
  // third line speaks for, the owner's other PCs (seen, paired, or online and
  // not paired yet) and the pairing asks between them. A friend's lent PC and
  // its asks belong to lending, not here.
  function walkState(result) {
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const relay = result?.relay ?? {};
    const own = rows.filter((row) => !row.self && row.mine);
    const paired = own.filter((row) => row.paired);
    const found = own.filter((row) => row.online && (!row.paired || row.keysChanged));
    const asks = (Array.isArray(result?.asks) ? result.asks : []).filter((ask) => ask.relation !== "borrow");
    const stage = !result ? "loading"
      : !result.ok ? "error"
      : !relay.linked ? "signin"
      : relay.state !== "ready" ? "connecting"
      : !relay.carries ? "outdated"
      : !result.encryption ? "nokeys"
      : asks.length ? "asked"
      : found.length ? "found"
      : "waiting";
    return { stage, relay, own, paired, found, asks };
  }

  function section(api = window.mefiStudio) {
    const box = node("div", "pc-fleet");
    box.id = "pc-fleet";
    const head = (text) => node("p", "pc-setup-links-head", text);

    // ---- Connect another PC ----
    const walk = node("details", "pc-walk");
    walk.id = "pc-walk";
    walk.open = walkChoice ?? !pairedBefore;
    const walkHead = node("summary", "pc-walk-head", "Connect another PC");
    walkHead.id = "pc-walk-head";
    // The owner's press, not a fold this file makes: a click comes before the toggle.
    walkHead.addEventListener("click", () => { walkChoice = !walk.open; });
    const steps = node("ol", "pc-walk-steps");
    steps.id = "pc-walk-steps";
    const step = (n, words) => {
      const item = node("li", "pc-walk-step");
      item.dataset.step = String(n);
      const num = node("span", "pc-walk-num", String(n));
      num.setAttribute("aria-hidden", "true");
      const text = node("div", "pc-walk-text");
      const now = node("div", "pc-walk-now");
      text.append(node("p", "pc-walk-what", words), now);
      item.append(num, text);
      steps.append(item);
      return { item, num, now };
    };
    // 1. Studio on the other PC, with where to get it.
    const one = step(1, "Open Studio on your other PC.");
    const getNote = node("p", "muted", `Not on it yet? Get it from ${DOWNLOAD_SHOWN}`);
    const get = button("Open the download page", "pc-walk-get");
    const copy = button("Copy the link", "pc-walk-copy");
    const copied = node("span", "muted pc-walk-copied", "");
    copied.setAttribute("role", "status");
    const getRow = node("div", "pc-sync-actions");
    getRow.append(get, copy, copied);
    one.now.append(getNote, getRow);
    // 2. This PC's sign-in; the other PC says its own.
    const two = step(2, "Sign in to Friends with the same Discord account on both PCs.");
    const signLine = node("p", "pc-walk-signed", "");
    signLine.id = "pc-walk-signed";
    const signIn = button("Sign in with Discord", "pc-walk-signin", "primary pc-sync-run");
    const join = button("Join the Discord", "pc-walk-join", "primary pc-sync-run");
    const recheck = button("Check again", "pc-walk-recheck");
    const connect = button("Connect", "pc-walk-connect");
    const signRow = node("div", "pc-sync-actions");
    signRow.append(signIn, join, recheck, connect);
    two.now.append(signLine, signRow);
    // 3. What main sees now: waiting, found (with Pair), or the six numbers.
    const three = step(3, "When your other PC shows up, press Pair and check that both screens show the same six numbers.");
    const live = node("div", "pc-walk-live");
    live.id = "pc-walk-status";
    live.setAttribute("role", "status");
    live.tabIndex = -1;
    three.now.append(live);
    walk.append(walkHead, steps, node("p", "muted pc-walk-note", "Only paired PCs can send each other work. A PC never sees another's screen, files or keys."));

    // ---- My PCs ----
    const list = node("div", "pc-fleet-list");
    list.id = "pc-fleet-list";
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
    // Rename: this PC's name, opened from its own row.
    const renameRow = node("div", "pc-sync-actions pc-fleet-rename");
    renameRow.id = "pc-fleet-rename";
    renameRow.hidden = true;
    const nameLabel = node("label", "muted", "This PC's name");
    nameLabel.htmlFor = "pc-fleet-name";
    const nameInput = node("input", "pc-remote-name");
    nameInput.id = "pc-fleet-name";
    nameInput.maxLength = 40;
    nameInput.setAttribute("aria-label", "This PC's name");
    const nameSave = button("Save name", "pc-fleet-name-save");
    const nameCancel = button("Cancel", "pc-fleet-name-cancel");
    renameRow.append(nameLabel, nameInput, nameSave, nameCancel);
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
    const movedHead = head("Out on other PCs");
    const sent = node("ul", "pc-sync-list");
    sent.id = "pc-fleet-sent";
    const sentHead = head("Sent from here");
    const waiting = node("ul", "pc-sync-list");
    waiting.id = "pc-fleet-waiting";
    const waitingHead = head("Friends' tasks waiting for your OK");
    // This project: shown once another PC of the owner's is paired.
    const project = node("div", "pc-fleet-project");
    project.id = "pc-fleet-project";
    project.hidden = true;
    const share = node("input");
    share.type = "checkbox";
    share.id = "pc-fleet-share";
    const shareRow = node("label", "pc-sync-follow");
    const shareText = node("span", "", "My other PCs may take this project's work");
    shareRow.append(share, shareText);
    const shareNote = node("p", "muted", "");
    project.append(shareRow, shareNote);
    // Handoffs: shown while one waits, or when GitHub could not be asked.
    const handoffBox = node("div", "pc-fleet-handoffs-box");
    handoffBox.hidden = true;
    const handoffs = node("ul", "pc-sync-list");
    handoffs.id = "pc-fleet-handoffs";
    const look = button("Check GitHub now", "pc-fleet-handoffs-look");
    handoffBox.append(head("Handoffs"), node("p", "muted", "Work one of your PCs parked on GitHub when it had to stop. Pick it up to carry on here."), handoffs, look);
    // Lately: what happened, folded.
    const lately = node("details", "pc-fleet-lately");
    lately.hidden = true;
    const notes = node("ul", "pc-sync-list pc-fleet-notes");
    notes.id = "pc-fleet-notes";
    lately.append(node("summary", "", "Lately"), notes);
    list.append(
      node("h5", "pc-fleet-title", "My PCs"), status, stopBanner, asks, rows, renameRow, form,
      movedHead, moved, sentHead, sent, waitingHead, waiting, project, handoffBox, lately,
    );

    // ---- Power and battery ----
    // Keep this PC on: awake with nothing running, while plugged in. Awake
    // while work runs stays the assistant's switch in Settings.
    const power = node("details", "pc-setup pc-group pc-fleet-group");
    power.id = "pc-fleet-power";
    const powerNote = node("span", "muted pc-group-note", "");
    const powerHead = node("summary", "", "Power and battery");
    powerHead.append(powerNote);
    const stay = node("input");
    stay.type = "checkbox";
    stay.id = "pc-fleet-stay";
    stay.setAttribute("role", "switch");
    const stayRow = node("label", "pc-sync-follow");
    stayRow.append(stay, node("span", "", "Keep this PC on so my other PCs can send it work (while plugged in)"));
    const batteryRow = node("div", "pc-sync-actions pc-fleet-battery");
    batteryRow.id = "pc-fleet-battery";
    const number = (id, label, min, max) => { const input = node("input", "pc-fleet-number"); input.type = "number"; input.min = String(min); input.max = String(max); input.id = id; input.setAttribute("aria-label", label); return input; };
    const lowInput = number("pc-fleet-low", "Finish up at this battery level", 10, 50);
    const stopInput = number("pc-fleet-stop-at", "Stop at this battery level", 5, 30);
    const batterySave = button("Save", "pc-fleet-battery-save");
    batteryRow.append(node("span", "muted", "Finish up at"), lowInput, node("span", "muted", "% and stop at"), stopInput, node("span", "muted", "%"), batterySave);
    const batteryAbout = node("p", "muted", "At the first level this laptop starts nothing new and offers its waiting work to your other PCs. At the second it stops, parks its work for them and waits for you.");
    power.append(powerHead, stayRow, batteryRow, batteryAbout);

    // ---- Lend this PC to a friend ----
    const lend = node("details", "pc-setup pc-group pc-fleet-group");
    lend.id = "pc-fleet-lending";
    const lendNote = node("span", "muted pc-group-note", "");
    const lendHead = node("summary", "", "Lend this PC to a friend");
    lendHead.append(lendNote);
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
    lend.append(lendHead, node("p", "muted", "Someone you share a room with in Friends › Rooms. Their PCs can then send it work: each task waits for your OK unless you tick Run without asking, and runs with this PC's agents."), lends, findRow, found);

    box.append(walk, list, power, lend);
    box.parts = { walk, list, power, lend };

    let busy = false, last = null, timer = null, sendTo = null, renameOpener = null;
    let account = null, accountAsked = false, signing = false, signNote = "", mustJoin = false, liveKey = "";

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
    // Pair from a row or from the walkthrough (which shows the numbers itself).
    const pairWith = (row, fromWalk = false) => guard("Asking it to pair…", async () => {
      const answer = await api.pcsPair(row.id);
      await refresh();
      if (answer?.ok && !fromWalk) status.textContent = `Check that ${row.name} shows ${answer.numbers}, then choose Pair there.`;
      return answer;
    });
    const answerAsk = (ask, yes) => guard(yes ? "Pairing…" : "Saying no…", async () => { const answer = await api.pcsPairAnswer(ask.id, yes); await refresh(); return answer; });
    // A sentence with the six numbers set apart, so the two screens are easy to compare.
    const withNumbers = (before, numbers, after) => { const span = node("span", ""); span.append(before, node("strong", "pc-fleet-numbers", numbers), after); return span; };
    // One pairing ask: ours (check the other screen) or theirs (Pair or Not mine).
    function askView(ask, cls) {
      const item = node(cls === "pc-walk-line" ? "div" : "li", cls);
      if (ask.dir === "out") {
        item.append(cls === "pc-walk-line" ? withNumbers(`${ask.name} should now show `, ask.numbers, ". If it does, choose Pair there.") : withNumbers(`Check that ${ask.name} shows `, ask.numbers, ", then choose Pair there."));
        return item;
      }
      item.append(withNumbers(`${ask.name} asks to pair${ask.relation === "borrow" ? " to use this PC" : ""}. Pair only if its screen shows `, ask.numbers, "."));
      const yes = button("Pair", null, "primary pc-sync-run");
      const no = button("Not mine");
      yes.addEventListener("click", () => { void answerAsk(ask, true); });
      no.addEventListener("click", () => { void answerAsk(ask, false); });
      item.append(yes, no);
      return item;
    }

    // Signing in, as Friends' own sign-in card does it (friends-front.js gate).
    async function connected(note = "Signed in. Connecting…") {
      mustJoin = false;
      signNote = note;
      paintWalk(last);
      try { await api.hubConnect?.(); } catch { /* the next look says why */ }
      signNote = "";
      await refresh().catch(() => paintWalk(last));
    }
    async function startSignIn() {
      const community = window.MefiCommunity;
      // A build without Friends' Discord link: Settings › Community has it.
      if (typeof community?.link !== "function") { window.MefiNav?.go?.("community"); return; }
      if (signing) return;
      signing = true;
      signNote = "Discord is asking in your browser. Press Authorize there, then come back.";
      paintWalk(last);
      let linked = null;
      try { linked = await community.link(); } catch (error) { linked = { ok: false, error: plain(error, "") }; }
      signing = false;
      if (linked?.ok) { await connected(); return; }
      if (linked?.error === "not-member") { mustJoin = true; signNote = ""; paintWalk(last); return; }
      signNote = linked?.error === "canceled" ? "Signing in was cancelled. Press Sign in with Discord to try again." : "Signing in didn't finish. Press Sign in with Discord to try again.";
      paintWalk(last);
    }
    async function checkAgain() {
      if (signing) return;
      signing = true;
      signNote = "Checking…";
      paintWalk(last);
      let checked = null;
      try { checked = await window.MefiCommunity?.check?.(); } catch { checked = null; }
      signing = false;
      if (checked?.ok === false && checked.error === "not-member") { mustJoin = true; signNote = ""; paintWalk(last); return; }
      await connected();
    }
    signIn.addEventListener("click", () => { void startSignIn(); });
    join.addEventListener("click", () => { void window.MefiCommunity?.join?.(); });
    recheck.addEventListener("click", () => { void checkAgain(); });
    connect.addEventListener("click", () => { void connected("Connecting…"); });
    get.addEventListener("click", () => { void Promise.resolve(api?.openExternal?.(DOWNLOAD_URL)).catch(() => {}); });
    copy.addEventListener("click", () => {
      void Promise.resolve(api?.shellCopy?.(DOWNLOAD_URL)).then((answer) => { copied.textContent = answer?.ok === false ? "" : "Copied."; }, () => { copied.textContent = ""; });
    });

    // The walkthrough from one answer (or none yet). Returns where it stands.
    function paintWalk(result) {
      const w = walkState(result);
      walk.dataset.stage = w.stage;
      // A build without My PCs (MEFI_STUDIO_NO_PCS) has no steps to follow.
      walk.hidden = w.stage === "error" && result?.error === "unavailable";
      const known = w.stage !== "loading" && w.stage !== "error";
      if (known) pairedBefore = w.paired.length > 0;
      // Open until a PC of the owner's is paired, unless they chose; a fold
      // that would take the focus with it hands it to the walkthrough's button.
      const open = walkChoice ?? !pairedBefore;
      if (walk.open !== open) {
        const inside = !open && walk.contains?.(document.activeElement) && document.activeElement !== walkHead;
        walk.open = open;
        if (inside) walkHead.focus?.();
      }
      // Step 2: whether this PC is signed in, and the one thing that helps.
      const relay = w.relay;
      const said = known && relay.linked ? window.MefiFriendsFront?.hubState?.({ configured: relay.error !== "unavailable", linked: true, state: relay.state, error: relay.error }) ?? null : null;
      // Discord linked the account but it is not in the server yet: join first.
      const action = !known ? null : mustJoin ? "join" : !relay.linked ? "signin" : said?.action ?? null;
      const signedIn = known && Boolean(relay.linked) && action !== "signin" && action !== "join";
      if (!relay.linked) { account = null; accountAsked = false; }
      if (signedIn && relay.state === "ready" && !account && !accountAsked && typeof api?.hubStatus === "function") {
        accountAsked = true;
        void Promise.resolve(api.hubStatus()).then((answer) => {
          const name = answer?.status?.user?.name;
          if (typeof name === "string" && name.trim()) { account = name.trim().slice(0, 40); paintWalk(last); }
        }).catch(() => {});
      }
      signLine.textContent = signNote || (!known ? ""
        : action === "join" ? "Your Discord account isn't in the Void Engine server yet. Join it, then check again."
        : !relay.linked ? "This PC is not signed in yet."
        : action === "signin" ? said?.text || "Sign in with Discord again."
        : `✓ This PC is signed in${account ? ` as ${account}` : ""}.${said?.text ? ` ${said.text}` : ""}`);
      signIn.hidden = action !== "signin";
      join.hidden = recheck.hidden = action !== "join";
      connect.hidden = action !== "connect";
      signIn.disabled = join.disabled = recheck.disabled = connect.disabled = signing;
      signRow.hidden = signIn.hidden && join.hidden && connect.hidden;
      // Each step's mark: done, the one to do now, or still ahead.
      const marks = [w.own.length > 0, signedIn && w.own.length > 0, w.paired.length > 0 && !w.found.length && !w.asks.length];
      const now = known && !signedIn ? 1 : marks.findIndex((done) => !done);
      [one, two, three].forEach((part, index) => {
        part.item.dataset.state = marks[index] ? "done" : index === now ? "now" : "ahead";
        part.num.textContent = marks[index] ? "✓" : String(index + 1);
      });
      // Step 3: what main sees now. Repainted only when it says something new,
      // so a watch renewal neither re-reads it aloud nor drops a focused Pair.
      const lines = [];
      if (!known) lines.push({ text: w.stage === "error" ? "" : "Looking for your PCs…" });
      else if (!signedIn) lines.push({ text: "Your other PC shows up here once both PCs are signed in." });
      else if (w.stage === "connecting") lines.push({ text: "Your other PC shows up here once this PC is connected." });
      else if (w.stage === "outdated") lines.push({ text: "The room service does not carry My PCs yet. It does once it is updated." });
      else if (w.stage === "nokeys") lines.push({ text: "Windows cannot keep this PC's keys safe, so it cannot pair." });
      else {
        for (const ask of w.asks) lines.push({ ask });
        for (const row of w.found.filter((pc) => !w.asks.some((ask) => ask.id === pc.id))) lines.push({ row, text: row.keysChanged ? `${row.name}'s keys changed. Pair it again:` : `Found ${row.name}:` });
        if (!lines.length) lines.push({ text: w.paired.length ? `Paired with ${names(w.paired)}. Waiting for another PC to sign in…` : "Waiting for your other PC to sign in…" });
      }
      const key = JSON.stringify(lines.map((line) => [line.text ?? null, line.ask ? [line.ask.id, line.ask.dir, line.ask.numbers] : null, line.row?.id ?? null]));
      if (key !== liveKey) {
        liveKey = key;
        // A Pair or Not mine pressed here goes with its line; the focus stays in the step.
        const focused = live.contains?.(document.activeElement);
        live.replaceChildren(...lines.filter((line) => line.ask || line.text).map((line) => {
          if (line.ask) return askView(line.ask, "pc-walk-line");
          const item = node("div", "pc-walk-line");
          item.append(node("span", "", line.text));
          if (line.row) {
            const pair = button("Pair", null, "primary pc-sync-run");
            pair.addEventListener("click", () => { void pairWith(line.row, true); });
            item.append(pair);
          }
          return item;
        }));
        if (focused) (walk.open ? live : walkHead).focus?.();
      }
      return w;
    }

    function rowView(row, now, result, power) {
      const item = node("li", "pc-fleet-row");
      item.dataset.pc = row.id;
      const state = row.heard?.state ?? null;
      // This PC is busy while its battery holds new work or it is not taking any.
      const selfBusy = row.self && (power.stage !== "ok" || state?.accepting === false);
      item.dataset.state = !row.online ? "offline" : row.why || selfBusy ? "busy" : "free";
      const name = node("strong", "", row.name);
      const kind = row.self ? "This PC" : !row.mine ? `lent to you by ${row.owner?.name || "a friend"}` : row.kind === "laptop" ? "laptop" : "desktop";
      const top = node("div", "pc-fleet-head");
      top.append(name, node("span", "muted", ` · ${kind}`));
      item.append(top);
      if (row.online && state) item.append(node("div", "pc-fleet-meters", meters(state)));
      const why = row.self ? (power.stage !== "ok" ? power.words : state?.accepting ? "Taking work" : null)
        : !row.online ? `Offline${row.lastSeen ? ` since ${ago(row.lastSeen, now)}` : ""}`
        : row.keysChanged ? "Its keys changed: pair again before it can send or take work"
        : !row.paired ? "Not paired yet"
        : row.why || "Taking work";
      if (why) item.append(node("div", "pc-fleet-why", why));
      const actions = node("div", "pc-sync-actions");
      if (row.self) {
        const rename = button("Rename", "pc-fleet-rename-open", "ghost mini pc-sync-run");
        rename.setAttribute("aria-controls", "pc-fleet-rename");
        rename.setAttribute("aria-expanded", String(!renameRow.hidden));
        rename.addEventListener("click", () => { if (renameRow.hidden) openRename(rename); else closeRename(); });
        renameOpener = rename;
        actions.append(rename);
      } else {
        if (row.online && (!row.paired || row.keysChanged) && (row.mine || row.lends)) {
          const pair = button("Pair");
          pair.addEventListener("click", () => { void pairWith(row); });
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
      }
      if (actions.children.length) item.append(actions);
      return item;
    }

    function openRename(opener) {
      renameRow.hidden = false;
      opener?.setAttribute("aria-expanded", "true");
      nameInput.value = last?.me?.name ?? nameInput.value;
      nameInput.focus?.();
      nameInput.select?.();
    }
    function closeRename() {
      renameRow.hidden = true;
      renameOpener?.setAttribute("aria-expanded", "false");
      renameOpener?.focus?.();
    }
    const saveName = () => {
      const name = nameInput.value.trim();
      if (!name) return;
      void save({ name }).then(() => { if (last?.ok) closeRename(); });
    };
    nameSave.addEventListener("click", saveName);
    nameCancel.addEventListener("click", closeRename);
    nameInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault?.(); saveName(); } });

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
      const w = paintWalk(result);
      if (!result.ok) { status.textContent = result.error === "unavailable" ? "My PCs is not in this build." : result.error || "My PCs could not be read."; return; }
      const now = Date.now();
      const all = Array.isArray(result.rows) ? result.rows : [];
      const others = all.filter((row) => !row.self);
      const online = others.filter((row) => row.online).length;
      const relay = result.relay ?? {};
      const power = { stage: "ok", reading: null, words: "", ...(result.power ?? {}) };
      const lines = { low: 20, stop: 10, ...(power.lines ?? {}) };
      status.textContent = !relay.linked ? "Sign in with Discord in Friends on each of your PCs to see them here."
        : relay.state === "ready" && !relay.carries ? "The relay does not carry My PCs yet. It does once it is updated."
        : relay.state !== "ready" ? "Connecting to the relay…"
        : !result.encryption ? "Windows cannot keep this PC's keys safe, so it cannot pair. Your other PCs still show here."
        : others.length ? `${others.length} other PC${others.length === 1 ? "" : "s"}, ${online} online.`
        : "No other PC yet. Sign in to Friends with the same Discord account on another PC.";
      stopBanner.hidden = power.stage !== "stopped";
      stopText.textContent = `Stopped at ${power.reading?.level ?? "low"}% battery. ${result.held ? `${result.held} task${result.held === 1 ? " was" : "s were"} stopped with progress saved and parked for your other PCs. ` : ""}Nothing runs here until you choose Continue.`;
      // The open walkthrough shows the asks between the owner's own PCs; the list keeps a friend's.
      asks.replaceChildren(...(result.asks ?? []).map((ask) => {
        const item = askView(ask, "pc-fleet-ask");
        item.hidden = walk.open && ask.relation !== "borrow";
        return item;
      }));
      rows.replaceChildren(...all.map((row) => rowView(row, now, result, power)));
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
      // A name being typed stays as it is until it is saved or cancelled.
      if (renameRow.hidden && document.activeElement !== nameInput) nameInput.value = result.me?.name ?? "";
      // Power and battery.
      stay.checked = result.stayOn === "always";
      powerNote.textContent = result.stayOn === "always" ? "Kept on" : "";
      const laptop = power.reading && !power.reading.error;
      batteryRow.hidden = batteryAbout.hidden = !laptop;
      if (document.activeElement !== lowInput) lowInput.value = String(lines.low);
      if (document.activeElement !== stopInput) stopInput.value = String(lines.stop);
      // This project: whether the owner's other PCs may take its work.
      const open = result.project;
      project.hidden = !open || !w.paired.length;
      share.disabled = !open?.github;
      share.checked = Boolean(open?.share);
      shareText.textContent = open ? `My other PCs may take ${open.name}'s work` : "Open a project to choose whether your other PCs may take its work";
      shareNote.textContent = !open ? "" : !open.github ? "This project has no GitHub repository, so its work stays on this PC."
        : `At most ${result.limits?.movedPerProject ?? 2} of its tasks are out on other PCs at once, and at most ${result.limits?.parkedPerProject ?? 3} handoffs wait on GitHub. Handoffs are branches of the project's repository, as visible as it is.`;
      const parked = result.handoffs?.list ?? [];
      handoffs.replaceChildren(...parked.map((row) => {
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
      handoffBox.hidden = !parked.length && !result.handoffs?.error;
      // Lend this PC to a friend.
      const lent = result.lend ?? [];
      lendNote.textContent = !lent.length ? "" : lent.length === 1 ? `Lent to ${lent[0].name}` : `Lent to ${lent.length} friends`;
      lends.replaceChildren(...lent.map((row) => {
        const item = node("li", "pc-fleet-lend");
        const auto = node("input");
        auto.type = "checkbox";
        auto.checked = row.auto === true;
        const autoLabel = node("label", "pc-sync-follow");
        autoLabel.append(auto, node("span", "", "Run without asking"));
        auto.addEventListener("change", () => { void save({ lend: lent.map((other) => (other.id === row.id ? { ...other, auto: auto.checked } : other)) }); });
        const stop = button("Stop lending");
        stop.addEventListener("click", () => { void save({ lend: lent.filter((other) => other.id !== row.id) }, `Stopping the lend to ${row.name}…`); });
        item.append(node("span", "", row.name), autoLabel, stop);
        return item;
      }));
      if (!lends.children.length) lends.append(node("li", "muted", "Not lent to anyone."));
      notes.replaceChildren(...(result.notes ?? []).map((note) => node("li", "", `${ago(note.at, now)} · ${note.text}`)));
      lately.hidden = !notes.children.length;
    }

    const save = (patch, label = "Saving…") => guard(label, async () => { const answer = await api.pcsSet(patch); paint(answer); return answer; });
    go.addEventListener("click", () => { void guard("Starting again…", async () => { const answer = await api.pcsContinue(); await refresh(); if (answer?.ok && answer.elsewhere) status.textContent = `${answer.elsewhere} task${answer.elsewhere === 1 ? " is" : "s are"} on another PC now; the rest run here again.`; return answer; }); });
    stay.addEventListener("change", () => { void save({ stayOn: stay.checked ? "always" : "working" }); });
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
          const lendTo = button("Lend to them");
          lendTo.addEventListener("click", () => {
            const next = [...(last?.lend ?? []).filter((row) => row.id !== person.id), { id: person.id, name: person.name, auto: false }];
            found.replaceChildren();
            findInput.value = "";
            void save({ lend: next }, `Lending this PC to ${person.name}…`);
          });
          item.append(" ", lendTo);
          return item;
        }));
        if (!found.children.length) found.append(node("li", "muted", answer?.ok === false ? "Friends could not be searched just now." : "Nobody by that name."));
      });
    });
    const onPage = () => box.isConnected !== false;
    if (typeof api?.onPcsEvent === "function") api.onPcsEvent((result) => { if (onPage()) paint(result); });
    // The watch lease: renewed while the card is on the page.
    const watch = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!onPage()) return;
      void refresh().catch(() => {});
      timer = setTimeout(watch, WATCH_MS);
    };
    paintWalk(null);
    if (typeof api?.pcsStatus !== "function") {
      status.textContent = "My PCs works in the desktop app.";
      walk.hidden = true;
      return box;
    }
    setTimeout(watch, 0);
    return box;
  }

  window.MefiPcFleet = { section, meters };
})();
