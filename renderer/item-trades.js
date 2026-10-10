// Public UI for immutable offers; the private service transfers ownership.
// Per-device kill switch: localStorage['mefiStudio.trades'] = 'off'.
(function () {
  "use strict";
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const button = (text, run) => { const el = node("button", "ghost rooms-button", text); el.type = "button"; el.addEventListener("click", run); return el; };
  const describe = item => item?.definitionId ? `${item.name} · ${item.rarity === "none" ? "Original" : item.rarity} · quality ${item.quality} · design ${item.definitionId} · instance ${item.id}` : item?.name || "item";
  const reasons = { unsupported: "Trading is not available on this room service yet.", offline: "Reconnect to view or send trades.", network: "The service did not answer. Refresh to check the offer before trying again.", hold: "Both members must be eligible to trade. Check your account standing in the Project hub.", "not-found": "Choose someone who shares an active room with you. The Lobby alone does not count.", "ownership-changed": "An item changed hands. Refresh and make a new offer.", "already-owned": "One of you already owns the item they would receive.", "trades-paused": "Trading is temporarily paused. Pending offers can still be cancelled.", "trade-limit": "Too many offers. Clear pending offers or try again tomorrow.", expired: "This offer expired.", superseded: "An item in this offer has already changed hands.", "room-left": "Both members must still share an active room.", "receipt-conflict": "The earlier offer has different terms. Refresh before making a new one." };
  let active = null;
  async function open() {
    try { if (localStorage.getItem("mefiStudio.trades") === "off") return; } catch { /* defaults on */ }
    if (active) { active.focus(); return; }
    const api = window.mefiStudio;
    reasons["trade-policy-unavailable"] = "Trading is waiting for the private account service to confirm eligibility.";
    reasons["trade-wait"] = "New accounts joining after launch month wait three days to trade. A verified permanent Donor benefit removes that wait.";
    reasons["trade-hold"] = "An item is still on its transfer hold. Original items wait 15 minutes; rarity items wait one hour after transfer.";
    const dialog = node("dialog", "item-trades"); active = dialog;
    const returnTo = document.activeElement;
    let epoch = 0, choiceEpoch = 0, busy = false, me = null;
    const status = node("p", "muted", "Loading trades…"); status.setAttribute("role", "status");
    const list = node("div", "item-trades-list"), compose = node("div", "item-trades-compose");
    const call = (method, ...args) => api?.hubShop?.(method, ...args);
    const close = () => { epoch += 1; dialog.close(); dialog.remove(); active = null; returnTo?.focus?.(); };
    const head = node("div", "rooms-row-actions");
    head.append(node("h2", "", "Trade with a room-mate"), button("Close", close));
    dialog.setAttribute("aria-label", "Trade with a room-mate");
    dialog.append(head, node("p", "muted", "Swap one eligible owned pet, sticker or cosmetic for another. Both items move together when the recipient accepts. Account eligibility and item holds still apply. No credits, rank or rewards change. Offers expire in 24 hours."), status, button("Refresh trades", () => { void refresh(); }), list, compose);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    document.body.append(dialog); dialog.showModal();
    const alive = token => active === dialog && token === epoch;
    async function action(run) {
      if (busy) return; busy = true;
      const token = epoch;
      try {
        const answer = await run();
        if (!alive(token)) return;
        if (!answer?.ok) { status.textContent = reasons[answer?.error] || "The trade did not go through. Refresh and check its status."; return; }
        status.textContent = answer.trade ? `Offer ${answer.trade.status}.` : "Updated.";
        await window.MefiShop?.refresh?.();
        try { await window.MefiCollectibles?.refresh?.(); } catch { /* committed trade remains visible if collection refresh is unavailable */ }
        await refresh();
      } catch { if (alive(token)) status.textContent = reasons.network; }
      finally { busy = false; }
    }
    function confirm(container, sentence, label, run) {
      const review = node("div", "item-trades-review");
      review.append(node("p", "", sentence), button(label, () => { if (!busy) void action(run); }), button("Keep looking", () => review.remove()));
      container.replaceChildren(review);
    }
    async function refresh() {
      const token = ++epoch;
      let answer;
      try { answer = await call("trades"); } catch { answer = { ok: false, error: "network" }; }
      if (!alive(token)) return;
      if (!answer?.ok) { status.textContent = reasons[answer?.error] || "Trades could not be loaded."; compose.replaceChildren(); return; }
      list.replaceChildren();
      for (const trade of answer.trades) {
        const incoming = trade.recipient.id === me;
        const peer = incoming ? trade.sender : trade.recipient;
        const give = incoming ? trade.requested : trade.offered, get = incoming ? trade.offered : trade.requested;
        const row = node("section", "item-trades-row");
        row.append(node("strong", "", `${peer.name} · ${peer.id.slice(-6)}`), node("p", "", `You give ${describe(give)}. You receive ${describe(get)}.`), node("span", "muted", trade.status === "pending" ? `Pending · expires ${new Date(trade.expiresAt).toLocaleString()}` : trade.status));
        const controls = node("div", "rooms-row-actions");
        if (trade.status === "pending") {
          if (incoming && answer.enabled) controls.append(button("Review swap", () => confirm(controls, `Give ${describe(give)} to ${peer.name} and receive ${describe(get)}? This transfers ownership of both exact items.`, "Accept this swap", () => call("tradeDecide", trade.id, "accept"))));
          controls.append(button(incoming ? "Decline" : "Cancel offer", () => { void action(() => call("tradeDecide", trade.id, incoming ? "decline" : "cancel")); }));
        }
        row.append(controls); list.append(row);
      }
      if (!answer.trades.length) list.append(node("p", "muted", "No offers yet. Find a room-mate below to make one."));
      compose.replaceChildren();
      if (!answer.enabled) { status.textContent = reasons["trades-paused"]; return; }
      const search = node("input", "rooms-note"); search.type = "search"; search.maxLength = 32; search.placeholder = "Find a room-mate"; search.setAttribute("aria-label", "Find a room-mate by name");
      const found = node("div", "item-trades-list");
      compose.append(search, button("Find", async () => {
        const term = search.value.trim(); if (term.length < 2) return;
        let results; try { results = await api.hubRoom("searchMembers", term); } catch { results = null; }
        if (!alive(token) || search.value.trim() !== term) return;
        found.replaceChildren();
        for (const member of results?.members ?? []) if (member.id !== me) found.append(button(`${member.name} · ${member.id.slice(-6)}`, () => { void choose(member.id, token); }));
        if (!found.children.length) found.append(node("p", "muted", "No matching members."));
      }), found);
    }
    async function choose(uid, token) {
      const choice = ++choiceEpoch;
      let answer; try { answer = await call("tradeInventory", uid); } catch { answer = null; }
      if (!alive(token) || choice !== choiceEpoch) return;
      if (!answer?.ok) { status.textContent = reasons[answer?.error] || "Inventory could not be loaded."; return; }
      const select = (label, items) => { const wrap = node("label", "item-trades-field", label), input = node("select", ""); for (const item of items) { const option = node("option", "", describe(item)); option.value = item.id; input.append(option); } wrap.append(input); return { wrap, input }; };
      const mine = answer.mine.filter(item => !answer.theirs.some(theirs => theirs.id === item.id));
      const theirs = answer.theirs.filter(item => !answer.mine.some(own => own.id === item.id));
      if (!mine.length || !theirs.length) { status.textContent = "You both need an eligible item the other does not already own."; return; }
      const give = select("You give", mine), get = select("You receive", theirs), review = node("div", "");
      compose.replaceChildren(node("h3", "", `Offer to ${answer.member.name} · ${uid.slice(-6)}`), give.wrap, get.wrap, button("Review offer", () => {
        const offered = give.input.value, requested = get.input.value;
        const receipt = crypto.randomUUID().replaceAll("-", "");
        confirm(review, `Offer ${describe(mine.find(x => x.id === offered))} for ${describe(theirs.find(x => x.id === requested))} with ${answer.member.name}? They must accept these exact items. You can cancel while it is pending.`, "Send this offer", () => call("tradeOffer", { recipient: uid, offered, requested, receipt }));
      }), review);
    }
    try { me = (await api?.hubStatus?.())?.status?.user?.id ?? null; } catch { /* list explains connection */ }
    if (active === dialog) await refresh();
  }
  window.MefiTrades = { open };
})();
