# Membership desktop boundary

Shop's Membership view displays the authenticated Hub's current membership,
permanent Donor history and current offer. Paid, lifetime and unexpired intro
membership provide the same active creator benefits. Donor history alone does
not prove an active membership. The service supplies every entitlement and
price; the client has no default price, renewal discount or grant operation.

The Hub must advertise `billing.1`. Its bounded status includes the server
clock, membership kind and recorded end, optional offer, permitted actions,
and any pending Checkout request. New purchases can be disabled while status
and customer billing management remain available. Offline, expiration,
payment-review and unavailable states remain explicit.

| Desktop action | Fixed route | Request |
| --- | --- | --- |
| `status` | `GET /v1/billing/status` | No account selector or body |
| `checkout` | `POST /v1/billing/checkout` | Exactly `{requestId}` |
| `portal` | `POST /v1/billing/portal` | Exactly `{requestId}` |

`scripts/billing-contract.cjs` rejects extra request fields, malformed status
and unsafe browser URLs. The native Hub client supplies POST Origin from its
trusted HTTPS Hub configuration; the renderer cannot choose it. There is no
HTTP fallback or automatic credential renewal and purchase replay after 401.

Checkout uses only `https://checkout.stripe.com`; billing management uses only
`https://billing.stripe.com`. Native opening additionally requires an unused,
matching issued link, the current account and connection, and a five-minute
ticket. Status events invalidate issued tickets. URLs stay in memory and are
not saved as recovery state. The same account's original cryptographic request
ID survives a lost reply and restart; another account cannot reuse that state.
Server pending status can restore the request after local state is lost.

Offer or pending-request changes require another explicit review. Expiring
and payment-review Checkout states do not allow a replacement purchase.
Returning from a browser refreshes authoritative status and never grants
membership or ownership. `MEFI_STUDIO_BILLING=0` disables desktop billing.

The private service owns payment verification, benefits, provider objects,
credentials and policy. The public client contains none of that authority.
Installing it does not activate Checkout. Cash creator sales, resale of
existing crate-earned instances and seller onboarding are separate launch
requirements; the Membership boundary does not implement those flows.
