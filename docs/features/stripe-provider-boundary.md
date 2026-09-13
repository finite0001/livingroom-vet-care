# Stripe server boundary

Status: shared provider module and tests only. No deployed payment endpoint, webhook inbox, staff payment UI, live keys or actual Stripe transactions are included in this increment.

`supabase/functions/_shared/stripe-provider.ts` creates fixed USD/card Checkout Sessions from an already committed immutable ledger intent. It verifies the configured account before every provider operation, pins API version `2026-08-26.dahlia`, and refuses wrong-mode credentials. Payments remain disabled unless `STRIPE_PAYMENTS_ENABLED=true`; commissioning also requires `STRIPE_SECRET_KEY`, `STRIPE_ACCOUNT_ID`, explicit `STRIPE_LIVEMODE=true|false` and an exact HTTPS `STRIPE_RETURN_ORIGIN`.

Return destinations are exactly `/payment/return` and `/payment/cancel` on that origin. These are future neutral return routes, not implemented client status capabilities. Never infer payment from arrival at either route.

Provider requests carry only an opaque request UUID, source hash and generic payment description. They omit clinical details, client email and staff refund reasons. A request freezes amount, expiry and idempotency key. Creation retries stop before the ledger retry deadline and when the frozen expiry is less than 31 minutes away. Retrieve known sessions/refunds rather than recreating them. Every unsuccessful mutation response remains uncertain; no automatic POST retry or invoice unlock occurs in this module.

Normalized session evidence requires matching mode, amount, currency, request/source, fixed expiry and no secondary invoice or recovered session. Only a complete, paid session with a payment intent yields successful-payment evidence. Open-session URLs must use Stripe's checkout origin and stay transient; raw customer/provider payloads must not be persisted or returned by handlers. Refund normalization keeps pending/requires-action separate from settled cash and binds the refund to its exact request and captured payment.

Raw-body webhook HMAC verification checks a five-minute timestamp tolerance, rejects duplicate timestamps and oversized payloads, and supports multiple v1 signatures during key rotation. This alone does not provide durable ingestion or account/mode/event validation: those belong to the next handler/inbox increment.

Validation: 14 focused provider tests cover account/mode rejection, exact retry parameters, malicious redirects, near-expiry requests, uncertain network/provider outcomes, signature tampering/replay, mismatched session evidence and partial refund states. Deno type-check passes. No test invokes Stripe or substitutes for the planned actual sandbox acceptance.

References checked September 12, 2026:
- [Stripe API changelog](https://docs.stripe.com/changelog)
- [Checkout creation](https://docs.stripe.com/api/checkout/sessions/create)
- [Idempotency](https://docs.stripe.com/api/idempotent_requests)
- [Webhook verification](https://docs.stripe.com/webhooks)
- [Refund objects](https://docs.stripe.com/api/refunds/object)
