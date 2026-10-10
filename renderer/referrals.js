// One Account home for referral rewards. Saved tuples contain no credentials.
(() => {
  "use strict";
  const AP = "accounts.canonical.1", CODE = /^ref_[a-f0-9]{64}$/, REQUEST = /^[A-Za-z0-9_-]{8,80}$/;
  const ACTOR = /^(?:\d{17,20}|studio:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
  const homes = new Set(), api = () => window.mefiStudio;
  let listening = false;
  const el = (tag, text = "", cls = "") => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
  const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const keys = (v, fields) => plain(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v,k));
  const tuple = (v, redeem) => v === null || keys(v, redeem ? ["code","requestId"] : ["requestId"]) && typeof v.requestId === "string" && REQUEST.test(v.requestId) && (!redeem || typeof v.code === "string" && CODE.test(v.code));
  const readyActor = s => s?.state === "ready" && s.actorProtocol === AP && s.referralInvitations === true && typeof s.user?.id === "string" && ACTOR.test(s.user.id) ? s.user.id : null;
  const ERRORS = {
    referrals_unavailable:"Referrals are not available on this connection.",
    referral_authority_unavailable:"Referral progress could not be verified. Refresh when the connection is ready.",
    referral_policy_unresolved:"Referrals are awaiting service configuration.",
    read_only:"New referral requests are paused. Saved requests can still be recovered.",
    referral_capacity_reached:"This account reached its referral request capacity. Contact support; waiting will not reset it.",
    referral_rate_limited:"Please wait before trying again.",
    referral_already_recorded:"An invitation is already recorded for this account.",
    self_referral:"You cannot redeem your own invitation.",
    referral_invitation_unavailable:"That invitation is expired or unavailable.",
    referral_request_conflict:"This saved request conflicts with the service record. Keep it for support to review.",
    unauthorized:"Sign in again to the same account, then recover this saved request.",
    admission_required:"Referral invitations become available after admission.",
    verified_identity_required:"The service needs to verify this Studio account first.",
    stale_account:"The account changed. This request remains saved for its original account.",
    storage:"Studio could not safely save this request on this PC. No new request was sent.",
  };
  function card({ accountStatus = () => window.MefiAccount?.status?.() } = {}) {
    const root = el("details", "", "community-referrals"), title = el("summary", "Referral rewards"), body = el("div");
    root.setAttribute("aria-label", "Referral rewards"); root.append(title, body);
    let disposed = false, epoch = 0, actor = null, view = null, busy = false, reading = false, message = "", draft = "", accountKey = null, hubKey = null;
    let pending = {issue:null,redeem:null}, storageError = false, refusal = null, retryAt = 0;
    const entry = { open: () => { root.open = true; void load(); root.scrollIntoView?.({block:"nearest"}); } }; homes.add(entry);
    const fingerprint = s => [s?.selected,s?.linked,s?.signingIn,s?.user?.id,s?.state,s?.socialAccess,s?.error].join("|");
    const hubFingerprint = s => [s?.state,s?.actorProtocol,s?.user?.id,s?.referralInvitations].join("|");
    function invalidate() {
      epoch++; actor = null; view = null; busy = false; reading = false; message = ""; draft = ""; refusal = null; retryAt = 0;
      pending = {issue:null,redeem:null}; storageError = false; paint();
    }
    root.accountChanged = s => {
      const next = fingerprint(s);
      if (next !== accountKey) { accountKey = next; invalidate(); if (root.open) void load(); }
    };
    const key = who => "mefi.referrals.pending.v1:" + who;
    function restore(who) {
      try {
        const raw = window.localStorage.getItem(key(who)); if (raw === null) return {issue:null,redeem:null};
        if (raw.length > 2048) throw Error("large");
        const v = JSON.parse(raw); if (!keys(v,["issue","redeem"]) || !tuple(v.issue,false) || !tuple(v.redeem,true)) throw Error("invalid");
        return v;
      } catch { storageError = true; return {issue:null,redeem:null}; }
    }
    function save(next) {
      try {
        const value = JSON.stringify(next); window.localStorage.setItem(key(actor),value);
        if (window.localStorage.getItem(key(actor)) !== value) throw Error("not saved");
        pending = next; return true;
      } catch { storageError = true; message = ERRORS.storage; return false; }
    }
    const current = (mine,who) => !disposed && mine === epoch && actor === who;
    function closedReason() {
      const state = accountStatus();
      if (state?.state === "waitlisted") return "Referral invitations become available after admission. Your waitlist position is " + state.waitlistPosition + ".";
      if (state?.signingIn) return "Finish or cancel your sign-in before using referrals.";
      if (state?.selected && (!state.linked || state.socialAccess !== true)) return "Sign in to an admitted Studio account to use referrals.";
      return null;
    }
    async function load() {
      if (disposed || !root.open || reading || busy) return;
      const closed = closedReason(); if (closed) { message = closed; paint(); return; }
      const mine = epoch; reading = true; paint();
      try {
        const answer = await api()?.hubStatus?.(); if (disposed || mine !== epoch) return;
        const next = readyActor(answer?.status); hubKey = hubFingerprint(answer?.status);
        if (!next) { actor = null; view = null; message = "Connect to an admitted Studio account with referrals enabled."; return; }
        if (actor !== next) { actor = next; view = null; draft = ""; refusal = null; retryAt = 0; storageError = false; pending = restore(next); }
        const result = await api()?.hubReferrals?.("readReferralStatus",{},next);
        if (!current(mine,next)) return;
        if (result?.ok) view = result;
        else { view = null; message = ERRORS[result?.error] || "Referral progress could not be loaded. Refresh to try again."; }
      } catch { if (mine === epoch) { view = null; message = "Referral progress could not be loaded. Refresh to try again."; } }
      finally { if (!disposed && mine === epoch) { reading = false; paint(); } }
    }
    async function mutate(kind) {
      if (busy || reading || !actor || storageError || closedReason()) return;
      if (Date.now() < retryAt) { message = "Please wait until the service retry period ends, then recover the saved request."; paint(); return; }
      const who = actor, mine = epoch, action = kind === "issue" ? "issueReferralInvitation" : "redeemReferralInvitation";
      let input = pending[kind];
      if (!input) {
        if (!(kind === "issue" ? view?.canIssue : view?.canRedeem)) return;
        const code = draft.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g,"");
        if (kind === "redeem" && !CODE.test(code)) { message = "Enter the exact referral code, starting with ref_. Room invite codes and links do not work here."; paint(); return; }
        let requestId; try { requestId = crypto.randomUUID(); } catch {}
        if (typeof requestId !== "string" || !REQUEST.test(requestId)) { message = ERRORS.storage; paint(); return; }
        input = kind === "issue" ? {requestId} : {code,requestId};
        if (!save({...pending,[kind]:input})) { paint(); return; }
      }
      input = {...input}; busy = true; refusal = null; message = ""; paint();
      try {
        const status = await api()?.hubStatus?.();
        if (!current(mine,who)) return;
        if (readyActor(status?.status) !== who || closedReason()) { invalidate(); message = ERRORS.stale_account; paint(); return; }
        const result = await api()?.hubReferrals?.(action,input,who);
        if (!current(mine,who)) return;
        if (result?.ok === true) {
          if (!save({...pending,[kind]:null})) return;
          message = kind === "issue" ? result.expiresAt <= Date.now() ? "The saved invitation was recovered, but has expired. Review current availability before creating another." : "Invitation ready. Copy it below and share it with a friend."
            : "Invitation recorded. Your account will be evaluated by Studio; this does not promise an immediate discount.";
          draft = ""; view = null;
        } else {
          message = ERRORS[result?.error] || "The outcome is unknown. Recover this saved request before starting another.";
          if (Number.isSafeInteger(result?.retryAfter) && result.retryAfter >= 1000 && result.retryAfter <= 3600000) retryAt = Date.now() + result.retryAfter;
          if (kind === "redeem" && keys(result,["ok","error","outcome","requestId"]) && result.ok === false
            && ["self_referral","referral_already_recorded","referral_invitation_unavailable"].includes(result.error)
            && result.outcome === "not-applied" && result.requestId === input.requestId) refusal = {requestId:input.requestId};
        }
      } catch { if (current(mine,who)) message = "The outcome is unknown. Recover this saved request before starting another."; }
      finally {
        if (current(mine,who)) { busy = false; paint(); if (!pending[kind]) void load(); }
      }
    }
    const button = (text, fn, disabled = false) => {
      const b = el("button",text,"ghost"); b.type = "button"; b.disabled = disabled;
      b.addEventListener("click",() => { if (!b.disabled) void fn(); }); return b;
    };
    async function copy() {
      const code = view?.invitation?.code, mine = epoch, who = actor;
      if (!code || view.invitation.expiresAt <= Date.now()) { message = "This invitation expired. Refresh before creating another."; paint(); return; }
      try { await navigator.clipboard.writeText(code); if (current(mine,who)) message = "Referral code copied. Share it with your friend."; }
      catch { if (current(mine,who)) message = "Copy the referral code shown above."; }
      if (current(mine,who)) paint();
    }
    function paint() {
      body.replaceChildren();
      const info = el("p",closedReason() || message || (reading ? "Loading referral progress…" : "Invite friends with your referral code. Five qualifying Studio accounts unlock the inviter commission rate."));
      info.setAttribute("role","status"); body.append(info);
      if (closedReason()) return;
      body.append(button("Refresh referrals",load,busy || reading));
      if (!actor) return;
      if (storageError) body.append(el("p",ERRORS.storage));
      if (view) {
        body.append(el("p",view.qualifyingInvitees + " of " + view.threshold + " qualifying Studio accounts. " + (view.qualified ? "Your inviter discount is active." : "Your inviter discount is not active.")));
        body.append(el("p","Studio verifies account admission. Opening a room invitation does not count. Current seller fees are shown in the cash marketplace.","muted"));
        if (view.invitation) {
          const code = el("code",view.invitation.code); code.style.overflowWrap = "anywhere"; body.append(code,button("Copy referral code",copy,busy));
          body.append(el("p","Expires " + new Date(view.invitation.expiresAt).toLocaleString() + ".","muted"));
        }
      }
      if (pending.issue) {
        body.append(el("p","An invitation request is saved for this account. Recover it using the same request."));
        body.append(button("Recover saved invitation",() => mutate("issue"),busy || reading || storageError));
      } else if (!view?.invitation) {
        body.append(button("Create referral invitation",() => mutate("issue"),busy || reading || storageError || !view?.canIssue));
        if (view?.issueReason) body.append(el("p",ERRORS[view.issueReason] || ERRORS.referrals_unavailable));
      }
      if (pending.redeem) {
        body.append(el("p","A redemption request is saved for this account. Recover it before entering another code."));
        const code = el("code",pending.redeem.code); code.style.overflowWrap = "anywhere"; body.append(code);
        body.append(button("Recover saved redemption",() => mutate("redeem"),busy || reading || storageError));
        if (refusal?.requestId === pending.redeem.requestId) body.append(button("Review another code",() => {
          if (save({...pending,redeem:null})) { refusal = null; draft = ""; message = "Studio confirmed the saved request did not apply. Review and confirm a new code below."; void load(); } paint();
        },busy || reading || storageError));
      } else if (view?.attributionRecorded) body.append(el("p",ERRORS.referral_already_recorded));
      else {
        const label = el("label","A friend's referral code"), input = el("input");
        input.type = "text"; input.value = draft; input.maxLength = 80; input.setAttribute("aria-label","A friend's referral code");
        input.disabled = busy || reading || storageError || !view?.canRedeem;
        input.addEventListener("input",() => { draft = input.value; }); label.append(input); body.append(label);
        body.append(button("Confirm referral code",() => mutate("redeem"),busy || reading || storageError || !view?.canRedeem));
        if (view?.redeemReason) body.append(el("p",ERRORS[view.redeemReason] || ERRORS.referrals_unavailable));
      }
    }
    entry.hear = event => {
      if (disposed || event?.type !== "status") return;
      const next = hubFingerprint(event.status); if (next === hubKey) return;
      hubKey = next; invalidate(); if (root.open) void load();
    };
    if (!listening) { listening = true; api()?.onHubEvent?.(event => { for (const home of homes) home.hear?.(event); }); }
    root.addEventListener("toggle",() => { if (root.open) void load(); });
    root.dispose = () => { disposed = true; epoch++; homes.delete(entry); };
    root.accountChanged(accountStatus()); paint(); return root;
  }
  function open() { window.MefiCommunity?.open?.(); for (const home of homes) home.open(); }
  window.MefiReferrals = {card,open};
})();
