// Friends › Moderation (window.MefiFriendsMod): the relay's moderator tools,
// shown only to moderators (the relay says who is one in hub-client me();
// every admin route checks again, so the page being shown grants nothing).
//
// One card, seven parts:
//   - Looks like farming: members whose last 30 days of credits came mostly
//     from one person, or two people trading credits (relay GET
//     /v1/admin/credits/flags), each with Review. A member who used Forget me
//     since still shows as the giver they were, under no name.
//   - Credits on hold: when more than 3 newcomers (their first 30 days in the
//     server) pay one member in a week, what the rest would pay waits here,
//     by member and by newcomer, with how old each account is; Pay or Drop
//     (relay /v1/admin/credits/held).
//   - Build Jam: the jam waiting for its day of review (else this week's),
//     each entry in its place now with every vote, whether it counts and why
//     not, and each voter's account age, join date and batch (accounts made
//     and joined together count once); Don't count a voter, Remove an entry,
//     Pay the prizes now, Hold the prizes (relay GET /v1/admin/jam).
//   - Reports: messages, projects and Shop style packs members reported, with
//     Resolve, Remove project or Remove pack, and Suspend the author for a
//     week. A pack report comes as kind "shop" with its packId (the relay
//     keeps it as room "shop"); it is named from what the Shop has read.
//   - Look someone up: a member search, then Review.
//   - Review: where a member's credits came from, how old each account is,
//     Take back (from one person, one who used Forget me since, or
//     everything in 30 days) and Suspend.
//   - Rewards: switch a kind of reward, the jam's prizes or featuring off for
//     everyone while a new trick is looked into, and back on; the jam's day
//     of review and its one-vote-per-batch rule too, should one misfire
//     (relay /v1/admin/credits/switches).
// Everything goes through main's hub:room channel (HUB_ROOM_METHODS mod*),
// the hub:projects removeProject and the hub:shop modShopRemove; text only;
// every action that changes something asks twice (MefiUi.arm).
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run, id = null) => { const el = node("button", "ghost friends-mod-button", text); el.type = "button"; if (id) el.id = id; el.addEventListener("click", run); return el; };
  const confirmed = (label, armed, ask, run, id = null) => (window.MefiUi?.arm
    ? window.MefiUi.arm(button(label, () => {}, id), { run, armed })
    : button(label, () => { if (window.confirm?.(ask) !== false) run(); }, id));
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
  // The switches (relay credits.mjs SWITCHES), in the page's order, with what each one pays for.
  const SWITCHES = [
    ["plays", "Plays", "Playing someone's project pays its maker and the player."],
    ["stars", "Stars", "A star pays the project's maker."],
    ["together", "Building together", "Members in a co-work room together earn once a day."],
    ["cowork", "Co-work hours", "Staying for a co-work hour pays everyone who stayed."],
    ["jam", "Build Jam prizes", "Off holds the prizes of a jam that closed until it is back on. Nothing is lost."],
    ["sales", "Shop sales", "A style pack's maker earns a share of what it sold for."],
    ["featuring", "Featuring", "Members spend credits to put a project at the top for a day."],
    ["review", "Build Jam review day", "A closed jam waits a day for a look before its prizes pay. Off, they pay at once."],
    ["batches", "One vote per batch", "Jam votes from accounts made and brought in together count once. Off, each counts."],
  ];
  // Why a jam vote counts for nothing, or nothing more (relay events.mjs VOTE_WHYS).
  const VOTE_WHY = {
    "no-entry": "the entry left the jam",
    standing: "not in good standing",
    self: "their own entry",
    "not-played": "did not play it during the jam",
    "own-batch": "an account made and joined together with the entrant's",
    "same-batch": "counted once with accounts made and joined together with it",
  };
  const PLACE = ["", "1st", "2nd", "3rd"];
  const moment = (ms) => new Date(ms).toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" });
  const dateOf = (ms) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "long" });
  // A reported Shop style pack: hub-client hands it over as kind "shop" with its packId (the relay keeps it as room
  // "shop" with the pack's id as its message). Its name is the report's own, or the one the Shop last read
  // (friends-shop.js packName).
  function shopPack(report) {
    const shop = report?.kind === "shop" || report?.roomId === "shop";
    const id = shop ? report.packId ?? report.messageId ?? null : null;
    if (typeof id !== "string" || !id) return null;
    const name = typeof report.packName === "string" && report.packName ? report.packName : window.MefiShop?.packName?.(id) ?? null;
    return { id, name };
  }

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
    let flags = [], reports = [], found = [], review = null, query = "", busy = false, gone = false, switches = null, jam = null, held = null;
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
      const [flagged, reported, switched, jammed, holding] = await Promise.all([call("modFlags"), call("modReports"), call("modSwitches"), call("modJam"), call("modHeld")]);
      if (gone) return;
      flags = flagged?.ok ? flagged.flags : [];
      reports = reported?.ok ? reported.reports : [];
      // A relay from before the switches, the jam's review or holds answers none of them: those parts stay away.
      switches = switched?.ok ? switched.off : null;
      jam = jammed?.ok ? jammed.jam : null;
      held = holding?.ok ? holding.holds : null;
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
          : flag.top.forgotten
            ? `${flag.total} credits in 30 days, ${flag.top.share}% from ${flag.top.name}`
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
        // A Shop style pack (kind "shop"): take it out of the Shop; members who got it lose it. The relay resolves the
        // pack's open reports with it.
        const pack = shopPack(report);
        if (pack && typeof api.hubShop === "function") tools.push(confirmed("Remove pack", "Take it out of the Shop?", `Take ${pack.name ?? "this pack"} out of the Shop? Members who got it lose it.`, () => guard("Removing…", async () => {
          // A report's reason may run to 500 characters over several lines; a removal's is one line of 200 at most.
          const reason = String(report.reason ?? "").replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200).trim();
          const answer = await api.hubShop("modShopRemove", pack.id, reason ? { reason } : {});
          status.textContent = answer?.ok ? "The pack is out of the Shop." : why(answer, "It could not be removed.");
          await load();
        })));
        if (report.author) tools.push(confirmed(`Suspend ${report.author.name} for a week`, "Suspend them?", `Suspend ${report.author.name} for 7 days?`, () => guard("Suspending…", async () => {
          const answer = await call("modSuspend", report.author.id, 7 * 24 * 60);
          status.textContent = answer?.ok ? `${report.author.name} is suspended for 7 days.` : why(answer, "The suspension did not go through.");
        })));
        const what = report.kind === "project" ? "Project" : pack || report.roomId === "shop" ? `Style pack${pack?.name ? ` “${pack.name}”` : ""}` : report.verified ? "Message (signed copy)" : "Message";
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
        parts.push(row(`${giver.name}: ${giver.amount} credits (${giver.share}%)`, `${giver.events} plays or stars${giver.forgotten ? " · they used Forget me since" : Number.isFinite(giver.accountCreatedAt) ? ` · Discord account ${age(giver.accountCreatedAt)} old` : ""}`, tools));
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

    // Credits on hold: what a wave of newcomers would have paid a member, by member and by newcomer. Pay it if it looks
    // real, drop it if it looks like one person's accounts; nobody deciding, it drops after 30 days.
    async function decideHeld(member, action, giver) {
      await guard(action === "release" ? "Paying…" : "Dropping…", async () => {
        const answer = await call("modHeldDecide", member.id, action, giver?.id ?? null);
        await load();
        status.textContent = answer?.ok
          ? action === "release" ? `Paid ${member.name} ${answer.total} credits.` : `Dropped ${answer.total} credits held for ${member.name}.`
          : why(answer, "That did not go through.");
      });
    }
    function heldPanel() {
      if (!held) return null;
      const parts = [node("p", "muted", "When more than 3 members in their first 30 days in the server pay the same member in a week, what the rest would pay waits here. Pay it if it looks real; drop it if it looks like one person's accounts. Nobody deciding, it drops after 30 days.")];
      for (const hold of held) {
        const who = hold.member;
        parts.push(row(`${who.name}: ${hold.total} credits on hold`, `from ${hold.givers.length} newcomer${hold.givers.length === 1 ? "" : "s"}${Number.isFinite(hold.dropsAt) ? ` · drops on ${dateOf(hold.dropsAt)}` : ""}`, [
          confirmed(`Pay ${hold.total}`, "Pay them?", `Pay ${who.name} the ${hold.total} credits on hold?`, () => decideHeld(who, "release", null), `friends-mod-held-pay-${who.id}`),
          confirmed("Drop them", "Drop them?", `Drop the ${hold.total} credits on hold for ${who.name}? They never pay.`, () => decideHeld(who, "drop", null), `friends-mod-held-drop-${who.id}`),
          button("Review", () => { void open(who.id); }),
        ]));
        for (const giver of hold.givers) {
          const item = row(`From ${giver.name}: ${giver.amount}`, `Discord account ${age(giver.accountCreatedAt)} old · in the server ${age(giver.joinedAt)} · ${giver.events} play${giver.events === 1 ? "" : "s"}, stars or sales`, [
            confirmed(`Pay ${giver.amount}`, "Pay these?", `Pay ${who.name} the ${giver.amount} credits ${giver.name} would have paid?`, () => decideHeld(who, "release", giver), `friends-mod-held-pay-${who.id}-${giver.id}`),
            confirmed("Drop", "Drop these?", `Drop the ${giver.amount} credits ${giver.name} would have paid ${who.name}?`, () => decideHeld(who, "drop", giver), `friends-mod-held-drop-${who.id}-${giver.id}`),
          ]);
          item.className += " friends-mod-voter";
          parts.push(item);
        }
      }
      return section("Credits on hold", "friends-mod-held", held.length ? parts : [], "Nothing is on hold.");
    }

    // The Build Jam to look at: while voting runs, and above all in the day after it closes, before the prizes pay.
    function jamPanel() {
      if (!jam) return null;
      const parts = [];
      const lead = jam.status === "review"
        ? (jam.held ? "Voting has closed. The prizes are held until you let them pay." : `Voting has closed. The prizes pay by themselves ${jam.resultsAt ? moment(jam.resultsAt) : "soon"} unless you hold them.`)
        : jam.status === "release" ? "The prizes are being paid." : `Voting runs until ${moment(jam.endsAt)}. Members can't see votes until the results.`;
      parts.push(node("p", "friends-mod-facts", `${lead} A pot of ${jam.pool} credits.`));
      if (jam.entries.some((entry) => entry.user.batch || entry.voters.some((voter) => voter.batch))) {
        parts.push(node("p", "muted", "A batch letter marks Discord accounts made within 3 days of each other that joined the server within 12 hours of each other, most likely one person's. Their votes count once, and never for their own batch."));
      }
      const tools = node("div", "friends-mod-actions");
      if (jam.status === "review" && !jam.held) tools.append(confirmed("Pay the prizes now", "Pay now?", `Pay the prizes of the "${jam.theme}" jam now?`, () => guard("Paying…", async () => {
        const answer = await call("modJamRelease", jam.id);
        await load();
        status.textContent = answer?.ok ? "The prizes are on their way." : why(answer, "That did not go through.");
      }), "friends-mod-jam-release"));
      if (jam.status === "review" || jam.status === "release" || switches?.includes("jam")) {
        const held = switches?.includes("jam") === true;
        tools.append(confirmed(held ? "Let the prizes pay" : "Hold the prizes", held ? "Let them pay?" : "Hold them?", held ? "Let the jam's prizes pay?" : "Hold the jam's prizes until you let them pay?", () => guard(held ? "Letting them pay…" : "Holding them…", async () => {
          const answer = await call("modSwitch", "jam", held);
          await load();
          status.textContent = answer?.ok ? (held ? "The prizes will pay." : "The prizes are held.") : why(answer, "That did not go through.");
        }), "friends-mod-jam-hold"));
      }
      if (tools.children.length) parts.push(tools);
      for (const entry of jam.entries) {
        const title = entry.project?.title ?? "A project";
        const payout = jam.payouts.find((item) => item.userId === entry.user.id);
        const extra = entry.voters.length - entry.voters.filter((voter) => voter.counted).length;
        const meta = [
          `${entry.votes} vote${entry.votes === 1 ? "" : "s"} count${extra ? ` (${extra} more don't)` : ""}`,
          `${entry.players} player${entry.players === 1 ? "" : "s"}`,
          payout ? `${payout.place ? `${PLACE[payout.place]} place, ` : ""}${payout.amount} credits now` : "",
          entry.user.batch ? `batch ${entry.user.batch}` : "",
          entry.resting ? "resting from a place" : "",
        ].filter(Boolean).join(" · ");
        const actions = typeof api.hubEvents === "function" ? [confirmed("Remove from the jam", "Take it out?", `Take ${title} by ${entry.user.name} out of the jam?`, () => guard("Removing…", async () => {
          const answer = await api.hubEvents("removeEntry", jam.id, entry.user.id);
          await load();
          status.textContent = answer?.ok ? `${title} is out of the jam.` : why(answer, "It could not be removed.");
        }), `friends-mod-jam-remove-${entry.user.id}`)] : [];
        parts.push(row(`${title} by ${entry.user.name}`, meta, actions));
        for (const voter of entry.voters) {
          const facts = `Discord account ${age(voter.accountCreatedAt)} old · in the server ${age(voter.joinedAt)}${voter.batch ? ` · batch ${voter.batch}` : ""} · ${voter.counted ? "counts" : `doesn't count: ${VOTE_WHY[voter.why] ?? "not counted"}`}`;
          const item = row(`Vote from ${voter.name}`, facts, [confirmed(`Don't count ${voter.name}`, "Take their votes out?", `Take every vote ${voter.name} gave in this jam out, and keep them from voting in it again?`, () => guard("Taking their votes out…", async () => {
            const answer = await call("modJamVoid", jam.id, voter.id);
            await load();
            status.textContent = answer?.ok ? `${voter.name}'s votes no longer count in this jam.` : why(answer, "That did not go through.");
          }), `friends-mod-jam-void-${entry.user.id}-${voter.id}`)]);
          item.className += " friends-mod-voter";
          parts.push(item);
        }
      }
      return section(`Build Jam: ${jam.theme}`, "friends-mod-jam", parts, "");
    }

    // The switches: each kind of reward, the jam's prizes and featuring, on or off for everyone.
    function rewardSwitches() {
      if (!switches) return null;
      return section("Rewards", "friends-mod-switches", [
        node("p", "muted", "Switch a reward off while you look into a new trick. Members keep what they have, and it pays again once it is back on."),
        ...SWITCHES.map(([key, name, what]) => {
          const off = switches.includes(key);
          return row(`${name}: ${off ? "off" : "on"}`, what, [confirmed(off ? "Switch back on" : "Switch off", off ? "Turn it back on?" : "Turn it off?", off ? `Turn ${name} back on?` : `Turn ${name} off for everyone until you turn it back on?`, () => guard(off ? "Turning it on…" : "Turning it off…", async () => {
            const answer = await call("modSwitch", key, off);
            if (answer?.ok) switches = answer.off;
            status.textContent = answer?.ok ? `${name} ${off ? "is back on" : "is off"}.` : why(answer, "That did not go through.");
            paint();
          }), `friends-mod-switch-${key}`)]);
        }),
      ], "");
    }

    function paint() {
      body.replaceChildren(...[reviewPanel(), farming(), heldPanel(), jamPanel(), reportList(), lookup(), rewardSwitches()].filter(Boolean));
    }
    root.dispose = () => { gone = true; };
    void load();
    return root;
  }

  window.MefiFriendsMod = { card, learn, isMod, subscribe };
})();
