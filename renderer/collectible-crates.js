// Optional topic/budget crates. The service supplies every recipe and exact
// quote; the client cannot change creator odds, allocate credits or grant items.
(function () {
  "use strict";
  const sessions = new Map();
  const controllers = new Set();
  function notify(account) {
    for (const controller of controllers) {
      const actor = controller.context();
      if (actor.enabled && actor.account === account) controller.changed();
    }
  }
  const RARITIES = ["none", "common", "uncommon", "rare", "epic", "legendary"];
  const terminal = new Set(["quote-expired", "pool-changed", "terms-changed", "quote-consumed", "quote-unavailable", "recipe-unavailable", "quote-mismatch", "request-conflict", "owned", "own", "needs", "not-available", "gone"]);
  const newId = () => globalThis.crypto?.randomUUID?.() || `crate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  function create({ ui, call, context, changed, message, refreshOwned, reveal, errorWords }) {
    const { node, btn, field, input, select, title, empty, credits, chanceText } = ui;
    let disposed = false;
    const controller = { context, changed: () => { if (!disposed) changed(); } };
    controllers.add(controller);
    const current = () => {
      const value = context();
      if (!value.enabled || !value.account) return null;
      if (!sessions.has(value.account)) {
        if (sessions.size >= 2) sessions.delete(sessions.keys().next().value);
        sessions.set(value.account, { recipes: null, clockOffset: 0, topic: "", tier: "", optIn: false, quote: null, quoteRequest: null, openRequest: null,
          contributions: null, contributionIdentity: value.identity, contributionGeneration: 0, contributionCursors: new Set(), shown: 40, busy: false });
      }
      const data = sessions.get(value.account);
      if (data.contributionIdentity !== value.identity) { resetContributions(data); data.contributionIdentity = value.identity; }
      return data;
    };
    const redraw = () => { if (!disposed) notify(context().account); };
    const valid = (before) => { const now = context(); return !disposed && now.enabled && before.account === now.account && before.identity === now.identity; };
    async function send(action, payload, success) {
      const data = current(), before = context();
      if (!data || data.busy || disposed) return null;
      data.busy = true; message("Checking with the community service…"); redraw();
      try {
        const answer = await call(action, payload);
        if (!valid(before)) return null;
        if (answer?.ok) await success(answer, data, before);
        else message(errorWords(answer));
        return answer;
      } finally {
        data.busy = false;
        // The sending card may have unmounted. Current cards still need the
        // settled busy state, without accepting that old actor's response.
        notify(before.account);
      }
    }
    async function loadRecipes() {
      return send("crateRecipes", {}, (answer, data) => {
        data.recipes = answer; data.clockOffset = answer.now - Date.now();
        if (!answer.topics.some((entry) => entry.id === data.topic)) data.topic = answer.topics[0]?.id || "";
        if (!answer.tiers.some((entry) => entry.id === data.tier)) data.tier = answer.tiers[0]?.id || "";
        message(answer.recipes.length ? "Choose a topic and a credit budget, then review its exact quote." : "This service has no topic crates available yet.");
      });
    }
    const selectedRecipe = (data) => data.recipes?.recipes.find((entry) => entry.topicId === data.topic && entry.tierId === data.tier);
    function changeSelection(data) {
      // An uncertain opening must be recovered with its original key before a
      // different quote can be opened. Repainting never manufactures a new key.
      if (!data.openRequest) { data.quote = null; data.quoteRequest = null; }
      redraw();
    }
    async function quoteRecipe() {
      const data = current(), recipe = data && selectedRecipe(data);
      if (!recipe || !recipe.available || data.openRequest) return;
      if (!data.quoteRequest) data.quoteRequest = { recipeId: recipe.id, requestId: newId(), communityOptIn: data.optIn };
      const answer = await send("crateQuote", data.quoteRequest, (reply, live) => {
        live.quote = reply.quote; message("Nothing has been spent. Review every price pool and its original creator chances below.");
      });
      if (answer && !answer.ok && terminal.has(answer.error)) { data.quoteRequest = null; data.quote = null; redraw(); }
    }
    async function openQuote(reviewed) {
      const data = current(), quote = reviewed.quote;
      if (!valid(reviewed) || !data || data.quote !== quote || quote.id !== reviewed.quoteId || quote.poolVersion !== reviewed.poolVersion
        || quote.price !== reviewed.price || data.quoteRequest?.requestId !== reviewed.quoteRequestId || (data.openRequest?.requestId || null) !== reviewed.openRequestId) {
        message("This quote changed in another view. Review the current quote and confirm its exact terms again."); redraw(); return;
      }
      if (data.busy) return;
      if (!quote || (!data.openRequest && quote.expiresAt <= Date.now() + data.clockOffset)) { message("This quote expired. Get a fresh quote and review its terms again."); redraw(); return; }
      data.openRequest ??= { quoteId: quote.id, requestId: newId(), price: quote.price, poolVersion: quote.poolVersion, communityOptIn: data.quoteRequest.communityOptIn };
      const answer = await send("crateOpen", data.openRequest, async (reply, live, before) => {
        if (reply.quoteId !== quote.id || reply.paid !== quote.price || !Array.isArray(reply.rewards) || reply.rewards.length !== quote.count) {
          message("The opening receipt did not match the reviewed quote. Recover this same opening to read its saved receipt; no new quote will be spent."); return;
        }
        live.openRequest = null; live.quoteRequest = null; live.quote = null;
        // Refresh both authoritative ledgers. A license payload is never applied
        // or trusted as a local ownership grant, even when returned in a receipt.
        const refreshed = await refreshOwned();
        if (!valid(before)) return;
        message(refreshed ? `Opened for ${credits(reply.paid)}. Your ownership is refreshed.` : `Opened for ${credits(reply.paid)}. Your receipt is saved; reconnect to refresh ownership.`);
        reveal(reply.rewards);
      });
      if (answer && !answer.ok && terminal.has(answer.error)) { data.openRequest = null; data.quoteRequest = null; data.quote = null; redraw(); }
    }
    function quoteView(data) {
      const quote = data.quote, box = node("section", "collectibles-quote");
      const reviewed = { ...context(), quote, quoteId: quote.id, poolVersion: quote.poolVersion, price: quote.price,
        quoteRequestId: data.quoteRequest?.requestId, openRequestId: data.openRequest?.requestId || null };
      box.append(title("Your exact opening", `${quote.count} rewards · ${credits(quote.price)} total · ${credits(quote.unspentBudget)} of your ${credits(quote.budget)} budget stays in your wallet.`));
      box.append(node("p", "collectibles-note", `Quote expires ${new Date(quote.expiresAt).toLocaleTimeString()}.`));
      const poolDetails = node("details", "collectibles-quote-details");
      poolDetails.append(node("summary", "", "See reward pool and exact odds"));
      poolDetails.append(node("p", "collectibles-note", "Selection is uniform without replacement within each price pool; this opening cannot repeat a design or license."));
      const slotLine = quote.slots.map((slot) => `Reward ${slot.index + 1}: ${credits(slot.price)}`).join(" · ");
      poolDetails.append(node("p", "", slotLine));
      for (const pool of quote.pools) {
        const details = node("details", "collectibles-pool"), count = quote.slots.filter((slot) => slot.poolId === pool.id).length;
        const chance = pool.selectionChance;
        details.append(node("summary", "", `${credits(pool.price)} pool · ${count} ${count === 1 ? "reward" : "rewards"} · ${pool.candidates.length} candidates`));
        details.append(node("p", "collectibles-note", `Each candidate: ${chance.numerator}/${chance.denominator} chance per slot (${chanceText(100 * chance.numerator / chance.denominator)}); ${count}/${pool.candidates.length} chance of appearing in this opening. Creator rarity chances below apply only if that design is selected. Licenses have no rarity roll.`));
        if (pool.collectibleCount) {
          const odds = node("dl", "collectibles-odds");
          for (const rarity of RARITIES) {
            const numerator = pool.rarityWeightsTotal[rarity] || 0;
            if (numerator) odds.append(node("dt", "", rarity === "none" ? "Original" : rarity), node("dd", "", `${numerator}/${pool.rarityDenominator} (${chanceText(100 * numerator / pool.rarityDenominator)})`));
          }
          details.append(node("p", "collectibles-note", "Rarity chance per slot, including the possibility of a license. These marginal chances do not make successive draws independent."), odds);
        }
        const list = node("ul", "collectibles-pool-candidates");
        for (const candidate of pool.candidates) {
          const item = node("li");
          item.append(node("strong", "", candidate.name), node("span", "collectibles-note", ` · ${candidate.type === "collectible" ? candidate.kind : candidate.type === "community-pack-license" ? "Community pack license" : "Shop license"}`));
          if (candidate.type === "collectible") item.append(node("p", "collectibles-note", RARITIES.filter((rarity) => candidate.rarityWeights?.[rarity] > 0).map((rarity) => `${rarity === "none" ? "Original" : rarity}: ${candidate.rarityWeights[rarity]}/10000 (${chanceText(candidate.rarityWeights[rarity] / 100)})`).join(" · ")));
          list.append(item);
        }
        details.append(list); poolDetails.append(details);
      }
      box.append(poolDetails);
      const consent = input("checkbox"), consentLabel = node("label", "collectibles-optin");
      consentLabel.append(consent, node("span", "", "I reviewed these exact prices, candidate pools and unchanged creator chances.")); box.append(consentLabel);
      const retry = Boolean(data.openRequest);
      const open = btn(retry ? "Recover this opening" : `Open ${quote.count} rewards · ${credits(quote.price)}`, () => {
        if (!retry && !consent.checked) { message("Review the exact quote and tick the confirmation before spending."); return; }
        return openQuote(reviewed);
      }, true);
      const updateOpen = () => { open.disabled = data.busy || (!retry && (!consent.checked || quote.expiresAt <= Date.now() + data.clockOffset)); };
      consent.addEventListener("change", updateOpen);
      updateOpen(); box.append(open);
      if (retry) box.append(node("p", "collectibles-note", data.busy ? "Opening this exact quote. Your request is saved for recovery if the connection is interrupted." : "The previous reply was interrupted. Recovery uses the same request and cannot charge or roll this opening twice, even if the quote has expired."));
      else box.append(btn("Discard quote", () => { if (valid(reviewed) && !data.busy && data.quote === quote) { data.quote = null; data.quoteRequest = null; redraw(); } }));
      return box;
    }
    function crates() {
      const section = node("section", "collectibles-dynamic"), data = current();
      if (!data) return section;
      section.append(title("Build a discovery crate", "Choose a topic and an earned-credit budget. The service finds an exact reward count within that budget; you review the complete quote before spending. Each creator keeps their original published rarity chances."));
      if (!data.recipes) { const load = btn("Explore topic crates", loadRecipes); load.disabled = data.busy; section.append(load); return section; }
      if (!data.recipes.recipes.length) { section.append(empty("No topic crates yet", "Topics and credit budgets appear when this community service makes them available."), btn("Refresh topic crates", loadRecipes)); return section; }
      const topic = select(data.recipes.topics.map((entry) => [entry.id, entry.name]), data.topic), tier = select(data.recipes.tiers.map((entry) => [entry.id, `${entry.name} · up to ${credits(entry.budget)} · ${entry.rewardCount} rewards`]), data.tier);
      topic.disabled = tier.disabled = data.busy || Boolean(data.openRequest);
      topic.addEventListener("change", () => { if (!data.busy) { data.topic = topic.value; changeSelection(data); } }); tier.addEventListener("change", () => { if (!data.busy) { data.tier = tier.value; changeSelection(data); } });
      const choices = node("div", "collectibles-filters"); choices.append(field("Discovery topic", topic), field("Credit budget", tier)); section.append(choices);
      const refreshChoices = btn("Refresh topics and budgets", () => { if (!data.busy && !data.openRequest) { data.quote = null; data.quoteRequest = null; return loadRecipes(); } });
      refreshChoices.disabled = data.busy || Boolean(data.openRequest); section.append(refreshChoices);
      const include = input("checkbox"); include.checked = data.optIn; include.disabled = data.busy || Boolean(data.openRequest);
      include.addEventListener("change", () => { if (!data.busy) { data.optIn = include.checked; changeSelection(data); } });
      const label = node("label", "collectibles-optin"); label.append(include, node("span", "", "Include community creations in my quote. Nothing is bought until I review the exact pool and confirm opening.")); section.append(label);
      if (data.quote) section.append(quoteView(data));
      else {
        const recipe = selectedRecipe(data), quote = btn(data.quoteRequest ? "Recover quote" : "Get exact quote · no charge", quoteRecipe, true);
        quote.disabled = data.busy || !recipe?.available; section.append(quote);
        if (!recipe?.available) section.append(node("p", "collectibles-note", "No complete set of eligible rewards fits this topic and budget right now. Try another configured choice."));
      }
      return section;
    }
    function resetContributions(data) {
      data.contributions = null; data.shown = 40; data.contributionCursors = new Set(); data.contributionGeneration += 1;
    }
    async function loadContributions() {
      const data = current();
      if (!data || data.busy || disposed) return;
      resetContributions(data);
      const generation = data.contributionGeneration;
      return send("crateContributions", { limit: 100 }, (answer, live) => {
        if (live !== data || live.contributionGeneration !== generation) return;
        live.contributions = answer; message("Review your current creation terms before choosing discovery topics.");
      });
    }
    async function loadMoreContributions() {
      const data = current(), source = data?.contributions, cursor = source?.next;
      if (!cursor || data.busy || disposed) return;
      const generation = data.contributionGeneration;
      return send("crateContributions", { cursor, limit: 100 }, (answer, live) => {
        if (live !== data || live.contributionGeneration !== generation || live.contributions !== source) return;
        const existing = new Set(source.items.map((item) => `${item.type}:${item.id}`));
        if (JSON.stringify(source.topics) !== JSON.stringify(answer.topics) || answer.items.some((item) => existing.has(`${item.type}:${item.id}`))
          || (answer.next && (answer.next === cursor || live.contributionCursors.has(answer.next)))) {
          resetContributions(live); message("Your creation list changed while loading. Reload creation terms before changing permission."); return;
        }
        live.contributionCursors.add(cursor);
        live.contributions = { ...answer, items: [...source.items, ...answer.items] };
        live.shown = Math.min(live.contributions.items.length, live.shown + 40);
        message(answer.next ? "More creation terms loaded. Keep browsing to reach older creations." : "All current creation terms are loaded.");
      });
    }
    async function saveContribution(item, enabled, topics) {
      const answer = await send("updateCrateContribution", { type: item.type, id: item.id, enabled, topics, termsVersion: item.termsVersion }, (_reply, data) => {
        resetContributions(data); message(enabled ? "Topic crate permission saved for these exact terms." : "Topic crate permission removed immediately.");
      });
      if (answer?.error === "terms-changed") { const data = current(); if (data) resetContributions(data); redraw(); }
    }
    function contributions() {
      const section = node("section", "collectibles-contributions"), data = current();
      if (!data) return section;
      section.append(title("Dynamic crates · creator permission", "Existing creators can choose discovery topics or withdraw dynamic crate permission. This never changes a design's published price, rarity chances, or separate creation-time community crate permission. Unlisting stops both kinds of new participation. A change to a pack's purchase terms requires fresh consent."));
      if (!data.contributions) { const load = btn("Manage topic crate permissions", loadContributions); load.disabled = data.busy; section.append(load); return section; }
      const source = data.contributions;
      const refreshPermission = btn("Refresh creation terms", loadContributions); refreshPermission.disabled = data.busy; section.append(refreshPermission);
      if (!source.items.length && !source.next) { section.append(empty("No eligible creations", "Your eligible published designs and community packs appear here.")); return section; }
      for (const item of source.items.slice(0, data.shown)) {
        const details = node("details", "collectibles-pool"); details.append(node("summary", "", `${item.name} · ${credits(item.price)} · ${item.consent.enabled ? "Permission on" : "Permission off"}`));
        details.append(node("p", "collectibles-note", item.type === "collectible" ? `Permanent chances: ${RARITIES.filter((rarity) => item.rarityWeights?.[rarity] > 0).map((rarity) => `${rarity === "none" ? "Original" : rarity} ${chanceText(item.rarityWeights[rarity] / 100)}`).join(" · ")}` : "Community pack license · no rarity roll · nontransferable"));
        const choices = node("div", "collectibles-topic-choices"), checked = new Map();
        for (const topic of source.topics) {
          const check = input("checkbox"); check.checked = item.consent.topics.includes(topic.id); check.disabled = data.busy; checked.set(topic.id, check);
          const label = node("label", "collectibles-optin"); label.append(check, node("span", "", topic.name)); choices.append(label);
        }
        details.append(choices);
        const agreed = input("checkbox"); agreed.disabled = data.busy;
        const consent = node("label", "collectibles-optin"); consent.append(agreed, node("span", "", `I allow this creation in the selected topics at ${credits(item.price)} and the exact terms shown above. I can withdraw this topic permission later.`)); details.append(consent);
        const save = btn("Save topic permission", () => {
          const topics = [...checked].filter(([, check]) => check.checked).map(([id]) => id);
          if (!topics.length || !agreed.checked) { message("Choose at least one topic and confirm its current terms before saving permission."); return; }
          return saveContribution(item, true, topics);
        }, true); save.disabled = data.busy || !source.topics.length; details.append(save);
        if (item.consent.enabled) { const remove = btn("Withdraw topic permission", () => saveContribution(item, false, [])); remove.disabled = data.busy; details.append(remove); }
        section.append(details);
      }
      if (source.items.length > data.shown) {
        const more = btn(`Show more creations (${source.items.length - data.shown} more loaded)`, () => { if (!data.busy) { data.shown = Math.min(source.items.length, data.shown + 40); redraw(); } });
        more.disabled = data.busy; section.append(more);
      } else if (source.next) { const more = btn("Load more creations", loadMoreContributions); more.disabled = data.busy; section.append(more); }
      return section;
    }
    return { crates, contributions, dispose: () => { disposed = true; controllers.delete(controller); }, loadRecipes };
  }
  window.MefiDynamicCrates = { create };
})();
