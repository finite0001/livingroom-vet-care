# Invoice payment ledger and durable Checkout intent

This is the PostgreSQL foundation of the payment plan, not a commissioned Stripe payment feature. No provider requests, keys, webhook endpoint, client Checkout page, actual payment or refund acceptance are included here.

## Accounting behavior

Amounts are USD integer cents. Obligation is the issued invoice total less accounting credits. Net cash is confirmed payments less confirmed refunds. Outstanding is the positive difference between obligation and net cash. Refundable capacity is cash above obligation, less outstanding refund reservations. A service adjustment therefore requires a credit before a refund; pending or failed refunds never reduce confirmed cash.

An invoice row lock serializes Checkout preparation, credits, voids, payment application and refund reservation. An unresolved Checkout prevents another collection, credit or void. Only accepted provider expiration or payment evidence releases that collection constraint. A timeout, old creation timestamp or client return URL cannot declare an attempt expired or paid. Payment history permanently blocks voiding the invoice. Credits remain available after settlement.

Provider context mismatches are appended as quarantined receipts and visibly place the attempt in reconciliation without silently posting cash. Successful payments are unique by account, mode and provider PaymentIntent. Refunds are unique by provider refund and request. Late expiration/failure events cannot erase successful money movement. A success after a previously terminal failed refund is quarantined because a replacement refund may already have reserved that capacity.

Quarantine resolution is deliberately not implemented in this increment. Such attempts continue blocking collection and need a later reviewed provider-reconciliation workflow. This is a remaining operational requirement, not an instruction to edit history manually.

## RPC contract

Authenticated active staff:

- `read_invoice_payment_state(p_invoice_id, p_client_id)` returns `source_hash`, `balance`, attempts, payments, refund requests and provider evidence. Balance and JSON context amounts are strings containing integer cents.
- `prepare_invoice_checkout(p_request_id, p_invoice_id, p_client_id, p_source_hash, p_amount_cents, p_account_id, p_livemode, p_success_url, p_cancel_url)` returns the immutable Checkout row. Exact retries require the original actor and every original parameter. The amount must equal the currently reviewed outstanding balance and be between 50 and 99,999,999 cents. The source hash includes invoice documents, credits and cash state, independently of invoice version.
- `prepare_invoice_refund(p_request_id, p_invoice_id, p_payment_id, p_amount_cents, p_reason)` returns an immutable refund reservation. `p_payment_id` is the internal ledger UUID. Exact retry is actor-bound. The request reserves both invoice-level excess cash and the particular captured payment's remaining capacity.

The two preparation RPCs return composite rows: their SQL `bigint` amount appears as a JSON number through PostgREST. Checkout is bounded below JavaScript's exact integer limit and refund amounts cannot exceed that captured payment. State/context RPCs explicitly serialize amounts as strings.

Service-only:

- `configure_payment_provider(p_account_id, p_livemode, p_return_origin)` installs one immutable account/mode/origin profile. There is no default profile. The schema permits exactly one profile, so staff cannot select another historical account or mode. Sandbox-to-live transition requires a separately reviewed configuration migration/process.
- `checkout_payment_context(p_request_id, p_actor_id)` and `refund_payment_context(p_request_id, p_actor_id)` validate the originating active staff actor for staff-facing recovery.
- `provider_checkout_context(p_request_id)` and `provider_refund_context(p_request_id)` support signed-provider reconciliation independently of the originating actor's current employment status. Checkout context includes accepted `session_id`, settled `payment_id`, derived state and `current_source_matches`. Refund context includes `provider_payment_id`, account, mode, currency and accepted `refund_id`.
- `apply_checkout_evidence(p_event_id, p_request_id, p_account_id, p_livemode, p_kind, p_session_id, p_payment_id, p_amount_cents, p_currency, p_source_hash)` accepts `session_open`, `session_expired`, `payment_succeeded`, or `reconciliation`. Its returned immutable receipt has `disposition` (`accepted` or `quarantined`) and a machine-readable reason.
- `apply_refund_evidence(p_event_id, p_request_id, p_account_id, p_livemode, p_refund_id, p_provider_payment_id, p_amount_cents, p_currency, p_status)` accepts `pending`, `failed`, or `succeeded` and returns the analogous receipt.

Service-only functions are authorization boundaries, not signature validators. The Edge layer must verify signatures/provider identity, preserve durable receipt before acknowledgement, retrieve authoritative provider objects and pass normalized evidence. It must never infer payment from browser redirects.

## Frozen provider parameters

The profile allows only exact `<return_origin>/payment/return` and `<return_origin>/payment/cancel` destinations. It defaults empty and creates no provider configuration outside PostgreSQL. Checkout freezes a stable `lrv-checkout-<UUID>` idempotency key, creation time, provider session expiry at creation + 2 hours and retry horizon at creation + 23 hours. Refunds freeze `lrv-refund-<UUID>` and the same retry horizon.

The adapter must refuse creation retries when the frozen session expiry is too close to Stripe's minimum, or after the idempotency retry horizon, and retrieve/reconcile the existing session instead. An existing accepted session identifier is available from context. No hosted Checkout URL, card data or token is stored in these tables. No network call holds a database transaction open.

## Verification

`supabase/tests/payment_ledger.test.sql` passed 64 rollback-only pgTAP assertions on the local foundation database, including actual staff claims, household scope, immutable writes, configured return destinations, account/mode checks, replay, expiration/payment ordering, refund reservations, quarantines and reconciliation after staff deactivation. Existing inventory/billing regression tests passed 58 assertions.

`python3 scripts/verify-payment-concurrency.py` passed three actual two-session PostgreSQL races: Checkout versus credit, competing Checkout preparations and competing refund reservations. Each observes the competing session waiting on a database lock before checking the final result. It targets only the named local foundation container, refuses an existing payment provider profile, creates synthetic UUID fixtures and removes only those fixtures. It does not reset the environment. Do not run this local fixture harness against a hosted database.

Provider handlers, staff/client UI, reviewed payment-link delivery, quarantine resolution, real sandbox payment/refund/webhook acceptance and live commissioning remain required by the full rollout plan.
