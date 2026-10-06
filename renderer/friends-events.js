// Friends › Events (window.MefiFriendsEvents): the community events the relay
// runs by itself (relay/src/events.mjs), with nobody to organise them, and
// how credits come from building and playing together, never from bringing
// people in (Discord's platform rules forbid invite rewards).
//
// One card, five parts:
//   - This week's Build Jam: the theme, when entries and votes close, the
//     prize pot, your entry (one of your shared projects) and every entry
//     with Play and Vote. A vote needs a two-minute play first, counts only
//     from members in good standing, and stays hidden until Monday.
//   - The co-work hour: when the next one starts, Join (Studio keeps the
//     room open for the hour, which is what counts) and how many are there.
//   - Build together: credits for working in a co-work room with friends,
//     and the way to bring one (a room's join code, in Rooms).
//   - Last week's results.
//   - Today's community pot in one line.
// Everything goes through main's hub:events channel (HUB_EVENT_METHODS) and
// hub:projects (me, playProject); text only.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, id = null, cls = "ghost friends-events-button") => { const el = node("button", cls, text); el.type = "button"; if (id) el.id = id; el.addEventListener("click", run); return el; };
  const bridge = () => window.mefiStudio;
  const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  // "3 days", "5 hours", "20 minutes": how long until `ms`, to the nearest whole unit, never under a minute.
  function timeLeft(ms, now = Date.now()) {
    const gap = Math.max(0, ms - now);
    if (gap >= 2 * DAY) return plural(Math.round(gap / DAY), "day");
    if (gap >= 2 * HOUR) return plural(Math.round(gap / HOUR), "hour");
    return plural(Math.max(1, Math.round(gap / MINUTE)), "minute");
  }
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const weekday = (ms) => new Date(ms).toLocaleDateString([], { weekday: "long" });
  const PLACES = ["", "1st", "2nd", "3rd"];
  const REASONS = {
    "entries-closed": "Entries closed on Saturday. You can still play and vote until Monday.",
    "not-yours": "Enter one of your own shared projects.",
    project: "That project is no longer on the hub.",
    "play-first": "Play it for two minutes first, then vote.",
    "votes-used": "You have used your three votes. Take one back to vote for another.",
    standing: "Votes count from members in good standing: a Discord account 30 days old and a week in the server.",
    self: "You cannot vote for your own entry.",
    entry: "That entry was withdrawn.",
    "voting-closed": "Voting has closed. The results are below.",
    over: "That co-work hour has ended.",
    "room-full": "That co-work hour is full.",
    removed: "You cannot join that room right now.",
    locked: "That room is locked.",
    unsupported: "This room service has no events yet.",
    "rate-limited": "Slow down a moment, then try again.",
    "read-only": "Your account is read-only in the server right now.",
    paused: "The room service is paused right now.",
    offline: "Not connected to the room service.",
  };
  const why = (answer, fallback) => REASONS[answer?.reason] || REASONS[answer?.error] || fallback;
  const EARNED = { together: "for building together today", cowork: "for the co-work hour", jam: "from the Build Jam" };
  let current = null;
  let hearing = false;

  function listen(api) {
    if (hearing || typeof api?.onHubEvent !== "function") return;
    hearing = true;
    api.onHubEvent((event) => { if (current) current.hear(event); });
  }

  function card() {
    const root = node("section", "friends-events");
    root.id = "friends-events";
    root.setAttribute("aria-labelledby", "friends-events-title");
    const title = node("h4", "friends-events-title", "Events");
    title.id = "friends-events-title";
    const status = node("p", "friends-events-status", "Checking the room service…");
    status.id = "friends-events-status";
    status.setAttribute("role", "status");
    const body = node("div", "friends-events-body");
    root.append(title, status, body);
    const api = bridge();
    if (typeof api?.hubEvents !== "function" || typeof api?.hubStatus !== "function") {
      status.textContent = "Events work in the desktop app.";
      root.dataset.state = "unavailable";
      return root;
    }
    listen(api);
    current?.dispose();
    let page = null, me = null, choice = "", busy = false, gone = false, ticking = null;
    const call = async (method, ...args) => { try { return await api.hubEvents(method, ...args); } catch { return { ok: false, error: "failed" }; } };
    const guard = async (label, work) => {
      if (busy) return;
      busy = true;
      root.setAttribute("aria-busy", "true");
      if (label) status.textContent = label;
      try { await work(); } catch { status.textContent = "That did not work. Try again."; }
      busy = false;
      root.removeAttribute("aria-busy");
    };

    async function load() {
      let hub = null;
      try { hub = (await api.hubStatus())?.status; } catch { hub = null; }
      if (gone) return;
      if (!hub?.configured) { root.dataset.state = "not-configured"; status.textContent = "Events need the room service, which this copy of Studio has no address for."; body.replaceChildren(); return; }
      if (!hub.linked) {
        root.dataset.state = "not-linked";
        const gate = window.MefiFriendsFront?.gate?.({ onSignedIn: () => { void load(); } });
        status.textContent = gate ? "" : "Sign in with Discord in Friends to join events.";
        body.replaceChildren(...(gate ? [gate] : []));
        return;
      }
      if (hub.state !== "ready") {
        root.dataset.state = hub.state || "off";
        status.textContent = hub.state === "connecting" ? "Connecting to the room service…" : "Connect to see this week's events.";
        body.replaceChildren(button("Connect", () => guard("Connecting…", async () => {
          const answer = await api.hubConnect?.();
          if (answer?.status?.state === "ready" || answer?.ok) await load(); else status.textContent = "Not connected yet. Try again in a moment.";
        }), "friends-events-connect"));
        return;
      }
      if (!hub.events) { root.dataset.state = "unsupported"; status.textContent = REASONS.unsupported; body.replaceChildren(); return; }
      root.dataset.state = "ready";
      await refresh();
    }

    async function refresh() {
      const [events, mine] = await Promise.all([call("events"), Promise.resolve(api.hubProjects?.("me")).catch(() => null)]);
      if (gone) return;
      if (!events?.ok) { status.textContent = why(events, "The room service did not answer. Try again in a moment."); return; }
      // hub-client's eventsPage() fills every part; a partial answer still draws.
      page = {
        jam: events.jam ? { ...events.jam, entries: events.jam.entries ?? [], you: { entered: null, votesLeft: 0, ...(events.jam.you ?? {}) } } : null,
        lastJam: events.lastJam ? { ...events.lastJam, results: events.lastJam.results ?? [] } : null,
        cowork: events.cowork ?? null,
        nextCowork: events.nextCowork ?? null,
        together: { ticks: 0, needed: 3, amount: 4, ...(events.together ?? {}) },
        budget: { budget: 0, paid: 0, left: 0, active: 0, ...(events.budget ?? {}) },
      };
      if (mine?.ok) me = mine;
      if (status.textContent === "Checking the room service…") status.textContent = "";
      paint();
    }

    function section(name, id, parts) {
      const box = node("section", "friends-events-section");
      box.id = id;
      box.append(node("h5", "friends-events-heading", name), ...parts.filter(Boolean));
      return box;
    }
    function row(main, meta, actions = []) {
      const item = node("div", "friends-events-row");
      const words = node("div", "friends-events-words");
      words.append(main, node("span", "muted friends-events-meta", meta));
      const tools = node("div", "friends-events-actions");
      tools.append(...actions);
      item.append(words, tools);
      return item;
    }

    function jamPart() {
      const jam = page.jam;
      if (!jam) return section("Build Jam", "friends-events-jam", [node("p", "muted", "This week's jam is not open yet.")]);
      const now = Date.now();
      const when = jam.phase === "entries"
        ? `Enter until ${weekday(jam.entriesUntil)} (${timeLeft(jam.entriesUntil, now)} left). Play and vote until ${weekday(jam.endsAt)}.`
        : jam.phase === "voting" ? `Entries are closed. Play and vote until ${weekday(jam.endsAt)} (${timeLeft(jam.endsAt, now)} left).` : "The results are being counted.";
      const lead = node("p", "friends-events-lead", when);
      const pot = node("p", "muted friends-events-pot", `Prize pot so far: ${plural(jam.pool, "credit")}. It grows on quiet days and shrinks on busy ones. Next week's theme: ${jam.nextTheme || "a surprise"}.`);
      const parts = [lead, pot];

      // Your entry: one of your shared projects.
      const yours = me?.projects ?? [];
      const entered = jam.entries.find((entry) => entry.mine);
      if (jam.phase === "entries") {
        if (entered) {
          parts.push(row(node("strong", "", `Your entry: ${entered.project?.title ?? "your project"}`), `${plural(entered.players, "member")} played it so far.`, [
            button("Withdraw", () => guard("Withdrawing…", async () => {
              const answer = await call("leaveEvent", jam.id);
              status.textContent = answer?.ok ? "Your entry is withdrawn." : why(answer, "It could not be withdrawn.");
              await refresh();
            }), "friends-events-withdraw"),
          ]));
        } else if (yours.length) {
          const pick = node("select", "friends-events-pick");
          pick.id = "friends-events-pick";
          pick.setAttribute("aria-label", "Which of your projects to enter");
          for (const project of yours) {
            const option = node("option", "", project.title);
            option.value = project.id;
            pick.append(option);
          }
          if (choice && yours.some((project) => project.id === choice)) pick.value = choice;
          pick.addEventListener("change", () => { choice = pick.value; });
          const enter = button("Enter it", () => guard("Entering…", async () => {
            const answer = await call("enterEvent", jam.id, pick.value);
            status.textContent = answer?.ok ? "You are in this week's jam. Friends can play it and vote now." : why(answer, "It could not be entered.");
            await refresh();
          }), "friends-events-enter", "friends-events-primary");
          const box = node("div", "friends-events-enter-row");
          box.append(pick, enter);
          parts.push(box);
        } else {
          parts.push(node("p", "muted", "Share a project in the Project hub, then enter it here."),
            button("Open the Project hub", () => window.MefiNav?.go?.("friends-page", { place: "hub" }), "friends-events-to-hub"));
        }
      }

      // The entries: Play, then Vote.
      const list = node("div", "friends-events-entries");
      list.id = "friends-events-entries";
      if (!jam.entries.length) list.append(node("p", "muted", "No entries yet. Be the first."));
      for (const entry of jam.entries) {
        const name = node("strong", "", entry.project?.title ?? "A project");
        const meta = `by ${entry.user.name}${entry.project?.host ? ` · ${entry.project.host}` : ""} · ${plural(entry.players, "player")}`;
        const tools = [];
        if (!entry.mine && entry.project && jam.phase !== "results") {
          tools.push(button(entry.played ? "Play again" : "Play", () => guard("Opening it…", async () => {
            const answer = await api.hubProjects?.("playProject", entry.project.id);
            status.textContent = answer?.ok ? "Play it for two minutes. Studio counts it, then you can vote." : why(answer, "It could not be opened.");
          })));
          const vote = button(entry.voted ? "Voted" : "Vote", () => guard(entry.voted ? "Taking your vote back…" : "Voting…", async () => {
            const answer = await call("voteEvent", jam.id, entry.user.id, !entry.voted);
            status.textContent = answer?.ok ? (entry.voted ? "Vote taken back." : `Voted for ${entry.project?.title ?? "it"}.`) : why(answer, "The vote did not go through.");
            await refresh();
          }), null, entry.voted ? "friends-events-primary" : "ghost friends-events-button");
          vote.setAttribute("aria-pressed", entry.voted ? "true" : "false");
          if (!entry.played && !entry.voted) {
            vote.disabled = true;
            vote.title = REASONS["play-first"];
          }
          tools.push(vote);
        }
        list.append(row(name, meta, tools));
      }
      parts.push(list);
      if (jam.phase !== "results") parts.push(node("p", "muted friends-events-fine", `${plural(jam.you.votesLeft, "vote")} left. Votes stay hidden until Monday, and count only for entries you played.`));
      return section(`Build Jam: ${jam.theme || "this week"}`, "friends-events-jam", parts);
    }

    function coworkPart() {
      const hour = page.cowork;
      const now = Date.now();
      const parts = [];
      if (!hour) {
        parts.push(node("p", "", page.nextCowork ? `The next co-work hour starts at ${clock(page.nextCowork)} (in ${timeLeft(page.nextCowork, now)}).` : "No co-work hour is planned right now."));
        parts.push(node("p", "muted", "Three a day. Join, keep Studio open and work on anything; everyone who stays with others earns credits."));
        return section("Co-work hour", "friends-events-cowork", parts);
      }
      const lead = hour.started
        ? `On now until ${clock(hour.endsAt)} · ${plural(hour.here, "member")} here.`
        : `Starts at ${clock(hour.startsAt)} (in ${timeLeft(hour.startsAt, now)}) · the room is open.`;
      parts.push(node("p", "friends-events-lead", lead));
      if (hour.joined) {
        parts.push(node("p", "muted", `You are in. Keep Studio open: you are counted at 15, 35 and 55 minutes past the start. Seen ${hour.checks} of ${hour.checksNeeded} times needed for ${plural(hour.amount, "credit")}.`));
        if (hour.roomId) parts.push(button("Open the room", () => window.MefiNav?.go?.("friends-page", { place: "rooms", room: hour.roomId }), "friends-events-open-room"));
      } else {
        parts.push(button("Join the co-work hour", () => guard("Joining…", async () => {
          const answer = await call("joinEvent", hour.id);
          status.textContent = answer?.ok ? "You are in. Keep Studio open and work on anything." : why(answer, "It could not be joined.");
          await refresh();
        }), "friends-events-join", "friends-events-primary"));
        parts.push(node("p", "muted", `Everyone seen at two of the three looks, with at least one other member, earns ${plural(hour.amount, "credit")}.`));
      }
      return section("Co-work hour", "friends-events-cowork", parts);
    }

    function togetherPart() {
      const together = page.together;
      const parts = [
        node("p", "", `Work in a co-work room with a friend. After about half an hour together you each earn ${plural(together.amount, "credit")}, once a day.`),
        node("p", "muted", `Today: ${together.ticks} of ${together.needed} looks together.`),
        node("p", "muted friends-events-fine", "To bring a friend, make a co-work room in Rooms and send them its join code. Credits come from building together, never from inviting."),
        button("Go to Rooms", () => window.MefiNav?.go?.("friends-page", { place: "rooms" }), "friends-events-to-rooms"),
      ];
      return section("Build together", "friends-events-together", parts);
    }

    function resultsPart() {
      const last = page.lastJam;
      if (!last) return null;
      const parts = [node("p", "muted", `${last.theme || "Last week"} · a pot of ${plural(last.pool, "credit")}.`)];
      const places = last.results.filter((payout) => payout.place).sort((a, b) => a.place - b.place);
      const showcase = last.results.filter((payout) => !payout.place);
      if (!places.length && !showcase.length) parts.push(node("p", "muted", "No entry had enough votes or players."));
      for (const payout of places) parts.push(row(node("strong", "", `${PLACES[payout.place]} ${payout.name}`), `${plural(payout.paid ?? payout.amount, "credit")}`));
      if (showcase.length) parts.push(node("p", "muted", `Played by three or more, ${plural(showcase[0].amount, "credit")} each: ${showcase.map((payout) => payout.name).join(", ")}.`));
      return section("Last week's jam", "friends-events-results", parts);
    }

    function budgetPart() {
      const budget = page.budget;
      const line = node("p", "muted friends-events-budget",
        `Today the community can still earn ${plural(budget.left, "credit")} from co-working (a pot of 200 plus 25 for each of the ${plural(budget.active, "member")} active this week). Plays and stars always pay the same.`);
      line.id = "friends-events-budget";
      return line;
    }

    function paint() {
      if (!page) return;
      body.replaceChildren(...[jamPart(), coworkPart(), togetherPart(), resultsPart(), budgetPart()].filter(Boolean));
    }

    function hear(event) {
      if (root.isConnected === false) { dispose(); return; }
      if (event?.type === "credits" && EARNED[event.reason] && event.delta > 0) {
        status.textContent = `+${plural(event.delta, "credit")} ${EARNED[event.reason]}.`;
        void refresh();
      } else if (event?.type === "played") {
        status.textContent = event.counted ? "Play counted. You can vote for it now." : "Play noted.";
        void refresh();
      } else if (event?.type === "status") void load();
    }
    function dispose() {
      gone = true;
      if (ticking) clearInterval(ticking);
      if (current === handle) current = null;
    }
    const handle = { hear, dispose };
    current = handle;
    root.dispose = dispose;
    // The countdowns move while the page is up, once a minute, and only then; never under a control in use.
    ticking = setInterval(() => {
      if (root.isConnected === false) dispose();
      else if (!busy && !root.contains?.(document.activeElement)) paint();
    }, MINUTE);
    void load();
    return root;
  }

  window.MefiFriendsEvents = { card, timeLeft };
})();
