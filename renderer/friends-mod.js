// Friends › Moderation (window.MefiFriendsMod): the relay's moderator tools,
// shown only to moderators (the relay says who is one in hub-client me();
// every admin route checks again, so the page being shown grants nothing).
//
// One card, four parts:
//   - Looks like farming: members whose last 30 days of credits came mostly
//     from one person, or two people trading credits (relay GET
//     /v1/admin/credits/flags), each with Review.
//   - Reports: messages and projects members reported, with Resolve, Remove
//     project and Suspend the author for a week.
//   - Look someone up: a member search, then Review.
//   - Review: where a member's credits came from, how old each account is,
//     Take back (from one person, or everything in 30 days) and Suspend.
// Everything goes through main's hub:room channel (HUB_ROOM_METHODS mod*) and
// the hub:projects removeProject; text only; every action that changes
// something asks twice (MefiUi.arm).
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, id = null) => { const el = node("button", "ghost friends-mod-button", text); el.type = "button"; if (id) el.id = id; el.addEventListener("click", run); return el; };
  const confirmed = (label, armed, ask, run) => (window.MefiUi?.arm
    ? window.MefiUi.arm(button(label, () => {}), { run, armed })
    : button(label, () => { if (window.confirm?.(ask) !== false) run(); }));
  const bridge = () => window.mefiStudio;
  const RANKS = { spark: "Spark", ember: "Ember", flame: "Flame", comet: "Comet", star: "Star", nova: "Nova", void: "Void" };
  const HOLDS = { "read-only": "read-only or suspended", "new-account": "Discord account under 30 days old", "new-member": "under a week in the server", "forgot-me": "used Forget me in the last 30 days", unknown: "not signed in yet" };
  const DAY = 86_400_000;
  const age = (ms) => {
    if (!Number.isFinite(ms)) return "unknown";
    const days = Math.floor((Date.now() - ms) / DAY);
    return days < 1 ? "under a day" : days < 60 ? `${days} day${days === 1 ? "" : "s"}` : days < 730 ? `${Math.floor(days / 30)} months` : `${Math.floor(days / 365)} years`;
  };
  const why = (answer, fallback) => (answer?.error === "forbidden" ? "Only moderators can do that." : answer?.error === "rate-limited" ? "Slow down a moment, then try again." : fallback);

  // Whether this member is a moderator, as the relay last said (null: not known yet).
  let moderator = null;
  const listeners = new Set();
  async function learn() {
    const api = bridge();
    if (typeof api?.hubProjects !== "function" || typeof api?.hubStatus !== "function") return moderator;
    try {
      const hub = (await api.hubStatus())?.status;
      if (hub?.state !== "ready" || !hub.credits) return moderator;
      const me = await api.hubProjects("me");
      if (me?.ok) {
        const next = me.moderator === true;
        if (next !== moderator) { moderator = next; for (const fn of listeners) { try { fn(moderator); } catch {} } }
      }
    } catch { /* asked again next time Friends opens */ }
    return moderator;
  }
  const isMod = () => moderator === true;
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  function card() {
    const root = node("section", "friends-mod");
    root.id = "friends-mod";
    root.setAttribute("aria-labelledby", "friends-mod-title");
    const title = node("h4", "friends-mod-title", "Moderation");
    title.id = "friends-mod-title";
    const status = node("p", "friends-mod-status");
    status.id = "friends-mod-status";
    status.setAttribute("role", "status");
    const body = node("div", "friends-mod-body");
    root.append(title, status, body);
    const api = bridge();
    if (typeof api?.hubRoom !== "function") { status.textContent = "Moderation works in the desktop app."; root.dataset.state = "unavailable"; return root; }
    let flags = [], reports = [], found = [], review = null, query = "", busy = false, gone = false;
    const call = async (method, ...args) => { try { return await api.hubRoom(method, ...args); } catch { return { ok: false, error: "failed" }; } };
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
      const known = await learn();
      if (gone) return;
      if (!known) {
        root.dataset.state = "not-moderator";
        status.textContent = "Moderation is for the Void Engine moderators. Sign in with Discord in Friends first if you are one.";
        body.replaceChildren();
        return;
      }
      const [flagged, reported] = await Promise.all([call("modFlags"), call("modReports")]);
      if (gone) return;
      flags = flagged?.ok ? flagged.flags : [];
      reports = reported?.ok ? reported.reports : [];
      root.dataset.state = "ready";
      status.textContent = flagged?.ok || reported?.ok ? "" : "The relay did not answer. Try again in a moment.";
      paint();
    }

    function section(name, id, parts, empty) {
      const box = node("section", "friends-mod-section");
      box.id = id;
      box.append(node("h5", "friends-mod-heading", name));
      if (!parts.length && empty) box.append(node("p", "muted", empty));
      box.append(...parts);
      return box;
    }
    function row(text, meta, actions) {
      const item = node("div", "friends-mod-row");
      const words = node("div", "friends-mod-words");
      words.append(node("strong", "", text), node("span", "muted", meta));
      const tools = node("div", "friends-mod-actions");
      tools.append(...actions);
      item.append(words, tools);
      return item;
    }

    async function open(userId) {
      await guard("Reading their credits…", async () => {
        const answer = await call("modReview", userId);
        if (!answer?.ok) { status.textContent = answer?.error === "not-found" ? "That member hasn't signed in to Friends yet." : why(answer, "Their credits could not be read."); return; }
        review = answer;
        status.textContent = "";
        paint();
      });
    }

    function farming() {
      return section("Looks like farming", "friends-mod-flags", flags.map((flag) => row(
        flag.name,
        flag.why === "mutual"
          ? `${flag.total} credits in 30 days; trading credits with ${flag.mutual.map((other) => other.name).join(", ")}`
          : `${flag.total} credits in 30 days, ${flag.top.share}% from ${flag.top.name} (Discord account ${age(flag.top.accountCreatedAt)} old)`,
        [button("Review", () => { void open(flag.id); })],
      )), "Nothing looks like farming in the last 30 days.");
    }

    function reportList() {
      return section("Reports", "friends-mod-reports", reports.map((report) => {
        const tools = [];
        tools.push(confirmed("Resolve", "Mark it handled?", "Mark this report as handled?", () => guard("Resolving…", async () => {
          const answer = await call("modResolve", report.id);
          status.textContent = answer?.ok ? "Marked as handled." : why(answer, "It could not be resolved.");
          await load();
        })));
        if (report.kind === "project" && report.projectId) tools.push(confirmed("Remove project", "Take it off the hub?", "Take this project off the hub?", () => guard("Removing…", async () => {
          const answer = await api.hubProjects?.("removeProject", report.projectId);
          if (answer?.ok) await call("modResolve", report.id);
          status.textContent = answer?.ok ? "The project is off the hub." : why(answer, "It could not be removed.");
          await load();
        })));
        if (report.author) tools.push(confirmed(`Suspend ${report.author.name} for a week`, "Suspend them?", `Suspend ${report.author.name} for 7 days?`, () => guard("Suspending…", async () => {
          const answer = await call("modSuspend", report.author.id, 7 * 24 * 60);
          status.textContent = answer?.ok ? `${report.author.name} is suspended for 7 days.` : why(answer, "The suspension did not go through.");
        })));
        const what = report.kind === "project" ? "Project" : report.verified ? "Message (signed copy)" : "Message";
        return row(`${what}: ${report.reason}`, `${report.text ? `“${report.text.slice(0, 200)}” · ` : ""}reported by ${report.reporter?.name ?? "a member"}${report.author ? ` · by ${report.author.name}` : ""}`, tools);
      }), "No open reports.");
    }

    function lookup() {
      const box = node("div", "friends-mod-lookup");
      const input = node("input", "friends-mod-search");
      input.type = "search";
      input.id = "friends-mod-search";
      input.placeholder = "A member's name";
      input.setAttribute("aria-label", "Look someone up by name");
      input.value = query;
      const go = button("Look up", () => guard("Looking…", async () => {
        query = input.value.trim();
        if (!query) return;
        const answer = await call("searchMembers", query);
        found = answer?.ok ? answer.members : [];
        status.textContent = answer?.ok ? (found.length ? "" : "Nobody by that name has signed in.") : why(answer, "The search did not work.");
        paint();
      }), "friends-mod-lookup");
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); go.click(); } });
      box.append(input, go);
      return section("Look someone up", "friends-mod-people", [box, ...found.map((person) => row(person.name, person.id, [button("Review", () => { void open(person.id); })]))], "");
    }

    function reviewPanel() {
      if (!review) return null;
      const who = review.member;
      const parts = [];
      const standing = who.standing.ok ? "Can give and earn credits." : `Earns nothing: ${HOLDS[who.standing.reason] ?? "not in good standing"}.`;
      parts.push(node("p", "friends-mod-facts", `Discord account ${age(who.accountCreatedAt)} old · in the server ${age(who.joinedAt)} · ${review.credits.balance} credits, ${review.credits.lifetime} lifetime (${RANKS[review.credits.rank] ?? review.credits.rank}) · ${standing}`));
      parts.push(node("p", "muted", review.total ? `${review.total} credits in the last ${review.days} days came from:` : `No credits in the last ${review.days} days.`));
      for (const giver of review.givers) {
        const tools = giver.id ? [confirmed(`Take back ${giver.amount}`, "Take them back?", `Take back the ${giver.amount} credits ${giver.name} gave in the last ${review.days} days?`, () => guard("Taking back…", async () => {
          const answer = await call("modRevoke", who.id, { from: giver.id, days: review.days });
          status.textContent = answer?.ok ? `Took back ${answer.revoked} credits from ${giver.name}.` : why(answer, "That did not go through.");
          await open(who.id);
        }))] : [];
        parts.push(row(`${giver.name}: ${giver.amount} credits (${giver.share}%)`, `${giver.events} plays or stars${Number.isFinite(giver.accountCreatedAt) ? ` · Discord account ${age(giver.accountCreatedAt)} old` : ""}`, tools));
      }
      const tools = node("div", "friends-mod-actions");
      if (review.total) tools.append(confirmed(`Take back all ${review.total}`, "Take all of them back?", `Take back every credit ${who.name} earned in the last ${review.days} days?`, () => guard("Taking back…", async () => {
        const answer = await call("modRevoke", who.id, { days: review.days });
        status.textContent = answer?.ok ? `Took back ${answer.revoked} credits.` : why(answer, "That did not go through.");
        await open(who.id);
      })));
      for (const [label, minutes] of [["Suspend 1 day", 24 * 60], ["Suspend 7 days", 7 * 24 * 60], ["Lift a suspension", 0]]) {
        tools.append(confirmed(label, minutes ? "Suspend them?" : "Lift it?", minutes ? `${label} for ${who.name}?` : `Lift ${who.name}'s suspension?`, () => guard(minutes ? "Suspending…" : "Lifting…", async () => {
          const answer = await call("modSuspend", who.id, minutes);
          status.textContent = answer?.ok ? (minutes ? `${who.name} is suspended.` : `${who.name}'s suspension is lifted.`) : why(answer, "That did not go through.");
          await open(who.id);
        })));
      }
      tools.append(button("Close", () => { review = null; paint(); }, "friends-mod-close-review"));
      parts.push(tools);
      return section(`Review: ${who.name}`, "friends-mod-review", parts, "");
    }

    function paint() {
      body.replaceChildren(...[reviewPanel(), farming(), reportList(), lookup()].filter(Boolean));
    }
    root.dispose = () => { gone = true; };
    void load();
    return root;
  }

  window.MefiFriendsMod = { card, learn, isMod, subscribe };
})();
