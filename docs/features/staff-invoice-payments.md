# Staff invoice payments and refunds

The issued/void invoice view includes a payment panel backed by `read_invoice_payment_state`. It displays credits, obligation, confirmed payments, confirmed refunds, net cash, outstanding amount, refund reservations, and refundable excess cash separately. Missing or malformed data is unavailable, never an invented zero balance. USD cent strings are formatted with BigInt; the bounded preparation RPC responses are checked as exact numeric cents.

Staff read the immutable `payment_provider_profiles` row through active-staff RLS. An empty profile explicitly requires setup and disables new preparation. The panel never invents an account, mode, or return origin. Checkout destinations derive from the configured origin's `/payment/return` and `/payment/cancel` paths. Deployment of those public routes and provider commissioning remain separate work.

## Preparation and provider actions

Staff review the current balance before preparing Checkout for the entire outstanding amount. Refund preparation requires a selected captured payment, a positive amount within credited excess cash, and a reason. A fresh server read must have the same source hash as the displayed review before creating either intent; the database also serializes financial mutations and checks capacity.

Before a preparation RPC, the exact original arguments and UUID are retained in actor-scoped session storage. They contain no Checkout URL or provider token. Auth transitions/signout clear other actors' intents. A lost preparation response is reconciled against the same invoice's authoritative history; an absent ambiguous request remains available for exact retry. Confirmed database preparation clears the local pending record and leaves the durable request selectable in history.

Preparing does not contact Stripe. The saved request requires another explicit amount/action attestation before **Create or recover this same Stripe Checkout**, **Expire this Stripe Checkout**, or **Submit or recover this same Stripe refund**. The `recover` provider action may create the originally prepared request if Stripe has no known object ID; the UI deliberately does not describe it as a read-only operation. Initial loading and **Recover recorded payment state** call only database reads.

The Checkout URL is accepted only from `https://checkout.stripe.com/c/pay/…`, retained in component memory, and exposed by an explicit **Open Stripe Checkout** link. URLs are cleared before provider actions and on selection changes; they do not enter query caches, session storage, application message history, or a delivery workflow. No payment links are sent by this increment.

Paid/expired Checkout and succeeded/failed refund history remains visible. Reconciliation observations and quarantined states block new collection/refund actions without hiding confirmed cash. No control pretends to resolve quarantines. Only the original active staff actor can invoke recovery for their saved provider request; other staff can inspect its ledger status.

## Draft and accounting protection

Unsent refund/payment drafts, in-flight operations and uncertain responses participate in the invoice parent's dirty guard, including invoice switching and email/SMS preparation. Confirmed durable requests can be left without losing their history; database locks and unresolved-request guards remain authoritative for credits, voids and competing collection. The UI does not infer settlement from navigation, browser flags or a success redirect.

## Validation scope

Synthetic browser tests cover normal/lost-before-save/lost-after-save preparation, same-UUID reload/retry, lost provider responses, explicit provider actions, transient URL retention, expiry, credit-backed refund reservation and confirmed cash changes, empty configuration, disabled provider handlers, reconciliation blocks and invoice draft guards. Unit tests cover exact string-cent display, provider/return URL validation, composite receipt numeric types, invoice/staff identity, malformed state and auth cleanup. Existing invoice email and document SMS browser tests protect the shared parent integration.

These tests make no external Stripe calls or money movements. They establish staff UI behavior against the documented ledger/handler contracts, not actual sandbox acceptance, live collection, clinical approval, provider configuration or reconciliation resolution.
