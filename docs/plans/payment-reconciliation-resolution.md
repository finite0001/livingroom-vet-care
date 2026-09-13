# Reviewed payment reconciliation resolution

Status: **planned, not implemented**. Defer implementation until the reviewed public payment endpoint increment is integrated. This document does not commission a provider or authorize a live financial action.

## Scope and authorization

Add an audited resolution workflow for fully attributed existing Checkout and refund objects. There must be no generic “clear block” action and no manual “mark paid” control. Application financial facts remain append-only and provider money movement must be supported by verified provider evidence.

An active administrator may prepare and complete a review, including reconciliation of a request whose originating employee is inactive. The administrator who prepared a review must complete its exact captured proof; takeover should require a new review. Ordinary active staff may read appropriate invoice history but cannot resolve financial blocks. Every staff write is scoped to the verified signed-in actor; all provider evidence capture is service-only.

The first increment supports matching provider objects and bounded retry-exhaustion recovery. Unknown creation, absence claims, external adjustments and disputed money remain unresolved. This boundary must remain explicit in the UI and rollout tracker; it is not full operational acceptance of all reconciliation scenarios.

## Proposed durable records

Use immutable review cases, provider captures and blocker-resolution links. Each case freezes its reviewer, invoice/request identity, family, provider object identifier, explicit blocker references and a hash of the relevant current financial facts. Blocker references identify the original observation, quarantined ledger evidence or Stripe receipt; they cannot mean “all present and future problems on this invoice.”

Provider captures contain only normalized verified facts: account and mode, object and request identity, amount and currency, required metadata, canonical provider status, observation time and proof hash. Do not store raw provider payloads, Checkout URLs, credentials or arbitrary provider error text. Fresh provider retrieval happens outside the database transaction.

Resolution appends links to the precise reviewed blocker IDs. Original quarantine evidence, observations and receipt disposition are never rewritten. Review UI must show both original evidence and its resolution. New conflicting evidence after resolution remains independently actionable.

## Proposed RPC contract

### Staff review

`prepare_payment_reconciliation(p_case_id, p_invoice_id, p_family, p_request_id, p_provider_object_id, p_blocker_refs, p_expected_case_hash)`

- Requires active ADMIN and attributes the case to the signed-in administrator.
- Validates the request's invoice, family and provider object attribution.
- Freezes exact arguments under a stable request UUID; retry with different arguments fails.
- Captures the relevant current financial facts and explicit unresolved blockers. No network request or money posting occurs here.

`complete_payment_reconciliation(p_case_id, p_reviewed_proof_hash, p_expected_case_hash, p_attest)`

- Requires the active administrator who prepared the case and explicit attestation to the exact captured proof.
- Locks the invoice, rechecks the financial snapshot and blocker set, and rejects new or changed evidence that invalidates the review.
- Requires a fresh verified provider capture. A five-minute proof lifetime is the proposed initial operational limit, subject to implementation review; elapsed time never proves non-creation or non-payment.
- Derives financial evidence exclusively from the capture. The caller cannot supply an amount, paid flag or replacement status.
- Applies ordinary ledger evidence using a stable `reconcile:<case_id>` observation identifier, preserving existing provider-ID uniqueness and mismatch guards. An already quarantined original event ID must not be reused with altered evidence.
- Only after successful evidence application or verification does it append resolutions for the reviewed blockers, atomically with the ledger action. Failure leaves both money and resolution unchanged.

### Service capture

`capture_payment_reconciliation(p_case_id, p_reviewer_id, p_provider_evidence)`

- Service-only, with active-reviewer and immutable-case checks.
- Accepts a fresh server-retrieved provider object normalized under the pinned API/account/mode boundary. SQL service access is not itself a provider signature or authenticity check.
- Requires exact request metadata, provider object attribution, currency and amount. Every resolved conflict must be addressed by this proof; a matching different object cannot disprove the original conflicting object.
- A replacement capture requires a new explicit review/proof hash. It cannot silently change a previously reviewed plan.

### Audited inbox retry

`requeue_stripe_event(p_resolution_id, p_receipt_id, p_expected_work_hash, p_reason, p_attest)`

- Separate active-admin action for attributable retry exhaustion caused by a recoverable processing/provider failure.
- Rejects stale work state, active leases, unknown attribution and unresolved financial mismatches.
- Preserves the immutable receipt and every earlier lease/attempt record. Append an explicit retry cycle and apply the same bounded claim allowance within that cycle; do not erase prior attempts by silently resetting counters.
- Does not itself apply money or declare a receipt financially resolved. The worker must retrieve current provider state and complete under its new lease.

## Allowed resolution outcomes

| Verified provider result | Permitted effect |
| --- | --- |
| Matching Checkout open | Restore provider recovery while retaining the invoice collection lock. |
| Matching Checkout expired and unpaid | Release the collection lock using accepted provider expiration evidence. |
| Matching Checkout paid | Apply or verify ordinary exactly-once payment evidence, then resolve the addressed blockers. |
| Matching refund pending | Restore recovery while retaining its reservation. |
| Matching refund failed or canceled | Release its reservation using accepted terminal provider evidence. |
| Matching refund succeeded | Apply or verify ordinary refund evidence without duplicating cash or pending reservation. |

A successful proof must still pass existing ledger guards. In particular, source/amount/account mismatch, duplicate-object attribution and refund success after a prior failure released capacity are not overridden by administrator attestation.

## Cases that remain blocked

- A timed-out creation with no securely attributed provider object, especially beyond the retained idempotency horizon.
- Missing object, guessed identifier, 404, elapsed deadline or local logs offered as proof that no provider object was created.
- Source, amount, currency, mode or account mismatch that cannot pass ordinary ledger evidence rules.
- Multiple payment/refund objects or conflicting attribution; proving one correct object does not negate another potential money movement.
- A late refund success after terminal failure released its reservation, possibly allowing a replacement refund.
- Disputes, external refunds/adjustments and other unsupported financial events.

These need separate evidence-backed workflows. Do not invent provider facts or remove reservations simply to make an invoice actionable.

## Existing call sites to change

These references identify current behavior by migration/function rather than proposing edits to already-applied migrations; implementation must use a new migration.

- `20260913330000_payment_reconciliation_observations.sql`: `checkout_state_internal` and `refund_state_internal` must consider unresolved observation/evidence IDs instead of every historical quarantine.
- The same migration's `guard_payment_reconciliation` must query unresolved invoice blockers.
- `record_payment_reconciliation` must stop treating `(family, request_id, reason)` as lifetime uniqueness. Reuse an existing open occurrence, but append a new occurrence if that reason returns after resolution. Preserve all earlier rows; serialize occurrence creation on the invoice.
- `read_invoice_payment_state` must expose resolution metadata alongside full history and separately identify unresolved blockers.
- `20260913340000` payment collection access: `inspect_payment_collection` must replace its raw observation-existence check with the same unresolved-blocker semantics.
- `src/hub/features/payments/InvoicePayments.tsx`: blocking must no longer depend on historical `reconciliation_observations.length`; use unresolved status while retaining resolved history for review.
- `20260913310000_stripe_event_inbox.sql`: claim/retry/history functions and queue reads must support explicit audited retry cycles without removing exhausted history or reusing stale leases.

Preserve the 3300 corrections: refund late-success protection checks immutable accepted failed evidence directly, and settled refunds are excluded from pending reservations even during reconciliation. Review `prepare_invoice_refund`, balance projections and collection eligibility after changing derived state helpers so presentation changes cannot alter cash truth.

## Required validation

1. Exact review and completion replay changes cash once and returns the original resolution.
2. New evidence or a new blocker arriving during review invalidates completion; it is not swept into a prior approval.
3. A resolved reason recurring produces a new active blocker despite identical family/request/reason.
4. Matching open/pending resolution preserves locks/reservations; matching expired/failed resolution releases only the appropriate constraint.
5. Resolving an already succeeded refund does not count it again as pending reserved cash.
6. Failed refund, replacement reservation, observation, then late success remains quarantined and cannot silently over-refund.
7. Wrong provider object/account/mode/amount/source, cross-invoice references and stale proof cannot resolve anything.
8. Regular staff and inactive administrators are denied; an active administrator may reconcile an inactive originating employee's request without impersonation.
9. A stale worker lease cannot finish after an audited requeue; claim allowances are bounded per cycle and prior history remains intact.
10. Actual concurrent resolution/credit/refund/collection activation respects invoice locking and reviewed snapshot invalidation.
11. Original observations, financial evidence, captures, resolutions and receipt history remain immutable and visible under appropriate RLS.
12. Missing objects, elapsed retry horizons and local timeouts never become proof of non-creation.
13. Failure or lost acknowledgement at capture/completion/requeue retains the exact durable request and supports safe recovery without replacement money movement.
14. Public collection eligibility and staff UI both unblock only after the corresponding unresolved blockers are resolved; unrelated and newly received blockers continue to prevent action.

Database and mocked-handler tests establish local invariants only. Actual Stripe evidence, signed webhook processing and practice review are still required for operational acceptance.


## Implemented database increment (3500; local verification only)

Migration `20260913350000_payment_reconciliation_resolution.sql` implements an administrator-reviewed workflow for a previously accepted, exact provider object. Service verification adapter and administrator UI are **not implemented**; no production resolution is enabled by this database work alone.

RPC sequence:

1. Authenticated active ADMIN calls `preview_payment_reconciliation(invoice_id, family, request_id, provider_object_id)` to obtain immutable context, eligible `blocker_refs` and `snapshot_hash`.
2. The same administrator calls `prepare_payment_reconciliation(case_id, invoice_id, family, request_id, provider_object_id, blocker_refs, expected_case_hash)` with an exact, nonempty subset of reviewed blocker references.
3. A future trusted service adapter retrieves and verifies the exact provider object, then calls service-only `capture_payment_reconciliation(case_id, reviewer_id, provider_evidence)`. It must set `provider_observed_at` after the verified retrieval, never accept that proof from a browser.
4. The administrator reviews `read_payment_reconciliation(case_id)` and calls `complete_payment_reconciliation(case_id, reviewed_proof_hash, expected_case_hash, attest)` with explicit true attestation. Completion applies ordinary ledger evidence and appends resolution targets in one invoice-locked transaction. UUID retries recover the exact case/capture/completion; altered inputs are rejected.

Proof has exact common fields: `family`, `request_id`, `object_id`, `account_id`, `livemode` (boolean), `amount_cents` (string), `currency`, `provider_observed_at` and `status`. Checkout additionally requires `payment_id` (nullable) and `source_hash`; refund additionally requires `provider_payment_id`. No URL, free-text reason or full payload is accepted. Capture and completion require proof no more than five minutes old. Changed financial facts require a new case.

Accepted scope is known Checkout objects with `session_open`, `session_expired` or `payment_succeeded`, and known refund objects with `pending`, `failed` or `succeeded`. Only unavailable/reconciliation-required observations and Checkout `provider_reconciliation_required` quarantines can be targeted. Any open context-mismatch observation or other quarantined financial evidence blocks this workflow. Previously failed refunds without settled cash remain outside scope, including fresh matching failed proof; late success after that release remains quarantined. Unknown objects, absence claims, external adjustments, disputes and inbox retry cycles remain planned.

Resolved observations remain visible with `resolved: true`; same-reason recurrence creates a fresh blocking occurrence. Open Checkout and pending refund proofs retain their ordinary reservations. Expiration releases only the Checkout reservation; success posts cash once. The five changed call sites are `checkout_state_internal`, `refund_state_internal`, `guard_payment_reconciliation`, `inspect_payment_collection` and `read_invoice_payment_state`. Migration application fails if expected original definition patterns are missing. Existing 3600 redaction code is preserved. Staff UI must use the new resolved flag before presenting a resolved observation as still blocking.

Local verification: 38 focused pgTAP assertions; existing ledger 64, observations 58, collection access 51, event inbox 44 and inventory/billing 58 all pass. `payment_reconciliation_concurrency.py` passes 14 checks across three observed lock-contention scenarios: expiration resolution before credit, a new observation before completion, and duplicate simultaneous completion. Fixtures are removed afterward. Concurrent provider refund settlement versus resolution and resolved-history public inspection do not yet have dedicated race/roundtrip fixtures; existing regression suites cover their unchanged underlying contracts. No provider or hosted database calls were made.
