# One-time invoice payments through Stripe

Status: implementation contract; not a working payment feature or live commissioning approval.

## Confirmed context

The owner selected a new dedicated Living Room Vet Stripe account. The Stripe connector now exposes only `The Living Room Vet sandbox`, account `acct_1UF1ewGUaxUNX5Ol`, livemode false. This account is distinct from the practice dashboard account and must not be silently replaced with an unrelated account or live mode. No secret keys, customer transactions or webhooks were created during this planning step.

Stripe implementation planner guide `iguide_61VOQV4Y7Kd3h3T5I41GUaxUNX5Ol` accepted hosted Checkout for a web-based one-time collection flow. Living Room Vet remains the invoice/clinical record system. Do not create duplicate Stripe invoices or reusable Payment Links. Start with USD card payments for the reviewed outstanding balance; retain the full launch requirement for payment history, refunds, failure recovery and reviewed email/SMS delivery.

## Financial state and concurrency

- Add append-only payment/refund/provider-event evidence and a durable checkout attempt with actor, invoice/client identity, exact amount, currency, source hash, request UUID, provider account/mode and timestamps. Do not store patient names, diagnoses, clinical services or documents in Stripe metadata. Use opaque internal references and a generic payment description.
- Amounts use integer cents. Outstanding balance derives from issued invoice total, accounting credits, settled collections and successful refunds according to an explicit ledger policy. Refunds return money; credits reduce what is owed. A refund must not silently reopen a settled invoice for recollection. Refund-only corrections and credit-plus-refund adjustments need distinct reviewed intents.
- Serialize checkout creation, credits, voids and payment application on the invoice row. One unresolved or active collection attempt per invoice. A local timeout never means Stripe did not create a session.
- Freeze checkout parameters before the network call, with an opaque idempotency key. Recover the exact committed attempt before making a new request. Stripe may prune idempotency keys after 24 hours: stop automatic creation retries before that horizon and require provider reconciliation, never generate a fresh key for an uncertain attempt.
- Credits/voids must not race an open checkout. Block financial changes while collection is unresolved. Expire the provider session, retrieve its authoritative state and reconcile any payment that won the race before releasing the invoice lock or allowing a new checkout. Provider network calls must not hold a database transaction open.
- Successful webhook evidence is applied once with unique account/event and payment identifiers. Late expired/failed events cannot overwrite settled evidence. Reject amount/currency/account/mode/source mismatches into a visible reconciliation queue. A browser success redirect is not proof of payment.

## Provider boundary

Use server-only Stripe keys, an explicit expected account and mode, a pinned API version, and a default-off payment switch. Verify account identity when commissioning. No card data enters the application. Checkout has fixed quantities/amounts; no promotion codes, adjustable quantity, tips or automatic changes to the reviewed balance. Tax treatment remains the practice's reviewed billing configuration; do not invent tax rules in this integration.

Webhook handling verifies the raw body signature and timestamp before durable receipt; preserve only necessary structured payment data, with strict size limits. Deduplicate retries and acknowledge only after durable storage. Process using an authenticated service worker, retrieve current provider objects where needed, and record reconciliation outcomes atomically. Unsupported events cannot mutate invoice balances. Require explicit sandbox/live separation at every boundary.

Refunds require staff review of the specific captured payment, refundable amount and reason; stable request IDs; provider idempotency; pending/failed/succeeded evidence and webhook reconciliation. Concurrent refunds cannot exceed the settled refundable amount. Do not mark refunds successful from a transport timeout or a mere accepted request. Preserve audit history for manual reconciliation.

## UI and delivery

Staff see the invoice, credits, paid/refunded amounts, outstanding obligation, pending checkout/refund and unresolved provider events. Preparation, recovery and cancellation remain available after source changes. Dirty drafts and uncertain responses block accidental replacement. Client return pages display confirmed status through a scoped capability, never through a client-supplied paid flag or an exposed unscoped invoice UUID.

Payment links use the existing reviewed email/SMS outbox with explicit recipient/consent checks and an immutable delivery intent. Prevent duplicate sends on lost acknowledgements. A document-view link is not a checkout link, and an invoice or accounting credit is not a payment receipt. Provider receipts and application communication history must remain distinguishable.

## Delivery and evidence

1. Payment ledger/checkout intent and invoice locking, rollback-only SQL and concurrent writer tests.
2. Server Checkout creation/recovery/expiry, signed durable webhook ingestion and reconciliation; actual handler tests for duplicates, out-of-order events, lost responses and account/mode/amount mismatch.
3. Staff payment/recovery/refund UI and reviewed email/SMS delivery, client status return flow; browser tests for dirty and uncertain state.
4. Actual authorized sandbox Checkout, payment and refund with provider object reconciliation and webhook evidence. No synthetic test can replace this acceptance. Then prepare explicit live-account/key/webhook configuration and controlled launch review.

The rollout remains incomplete until all increments and actual acceptance are demonstrated. Do not present a ledger-only or mock-provider implementation as payment readiness.

## Primary references checked during planning

- [Hosted Checkout integration](https://docs.stripe.com/payments/accept-a-payment?payment-ui=checkout&ui=stripe-hosted), selected by the account-scoped Stripe implementation planner.
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests): identical retry parameters and retention limitations require durable application recovery.
- [Expire a Checkout Session](https://docs.stripe.com/api/checkout/sessions/expire): only open sessions can be expired; completed sessions must be reconciled.
- [Stripe webhooks](https://docs.stripe.com/webhooks): signature verification, durable event processing and account-scoped event configuration.
