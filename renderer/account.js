// Reachable Studio sign-in controls. Only native public status crosses the bridge;
// no provider URL, callback state, verifier or credential enters this renderer.
(() => {
  "use strict";
  const cards = new Set(), api = () => window.mefiStudio;
  const node = (tag, text, cls = "") => { const el = document.createElement(tag); el.textContent = text; el.className = cls; return el; };
  let state = null, busy = false, listening = false, revision = 0, feedback = "";
  const ERRORS = {
    unavailable: "Google sign-in is not configured for this connection yet.",
    unsupported: "This connection does not support Studio accounts yet.",
    auth: "Studio could not verify this sign-in. Start again when ready.",
    expired: "Your Studio sign-in expired. Sign in again to continue.",
    identity_already_linked: "This Google account belongs to a separate Studio account. No accounts or balances were merged.",
    admission_migration_required: "Your existing account needs a service migration before it can be linked.",
    legacy_account_migration_required: "Your existing account history needs migration and review before linking. Your saved account and history have been kept.",
    legacy_wallet_migration_required: "Your existing wallet and purchase history need migration and review before linking. Your saved account and history have been kept.",
    canceled: "Sign-in canceled.", storage: "Studio could not safely save this sign-in.",
    network: "Sign-in was not confirmed. Start a fresh sign-in when ready.",
  };
  const notify = () => { for (const card of cards) card.paint(); };
  const take = (next) => { if (next && typeof next === "object") { state = next; revision++; notify(); } };
  async function refresh() {
    const mine = revision;
    try { const result = await api()?.studioAccount?.("status"); if (mine === revision && result?.ok) take(result.status); } catch {}
  }
  async function run(action, onSignedIn) {
    if (busy && action !== "cancel") return;
    busy = true; feedback = ""; notify();
    try {
      const result = await api()?.studioAccount?.(action);
      if (result?.status) take(result.status);
      feedback = result?.ok ? action === "signOut" ? "Signed out of Studio on this PC." : "" : ERRORS[result?.error] || "The account action did not finish.";
      if (result?.ok && result.status?.linked && result.status?.socialAccess === true) onSignedIn?.();
    } catch { feedback = ERRORS.network; }
    finally { busy = false; notify(); }
  }
  function card({ onSignedIn, compact = false } = {}) {
    const root = node("section", "", "community-account"); root.setAttribute("aria-label", "Studio account");
    const referrals = compact ? null : window.MefiReferrals?.card?.({ accountStatus: () => state });
    const entry = { paint, root }; cards.add(entry);
    const button = (label, action, disabled = false) => { const el = node("button", label, "ghost"); el.type = "button"; el.disabled = disabled; el.addEventListener("click", () => { if (!el.disabled) void run(action, onSignedIn); }); return el; };
    function paint() {
      root.replaceChildren(node("h3", "Studio account"));
      const detail = node("p", feedback || ERRORS[state?.error] || (state?.state === "waitlisted" ? "You are on the Studio waitlist at position " + state.waitlistPosition + ". Social rooms, Shop and cash trading become available when you are admitted." : state?.linked ? "Signed in as " + state.user.name + "." : state?.signingIn ? "Continue in your browser, then return to Studio." : state?.configured ? "Use Google for your Studio account, or link it to the account you already use." : ERRORS.unavailable));
      detail.setAttribute("role", "status"); root.append(detail);
      const actions = node("div", "", "community-row");
      if (state?.signingIn) actions.append(button("Cancel Google sign-in", "cancel"));
      else {
        actions.append(button(state?.linked ? "Switch Google account" : "Sign in with Google", "google", busy || !state?.configured));
        if (!compact) {
          actions.append(button("Link Google to my existing account", "linkGoogle", busy || !state?.configured));
          if (state?.selected) actions.append(button("Sign out of Studio", "signOut", busy), button("Use my linked Discord account", "useDiscord", busy));
        }
      }
      root.append(actions);
      if (referrals) { referrals.accountChanged?.(state); root.append(referrals); }
      else if (compact && window.MefiReferrals) {
        const link = node("button", "Referral rewards", "ghost"); link.type = "button";
        link.addEventListener("click", () => window.MefiReferrals.open()); root.append(link);
      }
      if (!compact) root.append(node("p", "Linking keeps one Studio account. Separate existing accounts are never merged automatically. Your Discord link remains available.", "muted"));
    }
    root.dispose = () => { referrals?.dispose?.(); cards.delete(entry); };
    if (!listening) { listening = true; api()?.onStudioAccount?.(take); }
    paint(); void refresh(); return root;
  }
  window.MefiAccount = { card, refresh, status: () => state };
})();