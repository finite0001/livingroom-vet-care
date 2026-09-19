# Durable Stripe event inbox

This migration adds the database receipt/worker boundary for payment processing. The HTTP signature verifier, provider adapter and deployed worker belong to the separate Edge increment. No Stripe webhook was registered, no secrets were stored and no provider traffic was sent by this database work.

## Receipt contract

Service-only `receive_stripe_event(p_receipt jsonb)` accepts exactly ten fields, at most 4 KiB encoded:

```ts
interface StripeReceipt {
  event_id: string;
  event_type: string;
  provider_created_at: number;
  account_id: string;
  livemode: boolean;
  object_id: string | null;
  request_id: string | null;
  raw_sha256: string;
  disposition: 'queued' | 'quarantined' | 'ignored';
  reason: string;
}
```

The HTTP layer must verify the raw signature and timestamp before calling this RPC. The RPC cannot itself establish authenticity. It validates identifiers, field types and lengths, allowed disposition/reason values and the commissioned singleton account/mode. A queued Checkout/refund must reference the corresponding immutable request. Missing configuration, unsupported queued types or unknown requests become durable quarantine rather than cash movement.

The returned UUID identifies the immutable receipt. Repeated account/mode/event identifiers must match event type, provider creation time, object, request and original disposition/reason. A different valid raw-body hash is allowed for the same semantic envelope because delivery formatting and unused Stripe fields can vary. The first raw hash remains unchanged. Conflicting identity fields fail explicitly. The actual stored disposition may be more restrictive than the original supplied disposition; both are retained for exact retry comparison.

Only the minimal envelope and SHA-256 are stored. Full provider payloads, client Checkout URLs, card data and arbitrary provider error text are rejected. Receipt and worker history are append-only. Staff reads are RLS-restricted; worker lease tokens are unavailable to staff.

## Worker contract

`claim_stripe_event()` returns null or `{ receipt, lease_token, lease_expires_at, attempt_count }`. It claims one due row using `FOR UPDATE SKIP LOCKED`, with a two-minute lease. An expired lease is reclaimable. At most five claims are permitted; an expired fifth claim becomes quarantine.

`finish_stripe_event(p_receipt_id, p_lease_token, p_evidence)` verifies the current unexpired lease, matching receipt object, account/mode and allowed event family. It invokes the payment ledger evidence function and marks work completed or quarantined in one database transaction. A failure rolls back both changes. Unknown keys are rejected, including a transient `client_url` returned by the provider adapter.

Checkout evidence:

```ts
interface CheckoutEvidence {
  family: 'checkout';
  account_id: string;
  livemode: boolean;
  kind: 'session_open' | 'session_expired' | 'payment_succeeded' | 'reconciliation';
  session_id: string;
  payment_id: string | null;
  amount_cents: string;
  currency: string;
  source_hash: string;
}
```

Refund evidence:

```ts
interface RefundEvidence {
  family: 'refund';
  account_id: string;
  livemode: boolean;
  refund_id: string;
  provider_payment_id: string;
  amount_cents: string;
  currency: string;
  status: 'pending' | 'failed' | 'succeeded';
}
```

Amounts are decimal integer-cent strings of at most eight digits. Explicit quarantine uses `{ family: 'quarantine', reason }`; allowed reasons are `provider_context_mismatch`, `provider_object_unavailable`, `unattributed_provider_object`, `unsupported_event`, `external_adjustment_review`, and `provider_reconciliation_required`.

`retry_stripe_event(p_receipt_id, p_lease_token, p_reason)` accepts only `provider_unavailable`, `rate_limited`, `transport_unknown`, or `processing_error`. It releases the current lease, schedules exponential backoff (60, 120, 240, 480 seconds), and quarantines after the fifth claim. It never posts payment or refund money.

`read_stripe_event_queue(p_limit default 100)` provides active staff with receipt and work state, capped at 250 records. It excludes lease tokens. A production reconciliation UI and reviewed resolution actions remain required; no function in this increment silently clears quarantine or invents settlement.

## Verification

The rollback-only `supabase/tests/stripe_event_inbox.test.sql` passed 44 pgTAP assertions against actual local PostgreSQL. These cover signature-boundary permissions, typed envelopes, semantic duplicate handling with differing raw SHA, conflicting object rejection, stale leases, atomic payment/refund completion, URL rejection, retry delay/reclaim/exhaustion, account/unsupported/unattributed quarantine, RLS and immutable history.

The local `scripts/verify-payment-concurrency.py` passed four actual two-session checks. Alongside the three payment ledger races, two workers claimed distinct Stripe receipts while the first transaction still held its row lock, proving the `SKIP LOCKED` behavior. Synthetic fixtures were removed and the existing environment was not reset.

These tests establish local database behavior. They do not replace signed HTTP tests, actual Stripe sandbox payment/refund acceptance or launch commissioning.
