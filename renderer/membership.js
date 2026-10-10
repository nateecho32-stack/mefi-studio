// Membership is a current-account projection from the Hub. Browser returns,
// saved request IDs and permanent Donor history never grant creator access.
(() => {
  "use strict";
  const cards = new Set(), ID = /^[A-Za-z0-9_-]{8,80}$/;
  const STORAGE = "mefi.billing.requests.v1:";
  let actor = null, epoch = 0, hub = null, data = null, readAt = 0;
  let reading = null, working = false, listening = false, hubRevision = 0;
  let requests = {}, message = "", retryAt = 0;
  const api = () => window.mefiStudio;
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const notify = () => { for (const card of cards) card.paint(); };
  const available = () => hub?.state === "ready" && hub.billing === true && Boolean(actor) && typeof api()?.hubBilling === "function";
  const current = (who, version) => actor === who && epoch === version && available();
  const date = (value) => { const d = new Date(value); return Number.isFinite(d.valueOf()) ? d.toLocaleString() : "Date unavailable"; };
  const money = (amount, currency) => currency === "usd"
    ? `$${Math.floor(amount / 100).toLocaleString("en-US")}.${String(amount % 100).padStart(2, "0")} USD`
    : `${amount.toLocaleString()} ${currency.toUpperCase()} minor units`;
  const messages = {
    unauthorized: "Sign in again to check your membership.",
    billing_origin_required: "Billing is not available in this connection yet.",
    checkout_policy_denied: "Your eligibility changed. Review your refreshed membership before continuing.",
    checkout_not_enabled: "New purchases are unavailable. Existing membership and billing management can still be checked.",
    billing_operation_in_progress: "That request is still being processed. Refresh status, then retry the same request.",
    checkout_already_pending: "An existing checkout needs to be recovered. Refresh status to continue it.",
    subscription_already_exists: "A subscription already exists. Check membership or use billing management when available.",
    billing_session_complete: "This checkout has completed. Refresh membership for its verified result.",
    billing_session_expired: "This checkout has expired. Refresh membership before considering another purchase.",
    billing_session_unavailable: "This checkout is unavailable. Refresh membership before continuing.",
    billing_request_recovery_required: "This purchase needs support recovery. Please contact support before trying another purchase.",
    customer_recovery_required: "Your billing account needs support recovery. Please contact support before trying again.",
    billing_rate_limited: "Please wait before retrying. The original request will be reused.",
    browser_unavailable: "The browser could not be opened. Continue the same request to try again.",
    network: "The service did not confirm the result. Refresh status or retry the original request.",
    bad_response: "The service returned an unreadable result. Your original request is kept for recovery.",
    stripe_unavailable: "Billing is temporarily unavailable. Your original request is kept for recovery.",
    adapter_unavailable: "Billing is temporarily unavailable. Your original request is kept for recovery.",
  };
  const words = (result) => messages[result?.error] || "Membership is unavailable just now. Refresh status before continuing.";
  function save() {
    if (!actor) return;
    try {
      if (Object.keys(requests).length) window.localStorage?.setItem(STORAGE + actor, JSON.stringify(requests));
      else window.localStorage?.removeItem(STORAGE + actor);
    } catch { /* server status still restores a durable Checkout request */ }
  }
  function restore() {
    requests = {};
    try {
      const raw = window.localStorage?.getItem(STORAGE + actor);
      if (!raw || raw.length > 512) return;
      const saved = JSON.parse(raw);
      for (const action of ["checkout", "portal"]) {
        const item = saved?.[action];
        if (item && typeof item.id === "string" && ID.test(item.id) && ["uncertain", "open", "resolved", "support"].includes(item.phase)) requests[action] = { id: item.id, phase: item.phase };
      }
    } catch { /* untrusted local state is only a recovery hint */ }
  }
  function takeHub(next) {
    const who = typeof next?.user?.id === "string" ? next.user.id : null;
    if (actor !== who || (hub?.state === "ready" && (next?.state !== "ready" || next?.billing !== true))) {
      epoch += 1; data = null; reading = null; working = false; message = ""; retryAt = 0;
      if (actor !== who) { actor = who; requests = {}; if (actor) restore(); }
    }
    hub = next;
    if (!available()) data = null;
  }
  function applyStatus(result) {
    data = result; readAt = Date.now();
    const pending = result.pending;
    if (pending.requestId) requests.checkout = { id: pending.requestId, phase: pending.checkout === "payment_review" || (requests.checkout?.id === pending.requestId && requests.checkout.phase === "support") ? "support" : "open" };
    else if (pending.checkout === "none" && ["open", "resolved", "support"].includes(requests.checkout?.phase)) delete requests.checkout;
    save();
  }
  async function call(action, payload = {}) {
    try { return await api().hubBilling(action, payload); }
    catch { return { ok: false, error: "network" }; }
  }
  async function refresh() {
    if (reading) return reading;
    if (working) return null;
    const operation = (async () => {
      const revision = hubRevision, identity = epoch;
      let next;
      try { next = (await api()?.hubStatus?.())?.status; } catch { next = null; }
      if (revision !== hubRevision) {
        // A same-account ready push can arrive while hubStatus is pending.
        // Use that newer snapshot and finish the canonical billing read; the
        // push's refresh already coalesced into this promise. Identity or
        // connection changes still cancel the original operation.
        if (identity !== epoch) return null;
        next = hub;
      }
      takeHub(next); reading = operation; notify();
      if (!available()) return null;
      const who = actor, version = epoch;
      const result = await call("status");
      if (!current(who, version)) return null;
      if (result?.ok) applyStatus(result);
      else {
        data = null; message = words(result);
        if (result?.error === "unauthorized") { requests = {}; save(); }
      }
      return result;
    })();
    reading = operation; notify();
    try { return await operation; }
    finally { if (reading === operation) reading = null; notify(); }
  }
  function requestId() {
    try { const id = crypto.randomUUID(); return ID.test(id) ? id : null; } catch { return null; }
  }
  function actionAllowed(action) {
    if (!data || !available() || !data.actions[action] || retryAt > Date.now() || requests[action]?.phase === "support") return false;
    if (action === "checkout") return Boolean(data.offer) && ["none", "open"].includes(data.pending.checkout)
      && (data.pending.checkout !== "open" || Boolean(data.pending.requestId));
    return true;
  }
  function safeUrl(action, value) {
    try {
      if (typeof value !== "string" || value.length > 2048 || !value.startsWith("https://") || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
      const parsed = new URL(value);
      return !parsed.username && !parsed.password && parsed.origin === (action === "checkout" ? "https://checkout.stripe.com" : "https://billing.stripe.com");
    } catch { return false; }
  }
  async function start(action, reviewed, owner) {
    if (owner.gone || working || reading || reviewed !== data || !actionAllowed(action)) return;
    const who = actor, version = epoch, reviewedId = requests[action]?.id || null;
    const refreshed = await refresh();
    if (owner.gone || !current(who, version) || !refreshed?.ok || working || !actionAllowed(action)) return;
    if (action === "checkout" && (reviewed.offer?.version !== data.offer?.version || reviewedId !== (requests.checkout?.id || null))) {
      message = "Your offer or pending checkout changed. Review the current details before continuing."; notify(); return;
    }
    const id = requests[action]?.id || requestId();
    if (!id) { message = "A secure request could not be created. Please reopen Studio before trying again."; notify(); return; }
    requests[action] = { id, phase: "uncertain" }; save();
    working = true; message = action === "checkout" ? "Preparing your secure checkout…" : "Preparing billing management…"; notify();
    try {
      const result = await call(action, { requestId: id });
      if (!current(who, version)) return;
      if (result?.ok && safeUrl(action, result.url)) {
        requests[action] = { id, phase: "open" }; save();
        if (owner.gone) { message = "Your request is ready. Continue it when you are ready to open the browser."; return; }
        let opened;
        try { opened = await api().hubBillingOpen(action, result.url, who); } catch { opened = { ok: false, error: "browser_unavailable" }; }
        if (!current(who, version)) return;
        if (opened?.ok) {
          if (action === "portal") { delete requests.portal; save(); }
          message = "Opened in your browser. Return here and refresh membership to check the verified result.";
        } else message = words(opened);
      } else {
        const failure = result?.ok ? { ok: false, error: "bad_response" } : result;
        message = words(failure);
        if (failure?.error === "unauthorized") { requests = {}; data = null; save(); }
        if (["billing_request_recovery_required", "customer_recovery_required"].includes(failure?.error)) { requests[action].phase = "support"; save(); }
        if (["billing_session_complete", "billing_session_expired", "billing_session_unavailable"].includes(failure?.error)) { requests[action].phase = "resolved"; save(); }
        retryAt = Date.now() + Math.max(5000, Math.min(3600000, Number(failure?.retryAfter) || 5000));
        // Keep the old projection visible, but require an explicit status read
        // before a second payment action. No automatic mutation retry exists.
        data = null;
      }
    } finally {
      if (current(who, version)) working = false;
      notify();
    }
  }
  function listen() {
    if (listening) return;
    listening = true;
    api()?.onHubEvent?.((event) => {
      if (event?.type !== "status") return;
      hubRevision += 1; takeHub(event.status); notify();
      if (cards.size && available()) void refresh();
    });
    const returned = () => { if (cards.size && document.visibilityState !== "hidden" && !working) void refresh(); };
    window.addEventListener?.("focus", returned);
    document.addEventListener?.("visibilitychange", returned);
  }
  function card() {
    const root = node("section", "membership");
    root.setAttribute("aria-label", "Membership");
    const owner = { gone: false, paint };
    const button = (label, run, disabled = false, cls = "") => { const el = node("button", `membership-button ${cls}`, label); el.type = "button"; el.disabled = disabled; el.addEventListener("click", () => { if (!el.disabled) return run(); }); return el; };
    function paint() {
      if (owner.gone) return;
      const head = node("header", "membership-head");
      head.append(node("p", "membership-eyebrow", "MAKE SOMETHING YOURS"), node("h2", "", "Vibe Studio membership"),
        node("p", "membership-note", "Create custom pets and stickers with the same creator benefits through paid membership, lifetime membership, or intro access. Your existing creations stay yours."));
      const content = node("div", "membership-content"), tools = node("div", "membership-actions");
      const statusLine = node("p", "membership-message", message); statusLine.setAttribute("role", "status"); statusLine.setAttribute("aria-live", "polite");
      root.setAttribute("aria-busy", String(Boolean(reading || working)));
      if (!data) {
        content.append(node("p", "membership-empty", reading ? "Checking membership…" : !actor ? "Sign in with Discord in Friends to check membership." : !available() ? "Membership is not available on this connection yet." : "Refresh to check your current membership."));
      } else {
        const m = data.membership, facts = node("div", "membership-facts"), membership = node("article", "membership-fact");
        const title = m.active ? ({ paid: "Paid monthly membership", lifetime: "Lifetime membership", intro: "Intro access" }[m.kind]) : "Membership inactive";
        membership.append(node("span", "membership-label", "CURRENT MEMBERSHIP"), node("h3", "", title),
          node("p", "membership-note", m.active ? `Confirmed active at ${date(data.now)}.` : m.reason === "expired" ? "Your previous membership has ended." : "No active membership is confirmed."));
        if (m.until !== null) {
          membership.append(node("p", "membership-note", `Recorded ${m.active ? "end" : "previous end"}: ${date(m.until)}.`));
          if (m.until <= data.now + Math.max(0, Date.now() - readAt)) membership.append(node("p", "membership-note", "The recorded term has elapsed. Refresh to check current access."));
        } else if (m.kind === "lifetime") membership.append(node("p", "membership-note", "No monthly renewal or expiry."));
        const donor = node("article", "membership-fact");
        donor.append(node("span", "membership-label", "DONOR"), node("h3", "", m.donor ? "Permanent Donor active" : "Donor benefits inactive"),
          node("p", "membership-note", "Donor status is separate from an active membership."), node("p", "membership-note", m.everSupported ? "Supporter history is recorded." : "No supporter history is recorded."));
        facts.append(membership, donor); content.append(facts);
        if (["owner_revoked", "verification_due", "billing_review_required", "unavailable"].includes(m.reason)) content.append(node("p", "membership-notice", "Membership needs verification or support review before its status can change."));
        if (data.offer) {
          const offer = data.offer, terms = node("article", "membership-offer");
          terms.append(node("h3", "", "Your current offer"), node("p", "membership-price", `${money(offer.firstPeriodAmount, offer.currency)} initial month`),
            node("p", "membership-note", `${money(offer.renewalAmount, offer.currency)} each month on renewal.`),
            node("p", "membership-note", offer.referralApplied ? "Referral pricing is applied to this offer." : "Referral pricing is not applied to this offer."),
            node("p", "membership-note", offer.taxMode === "exclusive" ? "Any applicable tax is added in checkout." : "No additional tax is configured for this offer."));
          content.append(terms);
        }
        if (data.pending.checkout === "expiring") content.append(node("p", "membership-notice", "An earlier checkout is being resolved. Refresh status later; a replacement purchase is unavailable until it is settled."));
        if (data.pending.checkout === "payment_review") content.append(node("p", "membership-notice", "A completed payment needs support review. Please contact support. No new purchase is available while it is reviewed."));
        const reviewed = data;
        if (data.actions.checkout && ["none", "open"].includes(data.pending.checkout) && data.offer) tools.append(button(requests.checkout ? "Continue existing checkout" : "Continue to secure checkout", () => start("checkout", reviewed, owner), working || Boolean(reading) || !actionAllowed("checkout"), "is-primary"));
        else content.append(node("p", "membership-note", "New purchases are currently unavailable for this account."));
        if (data.actions.portal) tools.append(button("Manage billing", () => start("portal", reviewed, owner), working || Boolean(reading) || !actionAllowed("portal")));
        content.append(node("p", "membership-note", "Checkout and billing management open securely in your browser. Membership updates only after payment verification."));
      }
      if (retryAt > Date.now()) content.append(node("p", "membership-note", `You can retry after ${date(retryAt)}. Refresh status first.`));
      tools.append(button("Refresh membership", () => { message = ""; return refresh(); }, working || Boolean(reading)),
        button("Open Creator studio", () => window.MefiCollectibles?.open?.("creator")));
      root.replaceChildren(head, content, tools, statusLine);
    }
    cards.add(owner); listen(); paint(); void refresh();
    root.dispose = () => { if (owner.gone) return; owner.gone = true; cards.delete(owner); };
    return root;
  }
  window.MefiMembership = { card, refresh };
})();
