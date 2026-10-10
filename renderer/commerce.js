// Cash marketplace UI. Server snapshots select prices, fees and delivery.
// Browser return only refreshes actor-bound order history; it never grants goods.
(() => {
  "use strict";
  const cards = new Set(), STORAGE = "mefi.commerce.drafts.v2:";
  const ID = /^[A-Za-z0-9_-]{8,80}$/, LISTING = /^[A-Za-z0-9:_-]{1,100}$/, VERSION = /^[a-f0-9]{64}$/, ORDER = /^cash_[a-f0-9]{32}$/;
  const api = () => window.mefiStudio;
  const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const money = (amount, currency, minorUnit) => {
    if (!Number.isSafeInteger(amount) || amount < 0) return "Not calculated yet";
    if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 3) return `${amount.toLocaleString()} ${String(currency).toUpperCase()} minor units`;
    const scale = 10n ** BigInt(minorUnit), value = BigInt(amount), whole = (value / scale).toString(), fraction = (value % scale).toString().padStart(minorUnit, "0");
    return `${whole}${minorUnit ? "." + fraction : ""} ${String(currency).toUpperCase()}`;
  };
  const date = (at) => { const d = new Date(at); return Number.isFinite(d.valueOf()) ? d.toLocaleString() : "Time unavailable"; };
  const percent = (bps) => `${Math.floor(bps / 100)}${bps % 100 ? `.${String(bps % 100).padStart(2, "0").replace(/0$/, "")}` : ""}%`;
  let actor = null, epoch = 0, hub = null, hubRevision = 0, listening = false;
  let working = false, reading = null, message = "", retryAt = 0, drafts = Object.create(null);
  let market = {}, seller = null, selectedListing = null, selectedAsset = null, assetKind = "collectible-instance", priceText = "", currency = "", sellerPending = null, onboardingPending = null;
  let sellerRefusal = null, sellerSetup = null, countryPending = null, countryChoice = "";
  const LISTING_NOT_APPLIED = new Set(["listing_changed", "listing_exists", "listing_limit", "invalid_price", "asset_reserved", "seller_not_ready"]);
  let orders = [], nextCursor = null, scope = "pending", selected = null, visited = new Set(), hydrated = new Set();
  const available = () => hub?.state === "ready" && (hub.commerceSellerSetup === true || hub.commerceRetireOrders === true || hub.commerceOrders === true || hub.commerceCatalog === true || hub.commerceSeller === true) && Boolean(actor) && typeof api()?.hubCommerce === "function";
  const current = (who, version) => actor === who && epoch === version && available();
  const notify = () => { for (const card of cards) card.paint(); };
  const words = (result) => ({
    unauthorized: "Sign in again to recover your orders.", stale_account: "The signed-in account changed. Refresh this account's marketplace.",
    cash_request_unauthorized: "Sign in again to recover the original order.",
    cash_checkout_unavailable: "New checkout is unavailable. Existing orders remain available for status recovery.",
    cash_fee_eligibility_unavailable: "The seller's fee eligibility is being verified. No higher fee has been substituted.",
    cash_order_cursor_invalid: "This history page expired. Refresh to start at the newest orders.",
    cash_listing_unavailable: "This listing changed or is unavailable. Review its current details before starting a new order.",
    cash_request_conflict: "This saved request needs support recovery. Do not start another purchase for it.",
    cash_quote_stale: "This order's unstarted quote expired. It cannot be used for a new payment.",
    cash_operation_in_progress: "Your existing order is still being processed. Refresh its status before continuing.",
    cash_checkout_recovery_required: "This payment needs support recovery. Keep the order reference and do not pay again.",
    cash_rate_limited: "Please wait before retrying. Your original order is kept.",
    network: "The service did not confirm the result. Recover the original order before trying another purchase.",
    bad_response: "The service returned an unreadable result. Your original request is kept for recovery.",
    browser_unavailable: "The browser could not be opened. Refresh and continue the same request.",
    cash_seller_setup_unavailable: "Seller country preparation is unavailable on this connection.",
    cash_seller_country_locked: "Your declared country is locked because payment account preparation has started.",
    cash_seller_country_unsupported: "This country is not currently enabled for seller setup.",
    onboarding_link_expired: "This setup link expired. Refresh seller setup before explicitly opening a fresh link.",
  }[result?.error] || "The marketplace is unavailable just now. Refresh to recover the current state.");
  function save() {
    if (!actor) return false;
    try {
      const value = JSON.stringify(drafts);
      window.localStorage.setItem(STORAGE + actor, value);
      return window.localStorage.getItem(STORAGE + actor) === value;
    } catch { return false; }
  }
  function restore() {
    drafts = Object.create(null);
    try {
      const raw = window.localStorage.getItem(STORAGE + actor); if (!raw || raw.length > 12000) return;
      const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const [key, d] of Object.entries(value).slice(0, 16)) {
        if (!ID.test(key) || !d || !LISTING.test(d.listingId) || !VERSION.test(d.listingVersion) || d.requestId !== key || !(d.orderId === null || ORDER.test(d.orderId))) continue;
        drafts[key] = { listingId: d.listingId, listingVersion: d.listingVersion, requestId: key, orderId: d.orderId };
      }
    } catch { /* Saved IDs are hints only; server history is canonical. */ }
  }
  function takeHub(next) {
    const who = typeof next?.user?.id === "string" ? next.user.id : null;
    if (who !== actor || hub?.state === "ready" && (next?.state !== "ready" || next?.commerceOrders !== hub.commerceOrders || next?.commerceRetireOrders !== hub.commerceRetireOrders || next?.commerceCatalog !== hub.commerceCatalog || next?.commerceSeller !== hub.commerceSeller || next?.commerceOnboarding !== hub.commerceOnboarding || next?.commerceSellerSetup !== hub.commerceSellerSetup)) {
      epoch += 1; orders = []; selected = null; nextCursor = null; visited = new Set(); hydrated = new Set();
      reading = null; working = false; message = ""; retryAt = 0; market = {}; seller = null; selectedListing = null; selectedAsset = null; priceText = ""; currency = ""; sellerPending = null; sellerRefusal = null; sellerSetup = null; countryChoice = "";
      actor = who; restore(); restoreSeller(); restoreOnboarding(); restoreCountry();
    }
    hub = next;
    if (!available()) { orders = []; selected = null; nextCursor = null; }
  }
  function retryReady() {
    if (retryAt <= Date.now()) return true;
    message = "Please wait " + Math.ceil((retryAt - Date.now()) / 1000) + " seconds before retrying. Your saved request is kept.";
    notify(); return false;
  }
  async function call(action, payload) {
    try { return await api().hubCommerce(action, payload); } catch { return { ok: false, error: "network" }; }
  }
  function remember(order) {
    const clean = copy(order); delete clean.url; delete clean.status; delete clean.ok; delete clean.replayed;
    const index = orders.findIndex((o) => o.orderId === clean.orderId);
    if (index >= 0) orders[index] = clean;
    if (selected?.orderId === clean.orderId || !selected) selected = clean;
    for (const [id, draft] of Object.entries(drafts)) if (draft.orderId === clean.orderId && ["fulfilled", "closed"].includes(clean.state)) delete drafts[id];
    save(); return clean;
  }
  async function rehydrate(order, who, version) {
    if (!order.receipt || order.state !== "fulfilled") return;
    const key = order.orderId + ":" + order.receipt.version;
    if (hydrated.has(key) || !current(who, version)) return;
    try {
      // The first read can be a pre-delivery coalesced flight. Its completion
      // precedes a fresh canonical read; no receipt is applied to local assets.
      for (const collection of [window.MefiCollectibles, window.MefiShop]) {
        if (typeof collection?.refresh !== "function") continue;
        await collection.refresh(); if (!current(who, version)) return;
        const answer = await collection.refresh(); if (!current(who, version) || answer?.ok === false) return;
      }
      hydrated.add(key);
    } catch { /* Status stays delivered; users can refresh their collection. */ }
  }
  async function refresh({ more = false } = {}) {
    if (reading || working) return reading;
    const operation = (async () => {
      const revision = hubRevision, identity = epoch;
      let next; try { next = (await api()?.hubStatus?.())?.status; } catch { next = null; }
      if (revision !== hubRevision) { if (identity !== epoch) return null; next = hub; }
      takeHub(next); reading = operation; notify(); if (!available() || !hub.commerceOrders) return null;
      const who = actor, version = epoch, requestedScope = scope, cursor = more ? nextCursor : null;
      if (more && !cursor) return null;
      const answer = await call("listOrders", { scope: requestedScope, limit: 25, cursor });
      if (!current(who, version) || scope !== requestedScope) return null;
      if (!answer?.ok) { message = words(answer); return answer; }
      if (more && (answer.orders.some((o) => orders.some((old) => old.orderId === o.orderId)) || answer.nextCursor && visited.has(answer.nextCursor))) {
        message = "The service repeated a history page. Refresh to recover the newest orders."; nextCursor = null; return null;
      }
      if (!more) { orders = []; visited = new Set(); }
      orders.push(...answer.orders); nextCursor = answer.nextCursor; if (cursor) visited.add(cursor);
      if (selected) {
        const status = await call("getOrder", { orderId: selected.orderId });
        if (!current(who, version) || scope !== requestedScope) return null;
        if (status?.ok) remember(status); else message = words(status);
      }
      for (const order of orders) { await rehydrate(order, who, version); if (!current(who, version)) return null; }
      return answer;
    })();
    reading = operation; notify();
    try { return await operation; } finally { if (reading === operation) reading = null; notify(); }
  }
  async function inspect(orderId) {
    if (!available() || working || reading) return;
    const who = actor, version = epoch; working = true; message = "Checking order…"; notify();
    try {
      const result = await call("getOrder", { orderId }); if (!current(who, version)) return;
      if (result?.ok) { selected = remember(result); message = ""; await rehydrate(selected, who, version); }
      else message = words(result);
    } finally { if (current(who, version)) working = false; notify(); }
  }
  async function recover(draft) {
    if (!available() || working || reading || !retryReady() || drafts[draft.requestId] !== draft) return;
    if (draft.orderId) return inspect(draft.orderId);
    const who = actor, version = epoch; working = true; message = "Recovering the original request…"; notify();
    try {
      const result = await call("createOrder", { listingId: draft.listingId, listingVersion: draft.listingVersion, requestId: draft.requestId });
      if (!current(who, version)) return;
      if (result?.ok) { draft.orderId = result.orderId; save(); selected = remember(result); message = "Review the confirmed order before opening checkout."; }
      else { message = words(result); retryAt = Date.now() + Math.max(5000, Math.min(3600000, result?.retryAfter || 5000)); }
    } finally { if (current(who, version)) working = false; notify(); }
  }
  async function resolveRequest(draft) {
    if (!available() || !hub.commerceRetireOrders || working || reading || draft.orderId || drafts[draft.requestId] !== draft) return;
    const who = actor, version = epoch; working = true; message = "Checking the saved request without creating a new order…"; notify();
    try {
      const result = await call("retireOrderRequest", { listingId: draft.listingId, listingVersion: draft.listingVersion, requestId: draft.requestId });
      if (!current(who, version)) return;
      if (!result?.ok) { message = words(result); return; }
      if (result.outcome === "applied") { draft.orderId = result.order.orderId; save(); selected = remember(result.order); message = "The original order exists. Review its current status."; }
      else if (result.outcome === "not-applied") { delete drafts[draft.requestId]; save(); selectedListing = null; message = "This request cannot create an order. Browse and review current listing terms before starting another purchase."; }
    } finally { if (current(who, version)) working = false; notify(); }
  }
  async function prepare(listing) {
    if (!available() || !hub.commerceOrders || working || reading || !retryReady() || !listing || !LISTING.test(listing.id) || !VERSION.test(listing.version)) return;
    const old = Object.values(drafts).find((d) => d.listingId === listing.id && d.listingVersion === listing.version);
    if (old) return recover(old);
    if (Object.keys(drafts).length >= 16) { message = "Recover your saved requests before starting another order."; notify(); return; }
    let id; try { id = crypto.randomUUID(); } catch { id = null; }
    if (!id || !ID.test(id)) { message = "A secure request could not be created."; notify(); return; }
    const draft = { listingId: listing.id, listingVersion: listing.version, requestId: id, orderId: null };
    drafts[id] = draft;
    if (!save()) { delete drafts[id]; message = "Studio could not save the recovery reference. Enable local storage before starting an order."; notify(); return; }
    await recover(draft);
  }
  const checkoutAllowed = (o) => o && ["quoted", "creating", "awaiting_payment"].includes(o.state) && !o.needsReview && !o.receipt;
  async function checkout(reviewed, owner) {
    if (owner.gone || selected !== reviewed || !available() || working || reading || !checkoutAllowed(reviewed) || !retryReady()) return;
    const who = actor, version = epoch; working = true; message = "Checking this order before checkout…"; notify();
    try {
      const fresh = await call("getOrder", { orderId: reviewed.orderId });
      if (owner.gone || !current(who, version)) return;
      if (!fresh?.ok) { message = words(fresh); return; }
      const originalTerms = JSON.stringify([reviewed.listing, reviewed.quote, reviewed.commission]);
      selected = remember(fresh);
      if (originalTerms !== JSON.stringify([fresh.listing, fresh.quote, fresh.commission]) || !checkoutAllowed(fresh)) {
        message = "The order changed. Review its current status before continuing."; return;
      }
      const result = await call("checkout", { orderId: fresh.orderId });
      if (!current(who, version)) return;
      if (!result?.ok) { message = words(result); retryAt = Date.now() + Math.max(5000, Math.min(3600000, result?.retryAfter || 5000)); return; }
      selected = remember(result);
      if (owner.gone || !result.url || result.needsReview || result.state !== "awaiting_payment") { message = "Order status updated. No payment page is ready to open."; return; }
      let opened; try { opened = await api().hubCommerceOpen(result.orderId, result.url, who); } catch { opened = { ok: false, error: "browser_unavailable" }; }
      if (!current(who, version)) return;
      message = opened?.ok ? "Checkout opened in your browser. Return and refresh orders to check payment and delivery." : words(opened);
    } finally { if (current(who, version)) working = false; notify(); }
  }
  function parsePrice(value, policy) {
    if (!policy || typeof value !== "string" || !/^\d{1,16}(?:\.\d{1,3})?$/.test(value) || !Number.isInteger(policy.minorUnit) || policy.minorUnit < 0 || policy.minorUnit > 3 || !Number.isSafeInteger(policy.amountIncrementMinor) || policy.amountIncrementMinor < 1 || !Number.isSafeInteger(policy.minSaleMinor) || policy.minSaleMinor < 1 || !Number.isSafeInteger(policy.maxSaleMinor) || policy.maxSaleMinor < policy.minSaleMinor) return null;
    const [whole, fraction = ""] = value.split("."); if (fraction.length > policy.minorUnit) return null;
    const minor = BigInt(whole) * (10n ** BigInt(policy.minorUnit)) + BigInt(fraction.padEnd(policy.minorUnit, "0") || "0");
    if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(policy.minSaleMinor) || minor > BigInt(policy.maxSaleMinor) || minor % BigInt(policy.amountIncrementMinor) !== 0n) return null;
    return Number(minor);
  }
  function policyMoney(value, p) {
    const scale = 10 ** p.minorUnit, whole = Math.floor(value / scale), fraction = String(value % scale).padStart(p.minorUnit, "0");
    return `${whole.toLocaleString()}${p.minorUnit ? "." + fraction : ""} ${p.code.toUpperCase()}`;
  }
  function sellerSave() {
    if (!actor) return false;
    try { if (!sellerPending) { window.localStorage.removeItem(STORAGE + "seller:" + actor); return true; }
      const value = JSON.stringify(sellerPending); window.localStorage.setItem(STORAGE + "seller:" + actor, value); return window.localStorage.getItem(STORAGE + "seller:" + actor) === value;
    } catch { return false; }
  }
  function restoreSeller() {
    sellerPending = null;
    try {
      const raw = window.localStorage.getItem(STORAGE + "seller:" + actor); if (!raw || raw.length > 1400) return;
      const value = JSON.parse(raw), p = value?.payload;
      if (!["publishListing", "updateListing", "unlistListing"].includes(value?.action) || !p || !ID.test(p.requestId)) return;
      // The native exact schema validates this hint again before any mutation.
      sellerPending = { action: value.action, payload: p };
    } catch { /* A missing hint does not alter server listings or ownership. */ }
  }
  const marketKey = (action) => action === "sellerAssets" ? action + ":" + assetKind : action;
  const marketId = (item) => item.id ?? item.asset?.item?.id ?? item.asset?.id;
  async function loadMarket(action, more = false) {
    if (!available() || working || reading || (["catalog", "listing"].includes(action) ? !hub.commerceCatalog : !hub.commerceSeller)) return;
    const who = actor, version = epoch, kind = assetKind, key = marketKey(action), prior = market[key];
    if (more && !prior?.nextCursor) return;
    const cursor = more ? prior.nextCursor : null;
    working = true; notify();
    try {
      const input = action === "seller" ? {} : { cursor, ...(action === "sellerAssets" ? { kind } : {}) };
      const result = await call(action, input); if (!current(who, version)) return;
      if (!result?.ok) { message = words(result); return; }
      if (action === "seller") { seller = result; if (!seller.pricing.currencies.some((p) => p.code === currency)) currency = seller.pricing.currencies[0]?.code || ""; return; }
      if (more && (result.items.some((i) => prior.items.some((p) => marketId(p) === marketId(i))) || result.nextCursor && prior.visited.has(result.nextCursor))) {
        message = "The service repeated a marketplace page. Refresh this view before continuing."; prior.nextCursor = null; return;
      }
      const visited = more ? new Set(prior.visited) : new Set(); if (cursor) visited.add(cursor);
      market[key] = { items: more ? [...prior.items, ...result.items] : result.items, nextCursor: result.nextCursor, visited };
    } finally { if (current(who, version)) working = false; notify(); }
  }
  async function loadSection(view) {
    if (view === "browse") return loadMarket("catalog");
    if (view === "sell") { await loadSellerSetup(); await loadMarket("seller"); await loadMarket("sellerAssets"); await loadMarket("sellerListings"); }
    else if (view === "orders") return refresh();
  }
  async function inspectListing(id) {
    if (!hub?.commerceCatalog || !available() || working || reading) return;
    const who = actor, version = epoch; working = true; notify();
    try { const result = await call("listing", { listingId: id }); if (!current(who, version)) return; if (result?.ok) { selectedListing = result.listing; selected = null; } else message = words(result); }
    finally { if (current(who, version)) working = false; notify(); }
  }
  async function buyListing(reviewed, owner) {
    if (owner.gone || selectedListing !== reviewed || !hub?.commerceOrders || working || reading) return;
    const who = actor, version = epoch; working = true; notify(); let fresh;
    try { const result = await call("listing", { listingId: reviewed.id }); if (owner.gone || !current(who, version)) return; if (!result?.ok) { message = words(result); return; } fresh = result.listing;
      if (fresh.version !== reviewed.version) { selectedListing = fresh; message = "This listing changed. Review the new item and price before ordering."; fresh = null; }
    } finally { if (current(who, version)) working = false; notify(); }
    if (fresh && !owner.gone && current(who, version)) await prepare(fresh);
  }
  async function sellerMutation(action, payload, owner, retry = false) {
    if (owner.gone || !available() || !hub.commerceSeller || working || reading || !retryReady()) return;
    if (sellerPending && !retry) { message = "Recover the saved listing request before making another change."; notify(); return; }
    let pending = sellerPending;
    if (!retry) {
      let requestId; try { requestId = crypto.randomUUID(); } catch { requestId = null; }
      if (!requestId || !ID.test(requestId)) return;
      pending = { action, payload: { ...payload, requestId } }; sellerPending = pending;
      if (!sellerSave()) { sellerPending = null; message = "Studio could not save the listing recovery reference."; notify(); return; }
    }
    if (!pending) return;
    const who = actor, version = epoch; working = true; notify();
    try {
      const result = await call(pending.action, pending.payload); if (!current(who, version)) return;
      if (!result?.ok) { sellerRefusal = LISTING_NOT_APPLIED.has(result.error) ? { requestId: pending.payload.requestId, code: result.error } : null; message = words(result); retryAt = Date.now() + Math.max(5000, Math.min(3600000, result?.retryAfter || 5000)); return; }
      sellerRefusal = null; sellerPending = null; sellerSave(); selectedAsset = null; priceText = "";
      message = result.listing.status === "listed" ? "Your listing is published with its confirmed price." : "Listing status updated.";
    } finally { if (current(who, version)) working = false; notify(); }
    if (current(who, version) && !sellerPending) await loadSection("sell");
  }
  function saveCountry() {
    if (!actor) return false;
    try {
      const key = STORAGE + "seller-country:" + actor;
      if (!countryPending) { window.localStorage.removeItem(key); return true; }
      const value = JSON.stringify(countryPending); window.localStorage.setItem(key, value); return window.localStorage.getItem(key) === value;
    } catch { return false; }
  }
  function restoreCountry() {
    countryPending = null;
    try {
      const raw = window.localStorage.getItem(STORAGE + "seller-country:" + actor); if (!raw || raw.length > 256) return;
      const v = JSON.parse(raw);
      if (v && Object.keys(v).length === 2 && typeof v.country === "string" && /^[A-Z]{2}$/.test(v.country) && typeof v.requestId === "string" && ID.test(v.requestId)) countryPending = { country: v.country, requestId: v.requestId };
    } catch { /* Only an account-bound declared country and recovery ID are stored. */ }
  }
  async function loadSellerSetup() {
    if (!available() || !hub.commerceSellerSetup || working || reading) return;
    const who = actor, version = epoch; working = true; sellerSetup = null; notify();
    try {
      const result = await call("readSellerSetup", {}); if (!current(who, version)) return;
      if (result?.ok) sellerSetup = result; else message = words(result);
    } finally { if (current(who, version)) working = false; notify(); }
  }
  async function prepareCountry(country, reviewed, owner, retry = false) {
    if (owner.gone || !available() || !hub.commerceSellerSetup || working || reading || !retryReady()) return;
    if (retry ? !countryPending : countryPending || reviewed !== sellerSetup || !reviewed?.canPrepare || !reviewed.countries.includes(country)) return;
    const who = actor, version = epoch; working = true; notify();
    try {
      if (!retry) {
        const fresh = await call("readSellerSetup", {}); if (owner.gone || !current(who, version)) return;
        if (!fresh?.ok) { sellerSetup = null; message = words(fresh); return; }
        sellerSetup = fresh;
        if (!fresh.canPrepare || !fresh.countries.includes(country) || fresh.declaredCountry !== reviewed.declaredCountry) { message = "Seller country setup changed. Review the current declaration before confirming."; return; }
        let requestId; try { requestId = crypto.randomUUID(); } catch { requestId = null; }
        if (!requestId || !ID.test(requestId)) return;
        countryPending = { country, requestId };
        if (!saveCountry()) { countryPending = null; message = "Studio could not save the country request for recovery."; return; }
      }
      const result = await call("prepareSellerSetup", { ...countryPending }); if (!current(who, version)) return;
      if (!result?.ok) { message = words(result); retryAt = Date.now() + Math.max(5000, Math.min(3600000, result?.retryAfter || 5000)); return; }
      countryPending = null; saveCountry(); countryChoice = ""; sellerSetup = null; seller = null;
      message = "Country declaration saved. Refreshing current seller setup before payment onboarding.";
    } finally { if (current(who, version)) working = false; notify(); }
    if (current(who, version) && !countryPending) await loadSection("sell");
  }
  function saveOnboarding() {
    if (!actor) return false;
    try { const value = JSON.stringify(onboardingPending); window.localStorage.setItem(STORAGE + "onboarding:" + actor, value); return window.localStorage.getItem(STORAGE + "onboarding:" + actor) === value; } catch { return false; }
  }
  function restoreOnboarding() {
    onboardingPending = null;
    try {
      const raw = window.localStorage.getItem(STORAGE + "onboarding:" + actor); if (!raw || raw.length > 512) return;
      const v = JSON.parse(raw);
      if (v && typeof v.id === "string" && ID.test(v.id) && ["uncertain", "ready", "opened", "expired"].includes(v.phase) && (v.expiresAt === null || Number.isSafeInteger(v.expiresAt) && v.expiresAt >= 0)) onboardingPending = { id: v.id, phase: v.phase, expiresAt: v.expiresAt };
    } catch { /* Only recovery references are stored; links remain memory-only. */ }
  }
  async function onboard(owner, renew = false) {
    if (owner.gone || !available() || !hub.commerceSeller || !hub.commerceOnboarding || !seller?.onboarding.canStart || countryPending || hub.commerceSellerSetup && !sellerSetup || working || reading || !retryReady()) return;
    const who = actor, version = epoch, reviewed = seller;
    working = true; notify();
    try {
      const status = await call("seller", {}); if (owner.gone || !current(who, version)) return;
      if (!status?.ok) { message = words(status); return; }
      seller = status;
      if (!seller.onboarding.canStart || reviewed.onboarding.state !== seller.onboarding.state) { message = "Seller setup changed. Review the current status before continuing."; return; }
      if (renew && onboardingPending && !["opened", "expired"].includes(onboardingPending.phase) && !(onboardingPending.expiresAt !== null && onboardingPending.expiresAt <= Date.now())) return;
      if (!onboardingPending || renew) {
        let id; try { id = crypto.randomUUID(); } catch { id = null; } if (!id || !ID.test(id)) return;
        onboardingPending = { id, phase: "uncertain", expiresAt: null };
        if (!saveOnboarding()) { onboardingPending = null; message = "Studio could not save the setup recovery reference."; return; }
      }
      const pending = onboardingPending;
      const result = await call("onboarding", { requestId: pending.id }); if (!current(who, version)) return;
      if (!result?.ok) {
        if (result?.error === "onboarding_link_expired") { pending.phase = "expired"; saveOnboarding(); }
        message = words(result); retryAt = Date.now() + Math.max(5000, Math.min(3600000, result?.retryAfter || 5000)); return;
      }
      pending.expiresAt = result.expiresAt; pending.phase = result.expiresAt <= Date.now() ? "expired" : "ready"; saveOnboarding();
      if (owner.gone || pending.phase === "expired") { message = "This setup link expired. You can explicitly request a fresh one."; return; }
      let opened; try { opened = await api().hubCommerceOpen("onboarding", result.url, who); } catch { opened = { ok: false, error: "browser_unavailable" }; }
      if (!current(who, version)) return;
      if (opened?.ok) { pending.phase = "opened"; saveOnboarding(); message = "Secure seller setup opened in your browser. Return and refresh seller setup to check readiness."; }
      else message = words(opened);
    } finally { if (current(who, version)) working = false; notify(); }
  }
  function listen() {
    if (listening) return; listening = true;
    api()?.onHubEvent?.((event) => { if (event?.type !== "status") return; hubRevision += 1; takeHub(event.status); notify(); if (cards.size && available()) void refresh(); });
    const returned = () => { if (cards.size && document.visibilityState !== "hidden" && !working) void refresh().then(async () => { for (const card of cards) await card.reload?.(); }); };
    window.addEventListener?.("focus", returned); document.addEventListener?.("visibilitychange", returned);
  }
  function card() {
    const root = node("section", "commerce"); root.setAttribute("aria-label", "Cash marketplace");
    const owner = { gone: false, paint, reload: () => loadSection(view) }; let view = "browse", listingReview = null, unlistReview = null, countryReview = null;
    const button = (label, run, disabled = false) => { const who = actor, version = epoch; const b = node("button", "commerce-button", label); b.type = "button"; b.disabled = disabled; b.addEventListener("click", () => { if (!b.disabled && !owner.gone && who === actor && version === epoch) return run(); }); return b; };
    function orderDetail(o) {
      const box = node("article", "commerce-detail");
      const title = { quoted: "Review your order", creating: "Checkout is being prepared", awaiting_payment: "Awaiting payment confirmation", fulfilled: "Delivered", closed: "Order closed", review: "Payment or delivery needs review" }[o.state];
      box.append(node("p", "commerce-eyebrow", title), node("h3", "", o.listing.name), node("p", "commerce-note", o.orderId));
      const q = o.quote, terms = node("dl", "commerce-terms");
      const line = (label, value) => terms.append(node("dt", "", label), node("dd", "", value));
      line("Item price", money(q.saleMinor, q.currency, q.minorUnit));
      line("Tax", q.taxStatus === "pending" ? "Calculated at secure checkout" : money(q.taxMinor, q.currency, q.minorUnit));
      line("Buyer processing fee", money(q.buyerFeeMinor, q.currency, q.minorUnit));
      if (q.totalMinor !== null) line("Confirmed quote total", money(q.totalMinor, q.currency, q.minorUnit));
      line("Studio seller commission", `${percent(o.commission.basisPoints)} · ${money(o.commission.amountMinor, q.currency, q.minorUnit)}`);
      box.append(terms, node("p", "commerce-note", "The Studio commission is deducted from the seller's sale. It is not added to your item price."));
      if (o.commission.schedule === "commission-5-10-15-v3") box.append(node("p", "commerce-note", "The seller also pays the actual verified payment processing cost from their proceeds. That cost is confirmed after payment; it is not a buyer surcharge or an estimated deduction here."));
      if (q.taxStatus === "pending") box.append(node("p", "commerce-notice", "Tax and the final amount appear in secure checkout before you confirm payment."));
      if (o.settlement) box.append(node("p", "commerce-total", `Verified payment: ${money(o.settlement.totalMinor, o.settlement.currency, o.settlement.minorUnit)} · tax ${money(o.settlement.taxMinor, o.settlement.currency, o.settlement.minorUnit)}`));
      if (o.receipt) box.append(node("p", "commerce-note", `Delivered ${date(o.receipt.deliveredAt)}. Item reference: ${o.receipt.reference}.`));
      if (o.settlement && !o.receipt) box.append(node("p", "commerce-notice", "Payment is verified. Delivery is still being resolved; do not pay again."));
      if (o.needsReview || o.state === "review") box.append(node("p", "commerce-notice", "This order needs payment, refund, dispute, or delivery review. Keep the order reference for support. Refreshing does not issue another payment."));
      if (o.state === "quoted") box.append(node("p", "commerce-note", `Unstarted quote valid until ${date(o.expiresAt)}.`));
      const actions = node("div", "commerce-actions");
      if (checkoutAllowed(o)) actions.append(button(o.state === "quoted" ? "Continue to secure checkout" : "Continue existing checkout", () => checkout(o, owner), working || Boolean(reading)));
      actions.append(button("Refresh this order", () => inspect(o.orderId), working || Boolean(reading)));
      box.append(actions); return box;
    }
    function assetSummary(asset) {
      const box = node("div", "commerce-asset");
      if (asset.type === "collectible-instance") {
        const item = asset.item, art = node("div", "commerce-art");
        if (item.kind === "sticker") { const sticker = window.MefiCollectibles?.renderSticker?.(item); if (sticker) art.append(sticker); }
        else { const canvas = node("canvas"); canvas.width = 240; canvas.height = 150; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `${item.name}, ${item.rarity} ${item.stage} pet`); art.append(canvas); try { window.MefiPets?.paintPreview?.(canvas, { ...item, time: 0 }); } catch {} }
        box.append(art, node("h3", "", item.name), node("p", "commerce-note", `${item.rarity === "none" ? "Original" : item.rarity} · quality ${item.quality}/100 · ${item.stage} · ${item.size}`),
          node("p", "commerce-note", item.blurb), node("p", "commerce-note", `Exact instance ${item.id} · design ${item.definitionId}`),
          node("p", "commerce-note", `Traits: ${item.traits.length ? item.traits.map((t) => t.name).join(", ") : "None yet"}. Born ${date(item.bornAt)}. ${item.careDays} care days. Unlocked sizes: ${item.unlockedSizes.join(", ")}.`));
        if (item.tradeHoldUntil) box.append(node("p", "commerce-note", `Recorded trade hold ends ${date(item.tradeHoldUntil)}.`));
      } else {
        box.append(node("h3", "", asset.name), node("p", "commerce-note", asset.description), node("p", "commerce-note", `${asset.type === "community-pack-license" ? "Community pack license" : "Studio catalog license"} · ${asset.id}`));
        if (asset.preview.kind === "palette") {
          const swatches = node("div", "commerce-swatches");
          for (const [name, color] of Object.entries(asset.preview.palette)) { const chip = node("span", "commerce-swatch"); chip.style.backgroundColor = color; chip.title = `${name}: ${color}`; chip.setAttribute("aria-label", chip.title); swatches.append(chip); }
          box.append(swatches);
        } else box.append(node("p", "commerce-note", `Local catalog category: ${asset.preview.catalogKind}.`));
      }
      return box;
    }
    function listingCard(l, own = false) {
      const box = node("article", "commerce-order"); box.append(assetSummary(l.asset), node("p", "commerce-price", money(l.saleMinor, l.currency, l.minorUnit)), node("p", "commerce-note", `By ${l.seller.name}`));
      if (!own) box.append(button("Review listing", () => inspectListing(l.id), working || Boolean(reading)));
      else {
        box.append(node("p", "commerce-note", `Listing ${l.status}${l.reason === "origin_review_required" ? " · Original acquisition needs review" : ""}`));
        const actions = node("div", "commerce-actions");
        actions.append(button("Change cash price", () => { selectedAsset = { asset: l.asset, eligibility: { canList: true, reason: null }, listingId: l.id, listingRecord: l }; currency = l.currency; const p = seller?.pricing.currencies.find((c) => c.code === currency); priceText = p ? (BigInt(l.saleMinor) / 10n ** BigInt(p.minorUnit)).toString() + (p.minorUnit ? "." + (BigInt(l.saleMinor) % 10n ** BigInt(p.minorUnit)).toString().padStart(p.minorUnit, "0") : "") : ""; listingReview = null; paint(); }, !seller?.canList || working || Boolean(reading)));
        if (l.status === "listed") actions.append(button("Unlist", () => { unlistReview = { listing: l, actor, epoch }; paint(); }, working || Boolean(reading)));
        box.append(actions);
      }
      return box;
    }
    function browseParts(content) {
      if (!hub.commerceCatalog) { content.append(node("p", "commerce-empty", "The cash catalog is not available on this connection yet.")); return; }
      content.append(button("Refresh marketplace", () => loadMarket("catalog"), working || Boolean(reading)));
      const page = market.catalog, grid = node("div", "commerce-orders");
      for (const l of page?.items || []) grid.append(listingCard(l)); content.append(grid);
      if (!page?.items.length) content.append(node("p", "commerce-empty", working ? "Loading creations…" : "No eligible cash listings are available right now."));
      if (page?.nextCursor) content.append(button("More creations", () => loadMarket("catalog", true), working || Boolean(reading)));
      if (selectedListing) {
        const l = selectedListing, detail = node("article", "commerce-detail");
        detail.append(assetSummary(l.asset), node("p", "commerce-price", `${money(l.saleMinor, l.currency, l.minorUnit)} item price`), node("p", "commerce-note", `Seller: ${l.seller.name}. Listing ${l.id}.`),
          node("p", "commerce-note", l.kind === "collectible-instance" ? "You receive this existing instance with its current rarity, traits and growth. This purchase does not roll a new rarity." : "Review the exact pack or catalog license before ordering."),
          button("Review order and fees", () => buyListing(l, owner), !hub.commerceOrders || working || Boolean(reading)));
        if (!hub.commerceOrders) detail.append(node("p", "commerce-note", "Purchases are not enabled on this connection."));
        content.append(detail);
      }
      if (selected) content.append(orderDetail(selected));
    }
    function priceForm(content) {
      if (!selectedAsset || !seller) return;
      const box = node("article", "commerce-detail"), chosen = selectedAsset;
      box.append(assetSummary(chosen.asset));
      const form = node("div", "commerce-form"), currencyLabel = node("label", "", "Currency"), select = node("select", "commerce-input");
      for (const p of seller.pricing.currencies) { const o = node("option", "", p.code.toUpperCase()); o.value = p.code; o.selected = p.code === currency; select.append(o); }
      select.value = currency; currencyLabel.append(select); form.append(currencyLabel);
      const priceLabel = node("label", "", "Fixed item price"), input = node("input", "commerce-input"); input.type = "text"; input.inputMode = "decimal"; input.value = priceText; input.placeholder = "Enter an exact price"; priceLabel.append(input); form.append(priceLabel);
      const hint = node("p", "commerce-note"), review = button("Review listing", () => {
        const policy = seller.pricing.currencies.find((p) => p.code === currency), saleMinor = parsePrice(priceText, policy); if (saleMinor === null || !seller.canList) return;
        listingReview = { selectedAsset: chosen, currency, saleMinor, policy: copy(policy), fee: copy(seller.fee) }; paint();
      }, true);
      const update = () => { const p = seller.pricing.currencies.find((c) => c.code === currency); const amount = parsePrice(priceText, p); hint.textContent = p ? `Allowed: ${policyMoney(p.minSaleMinor, p)} to ${policyMoney(p.maxSaleMinor, p)}. At most ${p.minorUnit} fractional digits; increments of ${money(p.amountIncrementMinor, p.code, p.minorUnit)}.` : "No reviewed currency is configured."; review.disabled = amount === null || !seller.canList || working || Boolean(reading) || Boolean(sellerPending); };
      select.addEventListener("change", () => { currency = select.value; listingReview = null; update(); }); input.addEventListener("input", () => { priceText = input.value; listingReview = null; update(); }); update();
      box.append(form, hint, review, node("p", "commerce-note", "Cash price changes create a new listing version. Published crate prices and rarity chances remain locked."));
      if (listingReview?.selectedAsset === chosen) {
        const r = listingReview, confirm = node("div", "commerce-notice");
        confirm.append(node("p", "", `Publish ${policyMoney(r.saleMinor, r.policy)} item price. Studio seller commission: ${r.fee.state === "known" ? percent(r.fee.basisPoints) : "awaiting verification"}.`),
          button(chosen.listingRecord ? "Confirm price change" : "Confirm publication", () => {
            if (listingReview !== r) return;
            const assetId = chosen.asset.item?.id ?? chosen.asset.id;
            return sellerMutation(chosen.listingRecord ? "updateListing" : "publishListing", chosen.listingRecord
              ? { listingId: chosen.listingRecord.id, listingVersion: chosen.listingRecord.version, currency: r.currency, saleMinor: r.saleMinor }
              : { assetType: chosen.asset.type, assetId, currency: r.currency, saleMinor: r.saleMinor }, owner);
          }, working || Boolean(reading) || !seller.canList || r.fee.state !== "known")); box.append(confirm);
      }
      content.append(box);
    }
    function sellParts(content) {
      content.append(button("Refresh seller setup", () => loadSection("sell"), working || Boolean(reading)));
      if (hub.commerceSellerSetup) {
        const setup = node("article", "commerce-detail");
        setup.append(node("h3", "", "Seller country"), node("p", "commerce-note", "Declare your country of residence or legal business establishment. Stripe verifies identity and bank details during hosted onboarding."));
        if (!sellerSetup) setup.append(node("p", "commerce-note", "Refresh seller setup to read enabled countries."));
        else {
          setup.append(node("p", "commerce-note", sellerSetup.declaredCountry ? "Current declared country: " + sellerSetup.declaredCountry + "." : "No country has been declared."));
          if (sellerSetup.locked) setup.append(node("p", "commerce-note", "This declaration is locked because payment account preparation has started."));
          else if (!sellerSetup.canPrepare) setup.append(node("p", "commerce-note", words({ error: sellerSetup.reason })));
          if (sellerSetup.canPrepare && !countryPending) {
            const label = node("label", "", "Declared country"), select = node("select", "commerce-input"); select.setAttribute("aria-label", "Declared country");
            const empty = node("option", "", "Choose a country"); empty.value = ""; select.append(empty);
            for (const code of sellerSetup.countries) { const option = node("option", "", code); option.value = code; select.append(option); }
            select.value = sellerSetup.countries.includes(countryChoice) ? countryChoice : "";
            select.disabled = working || Boolean(reading);
            select.addEventListener("change", () => { countryChoice = select.value; countryReview = null; paint(); });
            label.append(select); setup.append(label, button("Review country declaration", () => { countryReview = { country: countryChoice, setup: sellerSetup, actor, epoch }; paint(); }, !sellerSetup.countries.includes(countryChoice) || working || Boolean(reading)));
          }
        }
        if (countryPending) setup.append(node("p", "commerce-note", "The declaration for " + countryPending.country + " has not been confirmed. Keep its original request until the service confirms it."),
          button("Recover country declaration", () => prepareCountry(null, null, owner, true), working || Boolean(reading)));
        if (countryReview && countryReview.actor === actor && countryReview.epoch === epoch && countryReview.setup === sellerSetup && !countryPending) {
          const review = countryReview;
          setup.append(node("p", "commerce-notice", "Save " + review.country + " as your declared country? It becomes locked when payment account preparation starts."),
            button("Confirm country declaration", () => prepareCountry(review.country, review.setup, owner), working || Boolean(reading)),
            button("Cancel country declaration", () => { countryReview = null; paint(); }));
        }
        content.append(setup);
      }
      if (!hub.commerceSeller) { content.append(node("p", "commerce-empty", "Seller setup and listings are not available on this connection yet.")); return; }

      if (!seller) { content.append(node("p", "commerce-empty", "Refresh to check your seller eligibility.")); return; }
      const status = node("article", "commerce-detail"); status.append(node("h3", "", seller.canSell ? "Seller checkout ready" : "Seller setup pending"), node("p", "commerce-note", `Studio commission: ${seller.fee.state === "known" ? percent(seller.fee.basisPoints) : "verification pending"}.`), node("p", "commerce-note", `Payment account: ${seller.onboarding.state}.`));
      status.append(node("p", "commerce-note", "The displayed commission is not a confirmed net payout. Processing costs follow each order's accepted policy; unknown costs are not treated as zero."));
      if (seller.onboarding.canStart && !countryPending && (!hub.commerceSellerSetup || sellerSetup)) {
        status.append(node("p", "commerce-note", "Payment-account setup opens on the provider's website. Studio does not collect bank details."));
        if (hub.commerceOnboarding) {
          const renewal = onboardingPending && (["opened", "expired"].includes(onboardingPending.phase) || onboardingPending.expiresAt !== null && onboardingPending.expiresAt <= Date.now());
          status.append(button(renewal ? "Open a fresh setup link" : onboardingPending ? "Continue existing setup" : "Set up seller payments", () => onboard(owner, Boolean(renewal)), working || Boolean(reading)));
        } else status.append(node("p", "commerce-note", "Secure seller onboarding is not supported by this connection yet."));
      }
      if (!seller.canList) status.append(node("p", "commerce-notice", "Your current account or payment setup cannot publish cash listings yet. Existing assets remain in your collection."));
      if (sellerPending) {
        status.append(button("Recover saved listing request", () => sellerMutation(null, null, owner, true), working || Boolean(reading)));
        if (sellerRefusal?.requestId === sellerPending.payload.requestId) {
          status.append(node("p", "commerce-notice", "The service confirmed this listing request did not apply: " + sellerRefusal.code.replaceAll("_", " ") + "."));
          status.append(button("Review current listing terms", async () => {
            sellerPending = null; sellerRefusal = null; sellerSave(); selectedAsset = null; selectedListing = null;
            listingReview = null; unlistReview = null; priceText = ""; message = "Review the current asset and price, then confirm a new request.";
            await loadSection("sell");
          }, working || Boolean(reading)));
        }
      }
      content.append(status);
      const choices = node("div", "commerce-actions");
      for (const [kind, label] of [["collectible-instance", "Pets and stickers"], ["community-pack-license", "Community packs"]]) { const b = button(label, () => { assetKind = kind; selectedAsset = null; listingReview = null; paint(); void loadMarket("sellerAssets"); }, working || Boolean(reading)); b.setAttribute("aria-pressed", String(assetKind === kind)); choices.append(b); } content.append(choices);
      const page = market[marketKey("sellerAssets")], assets = node("div", "commerce-orders");
      for (const a of page?.items || []) { const box = node("article", "commerce-order"); box.append(assetSummary(a.asset));
        if (!a.eligibility.canList) box.append(node("p", "commerce-note", a.eligibility.reason === "origin_review_required" ? "Original acquisition needs review before cash resale. Your item is still yours." : "This asset is currently unavailable for cash listing."));
        box.append(button("Set a cash price", () => { selectedAsset = a; listingReview = null; priceText = ""; paint(); }, !a.eligibility.canList || !seller.canList || Boolean(a.listingId) || working || Boolean(reading))); assets.append(box); }
      content.append(assets); if (!page?.items.length) content.append(node("p", "commerce-empty", "No assets in this view."));
      if (page?.nextCursor) content.append(button("More owned assets", () => loadMarket("sellerAssets", true), working || Boolean(reading)));
      priceForm(content);
      content.append(node("h3", "", "Your cash listings")); const listed = market.sellerListings, grid = node("div", "commerce-orders");
      for (const l of listed?.items || []) grid.append(listingCard(l, true)); content.append(grid);
      if (listed?.nextCursor) content.append(button("More of your listings", () => loadMarket("sellerListings", true), working || Boolean(reading)));
      if (unlistReview && unlistReview.actor === actor && unlistReview.epoch === epoch) { const l = unlistReview.listing, confirm = node("div", "commerce-notice"); confirm.append(node("p", "", `Unlist ${l.name}? Pending purchases can keep this item reserved until their payment outcome is verified.`), button("Confirm unlist", () => sellerMutation("unlistListing", { listingId: l.id, listingVersion: l.version }, owner), working || Boolean(reading)), button("Keep listing", () => { unlistReview = null; paint(); })); content.append(confirm); }
    }
    function paint() {
      if (owner.gone) return;
      root.setAttribute("aria-busy", String(working || Boolean(reading)));
      const header = node("header", "commerce-head"), navigation = node("div", "commerce-actions");
      header.append(node("p", "commerce-eyebrow", "MEMBER MARKETPLACE"), node("h2", "", "Creations worth collecting"), node("p", "commerce-note", "Buy creator goods and trade the exact pets and stickers you own. Credits and cash purchases stay separate."));
      for (const [id, label] of [["browse", "Browse"], ["sell", "Sell"], ["orders", "My orders"]]) { const b = button(label, () => { view = id; paint(); void loadSection(view); }); b.setAttribute("aria-pressed", String(view === id)); navigation.append(b); }
      const content = node("div", "commerce-content"), status = node("p", "commerce-message", message); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      if (!available()) content.append(node("p", "commerce-empty", !actor ? "Sign in to your Studio account in Friends to open your marketplace." : "Cash marketplace is not available on this connection yet."));
      else if (view === "browse") browseParts(content);
      else if (view === "sell") sellParts(content);
      else if (!hub.commerceOrders && !hub.commerceRetireOrders) content.append(node("p", "commerce-empty", "Order recovery is not supported by this connection yet."));
      else {
        const filters = node("div", "commerce-actions");
        for (const [id, label] of [["pending", "Pending orders"], ["history", "All orders"]]) { const b = button(label, () => { scope = id; selected = null; nextCursor = null; orders = []; void refresh(); }, working || Boolean(reading)); b.setAttribute("aria-pressed", String(scope === id)); filters.append(b); }
        filters.append(button("Refresh orders", () => { message = ""; return refresh(); }, working || Boolean(reading))); content.append(filters);
        for (const d of Object.values(drafts)) {
          content.append(button(d.orderId ? "Recover " + d.orderId : "Recover saved request for " + d.listingId, () => recover(d), !hub.commerceOrders || working || Boolean(reading)));
          if (!d.orderId && hub.commerceRetireOrders) content.append(button("Resolve saved request", () => resolveRequest(d), working || Boolean(reading)));
        }
        if (!orders.length) content.append(node("p", "commerce-empty", reading ? "Checking your orders…" : "No orders in this view."));
        const list = node("div", "commerce-orders");
        for (const o of orders) { const row = node("article", "commerce-order"); row.append(node("h3", "", o.listing.name), node("p", "commerce-note", `${o.state.replaceAll("_", " ")} · ${money(o.quote.saleMinor, o.quote.currency, o.quote.minorUnit)} item price`), button("View order", () => inspect(o.orderId), working || Boolean(reading))); list.append(row); }
        content.append(list);
        if (nextCursor) content.append(button("More orders", () => refresh({ more: true }), working || Boolean(reading)));
        if (selected) content.append(orderDetail(selected));
      }
      root.replaceChildren(header, navigation, content, status);
    }
    cards.add(owner); listen(); paint(); void refresh().then(() => { if (!owner.gone) return loadSection(view); });
    root.dispose = () => { if (owner.gone) return; owner.gone = true; cards.delete(owner); };
    return root;
  }
  window.MefiCommerce = { card, refresh, prepare, parsePrice };
})();