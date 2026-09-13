# Private client payment and status pages

The browser isolates collection (`/pay/:grantId`), scoped return/cancel (`/payment/return/:grantId`, `/payment/cancel/:grantId`) and neutral v1 return/cancel routes before importing the staff application. Query strings and fragments are removed immediately. Payment pages do not initialize staff Auth, marketing fonts, application query caches, browser storage, analytics, or messaging.

Collection capabilities use `p1.` plus 43 base64url characters; scoped status capabilities use the separate `s1.` format. A mutable bootstrap access object lets Close and pagehide erase the token rather than retaining it in immutable React props. Bootstrap installs pagehide cleanup before the page's dynamic import. Invalid routes/capability families never make a payment request. Reloading the sanitized URL requires reopening the original message.

## Client actions

- **Open payment** sends only an inspect request to `payment-collection`. No provider activation occurs on mount, opening, or scanning the URL.
- **Continue to secure payment** explicitly activates the same collection grant. A successful `checkout_ready` response must include `collection_available: true` and a valid `https://checkout.stripe.com/c/pay/…` URL before **Open Stripe Checkout** appears. The client must explicitly open that link.
- **Check payment status** and **Refresh confirmed status** read server-confirmed ledger state. They never activate Checkout. Inspect can remain available after collection expiry/revocation until the separate status deadline, without enabling payment.
- Neutral `/payment/return` and `/payment/cancel` pages instruct clients to use the original practice link or contact the practice. They never derive paid, canceled, or failed status from navigation, query flags, session IDs, or fragments.

Requested amount, confirmed paid and confirmed refunded amounts are displayed separately using exact USD cent strings and BigInt formatting. Partial refund and full refund labels must agree with the confirmed cash fields. Confirmation pending and reconciliation remain explicit; neither is presented as payment failure or success.

## Request and response limits

The helpers use only the configured Supabase origin, omit credentials and authorization, reject redirects, disable cache and referrers, enforce a 15-second deadline, and limit JSON to 16 KiB with strict UTF-8 and MIME checking. Only the documented coarse fields are accepted; invoice/client IDs, patient details, unexpected currency, malformed amounts and Checkout URLs outside activation are rejected. Collection responses require an explicit boolean availability flag.

Close/pagehide abort in-flight work, clear amounts/URLs and erase the capability. Late results cannot restore a closed page. Every subsequent read clears the previously exposed Checkout URL. Vercel configuration supplies no-store/no-referrer/noindex headers on collection and both neutral/scoped return/cancel routes; the page also installs no-referrer and robots metadata before loading its UI.

## Evidence and remaining rollout

Unit tests cover route/capability separation, exact amounts, response privacy, refund-state consistency, safe Stripe URLs, bounded request options and malformed response rejection. Browser tests cover explicit inspect/activate, no Auth/marketing/storage use, query/fragment removal, scoped partial refunds, neutral v1 returns, collection unavailability with status access, malicious URLs, failed access, in-flight Close, pagehide cleanup and existing private-document route regression.

These are synthetic API contract tests. They do not prove provider payment/refund acceptance, live deployment/header behavior, backend capability authorization, reviewed staff delivery, or production commissioning. Public endpoints remain separately controlled by the backend's default-off switches.
